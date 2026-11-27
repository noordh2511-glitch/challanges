/**
 * محرك الربط اللاسلكي الموحّد للألعاب السريعة (Quick Games Sync — Pack 17)
 * - يدعم الألعاب الثلاث تحت المسار المعزول: /quickRooms/{roomCode}
 *   1) البرق السريع: gameType = "blitz"  -> ?mode=blitz-player&room=CODE
 *   2) من غير كلام:  gameType = "mgk"    -> ?mode=mgk-player&room=CODE
 *   3) تحدي الصوت:   gameType = "audio"  -> ?mode=audio-player&room=CODE
 * - يحمي جلسة تسجيل الدخول بحساب Google: لا يستدعي signInAnonymously إلا عند auth.currentUser === null فقط.
 * - يمنع تسريب الإجابات والكلمات السرية وأسماء/روابط ملفات الصوت عبر تنقية صارمة لـ publicState
 *   وعزل الأسرار في privateActor/{uid} و privateJudge/{uid}.
 * - يطبّق Shallow Diffing ومزامنة المؤقت عبر .info/serverTimeOffset وتنظيف الغرف القديمة (>24 ساعة).
 */
(function () {
  "use strict";

  const FIREBASE_SDK_VER = "10.14.1";
  const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون O, 0, I, 1
  const OWNED_ROOMS_KEY = "quick-owned-rooms-v1";
  const STALE_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
  const ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
  const VALID_GAME_TYPES = new Set(["blitz", "mgk", "audio"]);

  const GAME_MODE_MAP = {
    blitz: "blitz-player",
    mgk: "mgk-player",
    audio: "audio-player"
  };

  function normalizeGameType(raw) {
    const t = String(raw || "").trim().toLowerCase();
    return VALID_GAME_TYPES.has(t) ? t : "blitz";
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

  function sanitizeKey(raw) {
    return (
      String(raw || "")
        .trim()
        .replace(/[.#$\[\]\/\s]+/g, "_")
        .slice(0, 48) || "default"
    );
  }

  function buildQuickPlayerUrl(gameType, roomCode) {
    const mode = GAME_MODE_MAP[normalizeGameType(gameType)] || "blitz-player";
    const cleanCode = String(roomCode || "").trim().toUpperCase();
    try {
      const u = new URL(window.location.href);
      u.search = "";
      u.hash = "";
      u.searchParams.set("mode", mode);
      if (cleanCode) u.searchParams.set("room", cleanCode);
      return u.toString();
    } catch (_err) {
      return `?mode=${mode}&room=${cleanCode}`;
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

  /**
   * منقّي منع التسريب الصارم (Anti-Spoiler) قبل إرسال publicState:
   * - يمنع وجود أي حقول سرية مثل secretWord / answer / audioUrl / audioSrc / fileName / explanation
   *   في الحالة العامة غير المكشوفة.
   */
  function sanitizeQuickPublicState(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const gameType = normalizeGameType(src.gameType);
    const phase = typeof src.phase === "string" ? src.phase : "setup";
    const isRevealed = phase === "revealed" || phase === "turn-summary" || phase === "summary" || phase === "finished";

    const clean = {
      gameType,
      phase,
      roundNumber: Number(src.roundNumber) || 0,
      totalRounds: Number(src.totalRounds) || 0,
      category: typeof src.category === "string" ? src.category.slice(0, 80) : "",
      categoryIcon: typeof src.categoryIcon === "string" ? src.categoryIcon.slice(0, 8) : "",
      wordCountLabel: typeof src.wordCountLabel === "string" ? src.wordCountLabel.slice(0, 40) : "",
      teams: Array.isArray(src.teams)
        ? src.teams.slice(0, 8).map((t, idx) => ({
            id: String((t && t.id) || `team-${idx}`),
            name: String((t && t.name) || `الفريق ${idx + 1}`).slice(0, 32),
            color: typeof (t && t.color) === "string" ? t.color : "",
            score: Number(t && t.score) || 0,
            correctCount: Number(t && (t.correctCount ?? t.guessedCount)) || 0,
            bestStreak: Number(t && t.bestStreak) || 0
          }))
        : [],
      freePlay: Boolean(src.freePlay),
      activeTeamIdx: Number.isInteger(src.activeTeamIdx) ? src.activeTeamIdx : 0,
      activeTeamName: typeof src.activeTeamName === "string" ? src.activeTeamName.slice(0, 40) : "",
      activeActorUid: typeof src.activeActorUid === "string" ? src.activeActorUid : "",
      activeActorName: typeof src.activeActorName === "string" ? src.activeActorName.slice(0, 32) : "",
      activeActorAvatar: typeof src.activeActorAvatar === "string" ? src.activeActorAvatar.slice(0, 8) : "",
      nextActorUid: typeof src.nextActorUid === "string" ? src.nextActorUid : "",
      nextActorName: typeof src.nextActorName === "string" ? src.nextActorName.slice(0, 32) : "",
      judgeUid: typeof src.judgeUid === "string" ? src.judgeUid : "",
      timer:
        src.timer && typeof src.timer === "object"
          ? {
              status: String(src.timer.status || "idle"),
              endAtMs: Number.isFinite(Number(src.timer.endAtMs)) ? Number(src.timer.endAtMs) : null,
              remainingMs: Number.isFinite(Number(src.timer.remainingMs)) ? Number(src.timer.remainingMs) : 0,
              durationSec: Number(src.timer.durationSec) || 60
            }
          : null,
      streak: Number(src.streak) || 0,
      skipsRemaining: src.skipsRemaining === null || src.skipsRemaining === undefined ? null : Number(src.skipsRemaining),
      hintText: typeof src.hintText === "string" ? src.hintText.slice(0, 200) : null,
      // نص السؤال مسموح فقط في البرق وتحدي الصوت (وليس كلمة التمثيل في من غير كلام)
      questionText:
        gameType === "mgk"
          ? null
          : typeof src.questionText === "string"
            ? src.questionText.slice(0, 320)
            : null,
      roundId: typeof src.roundId === "string" ? src.roundId : "",
      buzzerState:
        src.buzzerState && typeof src.buzzerState === "object"
          ? {
              status: String(src.buzzerState.status || "locked"), // open | buzzed | locked
              roundId: String(src.buzzerState.roundId || ""),
              winnerUid: src.buzzerState.winnerUid || null,
              winnerName: src.buzzerState.winnerName || "",
              winnerAvatar: src.buzzerState.winnerAvatar || "",
              winnerTeamId: src.buzzerState.winnerTeamId || "",
              winnerTeamName: src.buzzerState.winnerTeamName || ""
            }
          : { status: "locked", roundId: "", winnerUid: null, winnerName: "", winnerAvatar: "", winnerTeamId: "", winnerTeamName: "" },
      audioPlayback:
        gameType === "audio" && src.audioPlayback && typeof src.audioPlayback === "object"
          ? {
              playing: Boolean(src.audioPlayback.playing),
              mode: src.audioPlayback.mode === "standard" ? "standard" : "progressive",
              stageLevel: Number(src.audioPlayback.stageLevel) || 0,
              stageLabel: String(src.audioPlayback.stageLabel || ""),
              currentPoints: Number(src.audioPlayback.currentPoints) || 100
            }
          : null,
      // الإجابة المكشوفة لا تُمرّر مطلقاً إلا بعد الكشف الفعلي أو انتهاء الدور!
      revealedAnswer: isRevealed && typeof src.revealedAnswer === "string" ? src.revealedAnswer.slice(0, 220) : null,
      revealedExplanation: isRevealed && typeof src.revealedExplanation === "string" ? src.revealedExplanation.slice(0, 320) : null,
      revealedAnswerImage:
        isRevealed && typeof src.revealedAnswerImage === "string" && /^https?:\/\//i.test(src.revealedAnswerImage.trim())
          ? src.revealedAnswerImage.trim()
          : null,
      roundAwardedTeamName: isRevealed && typeof src.roundAwardedTeamName === "string" ? src.roundAwardedTeamName : null,
      roundAwardedPoints: isRevealed ? Number(src.roundAwardedPoints) || 0 : 0,
      pastItems: Array.isArray(src.pastItems)
        ? src.pastItems.slice(-20).map((it) => ({
            label: String((it && it.label) || "").slice(0, 120),
            answer: String((it && it.answer) || "").slice(0, 120),
            outcome: String((it && it.outcome) || "")
          }))
        : [],
      lastFeedback:
        src.lastFeedback && typeof src.lastFeedback === "object"
          ? { type: String(src.lastFeedback.type || ""), text: String(src.lastFeedback.text || "").slice(0, 120), ts: Number(src.lastFeedback.ts) || 0 }
          : null,
      winnerTitle: isRevealed && typeof src.winnerTitle === "string" ? src.winnerTitle.slice(0, 120) : null
    };

    return stripUndefined(clean);
  }

  function computeRemainingSeconds(timerObj, serverTimeOffsetMs = 0) {
    if (!timerObj || typeof timerObj !== "object") return 0;
    if (timerObj.status === "running" && Number.isFinite(Number(timerObj.endAtMs))) {
      const nowServer = Date.now() + (Number(serverTimeOffsetMs) || 0);
      return Math.max(0, Math.ceil((Number(timerObj.endAtMs) - nowServer) / 1000));
    }
    if (timerObj.status === "finished" || timerObj.status === "ended") return 0;
    if (Number.isFinite(Number(timerObj.remainingMs))) {
      return Math.max(0, Math.ceil(Number(timerObj.remainingMs) / 1000));
    }
    return Math.max(0, Math.floor(Number(timerObj.durationSec) || 0));
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

  function recordOwnedRoom(roomCode, ownerUid, gameType) {
    if (!roomCode) return;
    const now = Date.now();
    const list = loadOwnedRooms().filter((r) => r.roomCode !== roomCode);
    list.push({ roomCode, gameType: normalizeGameType(gameType), createdAt: now, lastActivityAt: now, ownerUid: ownerUid || "" });
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

  class QuickGamesSyncEngine {
    constructor() {
      this._sdk = null;
      this._app = null;
      this._auth = null;
      this._db = null;
      this._uid = null;
      this._activeConfigSignature = "";
      this._unsubs = [];
      this._role = null; // "master" | "player" | null
      this.gameType = null; // "blitz" | "mgk" | "audio"
      this.roomCode = "";
      this.connected = false;
      this._serverTimeOffsetMs = 0;
      this._lastPublicSig = "";
      this._lastActivityTouchMs = 0;
      this._kicked = false;
      this._lastPlayerInfo = null;
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
        gameType: this.gameType,
        roomCode: this.roomCode,
        uid: this._uid || "",
        connected: this.connected,
        playerUrl: this.roomCode && this.gameType ? buildQuickPlayerUrl(this.gameType, this.roomCode) : ""
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
        throw new Error("خدمة اللعب عبر الهواتف غير متاحة حالياً — تأكد من الاتصال بالإنترنت.");
      }
      if (!navigator.onLine) {
        throw new Error("لا يوجد اتصال بالإنترنت حالياً لفتح غرفة الهواتف.");
      }

      const sdk = await this._loadFirebaseSdk();
      const sig = `${roleTag}:${JSON.stringify(cfg)}`;

      if (!this._app || this._activeConfigSignature !== sig) {
        const isHostRole = roleTag === "host";
        // مشاركة تطبيق المضيف مع cloudSyncManager حتى لا تتأثر جلسة تسجيل الدخول بحساب Google
        const appName = isHostRole
          ? `seen-jeem-host-${sanitizeKey(cfg.projectId)}`
          : `seen-jeem-quick-${sanitizeKey(roleTag)}-${sanitizeKey(cfg.projectId)}`;
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
      // نقطة حرجة: لا نستدعي signInAnonymously إلا إذا كان auth.currentUser === null فقط لحماية جلسة Google
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
          const val = snap.val();
          if (typeof val === "number" && Number.isFinite(val)) {
            this._serverTimeOffsetMs = val;
          }
        })
      );
    }

    _maybeTouchRoomActivity() {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const now = Date.now();
      if (now - this._lastActivityTouchMs < ACTIVITY_TOUCH_INTERVAL_MS) return;
      this._lastActivityTouchMs = now;
      touchOwnedRoomLocal(this.roomCode);
      const ref = this._sdk.dbMod.ref(this._db, `quickRooms/${this.roomCode}/meta/lastActivityAt`);
      this._sdk.dbMod.set(ref, this._sdk.dbMod.serverTimestamp()).catch(() => {});
    }

    /* =========================================================
       وضع الجهاز الرئيسي (Host / Master)
       ========================================================= */
    async createRoom({
      gameType,
      initialPublicState = {},
      onPlayers,
      onBuzzes,
      onCommand,
      onConnectionState
    } = {}) {
      if (this.isActive()) {
        await this.closeRoom();
      }

      const cleanType = normalizeGameType(gameType);
      const { sdk, db, uid } = await this._ensureInitialized("host");
      this._clearListeners();

      const roomCode = generateRoomCode();
      const basePath = `quickRooms/${roomCode}`;
      const cleanPublic = sanitizeQuickPublicState({ ...initialPublicState, gameType: cleanType });

      await sdk.dbMod.set(sdk.dbMod.ref(db, `${basePath}/meta`), {
        gameType: cleanType,
        ownerUid: uid,
        judgeUid: null,
        activeActorUid: null,
        createdAt: sdk.dbMod.serverTimestamp(),
        lastActivityAt: sdk.dbMod.serverTimestamp(),
        joinLocked: false,
        hostOnline: true
      });
      await sdk.dbMod.set(sdk.dbMod.ref(db, `${basePath}/publicState`), cleanPublic);

      this._role = "master";
      this.gameType = cleanType;
      this.roomCode = roomCode;
      this.connected = true;
      this._lastPublicSig = JSON.stringify(cleanPublic);
      this._lastActivityTouchMs = Date.now();
      recordOwnedRoom(roomCode, uid, cleanType);

      // تتبع الاتصال وضبط hostOnline
      const hostOnlineRef = sdk.dbMod.ref(db, `${basePath}/meta/hostOnline`);
      const connRef = sdk.dbMod.ref(db, ".info/connected");
      this._unsubs.push(
        sdk.dbMod.onValue(connRef, (snap) => {
          const isConn = snap.val() === true;
          this.connected = isConn;
          if (isConn) {
            sdk.dbMod.onDisconnect(hostOnlineRef).set(false).catch(() => {});
            sdk.dbMod.set(hostOnlineRef, true).catch(() => {});
          }
          if (typeof onConnectionState === "function") onConnectionState(isConn);
        })
      );

      this._watchServerTimeOffset(sdk, db);

      // الاستماع للاعبين المنضمين
      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${basePath}/players`), (snap) => {
          if (typeof onPlayers === "function") onPlayers(snap.val() || {});
        })
      );

      // الاستماع لضغطات جرس السرعة
      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${basePath}/buzzes`), (snap) => {
          if (typeof onBuzzes === "function") onBuzzes(snap.val() || {});
        })
      );

      // الاستماع لأوامر هاتف الحكم أو الممثّل وتنفيذها ثم حذفها فوراً
      const cmdsRef = sdk.dbMod.ref(db, `${basePath}/commands`);
      this._unsubs.push(
        sdk.dbMod.onChildAdded(cmdsRef, (snap) => {
          const val = snap.val();
          const key = snap.key;
          if (key) {
            sdk.dbMod.remove(sdk.dbMod.ref(db, `${basePath}/commands/${key}`)).catch(() => {});
          }
          if (val && typeof val.type === "string" && typeof onCommand === "function") {
            onCommand(val);
          }
        })
      );

      // تنظيف صامت للغرف الخاملة (>24 ساعة)
      this.cleanupStaleOwnedRooms().catch(() => {});

      return {
        roomCode,
        gameType: cleanType,
        playerUrl: buildQuickPlayerUrl(cleanType, roomCode)
      };
    }

    async publishPublicState(rawState) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return { ok: false, skipped: true };
      const clean = sanitizeQuickPublicState({ ...rawState, gameType: this.gameType });
      const sig = JSON.stringify(clean);
      if (sig === this._lastPublicSig) return { ok: true, skipped: true };
      this._lastPublicSig = sig;
      this._maybeTouchRoomActivity();
      try {
        await this._sdk.dbMod.set(this._sdk.dbMod.ref(this._db, `quickRooms/${this.roomCode}/publicState`), clean);
        return { ok: true, skipped: false };
      } catch (_err) {
        return { ok: false };
      }
    }

    async updateMeta(patch = {}) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const clean = stripUndefined(patch);
      try {
        await this._sdk.dbMod.update(this._sdk.dbMod.ref(this._db, `quickRooms/${this.roomCode}/meta`), clean);
      } catch (_err) {}
    }

    async setJudgeUid(uid) {
      await this.updateMeta({ judgeUid: uid || null });
    }

    async setActiveActorUid(uid) {
      await this.updateMeta({ activeActorUid: uid || null });
    }

    async setJoinLocked(locked) {
      await this.updateMeta({ joinLocked: Boolean(locked) });
    }

    async setPrivateActorPayload(actorUid, payload) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const base = `quickRooms/${this.roomCode}/privateActor`;
      try {
        if (!actorUid || !payload) {
          await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, base));
          return;
        }
        const safeMap = {};
        safeMap[actorUid] = stripUndefined({
          roundId: String(payload.roundId || ""),
          word: String(payload.word || ""),
          category: String(payload.category || ""),
          wordCount: String(payload.wordCount || ""),
          points: Number(payload.points) || 100,
          hints: String(payload.hints || ""),
          explanation: String(payload.explanation || "")
        });
        await this._sdk.dbMod.set(this._sdk.dbMod.ref(this._db, base), safeMap);
      } catch (_err) {}
    }

    async setPrivateJudgePayload(judgeUid, payload) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      const base = `quickRooms/${this.roomCode}/privateJudge`;
      try {
        if (!judgeUid || !payload) {
          await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, base));
          return;
        }
        const safeMap = {};
        safeMap[judgeUid] = stripUndefined({
          roundId: String(payload.roundId || ""),
          question: String(payload.question || ""),
          answer: String(payload.answer || ""),
          explanation: String(payload.explanation || ""),
          category: String(payload.category || ""),
          points: Number(payload.points) || 100
        });
        await this._sdk.dbMod.set(this._sdk.dbMod.ref(this._db, base), safeMap);
      } catch (_err) {}
    }

    async clearBuzzes() {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db) return;
      try {
        await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, `quickRooms/${this.roomCode}/buzzes`));
      } catch (_err) {}
    }

    async kickPlayer(targetUid) {
      if (this._role !== "master" || !this.roomCode || !this._sdk || !this._db || !targetUid) return { ok: false };
      const base = `quickRooms/${this.roomCode}`;
      try {
        await this._sdk.dbMod.set(this._sdk.dbMod.ref(this._db, `${base}/kicked/${targetUid}`), true);
        await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, `${base}/players/${targetUid}`));
        await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, `${base}/privateActor/${targetUid}`));
        await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, `${base}/privateJudge/${targetUid}`));
        return { ok: true };
      } catch (_err) {
        return { ok: false };
      }
    }

    async closeRoom() {
      const code = this.roomCode;
      const role = this._role;
      this._clearListeners();
      if (role === "master" && code && this._sdk && this._db) {
        try {
          await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, `quickRooms/${code}`));
        } catch (_err) {}
        removeOwnedRoomLocal(code);
      } else if (role === "player" && code && this._sdk && this._db && this._uid) {
        try {
          await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, `quickRooms/${code}/players/${this._uid}`));
        } catch (_err) {}
      }
      this._role = null;
      this.gameType = null;
      this.roomCode = "";
      this.connected = false;
      this._lastPublicSig = "";
      this._kicked = false;
      this._lastPlayerInfo = null;
    }

    async cleanupStaleOwnedRooms() {
      const stale = getStaleOwnedRooms(this.roomCode);
      if (stale.length === 0) return 0;
      if (!this._sdk || !this._db) return 0;
      let removed = 0;
      for (const item of stale) {
        try {
          await this._sdk.dbMod.remove(this._sdk.dbMod.ref(this._db, `quickRooms/${item.roomCode}`));
          removeOwnedRoomLocal(item.roomCode);
          removed += 1;
        } catch (_err) {
          removeOwnedRoomLocal(item.roomCode);
        }
      }
      return removed;
    }

    /* =========================================================
       وضع هاتف اللاعب (Player)
       ========================================================= */
    async connectAsPlayer({
      gameType,
      roomCode,
      onMeta,
      onPublicState,
      onPlayers,
      onPrivateActor,
      onPrivateJudge,
      onKicked,
      onConnectionState,
      onRoomMissing
    } = {}) {
      const cleanType = normalizeGameType(gameType);
      const cleanCode = String(roomCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (cleanCode.length < 4) {
        throw new Error("يرجى إدخال رمز غرفة صحيح.");
      }

      const { sdk, db, uid } = await this._ensureInitialized(`player-${cleanType}`);
      this._clearListeners();
      this._kicked = false;

      const basePath = `quickRooms/${cleanCode}`;
      const metaSnap = await sdk.dbMod.get(sdk.dbMod.ref(db, `${basePath}/meta`));
      if (!metaSnap.exists()) {
        if (typeof onRoomMissing === "function") onRoomMissing();
        throw new Error("الغرفة غير موجودة أو تم إغلاقها من الشاشة الرئيسية.");
      }
      const metaVal = metaSnap.val() || {};
      if (metaVal.gameType && normalizeGameType(metaVal.gameType) !== cleanType) {
        throw new Error("رمز الغرفة هذا مخصّص للعبة أخرى — امسح الرمز الصحيح من الشاشة.");
      }

      const kickedSnap = await sdk.dbMod.get(sdk.dbMod.ref(db, `${basePath}/kicked/${uid}`));
      if (kickedSnap.exists()) {
        this._kicked = true;
        if (typeof onKicked === "function") onKicked();
        throw new Error("تم استبعاد هذا الجهاز من الغرفة.");
      }

      this._role = "player";
      this.gameType = cleanType;
      this.roomCode = cleanCode;
      this.connected = true;

      this._watchServerTimeOffset(sdk, db);

      // مراقبة حالة الاتصال وإعادة تسجيل الحضور تلقائياً بعد أي انقطاع عابر
      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, ".info/connected"), (snap) => {
          const isConn = snap.val() === true;
          this.connected = isConn;
          if (isConn && this._lastPlayerInfo && !this._kicked) {
            this.registerPlayer(this._lastPlayerInfo).catch(() => {});
          }
          if (typeof onConnectionState === "function") onConnectionState(isConn);
        })
      );

      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${basePath}/meta`), (snap) => {
          if (!snap.exists()) {
            if (typeof onRoomMissing === "function") onRoomMissing();
            return;
          }
          if (typeof onMeta === "function") onMeta(snap.val() || {});
        })
      );

      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${basePath}/publicState`), (snap) => {
          if (typeof onPublicState === "function") onPublicState(snap.val() || null);
        })
      );

      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${basePath}/players`), (snap) => {
          if (typeof onPlayers === "function") onPlayers(snap.val() || {});
        })
      );

      // الاستماع الخاص للممثّل (من غير كلام)
      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${basePath}/privateActor/${uid}`), (snap) => {
          if (typeof onPrivateActor === "function") onPrivateActor(snap.val() || null);
        })
      );

      // الاستماع الخاص للحكم (البرق السريع وتحدي الصوت)
      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${basePath}/privateJudge/${uid}`), (snap) => {
          if (typeof onPrivateJudge === "function") onPrivateJudge(snap.val() || null);
        })
      );

      // الاستماع للطرد
      this._unsubs.push(
        sdk.dbMod.onValue(sdk.dbMod.ref(db, `${basePath}/kicked/${uid}`), (snap) => {
          if (snap.exists()) {
            this._kicked = true;
            if (typeof onKicked === "function") onKicked();
          }
        })
      );

      return { uid, roomCode: cleanCode, gameType: cleanType, meta: metaVal };
    }

    async registerPlayer({ name, avatar = "🎯", teamId = "" } = {}) {
      if (this._role !== "player" || !this.roomCode || !this._sdk || !this._db || !this._uid) {
        return { ok: false, error: "لم يتم الاتصال بالغرفة بعد." };
      }
      if (this._kicked) return { ok: false, error: "تم استبعاد هذا الجهاز من الغرفة." };
      const cleanName = String(name || "").trim().slice(0, 26);
      if (!cleanName) return { ok: false, error: "يرجى كتابة اسمك أولاً." };
      const cleanAvatar = String(avatar || "🎯").trim().slice(0, 8) || "🎯";
      const cleanTeamId = String(teamId || "").trim().slice(0, 40);

      const playerRef = this._sdk.dbMod.ref(this._db, `quickRooms/${this.roomCode}/players/${this._uid}`);
      try {
        this._sdk.dbMod.onDisconnect(playerRef).remove().catch(() => {});
        await this._sdk.dbMod.set(playerRef, {
          uid: this._uid,
          name: cleanName,
          avatar: cleanAvatar,
          teamId: cleanTeamId,
          joinedAt: this._sdk.dbMod.serverTimestamp(),
          online: true
        });
        this._lastPlayerInfo = { name: cleanName, avatar: cleanAvatar, teamId: cleanTeamId };
        return { ok: true, uid: this._uid };
      } catch (_err) {
        return { ok: false, error: "تعذّر الانضمام — قد يكون باب الانضمام مقفلاً من الشاشة الرئيسية." };
      }
    }

    async pressBuzz({ name, avatar = "🎯", teamId = "", roundId = "" } = {}) {
      if (this._role !== "player" || !this.roomCode || !this._sdk || !this._db || !this._uid || this._kicked) {
        return { ok: false };
      }
      const ref = this._sdk.dbMod.ref(this._db, `quickRooms/${this.roomCode}/buzzes/${this._uid}`);
      try {
        await this._sdk.dbMod.set(ref, {
          uid: this._uid,
          name: String(name || "").trim().slice(0, 26),
          avatar: String(avatar || "🎯").trim().slice(0, 8),
          teamId: String(teamId || "").trim().slice(0, 40),
          roundId: String(roundId || ""),
          ts: this._sdk.dbMod.serverTimestamp()
        });
        return { ok: true };
      } catch (_err) {
        return { ok: false };
      }
    }

    async sendCommand(type, payload = {}) {
      if (this._role !== "player" || !this.roomCode || !this._sdk || !this._db || !this._uid || this._kicked) {
        return { ok: false };
      }
      const listRef = this._sdk.dbMod.ref(this._db, `quickRooms/${this.roomCode}/commands`);
      try {
        const newRef = this._sdk.dbMod.push(listRef);
        await this._sdk.dbMod.set(newRef, {
          type: String(type || ""),
          uid: this._uid,
          payload: stripUndefined(payload || {}),
          ts: this._sdk.dbMod.serverTimestamp()
        });
        return { ok: true };
      } catch (_err) {
        return { ok: false };
      }
    }
  }

  window.SeenJeemQuickGamesSync = new QuickGamesSyncEngine();
  window.SeenJeemQuickGamesSyncUtils = {
    OWNED_ROOMS_KEY,
    ROOM_ALPHABET,
    VALID_GAME_TYPES: Array.from(VALID_GAME_TYPES),
    normalizeGameType,
    generateRoomCode,
    buildQuickPlayerUrl,
    sanitizeQuickPublicState,
    computeRemainingSeconds
  };
})();
