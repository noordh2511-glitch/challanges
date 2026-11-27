/**
 * محرك المزامنة اللاسلكية المستقل للعبة «المافيا» عبر Firebase RTDB (/mafiaRooms/{roomCode})
 * - معزول بالكامل عن /rooms و /baraRooms و /users
 * - يستورد Firebase Modular SDK (v10) ديناميكياً عند تفعيل غرفة المافيا فقط (صفر طلبات شبكة أوفلاين!)
 * - يشارك نفس تطبيق Firebase للمقدّم (seen-jeem-host-<projectId>) ولا يستدعي signInAnonymously
 *   إلا عندما يكون auth.currentUser === null حمايةً لجلسة حساب Google للمزامنة السحابية.
 * - أمان صارم ومنع تسريب: privateRoles/{uid} و privateIntel/{uid} و nightActions/{uid} و dayVotes/{uid}
 *   مع Shallow Diffing على publicState وتنظيف تلقائي للغرف القديمة (>24 ساعة).
 */
(function () {
  "use strict";

  const FIREBASE_SDK_VER = "10.14.1";
  const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون O, 0, I, 1
  const OWNED_ROOMS_KEY = "mafia-owned-rooms-v1";
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
    return (
      String(raw || "")
        .trim()
        .replace(/[.#$\[\]\/\s]+/g, "_")
        .slice(0, 48) || "default"
    );
  }

  function buildMafiaPlayerUrl(roomCode) {
    try {
      const u = new URL(window.location.href);
      u.search = "";
      u.hash = "";
      u.searchParams.set("mode", "mafia-player");
      if (roomCode) u.searchParams.set("room", roomCode);
      return u.toString();
    } catch (_err) {
      return `?mode=mafia-player&room=${roomCode || ""}`;
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

  class MafiaSyncEngine {
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
      this._lastIntelSigs = new Map();
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
        playerUrl: this.roomCode ? buildMafiaPlayerUrl(this.roomCode) : ""
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
        throw new Error("تعذّر تفعيل غرفة اللعب حالياً — تأكد من الاتصال بالإنترنت.");
      }
      if (!navigator.onLine) {
        throw new Error("لا يوجد اتصال بالإنترنت حالياً لفتح غرفة المافيا اللاسلكية.");
      }

      const sdk = await this._loadFirebaseSdk();
      const sig = `${roleTag}:${JSON.stringify(cfg)}`;

      if (!this._app || this._activeConfigSignature !== sig) {
        const isHostRole = roleTag === "host";
        // مشاركة نفس تطبيق المقدّم مع cloudSyncManager حتى لا يُستبدل حساب Google عند فتح غرفة المافيا
        const appName = isHostRole
          ? `seen-jeem-host-${sanitizeKey(cfg.projectId)}`
          : `seen-jeem-mafia-${sanitizeKey(roleTag)}-${sanitizeKey(cfg.projectId)}`;
        const existingApp = sdk.appMod.getApps().find((a) => a.name === appName);
        if (this._app && !isHostRole && this._app.name !== appName) {
          try {
            await sdk.appMod.deleteApp(this._app);
          } catch (_err) {}
        }
        this._app = existingApp || sdk.appMod.initializeApp(cfg, appName);
        this._auth = sdk.authMod.getAuth(this._app);
        this._db = sdk.dbMod.getDatabase(this._app);
        this._activeConfigSignature = sig;
      }

      if (typeof this._auth.authStateReady === "function") {
        await this._auth.authStateReady();
      }
      // نقطة حرجة: لا نستدعي signInAnonymously إلا إذا كان auth.currentUser === null حمايةً لجلسة Google
      if (this._auth.currentUser === null) {
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
      const metaRef = sdk.dbMod.ref(db, `mafiaRooms/${roomCode}/meta`);
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
        .update(dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/meta`), {
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
            await sdk.dbMod.remove(sdk.dbMod.ref(db, `mafiaRooms/${entry.roomCode}`));
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
     * إنشاء غرفة «المافيا» كجهاز رئيسي (الراوي الآلي)
     */
    async createRoom({
      initialPublicState = {},
      vipEnabled = true,
      onPlayers = null,
      onNightActions = null,
      onDayVotes = null,
      onVipCommand = null,
      onConnectionState = null
    } = {}) {
      await this.closeRoom();
      const { sdk, db, uid } = await this._ensureInitialized("host");

      this.cleanupStaleOwnedRooms({ silent: true }).catch(() => {});

      const roomCode = generateRoomCode();
      const roomPath = `mafiaRooms/${roomCode}`;

      await sdk.dbMod.set(sdk.dbMod.ref(db, `${roomPath}/meta`), {
        ownerUid: uid,
        createdAt: sdk.dbMod.serverTimestamp(),
        lastActivityAt: sdk.dbMod.serverTimestamp(),
        joinLocked: false,
        vipEnabled: Boolean(vipEnabled),
        vipUid: null,
        hostOnline: true,
        appVersion: "4.15.0"
      });

      this._role = "master";
      this.roomCode = roomCode;
      this._lastPublicSig = "";
      this._lastIntelSigs.clear();
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
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${roomPath}/nightActions`), (snap) => {
          if (typeof onNightActions === "function") onNightActions(snap.val() || {});
        })
      );

      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${roomPath}/dayVotes`), (snap) => {
          if (typeof onDayVotes === "function") onDayVotes(snap.val() || {});
        })
      );

      this._unsubs.push(
        sdk.dbMod.onChildAdded(sdk.dbMod.ref(db, `${roomPath}/vipCommands`), (snap) => {
          const cmdId = snap.key;
          const cmdVal = snap.val();
          sdk.dbMod.remove(sdk.dbMod.ref(db, `${roomPath}/vipCommands/${cmdId}`)).catch(() => {});
          if (cmdVal && typeof onVipCommand === "function") {
            this._maybeTouchActivity();
            onVipCommand(cmdVal, cmdId);
          }
        })
      );

      return this.getRoomInfo();
    }

    /**
     * نشر الحالة العامة فقط مع Shallow Diffing (لا تتضمن أبداً الأدوار السرية أو قرارات الليل)
     */
    async publishPublicState(rawPublicState) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db || !rawPublicState) return;
      const clean = stripUndefined(rawPublicState);
      // طبقة حماية إضافية ضد تسريب أي حقل سري بالخطأ
      delete clean.privateRoles;
      delete clean.privateIntel;
      delete clean.nightActions;
      delete clean.secretRoles;

      const sig = JSON.stringify(clean);
      if (sig === this._lastPublicSig) return;
      this._lastPublicSig = sig;
      const { dbMod } = this._sdk;
      try {
        await dbMod.set(dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/publicState`), clean);
        this._maybeTouchActivity();
      } catch (_err) {}
    }

    /**
     * توزيع الأدوار السرية في privateRoles/{uid} ومسح بيانات الجلسة السابقة
     */
    async publishPrivateRolesAndReset(rolesByUid, initialIntelByUid = null) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const cleanRoles = {};
      Object.keys(rolesByUid || {}).forEach((uid) => {
        const r = rolesByUid[uid];
        if (!r) return;
        cleanRoles[uid] = stripUndefined({
          gameId: String(r.gameId || ""),
          role: String(r.role || "citizen"),
          roleLabel: String(r.roleLabel || "مواطن"),
          roleIcon: String(r.roleIcon || "🏘️"),
          roleDescription: String(r.roleDescription || ""),
          team: String(r.team || "citizens"),
          teammates: Array.isArray(r.teammates) ? r.teammates : []
        });
      });
      const cleanIntel = initialIntelByUid ? stripUndefined(initialIntelByUid) : null;
      this._lastIntelSigs.clear();
      if (cleanIntel && typeof cleanIntel === "object") {
        Object.keys(cleanIntel).forEach((uid) => {
          this._lastIntelSigs.set(uid, JSON.stringify(cleanIntel[uid]));
        });
      }
      try {
        await dbMod.update(dbMod.ref(this._db, `mafiaRooms/${this.roomCode}`), {
          privateRoles: cleanRoles,
          privateIntel: cleanIntel,
          nightActions: null,
          dayVotes: null
        });
        this._maybeTouchActivity();
      } catch (_err) {}
    }

    /**
     * تحديث المعلومات السرية للاعب واحد (مثل فحوصات المحقق، اختيارات شركاء المافيا، آخر حماية للطبيب)
     */
    async publishPrivateIntelForUid(uid, intelObj) {
      if (this._role !== "master" || !this.roomCode || !uid || !this._sdk || !this._db) return;
      const clean = stripUndefined(intelObj || {});
      const sig = JSON.stringify(clean);
      if (this._lastIntelSigs.get(uid) === sig) return;
      this._lastIntelSigs.set(uid, sig);
      const { dbMod } = this._sdk;
      try {
        await dbMod.set(dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/privateIntel/${uid}`), clean);
        this._maybeTouchActivity();
      } catch (_err) {}
    }

    async clearRoundActions({ night = false, votes = false } = {}) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const patch = {};
      if (night) patch.nightActions = null;
      if (votes) patch.dayVotes = null;
      if (Object.keys(patch).length === 0) return;
      const { dbMod } = this._sdk;
      try {
        await dbMod.update(dbMod.ref(this._db, `mafiaRooms/${this.roomCode}`), patch);
      } catch (_err) {}
    }

    async setJoinLocked(locked) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      try {
        await dbMod.update(dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/meta`), {
          joinLocked: Boolean(locked)
        });
        this._maybeTouchActivity();
      } catch (_err) {}
    }

    async setVipMeta({ vipUid, vipEnabled } = {}) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const patch = {};
      if (vipUid !== undefined) patch.vipUid = vipUid || null;
      if (typeof vipEnabled === "boolean") patch.vipEnabled = vipEnabled;
      if (Object.keys(patch).length === 0) return;
      try {
        await dbMod.update(dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/meta`), patch);
        this._maybeTouchActivity();
      } catch (_err) {}
    }

    async approvePlayerUid(uid) {
      if (this._role !== "master" || !this.roomCode || !uid || !this._sdk || !this._db) return;
      if (this._approvedUids.has(uid)) return;
      this._approvedUids.add(uid);
      const { dbMod } = this._sdk;
      try {
        await dbMod.set(dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/allowedPlayers/${uid}`), true);
      } catch (_err) {
        this._approvedUids.delete(uid);
      }
    }

    async kickPlayer(targetUid) {
      if (this._role !== "master" || !this.roomCode || !targetUid || !this._sdk || !this._db) {
        return { ok: false };
      }
      this._approvedUids.delete(targetUid);
      this._lastIntelSigs.delete(targetUid);
      const { dbMod } = this._sdk;
      try {
        await dbMod.update(dbMod.ref(this._db, `mafiaRooms/${this.roomCode}`), {
          [`players/${targetUid}`]: null,
          [`allowedPlayers/${targetUid}`]: null,
          [`privateRoles/${targetUid}`]: null,
          [`privateIntel/${targetUid}`]: null,
          [`nightActions/${targetUid}`]: null,
          [`dayVotes/${targetUid}`]: null,
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
      this._lastIntelSigs.clear();
      this._approvedUids = new Set();
      this._lastPlayerName = "";
      this._kicked = false;

      if (prevRole === "master" && prevRoom && this._sdk && this._db) {
        const { dbMod } = this._sdk;
        try {
          await dbMod.onDisconnect(dbMod.ref(this._db, `mafiaRooms/${prevRoom}/meta`)).cancel();
        } catch (_err) {}
        try {
          await dbMod.remove(dbMod.ref(this._db, `mafiaRooms/${prevRoom}`));
        } catch (_err) {}
        removeOwnedRoomLocal(prevRoom);
      }
    }

    /* =========================================================
       واجهة هاتف اللاعب (?mode=mafia-player)
       ========================================================= */
    async connectAsPlayer({
      roomCode,
      onPublicState = null,
      onPrivateRole = null,
      onPrivateIntel = null,
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

      const { sdk, db, uid } = await this._ensureInitialized("mafia-player");
      this._role = "player";
      this.roomCode = cleanRoom;
      this._kicked = false;
      this._lastPlayerName = "";

      const roomPath = `mafiaRooms/${cleanRoom}`;

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

      this._unsubs.push(
        sdk.dbMod.onValue(
          sdk.dbMod.ref(db, `${roomPath}/meta`),
          (snap) => {
            if (!this._kicked && typeof onMeta === "function") onMeta(snap.val());
          },
          () => {}
        )
      );

      this._unsubs.push(
        sdk.dbMod.onValue(
          sdk.dbMod.ref(db, `${roomPath}/privateRoles/${uid}`),
          (snap) => {
            if (!this._kicked && typeof onPrivateRole === "function") onPrivateRole(snap.val());
          },
          () => {}
        )
      );

      this._unsubs.push(
        sdk.dbMod.onValue(
          sdk.dbMod.ref(db, `${roomPath}/privateIntel/${uid}`),
          (snap) => {
            if (!this._kicked && typeof onPrivateIntel === "function") onPrivateIntel(snap.val());
          },
          () => {}
        )
      );

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
          dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/allowedPlayers/${this._uid}`)
        );
        return Boolean(snap && snap.exists() && snap.val() === true);
      } catch (_err) {
        return false;
      }
    }

    async registerPlayer(rawName, rawAvatar = "") {
      if (this._role !== "player" || !this.roomCode || !this._uid || !this._sdk || !this._db || this._kicked) {
        return { ok: false, error: "غير متصل بالغرفة" };
      }
      const cleanName = String(rawName || "").trim().slice(0, 24);
      if (!cleanName) {
        return { ok: false, error: "يرجى كتابة اسمك أولاً." };
      }
      const cleanAvatar = String(
        rawAvatar || (window.SeenJeemProfile && window.SeenJeemProfile.getRoomIdentity().avatar) || ""
      ).trim().slice(0, 8);
      const { dbMod } = this._sdk;
      const pRef = dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/players/${this._uid}`);
      this._lastPlayerName = cleanName;
      try {
        await dbMod.set(pRef, {
          uid: this._uid,
          name: cleanName,
          avatar: cleanAvatar || "👤",
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

    async submitNightAction({ roundNumber = 0, actionType = "decoy", targetUid = null, gameId = "" } = {}) {
      if (this._role !== "player" || !this.roomCode || !this._uid || !this._sdk || !this._db || this._kicked) {
        return { ok: false, error: "غير متصل بالغرفة" };
      }
      const { dbMod } = this._sdk;
      const actRef = dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/nightActions/${this._uid}`);
      try {
        await dbMod.set(
          actRef,
          stripUndefined({
            roundNumber: Number(roundNumber) || 0,
            actionType: String(actionType || "decoy"),
            targetUid: targetUid ? String(targetUid) : null,
            gameId: gameId ? String(gameId) : "",
            ts: dbMod.serverTimestamp()
          })
        );
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر إرسال قرارك الليلي" };
      }
    }

    async submitDayVote({ roundNumber = 1, targetUid = "SKIP" } = {}) {
      if (this._role !== "player" || !this.roomCode || !this._uid || !this._sdk || !this._db || this._kicked) {
        return { ok: false, error: "غير متصل بالغرفة" };
      }
      const { dbMod } = this._sdk;
      const voteRef = dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/dayVotes/${this._uid}`);
      try {
        await dbMod.set(
          voteRef,
          stripUndefined({
            roundNumber: Number(roundNumber) || 1,
            targetUid: String(targetUid || "SKIP"),
            ts: dbMod.serverTimestamp()
          })
        );
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر إرسال تصويتك" };
      }
    }

    async sendVipCommand(type, payload = {}) {
      if (this._role !== "player" || !this.roomCode || !this._uid || !this._sdk || !this._db || this._kicked) {
        return { ok: false, error: "غير متصل بالغرفة" };
      }
      const { dbMod } = this._sdk;
      const cmdRef = dbMod.ref(this._db, `mafiaRooms/${this.roomCode}/vipCommands`);
      try {
        await dbMod.push(cmdRef, {
          type: String(type || ""),
          payload: stripUndefined(payload),
          uid: this._uid,
          ts: dbMod.serverTimestamp()
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر إرسال أمر VIP" };
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

  window.SeenJeemMafiaSync = new MafiaSyncEngine();
  window.SeenJeemMafiaSyncUtils = {
    OWNED_ROOMS_KEY,
    generateRoomCode,
    buildMafiaPlayerUrl,
    computeRemainingSeconds
  };
})();
