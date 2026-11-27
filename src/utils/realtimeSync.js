/**
 * محرك المزامنة اللاسلكية عبر Firebase Realtime Database (Phase 4 — Pack 9 & Pack 10)
 * - يستورد Firebase Modular SDK (v10) ديناميكياً عند تفعيل الغرفة فقط (صفر طلبات شبكة في الوضع المحلي!)
 * - عزل الصور الثقيلة (Media Isolation): منع DataURL داخل publicState/hostPrivate ورفعها مرة واحدة في media/{mediaKey}
 * - مزامنة المؤقتات بالطوابع الزمنية (.info/serverTimeOffset + endAtMs) دون أي كتابة كل ثانية
 * - تقليص حجم الحزم ومنع الكتابة المكررة (Shallow Diffing) + عدّاد استهلاك الجلسة التشخيصي (KB وعدد الكتابات)
 * - تنظيف تلقائي للغرف الخاملة (>24 ساعة) عبر سجل محلي آمن (seen-jeem-owned-rooms-v1) وحماية الانقطاع المؤقت
 * - تتبّع الأجهزة المتصلة (Presence) وقفل الانضمام وحدّ الأجهزة لكل فريق والطرد الفوري (Kick Device)
 */
(function () {
  "use strict";

  const FIREBASE_SDK_VER = "10.14.1";
  const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون O, 0, I, 1 لتجنب الالتباس
  const DEVICE_ID_KEY = "seen_jeem_wireless_device_id_v1";
  const OWNED_ROOMS_STORAGE_KEY = "seen-jeem-owned-rooms-v1";
  const STALE_ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 ساعة
  const ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // حد أقصى مرة كل 5 دقائق

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
    if (m === "display" || m === "remote" || m === "player" || m === "bara-player" || m === "mafia-player") return m;
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

  function isDataUrlImage(val) {
    return typeof val === "string" && /^data:image\//i.test(val.trim());
  }

  function isDataUrlAudio(val) {
    return typeof val === "string" && /^data:audio\//i.test(val.trim());
  }

  function isAnyHeavyDataUrl(val) {
    return isDataUrlImage(val) || isDataUrlAudio(val);
  }

  function sanitizeFirebaseKey(raw) {
    const cleaned = String(raw || "")
      .trim()
      .replace(/[.#$\[\]\/\s]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    return cleaned || `k_${Date.now().toString(36)}`;
  }

  function quickHashString(str) {
    let h = 2166136261;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function estimateUtf8Bytes(str) {
    if (typeof str !== "string" || !str) return 0;
    try {
      if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(str).length;
      }
      return new Blob([str]).size;
    } catch (_err) {
      return str.length * 2;
    }
  }

  /**
   * حساب الثواني المتبقية محلياً بدقة بالاعتماد على endAtMs + .info/serverTimeOffset دون أي كتابة كل ثانية
   */
  function computeTimerRemainingSeconds(timerObj, fallbackRemaining = 0, serverTimeOffsetMs = 0) {
    if (timerObj && typeof timerObj === "object") {
      if (timerObj.status === "unlimited") return null;
      if (timerObj.status === "running" && Number.isFinite(timerObj.endAtMs)) {
        const nowServer = Date.now() + (Number(serverTimeOffsetMs) || 0);
        return Math.max(0, Math.ceil((Number(timerObj.endAtMs) - nowServer) / 1000));
      }
      if (timerObj.status === "finished" || timerObj.status === "ended") {
        return 0;
      }
      if (Number.isFinite(timerObj.remainingMs)) {
        return Math.max(0, Math.ceil(Number(timerObj.remainingMs) / 1000));
      }
    }
    return Math.max(0, Math.floor(Number(fallbackRemaining) || 0));
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

  /**
   * طبقة أمان أخيرة تمنع تسرّب أي DataURL ثقيل داخل publicState أو hostPrivate
   */
  function stripAnyDataUrlsDeep(obj) {
    if (typeof obj === "string") {
      return isAnyHeavyDataUrl(obj) ? null : obj;
    }
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) {
      return obj.map((item) => stripAnyDataUrlsDeep(item));
    }
    const out = {};
    Object.keys(obj).forEach((k) => {
      const val = obj[k];
      if (val !== undefined) {
        out[k] = stripAnyDataUrlsDeep(val);
      }
    });
    return out;
  }

  /**
   * فصل صور DataURL الثقيلة من questionView إلى حزمة media مستقلة
   * - صور السؤال -> media/q_<questionId>
   * - صورة الإجابة (بعد الكشف فقط!) -> media/ans_<questionId>
   * - الصوت DataURL يُزال كلياً من publicState ولا يُرفع إلى Firebase أو هواتف الفرق
   */
  function isolateQuestionMedia(publicState) {
    if (!publicState || typeof publicState !== "object" || publicState.screen !== "question" || !publicState.questionView) {
      return { mediaKey: "", mediaPayload: null, mediaSig: "", answerMediaKey: "", answerMediaPayload: null, answerMediaSig: "" };
    }
    const qv = publicState.questionView;
    // عدم تمرير أي رابط أو DataURL صوتي ثقيل داخل Firebase publicState
    if (qv.audioChallenge && typeof qv.audioChallenge === "object") {
      qv.audioChallenge.audioSrc = null;
    }

    const hasQImgData = isDataUrlImage(qv.questionImage);
    const hasAnsImgData = Boolean(qv.answerRevealed) && isDataUrlImage(qv.answerImage);
    const hasMultiData = Array.isArray(qv.images) && qv.images.some((item) => isDataUrlImage(item));

    if (!hasQImgData && !hasAnsImgData && !hasMultiData) {
      if (isDataUrlImage(qv.answerImage)) qv.answerImage = null;
      qv.hasMedia = false;
      qv.mediaKey = null;
      qv.answerMediaKey = null;
      return { mediaKey: "", mediaPayload: null, mediaSig: "", answerMediaKey: "", answerMediaPayload: null, answerMediaSig: "" };
    }

    const rawId =
      (typeof qv.questionId === "string" && qv.questionId.trim()) ||
      `${qv.categoryId || "cat"}_${qv.basePoints || 200}_${quickHashString(
        (qv.questionText || "") + "|" + (qv.visualType || "normal")
      )}`;
    const cleanId = sanitizeFirebaseKey(rawId);

    let mediaKey = "";
    let mediaPayload = null;
    let mediaSig = "";
    if (hasQImgData || hasMultiData) {
      mediaKey = `q_${cleanId}`;
      mediaPayload = { mediaKey };
      const sigParts = [mediaKey];
      if (hasQImgData) {
        mediaPayload.questionImage = qv.questionImage;
        qv.questionImage = null;
        sigParts.push("q:" + mediaPayload.questionImage.length);
      }
      if (hasMultiData) {
        mediaPayload.images = qv.images.slice();
        qv.images = qv.images.map((item) => (isDataUrlImage(item) ? null : item));
        sigParts.push("m:" + mediaPayload.images.length + ":" + mediaPayload.images.reduce((s, x) => s + (x ? x.length : 0), 0));
      }
      mediaSig = sigParts.join("|");
    }

    let answerMediaKey = "";
    let answerMediaPayload = null;
    let answerMediaSig = "";
    if (hasAnsImgData) {
      answerMediaKey = `ans_${cleanId}`;
      answerMediaPayload = { mediaKey: answerMediaKey, answerImage: qv.answerImage };
      answerMediaSig = `${answerMediaKey}:${qv.answerImage.length}`;
      qv.answerImage = null;
    } else if (isDataUrlImage(qv.answerImage)) {
      qv.answerImage = null;
    }

    qv.hasMedia = Boolean(mediaKey || answerMediaKey);
    qv.mediaKey = mediaKey || null;
    qv.answerMediaKey = answerMediaKey || null;
    qv.mediaFields = {
      questionImage: hasQImgData,
      answerImage: hasAnsImgData,
      images: hasMultiData
    };

    return {
      mediaKey,
      mediaPayload,
      mediaSig,
      answerMediaKey,
      answerMediaPayload,
      answerMediaSig
    };
  }

  /**
   * تقليص حزمة publicState المرسلة إلى Firebase RTDB وحذف الحقول غير اللازمة أو المتغيرة كل ثانية
   */
  function buildCompactFirebasePublicState(rawPublicState) {
    if (!rawPublicState || typeof rawPublicState !== "object") return null;

    // نسخ خفيف حتى لا نعدّل كائن BroadcastChannel المحلي
    const pub = stripUndefined(rawPublicState);

    // حذف الحقول غير اللازمة للريموت وهواتف الفرق أو التي تسبب فروقات كاذبة
    delete pub.sentAt;
    delete pub.audioSettings;
    delete pub.displayPrefs;
    delete pub.undoStack;
    delete pub.matchEvents;

    // تقليص winnerView بحذف سجل التحليلات الضخم غير المستخدم في الهواتف
    if (pub.winnerView && typeof pub.winnerView === "object") {
      pub.winnerView = {
        winnerIdx: pub.winnerView.winnerIdx !== undefined ? pub.winnerView.winnerIdx : null,
        leaderIndices: Array.isArray(pub.winnerView.leaderIndices) ? pub.winnerView.leaderIndices : [],
        eyebrow: pub.winnerView.eyebrow || "",
        title: pub.winnerView.title || "",
        teams: Array.isArray(pub.winnerView.teams)
          ? pub.winnerView.teams.map((t) => ({ id: t.id, name: t.name, score: Number(t.score) || 0 }))
          : []
      };
    }

    // تقليص matchSettings إلى الضروري فقط
    if (pub.matchSettings && typeof pub.matchSettings === "object") {
      pub.matchSettings = {
        teamCount: Number(pub.matchSettings.teamCount) || 2,
        stealEnabled: Boolean(pub.matchSettings.stealEnabled),
        hintEnabled: Boolean(pub.matchSettings.hintEnabled),
        mainTimerSeconds: Number(pub.matchSettings.mainTimerSeconds) || 0,
        stealTimerSeconds: Number(pub.matchSettings.stealTimerSeconds) || 15
      };
    }

    // استقرار حقول المؤقت أثناء العدّ (يُعتمد على timer.endAtMs فقط دون كتابة كل ثانية)
    const stabilizeTimerHolder = (holder, remField = "timerRemaining", timerField = "timer") => {
      if (!holder || typeof holder !== "object") return;
      const t = holder[timerField];
      if (t && typeof t === "object") {
        if (t.status === "running") {
          holder[remField] = Math.max(0, Math.ceil((Number(t.remainingMs) || 0) / 1000));
        } else if (t.status === "finished" || t.status === "ended" || t.status === "unlimited") {
          holder[remField] = 0;
        } else if (Number.isFinite(t.remainingMs)) {
          holder[remField] = Math.max(0, Math.ceil(Number(t.remainingMs) / 1000));
        }
      }
    };

    if (pub.questionView) {
      stabilizeTimerHolder(pub.questionView, "timerRemaining", "timer");
      stabilizeTimerHolder(pub.questionView, "memoryRemaining", "memoryTimer");
    }
    if (pub.finalRoundView) {
      stabilizeTimerHolder(pub.finalRoundView, "timerRemaining", "timer");
    }
    if (pub.blitzView) {
      stabilizeTimerHolder(pub.blitzView, "timerRemaining", "timer");
      // حذف ملخص الأسئلة الطويل إذا لم نكن في turn-summary
      if (pub.blitzView.phase !== "turn-summary") {
        pub.blitzView.turnSummary = [];
      }
    }
    if (pub.charadesSoloView) {
      stabilizeTimerHolder(pub.charadesSoloView, "timerRemaining", "timer");
      if (pub.charadesSoloView.phase !== "turn-summary") {
        pub.charadesSoloView.turnSummary = [];
      }
    }
    if (pub.audioChallengeView && typeof pub.audioChallengeView === "object") {
      // منع تسريب الإجابة أو أي مسار صوتي داخل Firebase publicState
      delete pub.audioChallengeView.audioSrc;
      delete pub.audioChallengeView.audioUrl;
      if (pub.audioChallengeView.phase !== "revealed") {
        pub.audioChallengeView.revealedAnswer = null;
        pub.audioChallengeView.revealedExplanation = null;
        pub.audioChallengeView.revealedAnswerImage = null;
      }
    }
    if (pub.intermission) {
      stabilizeTimerHolder(pub.intermission, "remainingSeconds", "timer");
    }

    // عزل صور DataURL الثقيلة من questionView
    const mediaInfo = isolateQuestionMedia(pub);

    // منع قاطع لأي DataURL متبقٍ داخل publicState
    const safePub = stripAnyDataUrlsDeep(pub);
    return {
      publicState: safePub,
      mediaInfo
    };
  }

  function buildCompactHostPrivate(rawHostPrivate) {
    if (!rawHostPrivate || typeof rawHostPrivate !== "object") return null;
    const priv = stripUndefined(rawHostPrivate);
    delete priv.updatedAt; // منع الفروقات الكاذبة في Shallow Diffing
    return stripAnyDataUrlsDeep(priv);
  }

  /* =========================================================
     سجل الغرف المملوكة محلياً (seen-jeem-owned-rooms-v1) للتنظيف الآمن
     ========================================================= */
  function loadOwnedRooms() {
    try {
      const raw = localStorage.getItem(OWNED_ROOMS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && typeof item.roomCode === "string" && item.roomCode.length >= 4);
    } catch (_err) {
      return [];
    }
  }

  function saveOwnedRooms(list) {
    try {
      localStorage.setItem(OWNED_ROOMS_STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    } catch (_err) {}
  }

  function recordOwnedRoom(roomCode, ownerUid) {
    if (!roomCode) return;
    const now = Date.now();
    const list = loadOwnedRooms().filter((r) => r.roomCode !== roomCode);
    list.push({
      roomCode,
      createdAt: now,
      lastActivityAt: now,
      ownerUid: ownerUid || ""
    });
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
    const list = loadOwnedRooms().filter((r) => r.roomCode !== roomCode);
    saveOwnedRooms(list);
  }

  function getStaleOwnedRooms(excludeRoomCode = "") {
    const now = Date.now();
    return loadOwnedRooms().filter((r) => {
      if (excludeRoomCode && r.roomCode === excludeRoomCode) return false;
      const refTime = Number(r.lastActivityAt) || Number(r.createdAt) || 0;
      return refTime > 0 && now - refTime > STALE_ROOM_TTL_MS;
    });
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

      // طابع زمن الخادم (.info/serverTimeOffset)
      this._serverTimeOffsetMs = 0;

      // عزل الصور وكاش القراءة
      this._activeMediaKey = "";
      this._uploadedMediaSig = "";
      this._activeAnswerMediaKey = "";
      this._uploadedAnswerMediaSig = "";
      this._mediaCache = new Map();

      // Shallow Diffing & Session Bandwidth Diagnostics
      this._lastPublicSig = "";
      this._lastHostPrivateSig = "";
      this._stats = { writes: 0, skippedWrites: 0, bytesSent: 0, mediaUploads: 0 };
      this._onStatsUpdate = null;

      // التنظيف والنشاط والأجهزة المعتمدة
      this._lastActivityTouchMs = 0;
      this._approvedDevices = new Set();
      this._lastPlayerPresence = null;
      this._kicked = false;
    }

    isConfigured() {
      return Boolean(window.SeenJeemFirebaseConfig && window.SeenJeemFirebaseConfig.isConfigured());
    }

    isActive() {
      return Boolean(this._role && this.roomCode);
    }

    getServerTimeOffsetMs() {
      return Number(this._serverTimeOffsetMs) || 0;
    }

    getServerNowMs() {
      return Date.now() + this.getServerTimeOffsetMs();
    }

    getSessionStats() {
      const bytes = Number(this._stats.bytesSent) || 0;
      return {
        writes: this._stats.writes,
        skippedWrites: this._stats.skippedWrites,
        bytesSent: bytes,
        kbSent: Number((bytes / 1024).toFixed(2)),
        mediaUploads: this._stats.mediaUploads
      };
    }

    _resetSessionTrackers() {
      this._activeMediaKey = "";
      this._uploadedMediaSig = "";
      this._activeAnswerMediaKey = "";
      this._uploadedAnswerMediaSig = "";
      this._lastPublicSig = "";
      this._lastHostPrivateSig = "";
      this._stats = { writes: 0, skippedWrites: 0, bytesSent: 0, mediaUploads: 0 };
      this._lastActivityTouchMs = 0;
      this._approvedDevices = new Set();
      this._lastPlayerPresence = null;
      this._kicked = false;
      this._mediaCache.clear();
    }

    _recordWrite(payloadOrJson, { isMedia = false } = {}) {
      const json = typeof payloadOrJson === "string" ? payloadOrJson : JSON.stringify(payloadOrJson || {});
      this._stats.writes += 1;
      this._stats.bytesSent += estimateUtf8Bytes(json);
      if (isMedia) this._stats.mediaUploads += 1;
      if (typeof this._onStatsUpdate === "function") {
        try {
          this._onStatsUpdate(this.getSessionStats());
        } catch (_err) {}
      }
    }

    getRoomInfo() {
      return {
        active: this.isActive(),
        role: this._role,
        roomCode: this.roomCode,
        hostToken: this.hostToken,
        connected: this.connected,
        deviceId: this.deviceId,
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
        throw new Error("تعذّر تفعيل غرفة اللعب حالياً — تأكد من الاتصال بالإنترنت.");
      }

      if (!navigator.onLine) {
        throw new Error("لا يوجد اتصال بالإنترنت حالياً لتفعيل الغرفة اللاسلكية.");
      }

      const sdk = await this._loadFirebaseSdk();
      const sig = JSON.stringify(cfg);

      if (!this._app || this._activeConfigSignature !== sig) {
        const mode = getUrlMode();
        const isHostMode = mode === "host";
        // في وضع المقدّم: مشاركة نفس Firebase App مع cloudSyncManager لضمان تعايش GoogleAuthProvider مع الغرف اللاسلكية
        const appName = isHostMode
          ? `seen-jeem-host-${sanitizeFirebaseKey(cfg.projectId || "default")}`
          : `seen-jeem-rt-${mode}-${sanitizeFirebaseKey(cfg.projectId || "default")}`;
        const existingApp = sdk.appMod.getApps().find((a) => a.name === appName);
        if (this._app && !isHostMode && this._app.name !== appName) {
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
      // نقطة حرجة: لا نستدعي signInAnonymously إلا إذا كان auth.currentUser === null لحماية جلسة Google للمقدّم
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
      const offsetRef = sdk.dbMod.ref(db, ".info/serverTimeOffset");
      const unsub = sdk.dbMod.onValue(offsetRef, (snap) => {
        const val = snap.val();
        if (typeof val === "number" && Number.isFinite(val)) {
          this._serverTimeOffsetMs = val;
        }
      });
      this._unsubs.push(unsub);
    }

    _watchConnected(sdk, db, onConnectionState) {
      const connRef = sdk.dbMod.ref(db, ".info/connected");
      const unsub = sdk.dbMod.onValue(connRef, (snap) => {
        const isConn = Boolean(snap.val());
        this.connected = isConn;

        // إعادة تسليح onDisconnect وضبط hostOnline = true عند عودة الاتصال للجهاز الرئيسي
        if (isConn && this._role === "master" && this.roomCode) {
          this._armMasterPresence(sdk, db, this.roomCode).catch(() => {});
        }
        // إعادة تسجيل حضور اللاعب تلقائياً عند تذبذب الإنترنت (بشرط ألا يكون مطروداً)
        if (isConn && this._role === "player" && this.roomCode && this._lastPlayerPresence && !this._kicked) {
          const lp = this._lastPlayerPresence;
          this.registerPlayerPresence(lp.teamIdx, lp.teamName, lp.label).catch(() => {});
        }

        if (typeof onConnectionState === "function") onConnectionState(isConn);
      });
      this._unsubs.push(unsub);
    }

    async _armMasterPresence(sdk, db, roomCode) {
      const metaRef = sdk.dbMod.ref(db, `rooms/${roomCode}/meta`);
      try {
        // حماية الانقطاع العابر: لا نحذف الغرفة عند انقطاع الإنترنت؛ نضبط hostOnline = false فقط
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

    _maybeTouchLastActivity() {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const now = Date.now();
      if (now - this._lastActivityTouchMs < ACTIVITY_TOUCH_INTERVAL_MS) return;
      this._lastActivityTouchMs = now;
      touchOwnedRoomLocal(this.roomCode);
      const { dbMod } = this._sdk;
      dbMod
        .update(dbMod.ref(this._db, `rooms/${this.roomCode}/meta`), {
          lastActivityAt: dbMod.serverTimestamp()
        })
        .catch(() => {});
    }

    /**
     * التنظيف الآمن للغرف الخاملة (>24 ساعة) المملوكة لهذا الجهاز فقط دون قراءة جذر /rooms
     */
    async cleanupStaleOwnedRooms({ silent = true } = {}) {
      const stale = getStaleOwnedRooms(this.roomCode);
      if (stale.length === 0) return { cleaned: 0, attempted: 0 };
      if (!this.isConfigured() || !navigator.onLine) {
        return { cleaned: 0, attempted: 0 };
      }

      let cleaned = 0;
      try {
        const { sdk, db } = await this._ensureInitialized();
        for (const entry of stale) {
          try {
            await sdk.dbMod.remove(sdk.dbMod.ref(db, `rooms/${entry.roomCode}`));
            removeOwnedRoomLocal(entry.roomCode);
            cleaned += 1;
          } catch (err) {
            const msg = String((err && (err.code || err.message)) || "").toLowerCase();
            // إذا رُفضت الصلاحية (غرفة محذوفة أو تغير uid) نزيلها من القائمة المحلية حتى لا نعيد المحاولة للأبد
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
      return { cleaned, attempted: stale.length };
    }

    async testConnection(configOverride = null) {
      try {
        const { uid } = await this._ensureInitialized(configOverride);
        return {
          ok: true,
          uid,
          message: "تم التحقق من الاتصال بنجاح!"
        };
      } catch (err) {
        return {
          ok: false,
          error: "تعذّر الاتصال حالياً، تأكد من الإنترنت وحاول مجدداً."
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
      onAllPlayAnswers = null,
      onPlayers = null,
      onConnectionState = null,
      onStatsUpdate = null
    } = {}) {
      await this.closeRoom();
      const { sdk, db, uid } = await this._ensureInitialized();

      // تنظيف أي غرف قديمة مملوكة لهذا الجهاز مرّ عليها أكثر من 24 ساعة بصمت
      this.cleanupStaleOwnedRooms({ silent: true }).catch(() => {});

      this._resetSessionTrackers();
      this._onStatsUpdate = typeof onStatsUpdate === "function" ? onStatsUpdate : null;

      const roomCode = generateRoomCode();
      const hostToken = generateHostToken();
      const roomPath = `rooms/${roomCode}`;

      // 1) كتابة البيانات الوصفية أولاً لتمكين قواعد الأمان فوراً
      const metaPayload = {
        ownerUid: uid,
        hostToken,
        createdAt: sdk.dbMod.serverTimestamp(),
        lastActivityAt: sdk.dbMod.serverTimestamp(),
        hostOnline: true,
        joinLocked: false,
        maxDevicesPerTeam: 0,
        appVersion: "4.10.0"
      };
      await sdk.dbMod.set(sdk.dbMod.ref(db, `${roomPath}/meta`), metaPayload);
      this._recordWrite(metaPayload);
      this._lastActivityTouchMs = Date.now();
      recordOwnedRoom(roomCode, uid);

      this._role = "master";
      this.roomCode = roomCode;
      this.hostToken = hostToken;

      // 2) تفعيل حماية الانقطاع المؤقت عبر onDisconnect (بدون حذف الغرفة!)
      await this._armMasterPresence(sdk, db, roomCode);

      // 3) كتابة الحالة الأولية المنقّاة والمقلّصة
      await this.publishStates(initialPublicState, initialHostPrivate);

      // 4) مراقبة الاتصال وطابع زمن الخادم
      this._watchServerTimeOffset(sdk, db);
      this._watchConnected(sdk, db, onConnectionState);

      // الاستماع لطابور أوامر ريموت المقدّم
      const cmdRef = sdk.dbMod.ref(db, `${roomPath}/hostCommands/${hostToken}`);
      const unsubCmd = sdk.dbMod.onChildAdded(cmdRef, (snap) => {
        const cmdId = snap.key;
        const cmdVal = snap.val();
        sdk.dbMod.remove(sdk.dbMod.ref(db, `${roomPath}/hostCommands/${hostToken}/${cmdId}`)).catch(() => {});
        if (cmdVal && typeof onCommand === "function") {
          this._maybeTouchLastActivity();
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

      // الاستماع لإجابات «الكل يجاوب» الواردة سراً إلى الجهاز الرئيسي فقط
      const allPlayRef = sdk.dbMod.ref(db, `${roomPath}/allPlayAnswers`);
      const unsubAllPlay = sdk.dbMod.onValue(allPlayRef, (snap) => {
        if (typeof onAllPlayAnswers === "function") onAllPlayAnswers(snap.val() || {});
      });
      this._unsubs.push(unsubAllPlay);

      return this.getRoomInfo();
    }

    async publishStates(rawPublicState, rawHostPrivate) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const roomPath = `rooms/${this.roomCode}`;
      const tasks = [];
      let didWrite = false;

      if (rawPublicState) {
        const compact = buildCompactFirebasePublicState(rawPublicState);
        if (compact) {
          const { publicState, mediaInfo } = compact;

          // إدارة عقدة media/ المعزولة (رفع مرة واحدة عند فتح السؤال، وحذف السابقة عند الإغلاق/التغيير)
          if (mediaInfo.mediaKey && mediaInfo.mediaPayload) {
            if (this._activeMediaKey && this._activeMediaKey !== mediaInfo.mediaKey) {
              const staleKey = this._activeMediaKey;
              tasks.push(dbMod.remove(dbMod.ref(this._db, `${roomPath}/media/${staleKey}`)).catch(() => {}));
            }
            if (mediaInfo.mediaSig !== this._uploadedMediaSig) {
              this._activeMediaKey = mediaInfo.mediaKey;
              this._uploadedMediaSig = mediaInfo.mediaSig;
              const mediaJson = JSON.stringify(mediaInfo.mediaPayload);
              tasks.push(
                dbMod
                  .set(dbMod.ref(this._db, `${roomPath}/media/${mediaInfo.mediaKey}`), mediaInfo.mediaPayload)
                  .then(() => this._recordWrite(mediaJson, { isMedia: true }))
              );
              didWrite = true;
            }
          } else if (this._activeMediaKey) {
            const staleKey = this._activeMediaKey;
            this._activeMediaKey = "";
            this._uploadedMediaSig = "";
            tasks.push(dbMod.remove(dbMod.ref(this._db, `${roomPath}/media/${staleKey}`)).catch(() => {}));
          }

          // إدارة عقدة media/ans_<questionId> المعزولة لصورة الإجابة عند الكشف فقط
          if (mediaInfo.answerMediaKey && mediaInfo.answerMediaPayload) {
            if (this._activeAnswerMediaKey && this._activeAnswerMediaKey !== mediaInfo.answerMediaKey) {
              const staleAnsKey = this._activeAnswerMediaKey;
              tasks.push(dbMod.remove(dbMod.ref(this._db, `${roomPath}/media/${staleAnsKey}`)).catch(() => {}));
            }
            if (mediaInfo.answerMediaSig !== this._uploadedAnswerMediaSig) {
              this._activeAnswerMediaKey = mediaInfo.answerMediaKey;
              this._uploadedAnswerMediaSig = mediaInfo.answerMediaSig;
              const ansJson = JSON.stringify(mediaInfo.answerMediaPayload);
              tasks.push(
                dbMod
                  .set(dbMod.ref(this._db, `${roomPath}/media/${mediaInfo.answerMediaKey}`), mediaInfo.answerMediaPayload)
                  .then(() => this._recordWrite(ansJson, { isMedia: true }))
              );
              didWrite = true;
            }
          } else if (this._activeAnswerMediaKey) {
            const staleAnsKey = this._activeAnswerMediaKey;
            this._activeAnswerMediaKey = "";
            this._uploadedAnswerMediaSig = "";
            tasks.push(dbMod.remove(dbMod.ref(this._db, `${roomPath}/media/${staleAnsKey}`)).catch(() => {}));
          }

          // Shallow Diffing لـ publicState لمنع الكتابات المكررة
          const pubJson = JSON.stringify(publicState);
          if (pubJson !== this._lastPublicSig) {
            this._lastPublicSig = pubJson;
            tasks.push(
              dbMod
                .set(dbMod.ref(this._db, `${roomPath}/publicState`), publicState)
                .then(() => this._recordWrite(pubJson))
            );
            didWrite = true;
          } else {
            this._stats.skippedWrites += 1;
          }
        }
      }

      if (rawHostPrivate && this.hostToken) {
        const cleanPriv = buildCompactHostPrivate(rawHostPrivate);
        if (cleanPriv) {
          const privJson = JSON.stringify(cleanPriv);
          if (privJson !== this._lastHostPrivateSig) {
            this._lastHostPrivateSig = privJson;
            tasks.push(
              dbMod
                .set(dbMod.ref(this._db, `${roomPath}/hostPrivate/${this.hostToken}`), cleanPriv)
                .then(() => this._recordWrite(privJson))
            );
            didWrite = true;
          } else {
            this._stats.skippedWrites += 1;
          }
        }
      }

      if (tasks.length === 0) return;

      try {
        await Promise.all(tasks);
        if (didWrite) this._maybeTouchLastActivity();
      } catch (_err) {
        // استمر بسلاسة دون كسر اللعب المحلي
      }
    }

    async updateRoomControl({ joinLocked, maxDevicesPerTeam } = {}) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const patch = {};
      if (typeof joinLocked === "boolean") patch.joinLocked = joinLocked;
      if (maxDevicesPerTeam !== undefined) {
        patch.maxDevicesPerTeam = Number(maxDevicesPerTeam) === 1 ? 1 : 0;
      }
      if (Object.keys(patch).length === 0) return;
      try {
        await dbMod.update(dbMod.ref(this._db, `rooms/${this.roomCode}/meta`), patch);
        this._recordWrite(patch);
        this._maybeTouchLastActivity();
      } catch (_err) {}
    }

    /**
     * اعتماد جهاز منضم قبل قفل الغرفة كي يتمكن من تحديث الصفحة (F5) بسلاسة أثناء القفل
     */
    async approveDevice(deviceId) {
      if (this._role !== "master" || !this.roomCode || !deviceId || !this._sdk || !this._db) return;
      const cleanId = sanitizeFirebaseKey(deviceId);
      if (this._approvedDevices.has(cleanId)) return;
      this._approvedDevices.add(cleanId);
      const { dbMod } = this._sdk;
      try {
        await dbMod.set(dbMod.ref(this._db, `rooms/${this.roomCode}/allowedDevices/${cleanId}`), true);
        this._recordWrite({ [cleanId]: true });
      } catch (_err) {
        this._approvedDevices.delete(cleanId);
      }
    }

    /**
     * طرد جهاز متصل: حذف players/{deviceId} وallowedDevices/{deviceId} وكتابة kicked/{deviceId}: true
     */
    async kickPlayer(deviceId) {
      if (this._role !== "master" || !this.roomCode || !deviceId || !this._sdk || !this._db) {
        return { ok: false };
      }
      const cleanId = String(deviceId).trim();
      if (!cleanId) return { ok: false };
      this._approvedDevices.delete(cleanId);
      const { dbMod } = this._sdk;
      const updates = {
        [`players/${cleanId}`]: null,
        [`allowedDevices/${cleanId}`]: null,
        [`kicked/${cleanId}`]: true
      };
      try {
        await dbMod.update(dbMod.ref(this._db, `rooms/${this.roomCode}`), updates);
        this._recordWrite(updates);
        this._maybeTouchLastActivity();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر طرد الجهاز" };
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

    async clearAllPlayAnswers(questionId) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const qKey = questionId ? sanitizeFirebaseKey(questionId) : "";
      const path = qKey
        ? `rooms/${this.roomCode}/allPlayAnswers/${qKey}`
        : `rooms/${this.roomCode}/allPlayAnswers`;
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
      this._resetSessionTrackers();

      if (prevRole === "master" && prevRoom && this._sdk && this._db) {
        const { dbMod } = this._sdk;
        try {
          await dbMod.onDisconnect(dbMod.ref(this._db, `rooms/${prevRoom}/meta`)).cancel();
        } catch (_err) {}
        try {
          await dbMod.remove(dbMod.ref(this._db, `rooms/${prevRoom}`));
        } catch (_err) {}
        removeOwnedRoomLocal(prevRoom);
      }
    }

    /**
     * جلب صورة سؤال معزولة مرة واحدة عبر get() مع كاش ذاكرة مؤقت (Map) — لا يُستدعى أبداً من playerView.js
     */
    async fetchMedia(mediaKey) {
      if (!mediaKey || !this.roomCode || !this._sdk || !this._db) return null;
      if (this._role === "player") return null; // عزل قاطع لهواتف الفرق عن تنزيل الصور
      if (this._mediaCache.has(mediaKey)) {
        return this._mediaCache.get(mediaKey);
      }
      const { dbMod } = this._sdk;
      try {
        const snap = await dbMod.get(dbMod.ref(this._db, `rooms/${this.roomCode}/media/${mediaKey}`));
        const val = snap && snap.exists() ? snap.val() : null;
        if (val) {
          this._mediaCache.set(mediaKey, val);
          // احتفظ بحد أقصى معقول في كاش الذاكرة
          if (this._mediaCache.size > 16) {
            const firstKey = this._mediaCache.keys().next().value;
            this._mediaCache.delete(firstKey);
          }
        }
        return val;
      } catch (_err) {
        return null;
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
      onPlayers = null,
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

      this._watchServerTimeOffset(sdk, db);
      this._watchConnected(sdk, db, onConnectionState);

      const pubRef = sdk.dbMod.ref(db, `rooms/${cleanRoom}/publicState`);
      const privRef = sdk.dbMod.ref(db, `rooms/${cleanRoom}/hostPrivate/${cleanToken}`);
      const playersRef = sdk.dbMod.ref(db, `rooms/${cleanRoom}/players`);

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

      if (typeof onPlayers === "function") {
        this._unsubs.push(
          sdk.dbMod.onValue(
            playersRef,
            (snap) => onPlayers(snap.val() || {}),
            () => {}
          )
        );
      }

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
     * الاتصال كهاتف فريق / لاعب (?mode=player) — معزول تماماً عن عقدة media/
     */
    async connectAsPlayer({
      roomCode,
      onPublicState = null,
      onPlayers = null,
      onKicked = null,
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
      this._kicked = false;
      this._lastPlayerPresence = null;

      // 1) فحص فوري ومراقبة حية لحالة الطرد kicked/{deviceId}
      const kickRef = sdk.dbMod.ref(db, `rooms/${cleanRoom}/kicked/${this.deviceId}`);
      this._unsubs.push(
        sdk.dbMod.onValue(
          kickRef,
          (snap) => {
            if (snap.val() === true) {
              this._kicked = true;
              this.disconnect();
              if (typeof onKicked === "function") onKicked();
            }
          },
          () => {}
        )
      );

      this._watchServerTimeOffset(sdk, db);
      this._watchConnected(sdk, db, onConnectionState);

      // 2) الاشتراك بـ publicState فقط (بدون media/ إطلاقاً!)
      const pubRef = sdk.dbMod.ref(db, `rooms/${cleanRoom}/publicState`);
      this._unsubs.push(
        sdk.dbMod.onValue(
          pubRef,
          (snap) => {
            if (this._kicked) return;
            if (typeof onPublicState === "function") onPublicState(snap.val());
          },
          (err) => {
            if (typeof onError === "function") onError(err);
          }
        )
      );

      // 3) الاشتراك بقائمة الأجهزة الخفيفة لمعرفة حد الأجهزة لكل فريق
      if (typeof onPlayers === "function") {
        const playersRef = sdk.dbMod.ref(db, `rooms/${cleanRoom}/players`);
        this._unsubs.push(
          sdk.dbMod.onValue(
            playersRef,
            (snap) => {
              if (this._kicked) return;
              onPlayers(snap.val() || {});
            },
            () => {}
          )
        );
      }

      return this.getRoomInfo();
    }

    async isCurrentDevicePreApproved() {
      if (this._role !== "player" || !this.roomCode || !this._sdk || !this._db) return false;
      const { dbMod } = this._sdk;
      try {
        const snap = await dbMod.get(
          dbMod.ref(this._db, `rooms/${this.roomCode}/allowedDevices/${this.deviceId}`)
        );
        return Boolean(snap && snap.exists() && snap.val() === true);
      } catch (_err) {
        return false;
      }
    }

    async registerPlayerPresence(teamIdx, teamName, label = "") {
      if (this._role !== "player" || !this.roomCode || !this._sdk || !this._db || this._kicked) {
        return { ok: false, error: "غير متصل بالغرفة" };
      }
      const { dbMod } = this._sdk;
      const idx = Number(teamIdx) || 0;
      const cleanLabel = (typeof label === "string" ? label.trim() : "").slice(0, 24) || "جهاز 1";
      const pRef = dbMod.ref(this._db, `rooms/${this.roomCode}/players/${this.deviceId}`);
      this._lastPlayerPresence = { teamIdx: idx, teamName: String(teamName || ""), label: cleanLabel };
      try {
        // نكتب العقدة أولاً حتى تتحقق قاعدة data.child('uid').val() === auth.uid قبل تسجيل onDisconnect().remove()
        await dbMod.set(pRef, {
          deviceId: this.deviceId,
          uid: this._uid || "",
          teamId: `team-${idx}`,
          teamIdx: idx,
          teamName: String(teamName || "").slice(0, 32),
          label: cleanLabel,
          joinedAt: dbMod.serverTimestamp(),
          online: true
        });
        try {
          await dbMod.onDisconnect(pRef).remove();
        } catch (_odErr) {}
        return { ok: true };
      } catch (err) {
        const msg = String((err && (err.code || err.message)) || "").toLowerCase();
        if (msg.includes("permission") || msg.includes("denied")) {
          return { ok: false, locked: true, error: "🔒 الغرفة مقفلة حالياً من قِبل المقدّم" };
        }
        return { ok: false, error: (err && err.message) || "تعذّر تسجيل الجهاز في الغرفة" };
      }
    }

    async unregisterPlayerPresence() {
      this._lastPlayerPresence = null;
      if (this._role !== "player" || !this.roomCode || !this._sdk || !this._db) return;
      const { dbMod } = this._sdk;
      const pRef = dbMod.ref(this._db, `rooms/${this.roomCode}/players/${this.deviceId}`);
      try {
        await dbMod.remove(pRef);
      } catch (_err) {}
    }

    async sendPlayerBuzz(buzzRoundId, teamIdx, teamName) {
      if (this._role !== "player" || !this.roomCode || !buzzRoundId || !this._sdk || !this._db || this._kicked) {
        return { ok: false };
      }
      const { dbMod } = this._sdk;
      const teamKey = `team-${Number(teamIdx) || 0}`;
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
      if (this._role !== "player" || !this.roomCode || !roundId || !this._sdk || !this._db || this._kicked) {
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
          deviceId: this.deviceId,
          uid: this._uid || "",
          updatedAt: dbMod.serverTimestamp()
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر إرسال الرهان السري" };
      }
    }

    async sendAllPlayAnswer(questionId, teamIdx, text) {
      if (this._role !== "player" || !this.roomCode || !questionId || !this._sdk || !this._db || this._kicked) {
        return { ok: false, error: "غير متصل بالغرفة" };
      }
      const cleanText = typeof text === "string" ? text.trim().slice(0, 140) : "";
      if (!cleanText) {
        return { ok: false, error: "يرجى كتابة إجابة أولاً." };
      }
      const { dbMod } = this._sdk;
      const qKey = sanitizeFirebaseKey(questionId);
      const teamId = `team-${Number(teamIdx) || 0}`;
      const aRef = dbMod.ref(this._db, `rooms/${this.roomCode}/allPlayAnswers/${qKey}/${teamId}`);
      try {
        await dbMod.set(aRef, {
          teamIdx: Number(teamIdx) || 0,
          text: cleanText,
          submittedAt: dbMod.serverTimestamp(),
          deviceId: this.deviceId,
          uid: this._uid || ""
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err && err.message) || "تعذّر إرسال الإجابة" };
      }
    }

    disconnect() {
      this._clearListeners();
      this._role = null;
      this.roomCode = "";
      this.hostToken = "";
      this.connected = false;
      this._lastPlayerPresence = null;
      this._mediaCache.clear();
    }
  }

  window.SeenJeemRealtimeSync = new RealtimeSyncEngine();
  window.SeenJeemRealtimeUtils = {
    OWNED_ROOMS_STORAGE_KEY,
    getUrlParams,
    getUrlMode,
    buildRoleUrl,
    generateRoomCode,
    generateHostToken,
    isDataUrlImage,
    computeTimerRemainingSeconds
  };
})();
