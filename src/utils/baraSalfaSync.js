/**
 * محرك المزامنة اللاسلكية المستقل للعبة «برا السالفة» عبر Firebase RTDB (/baraRooms/{roomCode})
 * - معزول بالكامل عن مسار /rooms الخاص بلعبة «سين جيم»
 * - يستورد Firebase Modular SDK (v10) ديناميكياً عند تفعيل الوضع اللاسلكي فقط (صفر طلبات شبكة أوفلاين!)
 * - أدوار سرية لكل لاعب في privateRoles/{uid} (يقرؤها صاحب الـ uid فقط؛ والكلمة null للي «برا السالفة»)
 * - أفعال اللاعبين في playerActions/{uid} + Shallow Diffing + طوابع زمنية للمؤقت (.info/serverTimeOffset)
 * - تنظيف تلقائي للغرف القديمة (>24 ساعة) عبر bara-salfa-owned-rooms-v1 وحماية الانقطاع العابر
 */
(function () {
  "use strict";

  const FIREBASE_SDK_VER = "10.14.1";
  const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون O, 0, I, 1
  const OWNED_ROOMS_KEY = "bara-salfa-owned-rooms-v1";
  const STALE_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
  const ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

  function generateRoomCode() {
    const bytes = new Uint8Array(6);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let out = "";
    for (let i = 0; i < 6; i++) {
      out += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
    }
    return out;
  }

  function sanitizeKey(raw) {
    return String(raw || "")
      .trim()
      .replace(/[.#$\[\]\/\s]+/g, "_")
      .slice(0, 48) || "default";
  }

  function buildBaraPlayerUrl(roomCode) {
    try {
      const u = new URL(window.location.href);
      u.search = "";
      u.hash = "";
      u.searchParams.set("mode", "bara-player");
      if (roomCode) u.searchParams.set("room", roomCode);
      return u.toString();
    } catch (_err) {
      return `?mode=bara-player&room=${roomCode || ""}`;
    }
  }

  function stripUndefined(obj) {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(stripUndefined);
    const out = {};
    Object.keys(obj).forEach((k) => {
      if (obj[k] !== undefined) out[k] = stripUndefined(obj[k]);
    });
    return out;
  }

  function computeRemainingSeconds(timerObj, fallbackRemaining = 0, serverTimeOffsetMs = 0) {
    if (timerObj && typeof timerObj === "object") {
      if (timerObj.status === "unlimited") return null;
      if (timerObj.status === "running" && Number.isFinite(timerObj.endAtMs)) {
        const nowServer = Date.now() + (Number(serverTimeOffsetMs) || 0);
        return Math.max(0, Math.ceil((Number(timerObj.endAtMs) - nowServer) / 1000));
      }
      if (timerObj.status === "finished" || timerObj.status === "ended") return 0;
      if (Number.isFinite(timerObj.remainingMs)) {
        return Math.max(0, Math.ceil(Number(timerObj.remainingMs) / 1000));
      }
    }
    return Math.max(0, Math.floor(Number(fallbackRemaining) || 0));
  }

  function loadOwnedRooms() {
    try {
      const raw = localStorage.getItem(OWNED_ROOMS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((r) => r && typeof r.roomCode === "string" && r.roomCode.length >= 4)
        : [];
    } catch (_err) {
      return [];
    }
  }

  function saveOwnedRooms(list) {
    try {
      localStorage.setItem(OWNED_ROOMS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    } catch (_err) {}
  }

  function recordOwnedRoom(roomCode, ownerUid) {
    if (!roomCode) return;
    const now = Date.now();
    const list = loadOwnedRooms().filter((r) => r.roomCode !== roomCode);
    list.push({ roomCode, createdAt: now, lastActivityAt: now, ownerUid: ownerUid || "" });
    saveOwnedRooms(list.slice(-30));
  }

  function touchOwnedRoomLocal(roomCode) {
    if (!roomCode) return;
    const list = loadOwnedRooms();
    let changed = false;
    list.forEach((r) => {
      if (r.roomCode === roomCode) {
        r.lastActivityAt = Date.now();
        changed = true;
      }
    });
    if (changed) saveOwnedRooms(list);
  }

  function removeOwnedRoomLocal(roomCode) {
    if (!roomCode) return;
    saveOwnedRooms(loadOwnedRooms().filter((r) => r.roomCode !== roomCode));
  }

  function getStaleOwnedRooms(excludeRoomCode = "") {
    const now = Date.now();
    return loadOwnedRooms().filter((r) => {
      if (excludeRoomCode && r.roomCode === excludeRoomCode) return false;
      const refTime = Number(r.lastActivityAt) || Number(r.createdAt) || 0;
      return refTime > 0 && now - refTime > STALE_ROOM_TTL_MS;
    });
  }

  class BaraSalfaSyncEngine {
    constructor() {
      this._sdk = null;
      this._app = null;
      this._auth = null;
      this._db = null;
      this._uid = null;
      this._activeConfigSignature = "";
      this._unsubs = [];
      this._role = null; // "master" | "player" | null
      this.roomCode = "";
      this.connected = false;
      this._serverTimeOffsetMs = 0;
      this._lastPublicSig = "";
      this._lastActivityTouchMs = 0;
      this._approvedUids = new Set();
      this._lastPlayerName = "";
      this._kicked = false;
    }

    isConfigured() {
      return Boolean(window.SeenJeemFirebaseConfig && window.SeenJeemFirebaseConfig.isConfigured());
    }

    isActive() {
      return Boolean(this._role && this.roomCode);
    }

    getUid() {
      return this._uid || "";
    }

    getServerTimeOffsetMs() {
      return Number(this._serverTimeOffsetMs) || 0;
    }

    getServerNowMs() {
      return Date.now() + this.getServerTimeOffsetMs();
    }

    getRoomInfo() {
      return {
        active: this.isActive(),
        role: this._role,
        roomCode: this.roomCode,
        uid: this._uid || "",
        connected: this.connected,
        playerUrl: this.roomCode ? buildBaraPlayerUrl(this.roomCode) : ""
      };
    }

    async _loadFirebaseSdk() {
      if (this._sdk) return this._sdk;
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VER}`;
      const [appMod, authMod, dbMod] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-database.js`)
      ]);
      this._sdk = { appMod, authMod, dbMod };
      return this._sdk;
    }

    async _ensureInitialized(roleTag = "host") {
      const cfg = window.SeenJeemFirebaseConfig ? window.SeenJeemFirebaseConfig.getConfig() : null;
      if (!window.SeenJeemFirebaseConfig || !window.SeenJeemFirebaseConfig.isValidConfig(cfg)) {
        throw new Error("إعدادات Firebase غير مكتملة. أدخلها من «📡 الغرفة اللاسلكية ← ⚙️ إعدادات الاتصال».");
      }
      if (!navigator.onLine) {
        throw new Error("لا يوجد اتصال بالإنترنت حالياً لتفعيل الوضع اللاسلكي.");
      }

      const sdk = await this._loadFirebaseSdk();
      const sig = `${roleTag}:${JSON.stringify(cfg)}`;

      if (!this._app || this._activeConfigSignature !== sig) {
        if (this._app) {
          try {
            await sdk.appMod.deleteApp(this._app);
          } catch (_err) {}
        }
        const appName = `seen-jeem-bara-${sanitizeKey(roleTag)}-${sanitizeKey(cfg.projectId)}`;
        this._app = sdk.appMod.initializeApp(cfg, appName);
        this._auth = sdk.authMod.getAuth(this._app);
        this._db = sdk.dbMod.getDatabase(this._app);
        this._activeConfigSignature = sig;
      }

      if (!this._auth.currentUser) {
        const cred = await sdk.authMod.signInAnonymously(this._auth);
        this._uid = cred && cred.user ? cred.user.uid : null;
      } else {
        this._uid = this._auth.currentUser.uid;
      }

      return { sdk, db: this._db, uid: this._uid };
    }

    _clearListeners() {
      this._unsubs.forEach((fn) => {
        try {
          if (typeof fn === "function") fn();
        } catch (_err) {}
      });
      this._unsubs = [];
    }

    _watchServerTimeOffset(sdk, db) {
      const ref = sdk.dbMod.ref(db, ".info/serverTimeOffset");
      this._unsubs.push(
        sdk.dbMod.onValue(ref, (snap) => {
          const v = snap.val();
          if (typeof v === "number" && Number.isFinite(v)) this._serverTimeOffsetMs = v;
        })
      );
    }

    _watchConnected(sdk, db, onConnectionState) {
      const connRef = sdk.dbMod.ref(db, ".info/connected");
      this._unsubs.push(
        sdk.dbMod.onValue(connRef, (snap) => {
          const isConn = Boolean(snap.val());
          this.connected = isConn;
          if (isConn && this._role === "master" && this.roomCode) {
            this._armMasterPresence(sdk, db, this.roomCode).catch(() => {});
          }
          if (isConn && this._role === "player" && this.roomCode && this._lastPlayerName && !this._kicked) {
            this.registerPlayer(this._lastPlayerName).catch(() => {});
          }
          if (typeof onConnectionState === "function") onConnectionState(isConn);
        })
      );
    }

    async _armMasterPresence(sdk, db, roomCode) {
      const metaRef = sdk.dbMod.ref(db, `baraRooms/${roomCode}/meta`);
      try {
        await sdk.dbMod.onDisconnect(metaRef).update({
          hostOnline: false,
          disconnectedAt: sdk.dbMod.serverTimestamp()
        });
        await sdk.dbMod.update(metaRef, {
          hostOnline: true,
          disconnectedAt: null
        });
      } catch (_err) {}
    }

    _maybeTouchActivity() {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const now = Date.now();
      if (now - this._lastActivityTouchMs < ACTIVITY_TOUCH_INTERVAL_MS) return;
      this._lastActivityTouchMs = now;
      touchOwnedRoomLocal(this.roomCode);
      const { dbMod } = this._sdk;
      dbMod
        .update(dbMod.ref(this._db, `baraRooms/${this.roomCode}/meta`), {
          lastActivityAt: dbMod.serverTimestamp()
        })
        .catch(() => {});
    }

    async cleanupStaleOwnedRooms({ silent = true } = {}) {
      const stale = getStaleOwnedRooms(this.roomCode);
      if (stale.length === 0 || !this.isConfigured() || !navigator.onLine) {
        return { cleaned: 0 };
      }
      let cleaned = 0;
      try {
        const { sdk, db } = await this._ensureInitialized("host");
        for (const entry of stale) {
          try {
            await sdk.dbMod.remove(sdk.dbMod.ref(db, `baraRooms/${entry.roomCode}`));
            removeOwnedRoomLocal(entry.roomCode);
            cleaned += 1;
          } catch (err) {
            const msg = String((err && (err.code || err.message)) || "").toLowerCase();
            if (msg.includes("permission") || msg.includes("denied")) {
              removeOwnedRoomLocal(entry.roomCode);
            } else if (!silent) {
              throw err;
            }
          }
        }
      } catch (err) {
        if (!silent) throw err;
      }
      return { cleaned };
    }

    /**
     * إنشاء غرفة «برا السالفة» كجهاز رئيسي (Master)
     */
    async createRoom({
      initialPublicState = {},
      onPlayers = null,
      onPlayerActions = null,
      onConnectionState = null
    } = {}) {
      await this.closeRoom();
      const { sdk, db, uid } = await this._ensureInitialized("host");

      this.cleanupStaleOwnedRooms({ silent: true }).catch(() => {});

      const roomCode = generateRoomCode();
      const roomPath = `baraRooms/${roomCode}`;

      await sdk.dbMod.set(sdk.dbMod.ref(db, `${roomPath}/meta`), {
        ownerUid: uid,
        createdAt: sdk.dbMod.serverTimestamp(),
        lastActivityAt: sdk.dbMod.serverTimestamp(),
        joinLocked: false,
        hostOnline: true,
        appVersion: "4.11.0"
      });

      this._role = "master";
      this.roomCode = roomCode;
      this._lastPublicSig = "";
      this._lastActivityTouchMs = Date.now();
      this._approvedUids = new Set();
      recordOwnedRoom(roomCode, uid);

      await this._armMasterPresence(sdk, db, roomCode);
      await this.publishPublicState(initialPublicState);

      this._watchServerTimeOffset(sdk, db);
      this._watchConnected(sdk, db, onConnectionState);

      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${roomPath}/players`), (snap) => {
          if (typeof onPlayers === "function") onPlayers(snap.val() || {});
        })
      );

      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${roomPath}/playerActions`), (snap) => {
          if (typeof onPlayerActions === "function") onPlayerActions(snap.val() || {});
        })
      );

      return this.getRoomInfo();
    }

    /**
     * نشر الحالة العامة المنقّاة فقط مع Shallow Diffing لمنع الكتابات المكررة
     * (لا يحتوي أبداً على secretWord قبل round_results ولا على outsiderUids قبل outsider_reveal)
     */
    async publishPublicState(rawPublicState) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db || !rawPublicState) return;
      const clean = stripUndefined(rawPublicState);
      const sig = JSON.stringify(clean);
      if (sig === this._lastPublicSig) return;
      this._lastPublicSig = sig;
      const { dbMod } = this._sdk;
      try {
        await dbMod.set(dbMod.ref(this._db, `baraRooms/${this.roomCode}/publicState`), clean);
        this._maybeTouchActivity();
      } catch (_err) {}
    }

    /**
     * إرسال الأدوار السرية لكل لاعب إلى عقده الخاص privateRoles/{uid} فقط
     * مع مسح playerActions الخاصة بالجولة السابقة في تحديث واحد منظم
     */
    async publishPrivateRolesAndResetActions(rolesByUid) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const cleanRoles = {};
      Object.keys(rolesByUid || {}).forEach((uid) => {
        const r = rolesByUid[uid];
        if (!r) return;
        const isOut = Boolean(r.isOutsider);
        cleanRoles[uid] = {
          roundNumber: Number(r.roundNumber) || 1,
          isOutsider: isOut,
          categoryName: String(r.categoryName || ""),
          categoryIcon: String(r.categoryIcon || "🕵️"),
          // حماية قاطعة: الكلمة السرية null تماماً للي «برا السالفة»
          secretWord: isOut ? null : String(r.secretWord || "")
        };
      });
      try {
        await dbMod.update(dbMod.ref(this._db, `baraRooms/${this.roomCode}`), {
          privateRoles: cleanRoles,
          playerActions: null
        });
        this._maybeTouchActivity();
      } catch (_err) {}
    }

    async setJoinLocked(locked) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      try {
        await dbMod.update(dbMod.ref(this._db, `baraRooms/${this.roomCode}/meta`), {
          joinLocked: Boolean(locked)
        });
        this._maybeTouchActivity();
      } catch (_err) {}
    }

    async approvePlayerUid(uid) {
      if (this._role !== "master" || !this.roomCode || !uid || !this._sdk || !this._db) return;
      if (this._approvedUids.has(uid)) return;
      this._approvedUids.add(uid);
      const { dbMod } = this._sdk;
      try {
        await dbMod.set(dbMod.ref(this._db, `baraRooms/${this.roomCode}/allowedPlayers/${uid}`), true);
      } catch (_err) {
        this._approvedUids.delete(uid);
      }
    }

    async kickPlayer(targetUid) {
      if (this._role !== "master" || !this.roomCode || !targetUid || !this._sdk || !this._db) {
        return { ok: false };
      }
      this._approvedUids.delete(targetUid);
      const { dbMod } = this._sdk;
      try {
        await dbMod.update(dbMod.ref(this._db, `baraRooms/${this.roomCode}`), {
          [`players/${targetUid}`]: null,
          [`allowedPlayers/${targetUid}`]: null,
          [`privateRoles/${targetUid}`]: null,
          [`playerActions/${targetUid}`]: null,
          [`kicked/${targetUid}`]: true
        });
        this._maybeTouchActivity();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر طرد اللاعب" };
      }
    }

    async closeRoom() {
      const prevRole = this._role;
      const prevRoom = this.roomCode;
      this._clearListeners();
      this._role = null;
      this.roomCode = "";
      this.connected = false;
      this._lastPublicSig = "";
      this._approvedUids = new Set();
      this._lastPlayerName = "";
      this._kicked = false;

      if (prevRole === "master" && prevRoom && this._sdk && this._db) {
        const { dbMod } = this._sdk;
        try {
          await dbMod.onDisconnect(dbMod.ref(this._db, `baraRooms/${prevRoom}/meta`)).cancel();
        } catch (_err) {}
        try {
          await dbMod.remove(dbMod.ref(this._db, `baraRooms/${prevRoom}`));
        } catch (_err) {}
        removeOwnedRoomLocal(prevRoom);
      }
    }

    /* =========================================================
       واجهة هاتف اللاعب (?mode=bara-player)
       ========================================================= */
    async connectAsPlayer({
      roomCode,
      onPublicState = null,
      onPrivateRole = null,
      onPlayers = null,
      onMeta = null,
      onKicked = null,
      onConnectionState = null,
      onError = null
    } = {}) {
      this._clearListeners();
      const cleanRoom = String(roomCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (cleanRoom.length < 4) {
        throw new Error("يرجى إدخال رمز غرفة صحيح (6 أحرف/أرقام).");
      }

      const { sdk, db, uid } = await this._ensureInitialized("bara-player");
      this._role = "player";
      this.roomCode = cleanRoom;
      this._kicked = false;
      this._lastPlayerName = "";

      const roomPath = `baraRooms/${cleanRoom}`;

      // 1) مراقبة الطرد الفوري
      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${roomPath}/kicked/${uid}`), (snap) => {
          if (snap.val() === true) {
            this._kicked = true;
            this.disconnect();
            if (typeof onKicked === "function") onKicked();
          }
        })
      );

      this._watchServerTimeOffset(sdk, db);
      this._watchConnected(sdk, db, onConnectionState);

      // 2) الحالة العامة
      this._unsubs.push(
        sdk.dbMod.onValue(
          sdk.dbMod.ref(db, `${roomPath}/publicState`),
          (snap) => {
            if (!this._kicked && typeof onPublicState === "function") onPublicState(snap.val());
          },
          (err) => {
            if (typeof onError === "function") onError(err);
          }
        )
      );

      // 3) البيانات الوصفية الخفيفة (لمعرفة وجود الغرفة وقفل الانضمام)
      this._unsubs.push(
        sdk.dbMod.onValue(
          sdk.dbMod.ref(db, `${roomPath}/meta`),
          (snap) => {
            if (!this._kicked && typeof onMeta === "function") onMeta(snap.val());
          },
          () => {}
        )
      );

      // 4) الدور السري الخاص بهذا اللاعب فقط privateRoles/{uid}
      this._unsubs.push(
        sdk.dbMod.onValue(
          sdk.dbMod.ref(db, `${roomPath}/privateRoles/${uid}`),
          (snap) => {
            if (!this._kicked && typeof onPrivateRole === "function") onPrivateRole(snap.val());
          },
          () => {}
        )
      );

      // 5) قائمة اللاعبين المتصلين في اللوبي
      if (typeof onPlayers === "function") {
        this._unsubs.push(
          sdk.dbMod.onValue(
            sdk.dbMod.ref(db, `${roomPath}/players`),
            (snap) => {
              if (!this._kicked) onPlayers(snap.val() || {});
            },
            () => {}
          )
        );
      }

      return this.getRoomInfo();
    }

    async isPlayerPreApproved() {
      if (this._role !== "player" || !this.roomCode || !this._uid || !this._sdk || !this._db) return false;
      const { dbMod } = this._sdk;
      try {
        const snap = await dbMod.get(
          dbMod.ref(this._db, `baraRooms/${this.roomCode}/allowedPlayers/${this._uid}`)
        );
        return Boolean(snap && snap.exists() && snap.val() === true);
      } catch (_err) {
        return false;
      }
    }

    async registerPlayer(rawName) {
      if (this._role !== "player" || !this.roomCode || !this._uid || !this._sdk || !this._db || this._kicked) {
        return { ok: false, error: "غير متصل بالغرفة" };
      }
      const cleanName = String(rawName || "").trim().slice(0, 24);
      if (!cleanName) {
        return { ok: false, error: "يرجى كتابة اسمك أولاً." };
      }
      const { dbMod } = this._sdk;
      const pRef = dbMod.ref(this._db, `baraRooms/${this.roomCode}/players/${this._uid}`);
      this._lastPlayerName = cleanName;
      try {
        // كتابة العقدة أولاً قبل تسجيل onDisconnect().remove() لتفادي رفض القواعد على العقد غير الموجودة
        await dbMod.set(pRef, {
          uid: this._uid,
          name: cleanName,
          joinedAt: dbMod.serverTimestamp(),
          online: true
        });
        try {
          await dbMod.onDisconnect(pRef).remove();
        } catch (_odErr) {}
        return { ok: true, uid: this._uid, name: cleanName };
      } catch (err) {
        const msg = String((err && (err.code || err.message)) || "").toLowerCase();
        if (msg.includes("permission") || msg.includes("denied")) {
          return { ok: false, locked: true, error: "🔒 الغرفة مقفلة حالياً من قِبل المقدّم" };
        }
        return { ok: false, error: (err && err.message) || "تعذّر الانضمام للغرفة" };
      }
    }

    async submitAction(patch) {
      if (this._role !== "player" || !this.roomCode || !this._uid || !this._sdk || !this._db || this._kicked) {
        return { ok: false, error: "غير متصل بالغرفة" };
      }
      const { dbMod } = this._sdk;
      const actRef = dbMod.ref(this._db, `baraRooms/${this.roomCode}/playerActions/${this._uid}`);
      try {
        await dbMod.update(actRef, stripUndefined({ ...patch, updatedAt: dbMod.serverTimestamp() }));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر إرسال اختيارك" };
      }
    }

    disconnect() {
      this._clearListeners();
      this._role = null;
      this.roomCode = "";
      this.connected = false;
      this._lastPlayerName = "";
    }
  }

  window.SeenJeemBaraSalfaSync = new BaraSalfaSyncEngine();
  window.SeenJeemBaraSalfaSyncUtils = {
    OWNED_ROOMS_KEY,
    generateRoomCode,
    buildBaraPlayerUrl,
    computeRemainingSeconds
  };
})();
