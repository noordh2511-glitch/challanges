/**
 * طور «تحدي الصوت» المستقل (Standalone Audio Challenge Mode — Pack 15 & Pack 17)
 * - آلة حالات من 4 مراحل: setup -> playing -> revealed -> summary
 * - بطاقة QR Code مدمجة عبر quickGamesSync.js (/quickRooms/{roomCode}) + زر «📺 وضع العرض الكامل»
 * - الشاشة الرئيسية تشغّل الصوت مركزياً (منع الصدى)، وفور ضغط أي لاعب على جرس السرعة يتوقف الصوت تلقائياً (Auto-Pause)
 * - هاتف الحكم الاختياري (judgeUid) يرى الإجابة السرية من privateJudge/{uid} فقط ويتحكم بالصوت والتحكيم
 * - منع تسريب مطلق: لا يُرسل answer أو answerImage أو audioUrl أو اسم الملف إلى publicState أو شاشة العرض قبل الكشف
 */
(function () {
  "use strict";

  const HISTORY_STORAGE_KEY = "audio-challenge-history-v1";
  const TEAM_COLORS = ["#22d3ee", "#fbbf24", "#34d399", "#e879f9", "#fb7185", "#60a5fa"];
  const DEFAULT_TEAM_NAMES = [
    "الفريق الأول",
    "الفريق الثاني",
    "الفريق الثالث",
    "الفريق الرابع",
    "الفريق الخامس",
    "الفريق السادس"
  ];

  const PROGRESSIVE_STAGES = Object.freeze([
    { id: "s3", level: 0, seconds: 3, points: 300, label: "3 ثوانٍ (+300)" },
    { id: "s7", level: 1, seconds: 7, points: 200, label: "7 ثوانٍ (+200)" },
    { id: "full", level: 2, seconds: null, points: 100, label: "المقطع الكامل (+100)" }
  ]);

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMmSs(sec) {
    if (window.SeenJeemAudioChallengeUtils && typeof window.SeenJeemAudioChallengeUtils.formatMmSs === "function") {
      return window.SeenJeemAudioChallengeUtils.formatMmSs(sec);
    }
    const clean = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(clean / 60);
    const s = clean % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function shuffleArray(list, rng = Math.random) {
    const arr = Array.isArray(list) ? list.slice() : [];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function extractAnswerFromFilename(rawName) {
    const base = String(rawName || "")
      .replace(/\.[^/.]+$/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return base || "مقطع صوتي";
  }

  function loadPlayedHistoryIds() {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? Array.from(new Set(parsed.filter((x) => typeof x === "string" && x.trim())))
        : [];
    } catch (_err) {
      return [];
    }
  }

  function savePlayedHistoryIds(ids) {
    try {
      const clean = Array.from(new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x.trim()))).slice(-500);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(clean));
      return clean;
    } catch (_err) {
      return [];
    }
  }

  function markClipPlayedInHistory(clipId) {
    if (!clipId || String(clipId).startsWith("local_")) return;
    const list = loadPlayedHistoryIds();
    if (!list.includes(clipId)) {
      list.push(clipId);
      savePlayedHistoryIds(list);
      if (window.SeenJeemCloudSync && typeof window.SeenJeemCloudSync.scheduleAutoSync === "function") {
        window.SeenJeemCloudSync.scheduleAutoSync();
      }
    }
  }

  function clearPlayedHistory() {
    savePlayedHistoryIds([]);
    if (window.SeenJeemCloudSync && typeof window.SeenJeemCloudSync.scheduleAutoSync === "function") {
      window.SeenJeemCloudSync.scheduleAutoSync();
    }
  }

  function collectAudioQuestionsFromCategories(allCategories) {
    const cats = Array.isArray(allCategories) ? allCategories : [];
    const seenIds = new Set();
    const clips = [];

    cats.forEach((cat) => {
      if (!cat || !Array.isArray(cat.questions)) return;
      const catId = String(cat.id || cat.name || "audio");
      const catName = String(cat.name || "تحدي صوتي");
      const catIcon = String(cat.icon || "🎵");

      cat.questions.forEach((q, idx) => {
        if (!q || typeof q !== "object") return;
        const audioUrl = typeof q.audioUrl === "string" ? q.audioUrl.trim() : "";
        const isAudio = q.visualType === "audio" || Boolean(audioUrl);
        if (!isAudio || !audioUrl) return;

        const id = String(q.id || `audio_${catId}_${idx}`);
        if (seenIds.has(id)) return;
        seenIds.add(id);

        const startNum = Number(q.audioStart);
        const endNum = q.audioEnd !== null && q.audioEnd !== undefined && q.audioEnd !== "" ? Number(q.audioEnd) : null;
        clips.push({
          id,
          source: "bank",
          isLocalFile: false,
          categoryId: catId,
          categoryName: catName,
          categoryIcon: catIcon,
          questionText: typeof q.question === "string" && q.question.trim() ? q.question.trim() : "استمع للمقطع الصوتي وحدّد الإجابة الصحيحة",
          answer: String(q.answer || "—").trim(),
          explanation: typeof q.explanation === "string" ? q.explanation.trim() : "",
          answerImage: typeof q.answerImage === "string" ? q.answerImage.trim() : "",
          basePoints: Number.isFinite(Number(q.points)) && Number(q.points) > 0 ? Number(q.points) : 100,
          audioUrl,
          audioStart: Number.isFinite(startNum) && startNum >= 0 ? startNum : 0,
          audioEnd: endNum !== null && Number.isFinite(endNum) && endNum > (Number.isFinite(startNum) ? startNum : 0) ? endNum : null
        });
      });
    });

    return clips;
  }

  function computeAvailablePoints(clip, playbackMode, progressiveStageLevel, standardPointRule = "fixed-100") {
    if (playbackMode === "progressive") {
      const stage = PROGRESSIVE_STAGES[Math.min(2, Math.max(0, Number(progressiveStageLevel) || 0))];
      return stage ? stage.points : 100;
    }
    if (standardPointRule === "question-points" && clip && Number(clip.basePoints) > 0) {
      return Number(clip.basePoints);
    }
    return 100;
  }

  class AudioChallengeModeController {
    constructor() {
      this.modal = null;
      this.body = null;
      this.isOpenFlag = false;

      // حالة الإعداد (Setup)
      this.sourceTab = "bank"; // "bank" | "local"
      this.selectedCategoryId = "all";
      this.avoidPlayed = true;
      this.freePlay = false;
      this.teamCount = 2;
      this.teamsConfig = DEFAULT_TEAM_NAMES.map((name, i) => ({
        id: `ac-team-${i}`,
        name,
        color: TEAM_COLORS[i % TEAM_COLORS.length],
        score: 0,
        correctCount: 0
      }));
      this.roundsOption = 10;
      this.playbackMode = "progressive";
      this.standardPointRule = "fixed-100";
      this.localClips = [];

      // حالة الجلسة النشطة
      this.phase = "setup"; // setup | playing | revealed | summary
      this.sessionTeams = [];
      this.sessionClips = [];
      this.currentIndex = 0;
      this.progressiveStage = 0;
      this.hostPreviewAnswer = false;
      this.roundAwardedTeamIdx = null;
      this.roundAwardedPoints = 0;
      this.roundHistory = [];
      this.undoStack = [];
      this.audioStatus = {
        playing: false,
        teaserActive: false,
        currentTime: 0,
        duration: 0,
        volume: 0.85,
        autoplayBlocked: false,
        error: ""
      };
      this._playerUnsub = null;
      this._lastBroadcastTimeSec = -1;

      // الحزمة السابعة عشرة: غرفة الهواتف المدمجة (QR) + وضع العرض الكامل
      this.qrDrawerVisible = false;
      this.fullDisplayMode = false;
      this.quickRoom = {
        active: false,
        connected: false,
        roomCode: "",
        playerUrl: "",
        joinLocked: false,
        judgeUid: null,
        playersMap: {},
        feedback: "",
        feedbackKind: "info",
        buzzer: {
          status: "locked",
          roundId: "",
          winnerUid: null,
          winnerName: "",
          winnerAvatar: "",
          winnerTeamId: "",
          winnerTeamName: "",
          winnerTeamIdx: null
        }
      };
    }

    init() {
      this.modal = document.getElementById("audio-challenge-modal");
      this.body = document.getElementById("audio-challenge-body");
      if (!this.modal || !this.body) return;

      const btnClose = document.getElementById("btn-close-audio-challenge");
      const btnToggleQr = document.getElementById("btn-ac-toggle-qr");
      const btnFullDisplay = document.getElementById("btn-ac-full-display");
      const btnExitFull = document.getElementById("btn-ac-exit-full-display");

      if (btnClose) btnClose.addEventListener("click", () => this.close());
      if (btnToggleQr) {
        btnToggleQr.addEventListener("click", () => this.toggleQrDrawer());
      }
      if (btnFullDisplay) {
        btnFullDisplay.addEventListener("click", () => this.setFullDisplayMode(!this.fullDisplayMode));
      }
      if (btnExitFull) {
        btnExitFull.addEventListener("click", () => this.setFullDisplayMode(false));
      }

      this.modal.addEventListener("click", (e) => {
        if (e.target === this.modal && !this.fullDisplayMode) this.close();
      });

      this.body.addEventListener("click", (e) => this._handleBodyClick(e));
      this.body.addEventListener("input", (e) => this._handleBodyInput(e));
      this.body.addEventListener("change", (e) => this._handleBodyChange(e));

      if (window.SeenJeemAudioChallenge && typeof window.SeenJeemAudioChallenge.onChange === "function") {
        this._playerUnsub = window.SeenJeemAudioChallenge.onChange((st) => {
          if (!this.isOpenFlag || (this.phase !== "playing" && this.phase !== "revealed")) return;
          const prevPlaying = Boolean(this.audioStatus.playing);
          this.audioStatus = { ...this.audioStatus, ...st };
          this._updateLiveAudioControlsDOM();
          const secInt = Math.floor(Number(st.currentTime) || 0);
          if (prevPlaying !== Boolean(st.playing)) {
            this._syncQuickRoom();
          } else if (secInt !== this._lastBroadcastTimeSec) {
            this._lastBroadcastTimeSec = secInt;
          }
        });
      }
    }

    isOpen() {
      return Boolean(this.isOpenFlag);
    }

    open() {
      if (!this.modal) this.init();
      if (!this.modal) return;
      this.isOpenFlag = true;
      this.fullDisplayMode = false;
      this.qrDrawerVisible = false;
      this._syncHeaderButtonsUI();
      this.modal.classList.add("open");
      this.modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      this._render();
    }

    close() {
      if (!this.modal) return;
      this.stopPlayback();
      this.setFullDisplayMode(false);
      this.closeQuickRoom({ silent: true });
      this.revokeAllLocalObjectUrls();
      this.phase = "setup";
      this.qrDrawerVisible = false;
      this.isOpenFlag = false;
      this.modal.classList.remove("open");
      this.modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }

    setFullDisplayMode(enabled) {
      this.fullDisplayMode = Boolean(enabled);
      if (this.fullDisplayMode) {
        this.hostPreviewAnswer = false;
      }
      if (this.modal) {
        this.modal.classList.toggle("is-full-display-mode", this.fullDisplayMode);
      }
      const exitBtn = document.getElementById("btn-ac-exit-full-display");
      if (exitBtn) exitBtn.hidden = !this.fullDisplayMode;
      this._syncHeaderButtonsUI();
      this._render();
    }

    async toggleQrDrawer() {
      if (!this.quickRoom.active) {
        await this.createQuickRoom();
        this.qrDrawerVisible = true;
      } else {
        this.qrDrawerVisible = !this.qrDrawerVisible;
      }
      this._syncHeaderButtonsUI();
      this._render();
    }

    _syncHeaderButtonsUI() {
      const btnToggleQr = document.getElementById("btn-ac-toggle-qr");
      if (btnToggleQr) {
        btnToggleQr.textContent = this.qrDrawerVisible ? "🙈 إخفاء رمز QR" : "📱 إظهار رمز QR";
      }
      const btnFull = document.getElementById("btn-ac-full-display");
      if (btnFull) {
        btnFull.textContent = this.fullDisplayMode ? "✕ إنهاء العرض الكامل" : "📺 وضع العرض الكامل";
      }
    }

    revokeAllLocalObjectUrls() {
      if (!Array.isArray(this.localClips) || this.localClips.length === 0) return 0;
      let revoked = 0;
      this.localClips.forEach((clip) => {
        if (clip && typeof clip.audioUrl === "string" && clip.audioUrl.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(clip.audioUrl);
            revoked += 1;
          } catch (_err) {}
        }
      });
      this.localClips = [];
      return revoked;
    }

    _toast(msg, type = "info") {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.showToast === "function") {
        window.SeenJeemHostBridge.showToast(msg, type);
      }
    }

    _getAllBankClips() {
      const cats =
        window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.getAllCategories === "function"
          ? window.SeenJeemHostBridge.getAllCategories()
          : [];
      return collectAudioQuestionsFromCategories(cats);
    }

    _getFilteredBankClips() {
      const all = this._getAllBankClips();
      const playedSet = this.avoidPlayed ? new Set(loadPlayedHistoryIds()) : new Set();
      return all.filter((c) => {
        if (this.selectedCategoryId !== "all" && c.categoryId !== this.selectedCategoryId) return false;
        if (this.avoidPlayed && playedSet.has(c.id)) return false;
        return true;
      });
    }

    _getCurrentClip() {
      return this.sessionClips[this.currentIndex] || null;
    }

    _getCurrentPoints() {
      return computeAvailablePoints(
        this._getCurrentClip(),
        this.playbackMode,
        this.progressiveStage,
        this.standardPointRule
      );
    }

    _getActiveTeamsList() {
      if (this.phase !== "setup") return this.sessionTeams;
      if (this.freePlay) return [];
      return this.teamsConfig.slice(0, Math.min(6, Math.max(2, this.teamCount))).map((t, idx) => ({
        id: `ac-team-${idx}`,
        name: (t.name || DEFAULT_TEAM_NAMES[idx]).trim().slice(0, 24) || DEFAULT_TEAM_NAMES[idx],
        color: t.color || TEAM_COLORS[idx % TEAM_COLORS.length],
        score: 0,
        correctCount: 0
      }));
    }

    /* =========================================================
       غرفة الهواتف المدمجة (/quickRooms/{roomCode} — gameType: "audio")
       ========================================================= */
    async createQuickRoom() {
      const sync = window.SeenJeemQuickGamesSync;
      if (!sync) return;
      if (!sync.isConfigured()) {
        this.quickRoom.feedbackKind = "warning";
        this.quickRoom.feedback = "⚠️ خدمة اللعب عبر الهواتف غير متاحة حالياً — يمكنك بدء اللعب مباشرة بدون هواتف.";
        this._render();
        return;
      }
      this.quickRoom.feedbackKind = "info";
      this.quickRoom.feedback = "⏳ جاري إنشاء غرفة اللعب وتوليد رمز QR...";
      this._render();

      try {
        const info = await sync.createRoom({
          gameType: "audio",
          initialPublicState: this._buildQuickPublicState(),
          onPlayers: (map) => {
            this.quickRoom.playersMap = map && typeof map === "object" ? map : {};
            if (this.quickRoom.judgeUid && !this.quickRoom.playersMap[this.quickRoom.judgeUid]) {
              this.quickRoom.judgeUid = null;
              sync.setJudgeUid(null);
            }
            this._render();
          },
          onBuzzes: (buzzMap) => this._handleIncomingBuzzes(buzzMap),
          onCommand: (cmd) => this._handlePhoneCommand(cmd),
          onConnectionState: (isConn) => {
            this.quickRoom.connected = isConn;
            this._render();
          }
        });

        this.quickRoom.active = true;
        this.quickRoom.connected = true;
        this.quickRoom.roomCode = info.roomCode;
        this.quickRoom.playerUrl = info.playerUrl;
        this.quickRoom.joinLocked = false;
        this.quickRoom.feedbackKind = "success";
        this.quickRoom.feedback = `✅ غرفة تحدي الصوت جاهزة (${info.roomCode}) — امسح الرمز بهاتفك للانضمام!`;
        this._syncQuickRoom();
        this._syncHeaderButtonsUI();
        this._render();
      } catch (err) {
        this.quickRoom.feedbackKind = "warning";
        this.quickRoom.feedback = `⚠️ ${(err && err.message) || "تعذّر إنشاء غرفة الهواتف حالياً."}`;
        this._render();
      }
    }

    async closeQuickRoom({ silent = false } = {}) {
      const sync = window.SeenJeemQuickGamesSync;
      if (this.quickRoom.active && sync && sync.gameType === "audio") {
        await sync.closeRoom();
      }
      this.quickRoom = {
        active: false,
        connected: false,
        roomCode: "",
        playerUrl: "",
        joinLocked: false,
        judgeUid: null,
        playersMap: {},
        feedback: "",
        feedbackKind: "info",
        buzzer: {
          status: "locked",
          roundId: "",
          winnerUid: null,
          winnerName: "",
          winnerAvatar: "",
          winnerTeamId: "",
          winnerTeamName: "",
          winnerTeamIdx: null
        }
      };
      this.qrDrawerVisible = false;
      if (!silent) {
        this._syncHeaderButtonsUI();
        this._render();
        this._toast("🔴 تم إغلاق غرفة الهواتف", "info");
      }
    }

    async toggleJoinLocked() {
      if (!this.quickRoom.active || !window.SeenJeemQuickGamesSync) return;
      this.quickRoom.joinLocked = !this.quickRoom.joinLocked;
      await window.SeenJeemQuickGamesSync.setJoinLocked(this.quickRoom.joinLocked);
      this._render();
    }

    async setJudgePlayer(uid) {
      if (!this.quickRoom.active || !window.SeenJeemQuickGamesSync) return;
      const nextUid = this.quickRoom.judgeUid === uid ? null : uid;
      this.quickRoom.judgeUid = nextUid;
      await window.SeenJeemQuickGamesSync.setJudgeUid(nextUid);
      this._syncQuickRoom();
      this._render();
      if (nextUid && this.quickRoom.playersMap[nextUid]) {
        this._toast(`👑 تم تعيين «${this.quickRoom.playersMap[nextUid].name}» حكماً للجولة عبر هاتفه`, "success");
      } else {
        this._toast("تم إلغاء تعيين الحكم عبر الهاتف", "info");
      }
    }

    async kickQuickPlayer(uid) {
      if (!this.quickRoom.active || !window.SeenJeemQuickGamesSync || !uid) return;
      await window.SeenJeemQuickGamesSync.kickPlayer(uid);
      if (this.quickRoom.judgeUid === uid) {
        this.quickRoom.judgeUid = null;
        await window.SeenJeemQuickGamesSync.setJudgeUid(null);
      }
      delete this.quickRoom.playersMap[uid];
      this._render();
    }

    _openRoundBuzzer() {
      const roundId = `ac_${this.currentIndex}_${Date.now().toString(36)}`;
      this.quickRoom.buzzer = {
        status: "open",
        roundId,
        winnerUid: null,
        winnerName: "",
        winnerAvatar: "",
        winnerTeamId: "",
        winnerTeamName: "",
        winnerTeamIdx: null
      };
      if (this.quickRoom.active && window.SeenJeemQuickGamesSync) {
        window.SeenJeemQuickGamesSync.clearBuzzes();
      }
    }

    _lockRoundBuzzer() {
      this.quickRoom.buzzer = {
        ...this.quickRoom.buzzer,
        status: "locked"
      };
    }

    _handleIncomingBuzzes(buzzMap) {
      if (!this.quickRoom.active || this.phase !== "playing") return;
      const bz = this.quickRoom.buzzer;
      if (!bz || bz.status !== "open") return;
      const entries = Object.values(buzzMap || {}).filter(
        (b) => b && b.uid && (!bz.roundId || !b.roundId || b.roundId === bz.roundId) && b.uid !== this.quickRoom.judgeUid
      );
      if (entries.length === 0) return;
      entries.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
      const winner = entries[0];
      const teamIdx = this.sessionTeams.findIndex((t) => t.id === winner.teamId);
      const teamName = teamIdx >= 0 ? this.sessionTeams[teamIdx].name : "";

      this.quickRoom.buzzer = {
        status: "buzzed",
        roundId: bz.roundId,
        winnerUid: winner.uid,
        winnerName: winner.name || "لاعب",
        winnerAvatar: winner.avatar || "🎯",
        winnerTeamId: winner.teamId || "",
        winnerTeamName: teamName,
        winnerTeamIdx: teamIdx >= 0 ? teamIdx : null
      };

      // Auto-Pause تلقائي للمقطع الصوتي فور ضغط أول لاعب!
      this.triggerAudioAction("PAUSE");
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playBuzz === "function") {
        window.SeenJeemAudio.playBuzz();
      }
      this._toast(`🔔 ${winner.avatar || "🎯"} ${winner.name} ضغط الجرس أولاً!`, "success");
      this._render();
      this._syncQuickRoom();
    }

    _handlePhoneCommand(cmd) {
      if (!cmd || !this.quickRoom.active || !this.quickRoom.judgeUid || cmd.uid !== this.quickRoom.judgeUid) return;
      const p = cmd.payload && typeof cmd.payload === "object" ? cmd.payload : {};
      switch (cmd.type) {
        case "AUDIO_PLAY":
          this.triggerAudioAction("PLAY");
          break;
        case "AUDIO_PAUSE":
          this.triggerAudioAction("PAUSE");
          break;
        case "AUDIO_REPLAY":
          this.triggerAudioAction("REPLAY");
          break;
        case "AUDIO_STAGE":
          this.setProgressiveStage(Number(p.level) || 0, true);
          break;
        case "AUDIO_CORRECT": {
          const buzzIdx = this.quickRoom.buzzer ? this.quickRoom.buzzer.winnerTeamIdx : null;
          if (!this.freePlay && Number.isInteger(buzzIdx) && this.sessionTeams[buzzIdx]) {
            this.awardTeam(buzzIdx);
          } else if (Number.isInteger(p.teamIdx) && this.sessionTeams[p.teamIdx]) {
            this.awardTeam(p.teamIdx);
          } else {
            this.revealAnswer();
          }
          break;
        }
        case "AUDIO_WRONG_CONTINUE":
          this.handleBuzzerWrongContinue();
          break;
        case "AUDIO_REVEAL":
          this.revealAnswer();
          break;
        case "AUDIO_NEXT":
          this.nextRound();
          break;
        default:
          break;
      }
    }

    _buildQuickPublicState() {
      const clip = this._getCurrentClip();
      const isRevealed = this.phase === "revealed";
      const stage = PROGRESSIVE_STAGES[this.progressiveStage] || PROGRESSIVE_STAGES[0];
      const ranked = this.sessionTeams.slice().sort((a, b) => b.score - a.score);
      const isDraw = ranked.length > 1 && ranked[0].score === ranked[1].score;
      const awardedTeam =
        isRevealed && this.roundAwardedTeamIdx !== null && this.sessionTeams[this.roundAwardedTeamIdx]
          ? this.sessionTeams[this.roundAwardedTeamIdx].name
          : null;

      return {
        gameType: "audio",
        phase: this.phase,
        roundNumber: this.currentIndex + 1,
        totalRounds: this.sessionClips.length,
        roundId: this.quickRoom.buzzer.roundId || `ac_${this.currentIndex}`,
        category: clip ? clip.categoryName : "تحدي الصوت",
        categoryIcon: clip ? clip.categoryIcon : "🎵",
        questionText: clip ? clip.questionText : "استمع للمقطع الصوتي واضغط الجرس!",
        freePlay: this.freePlay,
        teams: this._getActiveTeamsList(),
        judgeUid: this.quickRoom.judgeUid || "",
        buzzerState: {
          status: this.quickRoom.buzzer.status,
          roundId: this.quickRoom.buzzer.roundId,
          winnerUid: this.quickRoom.buzzer.winnerUid,
          winnerName: this.quickRoom.buzzer.winnerName,
          winnerAvatar: this.quickRoom.buzzer.winnerAvatar,
          winnerTeamId: this.quickRoom.buzzer.winnerTeamId,
          winnerTeamName: this.quickRoom.buzzer.winnerTeamName
        },
        audioPlayback: {
          playing: Boolean(this.audioStatus && this.audioStatus.playing),
          mode: this.playbackMode,
          stageLevel: this.progressiveStage,
          stageLabel: stage.label,
          currentPoints: this._getCurrentPoints()
        },
        revealedAnswer: isRevealed && clip ? clip.answer : null,
        revealedExplanation: isRevealed && clip ? clip.explanation : null,
        revealedAnswerImage: isRevealed && clip && clip.answerImage ? clip.answerImage : null,
        roundAwardedTeamName: awardedTeam,
        roundAwardedPoints: isRevealed ? this.roundAwardedPoints : 0,
        winnerTitle:
          this.phase === "summary"
            ? this.freePlay
              ? "انتهت جولة تحدي الصوت الحر!"
              : isDraw
                ? "تعادل مثير في قمة تحدي الصوت!"
                : `الفائز: ${(ranked[0] && ranked[0].name) || "—"}`
            : null
      };
    }

    _syncQuickRoom() {
      const sync = window.SeenJeemQuickGamesSync;
      if (!this.quickRoom.active || !sync || sync.gameType !== "audio") return;
      sync.publishPublicState(this._buildQuickPublicState());
      const clip = this._getCurrentClip();
      if (this.quickRoom.judgeUid && clip && (this.phase === "playing" || this.phase === "revealed")) {
        sync.setPrivateJudgePayload(this.quickRoom.judgeUid, {
          roundId: `ac_${this.currentIndex}`,
          question: clip.questionText,
          answer: clip.answer,
          explanation: clip.explanation || "",
          category: clip.categoryName,
          points: this._getCurrentPoints()
        });
      } else {
        sync.setPrivateJudgePayload(null, null);
      }
    }

    /* =========================================================
       التحكم بالصوت المركزي على الشاشة الرئيسية (إعادة استخدام audioChallengePlayer.js)
       ========================================================= */
    stopPlayback() {
      if (window.SeenJeemAudioChallenge) {
        window.SeenJeemAudioChallenge.stop();
      }
      this.audioStatus = {
        ...this.audioStatus,
        playing: false,
        teaserActive: false,
        currentTime: 0,
        autoplayBlocked: false,
        error: ""
      };
    }

    async triggerAudioAction(action, payload = {}) {
      const clip = this._getCurrentClip();
      if (!clip && action !== "STOP") return;

      if (action === "STOP") {
        this.stopPlayback();
        this._updateLiveAudioControlsDOM();
        this._syncQuickRoom();
        return;
      }

      const player = window.SeenJeemAudioChallenge;
      if (!player) return;
      player.load(clip.audioUrl, { start: Number(clip.audioStart) || 0, end: clip.audioEnd, questionId: clip.id });
      if (action === "PLAY") await player.play();
      else if (action === "PAUSE") player.pause();
      else if (action === "REPLAY") await player.replay();
      else if (action === "TEASER_5S") await player.playTeaser(Number(payload.seconds) || 5);
      else if (action === "SEEK") player.seek(Number(payload.seconds) || 0);
      else if (action === "SET_VOLUME") player.setVolume(Number(payload.volume));

      this.audioStatus = { ...this.audioStatus, ...player.getState() };
      this._updateLiveAudioControlsDOM();
      this._syncQuickRoom();
    }

    // توافق خلفي في حال استُدعي من الجسر القديم
    onDisplayAudioStatus() {}
    onWirelessBuzz() {
      if (!this.isOpenFlag || this.phase !== "playing") return;
      this.triggerAudioAction("PAUSE");
      this._render();
    }
    buildSanitizedDisplayPayload() {
      return this._buildQuickPublicState();
    }
    buildHostPrivatePayload() {
      return null;
    }

    /* =========================================================
       إدارة مراحل الجلسة (Setup -> Playing -> Revealed -> Summary)
       ========================================================= */
    addLocalFiles(fileList) {
      const files = Array.from(fileList || []).filter((f) => f && f.size > 0);
      if (files.length === 0) return;

      files.forEach((f, idx) => {
        const objUrl = URL.createObjectURL(f);
        this.localClips.push({
          id: `local_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
          source: "local",
          isLocalFile: true,
          categoryId: "local-files",
          categoryName: "ملفات محلية",
          categoryIcon: "📂",
          questionText: "استمع للمقطع الصوتي وحدّد الإجابة الصحيحة",
          answer: extractAnswerFromFilename(f.name),
          explanation: "",
          answerImage: "",
          basePoints: 100,
          audioUrl: objUrl,
          audioStart: 0,
          audioEnd: null
        });
      });

      this._toast(`📂 تم إضافة ${files.length} ملف صوتي للجولة المؤقتة`, "success");
      this._render();
    }

    removeLocalClip(clipId) {
      const idx = this.localClips.findIndex((c) => c.id === clipId);
      if (idx === -1) return;
      const [removed] = this.localClips.splice(idx, 1);
      if (removed && typeof removed.audioUrl === "string" && removed.audioUrl.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(removed.audioUrl);
        } catch (_err) {}
      }
      this._render();
    }

    startSession({ offlineOnly = false } = {}) {
      const pool = this.sourceTab === "local" ? this.localClips.slice() : this._getFilteredBankClips();
      if (pool.length === 0) {
        this._toast(
          this.sourceTab === "local"
            ? "⚠️ يرجى اختيار ملف صوتي واحد على الأقل من جهازك أولاً"
            : "⚠️ لا توجد مقاطع صوتية متاحة — أضفها من فئاتي الخاصة أو اختر ملفات من جهازك",
          "warning"
        );
        return;
      }

      if (offlineOnly && this.quickRoom.active) {
        this.closeQuickRoom({ silent: true });
      }

      const shuffled = shuffleArray(pool);
      const count = this.roundsOption > 0 ? Math.min(this.roundsOption, shuffled.length) : shuffled.length;
      this.sessionClips = shuffled.slice(0, count);
      this.sessionTeams = this._getActiveTeamsList();
      this.currentIndex = 0;
      this.roundHistory = [];
      this.undoStack = [];
      this.qrDrawerVisible = false;
      this._syncHeaderButtonsUI();
      this._enterRound(0);
    }

    _enterRound(index) {
      this.stopPlayback();
      this.currentIndex = index;
      this.phase = "playing";
      this.progressiveStage = 0;
      this.hostPreviewAnswer = false;
      this.roundAwardedTeamIdx = null;
      this.roundAwardedPoints = 0;

      const clip = this._getCurrentClip();
      if (clip && window.SeenJeemAudioChallenge) {
        window.SeenJeemAudioChallenge.load(clip.audioUrl, {
          start: clip.audioStart,
          end: clip.audioEnd,
          questionId: clip.id
        });
      }

      this._openRoundBuzzer();
      this._render();
      this._syncQuickRoom();
    }

    setProgressiveStage(level, autoPlay = true) {
      const clamped = Math.min(2, Math.max(0, Number(level) || 0));
      this.progressiveStage = clamped;
      this._render();
      this._syncQuickRoom();

      if (autoPlay) {
        const stage = PROGRESSIVE_STAGES[clamped];
        if (stage && stage.seconds) {
          this.triggerAudioAction("TEASER_5S", { seconds: stage.seconds });
        } else {
          this.triggerAudioAction("REPLAY");
        }
      }
    }

    revealAnswer() {
      if (this.phase !== "playing") return;
      this.triggerAudioAction("PAUSE");
      this._lockRoundBuzzer();
      this.phase = "revealed";
      const clip = this._getCurrentClip();
      if (clip) markClipPlayedInHistory(clip.id);
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playReveal === "function") {
        window.SeenJeemAudio.playReveal();
      }
      this._render();
      this._syncQuickRoom();
    }

    awardTeam(teamIdx) {
      if (this.phase !== "playing" && this.phase !== "revealed") return;
      const clip = this._getCurrentClip();
      if (!clip) return;

      this._pushUndoSnapshot();
      this.triggerAudioAction("PAUSE");
      this._lockRoundBuzzer();

      const pts = this._getCurrentPoints();
      if (!this.freePlay && Number.isInteger(teamIdx) && this.sessionTeams[teamIdx]) {
        this.sessionTeams[teamIdx].score += pts;
        this.sessionTeams[teamIdx].correctCount += 1;
        this.roundAwardedTeamIdx = teamIdx;
        this.roundAwardedPoints = pts;
        if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playScore === "function") {
          window.SeenJeemAudio.playScore(true);
        }
        this._toast(`✅ +${pts} نقطة لـ ${this.sessionTeams[teamIdx].name}!`, "success");
      } else {
        this.roundAwardedTeamIdx = null;
        this.roundAwardedPoints = 0;
        if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playNoScore === "function") {
          window.SeenJeemAudio.playNoScore();
        }
      }

      markClipPlayedInHistory(clip.id);
      this.phase = "revealed";
      this._recordRoundOutcome(clip, this.roundAwardedTeamIdx, this.roundAwardedPoints);
      this._render();
      this._syncQuickRoom();
    }

    handleBuzzerWrongContinue() {
      if (this.phase !== "playing") return;
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playNoScore === "function") {
        window.SeenJeemAudio.playNoScore();
      }
      this._openRoundBuzzer();
      this._toast("❌ إجابة خاطئة — أُعيد فتح الجرس ويمكن متابعة المقطع!", "info");
      this.triggerAudioAction("PLAY");
      this._render();
      this._syncQuickRoom();
    }

    skipRound() {
      if (this.phase !== "playing" && this.phase !== "revealed") return;
      const clip = this._getCurrentClip();
      this._pushUndoSnapshot();
      if (clip) {
        markClipPlayedInHistory(clip.id);
        this._recordRoundOutcome(clip, null, 0);
      }
      this.nextRound();
    }

    nextRound() {
      this.stopPlayback();
      if (this.currentIndex + 1 < this.sessionClips.length) {
        this._enterRound(this.currentIndex + 1);
      } else {
        this._enterSummary();
      }
    }

    _enterSummary() {
      this.stopPlayback();
      this._lockRoundBuzzer();
      this.phase = "summary";
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playVictory === "function") {
        window.SeenJeemAudio.playVictory();
      }
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.triggerConfetti === "function") {
        window.SeenJeemHostBridge.triggerConfetti("victory", "default");
      }
      this._render();
      this._syncQuickRoom();
    }

    _recordRoundOutcome(clip, teamIdx, points) {
      const existingIdx = this.roundHistory.findIndex((r) => r.roundNum === this.currentIndex + 1);
      const entry = {
        roundNum: this.currentIndex + 1,
        clipId: clip.id,
        categoryName: clip.categoryName,
        answer: clip.answer,
        awardedTeamIdx: teamIdx,
        awardedTeamName: teamIdx !== null && this.sessionTeams[teamIdx] ? this.sessionTeams[teamIdx].name : null,
        points: Number(points) || 0
      };
      if (existingIdx >= 0) this.roundHistory[existingIdx] = entry;
      else this.roundHistory.push(entry);
    }

    _pushUndoSnapshot() {
      this.undoStack.push({
        phase: this.phase,
        currentIndex: this.currentIndex,
        progressiveStage: this.progressiveStage,
        roundAwardedTeamIdx: this.roundAwardedTeamIdx,
        roundAwardedPoints: this.roundAwardedPoints,
        sessionTeams: this.sessionTeams.map((t) => ({ ...t })),
        roundHistory: this.roundHistory.map((r) => ({ ...r }))
      });
      if (this.undoStack.length > 20) this.undoStack.shift();
    }

    undoLastAction() {
      if (this.undoStack.length === 0) return;
      const snap = this.undoStack.pop();
      this.stopPlayback();
      this.phase = snap.phase;
      this.currentIndex = snap.currentIndex;
      this.progressiveStage = snap.progressiveStage;
      this.roundAwardedTeamIdx = snap.roundAwardedTeamIdx;
      this.roundAwardedPoints = snap.roundAwardedPoints;
      this.sessionTeams = snap.sessionTeams;
      this.roundHistory = snap.roundHistory;
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playUndo === "function") {
        window.SeenJeemAudio.playUndo();
      }
      this._toast("↩️ تم التراجع عن آخر خطوة", "info");
      this._render();
      this._syncQuickRoom();
    }

    /* =========================================================
       التفاعل ورسم الواجهة (مع بطاقة QR المدمجة ووضع العرض الكامل)
       ========================================================= */
    _handleBodyClick(e) {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.acAct;
      if (!act) return;

      switch (act) {
        case "tab":
          this.sourceTab = btn.dataset.val === "local" ? "local" : "bank";
          this._render();
          break;
        case "open-pack-builder":
          this.close();
          if (window.SeenJeemCustomPackBuilder) window.SeenJeemCustomPackBuilder.open();
          break;
        case "reset-history":
          clearPlayedHistory();
          this._toast("🔄 تم تصفير سجل المقاطع الصوتية الملعوبة", "info");
          this._render();
          break;
        case "toggle-avoid-played":
          this.avoidPlayed = !this.avoidPlayed;
          this._render();
          break;
        case "toggle-free-play":
          this.freePlay = !this.freePlay;
          this._syncQuickRoom();
          this._render();
          break;
        case "set-team-count":
          this.freePlay = false;
          this.teamCount = Math.min(6, Math.max(2, Number(btn.dataset.val) || 2));
          this._syncQuickRoom();
          this._render();
          break;
        case "set-rounds":
          this.roundsOption = Number(btn.dataset.val) || 0;
          this._render();
          break;
        case "set-mode":
          this.playbackMode = btn.dataset.val === "standard" ? "standard" : "progressive";
          this._render();
          break;
        case "set-std-pts":
          this.standardPointRule = btn.dataset.val === "question-points" ? "question-points" : "fixed-100";
          this._render();
          break;
        case "remove-local":
          this.removeLocalClip(btn.dataset.id);
          break;
        case "clear-local":
          this.revokeAllLocalObjectUrls();
          this._render();
          break;
        case "create-qr-room":
          this.createQuickRoom();
          break;
        case "close-qr-room":
          this.closeQuickRoom();
          break;
        case "toggle-lock-room":
          this.toggleJoinLocked();
          break;
        case "copy-qr-link":
          if (this.quickRoom.playerUrl && navigator.clipboard) {
            navigator.clipboard.writeText(this.quickRoom.playerUrl).then(() => {
              this._toast("📋 تم نسخ رابط الانضمام للهواتف", "success");
            });
          }
          break;
        case "set-judge":
          this.setJudgePlayer(btn.dataset.uid);
          break;
        case "kick-player":
          this.kickQuickPlayer(btn.dataset.uid);
          break;
        case "hide-qr-drawer":
          this.qrDrawerVisible = false;
          this._syncHeaderButtonsUI();
          this._render();
          break;
        case "start-session":
          this.startSession({ offlineOnly: false });
          break;
        case "start-offline":
          this.startSession({ offlineOnly: true });
          break;
        case "play":
          this.triggerAudioAction("PLAY");
          break;
        case "pause":
          this.triggerAudioAction("PAUSE");
          break;
        case "replay":
          this.triggerAudioAction("REPLAY");
          break;
        case "teaser-5":
          this.triggerAudioAction("TEASER_5S", { seconds: 5 });
          break;
        case "prog-stage":
          this.setProgressiveStage(Number(btn.dataset.level) || 0, true);
          break;
        case "toggle-preview":
          if (this.fullDisplayMode) return;
          this.hostPreviewAnswer = !this.hostPreviewAnswer;
          this._render();
          break;
        case "reveal":
          this.revealAnswer();
          break;
        case "award":
          this.awardTeam(Number(btn.dataset.teamIdx));
          break;
        case "buzzer-wrong":
          this.handleBuzzerWrongContinue();
          break;
        case "buzzer-open":
          this._openRoundBuzzer();
          this._render();
          this._syncQuickRoom();
          break;
        case "undo":
          this.undoLastAction();
          break;
        case "skip":
          this.skipRound();
          break;
        case "next":
          this.nextRound();
          break;
        case "result-card":
          if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openAudioChallengeResultCard === "function") {
            window.SeenJeemHostBridge.openAudioChallengeResultCard({
              teams: this.sessionTeams,
              totalRounds: this.sessionClips.length,
              playbackMode: this.playbackMode,
              freePlay: this.freePlay,
              timestamp: Date.now()
            });
          }
          break;
        case "new-session":
          this.stopPlayback();
          this.phase = "setup";
          this._render();
          this._syncQuickRoom();
          break;
        case "exit-home":
          this.close();
          break;
        default:
          break;
      }
    }

    _handleBodyInput(e) {
      const t = e.target;
      if (!t) return;
      if (t.dataset.acTeamName !== undefined) {
        const idx = Number(t.dataset.acTeamName);
        if (this.teamsConfig[idx]) {
          this.teamsConfig[idx].name = t.value;
          this._syncQuickRoom();
        }
      } else if (t.dataset.acTeamColor !== undefined) {
        const idx = Number(t.dataset.acTeamColor);
        if (this.teamsConfig[idx]) this.teamsConfig[idx].color = t.value;
      } else if (t.dataset.acLocalAnswer !== undefined) {
        const clip = this.localClips.find((c) => c.id === t.dataset.acLocalAnswer);
        if (clip) clip.answer = t.value;
      } else if (t.dataset.acLocalCat !== undefined) {
        const clip = this.localClips.find((c) => c.id === t.dataset.acLocalCat);
        if (clip) clip.categoryName = t.value;
      } else if (t.id === "ac-volume-slider") {
        const vol = Math.min(1, Math.max(0, (Number(t.value) || 85) / 100));
        this.audioStatus.volume = vol;
        this.triggerAudioAction("SET_VOLUME", { volume: vol });
      }
    }

    _handleBodyChange(e) {
      const t = e.target;
      if (!t) return;
      if (t.id === "ac-cat-select") {
        this.selectedCategoryId = t.value || "all";
        this._render();
      } else if (t.id === "ac-local-files-input" && t.files) {
        this.addLocalFiles(t.files);
        t.value = "";
      } else if (t.id === "ac-seek-slider") {
        this.triggerAudioAction("SEEK", { seconds: Number(t.value) || 0 });
      }
    }

    _updateLiveAudioControlsDOM() {
      const st = this.audioStatus || {};
      const cur = Math.max(0, Number(st.currentTime) || 0);
      const dur = Math.max(0, Number(st.duration) || 0);
      const viz = document.getElementById("ac-host-visualizer");
      if (viz) viz.classList.toggle("is-playing", Boolean(st.playing));
      const curEl = document.getElementById("ac-cur-time");
      if (curEl) curEl.textContent = formatMmSs(cur);
      const durEl = document.getElementById("ac-dur-time");
      if (durEl) durEl.textContent = dur > 0 ? formatMmSs(dur) : "--:--";
      const seek = document.getElementById("ac-seek-slider");
      if (seek) {
        seek.max = String(dur > 0 ? dur : 100);
        seek.value = String(dur > 0 ? Math.min(dur, cur) : 0);
        seek.disabled = dur <= 0;
      }
      const btnPlay = document.getElementById("ac-btn-play");
      const btnPause = document.getElementById("ac-btn-pause");
      if (btnPlay) btnPlay.hidden = Boolean(st.playing);
      if (btnPause) btnPause.hidden = !Boolean(st.playing);
      const statusEl = document.getElementById("ac-status-label");
      if (statusEl) {
        statusEl.textContent = st.autoplayBlocked
          ? "🔇 اضغط على زر التشغيل لتفعيل الصوت"
          : st.error
            ? `⚠️ ${st.error}`
            : st.playing
              ? "🔊 جاري تشغيل المقطع الصوتي..."
              : "⏸️ جاهز / متوقف مؤقتاً";
      }
    }

    _renderMidgameQrDrawerHtml() {
      if (!this.qrDrawerVisible || !this.quickRoom.active) return "";
      const qr = this.quickRoom;
      const qrSvg =
        qr.playerUrl && window.SeenJeemQR
          ? window.SeenJeemQR.toSVG(qr.playerUrl, { size: 136, margin: 2, ariaLabel: `رمز انضمام غرفة ${qr.roomCode}` })
          : "";
      const count = Object.keys(qr.playersMap || {}).length;
      return `
        <div class="qg-midgame-qr-card">
          <div class="qg-midgame-qr-svg">${qrSvg}</div>
          <div class="qg-midgame-qr-info">
            <div class="qg-midgame-qr-title">📱 امسح الرمز بهاتفك للانضمام فوراً</div>
            <div class="qg-midgame-qr-code">رمز الغرفة: <strong>${escapeHtml(qr.roomCode)}</strong> • المنضمّون: <strong>${count}</strong></div>
            <div class="qg-midgame-qr-actions">
              <button type="button" class="btn btn-secondary btn-xxs" data-ac-act="copy-qr-link">📋 نسخ الرابط</button>
              <a href="${escapeHtml(qr.playerUrl)}" target="_blank" rel="noopener" class="btn btn-gold-outline btn-xxs">↗️ فتح شاشة لاعب</a>
              <button type="button" class="btn btn-ghost btn-xxs" data-ac-act="hide-qr-drawer">🙈 إخفاء</button>
            </div>
          </div>
        </div>
      `;
    }

    _renderSetupQrSectionHtml() {
      const qr = this.quickRoom;
      const players = Object.values(qr.playersMap || {}).filter((p) => p && p.uid && p.name);
      const teams = this._getActiveTeamsList();
      const teamMap = new Map(teams.map((t) => [t.id, t.name]));
      const qrSvg =
        qr.active && qr.playerUrl && window.SeenJeemQR
          ? window.SeenJeemQR.toSVG(qr.playerUrl, { size: 164, margin: 3, ariaLabel: `رمز انضمام غرفة ${qr.roomCode}` })
          : "";

      return `
        <section class="bank-section qg-setup-qr-card">
          <div class="bank-section-header">
            <h3 class="bank-section-title">📱 اللعب عبر الهواتف (جرس السرعة + هاتف الحكم)</h3>
            <span class="dual-status-pill ${qr.active && qr.connected ? "is-connected" : "is-single"}">
              ${!qr.active ? "⚪ غير مفعّلة بعد" : qr.connected ? `🟢 غرفة ${escapeHtml(qr.roomCode)} (${players.length} لاعب)` : "🟡 يعيد الاتصال..."}
            </span>
          </div>
          ${qr.feedback ? `<div class="wireless-feedback-box is-${escapeHtml(qr.feedbackKind)}">${escapeHtml(qr.feedback)}</div>` : ""}
          ${
            !qr.active
              ? `
                <div class="qg-qr-init-row">
                  <button type="button" class="btn btn-primary btn-sm" data-ac-act="create-qr-room">📱 فتح غرفة اللعب وإظهار رمز QR</button>
                  <span class="bs-hint">يمسح اللاعبون الرمز بهواتفهم للضغط على «أعرف الإجابة!» وإيقاف الصوت تلقائياً، أو يمكنك البدء مباشرة بدون هواتف.</span>
                </div>
              `
              : `
                <div class="bs-wl-active-grid">
                  <div class="bs-wl-qr-col">
                    <div class="wireless-qr-svg-wrap">${qrSvg}</div>
                    <div class="wireless-player-code-display">رمز الغرفة: <strong>${escapeHtml(qr.roomCode)}</strong></div>
                    <div class="wireless-qr-actions">
                      <button type="button" class="btn btn-ghost btn-xxs" data-ac-act="copy-qr-link">📋 نسخ الرابط</button>
                      <a href="${escapeHtml(qr.playerUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xxs">↗️ فتح شاشة لاعب</a>
                    </div>
                  </div>
                  <div class="bs-wl-players-col">
                    <div class="bs-wl-guard-row">
                      <button type="button" class="btn ${qr.joinLocked ? "btn-amber" : "btn-secondary"} btn-xs" data-ac-act="toggle-lock-room">
                        ${qr.joinLocked ? "🔒 الانضمام مقفل (افتح)" : "🔓 قفل الانضمام"}
                      </button>
                      <button type="button" class="btn btn-danger-outline btn-xs" data-ac-act="close-qr-room">🔴 إغلاق الغرفة</button>
                    </div>
                    <div class="bs-wl-roster-head">اللاعبون المنضمّون (${players.length}):</div>
                    <div class="bs-wl-roster-list">
                      ${
                        players.length === 0
                          ? `<div class="wireless-device-empty">امسح الرمز بهاتفك للانضمام — ستظهر الأسماء والأفاتارات هنا فوراً...</div>`
                          : players
                              .map((p) => {
                                const isJudge = qr.judgeUid === p.uid;
                                const tName = teamMap.get(p.teamId) || "";
                                return `
                                  <div class="wireless-device-row${isJudge ? " is-vip-row" : ""}">
                                    <div class="wireless-device-meta">
                                      <span class="wireless-device-online-dot"></span>
                                      <strong>${escapeHtml(p.avatar || "🎯")} ${escapeHtml(p.name)}</strong>
                                      ${tName ? `<span class="qg-team-mini-tag">${escapeHtml(tName)}</span>` : ""}
                                      ${isJudge ? `<span class="bs-vip-tag">👑 حكم</span>` : ""}
                                    </div>
                                    <div class="bs-row-btns">
                                      <button type="button" class="btn ${isJudge ? "btn-amber" : "btn-gold-outline"} btn-xxs" data-ac-act="set-judge" data-uid="${escapeHtml(p.uid)}" title="تعيين هذا الهاتف كحكم يرى الإجابة ويتحكم بالصوت">
                                        ${isJudge ? "✓ حكم" : "👑 تعيين كحكم"}
                                      </button>
                                      <button type="button" class="btn btn-danger-outline btn-xxs" data-ac-act="kick-player" data-uid="${escapeHtml(p.uid)}">🚫 طرد</button>
                                    </div>
                                  </div>
                                `;
                              })
                              .join("")
                      }
                    </div>
                  </div>
                </div>
              `
          }
        </section>
      `;
    }

    _render() {
      if (!this.body) return;
      if (this.phase === "setup") this.body.innerHTML = this._renderSetupHtml();
      else if (this.phase === "playing" || this.phase === "revealed") this.body.innerHTML = this._renderRoundHtml();
      else if (this.phase === "summary") this.body.innerHTML = this._renderSummaryHtml();
    }

    _renderSetupHtml() {
      const allBank = this._getAllBankClips();
      const filteredBank = this._getFilteredBankClips();
      const playedCount = loadPlayedHistoryIds().length;

      const catMap = new Map();
      allBank.forEach((c) => {
        if (!catMap.has(c.categoryId)) {
          catMap.set(c.categoryId, { id: c.categoryId, name: c.categoryName, icon: c.categoryIcon, count: 0 });
        }
        catMap.get(c.categoryId).count += 1;
      });

      const activePoolCount = this.sourceTab === "local" ? this.localClips.length : filteredBank.length;

      return `
        <div class="ac-stage">
          ${this._renderSetupQrSectionHtml()}

          <!-- تبويبا اختيار مصدر المقاطع -->
          <div class="ac-source-tabs" role="tablist">
            <button type="button" class="ac-tab-btn${this.sourceTab === "bank" ? " active" : ""}" data-ac-act="tab" data-val="bank">
              📚 مكتبة الأسئلة والفئات الخاصة (${allBank.length} مقطع)
            </button>
            <button type="button" class="ac-tab-btn${this.sourceTab === "local" ? " active" : ""}" data-ac-act="tab" data-val="local">
              📂 جولة سريعة من ملفات جهازك (أوفلاين) (${this.localClips.length})
            </button>
          </div>

          <section class="bank-section">
            ${
              this.sourceTab === "bank"
                ? allBank.length === 0
                  ? `
                    <div class="ac-empty-box">
                      <div class="ac-empty-icon">🎵</div>
                      <h3>لا توجد مقاطع صوتية في المكتبة أو الفئات الخاصة بعد</h3>
                      <p>يمكنك إضافة أسئلة صوتية في «فئاتي الخاصة»، أو اختيار ملفات صوتية من جهازك مباشرة!</p>
                      <div class="ac-empty-actions">
                        <button type="button" class="btn btn-amber btn-md" data-ac-act="open-pack-builder">
                          ✨ إضافة مقاطع في فئاتي الخاصة
                        </button>
                        <button type="button" class="btn btn-secondary btn-md" data-ac-act="tab" data-val="local">
                          📂 تشغيل ملفات صوتية من جهازك الآن
                        </button>
                      </div>
                    </div>
                  `
                  : `
                    <div class="bank-section-header">
                      <h3 class="bank-section-title">🎧 المقاطع المتاحة للعب الآن</h3>
                      <span class="bank-count-pill">${filteredBank.length} متاح من ${allBank.length}</span>
                    </div>
                    <div class="ac-bank-filters">
                      <select id="ac-cat-select" class="text-input ac-cat-select" aria-label="تصفية حسب الفئة">
                        <option value="all"${this.selectedCategoryId === "all" ? " selected" : ""}>🎲 الكل عشوائياً (${allBank.length})</option>
                        ${Array.from(catMap.values())
                          .map(
                            (c) =>
                              `<option value="${escapeHtml(c.id)}"${this.selectedCategoryId === c.id ? " selected" : ""}>${escapeHtml(c.icon)} ${escapeHtml(c.name)} (${c.count})</option>`
                          )
                          .join("")}
                      </select>
                      <button type="button" class="tactical-opt-btn${this.avoidPlayed ? " active" : ""}" data-ac-act="toggle-avoid-played">
                        ${this.avoidPlayed ? "✅" : "⬜"} تجنّب المقاطع الملعوبة سابقاً
                      </button>
                      ${
                        playedCount > 0
                          ? `<button type="button" class="btn btn-ghost btn-xs" data-ac-act="reset-history">🔄 تصفير السجل (${playedCount})</button>`
                          : ""
                      }
                    </div>
                  `
                : `
                  <div class="bank-section-header">
                    <h3 class="bank-section-title">📂 ملفات صوتية مؤقتة من جهازك</h3>
                    <span class="bank-count-pill">${this.localClips.length} ملف جاهز</span>
                  </div>
                  <div class="ac-local-upload-bar">
                    <label for="ac-local-files-input" class="btn btn-primary btn-sm ac-file-label">
                      ➕ اختيار ملفات صوتية من جهازك
                    </label>
                    <input type="file" id="ac-local-files-input" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.opus" multiple hidden />
                    ${this.localClips.length > 0 ? `<button type="button" class="btn btn-danger-outline btn-xs" data-ac-act="clear-local">🗑️ مسح الكل</button>` : ""}
                  </div>
                  ${
                    this.localClips.length === 0
                      ? `<div class="empty-inline-note">اختر ملفاً صوتياً أو أكثر من جهازك — سيُستخلص اسم الملف تلقائياً كإجابة مقترحة مخفية عن اللاعبين حتى الكشف.</div>`
                      : `
                        <div class="ac-local-list">
                          ${this.localClips
                            .map(
                              (clip, idx) => `
                            <div class="ac-local-item">
                              <span class="ac-local-num">#${idx + 1}</span>
                              <input type="text" class="text-input ac-local-inp" data-ac-local-answer="${escapeHtml(clip.id)}" value="${escapeHtml(clip.answer)}" placeholder="الإجابة الصحيحة" aria-label="الإجابة للمقطع ${idx + 1}" />
                              <input type="text" class="text-input ac-local-cat" data-ac-local-cat="${escapeHtml(clip.id)}" value="${escapeHtml(clip.categoryName)}" placeholder="الفئة" aria-label="فئة المقطع ${idx + 1}" />
                              <button type="button" class="btn btn-danger-outline btn-xxs" data-ac-act="remove-local" data-id="${escapeHtml(clip.id)}" title="إزالة">✕</button>
                            </div>
                          `
                            )
                            .join("")}
                        </div>
                      `
                  }
                `
            }
          </section>

          <section class="bank-section">
            <div class="bank-section-header">
              <h3 class="bank-section-title">⚙️ إعدادات الجولة والفرق</h3>
            </div>

            <div class="ac-config-grid">
              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">👥 الفرق المشاركة (2–6 فرق) أو لعب حر:</span>
                <div class="tactical-pills-row">
                  ${[2, 3, 4, 5, 6]
                    .map(
                      (n) =>
                        `<button type="button" class="tactical-opt-btn${!this.freePlay && this.teamCount === n ? " active" : ""}" data-ac-act="set-team-count" data-val="${n}">${n} فرق</button>`
                    )
                    .join("")}
                  <button type="button" class="tactical-opt-btn${this.freePlay ? " active" : ""}" data-ac-act="toggle-free-play">🎲 لعب حر بدون نقاط</button>
                </div>
                ${
                  !this.freePlay
                    ? `
                      <div class="ac-teams-inputs">
                        ${this.teamsConfig
                          .slice(0, this.teamCount)
                          .map(
                            (t, idx) => `
                          <div class="ac-team-row-inp">
                            <input type="color" class="ac-color-picker" data-ac-team-color="${idx}" value="${escapeHtml(t.color)}" aria-label="لون الفريق ${idx + 1}" />
                            <input type="text" class="text-input ac-team-text-inp" data-ac-team-name="${idx}" value="${escapeHtml(t.name)}" maxlength="24" placeholder="اسم الفريق ${idx + 1}" />
                          </div>
                        `
                          )
                          .join("")}
                      </div>
                    `
                    : ""
                }
              </div>

              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">🔢 عدد الجولات:</span>
                <div class="tactical-pills-row">
                  ${[5, 10, 15, 20, 0]
                    .map(
                      (r) =>
                        `<button type="button" class="tactical-opt-btn${this.roundsOption === r ? " active" : ""}" data-ac-act="set-rounds" data-val="${r}">${r === 0 ? "الكل" : r}</button>`
                    )
                    .join("")}
                </div>

                <span class="mafia-cfg-label" style="margin-top:8px">🎚️ نمط التشغيل والنقاط:</span>
                <div class="tactical-pills-row">
                  <button type="button" class="tactical-opt-btn${this.playbackMode === "progressive" ? " active" : ""}" data-ac-act="set-mode" data-val="progressive">🔥 تدرّج زمني (3ث=+300 • 7ث=+200 • كامل=+100)</button>
                  <button type="button" class="tactical-opt-btn${this.playbackMode === "standard" ? " active" : ""}" data-ac-act="set-mode" data-val="standard">🎵 قياسي (نقاط ثابتة + لمحة 5ث)</button>
                </div>

                ${
                  this.playbackMode === "standard"
                    ? `
                      <div class="tactical-pills-row">
                        <button type="button" class="tactical-opt-btn${this.standardPointRule === "fixed-100" ? " active" : ""}" data-ac-act="set-std-pts" data-val="fixed-100">+100 ثابتة</button>
                        <button type="button" class="tactical-opt-btn${this.standardPointRule === "question-points" ? " active" : ""}" data-ac-act="set-std-pts" data-val="question-points">نقاط السؤال الأصلية</button>
                      </div>
                    `
                    : ""
                }
              </div>
            </div>
          </section>

          <div class="mafia-setup-footer qg-setup-footer-row">
            <button type="button" class="btn btn-primary btn-lg mafia-start-btn" data-ac-act="start-session" ${activePoolCount === 0 ? "disabled" : ""}>
              🎵 ابدأ تحدي الصوت (${activePoolCount} مقطع متاح)
            </button>
            <button type="button" class="btn btn-secondary btn-md" data-ac-act="start-offline" ${activePoolCount === 0 ? "disabled" : ""}>
              ▶️ بدء اللعب مباشرة بدون هواتف
            </button>
          </div>
        </div>
      `;
    }

    _renderRoundHtml() {
      const clip = this._getCurrentClip();
      if (!clip) return "";
      const isRevealed = this.phase === "revealed";
      const pts = this._getCurrentPoints();
      const st = this.audioStatus || {};
      const qr = this.quickRoom;
      const bz = qr.buzzer || { status: "locked" };
      const isBuzzed = Boolean(bz.status === "buzzed" && bz.winnerName);
      const buzzTeamIdx = isBuzzed && Number.isInteger(bz.winnerTeamIdx) ? bz.winnerTeamIdx : null;
      const hideHostSecrets = this.fullDisplayMode || Boolean(qr.judgeUid);

      return `
        <div class="ac-stage ac-round-stage">
          ${this._renderMidgameQrDrawerHtml()}

          <!-- ترويسة الجولة -->
          <div class="ac-round-top">
            <span class="mafia-phase-pill">🎵 الجولة ${this.currentIndex + 1} / ${this.sessionClips.length}</span>
            <span class="bank-count-pill">${escapeHtml(clip.categoryIcon)} ${escapeHtml(clip.categoryName)}</span>
            ${!this.freePlay ? `<span class="ac-points-live-pill">⚡ قيمة الجولة الآن: <strong>+${pts}</strong> نقطة</span>` : ""}
          </div>

          <!-- شريط نقاط الفرق -->
          ${
            !this.freePlay
              ? `
                <div class="ac-scoreboard-strip">
                  ${this.sessionTeams
                    .map(
                      (t, idx) => `
                    <div class="ac-score-card${this.roundAwardedTeamIdx === idx ? " is-awarded" : ""}" style="border-color:${escapeHtml(t.color)}">
                      <span class="ac-team-dot" style="background:${escapeHtml(t.color)}"></span>
                      <span class="ac-score-name">${escapeHtml(t.name)}</span>
                      <strong class="ac-score-val">${t.score}</strong>
                    </div>
                  `
                    )
                    .join("")}
                </div>
              `
              : ""
          }

          <!-- شريط جرس السرعة (Auto-Pause عند الضغط) -->
          ${
            qr.active
              ? `
                <div class="ac-buzzer-bar${isBuzzed ? " is-buzzed" : ""}">
                  ${
                    isBuzzed
                      ? `
                        <div class="ac-buzz-winner">🔔 الأسرع بالجرس: <strong>${escapeHtml(bz.winnerAvatar || "🎯")} ${escapeHtml(bz.winnerName)}</strong>${bz.winnerTeamName ? ` (${escapeHtml(bz.winnerTeamName)})` : ""} — تم إيقاف الصوت تلقائياً</div>
                        ${
                          !this.fullDisplayMode
                            ? `
                              <div class="ac-buzz-actions">
                                ${
                                  !this.freePlay && buzzTeamIdx !== null && this.sessionTeams[buzzTeamIdx]
                                    ? `<button type="button" class="btn btn-steal-win btn-sm" data-ac-act="award" data-team-idx="${buzzTeamIdx}">✅ إجابة صحيحة (+${pts})</button>`
                                    : `<button type="button" class="btn btn-steal-win btn-sm" data-ac-act="reveal">✅ إجابة صحيحة وكشف</button>`
                                }
                                <button type="button" class="btn btn-danger-outline btn-sm" data-ac-act="buzzer-wrong">❌ خطأ (متابعة المقطع وإعادة فتح الجرس)</button>
                              </div>
                            `
                            : ""
                        }
                      `
                      : `
                        <span>🔔 جرس السرعة للهواتف: <strong>${bz.status === "open" ? "مفتوح الآن!" : "مقفل"}</strong></span>
                        ${!this.fullDisplayMode ? `<button type="button" class="btn btn-secondary btn-xs" data-ac-act="buzzer-open">🔔 فتح / إعادة فتح الجرس</button>` : ""}
                      `
                  }
                </div>
              `
              : ""
          }

          <!-- لوحة المشغّل الصوتي والموجة -->
          <div class="ac-player-panel">
            <div id="ac-host-visualizer" class="tv-audio-visualizer ac-host-visualizer${st.playing ? " is-playing" : ""}" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
            <div id="ac-status-label" class="ac-status-label">
              ${st.autoplayBlocked ? "🔇 اضغط تشغيل لتفعيل الصوت" : st.playing ? "🔊 جاري تشغيل المقطع الصوتي..." : "⏸️ جاهز للتشغيل"}
            </div>

            ${
              !this.fullDisplayMode
                ? `
                  <div class="ac-playback-btns">
                    <button type="button" id="ac-btn-play" class="btn btn-primary btn-md" data-ac-act="play" ${st.playing ? "hidden" : ""}>▶️ تشغيل</button>
                    <button type="button" id="ac-btn-pause" class="btn btn-amber btn-md" data-ac-act="pause" ${!st.playing ? "hidden" : ""}>⏸️ إيقاف مؤقت</button>
                    <button type="button" class="btn btn-secondary btn-md" data-ac-act="replay">🔁 إعادة</button>
                    ${this.playbackMode === "standard" ? `<button type="button" class="btn btn-gold-outline btn-md" data-ac-act="teaser-5">⚡ لمحة 5ث</button>` : ""}
                  </div>

                  ${
                    this.playbackMode === "progressive"
                      ? `
                        <div class="ac-progressive-row">
                          ${PROGRESSIVE_STAGES.map(
                            (sg) => `
                            <button type="button" class="btn ${this.progressiveStage === sg.level ? "btn-amber" : "btn-secondary"} btn-sm" data-ac-act="prog-stage" data-level="${sg.level}">
                              🎵 ${escapeHtml(sg.label)}
                            </button>
                          `
                          ).join("")}
                        </div>
                      `
                      : ""
                  }

                  <div class="ac-progress-row">
                    <span id="ac-cur-time">${formatMmSs(st.currentTime)}</span>
                    <input type="range" id="ac-seek-slider" class="ac-seek-slider" min="0" max="${st.duration > 0 ? st.duration : 100}" step="0.5" value="${st.duration > 0 ? Math.min(st.duration, st.currentTime) : 0}" ${st.duration <= 0 ? "disabled" : ""} aria-label="تقديم أو إرجاع المقطع الصوتي" />
                    <span id="ac-dur-time">${st.duration > 0 ? formatMmSs(st.duration) : "--:--"}</span>
                    <label class="ac-vol-wrap" title="مستوى الصوت">
                      🔊
                      <input type="range" id="ac-volume-slider" min="0" max="100" step="5" value="${Math.round((Number(st.volume) || 0.85) * 100)}" aria-label="مستوى صوت التحدي" />
                    </label>
                  </div>
                `
                : `
                  <div class="ac-progressive-row">
                    ${PROGRESSIVE_STAGES.map(
                      (sg) => `<span class="qg-prog-pill${this.progressiveStage === sg.level ? " active" : ""}">🎵 ${escapeHtml(sg.label)}</span>`
                    ).join("")}
                  </div>
                `
            }
          </div>

          <!-- منع تسريب صارم: لا تُعرض الإجابة في DOM إطلاقاً في العرض الكامل أو عند تعيين حكم قبل phase === revealed -->
          ${
            !isRevealed
              ? hideHostSecrets
                ? ""
                : `
                  <div class="ac-host-secret-wrap">
                    <button type="button" class="btn btn-ghost btn-xs" data-ac-act="toggle-preview">
                      ${this.hostPreviewAnswer ? "🙈 إخفاء المعاينة" : "👁️ معاينة سريعة للإجابة (للمقدّم فقط)"}
                    </button>
                    ${
                      this.hostPreviewAnswer
                        ? `<div class="ac-host-secret-box"><strong>🔒 الإجابة:</strong> ${escapeHtml(clip.answer)}${clip.explanation ? `<small> — ${escapeHtml(clip.explanation)}</small>` : ""}</div>`
                        : ""
                    }
                  </div>
                `
              : `
                <div class="ac-revealed-answer-card">
                  <div class="ac-revealed-eyebrow">✅ الإجابة الصحيحة</div>
                  <h3 class="ac-revealed-text">${escapeHtml(clip.answer)}</h3>
                  ${clip.explanation ? `<p class="ac-revealed-exp">${escapeHtml(clip.explanation)}</p>` : ""}
                  ${clip.answerImage ? `<img src="${escapeHtml(clip.answerImage)}" class="ac-revealed-img" alt="صورة الإجابة" />` : ""}
                </div>
              `
          }

          ${
            !this.fullDisplayMode
              ? `
                <div class="ac-judge-panel">
                  ${
                    !this.freePlay
                      ? `
                        <div class="ac-award-grid">
                          ${this.sessionTeams
                            .map(
                              (t, idx) => `
                            <button type="button" class="btn btn-steal-win btn-sm ac-award-btn" data-ac-act="award" data-team-idx="${idx}" style="border-color:${escapeHtml(t.color)}">
                              ✅ ${escapeHtml(t.name)} (+${pts})
                            </button>
                          `
                            )
                            .join("")}
                        </div>
                      `
                      : ""
                  }

                  <div class="ac-bottom-controls">
                    ${!isRevealed ? `<button type="button" class="btn btn-gold-outline btn-md" data-ac-act="reveal">👁️ كشف الإجابة</button>` : ""}
                    <button type="button" class="btn btn-secondary btn-sm" data-ac-act="undo" ${this.undoStack.length === 0 ? "disabled" : ""}>↩️ تراجع</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-ac-act="skip">⏭️ تخطي بدون نقاط</button>
                    <button type="button" class="btn btn-primary btn-md" data-ac-act="next">
                      ${this.currentIndex + 1 < this.sessionClips.length ? "⬅️ المقطع التالي" : "🏆 إنهاء وعرض النتائج"}
                    </button>
                  </div>
                </div>
              `
              : ""
          }
        </div>
      `;
    }

    _renderSummaryHtml() {
      const ranked = this.sessionTeams.slice().sort((a, b) => b.score - a.score);
      const isDraw = ranked.length > 1 && ranked[0].score === ranked[1].score;
      return `
        <div class="ac-stage mafia-center-stage">
          <div class="mafia-winner-icon">🎵🏆</div>
          <h2 class="mafia-big-title">
            ${this.freePlay ? "انتهت جولة تحدي الصوت الحر!" : isDraw ? "تعادل مثير في قمة تحدي الصوت!" : `الفائز: ${escapeHtml((ranked[0] && ranked[0].name) || "—")}`}
          </h2>
          <p class="mafia-big-sub">تم تشغيل ${this.sessionClips.length} مقطعاً صوتياً بنجاح!</p>

          ${
            !this.freePlay
              ? `
                <div class="ac-summary-standings">
                  ${ranked
                    .map(
                      (t, idx) => `
                    <div class="ac-summary-row${idx === 0 ? " is-first" : ""}" style="border-color:${escapeHtml(t.color)}">
                      <span>${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`} <strong>${escapeHtml(t.name)}</strong></span>
                      <span>${t.correctCount} إجابة • <strong>${t.score} نقطة</strong></span>
                    </div>
                  `
                    )
                    .join("")}
                </div>
              `
              : ""
          }

          <div class="mafia-host-actions">
            ${
              !this.freePlay
                ? `<button type="button" class="btn btn-gold-outline btn-lg" data-ac-act="result-card">📸 حفظ / مشاركة بطاقة النتيجة</button>`
                : ""
            }
            <button type="button" class="btn btn-primary btn-lg" data-ac-act="new-session">🔄 جولة جديدة</button>
            <button type="button" class="btn btn-secondary btn-md" data-ac-act="exit-home">⬅️ القائمة الرئيسية</button>
          </div>
        </div>
      `;
    }
  }

  window.SeenJeemAudioChallengeMode = new AudioChallengeModeController();
  window.SeenJeemAudioChallengeModeUtils = {
    HISTORY_STORAGE_KEY,
    PROGRESSIVE_STAGES,
    extractAnswerFromFilename,
    loadPlayedHistoryIds,
    savePlayedHistoryIds,
    clearPlayedHistory,
    collectAudioQuestionsFromCategories,
    computeAvailablePoints
  };
})();
