/**
 * قناة المزامنة الفورية لوضع الشاشتين (Dual-Screen Host & TV Display Live Sync)
 * - تعتمد على BroadcastChannel('seen-jeem-live-sync') بدون أي خادم
 * - تحفظ لقطة منقّاة خفيفة في sessionStorage داخل نافذة العرض للاستعادة الفورية عند التحديث (F5)
 * - تدعم نبض الاتصال الحي (PING / PONG كل 3 ثوانٍ) وتوجيه الصوت (PLAY_SFX) والاحتفالات (TRIGGER_CONFETTI)
 * - تطبق بروتوكول منع تسريب الإجابات قطعياً (Strict Anti-Spoiler Protocol) على مستوى البيانات المرسلة
 */
(function () {
  "use strict";

  const CHANNEL_NAME = "seen-jeem-live-sync";
  const DISPLAY_SNAPSHOT_KEY = "seen_jeem_display_snapshot_v1";
  const AUDIO_ROUTE_KEY = "seen_jeem_dual_audio_route_v1";
  const HEARTBEAT_INTERVAL_MS = 3000;
  const HEARTBEAT_TIMEOUT_MS = 7500;

  function isDisplayModeUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return (params.get("mode") || "").trim().toLowerCase() === "display";
    } catch (_err) {
      return false;
    }
  }

  function buildDisplayWindowUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", "display");
      url.hash = "";
      return url.toString();
    } catch (_err) {
      return "?mode=display";
    }
  }

  function loadAudioRoutePreference() {
    try {
      const val = localStorage.getItem(AUDIO_ROUTE_KEY);
      return val === "host" ? "host" : "display";
    } catch (_err) {
      return "display";
    }
  }

  function saveAudioRoutePreference(route) {
    const clean = route === "host" ? "host" : "display";
    try {
      localStorage.setItem(AUDIO_ROUTE_KEY, clean);
    } catch (_err) {
      // تجاهل
    }
    return clean;
  }

  /**
   * حفظ لقطة منقّاة من الإجابات في sessionStorage داخل نافذة العرض للاستعادة الفورية عند التحديث
   */
  function saveDisplaySnapshotToSession(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    try {
      sessionStorage.setItem(DISPLAY_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (_err) {
      // تجاهل
    }
  }

  function loadDisplaySnapshotFromSession() {
    try {
      const raw = sessionStorage.getItem(DISPLAY_SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_err) {
      return null;
    }
  }

  function clearDisplaySnapshotFromSession() {
    try {
      sessionStorage.removeItem(DISPLAY_SNAPSHOT_KEY);
    } catch (_err) {
      // تجاهل
    }
  }

  /**
   * طبقة تنقية إضافية صارمة لمنع تسريب أي إجابة أو شرح أو تلميح غير مصرح به عبر القناة
   */
  function sanitizeSetupInfo(rawSetup) {
    if (!rawSetup || typeof rawSetup !== "object") return null;
    const rawNames = Array.isArray(rawSetup.teamNames)
      ? rawSetup.teamNames.filter((n) => typeof n === "string" && n.trim()).slice(0, 4)
      : [];
    const team1Name =
      typeof rawSetup.team1Name === "string" ? rawSetup.team1Name : rawNames[0] || "الفريق الأول";
    const team2Name =
      typeof rawSetup.team2Name === "string" ? rawSetup.team2Name : rawNames[1] || "الفريق الثاني";
    const teamNames = rawNames.length >= 2 ? rawNames : [team1Name, team2Name];
    return {
      team1Name,
      team2Name,
      teamNames,
      teamCount: teamNames.length,
      selectedCount: Number(rawSetup.selectedCount) || 0,
      message: typeof rawSetup.message === "string" ? rawSetup.message : ""
    };
  }

  function enforceAntiSpoilerOnSnapshot(rawSnapshot) {
    if (!rawSnapshot || typeof rawSnapshot !== "object") return null;

    const clean = {
      version: 1,
      sentAt: Date.now(),
      screen: rawSnapshot.screen || "setup", // "setup" | "board" | "question" | "final" | "winner"
      setupInfo: sanitizeSetupInfo(rawSnapshot.setupInfo),
      teams: Array.isArray(rawSnapshot.teams)
        ? rawSnapshot.teams.map((t) => ({
            id: t.id,
            name: t.name,
            score: Number(t.score) || 0,
            powerups: {
              doubleLeft: Number(t.powerups && t.powerups.doubleLeft) || 0,
              swapLeft: Number(t.powerups && t.powerups.swapLeft) || 0
            }
          }))
        : [],
      activeTurn: Number(rawSnapshot.activeTurn) || 0,
      doubleArmed: Boolean(rawSnapshot.doubleArmed),
      remainingPlayable: Number(rawSnapshot.remainingPlayable) || 0,
      totalSlots: Number(rawSnapshot.totalSlots) || 36,
      matchSettings: rawSnapshot.matchSettings || null,
      board: Array.isArray(rawSnapshot.board)
        ? rawSnapshot.board.map((bc) => ({
            category: {
              id: bc.category.id,
              name: bc.category.name,
              icon: bc.category.icon || "🎯",
              color: bc.category.color || "#06b6d4"
            },
            remainingInCat: Number(bc.remainingInCat) || 0,
            rightColumn: Array.isArray(bc.rightColumn)
              ? bc.rightColumn.map((s) => ({
                  points: Number(s.points) || 200,
                  played: Boolean(s.played),
                  winnerTeam: Number.isInteger(s.winnerTeam) ? s.winnerTeam : null,
                  recycled: Boolean(s.recycled),
                  hasQuestion: Boolean(s.hasQuestion)
                }))
              : [],
            leftColumn: Array.isArray(bc.leftColumn)
              ? bc.leftColumn.map((s) => ({
                  points: Number(s.points) || 200,
                  played: Boolean(s.played),
                  winnerTeam: Number.isInteger(s.winnerTeam) ? s.winnerTeam : null,
                  recycled: Boolean(s.recycled),
                  hasQuestion: Boolean(s.hasQuestion)
                }))
              : []
          }))
        : [],
      questionView: null,
      finalRoundView: null,
      blitzView: null,
      charadesSoloView: null,
      winnerView: rawSnapshot.winnerView || null,
      intermission:
        rawSnapshot.intermission && typeof rawSnapshot.intermission === "object"
          ? {
              active: Boolean(rawSnapshot.intermission.active),
              message:
                typeof rawSnapshot.intermission.message === "string" &&
                rawSnapshot.intermission.message.trim()
                  ? rawSnapshot.intermission.message.trim().slice(0, 120)
                  : "استراحة قصيرة — نعود بعد قليل",
              totalSeconds: Math.max(0, Math.floor(Number(rawSnapshot.intermission.totalSeconds) || 0)),
              remainingSeconds: Math.max(
                0,
                Math.floor(Number(rawSnapshot.intermission.remainingSeconds) || 0)
              )
            }
          : { active: false, message: "استراحة قصيرة — نعود بعد قليل", totalSeconds: 0, remainingSeconds: 0 },
      displayPrefs:
        rawSnapshot.displayPrefs && typeof rawSnapshot.displayPrefs === "object"
          ? {
              theme:
                rawSnapshot.displayPrefs.theme === "royal-gold" ||
                rawSnapshot.displayPrefs.theme === "high-contrast"
                  ? rawSnapshot.displayPrefs.theme
                  : "dark-glass",
              tvScale: Math.min(
                130,
                Math.max(90, Math.round((Number(rawSnapshot.displayPrefs.tvScale) || 100) / 5) * 5)
              )
            }
          : null,
      audioSettings:
        rawSnapshot.audioSettings && typeof rawSnapshot.audioSettings === "object"
          ? {
              volume: Number(rawSnapshot.audioSettings.volume),
              muted: Boolean(rawSnapshot.audioSettings.muted),
              categoryPrefs: rawSnapshot.audioSettings.categoryPrefs || null
            }
          : null,
      wireless:
        rawSnapshot.wireless && typeof rawSnapshot.wireless === "object"
          ? {
              active: Boolean(rawSnapshot.wireless.active),
              roomCode: typeof rawSnapshot.wireless.roomCode === "string" ? rawSnapshot.wireless.roomCode : "",
              playerUrl: typeof rawSnapshot.wireless.playerUrl === "string" ? rawSnapshot.wireless.playerUrl : "",
              showQrOnTv: Boolean(rawSnapshot.wireless.showQrOnTv),
              buzzer:
                rawSnapshot.wireless.buzzer && typeof rawSnapshot.wireless.buzzer === "object"
                  ? {
                      state: rawSnapshot.wireless.buzzer.state || "locked",
                      roundId: rawSnapshot.wireless.buzzer.roundId || "",
                      winnerTeamIdx: Number.isInteger(rawSnapshot.wireless.buzzer.winnerTeamIdx)
                        ? rawSnapshot.wireless.buzzer.winnerTeamIdx
                        : null,
                      winnerTeamName: rawSnapshot.wireless.buzzer.winnerTeamName || "",
                      runnerUpDeltaMs:
                        rawSnapshot.wireless.buzzer.runnerUpDeltaMs !== null &&
                        rawSnapshot.wireless.buzzer.runnerUpDeltaMs !== undefined
                          ? Number(rawSnapshot.wireless.buzzer.runnerUpDeltaMs)
                          : null
                    }
                  : null
            }
          : null
    };

    if (rawSnapshot.questionView && typeof rawSnapshot.questionView === "object") {
      const qv = rawSnapshot.questionView;
      const isDailyDouble = Boolean(qv.isDailyDouble);
      const dailyDoublePhase = isDailyDouble && qv.dailyDoublePhase === "wager" ? "wager" : "question";
      const isDailyDoubleWagerLocked = isDailyDouble && dailyDoublePhase === "wager";
      const allowAnswer = !isDailyDoubleWagerLocked && Boolean(qv.answerRevealed);
      const allowHint = !isDailyDoubleWagerLocked && Boolean(qv.hintRevealed);
      const isMemoryLocked =
        qv.visualType === "memory" &&
        (qv.memoryPhase === "ready" || qv.memoryPhase === "loading" || qv.memoryPhase === "viewing");

      clean.questionView = {
        categoryId: qv.categoryId || "",
        categoryName: qv.categoryName || "",
        categoryIcon: qv.categoryIcon || "🎯",
        categoryColor: qv.categoryColor || "#06b6d4",
        basePoints: Number(qv.basePoints) || 200,
        discountedBasePoints: Number(qv.discountedBasePoints) || Number(qv.basePoints) || 200,
        effectivePoints: Number(qv.effectivePoints) || Number(qv.basePoints) || 200,
        stealPoints: Number(qv.stealPoints) || 0,
        hintPenaltyPct: Number(qv.hintPenaltyPct) || 0,
        isDailyDouble,
        dailyDoublePhase,
        dailyDoubleWager: isDailyDouble ? Math.max(0, Number(qv.dailyDoubleWager) || 0) : 0,
        dailyDoubleMaxWager: isDailyDouble ? Math.max(0, Number(qv.dailyDoubleMaxWager) || 0) : 0,
        visualType: qv.visualType || "normal",
        isCharades: Boolean(qv.isCharades),
        charadesHeader:
          !isDailyDoubleWagerLocked && qv.isCharades && qv.charadesHeader ? qv.charadesHeader : null,
        phase: qv.phase || "answering", // "answering" | "steal-offer" | "steal-active" | "revealed" | "closing-preview"
        activeTeamAtOpen: Number(qv.activeTeamAtOpen) || 0,
        stealingTeamIdx: Number.isInteger(qv.stealingTeamIdx) ? qv.stealingTeamIdx : 0,
        doubleActive: Boolean(qv.doubleActive),
        hintRevealed: allowHint,
        answerRevealed: allowAnswer,

        // منع التسريب القطعي: لا يُمرَّر نص السؤال في مرحلة رهان المربع الذهبي ولا في وضع الذاكرة قبل انتهاء المعاينة ولا نص من غير كلام الخام
        questionText:
          isDailyDoubleWagerLocked || qv.isCharades || isMemoryLocked
            ? null
            : typeof qv.questionText === "string"
              ? qv.questionText
              : "",
        questionImage:
          isDailyDoubleWagerLocked ||
          (qv.visualType === "memory" && (qv.memoryPhase === "ready" || qv.memoryPhase === "question"))
            ? null
            : qv.questionImage || null,
        images: isDailyDoubleWagerLocked ? null : Array.isArray(qv.images) ? qv.images.slice() : null,
        showPlus: Boolean(qv.showPlus),
        differencesCount: qv.differencesCount || null,
        blurLevel: qv.blurLevel || 18,
        halfBlur: qv.halfBlur || 9,
        blurReduced: Boolean(qv.blurReduced),
        zoomLevel: qv.zoomLevel || 3.8,
        halfZoom: qv.halfZoom || 2,
        zoomOrigin: qv.zoomOrigin || "center",
        zoomReduced: Boolean(qv.zoomReduced),

        // حالة المؤقت الحي (متطابقة لحظياً مع المقدّم)
        timerRemaining: Math.max(0, Number(qv.timerRemaining) || 0),
        timerMax: Math.max(1, Number(qv.timerMax) || 60),
        timerMode: qv.timerMode || "main",
        timerRunning: Boolean(qv.timerRunning),
        charadesDuration: Number(qv.charadesDuration) || 60,
        charadesTimerStarted: Boolean(qv.charadesTimerStarted),
        memoryPhase: qv.memoryPhase || null,
        memoryRemaining: Math.max(0, Number(qv.memoryRemaining) || 0),
        memoryTotal: Math.max(1, Number(qv.memoryTotal) || 10),

        // لا يُمرَّر hint إلا بعد كشفه صراحةً من المقدّم
        hintText: allowHint && typeof qv.hintText === "string" ? qv.hintText : null,

        // لا تُمرَّر الإجابة أو الشرح أو صورة الإجابة أبداً إلا بعد كشفها صراحةً على الشاشة
        answerText: allowAnswer && typeof qv.answerText === "string" ? qv.answerText : null,
        explanationText:
          allowAnswer && typeof qv.explanationText === "string" ? qv.explanationText : null,
        answerImage: allowAnswer && typeof qv.answerImage === "string" ? qv.answerImage : null
      };
    }

    if (rawSnapshot.finalRoundView && typeof rawSnapshot.finalRoundView === "object") {
      const fv = rawSnapshot.finalRoundView;
      const phase =
        fv.phase === "question" || fv.phase === "reveal" ? fv.phase : "wager";
      const allowQuestion = phase === "question" || phase === "reveal";
      const allowReveal = phase === "reveal";

      clean.finalRoundView = {
        phase,
        triggerReason: fv.triggerReason || "tie-breaker",
        roundNumber: Number(fv.roundNumber) || 1,
        category: fv.category || { id: "", name: "", icon: "🏆", color: "#f59e0b" },
        timerRemaining: Number(fv.timerRemaining) || 0,
        timerMax: Number(fv.timerMax) || 60,
        timerRunning: Boolean(fv.timerRunning),
        stillTiedAfterReveal: allowReveal ? Boolean(fv.stillTiedAfterReveal) : false,
        participants: Array.isArray(fv.participants)
          ? fv.participants.map((p) => ({
              teamIdx: Number(p.teamIdx) || 0,
              teamId: p.teamId || "",
              name: p.name || "",
              score: Number(p.score) || 0,
              locked: Boolean(p.locked),
              wager: allowReveal && p.wager !== null ? Number(p.wager) || 0 : null,
              correct: allowReveal && p.correct !== null ? Boolean(p.correct) : null,
              rawDelta: allowReveal && p.rawDelta !== null ? Number(p.rawDelta) || 0 : null,
              effectiveDelta:
                allowReveal && p.effectiveDelta !== null ? Number(p.effectiveDelta) || 0 : null,
              prevScore: allowReveal && p.prevScore !== null ? Number(p.prevScore) || 0 : null,
              nextScore: allowReveal && p.nextScore !== null ? Number(p.nextScore) || 0 : null
            }))
          : [],
        questionText: allowQuestion && typeof fv.questionText === "string" ? fv.questionText : null,
        answerText: allowReveal && typeof fv.answerText === "string" ? fv.answerText : null,
        explanationText:
          allowReveal && typeof fv.explanationText === "string" ? fv.explanationText : null
      };
    }

    if (rawSnapshot.blitzView && typeof rawSnapshot.blitzView === "object") {
      const bv = rawSnapshot.blitzView;
      clean.blitzView = {
        mode: "blitz",
        phase: bv.phase || "ready",
        durationSeconds: Number(bv.durationSeconds) || 60,
        roundsPerTeam: Number(bv.roundsPerTeam) || 1,
        currentRoundForTeam: Number(bv.currentRoundForTeam) || 1,
        activeTeamIdx: Number(bv.activeTeamIdx) || 0,
        activeTeamName: bv.activeTeamName || "",
        activeTeamScore: Number(bv.activeTeamScore) || 0,
        teams: Array.isArray(bv.teams) ? bv.teams : [],
        timerRemaining: Number(bv.timerRemaining) || 0,
        timerMax: Number(bv.timerMax) || 60,
        timerRunning: Boolean(bv.timerRunning),
        currentStreak: Number(bv.currentStreak) || 0,
        lastFeedback: bv.lastFeedback || null,
        questionText: bv.phase === "playing" && typeof bv.questionText === "string" ? bv.questionText : null,
        categoryName: bv.phase === "playing" && typeof bv.categoryName === "string" ? bv.categoryName : null,
        categoryIcon: bv.categoryIcon || "⚡",
        turnSummary: bv.phase === "turn-summary" && Array.isArray(bv.turnSummary) ? bv.turnSummary : []
      };
    }

    if (rawSnapshot.charadesSoloView && typeof rawSnapshot.charadesSoloView === "object") {
      const cv = rawSnapshot.charadesSoloView;
      clean.charadesSoloView = {
        mode: "charades",
        phase: cv.phase || "ready",
        durationSeconds: Number(cv.durationSeconds) || 90,
        roundsPerTeam: Number(cv.roundsPerTeam) || 3,
        currentRoundForTeam: Number(cv.currentRoundForTeam) || 1,
        activeTeamIdx: Number(cv.activeTeamIdx) || 0,
        activeTeamName: cv.activeTeamName || "",
        activeTeamScore: Number(cv.activeTeamScore) || 0,
        teams: Array.isArray(cv.teams) ? cv.teams : [],
        timerRemaining: Number(cv.timerRemaining) || 0,
        timerMax: Number(cv.timerMax) || 90,
        timerRunning: Boolean(cv.timerRunning),
        lastFeedback: cv.lastFeedback || null,
        header: cv.phase === "playing" && cv.header ? cv.header : null,
        categoryName: cv.phase === "playing" && typeof cv.categoryName === "string" ? cv.categoryName : null,
        // منع تسريب الكلمة أو explanation نهائياً؛ التلميح فقط عند كشفه صراحةً
        hintText: cv.phase === "playing" && typeof cv.hintText === "string" ? cv.hintText : null,
        turnSummary: cv.phase === "turn-summary" && Array.isArray(cv.turnSummary) ? cv.turnSummary : []
      };
    }

    return clean;
  }

  class LiveSyncManager {
    constructor() {
      /** @type {BroadcastChannel | null} */
      this._channel = null;
      this._role = isDisplayModeUrl() ? "display" : "host";
      this._instanceId = `${this._role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      this._listeners = new Set();
      this._connected = false;
      this._lastPongAt = 0;
      this._heartbeatInterval = null;
      this._watchdogInterval = null;
      this._displayWindowRef = null;
      this._connectionCallbacks = new Set();
      this._audioRoute = loadAudioRoutePreference();
      this._supported = typeof window.BroadcastChannel === "function";
    }

    isSupported() {
      return this._supported;
    }

    isDisplayMode() {
      return this._role === "display";
    }

    isConnected() {
      return this._connected;
    }

    getAudioRoute() {
      return this._audioRoute;
    }

    setAudioRoute(route) {
      this._audioRoute = saveAudioRoutePreference(route);
      return this._audioRoute;
    }

    _setConnected(nextState) {
      const clean = Boolean(nextState);
      if (this._connected === clean) return;
      this._connected = clean;
      this._connectionCallbacks.forEach((cb) => {
        try {
          cb(clean);
        } catch (_err) {
          // تجاهل
        }
      });
    }

    onConnectionChange(cb) {
      if (typeof cb === "function") {
        this._connectionCallbacks.add(cb);
      }
      return () => this._connectionCallbacks.delete(cb);
    }

    onMessage(cb) {
      if (typeof cb === "function") {
        this._listeners.add(cb);
      }
      return () => this._listeners.delete(cb);
    }

    connect() {
      if (!this._supported) return false;
      if (this._channel) return true;

      try {
        this._channel = new BroadcastChannel(CHANNEL_NAME);
        this._channel.onmessage = (event) => {
          const msg = event && event.data;
          if (!msg || typeof msg !== "object" || msg.senderId === this._instanceId) {
            return;
          }

          if (this._role === "host") {
            if (msg.type === "PONG" || msg.type === "SYNC_REQUEST") {
              this._lastPongAt = Date.now();
              this._setConnected(true);
            } else if (msg.type === "DISPLAY_CLOSED") {
              this._lastPongAt = 0;
              this._setConnected(false);
            }
          } else if (this._role === "display") {
            if (msg.type === "PING") {
              this._lastPongAt = Date.now();
              this._setConnected(true);
              this.post("PONG", { ts: Date.now() });
            } else if (msg.type === "STATE_SYNC") {
              this._lastPongAt = Date.now();
              this._setConnected(true);
              if (msg.payload) {
                saveDisplaySnapshotToSession(msg.payload);
              }
            }
          }

          this._listeners.forEach((cb) => {
            try {
              cb(msg);
            } catch (_err) {
              // تجاهل
            }
          });
        };

        if (this._role === "host") {
          this._startHostHeartbeat();
        }
        return true;
      } catch (_err) {
        this._supported = false;
        return false;
      }
    }

    _startHostHeartbeat() {
      this._stopTimers();
      this.post("PING", { ts: Date.now() });

      this._heartbeatInterval = setInterval(() => {
        this.post("PING", { ts: Date.now() });
        if (this._connected && Date.now() - this._lastPongAt > HEARTBEAT_TIMEOUT_MS) {
          this._setConnected(false);
        }
      }, HEARTBEAT_INTERVAL_MS);

      this._watchdogInterval = setInterval(() => {
        if (this._connected && Date.now() - this._lastPongAt > HEARTBEAT_TIMEOUT_MS) {
          this._setConnected(false);
        }
      }, 2000);
    }

    _stopTimers() {
      if (this._heartbeatInterval) {
        clearInterval(this._heartbeatInterval);
        this._heartbeatInterval = null;
      }
      if (this._watchdogInterval) {
        clearInterval(this._watchdogInterval);
        this._watchdogInterval = null;
      }
    }

    post(type, payload = null) {
      if (!this._channel) return false;
      try {
        this._channel.postMessage({
          type,
          senderId: this._instanceId,
          role: this._role,
          ts: Date.now(),
          payload
        });
        return true;
      } catch (_err) {
        return false;
      }
    }

    /**
     * فتح نافذة شاشة العرض التلفزيوني (?mode=display) أو التركيز عليها إن كانت مفتوحة
     */
    openDisplayWindow() {
      const url = buildDisplayWindowUrl();
      if (this._displayWindowRef && !this._displayWindowRef.closed) {
        try {
          this._displayWindowRef.focus();
          this.post("PING", { ts: Date.now() });
          return { ok: true, reused: true };
        } catch (_err) {
          // إعادة الفتح
        }
      }

      const win = window.open(
        url,
        "seen_jeem_tv_display",
        "width=1280,height=760,menubar=no,toolbar=no,location=no,status=no"
      );
      if (!win) {
        return { ok: false, blocked: true };
      }
      this._displayWindowRef = win;
      return { ok: true, reused: false };
    }

    closeDisplayWindow() {
      this.post("CLOSE_DISPLAY", { ts: Date.now() });
      if (this._displayWindowRef && !this._displayWindowRef.closed) {
        try {
          this._displayWindowRef.close();
        } catch (_err) {
          // تجاهل
        }
      }
      this._displayWindowRef = null;
      this._lastPongAt = 0;
      this._setConnected(false);
    }

    /**
     * إرسال لقطة الحالة المنقّاة من الإجابات (Strict Anti-Spoiler) من المقدّم إلى شاشة العرض
     */
    broadcastState(rawSnapshot) {
      if (this._role !== "host" || !this._channel) return null;
      const safeSnapshot = enforceAntiSpoilerOnSnapshot(rawSnapshot);
      if (!safeSnapshot) return null;
      this.post("STATE_SYNC", safeSnapshot);
      return safeSnapshot;
    }

    broadcastSfx(method, args = []) {
      if (this._role !== "host" || !this._channel) return false;
      return this.post("PLAY_SFX", { method, args });
    }

    broadcastAudioSettings(settings) {
      if (this._role !== "host" || !this._channel) return false;
      return this.post("SYNC_AUDIO_SETTINGS", settings);
    }

    broadcastDisplayPrefs(prefs) {
      if (this._role !== "host" || !this._channel) return false;
      return this.post("SYNC_DISPLAY_PREFS", prefs);
    }

    broadcastConfetti(kind = "victory", theme = "default") {
      if (this._role !== "host" || !this._channel) return false;
      return this.post("TRIGGER_CONFETTI", { kind, theme });
    }

    requestSyncFromHost() {
      if (this._role !== "display" || !this._channel) return false;
      this.post("PONG", { ts: Date.now() });
      return this.post("SYNC_REQUEST", { ts: Date.now() });
    }

    notifyDisplayClosing() {
      if (this._role !== "display" || !this._channel) return;
      this.post("DISPLAY_CLOSED", { ts: Date.now() });
    }

    getCachedDisplaySnapshot() {
      return loadDisplaySnapshotFromSession();
    }

    clearCachedDisplaySnapshot() {
      clearDisplaySnapshotFromSession();
    }

    enforceAntiSpoiler(rawSnapshot) {
      return enforceAntiSpoilerOnSnapshot(rawSnapshot);
    }

    destroy() {
      this._stopTimers();
      if (this._role === "display") {
        this.notifyDisplayClosing();
      }
      if (this._channel) {
        try {
          this._channel.close();
        } catch (_err) {
          // تجاهل
        }
        this._channel = null;
      }
    }
  }

  window.SeenJeemLiveSync = new LiveSyncManager();
})();
