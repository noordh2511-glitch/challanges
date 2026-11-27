/**
 * طور «تحدي الصوت» المستقل (Standalone Audio Challenge Mode — Pack 15)
 * - آلة حالات من 4 مراحل: setup -> playing -> revealed -> summary
 * - مصدران للمقاطع:
 *   1) بنك الأسئلة والفئات الخاصة (visualType === "audio" أو audioUrl صالح) مع سجل عدم تكرار خفيف (audio-challenge-history-v1)
 *   2) جولة سريعة من ملفات جهاز المقدّم (MP3/WAV/M4A/OGG) عبر ObjectURL مؤقت بالذاكرة يُحرّر تلقائياً عند الخروج
 * - نمطان للتشغيل والنقاط:
 *   1) القياسي (نقاط ثابتة + لمحة 5ث)
 *   2) التدرّج الزمني Progressive Snippets: 3ث (+300) -> 7ث (+200) -> كامل (+100)
 * - إعادة استخدام كاملة لمشغّل audioChallengePlayer.js مع Anti-Echo وAuto-Pause تلقائي عند جرس السرعة
 * - منع تسريب مطلق: لا يُرسل answer أو answerImage أو audioSrc أو اسم الملف إلى شاشة التلفزيون أو publicState قبل الكشف
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

  /**
   * جمع جميع الأسئلة الصوتية المتاحة من بنك الأسئلة (Sheets + Local + Custom Packs)
   */
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
      this.roundsOption = 10; // 5 | 10 | 15 | 20 | 0 (all)
      this.playbackMode = "progressive"; // "standard" | "progressive"
      this.standardPointRule = "fixed-100"; // "fixed-100" | "question-points"
      this.localClips = []; // [{ id, audioUrl (ObjectURL), answer, categoryName, ... }]

      // حالة الجلسة النشطة
      this.phase = "setup"; // setup | playing | revealed | summary
      this.sessionTeams = [];
      this.sessionClips = [];
      this.currentIndex = 0;
      this.progressiveStage = 0; // 0 (3s/+300) | 1 (7s/+200) | 2 (full/+100)
      this.hostPreviewAnswer = false;
      this.roundAwardedTeamIdx = null;
      this.roundAwardedPoints = 0;
      this.roundHistory = []; // [{ clipId, answer, awardedTeamIdx, points }]
      this.undoStack = [];
      this.audioRoutePref = "display"; // "display" | "host"
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
    }

    init() {
      this.modal = document.getElementById("audio-challenge-modal");
      this.body = document.getElementById("audio-challenge-body");
      if (!this.modal || !this.body) return;

      const btnClose = document.getElementById("btn-close-audio-challenge");
      const btnOpenTv = document.getElementById("btn-ac-open-tv");
      const btnOpenWireless = document.getElementById("btn-ac-open-wireless");

      if (btnClose) btnClose.addEventListener("click", () => this.close());
      if (btnOpenTv) {
        btnOpenTv.addEventListener("click", () => {
          if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openTVDisplayWindow === "function") {
            window.SeenJeemHostBridge.openTVDisplayWindow();
          }
        });
      }
      if (btnOpenWireless) {
        btnOpenWireless.addEventListener("click", () => {
          if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openWirelessRoomModal === "function") {
            window.SeenJeemHostBridge.openWirelessRoomModal();
          }
        });
      }

      this.modal.addEventListener("click", (e) => {
        if (e.target === this.modal) this.close();
      });

      this.body.addEventListener("click", (e) => this._handleBodyClick(e));
      this.body.addEventListener("input", (e) => this._handleBodyInput(e));
      this.body.addEventListener("change", (e) => this._handleBodyChange(e));

      if (window.SeenJeemAudioChallenge && typeof window.SeenJeemAudioChallenge.onChange === "function") {
        this._playerUnsub = window.SeenJeemAudioChallenge.onChange((st) => {
          if (!this.isOpenFlag || (this.phase !== "playing" && this.phase !== "revealed")) return;
          if (this._getEffectiveRoute() !== "host") return;
          const prevPlaying = Boolean(this.audioStatus.playing);
          this.audioStatus = { ...this.audioStatus, ...st };
          this._updateLiveAudioControlsDOM();
          const secInt = Math.floor(Number(st.currentTime) || 0);
          if (prevPlaying !== Boolean(st.playing)) {
            this._broadcastAll(false);
          } else if (secInt !== this._lastBroadcastTimeSec) {
            this._lastBroadcastTimeSec = secInt;
            this._broadcastAll(true);
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
      this.modal.classList.add("open");
      this.modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      this._render();
      this._broadcastAll(false);
    }

    close() {
      if (!this.modal) return;
      this.stopPlayback();
      this.revokeAllLocalObjectUrls();
      this.phase = "setup";
      this.isOpenFlag = false;
      this.modal.classList.remove("open");
      this.modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      this._broadcastAll(false);
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

    _isDualConnected() {
      return Boolean(
        window.SeenJeemHostBridge &&
          typeof window.SeenJeemHostBridge.isDualScreenConnected === "function" &&
          window.SeenJeemHostBridge.isDualScreenConnected()
      );
    }

    _getWirelessInfo() {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.getWirelessInfo === "function") {
        return window.SeenJeemHostBridge.getWirelessInfo();
      }
      return { active: false, roomCode: "", buzzer: null };
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

    _getEffectiveRoute() {
      const clip = this._getCurrentClip();
      // حماية حتمية: روابط ObjectURL (blob:) من ملفات محلية تُشغّل على جهاز المقدّم لمنع فشلها بين نوافذ مختلفة بدون أي خطأ Console
      if (clip && clip.isLocalFile) return "host";
      return this._isDualConnected() && this.audioRoutePref !== "host" ? "display" : "host";
    }

    _getCurrentPoints() {
      return computeAvailablePoints(
        this._getCurrentClip(),
        this.playbackMode,
        this.progressiveStage,
        this.standardPointRule
      );
    }

    /* =========================================================
       التحكم بالصوت وإيقافه التلقائي (إعادة استخدام audioChallengePlayer.js)
       ========================================================= */
    stopPlayback() {
      if (window.SeenJeemAudioChallenge) {
        window.SeenJeemAudioChallenge.stop();
      }
      if (this._isDualConnected() && window.SeenJeemLiveSync && typeof window.SeenJeemLiveSync.broadcastAudioControl === "function") {
        window.SeenJeemLiveSync.broadcastAudioControl("STOP", {});
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

      const route = this._getEffectiveRoute();
      if (action === "STOP") {
        this.stopPlayback();
        this._updateLiveAudioControlsDOM();
        this._broadcastAll(false);
        return;
      }

      const src = clip.audioUrl;
      const clipStart = Number(clip.audioStart) || 0;
      const clipEnd = clip.audioEnd;

      if (route === "display" && window.SeenJeemLiveSync && typeof window.SeenJeemLiveSync.broadcastAudioControl === "function") {
        // Anti-Echo: إيقاف الصوت على جهاز المقدّم فوراً
        if (window.SeenJeemAudioChallenge) window.SeenJeemAudioChallenge.pause();
        window.SeenJeemLiveSync.broadcastAudioControl(action, {
          ...payload,
          src,
          clipStart,
          clipEnd,
          questionId: clip.id
        });
        if (action === "PLAY" || action === "REPLAY" || action === "TEASER_5S") {
          this.audioStatus.playing = true;
          this.audioStatus.teaserActive = action === "TEASER_5S";
        } else if (action === "PAUSE") {
          this.audioStatus.playing = false;
          this.audioStatus.teaserActive = false;
        }
        this._updateLiveAudioControlsDOM();
        this._broadcastAll(false);
        return;
      }

      // تشغيل محلي على جهاز المقدّم (مع إيقاف التلفزيون لمنع الصدى)
      if (this._isDualConnected() && window.SeenJeemLiveSync && typeof window.SeenJeemLiveSync.broadcastAudioControl === "function") {
        window.SeenJeemLiveSync.broadcastAudioControl("PAUSE", {});
      }
      const player = window.SeenJeemAudioChallenge;
      if (!player) return;
      player.load(src, { start: clipStart, end: clipEnd, questionId: clip.id });
      if (action === "PLAY") await player.play();
      else if (action === "PAUSE") player.pause();
      else if (action === "REPLAY") await player.replay();
      else if (action === "TEASER_5S") await player.playTeaser(Number(payload.seconds) || 5);
      else if (action === "SEEK") player.seek(Number(payload.seconds) || 0);
      else if (action === "SET_VOLUME") player.setVolume(Number(payload.volume));

      this.audioStatus = { ...this.audioStatus, ...player.getState() };
      this._updateLiveAudioControlsDOM();
      this._broadcastAll(false);
    }

    onDisplayAudioStatus(st) {
      if (!this.isOpenFlag || !st) return;
      if (this._getEffectiveRoute() !== "display") return;
      const prevPlaying = Boolean(this.audioStatus.playing);
      this.audioStatus = { ...this.audioStatus, ...st };
      this._updateLiveAudioControlsDOM();
      if (prevPlaying !== Boolean(st.playing)) {
        this._broadcastAll(false);
      }
    }

    /**
     * يُستدعى تلقائياً من app.js فور ضغط أول فريق على جرس السرعة اللاسلكي!
     */
    onWirelessBuzz(buzzerInfo) {
      if (!this.isOpenFlag || this.phase !== "playing") return;
      // Auto-Pause فوري للمقطع الصوتي ليتحدث الفريق بوضوح
      this.triggerAudioAction("PAUSE");
      this._render();
      this._broadcastAll(false);
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

    startSession() {
      const pool = this.sourceTab === "local" ? this.localClips.slice() : this._getFilteredBankClips();
      if (pool.length === 0) {
        this._toast(
          this.sourceTab === "local"
            ? "⚠️ يرجى اختيار ملف صوتي واحد على الأقل من جهازك أولاً"
            : "⚠️ لا توجد مقاطع صوتية متاحة — أضفها من صانع الفئات أو اختر ملفات محلية",
          "warning"
        );
        return;
      }

      const shuffled = shuffleArray(pool);
      const count = this.roundsOption > 0 ? Math.min(this.roundsOption, shuffled.length) : shuffled.length;
      this.sessionClips = shuffled.slice(0, count);

      this.sessionTeams = this.freePlay
        ? []
        : this.teamsConfig.slice(0, Math.min(6, Math.max(2, this.teamCount))).map((t, idx) => ({
            id: `ac-team-${idx}`,
            name: (t.name || DEFAULT_TEAM_NAMES[idx]).trim().slice(0, 24) || DEFAULT_TEAM_NAMES[idx],
            color: t.color || TEAM_COLORS[idx % TEAM_COLORS.length],
            score: 0,
            correctCount: 0
          }));

      this.currentIndex = 0;
      this.roundHistory = [];
      this.undoStack = [];
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
      if (clip && this._getEffectiveRoute() === "host" && window.SeenJeemAudioChallenge) {
        window.SeenJeemAudioChallenge.load(clip.audioUrl, {
          start: clip.audioStart,
          end: clip.audioEnd,
          questionId: clip.id
        });
      }

      // إذا كانت الغرفة اللاسلكية نشطة، نفتح الجرس تلقائياً لكل مقطع جديد
      if (
        this._getWirelessInfo().active &&
        window.SeenJeemHostBridge &&
        typeof window.SeenJeemHostBridge.openSpeedBuzzer === "function"
      ) {
        window.SeenJeemHostBridge.openSpeedBuzzer();
      }

      this._render();
      this._broadcastAll(false);
    }

    setProgressiveStage(level, autoPlay = true) {
      const clamped = Math.min(2, Math.max(0, Number(level) || 0));
      this.progressiveStage = clamped;
      this._render();
      this._broadcastAll(false);

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
      this.phase = "revealed";
      const clip = this._getCurrentClip();
      if (clip) markClipPlayedInHistory(clip.id);
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playReveal === "function") {
        window.SeenJeemAudio.playReveal();
      }
      this._render();
      this._broadcastAll(false);
    }

    awardTeam(teamIdx) {
      if (this.phase !== "playing" && this.phase !== "revealed") return;
      const clip = this._getCurrentClip();
      if (!clip) return;

      this._pushUndoSnapshot();
      this.triggerAudioAction("PAUSE");

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

      if (
        this._getWirelessInfo().active &&
        window.SeenJeemHostBridge &&
        typeof window.SeenJeemHostBridge.lockSpeedBuzzer === "function"
      ) {
        window.SeenJeemHostBridge.lockSpeedBuzzer();
      }

      this._render();
      this._broadcastAll(false);
    }

    handleBuzzerWrongContinue() {
      if (this.phase !== "playing") return;
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playNoScore === "function") {
        window.SeenJeemAudio.playNoScore();
      }
      if (
        this._getWirelessInfo().active &&
        window.SeenJeemHostBridge &&
        typeof window.SeenJeemHostBridge.openSpeedBuzzer === "function"
      ) {
        window.SeenJeemHostBridge.openSpeedBuzzer();
      }
      this._toast("❌ إجابة خاطئة — أُعيد فتح الجرس ويمكن متابعة المقطع!", "info");
      this.triggerAudioAction("PLAY");
      this._render();
      this._broadcastAll(false);
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
      this.phase = "summary";
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playVictory === "function") {
        window.SeenJeemAudio.playVictory();
      }
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.triggerConfetti === "function") {
        window.SeenJeemHostBridge.triggerConfetti("victory", "default");
      }
      this._render();
      this._broadcastAll(false);
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
      this._broadcastAll(false);
    }

    /**
     * معالجة أوامر ريموت المقدّم (?mode=remote)
     */
    handleRemoteCommand(payload = {}) {
      if (!this.isOpenFlag) return;
      const act = payload.action;
      if (act === "play") this.triggerAudioAction("PLAY");
      else if (act === "pause") this.triggerAudioAction("PAUSE");
      else if (act === "replay") this.triggerAudioAction("REPLAY");
      else if (act === "teaser") this.triggerAudioAction("TEASER_5S", { seconds: Number(payload.seconds) || 5 });
      else if (act === "stage") this.setProgressiveStage(Number(payload.level) || 0, true);
      else if (act === "reveal") this.revealAnswer();
      else if (act === "award") this.awardTeam(payload.teamIdx === null || payload.teamIdx === undefined ? null : Number(payload.teamIdx));
      else if (act === "buzzer-wrong") this.handleBuzzerWrongContinue();
      else if (act === "skip") this.skipRound();
      else if (act === "next") this.nextRound();
      else if (act === "undo") this.undoLastAction();
    }

    /* =========================================================
       حزم التلفزيون وريموت المقدّم (Anti-Spoiler 100%)
       ========================================================= */
    buildSanitizedDisplayPayload() {
      const clip = this._getCurrentClip();
      const isRevealed = this.phase === "revealed";
      const st = this.audioStatus || {};
      const stage = PROGRESSIVE_STAGES[this.progressiveStage] || PROGRESSIVE_STAGES[0];
      const ranked = this.sessionTeams.slice().sort((a, b) => b.score - a.score);

      return {
        phase: this.phase,
        roundNumber: this.currentIndex + 1,
        totalRounds: this.sessionClips.length,
        categoryName: clip ? clip.categoryName : "تحدي الصوت",
        categoryIcon: clip ? clip.categoryIcon : "🎵",
        questionText: clip ? clip.questionText : "",
        playbackMode: this.playbackMode,
        progressiveStage: this.progressiveStage,
        progressiveLabel: stage.label,
        currentPoints: this._getCurrentPoints(),
        freePlay: this.freePlay,
        teams: this.sessionTeams.map((t) => ({ id: t.id, name: t.name, color: t.color, score: t.score, correctCount: t.correctCount })),
        audioState: {
          playing: Boolean(st.playing),
          teaserActive: Boolean(st.teaserActive),
          currentTime: Number(st.currentTime) || 0,
          duration: Number(st.duration) || 0,
          autoplayBlocked: Boolean(st.autoplayBlocked),
          route: this._getEffectiveRoute(),
          isLocalFile: Boolean(clip && clip.isLocalFile)
        },
        // منع تسريب صارم: الإجابة وصورة الإجابة والشرح لا تُرسل مطلقاً قبل phase === "revealed"
        revealedAnswer: isRevealed && clip ? clip.answer : null,
        revealedExplanation: isRevealed && clip ? clip.explanation : null,
        revealedAnswerImage: isRevealed && clip && clip.answerImage ? clip.answerImage : null,
        roundAwardedTeamIdx: isRevealed ? this.roundAwardedTeamIdx : null,
        roundAwardedPoints: isRevealed ? this.roundAwardedPoints : 0,
        summary:
          this.phase === "summary"
            ? {
                totalPlayed: this.sessionClips.length,
                standings: ranked,
                winnerName: ranked[0] ? ranked[0].name : null,
                isDraw: ranked.length > 1 && ranked[0].score === ranked[1].score
              }
            : null
      };
    }

    buildHostPrivatePayload() {
      const clip = this._getCurrentClip();
      if (!clip || (this.phase !== "playing" && this.phase !== "revealed")) return null;
      return {
        answer: clip.answer,
        explanation: clip.explanation || "",
        categoryName: clip.categoryName,
        currentPoints: this._getCurrentPoints(),
        playbackMode: this.playbackMode,
        progressiveStage: this.progressiveStage
      };
    }

    _broadcastAll(skipWireless = false) {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.broadcastTV === "function") {
        window.SeenJeemHostBridge.broadcastTV({ skipWireless });
      }
    }

    /* =========================================================
       التفاعل ورسم واجهة المقدّم
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
          this._render();
          break;
        case "set-team-count":
          this.freePlay = false;
          this.teamCount = Math.min(6, Math.max(2, Number(btn.dataset.val) || 2));
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
        case "open-wireless":
          if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openWirelessRoomModal === "function") {
            window.SeenJeemHostBridge.openWirelessRoomModal();
          }
          break;
        case "start-session":
          this.startSession();
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
        case "toggle-route":
          this.stopPlayback();
          this.audioRoutePref = this.audioRoutePref === "host" ? "display" : "host";
          this._render();
          this._broadcastAll(false);
          break;
        case "toggle-preview":
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
          if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openSpeedBuzzer === "function") {
            window.SeenJeemHostBridge.openSpeedBuzzer();
            this._render();
          }
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
          this._broadcastAll(false);
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
        if (this.teamsConfig[idx]) this.teamsConfig[idx].name = t.value;
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
          ? "🔇 يرجى النقر على شاشة التلفزيون لتفعيل الصوت"
          : st.error
            ? `⚠️ ${st.error}`
            : st.playing
              ? "🔊 جاري تشغيل المقطع الصوتي..."
              : "⏸️ جاهز / متوقف مؤقتاً";
      }
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
      const wl = this._getWirelessInfo();

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
          <!-- تبويبا اختيار مصدر المقاطع -->
          <div class="ac-source-tabs" role="tablist">
            <button type="button" class="ac-tab-btn${this.sourceTab === "bank" ? " active" : ""}" data-ac-act="tab" data-val="bank">
              📚 بنك الأسئلة والفئات الخاصة (${allBank.length} مقطع)
            </button>
            <button type="button" class="ac-tab-btn${this.sourceTab === "local" ? " active" : ""}" data-ac-act="tab" data-val="local">
              📂 جولة سريعة من ملفات جهازك (أوفلاين) (${this.localClips.length})
            </button>
          </div>

          <!-- مصدر المقاطع -->
          <section class="bank-section">
            ${
              this.sourceTab === "bank"
                ? allBank.length === 0
                  ? `
                    <div class="ac-empty-box">
                      <div class="ac-empty-icon">🎵</div>
                      <h3>لا توجد أسئلة صوتية في البنك أو الفئات الخاصة بعد</h3>
                      <p>يمكنك إضافة أسئلة صوتية (MP3 / WAV / رابط مباشر) في صانع الفئات الخاصة، أو تجربة تبويب «📂 جولة سريعة من ملفات جهازك» فوراً!</p>
                      <div class="ac-empty-actions">
                        <button type="button" class="btn btn-amber btn-md" data-ac-act="open-pack-builder">
                          ✨ إضافة أسئلة صوتية في صانع الفئات الخاصة
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
                    <h3 class="bank-section-title">📂 ملفات صوتية مؤقتة من جهازك (تُحذف من الذاكرة عند الإغلاق)</h3>
                    <span class="bank-count-pill">${this.localClips.length} ملف جاهز</span>
                  </div>
                  <div class="ac-local-upload-bar">
                    <label for="ac-local-files-input" class="btn btn-primary btn-sm ac-file-label">
                      ➕ اختيار ملفات صوتية (MP3 / WAV / M4A / OGG)
                    </label>
                    <input type="file" id="ac-local-files-input" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.opus" multiple hidden />
                    ${this.localClips.length > 0 ? `<button type="button" class="btn btn-danger-outline btn-xs" data-ac-act="clear-local">🗑️ مسح الكل</button>` : ""}
                  </div>
                  ${
                    this.localClips.length === 0
                      ? `<div class="empty-inline-note">اختر ملفاً صوتياً أو أكثر من جهازك — سيُستخلص اسم الملف تلقائياً كإجابة مقترحة للمقدّم فقط دون تسريبها للجمهور.</div>`
                      : `
                        <div class="ac-local-list">
                          ${this.localClips
                            .map(
                              (clip, idx) => `
                            <div class="ac-local-item">
                              <span class="ac-local-num">#${idx + 1}</span>
                              <input type="text" class="text-input ac-local-inp" data-ac-local-answer="${escapeHtml(clip.id)}" value="${escapeHtml(clip.answer)}" placeholder="الإجابة الصحيحة (للمقدّم فقط)" aria-label="الإجابة للمقطع ${idx + 1}" />
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

          <!-- إعداد الفرق والجولات ونمط التدرّج -->
          <section class="bank-section">
            <div class="bank-section-header">
              <h3 class="bank-section-title">⚙️ إعدادات الجولة والفرق</h3>
              <button type="button" class="btn btn-secondary btn-xs" data-ac-act="open-wireless">
                ${wl.active ? `📡 الغرفة نشطة (${escapeHtml(wl.roomCode)}) • جرس السرعة جاهز` : "📡 فتح غرفة لاسلكية لجرس السرعة (QR)"}
              </button>
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

          <div class="mafia-setup-footer">
            <button type="button" class="btn btn-primary btn-lg mafia-start-btn" data-ac-act="start-session" ${activePoolCount === 0 ? "disabled" : ""}>
              🎵 ابدأ تحدي الصوت (${activePoolCount} مقطع متاح)
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
      const route = this._getEffectiveRoute();
      const st = this.audioStatus || {};
      const wl = this._getWirelessInfo();
      const bz = wl.active ? wl.buzzer : null;
      const isBuzzed = Boolean(bz && bz.state === "buzzed" && bz.winnerTeamName);
      const buzzTeamIdx = isBuzzed && Number.isInteger(bz.winnerTeamIdx) ? bz.winnerTeamIdx : null;

      return `
        <div class="ac-stage ac-round-stage">
          <!-- ترويسة الجولة -->
          <div class="ac-round-top">
            <span class="mafia-phase-pill">🎵 الجولة ${this.currentIndex + 1} / ${this.sessionClips.length}</span>
            <span class="bank-count-pill">${escapeHtml(clip.categoryIcon)} ${escapeHtml(clip.categoryName)}</span>
            ${!this.freePlay ? `<span class="ac-points-live-pill">⚡ قيمة الجولة الآن: <strong>+${pts}</strong> نقطة</span>` : ""}
            ${
              this._isDualConnected()
                ? `<button type="button" class="btn btn-ghost btn-xxs" data-ac-act="toggle-route" ${clip.isLocalFile ? "disabled title='الملفات المحلية تعمل تلقائياً على جهاز المقدّم لضمان عدم تعطل ObjectURL'" : ""}>
                    ${route === "display" ? "📺 الصوت: التلفزيون فقط (بلا صدى)" : clip.isLocalFile ? "💻 الصوت: الجهاز الرئيسي (ملف محلي)" : "💻 الصوت: جهاز المقدّم"}
                  </button>`
                : ""
            }
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

          <!-- شريط جرس السرعة اللاسلكي (Auto-Pause عند الضغط) -->
          ${
            wl.active
              ? `
                <div class="ac-buzzer-bar${isBuzzed ? " is-buzzed" : ""}">
                  ${
                    isBuzzed
                      ? `
                        <div class="ac-buzz-winner">🔔 الأسرع بالجرس: <strong>${escapeHtml(bz.winnerTeamName)}</strong> (تم إيقاف الصوت تلقائياً)</div>
                        <div class="ac-buzz-actions">
                          ${
                            !this.freePlay && buzzTeamIdx !== null && this.sessionTeams[buzzTeamIdx]
                              ? `<button type="button" class="btn btn-steal-win btn-sm" data-ac-act="award" data-team-idx="${buzzTeamIdx}">✅ إجابة صحيحة (+${pts})</button>`
                              : `<button type="button" class="btn btn-steal-win btn-sm" data-ac-act="reveal">✅ إجابة صحيحة وكشف</button>`
                          }
                          <button type="button" class="btn btn-danger-outline btn-sm" data-ac-act="buzzer-wrong">❌ خطأ (متابعة المقطع وإعادة فتح الجرس)</button>
                        </div>
                      `
                      : `
                        <span>🔔 جرس السرعة اللاسلكي: <strong>${bz && bz.state === "open" ? "مفتوح للفرق الآن!" : "مقفل"}</strong></span>
                        <button type="button" class="btn btn-secondary btn-xs" data-ac-act="buzzer-open">🔔 فتح / إعادة فتح الجرس</button>
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
              ${st.autoplayBlocked ? "🔇 يرجى النقر على شاشة التلفزيون لتفعيل الصوت" : st.playing ? "🔊 جاري تشغيل المقطع الصوتي..." : "⏸️ جاهز للتشغيل"}
            </div>

            <div class="ac-playback-btns">
              <button type="button" id="ac-btn-play" class="btn btn-primary btn-md" data-ac-act="play" ${st.playing ? "hidden" : ""}>▶️ تشغيل</button>
              <button type="button" id="ac-btn-pause" class="btn btn-amber btn-md" data-ac-act="pause" ${!st.playing ? "hidden" : ""}>⏸️ إيقاف مؤقت</button>
              <button type="button" class="btn btn-secondary btn-md" data-ac-act="replay">🔁 إعادة</button>
              ${
                this.playbackMode === "standard"
                  ? `<button type="button" class="btn btn-gold-outline btn-md" data-ac-act="teaser-5">⚡ لمحة 5ث</button>`
                  : ""
              }
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
          </div>

          <!-- معاينة الإجابة للمقدّم فقط / أو بطاقة الكشف -->
          ${
            !isRevealed
              ? `
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

          <!-- أزرار التحكيم السريع ومنح النقاط -->
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
            <button type="button" class="btn btn-secondary btn-md" data-ac-act="exit-home">العودة للرئيسية</button>
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
