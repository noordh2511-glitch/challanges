/**
 * محرك وواجهة طور «🏁 تحدي الكل» — سباق إجابات اختيار من متعدد جماعي بالهواتف (Pack 19)
 * - يبني أسئلة اختيار من متعدد من 4 خيارات فريدة تلقائياً من بنك «سين جيم» وفئات المستخدم الخاصة
 * - آلة حالات من 5 مراحل: setup -> question (عدّاد 3..2..1 + مؤقت حي + ▲◆●■) -> reveal (إحصائية الأعمدة + النقاط) -> leaderboard (أفضل 5 + 🔥 + أسهم الترتيب) -> game_over (منصة 1/2/3 + Confetti + بطاقة نتيجة PNG)
 * - منع تسريب صارم: لا يُرسل correctIndex إلى publicState أو DOM قبل لحظة الكشف
 * - حفظ إحصائيات السباقات المكتملة في قاعة المشاهير (quiz-race-stats-v1) وبروفايل اللاعب
 */
(function () {
  "use strict";

  const OPTION_STYLES = Object.freeze([
    { key: "red", shape: "▲", letter: "أ" },
    { key: "blue", shape: "◆", letter: "ب" },
    { key: "amber", shape: "●", letter: "ج" },
    { key: "green", shape: "■", letter: "د" }
  ]);

  const MAX_ANSWER_LEN = 90;
  const UNSUITABLE_VISUAL_TYPES = new Set([
    "differences",
    "spot-diff",
    "audio",
    "mgk-movies",
    "mgk-series",
    "mgk-proverbs",
    "mgk-songs",
    "mgk-jobs",
    "mgk-animals",
    "mgk-objects",
    "mgk-actions"
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

  function normalizeArabicAnswer(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/[.,!؟?؛:«»"'()\[\]-]/g, " ")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
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

  function resolveMainGroupId(cat) {
    if (!cat || typeof cat !== "object") return "general-misc";
    if (window.SeenJeemCategoryBrowser && typeof window.SeenJeemCategoryBrowser.resolveMainCategoryId === "function") {
      return window.SeenJeemCategoryBrowser.resolveMainCategoryId(cat);
    }
    if (typeof cat.mainCategoryId === "string" && cat.mainCategoryId.trim()) return cat.mainCategoryId.trim();
    if (cat.isCustom) return "custom-packs";
    return "general-misc";
  }

  function isQuestionEligible(q, cat) {
    if (!q || typeof q !== "object") return false;
    const vt = typeof q.visualType === "string" ? q.visualType.trim().toLowerCase() : "normal";
    if (UNSUITABLE_VISUAL_TYPES.has(vt) || vt.startsWith("mgk-")) return false;
    if (cat && (cat.isCharades || String(cat.id || "").includes("charades") || String(cat.id || "").includes("diff"))) {
      return false;
    }
    const prompt = typeof q.question === "string" ? q.question.trim() : "";
    const ans = typeof q.answer === "string" ? q.answer.trim() : "";
    if (!prompt || !ans || ans.length > MAX_ANSWER_LEN) return false;
    if (!normalizeArabicAnswer(ans)) return false;
    return true;
  }

  /**
   * بناء مجموعة أسئلة اختيار من متعدد (4 خيارات فريدة لكل سؤال) من بنك «سين جيم» وفئات المستخدم
   * - يستخدم options/choices الجاهزة إن توفرت (4 خيارات فريدة)
   * - وإلا يسحب 3 بدائل فريدة من نفس الفئة الفرعية أولاً ثم نفس الفئة الرئيسية
   * - يستبعد أي سؤال لا تتوفر له 3 بدائل مميزة أو إجابته > 90 حرفاً أو من نوع فروقات
   */
  function buildQuizRaceDeck({
    categories = [],
    scope = "all", // "all" | "main" | "sub"
    selectedMainId = "",
    selectedSubIds = [],
    questionCount = 10,
    rng = Math.random
  } = {}) {
    const allCats = Array.isArray(categories) ? categories.filter((c) => c && Array.isArray(c.questions)) : [];

    // فهرسة جميع الإجابات الصالحة حسب الفئة الفرعية وحسب الفئة الرئيسية
    const answersBySubId = new Map();
    const answersByMainId = new Map();
    const subSet = new Set(Array.isArray(selectedSubIds) ? selectedSubIds : []);

    allCats.forEach((cat) => {
      const subId = String(cat.id || cat.name || "");
      const mainId = resolveMainGroupId(cat);
      if (!answersBySubId.has(subId)) answersBySubId.set(subId, []);
      if (!answersByMainId.has(mainId)) answersByMainId.set(mainId, []);

      cat.questions.forEach((q) => {
        if (!isQuestionEligible(q, cat)) return;
        const ans = q.answer.trim();
        answersBySubId.get(subId).push(ans);
        answersByMainId.get(mainId).push(ans);
      });
    });

    const filteredCats = allCats.filter((cat) => {
      const subId = String(cat.id || cat.name || "");
      const mainId = resolveMainGroupId(cat);
      if (scope === "main" && selectedMainId) return mainId === selectedMainId;
      if (scope === "sub" && subSet.size > 0) return subSet.has(subId);
      return true;
    });

    const candidates = [];
    const seenQIds = new Set();

    filteredCats.forEach((cat) => {
      const subId = String(cat.id || cat.name || "");
      const mainId = resolveMainGroupId(cat);
      const subPool = answersBySubId.get(subId) || [];
      const mainPool = answersByMainId.get(mainId) || [];

      cat.questions.forEach((q, idx) => {
        if (!isQuestionEligible(q, cat)) return;
        const qId = String(q.id || `qr_${subId}_${idx}`);
        if (seenQIds.has(qId)) return;

        const correctAnswer = q.answer.trim();
        const correctNorm = normalizeArabicAnswer(correctAnswer);
        let rawOptions = null;

        // 1) خيارات مدمجة جاهزة (options أو choices)
        const nativeArr = Array.isArray(q.options) ? q.options : Array.isArray(q.choices) ? q.choices : null;
        if (nativeArr && nativeArr.length >= 4) {
          const uniq = [];
          const seenNorm = new Set();
          nativeArr.forEach((opt) => {
            const txt = String(opt || "").trim();
            const nrm = normalizeArabicAnswer(txt);
            if (txt && txt.length <= MAX_ANSWER_LEN && nrm && !seenNorm.has(nrm)) {
              seenNorm.add(nrm);
              uniq.push(txt);
            }
          });
          if (uniq.length >= 4 && seenNorm.has(correctNorm)) {
            const others = uniq.filter((x) => normalizeArabicAnswer(x) !== correctNorm).slice(0, 3);
            if (others.length === 3) {
              rawOptions = [correctAnswer, ...others];
            }
          }
        }

        // 2) توليد 3 بدائل فريدة من نفس الفئة الفرعية أولاً ثم الرئيسية
        if (!rawOptions) {
          const distractors = [];
          const usedNorm = new Set([correctNorm]);

          const pullFromPool = (pool) => {
            const shuffled = shuffleArray(pool, rng);
            for (let i = 0; i < shuffled.length && distractors.length < 3; i++) {
              const cand = String(shuffled[i] || "").trim();
              const nrm = normalizeArabicAnswer(cand);
              if (cand && cand.length <= MAX_ANSWER_LEN && nrm && !usedNorm.has(nrm)) {
                usedNorm.add(nrm);
                distractors.push(cand);
              }
            }
          };

          pullFromPool(subPool);
          if (distractors.length < 3) pullFromPool(mainPool);
          if (distractors.length < 3) return; // استبعاد السؤال عند نقص البدائل المميزة
          rawOptions = [correctAnswer, ...distractors];
        }

        const shuffledOptions = shuffleArray(rawOptions, rng);
        const correctIndex = shuffledOptions.findIndex((o) => normalizeArabicAnswer(o) === correctNorm);
        if (correctIndex < 0 || shuffledOptions.length !== 4) return;

        seenQIds.add(qId);
        const imgRaw = typeof q.image === "string" && q.image.trim() ? q.image.trim() : typeof q.imageUrl === "string" ? q.imageUrl.trim() : "";

        candidates.push({
          id: qId,
          prompt: q.question.trim(),
          imageUrl: imgRaw,
          options: shuffledOptions,
          correctIndex,
          correctAnswer: shuffledOptions[correctIndex],
          explanation: typeof q.explanation === "string" ? q.explanation.trim() : "",
          answerImage: typeof q.answerImage === "string" ? q.answerImage.trim() : "",
          categoryId: subId,
          categoryName: String(cat.name || "منوّعات"),
          categoryIcon: String(cat.icon || "🎯"),
          mainCategoryId: mainId
        });
      });
    });

    const shuffledDeck = shuffleArray(candidates, rng);
    const limit = Math.max(1, Math.floor(Number(questionCount) || 10));
    return {
      totalAvailable: shuffledDeck.length,
      deck: shuffledDeck.slice(0, limit)
    };
  }

  /**
   * معادلة احتساب نقاط سؤال واحد (الأساسية 500 + سرعة حتى 500 + بونص سلسلة +100..+300)
   */
  function computeQuizRaceScore({
    isCorrect = false,
    remainingMs = 0,
    totalMs = 15000,
    prevStreak = 0,
    streakBonusEnabled = true
  } = {}) {
    if (!isCorrect) {
      return {
        isCorrect: false,
        basePoints: 0,
        speedBonus: 0,
        streakBonus: 0,
        earnedPoints: 0,
        nextStreak: 0
      };
    }
    const safeTotal = Math.max(1000, Number(totalMs) || 15000);
    const safeRem = Math.max(0, Math.min(safeTotal, Number(remainingMs) || 0));
    const basePoints = 500;
    const speedBonus = Math.round(500 * (safeRem / safeTotal));
    const nextStreak = Math.max(0, Math.floor(Number(prevStreak) || 0)) + 1;
    const streakBonus =
      streakBonusEnabled && nextStreak >= 2 ? Math.min(300, (nextStreak - 1) * 100) : 0;
    return {
      isCorrect: true,
      basePoints,
      speedBonus,
      streakBonus,
      earnedPoints: basePoints + speedBonus + streakBonus,
      nextStreak
    };
  }

  class QuizRaceController {
    constructor() {
      this.modal = null;
      this.body = null;
      this.isOpenFlag = false;
      this.fullDisplayMode = false;

      // إعدادات السباق
      this.config = {
        scope: "all", // "all" | "main" | "sub"
        selectedMainId: "",
        selectedSubIds: [],
        questionCount: 10,
        timerSeconds: 15,
        streakBonusEnabled: true,
        autoAdvanceEnabled: false
      };

      // حالة الغرفة اللاسلكية
      this.room = {
        active: false,
        connected: false,
        code: "",
        playerUrl: "",
        joinLocked: false,
        playersMap: {},
        feedback: "",
        feedbackKind: "info"
      };

      // حالة السباق (البيانات السرية في ذاكرة المقدّم فقط!)
      this.phase = "setup"; // setup | question | reveal | leaderboard | game_over
      this.raceId = "";
      this._secretDeck = [];
      this.questionIndex = 0;
      this.countdownNumber = 0;
      this._questionStartServerMs = 0;
      this._questionEndServerMs = 0;
      this._answersMap = {}; // { uid: { questionIndex, optionIndex, submittedAtMs } }
      this._playerStats = {}; // { uid: { uid, name, avatar, score, streak, bestStreak, correctCount, answeredCount, fastestMs, prevRank } }
      this.lastRevealData = null;
      this.finalSummary = null;
      this._recordedRaceId = "";

      this._countdownTimer = null;
      this._questionTimer = null;
      this._autoAdvanceTimer = null;
      this._autoAdvanceRemaining = 0;
      this._remainingSeconds = 0;
      this._lastTickSec = null;
      this._qrCacheUrl = "";
      this._qrCacheSvg = "";
    }

    init() {
      this.modal = document.getElementById("quiz-race-modal");
      this.body = document.getElementById("quiz-race-body");
      if (!this.modal || !this.body) return;

      const btnClose = document.getElementById("btn-close-quiz-race");
      const btnFull = document.getElementById("btn-qr-full-display");
      const btnExitFull = document.getElementById("btn-qr-exit-full-display");

      if (btnClose) btnClose.addEventListener("click", () => this.close());
      if (btnFull) btnFull.addEventListener("click", () => this.setFullDisplayMode(!this.fullDisplayMode));
      if (btnExitFull) btnExitFull.addEventListener("click", () => this.setFullDisplayMode(false));

      this.modal.addEventListener("click", (e) => {
        if (e.target === this.modal && !this.fullDisplayMode) this.close();
      });

      this.body.addEventListener("click", (e) => this._handleClick(e));
    }

    isOpen() {
      return Boolean(this.isOpenFlag);
    }

    open() {
      if (!this.modal) this.init();
      if (!this.modal) return;
      this.isOpenFlag = true;
      this.fullDisplayMode = false;
      this._syncFullDisplayUI();
      this.modal.classList.add("open");
      this.modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      this._render();
    }

    async close() {
      this._clearAllTimers();
      this.setFullDisplayMode(false);
      if (this.room.active) {
        await this.closeWirelessRoom({ silent: true });
      }
      this.phase = "setup";
      this.isOpenFlag = false;
      if (this.modal) {
        this.modal.classList.remove("open");
        this.modal.setAttribute("aria-hidden", "true");
      }
      const anyOpen = document.querySelector(".modal-overlay.open");
      if (!anyOpen) document.body.style.overflow = "";
    }

    setFullDisplayMode(enabled) {
      this.fullDisplayMode = Boolean(enabled);
      this._syncFullDisplayUI();
      if (this.isOpenFlag) this._render();
    }

    _syncFullDisplayUI() {
      if (this.modal) this.modal.classList.toggle("is-full-display-mode", this.fullDisplayMode);
      const exitBtn = document.getElementById("btn-qr-exit-full-display");
      if (exitBtn) exitBtn.hidden = !this.fullDisplayMode;
      const btnFull = document.getElementById("btn-qr-full-display");
      if (btnFull) btnFull.textContent = this.fullDisplayMode ? "✕ إنهاء العرض الكامل" : "📺 وضع العرض الكامل";
    }

    _clearAllTimers() {
      if (this._countdownTimer) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
      }
      if (this._questionTimer) {
        clearInterval(this._questionTimer);
        this._questionTimer = null;
      }
      if (this._autoAdvanceTimer) {
        clearInterval(this._autoAdvanceTimer);
        this._autoAdvanceTimer = null;
      }
      this._lastTickSec = null;
    }

    _toast(msg, kind = "info") {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.showToast === "function") {
        window.SeenJeemHostBridge.showToast(msg, kind);
      }
    }

    _playSfx(method, ...args) {
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio[method] === "function") {
        window.SeenJeemAudio[method](...args);
      }
    }

    _getServerNowMs() {
      const sync = window.SeenJeemQuizRaceSync;
      return sync && typeof sync.getServerNowMs === "function" ? sync.getServerNowMs() : Date.now();
    }

    _getAllCategories() {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.getAllCategories === "function") {
        return window.SeenJeemHostBridge.getAllCategories();
      }
      return [];
    }

    _getMainCategoryOptions() {
      const cats = this._getAllCategories();
      const counts = new Map();
      cats.forEach((cat) => {
        const mId = resolveMainGroupId(cat);
        counts.set(mId, (counts.get(mId) || 0) + 1);
      });
      const catalog =
        window.SeenJeemCategoryBrowser && Array.isArray(window.SeenJeemCategoryBrowser.MAIN_CATEGORY_CATALOG)
          ? window.SeenJeemCategoryBrowser.MAIN_CATEGORY_CATALOG
          : [];
      const out = [];
      catalog.forEach((m) => {
        if (counts.has(m.id)) out.push({ id: m.id, label: m.label, icon: m.icon });
      });
      return out;
    }

    _getReadyQuestionStats() {
      const built = buildQuizRaceDeck({
        categories: this._getAllCategories(),
        scope: this.config.scope,
        selectedMainId: this.config.selectedMainId,
        selectedSubIds: this.config.selectedSubIds,
        questionCount: this.config.questionCount
      });
      return { totalAvailable: built.totalAvailable, usableCount: built.deck.length };
    }

    _getCategoryLabel() {
      if (this.config.scope === "all") return "منوّعات عشوائية من كل البنك";
      if (this.config.scope === "main" && this.config.selectedMainId) {
        const m = this._getMainCategoryOptions().find((x) => x.id === this.config.selectedMainId);
        return m ? `${m.icon} ${m.label}` : "فئة رئيسية";
      }
      if (this.config.scope === "sub" && this.config.selectedSubIds.length > 0) {
        const cats = this._getAllCategories().filter((c) => this.config.selectedSubIds.includes(c.id));
        if (cats.length === 1) return `${cats[0].icon || "🎯"} ${cats[0].name}`;
        return `${cats.length} فئات مختارة`;
      }
      return "منوّعات عشوائية";
    }

    _getOrderedLobbyPlayers() {
      const map = this.room.playersMap || {};
      return Object.keys(map)
        .map((uid) => {
          const p = map[uid];
          if (!p || !p.name) return null;
          return {
            uid,
            name: String(p.name).trim(),
            avatar: typeof p.avatar === "string" && p.avatar.trim() ? p.avatar.trim() : "👤",
            joinedAt: Number(p.joinedAt) || 0
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.joinedAt - b.joinedAt);
    }

    _getSortedStandings() {
      return Object.values(this._playerStats)
        .map((st) => ({
          uid: st.uid,
          name: st.name,
          avatar: st.avatar,
          score: st.score,
          streak: st.streak,
          bestStreak: st.bestStreak,
          correctCount: st.correctCount,
          answeredCount: st.answeredCount,
          accuracy:
            this._secretDeck.length > 0
              ? Math.round((st.correctCount / Math.max(1, Math.min(this.questionIndex + 1, this._secretDeck.length))) * 100)
              : 0,
          fastestMs: st.fastestMs,
          prevRank: st.prevRank
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
          return (a.fastestMs || 999999) - (b.fastestMs || 999999);
        });
    }

    _getQrSvg() {
      if (!this.room.playerUrl || !window.SeenJeemQR) return "";
      if (this._qrCacheUrl !== this.room.playerUrl) {
        this._qrCacheUrl = this.room.playerUrl;
        try {
          this._qrCacheSvg = window.SeenJeemQR.toSVG(this.room.playerUrl, {
            size: 196,
            margin: 3,
            ariaLabel: `رمز غرفة تحدي الكل ${this.room.code}`
          });
        } catch (_err) {
          this._qrCacheSvg = "";
        }
      }
      return this._qrCacheSvg;
    }

    /* =========================================================
       إدارة الغرفة اللاسلكية (/quizRaceRooms/{roomCode})
       ========================================================= */
    async openWirelessRoom() {
      const sync = window.SeenJeemQuizRaceSync;
      if (!sync) return;
      if (!sync.isConfigured()) {
        this.room.feedbackKind = "warning";
        this.room.feedback = "⚠️ خدمة اللعب عبر الهواتف غير متاحة حالياً — تأكد من الاتصال بالإنترنت.";
        this._render();
        return;
      }
      this.room.feedbackKind = "info";
      this.room.feedback = "⏳ جاري إنشاء غرفة «تحدي الكل» وتوليد رمز الانضمام...";
      this._render();

      try {
        const info = await sync.createRoom({
          initialPublicState: this.buildSanitizedPublicState(),
          onPlayers: (map) => {
            this.room.playersMap = map && typeof map === "object" ? map : {};
            if (this.phase === "setup") {
              this._syncRoom();
            }
            this._render();
          },
          onAnswers: (ansMap) => this._onAnswersChanged(ansMap),
          onConnectionState: (isConn) => {
            this.room.connected = isConn;
            this._render();
          }
        });

        this.room.active = true;
        this.room.connected = true;
        this.room.code = info.roomCode;
        this.room.playerUrl = info.playerUrl;
        this.room.joinLocked = false;
        this.room.playersMap = {};
        this._qrCacheUrl = "";
        this.room.feedbackKind = "success";
        this.room.feedback = `✅ غرفة «تحدي الكل» جاهزة (${info.roomCode}) — امسح الرمز بهاتفك للانضمام!`;
        this._syncRoom();
        this._render();
        this._toast(`🏁 غرفة تحدي الكل ${info.roomCode} جاهزة!`, "success");
      } catch (err) {
        this.room.feedbackKind = "error";
        this.room.feedback = `❌ ${(err && err.message) || "تعذّر إنشاء الغرفة حالياً."}`;
        this._render();
      }
    }

    async closeWirelessRoom({ silent = false } = {}) {
      this._clearAllTimers();
      if (window.SeenJeemQuizRaceSync) {
        await window.SeenJeemQuizRaceSync.closeRoom();
      }
      this.room = {
        active: false,
        connected: false,
        code: "",
        playerUrl: "",
        joinLocked: false,
        playersMap: {},
        feedback: silent ? "" : "تم إغلاق غرفة اللعب بنجاح.",
        feedbackKind: "info"
      };
      this.phase = "setup";
      if (!silent) {
        this._render();
        this._toast("🔴 تم إغلاق غرفة تحدي الكل", "info");
      }
    }

    async toggleJoinLocked() {
      if (!this.room.active || !window.SeenJeemQuizRaceSync) return;
      this.room.joinLocked = !this.room.joinLocked;
      await window.SeenJeemQuizRaceSync.setJoinLocked(this.room.joinLocked);
      this._syncRoom();
      this._render();
    }

    async kickPlayer(uid) {
      if (!this.room.active || !window.SeenJeemQuizRaceSync || !uid) return;
      await window.SeenJeemQuizRaceSync.kickPlayer(uid);
      delete this.room.playersMap[uid];
      delete this._playerStats[uid];
      this._syncRoom();
      this._render();
      this._toast("🚫 تم طرد اللاعب من الغرفة", "info");
    }

    /* =========================================================
       آلة الحالات الخماسية (setup -> question -> reveal -> leaderboard -> game_over)
       ========================================================= */
    async startRace() {
      const lobbyPlayers = this._getOrderedLobbyPlayers();
      if (!this.room.active || lobbyPlayers.length < 1) {
        this._toast("⚠️ افتح الغرفة وانتظر انضمام لاعب واحد على الأقل لبدء السباق", "warning");
        return;
      }

      const built = buildQuizRaceDeck({
        categories: this._getAllCategories(),
        scope: this.config.scope,
        selectedMainId: this.config.selectedMainId,
        selectedSubIds: this.config.selectedSubIds,
        questionCount: this.config.questionCount
      });

      if (built.deck.length === 0) {
        this._toast("⚠️ لا توجد أسئلة كافية لبناء 4 خيارات من النطاق المختار — جرّب «منوّعات عشوائية».", "warning");
        return;
      }

      this._clearAllTimers();
      this.raceId = `qr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      this._secretDeck = built.deck;
      this.questionIndex = 0;
      this._answersMap = {};
      this.lastRevealData = null;
      this.finalSummary = null;
      this._recordedRaceId = "";

      this._playerStats = {};
      lobbyPlayers.forEach((p, idx) => {
        this._playerStats[p.uid] = {
          uid: p.uid,
          name: p.name,
          avatar: p.avatar,
          score: 0,
          streak: 0,
          bestStreak: 0,
          correctCount: 0,
          answeredCount: 0,
          fastestMs: null,
          prevRank: idx + 1
        };
      });

      if (window.SeenJeemQuizRaceSync) {
        await window.SeenJeemQuizRaceSync.clearAnswersAndResults({ clearResults: true });
      }

      this._playSfx("playTileOpen");
      this.startQuestionRound(0);
    }

    async startQuestionRound(idx) {
      this._clearAllTimers();
      if (idx >= this._secretDeck.length) {
        this.enterGameOver();
        return;
      }

      // حفظ الترتيب السابق قبل السؤال الجديد لعرض أسهم الصعود/الهبوط
      const beforeStandings = this._getSortedStandings();
      beforeStandings.forEach((p, rankIdx) => {
        if (this._playerStats[p.uid]) this._playerStats[p.uid].prevRank = rankIdx + 1;
      });

      this.questionIndex = idx;
      this.phase = "question";
      this._answersMap = {};
      this.lastRevealData = null;
      this.countdownNumber = 3;
      this._remainingSeconds = this.config.timerSeconds;

      if (this.room.active && window.SeenJeemQuizRaceSync) {
        await window.SeenJeemQuizRaceSync.clearAnswersAndResults({ clearResults: false });
      }

      this._render();
      this._syncRoom();
      this._playSfx("playTick", false);

      // عدّاد تهيئة سريع 3.. 2.. 1..
      this._countdownTimer = setInterval(() => {
        this.countdownNumber -= 1;
        if (this.countdownNumber > 0) {
          this._playSfx("playTick", false);
          this._render();
          this._syncRoom();
          return;
        }
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
        this._openLiveQuestionTimer();
      }, 900);
    }

    _openLiveQuestionTimer() {
      const totalSecs = Math.max(5, Number(this.config.timerSeconds) || 15);
      const nowServer = this._getServerNowMs();
      this._questionStartServerMs = nowServer;
      this._questionEndServerMs = nowServer + totalSecs * 1000;
      this._remainingSeconds = totalSecs;
      this._lastTickSec = null;

      this._playSfx("playReveal");
      this._render();
      this._syncRoom();

      this._questionTimer = setInterval(() => {
        if (this.phase !== "question" || this.countdownNumber > 0) {
          clearInterval(this._questionTimer);
          this._questionTimer = null;
          return;
        }
        const remMs = Math.max(0, this._questionEndServerMs - this._getServerNowMs());
        const remSec = Math.max(0, Math.ceil(remMs / 1000));
        this._remainingSeconds = remSec;

        const el = document.getElementById("qr-live-timer-num");
        if (el) {
          el.textContent = `${remSec}`;
          el.classList.toggle("danger", remSec <= 5 && remSec > 0);
        }
        const bar = document.getElementById("qr-live-timer-bar");
        if (bar) {
          const pct = Math.max(0, Math.min(100, (remMs / (totalSecs * 1000)) * 100));
          bar.style.width = `${pct}%`;
        }

        if (remSec > 0 && remSec <= 5 && remSec !== this._lastTickSec) {
          this._lastTickSec = remSec;
          this._playSfx("playTick", true);
        }

        if (remMs <= 0) {
          clearInterval(this._questionTimer);
          this._questionTimer = null;
          this.revealCurrentQuestion();
        }
      }, 150);
    }

    _getActiveOnlineUids() {
      const onlineSet = new Set(Object.keys(this.room.playersMap || {}));
      return Object.keys(this._playerStats).filter((uid) => onlineSet.has(uid));
    }

    _countAnsweredForCurrent() {
      const activeUids = this._getActiveOnlineUids();
      let cnt = 0;
      activeUids.forEach((uid) => {
        const ans = this._answersMap[uid];
        if (ans && Number(ans.questionIndex) === this.questionIndex && Number.isInteger(Number(ans.optionIndex))) {
          cnt += 1;
        }
      });
      return { answered: cnt, total: Math.max(activeUids.length, Object.keys(this._playerStats).length) };
    }

    _onAnswersChanged(ansMap) {
      this._answersMap = ansMap && typeof ansMap === "object" ? ansMap : {};
      if (this.phase !== "question" || this.countdownNumber > 0) return;

      const { answered, total } = this._countAnsweredForCurrent();
      const counterEl = document.getElementById("qr-answered-counter");
      if (counterEl) counterEl.textContent = `${answered} / ${total} أجابوا`;

      const onlineUids = this._getActiveOnlineUids();
      if (onlineUids.length > 0 && answered >= onlineUids.length) {
        this.revealCurrentQuestion();
      }
    }

    async revealCurrentQuestion() {
      if (this.phase !== "question") return;
      this._clearAllTimers();
      this.phase = "reveal";

      const q = this._secretDeck[this.questionIndex];
      if (!q) return;

      const totalMs = Math.max(1000, (Number(this.config.timerSeconds) || 15) * 1000);
      const optionCounts = [0, 0, 0, 0];
      const roundDetailsByUid = {};

      Object.keys(this._playerStats).forEach((uid) => {
        const st = this._playerStats[uid];
        const ans = this._answersMap[uid];
        const validAns =
          ans &&
          Number(ans.questionIndex) === this.questionIndex &&
          Number.isInteger(Number(ans.optionIndex)) &&
          Number(ans.optionIndex) >= 0 &&
          Number(ans.optionIndex) <= 3;

        const chosenIdx = validAns ? Number(ans.optionIndex) : null;
        if (chosenIdx !== null) {
          optionCounts[chosenIdx] += 1;
          st.answeredCount += 1;
        }

        const isCorrect = chosenIdx === q.correctIndex;
        let remainingMs = 0;
        let responseMs = null;
        if (validAns) {
          const subMs = Number(ans.submittedAtMs) || this._questionEndServerMs;
          remainingMs = Math.max(0, Math.min(totalMs, this._questionEndServerMs - subMs));
          responseMs = Math.max(100, Math.min(totalMs, subMs - this._questionStartServerMs));
        }

        const scoreCalc = computeQuizRaceScore({
          isCorrect,
          remainingMs,
          totalMs,
          prevStreak: st.streak,
          streakBonusEnabled: this.config.streakBonusEnabled
        });

        st.score += scoreCalc.earnedPoints;
        st.streak = scoreCalc.nextStreak;
        if (st.streak > st.bestStreak) st.bestStreak = st.streak;
        if (isCorrect) {
          st.correctCount += 1;
          if (responseMs && (!st.fastestMs || responseMs < st.fastestMs)) {
            st.fastestMs = responseMs;
          }
        }

        roundDetailsByUid[uid] = {
          questionIndex: this.questionIndex,
          isCorrect,
          timedOut: !validAns,
          chosenIndex: chosenIdx,
          correctIndex: q.correctIndex,
          correctOptionText: q.correctAnswer,
          basePoints: scoreCalc.basePoints,
          speedBonus: scoreCalc.speedBonus,
          streakBonus: scoreCalc.streakBonus,
          earnedPoints: scoreCalc.earnedPoints,
          totalScore: st.score,
          streak: st.streak
        };
      });

      // حساب الترتيب الحالي لكل لاعب وإرسال النتيجة الشخصية لهاتفه
      const sorted = this._getSortedStandings();
      sorted.forEach((p, idx) => {
        if (roundDetailsByUid[p.uid]) roundDetailsByUid[p.uid].rank = idx + 1;
      });

      const totalAnswers = optionCounts.reduce((s, c) => s + c, 0);
      this.lastRevealData = {
        questionIndex: this.questionIndex,
        correctIndex: q.correctIndex,
        correctOptionText: q.correctAnswer,
        explanation: q.explanation,
        answerImage: q.answerImage,
        optionCounts,
        totalAnswers,
        correctPlayersCount: optionCounts[q.correctIndex] || 0
      };

      if (this.room.active && window.SeenJeemQuizRaceSync) {
        await window.SeenJeemQuizRaceSync.publishPlayerResults(roundDetailsByUid);
      }

      this._playSfx("playCorrect");
      this._render();
      this._syncRoom();
    }

    showLeaderboard() {
      this._clearAllTimers();
      if (this.questionIndex + 1 >= this._secretDeck.length) {
        this.enterGameOver();
        return;
      }
      this.phase = "leaderboard";
      this._playSfx("playTileOpen");

      if (this.config.autoAdvanceEnabled) {
        this._autoAdvanceRemaining = 5;
        this._autoAdvanceTimer = setInterval(() => {
          this._autoAdvanceRemaining -= 1;
          const el = document.getElementById("qr-auto-next-sec");
          if (el) el.textContent = `${Math.max(0, this._autoAdvanceRemaining)}`;
          if (this._autoAdvanceRemaining <= 0) {
            this._clearAllTimers();
            this.startQuestionRound(this.questionIndex + 1);
          }
        }, 1000);
      }

      this._render();
      this._syncRoom();
    }

    enterGameOver() {
      this._clearAllTimers();
      this.phase = "game_over";

      const standings = this._getSortedStandings();
      this.finalSummary = {
        raceId: this.raceId,
        categoryLabel: this._getCategoryLabel(),
        questionCount: this._secretDeck.length,
        standings,
        timestamp: Date.now()
      };

      this._recordRaceStatsOnce(this.finalSummary);
      this._playSfx("playVictory");
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.triggerConfetti === "function") {
        window.SeenJeemHostBridge.triggerConfetti("victory", "default");
      }

      this._render();
      this._syncRoom();
    }

    _recordRaceStatsOnce(summary) {
      if (!summary || !summary.raceId || this._recordedRaceId === summary.raceId) return;
      this._recordedRaceId = summary.raceId;
      const store = window.SeenJeemArchiveStore;
      if (!store || typeof store.recordQuizRaceSession !== "function") return;
      const profileId =
        window.SeenJeemHistoryStore && typeof window.SeenJeemHistoryStore.getActiveProfile === "function"
          ? window.SeenJeemHistoryStore.getActiveProfile().id
          : "default";

      store.recordQuizRaceSession({
        raceId: summary.raceId,
        profileId,
        playedAt: summary.timestamp,
        categoryLabel: summary.categoryLabel,
        questionCount: summary.questionCount,
        players: summary.standings.map((p, idx) => ({
          name: p.name,
          score: p.score,
          correctCount: p.correctCount,
          accuracy: p.accuracy,
          bestStreak: p.bestStreak,
          fastestMs: p.fastestMs || 0,
          rank: idx + 1,
          won: idx === 0 && p.score > 0
        }))
      });

      if (window.SeenJeemCloudSync && typeof window.SeenJeemCloudSync.scheduleAutoSync === "function") {
        window.SeenJeemCloudSync.scheduleAutoSync();
      }
    }

    async returnToLobbySameRoom() {
      this._clearAllTimers();
      this.phase = "setup";
      this._secretDeck = [];
      this.lastRevealData = null;
      this.finalSummary = null;
      if (this.room.active && window.SeenJeemQuizRaceSync) {
        await window.SeenJeemQuizRaceSync.clearAnswersAndResults({ clearResults: true });
      }
      this._render();
      this._syncRoom();
    }

    buildSanitizedPublicState() {
      const lobby = this._getOrderedLobbyPlayers();
      const roster =
        this.phase === "setup"
          ? lobby.map((p) => ({ uid: p.uid, name: p.name, avatar: p.avatar, score: 0 }))
          : this._getSortedStandings().map((p) => ({
              uid: p.uid,
              name: p.name,
              avatar: p.avatar,
              score: p.score,
              streak: p.streak,
              accuracy: p.accuracy,
              correctCount: p.correctCount
            }));

      const q = this._secretDeck[this.questionIndex] || null;
      const isLiveQ = this.phase === "question" && this.countdownNumber === 0;

      // حماية قاطعة: لا نضع correctIndex إطلاقاً في currentQuestion قبل مرحلة الكشف
      const publicQuestion =
        q && (this.phase === "question" || this.phase === "reveal")
          ? {
              prompt: q.prompt,
              options: q.options.slice(),
              categoryName: q.categoryName,
              categoryIcon: q.categoryIcon
            }
          : null;

      return {
        raceId: this.raceId,
        phase: this.phase,
        roomCode: this.room.code,
        joinLocked: this.room.joinLocked,
        questionIndex: this.questionIndex,
        totalQuestions: this._secretDeck.length || this.config.questionCount,
        countdownNumber: this.phase === "question" ? this.countdownNumber : 0,
        timer: isLiveQ
          ? { status: "running", totalSeconds: this.config.timerSeconds, endAtMs: this._questionEndServerMs }
          : { status: "idle", totalSeconds: this.config.timerSeconds, endAtMs: null },
        currentQuestion: publicQuestion,
        playersRoster: roster,
        revealData: this.phase === "reveal" || this.phase === "leaderboard" ? this.lastRevealData : null,
        finalStandings: this.phase === "game_over" && this.finalSummary ? this.finalSummary.standings : null
      };
    }

    _syncRoom() {
      if (this.room.active && window.SeenJeemQuizRaceSync) {
        window.SeenJeemQuizRaceSync.publishPublicState(this.buildSanitizedPublicState()).catch(() => {});
      }
    }

    /* =========================================================
       معالجة النقرات ورسم واجهات المراحل الـ 5
       ========================================================= */
    _handleClick(e) {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.qrAct;
      if (!act) return;

      switch (act) {
        case "create-room":
          this.openWirelessRoom();
          break;
        case "close-room":
          this.closeWirelessRoom();
          break;
        case "toggle-lock":
          this.toggleJoinLocked();
          break;
        case "copy-url":
          if (this.room.playerUrl) {
            navigator.clipboard?.writeText(this.room.playerUrl).then(() => this._toast("📋 تم نسخ رابط الانضمام للسباق", "success"));
          }
          break;
        case "kick-player":
          if (btn.dataset.uid) this.kickPlayer(btn.dataset.uid);
          break;
        case "set-scope": {
          const sc = btn.dataset.val;
          if (sc === "all") {
            this.config.scope = "all";
            this.config.selectedMainId = "";
            this.config.selectedSubIds = [];
          } else if (sc === "main") {
            this.config.scope = "main";
            const mains = this._getMainCategoryOptions();
            if (!this.config.selectedMainId && mains[0]) this.config.selectedMainId = mains[0].id;
          } else if (sc === "sub") {
            this.config.scope = "sub";
          }
          this._render();
          break;
        }
        case "pick-main":
          this.config.scope = "main";
          this.config.selectedMainId = btn.dataset.val || "";
          this._render();
          break;
        case "toggle-sub": {
          const sid = btn.dataset.val;
          if (!sid) break;
          this.config.scope = "sub";
          const idx = this.config.selectedSubIds.indexOf(sid);
          if (idx >= 0) this.config.selectedSubIds.splice(idx, 1);
          else this.config.selectedSubIds.push(sid);
          this._render();
          break;
        }
        case "set-count":
          this.config.questionCount = Number(btn.dataset.val) || 10;
          this._render();
          break;
        case "set-timer":
          this.config.timerSeconds = Number(btn.dataset.val) || 15;
          this._render();
          break;
        case "toggle-streak":
          this.config.streakBonusEnabled = !this.config.streakBonusEnabled;
          this._render();
          break;
        case "toggle-auto-next":
          this.config.autoAdvanceEnabled = !this.config.autoAdvanceEnabled;
          this._render();
          break;
        case "start-race":
          this.startRace();
          break;
        case "reveal-now":
          this.revealCurrentQuestion();
          break;
        case "go-leaderboard":
          this.showLeaderboard();
          break;
        case "next-question":
          this.startQuestionRound(this.questionIndex + 1);
          break;
        case "open-result-card":
          if (this.finalSummary && window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openQuizRaceResultCard === "function") {
            window.SeenJeemHostBridge.openQuizRaceResultCard(this.finalSummary);
          }
          break;
        case "replay-same-room":
          this.returnToLobbySameRoom();
          break;
        case "exit-home":
          this.close();
          break;
        default:
          break;
      }
    }

    _render() {
      if (!this.body) return;
      if (this.phase === "setup") this.body.innerHTML = this._renderSetupHtml();
      else if (this.phase === "question") this.body.innerHTML = this._renderQuestionHtml();
      else if (this.phase === "reveal") this.body.innerHTML = this._renderRevealHtml();
      else if (this.phase === "leaderboard") this.body.innerHTML = this._renderLeaderboardHtml();
      else if (this.phase === "game_over") this.body.innerHTML = this._renderGameOverHtml();
    }

    _renderSetupHtml() {
      const lobby = this._getOrderedLobbyPlayers();
      const readyStats = this._getReadyQuestionStats();
      const mains = this._getMainCategoryOptions();
      const allCats = this._getAllCategories().filter((c) => !c.isCharades);
      const canStart = this.room.active && lobby.length >= 1 && readyStats.totalAvailable > 0;
      const syncConfigured = Boolean(window.SeenJeemQuizRaceSync && window.SeenJeemQuizRaceSync.isConfigured());

      return `
        <div class="qr-stage qr-setup-stage">
          <div class="qr-intro-banner">
            <div>
              <strong>🏁 تحدي الكل — سباق الاختيار من متعدد الجماعي!</strong>
              <p>يمسح الجميع الرمز بهواتفهم، ويتسابقون في نفس اللحظة بالإجابة على 4 خيارات بأسرع وقت لكسب نقاط السرعة والسلسلة!</p>
            </div>
            <span class="qr-ready-pill">✅ متاح ${readyStats.totalAvailable} سؤال جاهز</span>
          </div>

          <!-- 1) غرفة اللعب بالـ QR Code -->
          <section class="bank-section qr-room-section">
            <div class="bank-section-header">
              <h3 class="bank-section-title">📱 غرفة السباق (انضمام فوري بالهواتف)</h3>
              <span class="bank-count-pill">${this.room.active ? `🟢 الغرفة نشطة (${lobby.length} لاعب)` : "⚪ لم تُفتح غرفة بعد"}</span>
            </div>
            ${this.room.feedback ? `<div class="wireless-feedback-box is-${escapeHtml(this.room.feedbackKind)}">${escapeHtml(this.room.feedback)}</div>` : ""}
            ${
              !this.room.active
                ? `
                  <div class="qr-open-room-box">
                    <p>${syncConfigured ? "افتح غرفة اللعب الآن ليظهر رمز QR ورمز الغرفة وينضم المتسابقون بهواتفهم." : "⚠️ خدمة اللعب عبر الهواتف غير متاحة حالياً — تأكد من الاتصال بالإنترنت."}</p>
                    <button type="button" class="btn btn-primary btn-lg" data-qr-act="create-room" ${!syncConfigured ? "disabled" : ""}>
                      🏁 فتح غرفة «تحدي الكل» وإنشاء رمز QR
                    </button>
                  </div>
                `
                : `
                  <div class="mafia-lobby-grid">
                    <div class="mafia-qr-panel">
                      <div class="mafia-qr-svg">${this._getQrSvg()}</div>
                      <div class="mafia-room-code-big">رمز الغرفة: <strong>${escapeHtml(this.room.code)}</strong></div>
                      <div class="mafia-qr-btns">
                        <button type="button" class="btn btn-secondary btn-xs" data-qr-act="copy-url">📋 نسخ رابط الانضمام</button>
                        <a href="${escapeHtml(this.room.playerUrl)}" target="_blank" rel="noopener" class="btn btn-ghost btn-xs">↗️ فتح شاشة لاعب</a>
                      </div>
                      <div class="mafia-qr-btns">
                        <button type="button" class="btn btn-secondary btn-xs" data-qr-act="toggle-lock">
                          ${this.room.joinLocked ? "🔒 مقفلة (افتح)" : "🔓 قفل الانضمام"}
                        </button>
                        <button type="button" class="btn btn-danger-outline btn-xs" data-qr-act="close-room">🔴 إغلاق الغرفة</button>
                      </div>
                    </div>

                    <div class="mafia-players-panel">
                      <div class="mafia-sub-head">
                        <strong>المتسابقون المنضمون (${lobby.length})</strong>
                        <span class="mafia-count-hint">${lobby.length === 0 ? "امسح الرمز بهاتفك للانضمام" : "✅ جاهزون للانطلاق!"}</span>
                      </div>
                      ${
                        lobby.length === 0
                          ? `<div class="empty-inline-note">بانتظار مسح رمز QR من هواتف اللاعبين...</div>`
                          : `<div class="mafia-lobby-list">
                              ${lobby
                                .map(
                                  (p) => `
                                <div class="mafia-lobby-player">
                                  <span class="mafia-player-name">${escapeHtml(p.avatar)} ${escapeHtml(p.name)}</span>
                                  <button type="button" class="btn btn-danger-outline btn-xxs" data-qr-act="kick-player" data-uid="${escapeHtml(p.uid)}">🚫 طرد</button>
                                </div>
                              `
                                )
                                .join("")}
                            </div>`
                      }
                    </div>
                  </div>
                `
            }
          </section>

          <!-- 2) إعدادات الأسئلة والمؤقت -->
          <section class="bank-section qr-config-section">
            <div class="bank-section-header">
              <h3 class="bank-section-title">⚙️ إعدادات السباق والأسئلة</h3>
              <span class="bank-count-pill">🎯 ${escapeHtml(this._getCategoryLabel())}</span>
            </div>

            <div class="qr-config-grid">
              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">📚 مصدر الأسئلة:</span>
                <div class="tactical-pills-row">
                  <button type="button" class="tactical-opt-btn${this.config.scope === "all" ? " active" : ""}" data-qr-act="set-scope" data-val="all">🎲 منوّعات عشوائية من كل البنك</button>
                  <button type="button" class="tactical-opt-btn${this.config.scope === "main" ? " active" : ""}" data-qr-act="set-scope" data-val="main">🗂️ فئة رئيسية</button>
                  <button type="button" class="tactical-opt-btn${this.config.scope === "sub" ? " active" : ""}" data-qr-act="set-scope" data-val="sub">🎯 فئات فرعية محددة</button>
                </div>
                ${
                  this.config.scope === "main"
                    ? `<div class="tactical-pills-row qr-sub-picker">
                        ${mains
                          .map(
                            (m) => `
                          <button type="button" class="tactical-opt-btn${this.config.selectedMainId === m.id ? " active" : ""}" data-qr-act="pick-main" data-val="${escapeHtml(m.id)}">
                            ${escapeHtml(m.icon)} ${escapeHtml(m.label)}
                          </button>
                        `
                          )
                          .join("")}
                      </div>`
                    : ""
                }
                ${
                  this.config.scope === "sub"
                    ? `<div class="tactical-pills-row qr-sub-picker">
                        ${allCats
                          .slice(0, 36)
                          .map(
                            (c) => `
                          <button type="button" class="tactical-opt-btn${this.config.selectedSubIds.includes(c.id) ? " active" : ""}" data-qr-act="toggle-sub" data-val="${escapeHtml(c.id)}">
                            ${escapeHtml(c.icon || "🎯")} ${escapeHtml(c.name)}
                          </button>
                        `
                          )
                          .join("")}
                      </div>`
                    : ""
                }
              </div>

              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">🔢 عدد الأسئلة:</span>
                <div class="tactical-pills-row">
                  ${[5, 10, 15, 20]
                    .map(
                      (n) => `<button type="button" class="tactical-opt-btn${this.config.questionCount === n ? " active" : ""}" data-qr-act="set-count" data-val="${n}">${n} أسئلة</button>`
                    )
                    .join("")}
                </div>
              </div>

              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">⏱️ مدة الإجابة لكل سؤال:</span>
                <div class="tactical-pills-row">
                  ${[10, 15, 20, 30]
                    .map(
                      (s) => `<button type="button" class="tactical-opt-btn${this.config.timerSeconds === s ? " active" : ""}" data-qr-act="set-timer" data-val="${s}">${s} ثانية</button>`
                    )
                    .join("")}
                </div>
              </div>

              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">🔥 خيارات الحماس:</span>
                <div class="tactical-pills-row">
                  <button type="button" class="tactical-opt-btn${this.config.streakBonusEnabled ? " active" : ""}" data-qr-act="toggle-streak">🔥 بونص السلسلة (+100 إلى +300)</button>
                  <button type="button" class="tactical-opt-btn${this.config.autoAdvanceEnabled ? " active" : ""}" data-qr-act="toggle-auto-next">⏩ انتقال تلقائي بعد الصدارة (5ث)</button>
                </div>
              </div>
            </div>
          </section>

          <div class="mafia-setup-footer">
            <button type="button" class="btn btn-primary btn-lg mafia-start-btn" data-qr-act="start-race" ${!canStart ? "disabled" : ""}>
              🚀 ابدأ سباق «تحدي الكل» (${Math.min(this.config.questionCount, readyStats.totalAvailable)} سؤال • ${lobby.length} لاعب)
            </button>
            <button type="button" class="btn btn-ghost btn-md" data-qr-act="exit-home">⬅️ العودة للقائمة الرئيسية</button>
          </div>
        </div>
      `;
    }

    _renderQuestionHtml() {
      const q = this._secretDeck[this.questionIndex];
      if (!q) return "";
      const { answered, total } = this._countAnsweredForCurrent();

      if (this.countdownNumber > 0) {
        return `
          <div class="qr-stage qr-center-stage">
            <div class="mafia-phase-pill">🏁 السؤال ${this.questionIndex + 1} من ${this._secretDeck.length} • ${escapeHtml(q.categoryIcon)} ${escapeHtml(q.categoryName)}</div>
            <h2 class="qr-countdown-heading">استعدوا...</h2>
            <div class="qr-giant-countdown">${this.countdownNumber}</div>
            <p class="mafia-big-sub">جهّزوا هواتفكم للاختيار بأقصى سرعة!</p>
          </div>
        `;
      }

      return `
        <div class="qr-stage qr-question-stage">
          <div class="qr-live-topbar">
            <span class="mafia-phase-pill">السؤال ${this.questionIndex + 1} / ${this._secretDeck.length} • ${escapeHtml(q.categoryIcon)} ${escapeHtml(q.categoryName)}</span>
            <span id="qr-answered-counter" class="qr-answered-pill">📩 ${answered} / ${total} أجابوا</span>
            <div id="qr-live-timer-num" class="qr-timer-circle${this._remainingSeconds <= 5 ? " danger" : ""}">${this._remainingSeconds}</div>
          </div>

          <div class="qr-timer-track"><div id="qr-live-timer-bar" class="qr-timer-bar" style="width:100%"></div></div>

          <div class="qr-question-hero">
            <h2 class="qr-question-text">${escapeHtml(q.prompt)}</h2>
            ${q.imageUrl ? `<img src="${escapeHtml(q.imageUrl)}" class="qr-question-img" alt="صورة السؤال" />` : ""}
          </div>

          <div class="qr-options-board">
            ${q.options
              .map((optText, idx) => {
                const st = OPTION_STYLES[idx] || OPTION_STYLES[0];
                return `
                  <div class="qr-option-tile is-${st.key}">
                    <span class="qr-option-shape" aria-hidden="true">${st.shape}</span>
                    <span class="qr-option-label">${escapeHtml(optText)}</span>
                  </div>
                `;
              })
              .join("")}
          </div>

          <div class="mafia-host-actions">
            <button type="button" class="btn btn-secondary btn-md" data-qr-act="reveal-now">⏭️ إنهاء المؤقت وكشف الإجابة الآن</button>
          </div>
        </div>
      `;
    }

    _renderRevealHtml() {
      const q = this._secretDeck[this.questionIndex];
      const rev = this.lastRevealData;
      if (!q || !rev) return "";
      const maxCnt = Math.max(1, ...(rev.optionCounts || [1]));

      return `
        <div class="qr-stage qr-reveal-stage">
          <div class="mafia-phase-pill">✅ كشف الإجابة الصحيحة — السؤال ${this.questionIndex + 1} / ${this._secretDeck.length}</div>
          <h2 class="qr-question-text is-compact">${escapeHtml(q.prompt)}</h2>

          <!-- مخطط أعمدة توزيع اختيارات اللاعبين -->
          <div class="qr-bars-chart">
            ${q.options
              .map((optText, idx) => {
                const st = OPTION_STYLES[idx] || OPTION_STYLES[0];
                const cnt = (rev.optionCounts && rev.optionCounts[idx]) || 0;
                const pct = Math.max(10, Math.round((cnt / maxCnt) * 100));
                const isRight = idx === rev.correctIndex;
                return `
                  <div class="qr-bar-col${isRight ? " is-correct" : " is-dim"}">
                    <div class="qr-bar-count">${cnt} ${isRight ? "✅" : ""}</div>
                    <div class="qr-bar-track">
                      <div class="qr-bar-fill is-${st.key}" style="height:${pct}%"></div>
                    </div>
                    <div class="qr-bar-shape is-${st.key}">${st.shape}</div>
                  </div>
                `;
              })
              .join("")}
          </div>

          <div class="qr-options-board">
            ${q.options
              .map((optText, idx) => {
                const st = OPTION_STYLES[idx] || OPTION_STYLES[0];
                const isRight = idx === rev.correctIndex;
                return `
                  <div class="qr-option-tile is-${st.key}${isRight ? " is-revealed-correct" : " is-revealed-wrong"}">
                    <span class="qr-option-shape">${isRight ? "✅" : st.shape}</span>
                    <span class="qr-option-label">${escapeHtml(optText)}</span>
                  </div>
                `;
              })
              .join("")}
          </div>

          ${
            rev.explanation || rev.answerImage
              ? `
                <div class="qr-explanation-box">
                  ${rev.explanation ? `<p>💡 ${escapeHtml(rev.explanation)}</p>` : ""}
                  ${rev.answerImage ? `<img src="${escapeHtml(rev.answerImage)}" class="qr-answer-img" alt="صورة الإجابة" />` : ""}
                </div>
              `
              : ""
          }

          <div class="mafia-host-actions">
            <button type="button" class="btn btn-primary btn-lg" data-qr-act="go-leaderboard">
              ${this.questionIndex + 1 >= this._secretDeck.length ? "🏆 إعلان منصة التتويج النهائية ←" : "📊 عرض لوحة الصدارة ←"}
            </button>
          </div>
        </div>
      `;
    }

    _renderLeaderboardHtml() {
      const top5 = this._getSortedStandings().slice(0, 5);
      return `
        <div class="qr-stage qr-center-stage">
          <div class="mafia-phase-pill">📊 لوحة الصدارة بعد السؤال ${this.questionIndex + 1} / ${this._secretDeck.length}</div>
          <h2 class="mafia-big-title">أفضل المتسابقين الآن!</h2>

          <div class="qr-leaderboard-list">
            ${top5
              .map((p, idx) => {
                const curRank = idx + 1;
                const diff = (p.prevRank || curRank) - curRank;
                const arrow = diff > 0 ? `<span class="qr-rank-up">▲ +${diff}</span>` : diff < 0 ? `<span class="qr-rank-down">▼ ${diff}</span>` : `<span class="qr-rank-same">—</span>`;
                return `
                  <div class="qr-lb-row${idx === 0 ? " is-first" : ""}">
                    <div class="qr-lb-left">
                      <span class="qr-lb-rank">${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${curRank}`}</span>
                      <span class="qr-lb-name">${escapeHtml(p.avatar)} ${escapeHtml(p.name)}</span>
                      ${p.streak >= 2 ? `<span class="qr-streak-badge">🔥 ${p.streak}</span>` : ""}
                      ${arrow}
                    </div>
                    <strong class="qr-lb-score">${p.score}</strong>
                  </div>
                `;
              })
              .join("")}
          </div>

          ${
            this.config.autoAdvanceEnabled
              ? `<p class="mafia-big-sub">⏩ الانتقال التلقائي للسؤال التالي خلال <strong id="qr-auto-next-sec">${this._autoAdvanceRemaining}</strong> ثوانٍ...</p>`
              : ""
          }

          <div class="mafia-host-actions">
            <button type="button" class="btn btn-primary btn-lg" data-qr-act="next-question">
              ➡️ السؤال التالي (${this.questionIndex + 2} / ${this._secretDeck.length})
            </button>
          </div>
        </div>
      `;
    }

    _renderGameOverHtml() {
      const sm = this.finalSummary || { standings: [], questionCount: 0 };
      const standings = sm.standings || [];
      const first = standings[0] || null;
      const second = standings[1] || null;
      const third = standings[2] || null;

      return `
        <div class="qr-stage qr-gameover-stage">
          <div class="mafia-phase-pill">🏆 نهاية سباق «تحدي الكل» • ${sm.questionCount} سؤال</div>
          <h2 class="mafia-big-title">${first ? `🎉 بطل السباق: ${escapeHtml(first.name)}!` : "انتهى السباق!"}</h2>

          <!-- منصة التتويج 1/2/3 -->
          <div class="qr-podium-wrap">
            ${
              second
                ? `<div class="qr-podium-col is-second">
                    <div class="qr-podium-avatar">${escapeHtml(second.avatar)}</div>
                    <div class="qr-podium-name">${escapeHtml(second.name)}</div>
                    <div class="qr-podium-block"><span class="qr-podium-medal">🥈</span><strong>${second.score}</strong></div>
                  </div>`
                : ""
            }
            ${
              first
                ? `<div class="qr-podium-col is-first">
                    <div class="qr-podium-avatar">${escapeHtml(first.avatar)}</div>
                    <div class="qr-podium-name">${escapeHtml(first.name)}</div>
                    <div class="qr-podium-block"><span class="qr-podium-medal">🥇</span><strong>${first.score}</strong></div>
                  </div>`
                : ""
            }
            ${
              third
                ? `<div class="qr-podium-col is-third">
                    <div class="qr-podium-avatar">${escapeHtml(third.avatar)}</div>
                    <div class="qr-podium-name">${escapeHtml(third.name)}</div>
                    <div class="qr-podium-block"><span class="qr-podium-medal">🥉</span><strong>${third.score}</strong></div>
                  </div>`
                : ""
            }
          </div>

          <!-- الترتيب الكامل مع الدقة وأسرع إجابة -->
          <section class="bank-section qr-full-standings">
            <h3 class="bank-section-title">📋 الترتيب الكامل والإحصائيات</h3>
            <div class="qr-standings-list">
              ${standings
                .map(
                  (p, idx) => `
                <div class="qr-standing-row${idx === 0 ? " is-first" : ""}">
                  <span><strong>#${idx + 1}</strong> ${escapeHtml(p.avatar)} ${escapeHtml(p.name)}</span>
                  <span class="qr-standing-meta">دقة ${p.accuracy}%${p.fastestMs ? ` • ⚡ ${(p.fastestMs / 1000).toFixed(2)}ث` : ""}</span>
                  <strong>${p.score} نقطة</strong>
                </div>
              `
                )
                .join("")}
            </div>
          </section>

          <div class="mafia-host-actions">
            <button type="button" class="btn btn-gold-outline btn-lg" data-qr-act="open-result-card">
              📸 حفظ / مشاركة بطاقة النتيجة
            </button>
            <button type="button" class="btn btn-primary btn-lg" data-qr-act="replay-same-room">
              🔄 سباق جديد (نفس الغرفة واللاعبين)
            </button>
            <button type="button" class="btn btn-secondary btn-md" data-qr-act="exit-home">
              🏠 العودة للرئيسية
            </button>
          </div>
        </div>
      `;
    }
  }

  window.SeenJeemQuizRace = new QuizRaceController();
  window.SeenJeemQuizRaceEngine = {
    OPTION_STYLES,
    normalizeArabicAnswer,
    buildQuizRaceDeck,
    computeQuizRaceScore
  };
})();
