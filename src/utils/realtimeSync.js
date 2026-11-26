/**
 * محرك المزامنة اللاسلكية عبر Firebase Realtime Database (Master-Owned State & Command Queue)
 * - يستورد Firebase Modular SDK (v10) ديناميكياً عند تفعيل الغرفة فقط (صفر طلبات شبكة في الوضع المحلي!)
 * - يدعم تسجيل الدخول المجهول (signInAnonymously) تلقائياً
 * - فصل صارم بين publicState (للاعبين والتلفزيون) و hostPrivate/{hostToken} (سري للمقدّم فقط)
 * - يدعم طابور أوامر المقدّم hostCommands/{hostToken}، جرس السرعة بـ serverTimestamp()، والرهانات السرية
 */
(function () {
  "use strict";

  const FIREBASE_SDK_VER = "10.14.1";
  const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون O, 0, I, 1 لتجنب الالتباس
  const DEVICE_ID_KEY = "seen_jeem_wireless_device_id_v1";

  function getUrlParams() {
    try {
      const p = new URLSearchParams(window.location.search);
      return {
        mode: (p.get("mode") || "host").trim().toLowerCase(),
        room: (p.get("room") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6),
        token: (p.get("token") || "").trim()
      };
    } catch (_err) {
      return { mode: "host", room: "", token: "" };
    }
  }

  function getUrlMode() {
    const m = getUrlParams().mode;
    if (m === "display" || m === "remote" || m === "player") return m;
    return "host";
  }

  function buildRoleUrl(mode, roomCode, hostToken = "") {
    try {
      const u = new URL(window.location.href);
      u.search = "";
      u.hash = "";
      u.searchParams.set("mode", mode);
      if (roomCode) u.searchParams.set("room", roomCode);
      if (mode === "remote" && hostToken) u.searchParams.set("token", hostToken);
      return u.toString();
    } catch (_err) {
      return `?mode=${mode}&room=${roomCode}${mode === "remote" && hostToken ? `&token=${hostToken}` : ""}`;
    }
  }

  function getOrCreateDeviceId() {
    try {
      let id = sessionStorage.getItem(DEVICE_ID_KEY);
      if (id && id.length >= 8) return id;
      const bytes = new Uint8Array(8);
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      id = "dev_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem(DEVICE_ID_KEY, id);
      return id;
    } catch (_err) {
      return "dev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
  }

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

  function generateHostToken() {
    const bytes = new Uint8Array(16); // 128-bit cryptographic secret
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * إزالة قيم undefined لأن Firebase RTDB يرفض undefined
   */
  function stripUndefined(obj) {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(stripUndefined);
    const out = {};
    Object.keys(obj).forEach((k) => {
      if (obj[k] !== undefined) {
        out[k] = stripUndefined(obj[k]);
      }
    });
    return out;
  }

  class RealtimeSyncEngine {
    constructor() {
      this._sdk = null;
      this._app = null;
      this._auth = null;
      this._db = null;
      this._uid = null;
      this._activeConfigSignature = "";
      this._unsubs = [];
      this._role = null; // "master" | "remote" | "player" | null
      this.roomCode = "";
      this.hostToken = "";
      this.connected = false;
      this.deviceId = getOrCreateDeviceId();
    }

    isConfigured() {
      return Boolean(window.SeenJeemFirebaseConfig && window.SeenJeemFirebaseConfig.isConfigured());
    }

    isActive() {
      return Boolean(this._role && this.roomCode);
    }

    getRoomInfo() {
      return {
        active: this.isActive(),
        role: this._role,
        roomCode: this.roomCode,
        hostToken: this.hostToken,
        connected: this.connected,
        remoteUrl: this.roomCode && this.hostToken ? buildRoleUrl("remote", this.roomCode, this.hostToken) : "",
        playerUrl: this.roomCode ? buildRoleUrl("player", this.roomCode) : ""
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

    async _ensureInitialized(configOverride = null) {
      const cfg =
        configOverride ||
        (window.SeenJeemFirebaseConfig ? window.SeenJeemFirebaseConfig.getConfig() : null);

      if (!window.SeenJeemFirebaseConfig || !window.SeenJeemFirebaseConfig.isValidConfig(cfg)) {
        throw new Error("إعدادات Firebase غير مكتملة. أدخلها من «⚙️ إعدادات الاتصال اللاسلكي».");
      }

      if (!navigator.onLine) {
        throw new Error("لا يوجد اتصال بالإنترنت حالياً لتفعيل الغرفة اللاسلكية.");
      }

      const sdk = await this._loadFirebaseSdk();
      const sig = JSON.stringify(cfg);

      if (!this._app || this._activeConfigSignature !== sig) {
        if (this._app) {
          try {
            await sdk.appMod.deleteApp(this._app);
          } catch (_err) {}
        }
        const appName = `seen-jeem-rt-${Date.now().toString(36)}`;
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

    _watchConnected(sdk, db, onConnectionState) {
      const connRef = sdk.dbMod.ref(db, ".info/connected");
      const unsub = sdk.dbMod.onValue(connRef, (snap) => {
        const isConn = Boolean(snap.val());
        this.connected = isConn;
        if (typeof onConnectionState === "function") onConnectionState(isConn);
      });
      this._unsubs.push(unsub);
    }

    async testConnection(configOverride = null) {
      try {
        const { sdk, db, uid } = await this._ensureInitialized(configOverride);
        return {
          ok: true,
          uid,
          message: "تم الاتصال بـ Firebase وتسجيل الدخول المجهول بنجاح!"
        };
      } catch (err) {
        return {
          ok: false,
          error: (err && err.message) || "تعذّر الاتصال بـ Firebase — تحقّق من الإعدادات وAnonymous Auth."
        };
      }
    }

    /**
     * إنشاء غرفة لاسلكية كجهاز رئيسي (Master)
     */
    async createRoom({
      initialPublicState = {},
      initialHostPrivate = {},
      onCommand = null,
      onBuzzes = null,
      onWagers = null,
      onPlayers = null,
      onConnectionState = null
    } = {}) {
      await this.closeRoom();
      const { sdk, db, uid } = await this._ensureInitialized();

      const roomCode = generateRoomCode();
      const hostToken = generateHostToken();
      const roomPath = `rooms/${roomCode}`;

      // 1) كتابة البيانات الوصفية أولاً لتمكين قواعد الأمان فوراً
      await sdk.dbMod.set(sdk.dbMod.ref(db, `${roomPath}/meta`), {
        ownerUid: uid,
        hostToken,
        createdAt: sdk.dbMod.serverTimestamp(),
        appVersion: "4.9.0"
      });

      // 2) كتابة الحالة الأولية المنقّاة والبيانات السرية للمقدّم
      await Promise.all([
        sdk.dbMod.set(sdk.dbMod.ref(db, `${roomPath}/publicState`), stripUndefined(initialPublicState)),
        sdk.dbMod.set(
          sdk.dbMod.ref(db, `${roomPath}/hostPrivate/${hostToken}`),
          stripUndefined(initialHostPrivate)
        )
      ]);

      this._role = "master";
      this.roomCode = roomCode;
      this.hostToken = hostToken;

      this._watchConnected(sdk, db, onConnectionState);

      // الاستماع لطابور أوامر ريموت المقدّم
      const cmdRef = sdk.dbMod.ref(db, `${roomPath}/hostCommands/${hostToken}`);
      const unsubCmd = sdk.dbMod.onChildAdded(cmdRef, (snap) => {
        const cmdId = snap.key;
        const cmdVal = snap.val();
        // حذف الأمر فوراً بعد استلامه لمنع تكرار التنفيذ
        sdk.dbMod.remove(sdk.dbMod.ref(db, `${roomPath}/hostCommands/${hostToken}/${cmdId}`)).catch(() => {});
        if (cmdVal && typeof onCommand === "function") {
          onCommand(cmdVal, cmdId);
        }
      });
      this._unsubs.push(unsubCmd);

      // الاستماع لضغطات جرس السرعة
      const buzzRef = sdk.dbMod.ref(db, `${roomPath}/buzzes`);
      const unsubBuzz = sdk.dbMod.onValue(buzzRef, (snap) => {
        if (typeof onBuzzes === "function") onBuzzes(snap.val() || {});
      });
      this._unsubs.push(unsubBuzz);

      // الاستماع للرهانات السرية من هواتف الفرق
      const wagersRef = sdk.dbMod.ref(db, `${roomPath}/wagers`);
      const unsubWagers = sdk.dbMod.onValue(wagersRef, (snap) => {
        if (typeof onWagers === "function") onWagers(snap.val() || {});
      });
      this._unsubs.push(unsubWagers);

      // الاستماع لحالة اتصال هواتف اللاعبين (Presence)
      const playersRef = sdk.dbMod.ref(db, `${roomPath}/players`);
      const unsubPlayers = sdk.dbMod.onValue(playersRef, (snap) => {
        if (typeof onPlayers === "function") onPlayers(snap.val() || {});
      });
      this._unsubs.push(unsubPlayers);

      return this.getRoomInfo();
    }

    async publishStates(publicState, hostPrivate) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const roomPath = `rooms/${this.roomCode}`;
      const tasks = [];
      if (publicState) {
        tasks.push(dbMod.set(dbMod.ref(this._db, `${roomPath}/publicState`), stripUndefined(publicState)));
      }
      if (hostPrivate && this.hostToken) {
        tasks.push(
          dbMod.set(
            dbMod.ref(this._db, `${roomPath}/hostPrivate/${this.hostToken}`),
            stripUndefined(hostPrivate)
          )
        );
      }
      try {
        await Promise.all(tasks);
      } catch (_err) {
        // استمر بسلاسة دون كسر اللعب المحلي
      }
    }

    async clearBuzzRound(buzzRoundId) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const path = buzzRoundId
        ? `rooms/${this.roomCode}/buzzes/${buzzRoundId}`
        : `rooms/${this.roomCode}/buzzes`;
      try {
        await dbMod.remove(dbMod.ref(this._db, path));
      } catch (_err) {}
    }

    async clearWagersRound(roundId) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const path = roundId
        ? `rooms/${this.roomCode}/wagers/${roundId}`
        : `rooms/${this.roomCode}/wagers`;
      try {
        await dbMod.remove(dbMod.ref(this._db, path));
      } catch (_err) {}
    }

    async closeRoom() {
      const prevRole = this._role;
      const prevRoom = this.roomCode;
      this._clearListeners();
      this._role = null;
      this.roomCode = "";
      this.hostToken = "";
      this.connected = false;

      if (prevRole === "master" && prevRoom && this._sdk && this._db) {
        try {
          await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, `rooms/${prevRoom}`));
        } catch (_err) {}
      }
    }

    /**
     * الاتصال كهاتف ريموت للمقدّم (?mode=remote)
     */
    async connectAsRemoteHost({
      roomCode,
      hostToken,
      onPublicState = null,
      onHostPrivate = null,
      onConnectionState = null,
      onError = null
    } = {}) {
      this._clearListeners();
      const cleanRoom = String(roomCode || "").trim().toUpperCase();
      const cleanToken = String(hostToken || "").trim();
      if (!cleanRoom || !cleanToken) {
        throw new Error("رابط ريموت المقدّم غير مكتمل (ينقص رمز الغرفة أو التوكن السري).");
      }

      const { sdk, db } = await this._ensureInitialized();
      this._role = "remote";
      this.roomCode = cleanRoom;
      this.hostToken = cleanToken;

      this._watchConnected(sdk, db, onConnectionState);

      const pubRef = sdk.dbMod.ref(db, `rooms/${cleanRoom}/publicState`);
      const privRef = sdk.dbMod.ref(db, `rooms/${cleanRoom}/hostPrivate/${cleanToken}`);

      this._unsubs.push(
        sdk.dbMod.onValue(
          pubRef,
          (snap) => {
            if (typeof onPublicState === "function") onPublicState(snap.val());
          },
          (err) => {
            if (typeof onError === "function") onError(err);
          }
        )
      );

      this._unsubs.push(
        sdk.dbMod.onValue(
          privRef,
          (snap) => {
            if (typeof onHostPrivate === "function") onHostPrivate(snap.val());
          },
          (err) => {
            if (typeof onError === "function") onError(err);
          }
        )
      );

      return this.getRoomInfo();
    }

    async sendHostCommand(type, payload = {}) {
      if (this._role !== "remote" || !this.roomCode || !this.hostToken || !this._sdk || !this._db) {
        return { ok: false, error: "غير متصل بالغرفة" };
      }
      const { dbMod } = this._sdk;
      const listRef = dbMod.ref(this._db, `rooms/${this.roomCode}/hostCommands/${this.hostToken}`);
      try {
        await dbMod.push(listRef, {
          type: String(type),
          payload: stripUndefined(payload),
          sentAt: dbMod.serverTimestamp(),
          deviceId: this.deviceId
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر إرسال الأمر" };
      }
    }

    /**
     * الاتصال كهاتف فريق / لاعب (?mode=player)
     */
    async connectAsPlayer({
      roomCode,
      onPublicState = null,
      onConnectionState = null,
      onError = null
    } = {}) {
      this._clearListeners();
      const cleanRoom = String(roomCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (cleanRoom.length < 4) {
        throw new Error("يرجى إدخال رمز غرفة صحيح (6 أحرف/أرقام).");
      }

      const { sdk, db } = await this._ensureInitialized();
      this._role = "player";
      this.roomCode = cleanRoom;
      this.hostToken = "";

      this._watchConnected(sdk, db, onConnectionState);

      const pubRef = sdk.dbMod.ref(db, `rooms/${cleanRoom}/publicState`);
      this._unsubs.push(
        sdk.dbMod.onValue(
          pubRef,
          (snap) => {
            if (typeof onPublicState === "function") onPublicState(snap.val());
          },
          (err) => {
            if (typeof onError === "function") onError(err);
          }
        )
      );

      return this.getRoomInfo();
    }

    async registerPlayerPresence(teamIdx, teamName) {
      if (this._role !== "player" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const pRef = dbMod.ref(this._db, `rooms/${this.roomCode}/players/${this.deviceId}`);
      try {
        await dbMod.onDisconnect(pRef).remove();
        await dbMod.set(pRef, {
          teamIdx: Number(teamIdx) || 0,
          teamName: String(teamName || "").slice(0, 32),
          uid: this._uid || "",
          joinedAt: dbMod.serverTimestamp()
        });
      } catch (_err) {}
    }

    async sendPlayerBuzz(buzzRoundId, teamIdx, teamName) {
      if (this._role !== "player" || !this.roomCode || !buzzRoundId || !this._sdk || !this._db) {
        return { ok: false };
      }
      const { dbMod } = this._sdk;
      const teamKey = `team-${Number(teamIdx) || 0}`;
      // استخدام مفتاح ثابت للفريق لمنع تعدد الضغطات من نفس الفريق في نفس الجولة
      const buzzRef = dbMod.ref(this._db, `rooms/${this.roomCode}/buzzes/${buzzRoundId}/${teamKey}`);
      try {
        await dbMod.set(buzzRef, {
          teamIdx: Number(teamIdx) || 0,
          teamName: String(teamName || "").slice(0, 32),
          deviceId: this.deviceId,
          uid: this._uid || "",
          ts: dbMod.serverTimestamp()
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر إرسال ضغطة الجرس" };
      }
    }

    async sendSecretWager(roundId, teamIdx, { amount, answerText = "", locked = true } = {}) {
      if (this._role !== "player" || !this.roomCode || !roundId || !this._sdk || !this._db) {
        return { ok: false };
      }
      const { dbMod } = this._sdk;
      const teamId = `team-${Number(teamIdx) || 0}`;
      const wRef = dbMod.ref(this._db, `rooms/${this.roomCode}/wagers/${roundId}/${teamId}`);
      try {
        await dbMod.set(wRef, {
          teamIdx: Number(teamIdx) || 0,
          amount: Math.max(0, Math.round(Number(amount) || 0)),
          answerText: typeof answerText === "string" ? answerText.trim().slice(0, 140) : "",
          locked: Boolean(locked),
          uid: this._uid || "",
          updatedAt: dbMod.serverTimestamp()
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر إرسال الرهان السري" };
      }
    }

    disconnect() {
      this._clearListeners();
      this._role = null;
      this.roomCode = "";
      this.hostToken = "";
      this.connected = false;
    }
  }

  window.SeenJeemRealtimeSync = new RealtimeSyncEngine();
  window.SeenJeemRealtimeUtils = {
    getUrlParams,
    getUrlMode,
    buildRoleUrl,
    generateRoomCode,
    generateHostToken
  };
})();
