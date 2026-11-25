/**
 * المنطق البرمجي الكامل للعبة المسابقات الجماعية "سين جيم" (Seen Jeem)
 * - المرحلة الرابعة (الحزمة الأولى):
 *   1) محرك عدم التكرار عبر الجلسات وملفات المجموعات (SeenJeemHistoryStore)
 *   2) الحفظ التلقائي للمباراة ومكدّس التراجع غير القابل للطفرة لـ 15 خطوة (SeenJeemMatchStore)
 *   3) المنقّي الدفاعي لبيانات الشيت وكاش العمل دون إنترنت وتقرير صحة البنك (SeenJeemSheetSanitizer)
 *   4) التحميل المسبق لصور اللوحة وعدالة مؤقت الذاكرة وحركة الكشف السلسة (SeenJeemImagePreloader)
 */
(function () {
  "use strict";

  const historyStore = window.SeenJeemHistoryStore;
  const sanitizer = window.SeenJeemSheetSanitizer;
  const matchStore = window.SeenJeemMatchStore;
  const imagePreloader = window.SeenJeemImagePreloader;
  const liveSync = window.SeenJeemLiveSync;
  const wakeLock = window.SeenJeemWakeLock;
  const flaggedStore = window.SeenJeemFlaggedStore;
  const backupManager = window.SeenJeemBackup;
  const pwaManager = window.SeenJeemPWA;

  const CUSTOM_CATEGORIES_STORAGE_KEY = "seenJeem_customCategories_v1";
  const REQUIRED_CATEGORIES = 6;
  const MAIN_TIMER_SECONDS = 60;
  const DEFAULT_MEMORY_SECONDS = 10;
  const DEFAULT_BLUR_LEVEL = 18;
  const DEFAULT_ZOOM_LEVEL = 3.8;
  const CLOSING_REVEAL_DELAY_MS = 1350;
  const POINT_TIERS = [200, 400, 600];

  const VISUAL_TYPE_META = {
    normal: null,
    blur: { icon: "🌫️", label: "صورة مغبّشة" },
    zoom: { icon: "🔎", label: "صورة مُقرّبة" },
    invert: { icon: "🎨", label: "ألوان معكوسة" },
    silhouette: { icon: "👤", label: "تحدي الظل" },
    memory: { icon: "🧠", label: "اختبار الذاكرة" },
    "spot-diff": { icon: "👀", label: "أوجد الفروقات" },
    "multi-image": { icon: "🔗", label: "اربط الصور" }
  };

  const MASKED_VISUAL_TYPES = new Set(["blur", "zoom", "invert", "silhouette"]);

  /** @type {Array<{ id: string, label: string, icon: string }>} */
  const CATEGORY_GROUPS = [
    { id: "all", label: "الكل", icon: "✨" },
    { id: "jordan-arab", label: "الأردن والعرب وإسلاميات", icon: "🇯🇴" },
    { id: "culture-geo", label: "ثقافة وجغرافيا وتاريخ", icon: "🌍" },
    { id: "science-tech", label: "علوم وتقنية وطب", icon: "🔬" },
    { id: "entertainment", label: "فنون وترفيه وذكريات", icon: "🎬" },
    { id: "sports-life", label: "رياضة ولايف ستايل", icon: "⚽" },
    { id: "puzzles", label: "ألغاز وتحديات ذكاء", icon: "🧩" },
    { id: "visual", label: "تحديات بصرية وصور", icon: "👁️" },
    { id: "charades", label: "من غير كلام", icon: "🎭" }
  ];

  const VALID_CATEGORY_GROUP_IDS = new Set(
    CATEGORY_GROUPS.filter((g) => g.id !== "all").map((g) => g.id)
  );

  const GROUP_FALLBACK_COLORS = {
    "jordan-arab": "#ef4444",
    "culture-geo": "#06b6d4",
    "science-tech": "#8b5cf6",
    entertainment: "#ec4899",
    "sports-life": "#10b981",
    puzzles: "#f59e0b",
    visual: "#6366f1",
    charades: "#f97316"
  };

  function getCategoryAccentColor(category, resolvedGroupId) {
    if (category && typeof category.color === "string" && category.color.trim()) {
      return category.color.trim();
    }
    const groupId = resolvedGroupId || resolveCategoryGroup(category);
    return GROUP_FALLBACK_COLORS[groupId] || "#06b6d4";
  }

  function formatRemainingCategoriesHint(remaining) {
    if (remaining === 1) return "اختر فئة إضافية واحدة";
    if (remaining === 2) return "اختر فئتين إضافيتين";
    return `اختر ${remaining} فئات إضافية`;
  }

  const VISUAL_GROUP_MODES = new Set(["blur", "zoom", "spot-diff", "memory", "multi-image"]);

  const CATEGORY_GROUP_ID_FALLBACK = {
    "jordan-arab": [
      "sh2-jo",
      "sh12-amman",
      "sh8-jo-dial",
      "sh7-arab-geo",
      "sh2-isl",
      "sh12-prophets",
      "jordan",
      "bank-jordan",
      "bank-islamic"
    ],
    "culture-geo": [
      "sh1-geo",
      "sh1-hist",
      "sh7-landmarks",
      "sh8-records",
      "sh8-cultures",
      "sh9-travel",
      "sh10-firsts",
      "sh1-arab-lit",
      "sh9-quotes",
      "sh3-prov",
      "sh6-cur",
      "sh6-brands",
      "geography",
      "history",
      "general"
    ],
    "science-tech": [
      "sh1-sci",
      "sh1-tech",
      "sh7-inventions",
      "sh13-ai",
      "sh2-med",
      "sh8-firstaid",
      "sh8-psych",
      "sh6-animals",
      "sh13-oceans",
      "science",
      "technology",
      "bank-medical"
    ],
    entertainment: [
      "sh3-drama",
      "sh6-cinema",
      "sh12-turkish",
      "sh7-music",
      "sh3-cart",
      "sh12-90s",
      "sh7-gaming",
      "sh11-lyrics"
    ],
    "sports-life": [
      "sh3-fb",
      "sh6-sports",
      "sh2-cars",
      "sh2-food",
      "sh13-coffee",
      "sh13-perfume",
      "sports",
      "bank-cars"
    ],
    puzzles: [
      "sh3-rid",
      "sh12-hazazeer",
      "sh13-detective",
      "sh9-math",
      "sh9-tf",
      "sh9-odd",
      "sh11-emoji",
      "sh11-who",
      "sh11-older",
      "sh11-list3",
      "riddles"
    ]
  };

  const CATEGORY_ID_TO_GROUP_MAP = new Map();
  Object.entries(CATEGORY_GROUP_ID_FALLBACK).forEach(([groupId, ids]) => {
    ids.forEach((id) => CATEGORY_ID_TO_GROUP_MAP.set(id, groupId));
  });

  const CATEGORY_ALIAS_MAP = {
    "الأردن": "الأردن ومعالمه",
    "جغرافيا": "عواصم وجغرافيا",
    "علوم": "علوم وفضاء",
    "تاريخ": "تاريخ وحضارات",
    "تقنية": "تكنولوجيا واختراعات"
  };

  function normalizeArabicText(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .trim()
      .replace(/\s+/g, " ");
  }

  const LOCAL_VISUAL_CATEGORY_NAMES = new Set(
    ["تحدي الصور", "اربط الصور", "صورة مغبشة", "أوجد الفرق", "زوم شديد", "ذاكرة الصورة"].map(
      normalizeArabicText
    )
  );

  const CATEGORY_NAME_TO_GROUP_MAP = new Map(
    [
      ["رياضة", "sports-life"],
      ["ألغاز وأمثال", "puzzles"],
      ["معلومات عامة", "culture-geo"],
      ["الأردن", "jordan-arab"],
      ["الأردن ومعالمه", "jordan-arab"],
      ["ثقافة إسلامية", "jordan-arab"],
      ["علوم", "science-tech"],
      ["تقنية", "science-tech"],
      ["طب وصحة", "science-tech"],
      ["عالم السيارات", "sports-life"]
    ].map(([name, groupId]) => [normalizeArabicText(name), groupId])
  );

  const CHARADES_NAME_PREFIX = normalizeArabicText("من غير كلام");

  function resolveCategoryGroup(category) {
    if (!category || typeof category !== "object") {
      return "culture-geo";
    }

    if (typeof category.group === "string") {
      const explicitGroup = category.group.trim().toLowerCase();
      if (VALID_CATEGORY_GROUP_IDS.has(explicitGroup)) {
        return explicitGroup;
      }
    }

    const catId = typeof category.id === "string" ? category.id.trim() : "";
    const catName = typeof category.name === "string" ? category.name.trim() : "";
    const normName = normalizeArabicText(catName);

    if (
      catId.startsWith("mgk-") ||
      catName.startsWith("من غير كلام") ||
      normName.startsWith(CHARADES_NAME_PREFIX)
    ) {
      return "charades";
    }

    if (catId.startsWith("sh5-flags-") || LOCAL_VISUAL_CATEGORY_NAMES.has(normName)) {
      return "visual";
    }

    if (Array.isArray(category.questions) && category.questions.length > 0) {
      const visualQuestionsCount = category.questions.filter((q) => {
        const vt = typeof q?.visualType === "string" ? q.visualType.trim().toLowerCase() : "";
        return VISUAL_GROUP_MODES.has(vt);
      }).length;
      if (visualQuestionsCount > category.questions.length / 2) {
        return "visual";
      }
    }

    if (CATEGORY_ID_TO_GROUP_MAP.has(catId)) {
      return CATEGORY_ID_TO_GROUP_MAP.get(catId);
    }

    if (CATEGORY_NAME_TO_GROUP_MAP.has(normName)) {
      return CATEGORY_NAME_TO_GROUP_MAP.get(normName);
    }

    return "culture-geo";
  }

  const NORMALIZED_CATEGORY_ALIAS_MAP = new Map(
    Object.entries(CATEGORY_ALIAS_MAP).map(([alias, canonical]) => [
      normalizeArabicText(alias),
      normalizeArabicText(canonical)
    ])
  );

  function normalizeCategoryName(name) {
    if (typeof name !== "string") return "";
    const trimmed = name.trim().replace(/\s+/g, " ");
    const aliased = CATEGORY_ALIAS_MAP[trimmed] || trimmed;
    const normalized = normalizeArabicText(aliased);
    return NORMALIZED_CATEGORY_ALIAS_MAP.get(normalized) ?? normalized;
  }

  /* =========================================================
     حالة التطبيق (Application State)
     ========================================================= */
  const state = {
    baseCategories: [],
    extraCategories: [],
    customCategories: [],
    sheetsCategories: [],
    sheetsLoading: false,
    lastSheetsSyncAt: null,
    sheetsSourceState: "local", // "local" | "cache" | "live" | "offline-cache"
    localDiagnostics: { cleanedRowsCount: 0, duplicateCount: 0, duplicateIds: [] },
    sheetsDiagnostics: { cleanedRowsCount: 0, duplicateCount: 0, duplicateIds: [] },
    mergeDuplicates: [],
    allCategories: [],
    categoryIdRedirect: new Map(),

    selectedCategoryIds: [],
    activeCategoryGroup: "all",
    searchQuery: "",
    hideCompleted: false,
    bankSearchQuery: "",
    newProfileFormOpen: false,
    tacticalPanelOpen: false,
    setupSettings: matchStore.loadSavedSettings(),
    preferredDoubleCount: Math.max(1, matchStore.loadSavedSettings().doubleCount || 1),
    preferredSwapCount: Math.max(1, matchStore.loadSavedSettings().swapCount || 1),
    pendingConfirmAction: null,
    pendingSavedMatch: null,

    // حالة الجولة الحالية وإعدادات وسائل المساعدة المعتمدة فيها
    matchSettings: matchStore.getDefaultSettings(),
    teams: [
      {
        id: "team-0",
        name: "الفريق الأول",
        score: 0,
        powerups: { doubleLeft: 1, swapLeft: 1 },
        lifelines: { double: false, twoAnswers: false, callFriend: false }
      },
      {
        id: "team-1",
        name: "الفريق الثاني",
        score: 0,
        powerups: { doubleLeft: 1, swapLeft: 1 },
        lifelines: { double: false, twoAnswers: false, callFriend: false }
      }
    ],
    activeTurn: 0,
    doubleArmed: false,
    lastRenderedScores: [0, 0],
    boardCategories: [],
    answeredThisRound: 0,
    matchEvents: [],
    activeAnalyticsTab: "overview",

    // حالة وضع الشاشتين (Dual-Screen Host & TV Display)
    dualScreen: {
      connected: false,
      audioRoute: liveSync ? liveSync.getAudioRoute() : "display",
      closingPreviewQuestion: null
    },

    // حالة نافذة السؤال الحالية
    currentQ: null,
    preQuestionSnapshot: null,
    closingRevealTimeout: null,
    charadesHoldActive: false,
    questionImageRequestId: 0,
    answerImageRequestId: 0,
    questionImageRetryCount: 0,
    answerImageRetryCount: 0,
    currentAnswerImgSrc: "",

    timerInterval: null,
    timerRemaining: MAIN_TIMER_SECONDS,
    timerMax: MAIN_TIMER_SECONDS,
    timerRunning: false,
    timerMode: "main", // "main" | "charades" | "steal" | "ended" | "waiting-memory"

    // حالة مؤقت الذاكرة (لنوع memory)
    memoryInterval: null,
    memoryRemaining: DEFAULT_MEMORY_SECONDS,
    memoryTotal: DEFAULT_MEMORY_SECONDS,
    memoryPhase: null, // "ready" | "loading" | "viewing" | "question" | null

    // حالة عارض التكبير (Lightbox)
    lightbox: {
      items: [],
      index: 0
    },

    // حالة أدوات الحزمة الرابعة (مراجعة الأسئلة، النسخ الاحتياطي، لوحة الصوت)
    flagDrawerOpen: false,
    selectedFlagReason: "typo",
    pendingBackupData: null,
    backupRestoreMode: "merge",
    audioMixerOpen: false
  };

  /* =========================================================
     عناصر الواجهة (DOM References)
     ========================================================= */
  const dom = {
    // الشاشات
    setupScreen: document.getElementById("setup-screen"),
    gameScreen: document.getElementById("game-screen"),
    toastContainer: document.getElementById("toast-container"),
    stealConfettiCanvas: document.getElementById("steal-confetti-canvas"),

    // شاشة الإعداد ومُبدّل المجموعات وقسم وسائل المساعدة التكتيكية
    offlineStatusBadge: document.getElementById("offline-status-badge"),
    offlineStatusBadgeGame: document.getElementById("offline-status-badge-game"),
    btnInstallPwa: document.getElementById("btn-install-pwa"),
    btnAudioMixerSetup: document.getElementById("btn-audio-mixer-setup"),
    btnAudioMixerGame: document.getElementById("btn-audio-mixer-game"),
    btnToggleSoundSetup: document.getElementById("btn-toggle-sound-setup"),
    team1Input: document.getElementById("team1-input"),
    team2Input: document.getElementById("team2-input"),
    tacticalSetupPanel: document.getElementById("tactical-setup-panel"),
    btnToggleTacticalPanel: document.getElementById("btn-toggle-tactical-panel"),
    tacticalSummaryPills: document.getElementById("tactical-summary-pills"),
    tacticalPanelBody: document.getElementById("tactical-panel-body"),
    tacticalCardHint: document.getElementById("tactical-card-hint"),
    tacticalCardDouble: document.getElementById("tactical-card-double"),
    tacticalCardSwap: document.getElementById("tactical-card-swap"),
    tacticalCardSteal: document.getElementById("tactical-card-steal"),
    tacticalCardMainTimer: document.getElementById("tactical-card-main-timer"),
    tacticalCardWakelock: document.getElementById("tactical-card-wakelock"),
    toggleHintEnabled: document.getElementById("toggle-hint-enabled"),
    toggleDoubleEnabled: document.getElementById("toggle-double-enabled"),
    toggleSwapEnabled: document.getElementById("toggle-swap-enabled"),
    toggleStealEnabled: document.getElementById("toggle-steal-enabled"),
    toggleWakelockEnabled: document.getElementById("toggle-wakelock-enabled"),
    wakelockStatusNote: document.getElementById("wakelock-status-note"),
    btnResetTacticalDefaults: document.getElementById("btn-reset-tactical-defaults"),
    profileSwitcherBar: document.getElementById("profile-switcher-bar"),
    profilePillsList: document.getElementById("profile-pills-list"),
    btnToggleNewProfile: document.getElementById("btn-toggle-new-profile"),
    newProfileForm: document.getElementById("new-profile-form"),
    newProfileInput: document.getElementById("new-profile-input"),
    btnSaveNewProfile: document.getElementById("btn-save-new-profile"),
    btnCancelNewProfile: document.getElementById("btn-cancel-new-profile"),

    selectionCounter: document.getElementById("selection-counter"),
    selectedCount: document.getElementById("selected-count"),
    categoryGroupsBar: document.getElementById("category-groups-bar"),
    categorySearchInput: document.getElementById("category-search-input"),
    btnClearSearch: document.getElementById("btn-clear-search"),
    btnHideCompleted: document.getElementById("btn-hide-completed"),
    btnClearSelections: document.getElementById("btn-clear-selections"),
    setupCategoriesGrid: document.getElementById("setup-categories-grid"),
    playedSummary: document.getElementById("played-summary"),
    btnSyncSheets: document.getElementById("btn-sync-sheets"),
    sheetsStatusBar: document.getElementById("sheets-status-bar"),
    sheetsStatusSpinner: document.getElementById("sheets-status-spinner"),
    sheetsStatusText: document.getElementById("sheets-status-text"),
    btnOpenBankManager: document.getElementById("btn-open-bank-manager"),
    btnBalancedCategories: document.getElementById("btn-balanced-categories"),
    btnRandomCategories: document.getElementById("btn-random-categories"),
    btnResetHistory: document.getElementById("btn-reset-history"),
    btnStartGame: document.getElementById("btn-start-game"),
    btnStartGameLabel: document.getElementById("btn-start-game-label"),

    // الشريط العلوي للوحة اللعب وزر التراجع
    scoreboardTeam1: document.getElementById("scoreboard-team-1"),
    scoreboardTeam2: document.getElementById("scoreboard-team-2"),
    boardTeam1Name: document.getElementById("board-team1-name"),
    boardTeam2Name: document.getElementById("board-team2-name"),
    boardTeam1Score: document.getElementById("board-team1-score"),
    boardTeam2Score: document.getElementById("board-team2-score"),
    team1LifelinesStatus: document.getElementById("team1-lifelines-status"),
    team2LifelinesStatus: document.getElementById("team2-lifelines-status"),
    boardRemainingPill: document.getElementById("board-remaining-pill"),
    btnUndoAction: document.getElementById("btn-undo-action"),
    undoStepsBadge: document.getElementById("undo-steps-badge"),
    btnSwitchTurn: document.getElementById("btn-switch-turn"),
    btnEndRound: document.getElementById("btn-end-round"),
    btnReturnSetup: document.getElementById("btn-return-setup"),
    btnToggleSound: document.getElementById("btn-toggle-sound"),
    btnToggleFullscreen: document.getElementById("btn-toggle-fullscreen"),
    btnOpenTvDisplay: document.getElementById("btn-open-tv-display"),
    dualScreenStatusBar: document.getElementById("dual-screen-status-bar"),
    dualScreenStatusPill: document.getElementById("dual-screen-status-pill"),
    btnToggleAudioRoute: document.getElementById("btn-toggle-audio-route"),
    btnResyncTv: document.getElementById("btn-resync-tv"),
    btnCloseTv: document.getElementById("btn-close-tv"),
    gameBoardGrid: document.getElementById("game-board-grid"),

    // نافذة السؤال والوسائط البصرية ووضع «من غير كلام» والسرقة ولوحة تحكم المقدّم
    questionModal: document.getElementById("question-modal"),
    qModalScrollBody: document.getElementById("q-modal-scroll-body"),
    questionBodyBox: document.getElementById("question-body-box"),
    modalCategoryIcon: document.getElementById("modal-category-icon"),
    modalCategoryName: document.getElementById("modal-category-name"),
    modalPointsPill: document.getElementById("modal-points-pill"),
    modalVisualTypePill: document.getElementById("modal-visual-type-pill"),
    modalTurnBadge: document.getElementById("modal-turn-badge"),
    modalActiveTeamName: document.getElementById("modal-active-team-name"),

    stealStatusBanner: document.getElementById("steal-status-banner"),
    stealBannerText: document.getElementById("steal-banner-text"),
    stealBannerPtsBadge: document.getElementById("steal-banner-pts-badge"),
    stealTeamSelector: document.getElementById("steal-team-selector"),

    hostTvStatusBar: document.getElementById("host-tv-status-bar"),
    hostTvVisibilityPill: document.getElementById("host-tv-visibility-pill"),
    hostTvMaskPill: document.getElementById("host-tv-mask-pill"),
    btnHostCockpitUndo: document.getElementById("btn-host-cockpit-undo"),
    hostCockpitCard: document.getElementById("host-cockpit-card"),
    hostCockpitCharadesTag: document.getElementById("host-cockpit-charades-tag"),
    hostCockpitAnswerText: document.getElementById("host-cockpit-answer-text"),
    hostCockpitHintRow: document.getElementById("host-cockpit-hint-row"),
    hostCockpitHintText: document.getElementById("host-cockpit-hint-text"),
    btnHostProjectHint: document.getElementById("btn-host-project-hint"),
    hostCockpitExpRow: document.getElementById("host-cockpit-exp-row"),
    hostCockpitExpLabel: document.getElementById("host-cockpit-exp-label"),
    hostCockpitExpText: document.getElementById("host-cockpit-exp-text"),

    timerSection: document.getElementById("timer-section"),
    timerDisplay: document.getElementById("timer-display"),
    timerModeLabel: document.getElementById("timer-mode-label"),
    timerProgressBar: document.getElementById("timer-progress-bar"),
    btnTimerToggle: document.getElementById("btn-timer-toggle"),
    timerToggleIcon: document.getElementById("timer-toggle-icon"),
    timerToggleText: document.getElementById("timer-toggle-text"),
    btnTimerReset: document.getElementById("btn-timer-reset"),

    activeLifelinesBanners: document.getElementById("active-lifelines-banners"),

    // عناصر وضع «من غير كلام» (CharadesQuestionView)
    charadesView: document.getElementById("charades-view"),
    charadesHeaderCard: document.getElementById("charades-header-card"),
    charadesEyebrowText: document.getElementById("charades-eyebrow-text"),
    charadesTopicTitle: document.getElementById("charades-topic-title"),
    charadesWordCountPill: document.getElementById("charades-word-count-pill"),
    charadesActorStage: document.getElementById("charades-actor-stage"),
    charadesDecoyCard: document.getElementById("charades-decoy-card"),
    charadesSecretCard: document.getElementById("charades-secret-card"),
    charadesSecretAnswer: document.getElementById("charades-secret-answer"),
    charadesSecretExplanation: document.getElementById("charades-secret-explanation"),
    btnHoldRevealSecret: document.getElementById("btn-hold-reveal-secret"),
    btnHoldRevealLabel: document.getElementById("btn-hold-reveal-label"),
    charadesTimerBox: document.getElementById("charades-timer-box"),
    charadesDurationPills: document.getElementById("charades-duration-pills"),
    charadesTimerDisplay: document.getElementById("charades-timer-display"),
    charadesTimerStatus: document.getElementById("charades-timer-status"),
    charadesTimerProgress: document.getElementById("charades-timer-progress"),
    btnCharadesTimerToggle: document.getElementById("btn-charades-timer-toggle"),
    charadesTimerToggleIcon: document.getElementById("charades-timer-toggle-icon"),
    charadesTimerToggleText: document.getElementById("charades-timer-toggle-text"),
    btnCharadesTimerReset: document.getElementById("btn-charades-timer-reset"),

    memoryReadyPanel: document.getElementById("memory-ready-panel"),
    btnMemoryStart: document.getElementById("btn-memory-start"),
    memoryCountdownPanel: document.getElementById("memory-countdown-panel"),
    memorySecondsDisplay: document.getElementById("memory-seconds-display"),
    memoryProgressBar: document.getElementById("memory-progress-bar"),
    btnMemorySkip: document.getElementById("btn-memory-skip"),
    modalQuestionText: document.getElementById("modal-question-text"),
    modalQuestionImageWrap: document.getElementById("modal-question-image-wrap"),
    visualImageStage: document.getElementById("visual-image-stage"),
    visualImageSkeleton: document.getElementById("visual-image-skeleton"),
    visualLoadingLabel: document.getElementById("visual-loading-label"),
    visualImageError: document.getElementById("visual-image-error"),
    btnRetryVisualImage: document.getElementById("btn-retry-visual-image"),
    btnSkipBrokenMemory: document.getElementById("btn-skip-broken-memory"),
    modalQuestionImage: document.getElementById("modal-question-image"),
    singleImageZoomHint: document.getElementById("single-image-zoom-hint"),
    blurControlsWrap: document.getElementById("blur-controls-wrap"),
    btnReduceBlur: document.getElementById("btn-reduce-blur"),
    zoomControlsWrap: document.getElementById("zoom-controls-wrap"),
    btnReduceZoom: document.getElementById("btn-reduce-zoom"),
    spotDiffBadgeWrap: document.getElementById("spot-diff-badge-wrap"),
    spotDiffCountBadge: document.getElementById("spot-diff-count-badge"),
    modalMultiImagesWrap: document.getElementById("modal-multi-images-wrap"),

    // شريط الأدوات التكتيكية داخل السؤال
    questionTacticalBar: document.getElementById("question-tactical-bar"),
    questionHintWrap: document.getElementById("question-hint-wrap"),
    btnShowHint: document.getElementById("btn-show-hint"),
    btnShowHintText: document.getElementById("btn-show-hint-text"),
    questionSwapWrap: document.getElementById("question-swap-wrap"),
    btnSwapQuestion: document.getElementById("btn-swap-question"),
    btnSwapQuestionText: document.getElementById("btn-swap-question-text"),
    swapUnavailableNote: document.getElementById("swap-unavailable-note"),
    questionHintBox: document.getElementById("question-hint-box"),

    answerSection: document.getElementById("answer-section"),
    modalAnswerText: document.getElementById("modal-answer-text"),
    modalAnswerExplanation: document.getElementById("modal-answer-explanation"),
    modalAnswerImageWrap: document.getElementById("modal-answer-image-wrap"),
    answerImageStage: document.getElementById("answer-image-stage"),
    answerImageSkeleton: document.getElementById("answer-image-skeleton"),
    answerImageError: document.getElementById("answer-image-error"),
    btnRetryAnswerImage: document.getElementById("btn-retry-answer-image"),
    modalAnswerImage: document.getElementById("modal-answer-image"),
    answerImageZoomHint: document.getElementById("answer-image-zoom-hint"),

    awardButtonsGrid: document.getElementById("award-buttons-grid"),
    btnAwardTeam1: document.getElementById("btn-award-team1"),
    btnAwardTeam2: document.getElementById("btn-award-team2"),
    btnAwardNone: document.getElementById("btn-award-none"),
    awardTeam1Label: document.getElementById("award-team1-label"),
    awardTeam2Label: document.getElementById("award-team2-label"),
    awardTeam1Pts: document.getElementById("award-team1-pts"),
    awardTeam2Pts: document.getElementById("award-team2-pts"),

    preRevealActions: document.getElementById("pre-reveal-actions"),
    postRevealActions: document.getElementById("post-reveal-actions"),
    stealOfferActions: document.getElementById("steal-offer-actions"),
    stealOfferPrompt: document.getElementById("steal-offer-prompt"),
    btnOpenSteal: document.getElementById("btn-open-steal"),
    btnOpenStealLabel: document.getElementById("btn-open-steal-label"),
    btnSkipStealClose: document.getElementById("btn-skip-steal-close"),
    btnCancelStealOffer: document.getElementById("btn-cancel-steal-offer"),
    stealActiveActions: document.getElementById("steal-active-actions"),
    stealActivePrompt: document.getElementById("steal-active-prompt"),
    btnStealSuccess: document.getElementById("btn-steal-success"),
    btnStealSuccessLabel: document.getElementById("btn-steal-success-label"),
    btnStealFail: document.getElementById("btn-steal-fail"),
    btnStealPeekAnswer: document.getElementById("btn-steal-peek-answer"),
    closingRevealActions: document.getElementById("closing-reveal-actions"),
    btnFinishClosingReveal: document.getElementById("btn-finish-closing-reveal"),
    btnCancelQuestion: document.getElementById("btn-cancel-question"),
    btnFlagQuestion: document.getElementById("btn-flag-question"),
    btnFlagQuestionLabel: document.getElementById("btn-flag-question-label"),
    flagQuestionDrawer: document.getElementById("flag-question-drawer"),
    btnCloseFlagDrawer: document.getElementById("btn-close-flag-drawer"),
    flagReasonChips: document.getElementById("flag-reason-chips"),
    flagNoteInput: document.getElementById("flag-note-input"),
    btnSaveFlag: document.getElementById("btn-save-flag"),
    btnRemoveFlag: document.getElementById("btn-remove-flag"),
    btnRevealAnswer: document.getElementById("btn-reveal-answer"),
    btnRevealAnswerLabel: document.getElementById("btn-reveal-answer-label"),
    btnWrongAnswer: document.getElementById("btn-wrong-answer"),
    btnWrongAnswerLabel: document.getElementById("btn-wrong-answer-label"),

    // نافذة الفائز
    winnerModal: document.getElementById("winner-modal"),
    winnerModalCard: document.getElementById("winner-modal-card"),
    confettiCanvas: document.getElementById("confetti-canvas"),
    winnerTrophy: document.getElementById("winner-trophy"),
    winnerSubtitle: document.getElementById("winner-subtitle"),
    winnerTitle: document.getElementById("winner-title"),
    winnerCardTeam1: document.getElementById("winner-card-team1"),
    winnerCardTeam2: document.getElementById("winner-card-team2"),
    winnerTeam1Name: document.getElementById("winner-team1-name"),
    winnerTeam2Name: document.getElementById("winner-team2-name"),
    winnerTeam1Score: document.getElementById("winner-team1-score"),
    winnerTeam2Score: document.getElementById("winner-team2-score"),
    winnerStatsNote: document.getElementById("winner-stats-note"),
    winnerAnalyticsDashboard: document.getElementById("winner-analytics-dashboard"),
    btnTabAnalyticsOverview: document.getElementById("btn-tab-analytics-overview"),
    btnTabAnalyticsLog: document.getElementById("btn-tab-analytics-log"),
    analyticsLogCount: document.getElementById("analytics-log-count"),
    btnCopyMatchSummary: document.getElementById("btn-copy-match-summary"),
    analyticsOverviewPanel: document.getElementById("analytics-overview-panel"),
    analyticsLogPanel: document.getElementById("analytics-log-panel"),
    analyticsKpiGrid: document.getElementById("analytics-kpi-grid"),
    analyticsTeamCompare: document.getElementById("analytics-team-compare"),
    analyticsCategoriesBreakdown: document.getElementById("analytics-categories-breakdown"),
    analyticsEventsList: document.getElementById("analytics-events-list"),
    btnRematchRound: document.getElementById("btn-rematch-round"),
    btnNewRound: document.getElementById("btn-new-round"),
    btnResumeRound: document.getElementById("btn-resume-round"),

    // نافذة إدارة بنك الأسئلة
    bankManagerModal: document.getElementById("bank-manager-modal"),
    btnCloseBankManager: document.getElementById("btn-close-bank-manager"),
    bankFlaggedCount: document.getElementById("bank-flagged-count"),
    btnExportFlaggedCsv: document.getElementById("btn-export-flagged-csv"),
    btnCopyFlaggedJson: document.getElementById("btn-copy-flagged-json"),
    btnClearAllFlagged: document.getElementById("btn-clear-all-flagged"),
    bankFlaggedList: document.getElementById("bank-flagged-list"),
    btnExportFullBackup: document.getElementById("btn-export-full-backup"),
    inputImportBackupFile: document.getElementById("input-import-backup-file"),
    backupImportPreview: document.getElementById("backup-import-preview"),
    backupPreviewSummary: document.getElementById("backup-preview-summary"),
    btnConfirmRestoreBackup: document.getElementById("btn-confirm-restore-backup"),
    btnCancelRestoreBackup: document.getElementById("btn-cancel-restore-backup"),
    backupFeedbackBox: document.getElementById("backup-feedback-box"),

    // لوحة التحكم المتقدمة بالصوت (Audio Mixer Popover)
    audioMixerPopover: document.getElementById("audio-mixer-popover"),
    btnCloseAudioMixer: document.getElementById("btn-close-audio-mixer"),
    audioVolumeSlider: document.getElementById("audio-volume-slider"),
    audioVolumeValue: document.getElementById("audio-volume-value"),
    toggleSfxTimer: document.getElementById("toggle-sfx-timer"),
    toggleSfxUi: document.getElementById("toggle-sfx-ui"),
    toggleSfxCelebrations: document.getElementById("toggle-sfx-celebrations"),
    btnTestAudio: document.getElementById("btn-test-audio"),
    btnMixerMute: document.getElementById("btn-mixer-mute"),
    bankSourcesSummary: document.getElementById("bank-sources-summary"),
    bankActiveProfilePill: document.getElementById("bank-active-profile-pill"),
    bankProfileStatsGrid: document.getElementById("bank-profile-stats-grid"),
    btnBankProfileReset: document.getElementById("btn-bank-profile-reset"),
    bankLastSyncPill: document.getElementById("bank-last-sync-pill"),
    bankHealthMetrics: document.getElementById("bank-health-metrics"),
    bankDuplicatesBox: document.getElementById("bank-duplicates-box"),
    bankUnder50Box: document.getElementById("bank-under50-box"),
    bankOverviewCount: document.getElementById("bank-overview-count"),
    bankCategorySearch: document.getElementById("bank-category-search"),
    btnClearBankSearch: document.getElementById("btn-clear-bank-search"),
    bankCategoriesOverview: document.getElementById("bank-categories-overview"),
    bankJsonInput: document.getElementById("bank-json-input"),
    btnImportJson: document.getElementById("btn-import-json"),
    btnClearJsonInput: document.getElementById("btn-clear-json-input"),
    bankImportFeedback: document.getElementById("bank-import-feedback"),
    bankExportStats: document.getElementById("bank-export-stats"),
    btnExportExtraJs: document.getElementById("btn-export-extra-js"),
    btnClearAllCustom: document.getElementById("btn-clear-all-custom"),
    bankCustomList: document.getElementById("bank-custom-list"),
    btnBankResetHistory: document.getElementById("btn-bank-reset-history"),
    btnBankFooterClose: document.getElementById("btn-bank-footer-close"),

    // نافذة التأكيد
    confirmModal: document.getElementById("confirm-modal"),
    confirmTitle: document.getElementById("confirm-title"),
    confirmMessage: document.getElementById("confirm-message"),
    btnConfirmCancel: document.getElementById("btn-confirm-cancel"),
    btnConfirmOk: document.getElementById("btn-confirm-ok"),

    // نافذة استئناف المباراة السابقة
    resumeMatchModal: document.getElementById("resume-match-modal"),
    resumeMatchSummary: document.getElementById("resume-match-summary"),
    btnResumeSavedMatch: document.getElementById("btn-resume-saved-match"),
    btnDiscardSavedMatch: document.getElementById("btn-discard-saved-match"),

    // عارض تكبير الصور (Lightbox)
    imageLightbox: document.getElementById("image-lightbox"),
    lightboxImg: document.getElementById("lightbox-img"),
    lightboxCaption: document.getElementById("lightbox-caption"),
    btnLightboxClose: document.getElementById("btn-lightbox-close"),
    btnLightboxPrev: document.getElementById("btn-lightbox-prev"),
    btnLightboxNext: document.getElementById("btn-lightbox-next")
  };

  /* =========================================================
     أدوات مساعدة (Utilities)
     ========================================================= */
  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function shuffleArray(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatTime(totalSeconds) {
    const clamped = Math.max(0, Math.floor(totalSeconds));
    const mins = Math.floor(clamped / 60);
    const secs = clamped % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function formatTimestampArabic(ts) {
    if (!ts || !Number.isFinite(Number(ts))) return "لم يتوفر بعد";
    try {
      const d = new Date(Number(ts));
      return d.toLocaleTimeString("ar-JO", {
        hour: "2-digit",
        minute: "2-digit"
      }) + " • " + d.toLocaleDateString("ar-JO", {
        month: "short",
        day: "numeric"
      });
    } catch (_err) {
      return new Date(Number(ts)).toLocaleString();
    }
  }

  const TOAST_ICONS = {
    success: "✅",
    warning: "⚠️",
    error: "❌",
    info: "ℹ️"
  };

  function showToast(message, variant = "info") {
    if (!dom.toastContainer) return;

    while (dom.toastContainer.children.length >= 3) {
      dom.toastContainer.firstElementChild.remove();
    }

    const variantClass =
      variant === "success"
        ? "toast-success"
        : variant === "warning"
          ? "toast-warning"
          : variant === "error"
            ? "toast-error"
            : "";

    const toast = document.createElement("div");
    toast.className = `toast ${variantClass}`.trim();

    const iconEl = document.createElement("span");
    iconEl.className = "toast-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = TOAST_ICONS[variant] || TOAST_ICONS.info;

    const textEl = document.createElement("span");
    textEl.className = "toast-text";
    textEl.textContent = String(message || "");

    toast.appendChild(iconEl);
    toast.appendChild(textEl);
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("toast-exit");
      toast.addEventListener("animationend", () => toast.remove(), { once: true });
    }, 3000);
  }

  function getCategoryNewCount(category) {
    return historyStore.getCategoryNewCount(category);
  }

  function getTotalBankStats() {
    return historyStore.getBankStatsForProfile(state.allCategories);
  }

  /* =========================================================
     مُبدّل ملفات المجموعات (Profile Switcher UI)
     ========================================================= */
  function renderProfileSwitcher() {
    if (!dom.profilePillsList) return;
    const profiles = historyStore.getProfiles();
    const activeId = historyStore.getActiveProfileId();

    dom.profilePillsList.innerHTML = "";

    profiles.forEach((profile) => {
      const isActive = profile.id === activeId;
      const wrap = document.createElement("div");
      wrap.className = `profile-pill-wrap${isActive ? " active" : ""}`;

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "profile-pill-btn";
      selectBtn.setAttribute("aria-pressed", String(isActive));
      selectBtn.title = `تفعيل مجموعة «${profile.name}» (${profile.playedCount} سؤال ملعوب)`;
      selectBtn.innerHTML = `
        <span>${escapeHtml(profile.name)}</span>
        <span class="profile-pill-count" title="عدد الأسئلة الملعوبة في هذه المجموعة">${profile.playedCount}</span>
      `;
      selectBtn.addEventListener("click", () => {
        if (profile.id === historyStore.getActiveProfileId()) return;
        historyStore.setActiveProfile(profile.id);
        renderSetupScreen();
        if (dom.bankManagerModal.classList.contains("open")) {
          renderBankManagerModal();
        }
        showToast(`تم التبديل إلى مجموعة «${profile.name}» 👤`, "info");
      });

      wrap.appendChild(selectBtn);

      if (!profile.isDefault) {
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "profile-pill-delete";
        delBtn.title = `حذف مجموعة «${profile.name}»`;
        delBtn.setAttribute("aria-label", `حذف مجموعة ${profile.name}`);
        delBtn.textContent = "×";
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          requestDeleteProfile(profile);
        });
        wrap.appendChild(delBtn);
      }

      dom.profilePillsList.appendChild(wrap);
    });

    if (dom.newProfileForm && dom.btnToggleNewProfile) {
      dom.newProfileForm.hidden = !state.newProfileFormOpen;
      dom.btnToggleNewProfile.setAttribute("aria-expanded", String(state.newProfileFormOpen));
    }
  }

  function toggleNewProfileForm(forceOpen) {
    state.newProfileFormOpen =
      typeof forceOpen === "boolean" ? forceOpen : !state.newProfileFormOpen;
    if (dom.newProfileForm) {
      dom.newProfileForm.hidden = !state.newProfileFormOpen;
    }
    if (dom.btnToggleNewProfile) {
      dom.btnToggleNewProfile.setAttribute("aria-expanded", String(state.newProfileFormOpen));
    }
    if (state.newProfileFormOpen && dom.newProfileInput) {
      dom.newProfileInput.value = "";
      dom.newProfileInput.focus();
    }
  }

  function handleCreateProfile(rawName) {
    const res = historyStore.createProfile(rawName, true);
    if (!res.ok) {
      showToast(res.error || "تعذر إنشاء المجموعة", "warning");
      return;
    }
    state.newProfileFormOpen = false;
    if (dom.newProfileInput) {
      dom.newProfileInput.value = "";
    }
    renderSetupScreen();
    if (dom.bankManagerModal.classList.contains("open")) {
      renderBankManagerModal();
    }
    showToast(`تم إنشاء وتفعيل مجموعة «${res.profile.name}» بنجاح ✨`, "success");
  }

  function requestDeleteProfile(profile) {
    if (!profile || profile.isDefault) return;
    openConfirmDialog({
      title: `حذف مجموعة «${profile.name}»؟`,
      message: `سيتم حذف ملف مجموعة «${profile.name}» وسجل الأسئلة الملعوبة الخاص به (${profile.playedCount} سؤالاً). لن تتأثر المجموعات الأخرى.`,
      confirmText: "نعم، احذف المجموعة",
      onConfirm: () => {
        const res = historyStore.deleteProfile(profile.id);
        if (res.ok) {
          renderSetupScreen();
          if (dom.bankManagerModal.classList.contains("open")) {
            renderBankManagerModal();
          }
          showToast(`تم حذف مجموعة «${res.deletedName}» 🗑️`, "info");
        }
      }
    });
  }

  /* =========================================================
     شاشة إعداد الجولة (Setup Screen)
     ========================================================= */
  function buildCategoryGroupStats() {
    const selectedSet = new Set(state.selectedCategoryIds);
    const categoriesByGroup = new Map();
    const totalByGroup = new Map();
    const selectedByGroup = new Map();

    CATEGORY_GROUPS.forEach((group) => {
      categoriesByGroup.set(group.id, []);
      totalByGroup.set(group.id, 0);
      selectedByGroup.set(group.id, 0);
    });

    state.allCategories.forEach((cat) => {
      const groupId = resolveCategoryGroup(cat);
      const isSelected = selectedSet.has(cat.id);

      categoriesByGroup.get("all").push(cat);
      totalByGroup.set("all", totalByGroup.get("all") + 1);
      if (isSelected) {
        selectedByGroup.set("all", selectedByGroup.get("all") + 1);
      }

      if (categoriesByGroup.has(groupId)) {
        categoriesByGroup.get(groupId).push(cat);
        totalByGroup.set(groupId, totalByGroup.get(groupId) + 1);
        if (isSelected) {
          selectedByGroup.set(groupId, selectedByGroup.get(groupId) + 1);
        }
      }
    });

    return { categoriesByGroup, totalByGroup, selectedByGroup };
  }

  function renderCategoryGroupsBar(groupStats) {
    if (!dom.categoryGroupsBar) return;

    const prevScrollLeft = dom.categoryGroupsBar.scrollLeft;
    dom.categoryGroupsBar.innerHTML = "";

    CATEGORY_GROUPS.forEach((group) => {
      const totalCount = groupStats.totalByGroup.get(group.id) || 0;
      if (totalCount === 0) return;

      const selectedInGroup = groupStats.selectedByGroup.get(group.id) || 0;
      const isActive = state.activeCategoryGroup === group.id;
      const showSelectedBadge = group.id !== "all" && selectedInGroup > 0;

      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `category-group-tab${isActive ? " active" : ""}${showSelectedBadge ? " has-selected" : ""}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(isActive));
      tab.setAttribute("aria-controls", "setup-categories-grid");
      tab.dataset.groupId = group.id;

      tab.innerHTML = `
        <span class="group-tab-icon" aria-hidden="true">${group.icon}</span>
        <span class="group-tab-label">${group.label}</span>
        <span class="group-tab-count" aria-label="إجمالي الفئات">${totalCount}</span>
        ${
          showSelectedBadge
            ? `<span class="group-tab-selected-badge" aria-label="${selectedInGroup} فئات مختارة">${selectedInGroup} مختارة</span>`
            : ""
        }
      `;

      tab.addEventListener("click", () => setActiveCategoryGroup(group.id));
      dom.categoryGroupsBar.appendChild(tab);
    });

    dom.categoryGroupsBar.scrollLeft = prevScrollLeft;
  }

  function setActiveCategoryGroup(groupId) {
    if (state.activeCategoryGroup === groupId) return;
    state.activeCategoryGroup = groupId;
    renderSetupScreen();

    if (dom.categoryGroupsBar) {
      const activeTab = dom.categoryGroupsBar.querySelector(`[data-group-id="${groupId}"]`);
      if (activeTab && typeof activeTab.scrollIntoView === "function") {
        activeTab.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
      }
    }
  }

  /* =========================================================
     إعدادات وسائل المساعدة واللعب التكتيكي في شاشة الإعداد
     ========================================================= */
  function toggleTacticalSetupPanel(forceOpen) {
    state.tacticalPanelOpen =
      typeof forceOpen === "boolean" ? forceOpen : !state.tacticalPanelOpen;
    renderTacticalSetupPanel();
  }

  function renderTacticalSetupPanel() {
    if (!dom.tacticalSetupPanel) return;
    const cfg = state.setupSettings;

    if (dom.btnToggleTacticalPanel && dom.tacticalPanelBody) {
      dom.btnToggleTacticalPanel.setAttribute("aria-expanded", String(state.tacticalPanelOpen));
      dom.tacticalPanelBody.hidden = !state.tacticalPanelOpen;
    }

    if (dom.tacticalSummaryPills) {
      const hintLabel = cfg.hintEnabled
        ? cfg.hintPenalty > 0
          ? `💡 تلميح (-${Math.round(cfg.hintPenalty * 100)}%)`
          : "💡 تلميح (مجاني)"
        : "💡 تلميح (معطّل)";
      const doubleLabel =
        cfg.doubleEnabled && cfg.doubleCount > 0
          ? `⚡ 2x (${cfg.doubleCount})`
          : "⚡ 2x (معطّل)";
      const swapLabel =
        cfg.swapEnabled && cfg.swapCount > 0
          ? `🔄 تبديل (${cfg.swapCount})`
          : "🔄 تبديل (معطّل)";
      const stealLabel = cfg.stealEnabled
        ? `🔥 سرقة (${Math.round(cfg.stealMultiplier * 100)}% • ${cfg.stealTimerSeconds}ث)`
        : "🔥 سرقة (معطّل)";
      const mainTimerSec = Number(cfg.mainTimerSeconds);
      const timerLabel =
        mainTimerSec === 0 ? "⏱️ بدون مؤقت" : `⏱️ المؤقت (${mainTimerSec || MAIN_TIMER_SECONDS}ث)`;

      dom.tacticalSummaryPills.innerHTML = `
        <span class="tactical-summary-pill is-active">${timerLabel}</span>
        <span class="tactical-summary-pill ${cfg.hintEnabled ? "is-active" : "is-off"}">${hintLabel}</span>
        <span class="tactical-summary-pill ${cfg.doubleEnabled && cfg.doubleCount > 0 ? "is-active" : "is-off"}">${doubleLabel}</span>
        <span class="tactical-summary-pill ${cfg.swapEnabled && cfg.swapCount > 0 ? "is-active" : "is-off"}">${swapLabel}</span>
        <span class="tactical-summary-pill ${cfg.stealEnabled ? "is-active" : "is-off"}">${stealLabel}</span>
      `;
    }

    const syncSwitch = (btnEl, cardEl, enabled) => {
      if (btnEl) {
        btnEl.classList.toggle("active", Boolean(enabled));
        btnEl.setAttribute("aria-checked", String(Boolean(enabled)));
      }
      if (cardEl) {
        cardEl.classList.toggle("is-disabled", !enabled);
      }
    };

    syncSwitch(dom.toggleHintEnabled, dom.tacticalCardHint, cfg.hintEnabled);
    syncSwitch(dom.toggleDoubleEnabled, dom.tacticalCardDouble, cfg.doubleEnabled && cfg.doubleCount > 0);
    syncSwitch(dom.toggleSwapEnabled, dom.tacticalCardSwap, cfg.swapEnabled && cfg.swapCount > 0);
    syncSwitch(dom.toggleStealEnabled, dom.tacticalCardSteal, cfg.stealEnabled);
    syncWakeLockSetupUI();

    dom.tacticalSetupPanel.querySelectorAll(".tactical-opt-btn").forEach((btn) => {
      const key = btn.dataset.setting;
      const val = Number(btn.dataset.value);
      const currentVal = Number(cfg[key]);
      btn.classList.toggle("active", currentVal === val);
      btn.setAttribute("aria-pressed", String(currentVal === val));
    });
  }

  function updateSetupSetting(patch) {
    const merged = { ...state.setupSettings, ...patch };
    if (typeof patch.doubleCount === "number") {
      if (patch.doubleCount > 0) {
        state.preferredDoubleCount = patch.doubleCount;
        merged.doubleEnabled = true;
      } else {
        merged.doubleEnabled = false;
      }
    }
    if (typeof patch.swapCount === "number") {
      if (patch.swapCount > 0) {
        state.preferredSwapCount = patch.swapCount;
        merged.swapEnabled = true;
      } else {
        merged.swapEnabled = false;
      }
    }
    state.setupSettings = matchStore.saveSettings(merged);
    renderTacticalSetupPanel();
  }

  function resetTacticalSettingsToDefaults() {
    const defaults = matchStore.getDefaultSettings();
    state.preferredDoubleCount = defaults.doubleCount;
    state.preferredSwapCount = defaults.swapCount;
    state.setupSettings = matchStore.saveSettings(defaults);
    renderTacticalSetupPanel();
    showToast("تمت استعادة الإعدادات التكتيكية المتوازنة ⚡", "info");
  }

  function renderSetupScreen() {
    renderProfileSwitcher();
    renderTacticalSetupPanel();

    const groupStats = buildCategoryGroupStats();

    if (
      state.activeCategoryGroup !== "all" &&
      (groupStats.totalByGroup.get(state.activeCategoryGroup) || 0) === 0
    ) {
      state.activeCategoryGroup = "all";
    }

    renderCategoryGroupsBar(groupStats);

    const rawSearch = typeof state.searchQuery === "string" ? state.searchQuery : "";
    const normQuery = normalizeArabicText(rawSearch).toLowerCase();

    if (dom.btnClearSearch) {
      dom.btnClearSearch.hidden = rawSearch.trim().length === 0;
    }
    if (dom.btnHideCompleted) {
      dom.btnHideCompleted.classList.toggle("active", state.hideCompleted);
      dom.btnHideCompleted.setAttribute("aria-pressed", String(state.hideCompleted));
    }

    const groupCategories = groupStats.categoriesByGroup.get(state.activeCategoryGroup) || [];
    const visibleCategories = groupCategories.filter((cat) => {
      if (state.hideCompleted && getCategoryNewCount(cat) === 0) {
        return false;
      }
      if (normQuery) {
        const hayName = normalizeArabicText(cat.name || "").toLowerCase();
        const hayDesc = normalizeArabicText(cat.description || "").toLowerCase();
        if (!hayName.includes(normQuery) && !hayDesc.includes(normQuery)) {
          return false;
        }
      }
      return true;
    });

    dom.setupCategoriesGrid.innerHTML = "";

    if (visibleCategories.length === 0) {
      const emptyBox = document.createElement("div");
      emptyBox.className = "categories-empty-state";
      emptyBox.innerHTML = `
        <div class="categories-empty-icon" aria-hidden="true">🔍</div>
        <div class="categories-empty-title">لا توجد فئات مطابقة للتصفية الحالية</div>
        <div class="categories-empty-desc">جرّب تعديل كلمة البحث أو إظهار الفئات المكتملة أو الانتقال لتبويب «الكل».</div>
      `;

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn btn-secondary btn-sm";
      resetBtn.textContent = "عرض جميع الفئات";
      resetBtn.addEventListener("click", () => {
        state.searchQuery = "";
        state.hideCompleted = false;
        state.activeCategoryGroup = "all";
        if (dom.categorySearchInput) {
          dom.categorySearchInput.value = "";
        }
        renderSetupScreen();
      });

      emptyBox.appendChild(resetBtn);
      dom.setupCategoriesGrid.appendChild(emptyBox);
      updateSetupControls();
      return;
    }

    visibleCategories.forEach((cat) => {
      const isSelected = state.selectedCategoryIds.includes(cat.id);
      const totalCount = cat.questions.length;
      const newCount = getCategoryNewCount(cat);
      const playedCount = Math.max(0, totalCount - newCount);
      const hasPartialProgress = playedCount > 0 && newCount > 0;
      const playedPercent = totalCount > 0 ? Math.min(100, Math.round((playedCount / totalCount) * 100)) : 0;
      const groupId = resolveCategoryGroup(cat);
      const accentColor = getCategoryAccentColor(cat, groupId);

      const card = document.createElement("button");
      card.type = "button";
      card.className = `setup-cat-card${isSelected ? " selected" : ""}`;
      card.style.setProperty("--cat-color", accentColor);
      card.setAttribute("aria-pressed", String(isSelected));
      card.dataset.categoryId = cat.id;
      card.dataset.categoryGroup = groupId;

      let countClass = "";
      const countText = `${newCount} / ${totalCount} جديد`;
      if (newCount === 0) {
        countClass = "empty";
      } else if (newCount < totalCount) {
        countClass = "low";
      }

      card.innerHTML = `
        <span class="setup-cat-check" aria-hidden="true">✓</span>
        <div class="setup-cat-icon">${escapeHtml(cat.icon || "🎯")}</div>
        <div class="setup-cat-name">${escapeHtml(cat.name)}</div>
        <div class="setup-cat-desc">${escapeHtml(cat.description || "")}</div>
        <div class="setup-cat-count ${countClass}">${countText}</div>
        ${
          hasPartialProgress
            ? `<div class="setup-cat-progress-track" aria-hidden="true" title="تم لعب ${playedCount} من ${totalCount}"><div class="setup-cat-progress-fill" style="width: ${playedPercent}%"></div></div>`
            : ""
        }
      `;

      card.addEventListener("click", () => toggleCategorySelection(cat.id));
      dom.setupCategoriesGrid.appendChild(card);
    });

    updateSetupControls();
  }

  function updateSetupControls() {
    const count = state.selectedCategoryIds.length;
    const isReady = count === REQUIRED_CATEGORIES;
    const remaining = Math.max(0, REQUIRED_CATEGORIES - count);

    dom.selectedCount.textContent = String(count);
    dom.selectionCounter.classList.toggle("ready", isReady);
    dom.btnStartGame.disabled = !isReady;

    if (dom.btnClearSelections) {
      dom.btnClearSelections.hidden = count === 0;
    }

    if (dom.btnStartGameLabel) {
      dom.btnStartGameLabel.textContent = isReady
        ? "🚀 ابدأ اللعبة"
        : formatRemainingCategoriesHint(remaining);
    }

    const stats = getTotalBankStats();
    dom.playedSummary.innerHTML = `
      <span>المجموعة: <strong>${escapeHtml(stats.profileName)}</strong></span>
      <span class="bank-stat-sep" aria-hidden="true">•</span>
      <span>إجمالي البنك: <strong>${stats.total}</strong></span>
      <span class="bank-stat-sep" aria-hidden="true">•</span>
      <span>جديد متبقٍّ: <strong>${stats.unplayed}</strong></span>
      <span class="bank-stat-sep" aria-hidden="true">•</span>
      <span>ملعوب سابقاً: <strong>${stats.played}</strong></span>
    `;
    if (state.dualScreen.connected) {
      broadcastLiveDisplayState();
    }
  }

  function toggleCategorySelection(categoryId) {
    const idx = state.selectedCategoryIds.indexOf(categoryId);
    if (idx !== -1) {
      state.selectedCategoryIds.splice(idx, 1);
    } else {
      if (state.selectedCategoryIds.length >= REQUIRED_CATEGORIES) {
        showToast("تم اختيار 6 فئات بالفعل — ألغِ فئة أولاً لاختيار بديلها", "warning");
        return;
      }
      state.selectedCategoryIds.push(categoryId);
    }
    renderSetupScreen();
  }

  function clearAllSelectedCategories() {
    if (state.selectedCategoryIds.length === 0) return;
    state.selectedCategoryIds = [];
    renderSetupScreen();
    showToast("تم مسح جميع الفئات المختارة", "info");
  }

  function selectRandomCategories() {
    const activeGroup = state.activeCategoryGroup;
    let picked = [];
    let scopedToGroup = false;

    if (activeGroup !== "all") {
      const inGroup = state.allCategories.filter((c) => resolveCategoryGroup(c) === activeGroup);
      const inGroupUnplayed = shuffleArray(inGroup.filter((c) => getCategoryNewCount(c) > 0));
      picked = inGroupUnplayed.slice(0, REQUIRED_CATEGORIES);
      scopedToGroup = picked.length === REQUIRED_CATEGORIES;
    }

    if (picked.length < REQUIRED_CATEGORIES) {
      const pickedIds = new Set(picked.map((c) => c.id));
      const restUnplayed = shuffleArray(
        state.allCategories.filter((c) => !pickedIds.has(c.id) && getCategoryNewCount(c) > 0)
      );
      picked = [...picked, ...restUnplayed].slice(0, REQUIRED_CATEGORIES);
    }

    if (picked.length < REQUIRED_CATEGORIES) {
      const pickedIds = new Set(picked.map((c) => c.id));
      const restPlayed = shuffleArray(state.allCategories.filter((c) => !pickedIds.has(c.id)));
      picked = [...picked, ...restPlayed].slice(0, REQUIRED_CATEGORIES);
    }

    state.selectedCategoryIds = picked.map((c) => c.id);
    renderSetupScreen();

    if (scopedToGroup) {
      const activeMeta = CATEGORY_GROUPS.find((g) => g.id === activeGroup);
      const label = activeMeta ? activeMeta.label : "";
      showToast(`تم اختيار 6 فئات عشوائياً من «${label}» 🎲`, "success");
    } else {
      showToast("تم اختيار 6 فئات عشوائياً بنجاح 🎲", "success");
    }
  }

  /**
   * اختيار «تشكيلة متوازنة» تلقائياً من 6 تصنيفات رئيسية مختلفة بأعلى رصيد أسئلة جديدة
   */
  function selectBalancedCategories() {
    if (!Array.isArray(state.allCategories) || state.allCategories.length === 0) return;

    const groupBuckets = new Map();
    state.allCategories.forEach((cat) => {
      const gid = resolveCategoryGroup(cat);
      if (!groupBuckets.has(gid)) groupBuckets.set(gid, []);
      groupBuckets.get(gid).push(cat);
    });

    // ترتيب كل مجموعة بحيث تتصدر الفئات ذات الأسئلة الجديدة الأكثر مع تنويع عشوائي بين المتقاربات
    const sortBucket = (cats) => {
      const unplayedCats = shuffleArray(cats.filter((c) => getCategoryNewCount(c) > 0)).sort(
        (a, b) => getCategoryNewCount(b) - getCategoryNewCount(a)
      );
      const playedCats = shuffleArray(cats.filter((c) => getCategoryNewCount(c) === 0));
      // نأخذ من أعلى 3 فئات جديدة عشوائياً لإعطاء تنوّع مختلف في كل ضغطة
      const topSlice = shuffleArray(unplayedCats.slice(0, Math.min(4, unplayedCats.length)));
      return [...topSlice, ...unplayedCats.slice(topSlice.length), ...playedCats];
    };

    const orderedGroupIds = shuffleArray(
      Array.from(groupBuckets.keys()).filter((gid) => (groupBuckets.get(gid) || []).length > 0)
    );

    // التأكد من إعطاء أولوية للتنوع العالي: نختار فئة واحدة من كل تصنيف مختلف أولاً
    const picked = [];
    const pickedIds = new Set();
    const usedGroups = new Set();

    // المرور الأول: فئة جديدة واحدة من كل مجموعة مختلفة
    for (const gid of orderedGroupIds) {
      if (picked.length >= REQUIRED_CATEGORIES) break;
      const sorted = sortBucket(groupBuckets.get(gid));
      const candidate = sorted.find((c) => !pickedIds.has(c.id) && getCategoryNewCount(c) > 0);
      if (candidate) {
        picked.push(candidate);
        pickedIds.add(candidate.id);
        usedGroups.add(gid);
      }
    }

    // المرور الثاني: إكمال من أي فئة جديدة متبقية من مجموعات أقل تمثيلاً
    if (picked.length < REQUIRED_CATEGORIES) {
      const remainingUnplayed = shuffleArray(
        state.allCategories.filter((c) => !pickedIds.has(c.id) && getCategoryNewCount(c) > 0)
      );
      for (const cat of remainingUnplayed) {
        if (picked.length >= REQUIRED_CATEGORIES) break;
        picked.push(cat);
        pickedIds.add(cat.id);
        usedGroups.add(resolveCategoryGroup(cat));
      }
    }

    // المرور الثالث: إكمال من أي فئة متبقية في البنك
    if (picked.length < REQUIRED_CATEGORIES) {
      const rest = shuffleArray(state.allCategories.filter((c) => !pickedIds.has(c.id)));
      for (const cat of rest) {
        if (picked.length >= REQUIRED_CATEGORIES) break;
        picked.push(cat);
        pickedIds.add(cat.id);
        usedGroups.add(resolveCategoryGroup(cat));
      }
    }

    state.selectedCategoryIds = picked.map((c) => c.id);
    if (state.activeCategoryGroup !== "all") {
      state.activeCategoryGroup = "all";
    }
    renderSetupScreen();

    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playTileOpen();
    }
    showToast(
      `✨ تم اختيار تشكيلة متوازنة من ${picked.length} فئات عبر ${usedGroups.size} مجالات مختلفة!`,
      "success"
    );
  }

  function openConfirmDialog({ title, message, confirmText = "تأكيد", onConfirm }) {
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.btnConfirmOk.textContent = confirmText;
    state.pendingConfirmAction = typeof onConfirm === "function" ? onConfirm : null;
    openModal(dom.confirmModal);
  }

  function closeConfirmDialog() {
    state.pendingConfirmAction = null;
    closeModal(dom.confirmModal);
  }

  function openResetConfirmModal() {
    const activeProfile = historyStore.getActiveProfile();
    const count = activeProfile.playedCount;
    openConfirmDialog({
      title: `تصفير سجل مجموعة «${activeProfile.name}»؟`,
      message:
        count > 0
          ? `يوجد حالياً ${count} سؤالاً في سجل الأسئلة الملعوبة لمجموعة «${activeProfile.name}». هل أنت متأكد من التصفير لتعود جميع الأسئلة جديدة لهذه المجموعة؟`
          : `سجل الأسئلة الملعوبة لمجموعة «${activeProfile.name}» فارغ حالياً (0 أسئلة). هل تريد تأكيد إعادة التصفير؟`,
      confirmText: "نعم، صفّر السجل",
      onConfirm: () => {
        const res = historyStore.resetProfileHistory(activeProfile.id);
        renderSetupScreen();
        if (dom.bankManagerModal.classList.contains("open")) {
          renderBankManagerModal();
        }
        showToast(`تم تصفير سجل الأسئلة لمجموعة «${res.profileName}» بنجاح`, "success");
      }
    });
  }

  /* =========================================================
     إدارة واستيراد وتصدير بنك الأسئلة (Bank Manager & Smart Merge)
     ========================================================= */
  function cloneQuestion(q) {
    const copy = { ...q };
    if (Array.isArray(q.images)) {
      copy.images = q.images.slice();
    }
    copy.points = Number(q.points);
    return copy;
  }

  function cloneCategoryShell(cat) {
    const copy = { ...cat };
    copy.id = String(cat.id).trim();
    copy.name = String(cat.name).trim();
    copy.icon = typeof cat.icon === "string" && cat.icon.trim() ? cat.icon.trim() : "🎯";
    copy.color = typeof cat.color === "string" && cat.color.trim() ? cat.color.trim() : "";
    copy.description = typeof cat.description === "string" ? cat.description.trim() : "";
    if (typeof cat.group === "string" && cat.group.trim()) {
      copy.group = cat.group.trim().toLowerCase();
    } else {
      delete copy.group;
    }
    copy.questions = [];
    return copy;
  }

  function mergeCategorySources(sourceArrays) {
    const mergedList = [];
    const byId = new Map();
    const seenQuestionIds = new Set();

    sourceArrays.forEach((source) => {
      if (!Array.isArray(source)) return;
      source.forEach((cat) => {
        if (!cat || typeof cat !== "object" || typeof cat.id !== "string" || !cat.id.trim()) return;
        const catId = cat.id.trim();
        const rawQuestions = Array.isArray(cat.questions) ? cat.questions : [];

        let targetCat = byId.get(catId);
        if (!targetCat) {
          targetCat = cloneCategoryShell(cat);
          byId.set(catId, targetCat);
          mergedList.push(targetCat);
        }

        rawQuestions.forEach((q) => {
          if (!q || typeof q !== "object" || typeof q.id !== "string" || !q.id.trim()) return;
          const qId = q.id.trim();
          if (seenQuestionIds.has(qId)) return;
          seenQuestionIds.add(qId);
          targetCat.questions.push(cloneQuestion({ ...q, id: qId }));
        });
      });
    });

    return mergedList;
  }

  function loadCustomCategoriesFromStorage() {
    try {
      const raw = localStorage.getItem(CUSTOM_CATEGORIES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sanitized = sanitizer.sanitizeCategoriesTree(parsed, {
          allowLegacyLocalVisuals: false
        });
        return sanitized.categories;
      }
    } catch (err) {
      console.warn("تعذر قراءة الفئات المستوردة من localStorage:", err);
    }
    return [];
  }

  function saveCustomCategoriesToStorage() {
    try {
      localStorage.setItem(CUSTOM_CATEGORIES_STORAGE_KEY, JSON.stringify(state.customCategories));
    } catch (err) {
      console.warn("تعذر حفظ الفئات المستوردة في localStorage:", err);
    }
  }

  function getQuestionMediaKey(q) {
    if (!q || typeof q !== "object") return "";
    const parts = [];
    if (typeof q.questionImage === "string" && q.questionImage.trim()) {
      parts.push(normalizeAssetPath(q.questionImage));
    }
    if (Array.isArray(q.images) && q.images.length > 0) {
      const normalizedImgs = q.images
        .map((img) => normalizeAssetPath(img))
        .filter(Boolean);
      if (normalizedImgs.length > 0) {
        parts.push(normalizedImgs.join("|"));
      }
    }
    return parts.join("::");
  }

  function mergeCategoriesWithSheetPriority(sheetsCategories, localSourceGroups) {
    const safeSheets = Array.isArray(sheetsCategories) ? sheetsCategories : [];
    const safeLocalGroups = Array.isArray(localSourceGroups) ? localSourceGroups : [];

    const realSheetCategories = safeSheets.filter(
      (cat) => cat && typeof cat === "object" && !cat._shellOnly
    );
    const localCategories = [];
    safeLocalGroups.forEach((group) => {
      if (Array.isArray(group)) {
        group.forEach((cat) => {
          if (cat && typeof cat === "object") {
            localCategories.push(cat);
          }
        });
      }
    });

    const mergedCategories = [];
    const byId = new Map();
    const byNormalizedName = new Map();
    const idRedirect = new Map();

    [...realSheetCategories, ...localCategories].forEach((cat) => {
      if (!cat || typeof cat !== "object" || typeof cat.id !== "string" || !cat.id.trim()) return;
      const catId = cat.id.trim();
      const catName = typeof cat.name === "string" ? cat.name.trim() : "";
      if (!catName) return;

      const existingById = byId.get(catId);
      if (existingById) {
        if (!existingById.group && typeof cat.group === "string" && cat.group.trim()) {
          existingById.group = cat.group.trim().toLowerCase();
        }
        return;
      }

      const normName = normalizeCategoryName(catName);
      const existingByName = normName ? byNormalizedName.get(normName) : undefined;
      if (existingByName) {
        if (!existingByName.group && typeof cat.group === "string" && cat.group.trim()) {
          existingByName.group = cat.group.trim().toLowerCase();
        }
        if (catId !== existingByName.id) {
          idRedirect.set(catId, existingByName.id);
        }
        return;
      }

      const shell = cloneCategoryShell(cat);
      byId.set(catId, shell);
      if (normName) {
        byNormalizedName.set(normName, shell);
      }
      mergedCategories.push(shell);
    });

    const seenQuestionIds = new Set();
    const crossSourceDuplicates = [];
    const seenQuestionsByCategory = new Map();

    const questionBatches = [
      { label: "sheet", categories: safeSheets },
      ...safeLocalGroups.map((categories, idx) => ({
        label: `local-${idx}`,
        categories: Array.isArray(categories) ? categories : []
      }))
    ];

    questionBatches.forEach(({ label, categories }) => {
      categories.forEach((cat) => {
        if (!cat || typeof cat !== "object" || typeof cat.id !== "string" || !cat.id.trim()) return;
        const catId = cat.id.trim();
        const rawQuestions = Array.isArray(cat.questions) ? cat.questions : [];
        const originKey = `${label}:${catId}`;

        rawQuestions.forEach((q) => {
          if (!q || typeof q !== "object" || typeof q.id !== "string" || !q.id.trim()) return;
          const qId = q.id.trim();
          if (seenQuestionIds.has(qId)) {
            if (label === "sheet") {
              crossSourceDuplicates.push(qId);
            }
            return;
          }

          const rawCategoryId =
            typeof q.categoryId === "string" && q.categoryId.trim()
              ? q.categoryId.trim()
              : catId;
          const targetCatId = idRedirect.get(rawCategoryId) ?? rawCategoryId;
          const targetCat = byId.get(targetCatId);
          if (!targetCat) return;

          const normQuestion = normalizeArabicText(q.question);
          const normAnswer = normalizeArabicText(q.answer);
          const mediaKey = getQuestionMediaKey(q);

          let catSeenMap = seenQuestionsByCategory.get(targetCatId);
          if (!catSeenMap) {
            catSeenMap = new Map();
            seenQuestionsByCategory.set(targetCatId, catSeenMap);
          }

          if (normQuestion) {
            const existingEntries = catSeenMap.get(normQuestion);
            if (existingEntries) {
              const isDuplicateText = existingEntries.some((entry) => {
                if (mediaKey && entry.mediaKey && mediaKey !== entry.mediaKey) {
                  return false;
                }
                if (entry.originKey === originKey) {
                  return entry.normAnswer === normAnswer;
                }
                return true;
              });

              if (isDuplicateText) return;
              existingEntries.push({ originKey, normAnswer, mediaKey });
            } else {
              catSeenMap.set(normQuestion, [{ originKey, normAnswer, mediaKey }]);
            }
          }

          seenQuestionIds.add(qId);
          targetCat.questions.push(
            cloneQuestion({ ...q, id: qId, categoryId: targetCatId })
          );
        });
      });
    });

    return { categories: mergedCategories, idRedirect, crossSourceDuplicates };
  }

  function rebuildMergedCategories() {
    const merged = mergeCategoriesWithSheetPriority(state.sheetsCategories, [
      state.baseCategories,
      state.extraCategories,
      state.customCategories
    ]);

    state.allCategories = merged.categories;
    state.categoryIdRedirect = merged.idRedirect;
    state.mergeDuplicates = merged.crossSourceDuplicates;

    const validIds = new Set(state.allCategories.map((c) => c.id));
    const remappedSelected = [];
    const seenSelected = new Set();
    state.selectedCategoryIds.forEach((rawId) => {
      const mappedId = merged.idRedirect.get(rawId) ?? rawId;
      if (validIds.has(mappedId) && !seenSelected.has(mappedId)) {
        seenSelected.add(mappedId);
        remappedSelected.push(mappedId);
      }
    });
    state.selectedCategoryIds = remappedSelected;
  }

  /* =========================================================
     مزامنة Google Sheets مع المنقّي الدفاعي وكاش العمل دون إنترنت
     ========================================================= */
  function appendCacheBuster(url) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_t=${Date.now()}`;
  }

  function setSheetsStatus(variant, text, showSpinner = false) {
    dom.sheetsStatusBar.className = `sheets-status-bar${variant ? ` status-${variant}` : ""}`;
    dom.sheetsStatusSpinner.hidden = !showSpinner;
    dom.sheetsStatusText.textContent = text;
    dom.sheetsStatusBar.hidden = !text;
  }

  function getLocalKnownCategoryIds() {
    return [
      ...state.baseCategories.map((c) => c.id),
      ...state.extraCategories.map((c) => c.id),
      ...state.customCategories.map((c) => c.id)
    ];
  }

  async function syncFromGoogleSheets(isManual = false) {
    const cfg = window.SEEN_JEEM_SHEETS_CONFIG;
    if (!cfg || !cfg.categoriesCsvUrl || !cfg.questionsCsvUrl) {
      if (isManual) {
        showToast("لم يتم إعداد روابط Google Sheets في sheets-config.js", "warning");
      }
      return;
    }

    if (state.sheetsLoading) return;
    state.sheetsLoading = true;
    dom.btnSyncSheets.disabled = true;

    const hadCachedSheets = state.sheetsCategories.length > 0;
    setSheetsStatus(
      "loading",
      hadCachedSheets
        ? "⚡ البنك جاهز من الكاش المحلي — جاري التحقق من تحديثات Google Sheets بالخلفية..."
        : "جاري جلب وتنقية الأسئلة من Google Sheets...",
      true
    );

    try {
      const [catRes, qRes] = await Promise.all([
        fetch(appendCacheBuster(cfg.categoriesCsvUrl), { cache: "no-store" }),
        fetch(appendCacheBuster(cfg.questionsCsvUrl), { cache: "no-store" })
      ]);

      if (!catRes.ok || !qRes.ok) {
        throw new Error(`HTTP ${catRes.status} / ${qRes.status}`);
      }

      const [catCsv, qCsv] = await Promise.all([catRes.text(), qRes.text()]);
      const parsed = sanitizer.sanitizeSheetsCsvToCategories(
        catCsv,
        qCsv,
        getLocalKnownCategoryIds()
      );

      const syncedAt = Date.now();
      state.sheetsCategories = parsed.categories;
      state.sheetsDiagnostics = parsed.diagnostics;
      state.lastSheetsSyncAt = syncedAt;
      state.sheetsSourceState = "live";

      // حفظ النسخة الصالحة والمنقّاة في الكاش المحلي (Stale-While-Revalidate)
      sanitizer.saveCachedSheetsBank(parsed.categories, parsed.diagnostics, syncedAt);

      rebuildMergedCategories();
      if (dom.setupScreen.classList.contains("active")) {
        renderSetupScreen();
      }
      if (dom.bankManagerModal.classList.contains("open")) {
        renderBankManagerModal();
      }
      if (dom.questionModal.classList.contains("open") && state.currentQ) {
        updateTacticalControlsUI();
      }

      if (parsed.realCategoriesCount === 0 && parsed.questionsCount === 0) {
        setSheetsStatus(
          "success",
          "☁️ متصل بـ Google Sheets (لا توجد صفوف مضافة بعد — تعمل الأسئلة المحلية)",
          false
        );
        if (isManual) {
          showToast("تم الاتصال بالشيت بنجاح — الشيت لا يحتوي على أسئلة بعد ☁️", "info");
        }
      } else {
        const cleanedNote =
          parsed.diagnostics.cleanedRowsCount > 0
            ? ` • نُظّف ${parsed.diagnostics.cleanedRowsCount} صف تلقائياً`
            : "";
        setSheetsStatus(
          "success",
          `☁️ محدّث من Google Sheets (${parsed.realCategoriesCount} فئة • ${parsed.questionsCount} سؤالاً صالحاً${cleanedNote})`,
          false
        );
        showToast(
          isManual
            ? `تم تحديث وتنقية ${parsed.questionsCount} سؤالاً من Google Sheets ✅`
            : `☁️ اكتمل تحديث البنك في الخلفية (${parsed.questionsCount} سؤالاً صالحاً)`,
          "success"
        );
      }
    } catch (_err) {
      if (hadCachedSheets) {
        state.sheetsSourceState = "offline-cache";
        setSheetsStatus(
          "warning",
          `📴 وضع عدم الاتصال — تعمل اللعبة فوراً من النسخة المحفوظة محلياً (آخر مزامنة: ${formatTimestampArabic(state.lastSheetsSyncAt)})`,
          false
        );
        if (isManual) {
          showToast("تعذر الاتصال حالياً — تعمل اللعبة بكامل كفاءتها من الكاش المحلي المحفوظ", "warning");
        }
      } else {
        setSheetsStatus(
          "warning",
          "⚠️ تعذر الاتصال بـ Google Sheets — تعمل اللعبة تلقائياً بالأسئلة المحلية",
          false
        );
        if (isManual) {
          showToast("تعذر جلب البيانات من Google Sheets — الأسئلة المحلية تعمل بشكل طبيعي", "warning");
        }
      }
    } finally {
      state.sheetsLoading = false;
      dom.btnSyncSheets.disabled = false;
    }
  }

  function validateImportedJson(rawText) {
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";
    if (!trimmed) {
      return { ok: false, error: "يرجى لصق كود JSON أولاً داخل مربع النص." };
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_err) {
      return {
        ok: false,
        error: "خطأ في صيغة JSON: تأكد من سلامة الأقواس والفواصل وعلامات التنصيص المزدوجة (\"...\") وعدم وجود فاصلة زائدة في نهاية القائمة."
      };
    }

    let rawCategories;
    if (Array.isArray(parsed)) {
      rawCategories = parsed;
    } else if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.categories)) {
        rawCategories = parsed.categories;
      } else {
        rawCategories = [parsed];
      }
    } else {
      return {
        ok: false,
        error: "الصيغة غير صالحة: يجب لصق مصفوفة فئات [...] أو كائن فئة واحدة {...}."
      };
    }

    if (rawCategories.length === 0) {
      return { ok: false, error: "مصفوفة الفئات فارغة ولا تحتوي على أي فئة للاستيراد." };
    }

    const validatedCategories = [];
    for (let i = 0; i < rawCategories.length; i++) {
      const cat = rawCategories[i];
      const catNum = i + 1;

      if (!cat || typeof cat !== "object" || Array.isArray(cat)) {
        return { ok: false, error: `الفئة رقم (${catNum}) ليست كائناً صالحاً.` };
      }
      if (typeof cat.id !== "string" || !cat.id.trim()) {
        return { ok: false, error: `الفئة رقم (${catNum}) تفتقد حقل المعرّف النصي «id».` };
      }
      if (typeof cat.name !== "string" || !cat.name.trim()) {
        return { ok: false, error: `الفئة «${cat.id}» تفتقد حقل الاسم «name».` };
      }
      if (!Array.isArray(cat.questions) || cat.questions.length === 0) {
        return { ok: false, error: `الفئة «${cat.name}» يجب أن تحتوي على مصفوفة «questions» غير فارغة.` };
      }

      const cleanCat = cloneCategoryShell(cat);

      for (let j = 0; j < cat.questions.length; j++) {
        const q = cat.questions[j];
        const qNum = j + 1;

        const sanitizedRow = sanitizer.sanitizeQuestionRow(q, {
          defaultCategoryId: cleanCat.id,
          allowLegacyLocalVisuals: false
        });

        if (!sanitizedRow.valid || !sanitizedRow.question) {
          if (sanitizedRow.rejectedReason === "invalid-points") {
            return {
              ok: false,
              error: `السؤال رقم (${qNum}) داخل فئة «${cat.name}» يجب أن يحمل قيمة نقاط صحيحة (200 أو 400 أو 600).`
            };
          }
          return {
            ok: false,
            error: `السؤال رقم (${qNum}) داخل فئة «${cat.name}» يفتقد أحد الحقول الإلزامية (id, question, answer).`
          };
        }

        cleanCat.questions.push(cloneQuestion(sanitizedRow.question));
      }

      validatedCategories.push(cleanCat);
    }

    return { ok: true, categories: validatedCategories };
  }

  function showBankFeedback(message, type = "success") {
    dom.bankImportFeedback.className = `bank-feedback-box feedback-${type}`;
    dom.bankImportFeedback.textContent = message;
    dom.bankImportFeedback.hidden = false;
  }

  function handleImportJson() {
    const result = validateImportedJson(dom.bankJsonInput.value);
    if (!result.ok) {
      showBankFeedback(`❌ ${result.error}`, "error");
      return;
    }

    const existingCatIds = new Set(state.allCategories.map((c) => c.id));
    const existingNormCatNames = new Set(
      state.allCategories.map((c) => normalizeCategoryName(c.name)).filter(Boolean)
    );
    const existingQIds = new Set();
    const existingQTextsByNormCat = new Map();
    state.allCategories.forEach((c) => {
      const normCatName = normalizeCategoryName(c.name);
      const textSet = existingQTextsByNormCat.get(normCatName) || new Set();
      c.questions.forEach((q) => {
        existingQIds.add(q.id);
        const normQ = normalizeArabicText(q.question);
        if (normQ) textSet.add(normQ);
      });
      existingQTextsByNormCat.set(normCatName, textSet);
    });

    let addedCategoriesCount = 0;
    let addedQuestionsCount = 0;
    let skippedDuplicatesCount = 0;

    const customById = new Map(state.customCategories.map((c) => [c.id, c]));

    result.categories.forEach((incomingCat) => {
      const freshQuestions = [];
      const normIncomingName = normalizeCategoryName(incomingCat.name);
      const catTextSet = existingQTextsByNormCat.get(normIncomingName) || new Set();

      incomingCat.questions.forEach((q) => {
        const normQ = normalizeArabicText(q.question);
        const hasMedia = Boolean(getQuestionMediaKey(q));
        if (existingQIds.has(q.id) || (!hasMedia && normQ && catTextSet.has(normQ))) {
          skippedDuplicatesCount++;
        } else {
          existingQIds.add(q.id);
          if (normQ) catTextSet.add(normQ);
          freshQuestions.push(cloneQuestion(q));
          addedQuestionsCount++;
        }
      });

      existingQTextsByNormCat.set(normIncomingName, catTextSet);
      if (freshQuestions.length === 0) return;

      const alreadyExists =
        existingCatIds.has(incomingCat.id) ||
        (normIncomingName && existingNormCatNames.has(normIncomingName));
      if (!alreadyExists) {
        existingCatIds.add(incomingCat.id);
        if (normIncomingName) existingNormCatNames.add(normIncomingName);
        addedCategoriesCount++;
      }

      const existingCustomEntry = customById.get(incomingCat.id);
      if (existingCustomEntry) {
        existingCustomEntry.questions.push(...freshQuestions);
      } else {
        const newEntry = cloneCategoryShell(incomingCat);
        newEntry.questions = freshQuestions;
        state.customCategories.push(newEntry);
        customById.set(newEntry.id, newEntry);
      }
    });

    if (addedQuestionsCount === 0 && addedCategoriesCount === 0) {
      showBankFeedback(
        `⚠️ لم تتم إضافة أسئلة جديدة — تم تجاهل ${skippedDuplicatesCount} سؤالاً مكرراً موجوداً مسبقاً في البنك.`,
        "warning"
      );
      return;
    }

    saveCustomCategoriesToStorage();
    rebuildMergedCategories();
    renderSetupScreen();
    renderBankManagerModal();

    dom.bankJsonInput.value = "";
    const summaryParts = [
      `الفئات الجديدة المضافة: ${addedCategoriesCount}`,
      `الأسئلة الجديدة المضافة: ${addedQuestionsCount}`,
      `الأسئلة المكررة المُتجاهَلة: ${skippedDuplicatesCount}`
    ];
    showBankFeedback(`✅ تم الاستيراد بنجاح! ${summaryParts.join(" • ")}`, "success");
    showToast(`تمت إضافة ${addedQuestionsCount} سؤالاً جديداً إلى بنك الأسئلة ✅`, "success");
  }

  function buildExportableExtraCategories() {
    return mergeCategorySources([state.extraCategories, state.customCategories]);
  }

  function exportExtraQuestionsFile() {
    const combinedExtras = buildExportableExtraCategories();
    const fileContent = `window.SEEN_JEEM_EXTRA_CATEGORIES = ${JSON.stringify(combinedExtras, null, 2)};\n`;

    const blob = new Blob([fileContent], { type: "application/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "extra-questions.js";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const totalExtraQ = combinedExtras.reduce((sum, c) => sum + c.questions.length, 0);
    showToast(`تم تنزيل extra-questions.js (${combinedExtras.length} فئات / ${totalExtraQ} سؤالاً) ⬇️`, "success");
  }

  function requestDeleteCustomCategory(catId) {
    const target = state.customCategories.find((c) => c.id === catId);
    if (!target) return;

    openConfirmDialog({
      title: `حذف الفئة المستوردة «${target.name}»؟`,
      message: `سيتم حذف ${target.questions.length} سؤالاً مستورداً من المتصفح لهذه الفئة (لن تتأثر الفئات الأساسية في questions.js أو extra-questions.js).`,
      confirmText: "نعم، احذف الفئة",
      onConfirm: () => {
        state.customCategories = state.customCategories.filter((c) => c.id !== catId);
        saveCustomCategoriesToStorage();
        rebuildMergedCategories();
        renderSetupScreen();
        renderBankManagerModal();
        showToast(`تم حذف الفئة المستوردة «${target.name}» 🗑️`, "info");
      }
    });
  }

  function requestClearAllCustomCategories() {
    if (state.customCategories.length === 0) return;
    const totalCustomQ = state.customCategories.reduce((sum, c) => sum + c.questions.length, 0);

    openConfirmDialog({
      title: "مسح كل الفئات المستوردة في المتصفح؟",
      message: `سيتم مسح جميع الفئات المستوردة مؤقتاً في المتصفح (${state.customCategories.length} فئات / ${totalCustomQ} سؤالاً). الفئات المحفوظة في questions.js و extra-questions.js ستبقى محفوظة.`,
      confirmText: "نعم، امسح الكل",
      onConfirm: () => {
        state.customCategories = [];
        saveCustomCategoriesToStorage();
        rebuildMergedCategories();
        renderSetupScreen();
        renderBankManagerModal();
        dom.bankImportFeedback.hidden = true;
        showToast("تم مسح جميع الفئات المستوردة من المتصفح ✅", "success");
      }
    });
  }

  function renderBankProfileStatsSection() {
    if (!dom.bankProfileStatsGrid) return;
    const stats = getTotalBankStats();

    if (dom.bankActiveProfilePill) {
      dom.bankActiveProfilePill.textContent = `المجموعة النشطة: ${stats.profileName}`;
    }
    if (dom.btnBankProfileReset) {
      dom.btnBankProfileReset.textContent = `🔄 تصفير سجل مجموعة «${stats.profileName}»`;
    }
    if (dom.btnBankResetHistory) {
      dom.btnBankResetHistory.textContent = `🔄 تصفير سجل «${stats.profileName}»`;
    }

    const lastPlayedLabel = stats.lastPlayedAt
      ? formatTimestampArabic(stats.lastPlayedAt)
      : "لم يُلعب بعد";

    dom.bankProfileStatsGrid.innerHTML = `
      <div class="bank-stat-card stat-good">
        <div class="bank-stat-value">${stats.unplayed}</div>
        <div class="bank-stat-label">أسئلة جديدة متبقية</div>
      </div>
      <div class="bank-stat-card">
        <div class="bank-stat-value">${stats.played}</div>
        <div class="bank-stat-label">أسئلة ملعوبة بالمجموعة</div>
      </div>
      <div class="bank-stat-card">
        <div class="bank-stat-value">${stats.completedCategories} / ${stats.totalCategories}</div>
        <div class="bank-stat-label">فئات مكتملة</div>
      </div>
      <div class="bank-stat-card">
        <div class="bank-stat-value" style="font-size: 0.86rem; line-height: 1.4;">${escapeHtml(lastPlayedLabel)}</div>
        <div class="bank-stat-label">آخر نشاط للمجموعة</div>
      </div>
    `;
  }

  function renderBankHealthReport() {
    if (!dom.bankHealthMetrics) return;

    const totalValidQuestions = state.allCategories.reduce((sum, c) => sum + c.questions.length, 0);
    const cleanedRowsCount =
      (Number(state.sheetsDiagnostics.cleanedRowsCount) || 0) +
      (Number(state.localDiagnostics.cleanedRowsCount) || 0);

    const allDupIds = Array.from(
      new Set([
        ...(Array.isArray(state.sheetsDiagnostics.duplicateIds) ? state.sheetsDiagnostics.duplicateIds : []),
        ...(Array.isArray(state.localDiagnostics.duplicateIds) ? state.localDiagnostics.duplicateIds : []),
        ...(Array.isArray(state.mergeDuplicates) ? state.mergeDuplicates : [])
      ])
    );
    const duplicateCount = Math.max(
      allDupIds.length,
      (Number(state.sheetsDiagnostics.duplicateCount) || 0) +
        (Number(state.localDiagnostics.duplicateCount) || 0)
    );

    const under50Categories = state.allCategories.filter((c) => c.questions.length < 50);

    if (dom.bankLastSyncPill) {
      if (state.lastSheetsSyncAt) {
        const modeTag =
          state.sheetsSourceState === "live"
            ? "سحابي محدّث"
            : "كاش محلي";
        dom.bankLastSyncPill.textContent = `آخر مزامنة (${modeTag}): ${formatTimestampArabic(state.lastSheetsSyncAt)}`;
      } else {
        dom.bankLastSyncPill.textContent = "آخر مزامنة: الوضع المحلي فقط";
      }
    }

    dom.bankHealthMetrics.innerHTML = `
      <div class="bank-stat-card stat-good">
        <div class="bank-stat-value">${totalValidQuestions}</div>
        <div class="bank-stat-label">إجمالي الأسئلة الصالحة</div>
      </div>
      <div class="bank-stat-card ${cleanedRowsCount > 0 ? "stat-warn" : "stat-good"}">
        <div class="bank-stat-value">${cleanedRowsCount}</div>
        <div class="bank-stat-label">صفوف نُظّفت من حقول عالقة</div>
      </div>
      <div class="bank-stat-card ${duplicateCount > 0 ? "stat-warn" : "stat-good"}">
        <div class="bank-stat-value">${duplicateCount}</div>
        <div class="bank-stat-label">معرّفات مكررة مُزالة</div>
      </div>
      <div class="bank-stat-card ${under50Categories.length > 0 ? "stat-warn" : "stat-good"}">
        <div class="bank-stat-value">${under50Categories.length}</div>
        <div class="bank-stat-label">فئات أقل من 50 سؤالاً</div>
      </div>
    `;

    if (dom.bankDuplicatesBox) {
      if (allDupIds.length > 0) {
        dom.bankDuplicatesBox.hidden = false;
        dom.bankDuplicatesBox.innerHTML = `
          <div class="bank-subbox-title">⚠️ المعرّفات المكررة التي تم تجاهلها تلقائياً (${allDupIds.length}):</div>
          <div class="under50-pills-wrap">
            ${allDupIds
              .slice(0, 30)
              .map((id) => `<span class="under50-pill" dir="ltr">${escapeHtml(id)}</span>`)
              .join("")}
          </div>
        `;
      } else {
        dom.bankDuplicatesBox.hidden = true;
        dom.bankDuplicatesBox.innerHTML = "";
      }
    }

    if (dom.bankUnder50Box) {
      if (under50Categories.length === 0) {
        dom.bankUnder50Box.innerHTML = `
          <div class="health-all-good-note">✅ ممتاز! جميع فئات البنك (${state.allCategories.length}) تحتوي على 50 سؤالاً صالحاً فأكثر.</div>
        `;
      } else {
        dom.bankUnder50Box.innerHTML = `
          <div class="bank-subbox-title">📋 الفئات التي يقل عدد أسئلتها عن 50 سؤالاً (${under50Categories.length} فئة):</div>
          <div class="under50-pills-wrap">
            ${under50Categories
              .map(
                (cat) =>
                  `<span class="under50-pill">${escapeHtml(cat.icon || "🎯")} ${escapeHtml(cat.name)} (${cat.questions.length} / 50)</span>`
              )
              .join("")}
          </div>
        `;
      }
    }
  }

  function renderBankCategoriesOverview() {
    if (!dom.bankCategoriesOverview) return;
    const rawQuery = typeof state.bankSearchQuery === "string" ? state.bankSearchQuery : "";
    const normQuery = normalizeArabicText(rawQuery).toLowerCase();

    if (dom.btnClearBankSearch) {
      dom.btnClearBankSearch.hidden = rawQuery.trim().length === 0;
    }

    const groupLabelMap = new Map(CATEGORY_GROUPS.map((g) => [g.id, g.label]));
    const filtered = state.allCategories.filter((cat) => {
      if (!normQuery) return true;
      const groupId = resolveCategoryGroup(cat);
      const groupLabel = groupLabelMap.get(groupId) || "";
      const hay = normalizeArabicText(
        `${cat.name || ""} ${cat.description || ""} ${cat.id || ""} ${groupLabel}`
      ).toLowerCase();
      return hay.includes(normQuery);
    });

    if (dom.bankOverviewCount) {
      dom.bankOverviewCount.textContent = normQuery
        ? `${filtered.length} من ${state.allCategories.length} فئة`
        : `${state.allCategories.length} فئة`;
    }

    dom.bankCategoriesOverview.innerHTML = "";
    if (filtered.length === 0) {
      dom.bankCategoriesOverview.innerHTML = `
        <div class="bank-empty-state" style="grid-column: 1 / -1;">
          لا توجد فئات مطابقة لـ «${escapeHtml(rawQuery.trim())}».
        </div>
      `;
      return;
    }

    filtered.forEach((cat) => {
      const groupId = resolveCategoryGroup(cat);
      const groupLabel = groupLabelMap.get(groupId) || "";
      const total = cat.questions.length;
      const unplayed = getCategoryNewCount(cat);
      const statClass = unplayed === 0 ? "is-empty" : unplayed < total ? "is-partial" : "";

      const row = document.createElement("div");
      row.className = "bank-cat-row";
      row.innerHTML = `
        <div class="bank-cat-row-main">
          <div class="bank-cat-row-icon" style="--cat-color: ${getCategoryAccentColor(cat, groupId)}" aria-hidden="true">${escapeHtml(cat.icon || "🎯")}</div>
          <div class="bank-cat-row-info">
            <span class="bank-cat-row-name" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</span>
            <span class="bank-cat-row-group">${escapeHtml(groupLabel)}</span>
          </div>
        </div>
        <span class="bank-cat-row-stat ${statClass}" title="المتبقي الجديد / الإجمالي">${unplayed} / ${total} جديد</span>
      `;
      dom.bankCategoriesOverview.appendChild(row);
    });
  }

  function renderBankManagerModal() {
    const baseQCount = state.baseCategories.reduce(
      (s, c) => s + (Array.isArray(c.questions) ? c.questions.length : 0),
      0
    );
    const extraFileQCount = state.extraCategories.reduce(
      (s, c) => s + (Array.isArray(c.questions) ? c.questions.length : 0),
      0
    );
    const customQCount = state.customCategories.reduce((s, c) => s + c.questions.length, 0);
    const sheetsQCount = state.sheetsCategories.reduce(
      (s, c) => s + (Array.isArray(c.questions) ? c.questions.length : 0),
      0
    );
    const totalMergedQ = state.allCategories.reduce((s, c) => s + c.questions.length, 0);

    dom.bankSourcesSummary.innerHTML = `
      الإجمالي المدمج: <strong>${state.allCategories.length}</strong> فئة (<strong>${totalMergedQ}</strong> سؤالاً)
      • الأساسي: <strong>${baseQCount}</strong>
      • الشيت: <strong>${sheetsQCount}</strong>
      • ملف extra: <strong>${extraFileQCount}</strong>
      • المتصفح: <strong>${customQCount}</strong>
    `;

    renderBankProfileStatsSection();
    renderBankHealthReport();
    renderBankCategoriesOverview();

    const exportable = buildExportableExtraCategories();
    const exportableQ = exportable.reduce((s, c) => s + c.questions.length, 0);
    dom.bankExportStats.textContent = `${exportable.length} فئة إضافية • ${exportableQ} سؤالاً`;

    dom.btnClearAllCustom.disabled = state.customCategories.length === 0;
    dom.bankCustomList.innerHTML = "";

    if (state.customCategories.length === 0) {
      dom.bankCustomList.innerHTML = `
        <div class="bank-empty-state">
          لا توجد فئات مستوردة في المتصفح حالياً. الصق دفعة JSON في القسم (أ) أعلاه لإضافتها فوراً!
        </div>
      `;
      return;
    }

    const nonCustomSources = [
      ...state.sheetsCategories.filter((c) => !c._shellOnly),
      ...state.baseCategories,
      ...state.extraCategories
    ];
    const baseAndExtraIds = new Set(nonCustomSources.map((c) => c.id));
    const baseAndExtraNormNames = new Set(
      nonCustomSources.map((c) => normalizeCategoryName(c.name)).filter(Boolean)
    );

    state.customCategories.forEach((cat) => {
      const isExtension =
        baseAndExtraIds.has(cat.id) ||
        state.categoryIdRedirect.has(cat.id) ||
        baseAndExtraNormNames.has(normalizeCategoryName(cat.name));
      const item = document.createElement("div");
      item.className = "bank-custom-item";

      const info = document.createElement("div");
      info.className = "bank-custom-info";

      const iconEl = document.createElement("div");
      iconEl.className = "bank-custom-icon";
      iconEl.style.setProperty("--cat-color", getCategoryAccentColor(cat));
      iconEl.textContent = cat.icon || "🎯";

      const meta = document.createElement("div");
      meta.className = "bank-custom-meta";

      const nameRow = document.createElement("div");
      nameRow.className = "bank-custom-name-row";

      const nameEl = document.createElement("span");
      nameEl.className = "bank-custom-name";
      nameEl.textContent = cat.name;

      const badge = document.createElement("span");
      badge.className = "bank-custom-badge";
      badge.textContent = isExtension ? "إضافة لفئة موجودة" : "فئة جديدة";

      nameRow.appendChild(nameEl);
      nameRow.appendChild(badge);

      const subEl = document.createElement("div");
      subEl.className = "bank-custom-sub";
      subEl.textContent = `المعرّف: ${cat.id} • عدد الأسئلة المستوردة: ${cat.questions.length}`;

      meta.appendChild(nameRow);
      meta.appendChild(subEl);

      info.appendChild(iconEl);
      info.appendChild(meta);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-danger-outline btn-sm";
      deleteBtn.textContent = "🗑️ حذف";
      deleteBtn.addEventListener("click", () => requestDeleteCustomCategory(cat.id));

      item.appendChild(info);
      item.appendChild(deleteBtn);
      dom.bankCustomList.appendChild(item);
    });
  }

  function openBankManagerModal() {
    dom.bankImportFeedback.hidden = true;
    if (dom.backupFeedbackBox) dom.backupFeedbackBox.hidden = true;
    clearPendingBackupImport();
    renderBankManagerModal();
    renderBankFlaggedSection();
    openModal(dom.bankManagerModal);
  }

  function closeBankManagerModal() {
    closeModal(dom.bankManagerModal);
  }

  /* =========================================================
     الحفظ التلقائي للمباراة ومكدّس التراجع (Auto-Save & Undo Stack)
     ========================================================= */
  function normalizeTurnIndex(idx, teamsCount = state.teams.length) {
    const safeCount = Math.max(2, Number(teamsCount) || 2);
    const num = Number(idx);
    if (!Number.isInteger(num) || num < 0 || num >= safeCount) return 0;
    return num;
  }

  function cloneTeamsState(teamsArr = state.teams) {
    const defaultDouble = state.matchSettings.doubleEnabled ? state.matchSettings.doubleCount : 0;
    const defaultSwap = state.matchSettings.swapEnabled ? state.matchSettings.swapCount : 0;

    return teamsArr.map((t, idx) => {
      const doubleLeft =
        t.powerups && typeof t.powerups.doubleLeft === "number"
          ? t.powerups.doubleLeft
          : t.lifelines && t.lifelines.double === true
            ? 0
            : defaultDouble;
      const swapLeft =
        t.powerups && typeof t.powerups.swapLeft === "number"
          ? t.powerups.swapLeft
          : defaultSwap;

      return {
        id: typeof t.id === "string" && t.id.trim() ? t.id.trim() : `team-${idx}`,
        name: t.name,
        score: t.score,
        powerups: {
          doubleLeft: Math.max(0, Math.min(3, Math.round(doubleLeft))),
          swapLeft: Math.max(0, Math.min(3, Math.round(swapLeft)))
        },
        lifelines: {
          double: doubleLeft <= 0,
          twoAnswers: Boolean(t.lifelines && t.lifelines.twoAnswers),
          callFriend: Boolean(t.lifelines && t.lifelines.callFriend)
        }
      };
    });
  }

  function cloneMatchEvents(eventsArr = state.matchEvents) {
    return matchStore.sanitizeMatchEvents(eventsArr).map((ev) => ({ ...ev }));
  }

  function buildOpenQuestionPersistPayload() {
    if (!state.currentQ) return null;
    const cq = state.currentQ;
    return {
      catIdx: cq.catIdx,
      colKey: cq.colKey,
      slotIdx: cq.slotIdx,
      activeTeamAtOpen: cq.activeTeamAtOpen,
      revealed: Boolean(cq.revealed),
      phase: cq.phase || "answering",
      doubleActive: Boolean(cq.doubleActive),
      hintUsed: Boolean(cq.hintUsed),
      hintShown: Boolean(cq.hintUsed),
      swappedOutIds: Array.isArray(cq.swappedOutIds) ? cq.swappedOutIds.slice() : [],
      stealConsumed: Boolean(cq.stealConsumed),
      stealingTeamIdx: cq.stealingTeamIdx,
      stealPeekedAnswer: Boolean(cq.stealPeekedAnswer),
      preStealSnapshot: cq.preStealSnapshot ? JSON.parse(JSON.stringify(cq.preStealSnapshot)) : null,
      inModalSnapshots: Array.isArray(cq.inModalSnapshots)
        ? JSON.parse(JSON.stringify(cq.inModalSnapshots))
        : [],
      isCharades: Boolean(cq.isCharades),
      charadesDuration: cq.charadesDuration || 60,
      charadesTimerStarted: Boolean(cq.charadesTimerStarted),
      blurReduced: Boolean(cq.blurReduced),
      zoomReduced: Boolean(cq.zoomReduced),
      preQuestionSnapshot: state.preQuestionSnapshot
        ? {
            teams: cloneTeamsState(state.preQuestionSnapshot.teams),
            activeTurn: state.preQuestionSnapshot.activeTurn,
            doubleArmed: Boolean(state.preQuestionSnapshot.doubleArmed),
            answeredThisRound: state.preQuestionSnapshot.answeredThisRound,
            originalQuestion: state.preQuestionSnapshot.originalQuestion
              ? cloneQuestion(state.preQuestionSnapshot.originalQuestion)
              : null,
            originalRecycled: Boolean(state.preQuestionSnapshot.originalRecycled),
            originalPreviouslyPlayed: Boolean(state.preQuestionSnapshot.originalPreviouslyPlayed)
          }
        : null,
      timerRemaining: state.timerRemaining,
      timerMax: state.timerMax,
      timerMode: state.timerMode,
      timerRunning: Boolean(state.timerRunning),
      memoryPhase: state.memoryPhase,
      memoryRemaining: state.memoryRemaining,
      memoryTotal: state.memoryTotal
    };
  }

  function persistActiveMatch() {
    if (dom.gameScreen.classList.contains("active") && !dom.winnerModal.classList.contains("open")) {
      if (Array.isArray(state.boardCategories) && state.boardCategories.length > 0) {
        matchStore.saveMatch({
          activeProfileId: historyStore.getActiveProfileId(),
          selectedCategoryIds: state.selectedCategoryIds,
          matchSettings: state.matchSettings,
          teams: state.teams,
          activeTurn: state.activeTurn,
          doubleArmed: state.doubleArmed,
          answeredThisRound: state.answeredThisRound,
          matchEvents: state.matchEvents,
          boardCategories: state.boardCategories,
          openQuestion: buildOpenQuestionPersistPayload()
        });
      }
    }
    broadcastLiveDisplayState();
  }

  function updateUndoButtonUI() {
    if (!dom.btnUndoAction) return;
    const count = matchStore.getUndoCount();
    const top = matchStore.peekUndo();

    if (count === 0 || !top) {
      if (state.doubleArmed) {
        dom.btnUndoAction.disabled = false;
        dom.btnUndoAction.title = "تراجع عن تفعيل مضاعفة 2x للسؤال القادم — Ctrl+Z";
        if (dom.undoStepsBadge) {
          dom.undoStepsBadge.hidden = true;
          dom.undoStepsBadge.textContent = "0";
        }
        return;
      }
      dom.btnUndoAction.disabled = true;
      dom.btnUndoAction.title = "لا توجد إجراءات للتراجع عنها (Ctrl+Z)";
      if (dom.undoStepsBadge) {
        dom.undoStepsBadge.hidden = true;
        dom.undoStepsBadge.textContent = "0";
      }
      return;
    }

    dom.btnUndoAction.disabled = false;
    dom.btnUndoAction.title = `تراجع عن: ${top.label} (${count}/${matchStore.getMaxUndoSteps()}) — Ctrl+Z`;
    if (dom.undoStepsBadge) {
      dom.undoStepsBadge.hidden = false;
      dom.undoStepsBadge.textContent = String(count);
    }
  }

  function clearClosingRevealTimer() {
    if (state.closingRevealTimeout) {
      clearTimeout(state.closingRevealTimeout);
      state.closingRevealTimeout = null;
    }
  }

  function finishClosingRevealImmediately() {
    clearClosingRevealTimer();
    state.dualScreen.closingPreviewQuestion = null;
    hideCharadesSecret();
    closeLightbox();
    resetVisualModalState();
    closeModal(dom.questionModal);
    broadcastLiveDisplayState();
    if (countRemainingPlayableQuestions() === 0 && !dom.winnerModal.classList.contains("open")) {
      matchStore.clearSavedMatch();
      setTimeout(() => openWinnerModal(false), 260);
    }
  }

  function performUndo() {
    if (!dom.gameScreen.classList.contains("active")) return;

    // إذا كانت النافذة في لحظة عرض الإجابة الختامية بعد السرقة، أغلقها فوراً ونفّذ التراجع
    if (state.closingRevealTimeout && !state.currentQ) {
      clearClosingRevealTimer();
      state.dualScreen.closingPreviewQuestion = null;
      resetVisualModalState();
      closeModal(dom.questionModal);
    }

    if (document.querySelector(".modal-overlay.open")) return;

    // إذا كانت مضاعفة 2x مفعّلة للسؤال القادم على اللوحة، يلغي التراجع تفعيلها أولاً
    if (state.doubleArmed) {
      state.doubleArmed = false;
      renderScoreboard();
      updateUndoButtonUI();
      persistActiveMatch();
      if (window.SeenJeemAudio) window.SeenJeemAudio.playUndo();
      showToast("↶ تم إلغاء تفعيل بطاقة مضاعفة 2x للسؤال القادم", "info");
      return;
    }

    if (!matchStore.canUndo()) return;

    const snapshot = matchStore.popUndoSnapshot();
    if (!snapshot) return;

    // 1) استعادة النقاط ورصيد وسائل المساعدة والدور وعداد الأسئلة وسجل matchEvents
    state.teams = cloneTeamsState(snapshot.teams);
    state.activeTurn = normalizeTurnIndex(snapshot.activeTurn, state.teams.length);
    state.doubleArmed = Boolean(snapshot.doubleArmed);
    state.answeredThisRound = snapshot.answeredThisRound;
    if (Array.isArray(snapshot.matchEvents)) {
      state.matchEvents = cloneMatchEvents(snapshot.matchEvents);
    } else if (snapshot.cellState && state.matchEvents.length > 0) {
      state.matchEvents.pop();
    }

    // 2) استعادة حالة الخلية في اللوحة (بما في ذلك السؤال الأصلي إن تم تبديله)
    if (snapshot.cellState) {
      const bc = state.boardCategories[snapshot.cellState.catIdx];
      const col = bc && bc[snapshot.cellState.colKey];
      const slot = col && col[snapshot.cellState.slotIdx];
      if (slot) {
        slot.played = Boolean(snapshot.cellState.played);
        slot.winnerTeam = snapshot.cellState.winnerTeam;
        if (snapshot.cellState.question && typeof snapshot.cellState.question === "object") {
          slot.question = cloneQuestion(snapshot.cellState.question);
          slot.recycled = Boolean(snapshot.cellState.recycled);
          slot.previouslyPlayed = Boolean(snapshot.cellState.previouslyPlayed);
        }
      }
    }

    // 3) استعادة حالة «ملعوب» في سجل المجموعة بدقة
    if (snapshot.questionHistorySnapshot) {
      historyStore.restoreQuestionSnapshot(snapshot.questionHistorySnapshot);
    }

    renderScoreboard();
    renderGameBoard();
    updateUndoButtonUI();
    persistActiveMatch();

    if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playUndo === "function") {
      window.SeenJeemAudio.playUndo();
    }
    showToast(`↶ تم التراجع: ${snapshot.label}`, "info");
  }

  function openResumeMatchPrompt(savedMatch) {
    if (!savedMatch || !dom.resumeMatchModal) return;
    state.pendingSavedMatch = savedMatch;

    const t1 = savedMatch.teams[0];
    const t2 = savedMatch.teams[1];
    const turnTeam = savedMatch.teams[savedMatch.activeTurn] || t1;

    if (dom.resumeMatchSummary) {
      dom.resumeMatchSummary.innerHTML = `
        <div class="resume-teams-row">
          <div class="resume-team-pill team-1">
            <div class="resume-team-name">${escapeHtml(t1.name)}</div>
            <div class="resume-team-score">${t1.score}</div>
          </div>
          <div class="resume-vs">VS</div>
          <div class="resume-team-pill team-2">
            <div class="resume-team-name">${escapeHtml(t2.name)}</div>
            <div class="resume-team-score">${t2.score}</div>
          </div>
        </div>
        <div class="resume-meta-row">
          <span>المتبقي: <strong>${savedMatch.playableRemaining} / ${savedMatch.totalSlots}</strong></span>
          <span>•</span>
          <span>الدور: <strong>${escapeHtml(turnTeam.name)}</strong></span>
          <span>•</span>
          <span>آخر حفظ: <strong>${escapeHtml(formatTimestampArabic(savedMatch.savedAt))}</strong></span>
        </div>
      `;
    }

    openModal(dom.resumeMatchModal);
  }

  function resumeSavedMatch() {
    const saved = state.pendingSavedMatch;
    state.pendingSavedMatch = null;
    closeModal(dom.resumeMatchModal);
    if (!saved) return;

    if (saved.activeProfileId) {
      historyStore.setActiveProfile(saved.activeProfileId);
    }

    state.matchSettings = matchStore.sanitizeSettings(saved.matchSettings);
    state.selectedCategoryIds = Array.isArray(saved.selectedCategoryIds)
      ? saved.selectedCategoryIds.slice()
      : [];
    state.teams = cloneTeamsState(saved.teams);
    state.activeTurn = normalizeTurnIndex(saved.activeTurn, state.teams.length);
    state.doubleArmed = Boolean(saved.doubleArmed);
    state.lastRenderedScores = state.teams.map((t) => t.score);
    state.answeredThisRound = saved.answeredThisRound;
    state.matchEvents = cloneMatchEvents(saved.matchEvents);
    state.boardCategories = saved.boardCategories;

    if (dom.team1Input && state.teams[0]) dom.team1Input.value = state.teams[0].name;
    if (dom.team2Input && state.teams[1]) dom.team2Input.value = state.teams[1].name;

    matchStore.restoreUndoStack(saved.undoStack, state.matchSettings);

    dom.setupScreen.classList.remove("active");
    dom.setupScreen.setAttribute("aria-hidden", "true");
    dom.gameScreen.classList.add("active");
    dom.gameScreen.setAttribute("aria-hidden", "false");

    renderScoreboard();
    renderGameBoard();
    updateUndoButtonUI();
    window.scrollTo({ top: 0, behavior: "smooth" });

    // التحميل المسبق لصور اللوحة في الخلفية
    imagePreloader.preloadBoardImages(state.boardCategories, 5);

    // استعادة نافذة السؤال إن كانت مفتوحة لحظة إغلاق/تحديث الصفحة
    if (saved.openQuestion) {
      const oq = saved.openQuestion;
      const bc = state.boardCategories[oq.catIdx];
      const slot = bc && bc[oq.colKey] && bc[oq.colKey][oq.slotIdx];
      if (slot && !slot.played && slot.question) {
        openQuestionModal(oq.catIdx, oq.colKey, oq.slotIdx, oq);
      }
    }

    persistActiveMatch();
    syncWakeLockForCurrentScreen();
    showToast("تمت متابعة المباراة السابقة بنجاح ▶️", "success");
  }

  function discardSavedMatchAndStartFresh() {
    state.pendingSavedMatch = null;
    matchStore.clearSavedMatch();
    matchStore.clearUndoStack();
    closeModal(dom.resumeMatchModal);
    renderSetupScreen();
    showToast("تم بدء إعداد مباراة جديدة 🆕", "info");
  }

  /* =========================================================
     بناء جولة جديدة ولوحة اللعب (Game Board)
     ========================================================= */
  function buildRoundBoard() {
    const selectedCats = state.selectedCategoryIds
      .map((id) => state.allCategories.find((c) => c.id === id))
      .filter(Boolean);

    let totalRecycledCount = 0;

    state.boardCategories = selectedCats.map((cat) => {
      const rightColumn = [];
      const leftColumn = [];

      POINT_TIERS.forEach((tier) => {
        const tierQuestions = cat.questions.filter((q) => Number(q.points) === tier);
        const selection = historyStore.selectQuestionsForTier(tierQuestions, 2);
        totalRecycledCount += selection.recycledCount;

        for (let col = 0; col < 2; col++) {
          const item = selection.picked[col] || null;
          const qObj = item ? cloneQuestion(item.question) : null;
          const isRecycled = Boolean(item && item.recycled);
          const slot = {
            points: tier,
            question: qObj,
            played: !qObj,
            previouslyPlayed: isRecycled,
            recycled: isRecycled,
            winnerTeam: null
          };
          if (col === 0) {
            rightColumn.push(slot);
          } else {
            leftColumn.push(slot);
          }
        }
      });

      return {
        category: cat,
        rightColumn,
        leftColumn
      };
    });

    return { totalRecycledCount };
  }

  function startNewGame() {
    if (state.selectedCategoryIds.length !== REQUIRED_CATEGORIES) return;

    clearClosingRevealTimer();
    const t1Name = dom.team1Input.value.trim() || "الفريق الأول";
    const t2Name = dom.team2Input.value.trim() || "الفريق الثاني";

    state.matchSettings = matchStore.sanitizeSettings(state.setupSettings);
    const initialDouble = state.matchSettings.doubleEnabled ? state.matchSettings.doubleCount : 0;
    const initialSwap = state.matchSettings.swapEnabled ? state.matchSettings.swapCount : 0;

    state.teams = [
      {
        id: "team-0",
        name: t1Name,
        score: 0,
        powerups: { doubleLeft: initialDouble, swapLeft: initialSwap },
        lifelines: { double: initialDouble === 0, twoAnswers: false, callFriend: false }
      },
      {
        id: "team-1",
        name: t2Name,
        score: 0,
        powerups: { doubleLeft: initialDouble, swapLeft: initialSwap },
        lifelines: { double: initialDouble === 0, twoAnswers: false, callFriend: false }
      }
    ];
    state.activeTurn = 0;
    state.doubleArmed = false;
    state.lastRenderedScores = [0, 0];
    state.answeredThisRound = 0;
    state.matchEvents = [];
    state.dualScreen.closingPreviewQuestion = null;
    matchStore.clearUndoStack();

    const { totalRecycledCount } = buildRoundBoard();

    stopVictoryConfetti();
    closeModal(dom.winnerModal);
    closeModal(dom.questionModal);

    dom.setupScreen.classList.remove("active");
    dom.setupScreen.setAttribute("aria-hidden", "true");
    dom.gameScreen.classList.add("active");
    dom.gameScreen.setAttribute("aria-hidden", "false");

    renderScoreboard();
    renderGameBoard();
    updateUndoButtonUI();
    persistActiveMatch();
    syncWakeLockForCurrentScreen();
    window.scrollTo({ top: 0, behavior: "smooth" });

    // التحميل المسبق لصور التحديات البصرية في الخلفية فور بدء المباراة
    imagePreloader.preloadBoardImages(state.boardCategories, 5);

    if (totalRecycledCount > 0) {
      const profileName = historyStore.getActiveProfile().name;
      showToast(
        `♻️ تم إعادة تدوير ${totalRecycledCount} سؤال من الأقدم لعباً لاستكمال اللوحة لمجموعة «${profileName}»`,
        "info"
      );
    }
  }

  function countRemainingPlayableQuestions() {
    let remaining = 0;
    state.boardCategories.forEach((bc) => {
      [...bc.rightColumn, ...bc.leftColumn].forEach((slot) => {
        if (!slot.played && slot.question) {
          remaining++;
        }
      });
    });
    return remaining;
  }

  function countTotalBoardSlots() {
    return state.boardCategories.length * 6;
  }

  function triggerScorePop(scoreEl) {
    if (!scoreEl) return;
    scoreEl.classList.remove("score-pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("score-pop");
  }

  function toggleArmDoublePoints(teamIndex) {
    if (teamIndex !== state.activeTurn) return;
    if (dom.questionModal.classList.contains("open")) return;
    const team = state.teams[teamIndex];
    if (!team || !team.powerups || team.powerups.doubleLeft <= 0) return;

    state.doubleArmed = !state.doubleArmed;

    if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playDoubleArm === "function") {
      window.SeenJeemAudio.playDoubleArm(state.doubleArmed);
    }

    renderScoreboard();
    updateUndoButtonUI();
    persistActiveMatch();

    if (state.doubleArmed) {
      showToast(`⚡ مضاعفة 2x مفعّلة للسؤال القادم (${team.name}) — اختر سؤالاً الآن!`, "success");
    } else {
      showToast(`تم إلغاء تفعيل مضاعفة 2x للسؤال القادم`, "info");
    }
  }

  function renderScoreboard() {
    dom.boardTeam1Name.textContent = state.teams[0].name;
    dom.boardTeam2Name.textContent = state.teams[1].name;

    const s0 = state.teams[0].score;
    const s1 = state.teams[1].score;
    dom.boardTeam1Score.textContent = String(s0);
    dom.boardTeam2Score.textContent = String(s1);

    if (s0 !== state.lastRenderedScores[0]) {
      triggerScorePop(dom.boardTeam1Score);
      state.lastRenderedScores[0] = s0;
    }
    if (s1 !== state.lastRenderedScores[1]) {
      triggerScorePop(dom.boardTeam2Score);
      state.lastRenderedScores[1] = s1;
    }

    dom.scoreboardTeam1.classList.toggle("active-turn", state.activeTurn === 0);
    dom.scoreboardTeam2.classList.toggle("active-turn", state.activeTurn === 1);

    renderTeamPowerupsChips(dom.team1LifelinesStatus, 0);
    renderTeamPowerupsChips(dom.team2LifelinesStatus, 1);

    const remaining = countRemainingPlayableQuestions();
    const total = countTotalBoardSlots();
    dom.boardRemainingPill.textContent = `متبقي ${remaining} / ${total}`;
  }

  function renderTeamPowerupsChips(container, teamIndex) {
    if (!container) return;
    const team = state.teams[teamIndex];
    if (!team) return;

    container.innerHTML = "";
    const isActiveTeam = teamIndex === state.activeTurn;
    const doubleLeft = team.powerups ? team.powerups.doubleLeft : 0;
    const swapLeft = team.powerups ? team.powerups.swapLeft : 0;
    const showDouble = state.matchSettings.doubleEnabled || doubleLeft > 0;
    const showSwap = state.matchSettings.swapEnabled || swapLeft > 0;

    if (showDouble) {
      if (isActiveTeam && doubleLeft > 0) {
        const doubleBtn = document.createElement("button");
        doubleBtn.type = "button";
        doubleBtn.className = `powerup-board-chip is-interactive${state.doubleArmed ? " is-armed" : ""}`;
        doubleBtn.setAttribute("aria-pressed", String(state.doubleArmed));
        doubleBtn.title = state.doubleArmed
          ? "مضاعفة النقاط (2x) مفعّلة للسؤال القادم — اضغط لإلغاء التفعيل قبل اختيار السؤال"
          : `تفعيل مضاعفة النقاط (2x) للسؤال القادم (الرصيد: ${doubleLeft})`;
        doubleBtn.innerHTML = state.doubleArmed
          ? `<span>⚡ 2x مُفعّلة للسؤال القادم</span>`
          : `<span>⚡ 2x</span><span class="powerup-count-badge">${doubleLeft}</span>`;
        doubleBtn.addEventListener("click", () => toggleArmDoublePoints(teamIndex));
        container.appendChild(doubleBtn);
      } else {
        const doubleSpan = document.createElement("span");
        doubleSpan.className = `powerup-board-chip${
          doubleLeft <= 0 ? " is-depleted" : " is-inactive-team"
        }`;
        doubleSpan.title =
          doubleLeft <= 0
            ? "نفد رصيد مضاعفة النقاط (2x)"
            : `رصيد مضاعفة النقاط (2x): ${doubleLeft} — يُفعّل عند دور الفريق`;
        doubleSpan.innerHTML =
          doubleLeft <= 0
            ? `<span>⚡ 2x</span><span>(0)</span>`
            : `<span>⚡ 2x</span><span class="powerup-count-badge">${doubleLeft}</span>`;
        container.appendChild(doubleSpan);
      }
    }

    if (showSwap) {
      const swapSpan = document.createElement("span");
      swapSpan.className = `powerup-board-chip${
        swapLeft <= 0 ? " is-depleted" : isActiveTeam ? "" : " is-inactive-team"
      }`;
      swapSpan.title =
        swapLeft <= 0
          ? "نفد رصيد تبديل السؤال"
          : `رصيد تبديل السؤال: ${swapLeft} (يُستخدم من داخل شاشة السؤال)`;
      swapSpan.innerHTML =
        swapLeft <= 0
          ? `<span>🔄 تبديل</span><span>(0)</span>`
          : `<span>🔄 تبديل</span><span class="powerup-count-badge">${swapLeft}</span>`;
      container.appendChild(swapSpan);
    }
  }

  function renderGameBoard() {
    dom.gameBoardGrid.innerHTML = "";

    state.boardCategories.forEach((bc, catIdx) => {
      const cat = bc.category;
      const allSlots = [...bc.rightColumn, ...bc.leftColumn];
      const remainingInCat = allSlots.filter((s) => !s.played && s.question).length;

      const card = document.createElement("article");
      card.className = "board-cat-card";
      card.style.setProperty("--cat-color", getCategoryAccentColor(cat));

      const headerEl = document.createElement("div");
      headerEl.className = "board-cat-header";
      headerEl.innerHTML = `
        <div class="board-cat-icon-badge" aria-hidden="true">${escapeHtml(cat.icon || "🎯")}</div>
        <h3 class="board-cat-title" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</h3>
        <span class="board-cat-progress">${remainingInCat} / 6</span>
      `;

      const tilesGrid = document.createElement("div");
      tilesGrid.className = "board-tiles-grid";
      const rowsCount = Math.max(bc.rightColumn.length, bc.leftColumn.length);
      for (let rowIdx = 0; rowIdx < rowsCount; rowIdx++) {
        if (bc.rightColumn[rowIdx]) {
          tilesGrid.appendChild(createPointButton(catIdx, "rightColumn", rowIdx, bc.rightColumn[rowIdx]));
        }
        if (bc.leftColumn[rowIdx]) {
          tilesGrid.appendChild(createPointButton(catIdx, "leftColumn", rowIdx, bc.leftColumn[rowIdx]));
        }
      }

      card.appendChild(headerEl);
      card.appendChild(tilesGrid);

      dom.gameBoardGrid.appendChild(card);
    });
  }

  function createPointButton(catIdx, colKey, slotIdx, slot) {
    const btn = document.createElement("button");
    btn.type = "button";
    const winnerClass =
      slot.played && (slot.winnerTeam === 0 || slot.winnerTeam === 1)
        ? ` won-team-${slot.winnerTeam}`
        : "";
    const recycledClass = !slot.played && slot.recycled ? " recycled-slot" : "";
    btn.className = `q-point-btn pts-${slot.points}${slot.played ? " played" : ""}${winnerClass}${recycledClass}`;
    btn.textContent = String(slot.points);
    btn.disabled = slot.played || !slot.question;

    if (slot.played) {
      if (slot.winnerTeam === 0 || slot.winnerTeam === 1) {
        btn.title = `فاز بها: ${state.teams[slot.winnerTeam].name}`;
      } else if (!slot.question) {
        btn.title = "لا يتوفر سؤال في هذا المستوى";
      } else {
        btn.title = "تم لعب هذا السؤال";
      }
    } else {
      btn.title = slot.recycled
        ? `فتح سؤال بقيمة ${slot.points} نقطة (مُعاد تدويره من الأقدم لعباً)`
        : `فتح سؤال بقيمة ${slot.points} نقطة`;
      btn.addEventListener("click", () => openQuestionModal(catIdx, colKey, slotIdx));
    }

    return btn;
  }

  function adjustScore(teamIndex, delta) {
    const team = state.teams[teamIndex];
    if (!team) return;
    const nextScore = Math.max(0, team.score + delta);
    if (nextScore === team.score) return;

    matchStore.pushUndoSnapshot(
      {
        actionType: "manual-score",
        label: `${delta > 0 ? "إضافة" : "خصم"} ${Math.abs(delta)} نقطة (${team.name})`,
        teams: cloneTeamsState(),
        activeTurn: state.activeTurn,
        doubleArmed: state.doubleArmed,
        answeredThisRound: state.answeredThisRound,
        cellState: null,
        questionHistorySnapshot: null
      },
      state.matchSettings
    );

    team.score = nextScore;
    renderScoreboard();
    updateUndoButtonUI();
    persistActiveMatch();
  }

  function switchTurnManually() {
    matchStore.pushUndoSnapshot(
      {
        actionType: "switch-turn",
        label: `تبديل الدور من ${state.teams[state.activeTurn].name}`,
        teams: cloneTeamsState(),
        activeTurn: state.activeTurn,
        doubleArmed: state.doubleArmed,
        answeredThisRound: state.answeredThisRound,
        cellState: null,
        questionHistorySnapshot: null
      },
      state.matchSettings
    );

    state.doubleArmed = false;
    state.activeTurn = (state.activeTurn + 1) % state.teams.length;
    renderScoreboard();
    updateUndoButtonUI();
    persistActiveMatch();
    showToast(`انتقل الدور إلى: ${state.teams[state.activeTurn].name}`, "info");
  }

  /* =========================================================
     عارض تكبير الصور التفاعلي (Image Lightbox)
     ========================================================= */
  function openLightbox(items, startIndex = 0) {
    if (!Array.isArray(items) || items.length === 0) return;
    state.lightbox.items = items;
    state.lightbox.index = Math.max(0, Math.min(startIndex, items.length - 1));
    renderLightbox();
    dom.imageLightbox.classList.add("open");
    dom.imageLightbox.setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    dom.imageLightbox.classList.remove("open");
    dom.imageLightbox.setAttribute("aria-hidden", "true");
    dom.lightboxImg.removeAttribute("src");
    state.lightbox.items = [];
    state.lightbox.index = 0;
  }

  function stepLightbox(delta) {
    const len = state.lightbox.items.length;
    if (len <= 1) return;
    state.lightbox.index = (state.lightbox.index + delta + len) % len;
    renderLightbox();
  }

  function renderLightbox() {
    const item = state.lightbox.items[state.lightbox.index];
    if (!item) return;
    dom.lightboxImg.src = item.src;
    if (item.caption) {
      dom.lightboxCaption.textContent =
        state.lightbox.items.length > 1
          ? `${item.caption} (${state.lightbox.index + 1} / ${state.lightbox.items.length})`
          : item.caption;
      dom.lightboxCaption.hidden = false;
    } else {
      dom.lightboxCaption.hidden = true;
    }
    const showNav = state.lightbox.items.length > 1;
    dom.btnLightboxPrev.hidden = !showNav;
    dom.btnLightboxNext.hidden = !showNav;
  }

  /* =========================================================
     نافذة السؤال والصور والمؤقت ووسائل المساعدة
     ========================================================= */
  function normalizeAssetPath(rawPath) {
    return imagePreloader.normalizeUrl(rawPath);
  }

  /**
   * تحميل صورة السؤال المفردة مع عرض Skeleton/Spinner متناسق وحالة بديلة مع زر إعادة المحاولة عند الفشل
   */
  function loadQuestionStageImage(src, { retryAttempt = 0, loadingLabel = "جاري تحميل الصورة...", isMemory = false, onLoaded = null, onError = null } = {}) {
    const cleanSrc = normalizeAssetPath(src);
    const reqId = ++state.questionImageRequestId;

    dom.modalQuestionImage.onload = null;
    dom.modalQuestionImage.onerror = null;

    if (!cleanSrc) {
      dom.modalQuestionImage.removeAttribute("src");
      dom.visualImageStage.classList.remove("is-loading", "has-error");
      if (dom.visualImageSkeleton) dom.visualImageSkeleton.hidden = true;
      if (dom.visualImageError) dom.visualImageError.hidden = true;
      dom.modalQuestionImageWrap.hidden = true;
      return;
    }

    dom.modalQuestionImageWrap.hidden = false;
    if (dom.visualImageError) dom.visualImageError.hidden = true;
    if (dom.btnSkipBrokenMemory) dom.btnSkipBrokenMemory.hidden = !isMemory;

    // إذا كانت الصورة جاهزة بالفعل في كاش التحميل المسبق ولم تكن محاولة إعادة قسرية
    if (retryAttempt === 0 && imagePreloader.isCached(cleanSrc)) {
      dom.visualImageStage.classList.remove("is-loading", "has-error");
      if (dom.visualImageSkeleton) dom.visualImageSkeleton.hidden = true;
      dom.modalQuestionImage.src = cleanSrc;
      if (typeof onLoaded === "function") onLoaded();
      return;
    }

    dom.visualImageStage.classList.add("is-loading");
    dom.visualImageStage.classList.remove("has-error");
    if (dom.visualLoadingLabel) {
      dom.visualLoadingLabel.textContent = loadingLabel;
    }
    if (dom.visualImageSkeleton) {
      dom.visualImageSkeleton.hidden = false;
    }
    dom.singleImageZoomHint.hidden = true;

    imagePreloader
      .preloadOne(cleanSrc, { retryAttempt })
      .then((loadedImg) => {
        if (reqId !== state.questionImageRequestId) return;
        dom.visualImageStage.classList.remove("is-loading", "has-error");
        if (dom.visualImageSkeleton) dom.visualImageSkeleton.hidden = true;
        if (dom.visualImageError) dom.visualImageError.hidden = true;
        dom.modalQuestionImage.src = loadedImg.src || cleanSrc;
        if (typeof onLoaded === "function") onLoaded();
      })
      .catch(() => {
        if (reqId !== state.questionImageRequestId) return;
        dom.modalQuestionImage.removeAttribute("src");
        dom.visualImageStage.classList.remove("is-loading");
        dom.visualImageStage.classList.add("has-error");
        if (dom.visualImageSkeleton) dom.visualImageSkeleton.hidden = true;
        if (dom.visualImageError) dom.visualImageError.hidden = false;
        dom.singleImageZoomHint.hidden = true;
        if (typeof onError === "function") onError();
      });
  }

  /**
   * تحميل صورة الإجابة الاختيارية مع Skeleton وزر إعادة المحاولة
   */
  function loadAnswerStageImage(src, retryAttempt = 0) {
    const cleanSrc = normalizeAssetPath(src);
    state.currentAnswerImgSrc = cleanSrc;
    const reqId = ++state.answerImageRequestId;

    dom.modalAnswerImage.onload = null;
    dom.modalAnswerImage.onerror = null;

    if (!cleanSrc) {
      dom.modalAnswerImage.removeAttribute("src");
      if (dom.answerImageStage) dom.answerImageStage.classList.remove("is-loading", "has-error");
      if (dom.answerImageSkeleton) dom.answerImageSkeleton.hidden = true;
      if (dom.answerImageError) dom.answerImageError.hidden = true;
      dom.modalAnswerImageWrap.hidden = true;
      return;
    }

    dom.modalAnswerImageWrap.hidden = false;
    if (dom.answerImageError) dom.answerImageError.hidden = true;

    if (retryAttempt === 0 && imagePreloader.isCached(cleanSrc)) {
      if (dom.answerImageStage) {
        dom.answerImageStage.classList.remove("is-loading", "has-error");
        dom.answerImageStage.classList.add("is-zoomable");
      }
      if (dom.answerImageSkeleton) dom.answerImageSkeleton.hidden = true;
      if (dom.answerImageZoomHint) dom.answerImageZoomHint.hidden = false;
      dom.modalAnswerImage.src = cleanSrc;
      return;
    }

    if (dom.answerImageStage) {
      dom.answerImageStage.classList.add("is-loading");
      dom.answerImageStage.classList.remove("has-error", "is-zoomable");
    }
    if (dom.answerImageSkeleton) dom.answerImageSkeleton.hidden = false;
    if (dom.answerImageZoomHint) dom.answerImageZoomHint.hidden = true;

    imagePreloader
      .preloadOne(cleanSrc, { retryAttempt })
      .then((loadedImg) => {
        if (reqId !== state.answerImageRequestId) return;
        if (dom.answerImageStage) {
          dom.answerImageStage.classList.remove("is-loading", "has-error");
          dom.answerImageStage.classList.add("is-zoomable");
        }
        if (dom.answerImageSkeleton) dom.answerImageSkeleton.hidden = true;
        if (dom.answerImageError) dom.answerImageError.hidden = true;
        if (dom.answerImageZoomHint) dom.answerImageZoomHint.hidden = false;
        dom.modalAnswerImage.src = loadedImg.src || cleanSrc;
      })
      .catch(() => {
        if (reqId !== state.answerImageRequestId) return;
        dom.modalAnswerImage.removeAttribute("src");
        if (dom.answerImageStage) {
          dom.answerImageStage.classList.remove("is-loading", "is-zoomable");
          dom.answerImageStage.classList.add("has-error");
        }
        if (dom.answerImageSkeleton) dom.answerImageSkeleton.hidden = true;
        if (dom.answerImageError) dom.answerImageError.hidden = false;
        if (dom.answerImageZoomHint) dom.answerImageZoomHint.hidden = true;
      });
  }

  function stopMemoryInterval() {
    if (state.memoryInterval) {
      clearInterval(state.memoryInterval);
      state.memoryInterval = null;
    }
  }

  function isMemoryLockedPhase() {
    return (
      state.memoryPhase === "ready" ||
      state.memoryPhase === "loading" ||
      state.memoryPhase === "viewing"
    );
  }

  function isCharadesQuestion(category, question) {
    const qCatId =
      question && typeof question.categoryId === "string"
        ? question.categoryId.trim().toLowerCase()
        : "";
    const catId =
      category && typeof category.id === "string"
        ? category.id.trim().toLowerCase()
        : "";
    if (qCatId.startsWith("mgk-") || catId.startsWith("mgk-")) return true;
    if (category && resolveCategoryGroup(category) === "charades") return true;
    return false;
  }

  function getDefaultCharadesSeconds(points) {
    const pts = Number(points) || 200;
    if (pts >= 600) return 120;
    if (pts >= 400) return 90;
    return 60;
  }

  function formatWordCountFallback(answerText) {
    const words = String(answerText || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    if (words <= 1) return "كلمة واحدة";
    if (words === 2) return "كلمتان";
    if (words <= 10) return `${words} كلمات`;
    return `${words} كلمة`;
  }

  /**
   * تحليل ذكي لنص سؤال «من غير كلام»:
   * استخراج الجزء الذي يسبق | فقط (التصنيف الفرعي + عدد الكلمات) وإخفاء جملة التعليمات الطويلة بعد |
   */
  function parseCharadesHeader(rawQuestion, answerText, categoryName) {
    const raw = typeof rawQuestion === "string" ? rawQuestion.trim() : "";
    const beforePipe = raw.includes("|") ? raw.split("|")[0].trim() : raw;

    if (!beforePipe) {
      return {
        eyebrow: categoryName || "🎭 من غير كلام",
        topic: categoryName || "تحدي التمثيل الصامت",
        wordCount: formatWordCountFallback(answerText)
      };
    }

    let coreText = beforePipe;
    let wordCount = "";

    const parenMatch = beforePipe.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (parenMatch) {
      coreText = parenMatch[1].trim();
      wordCount = parenMatch[2].trim();
    }

    let eyebrow = "🎭 من غير كلام — تحدي التمثيل الصامت";
    let topic = coreText;

    const dashMatch = coreText.match(/^([^\w\u0600-\u06FF]*من غير كلام)\s*[—–\-:]\s*(.+)$/);
    if (dashMatch) {
      eyebrow = dashMatch[1].trim();
      topic = dashMatch[2].trim();
    } else if (!topic) {
      topic = beforePipe;
    }

    if (!wordCount) {
      wordCount = formatWordCountFallback(answerText);
    }

    return {
      eyebrow,
      topic: topic || categoryName || "تمثيل صامت",
      wordCount
    };
  }

  function showCharadesSecret() {
    if (
      !state.currentQ ||
      !state.currentQ.isCharades ||
      state.currentQ.revealed ||
      state.currentQ.phase === "steal-active"
    ) {
      return;
    }

    state.charadesHoldActive = true;
    const q = state.currentQ.question;
    if (dom.charadesSecretAnswer) {
      dom.charadesSecretAnswer.textContent = q.answer || "";
    }
    const exp = typeof q.explanation === "string" ? q.explanation.trim() : "";
    if (dom.charadesSecretExplanation) {
      if (exp) {
        dom.charadesSecretExplanation.textContent = `🎬 فكرة التمثيل: ${exp}`;
        dom.charadesSecretExplanation.hidden = false;
      } else {
        dom.charadesSecretExplanation.textContent = "";
        dom.charadesSecretExplanation.hidden = true;
      }
    }

    if (dom.charadesDecoyCard) dom.charadesDecoyCard.hidden = true;
    if (dom.charadesSecretCard) dom.charadesSecretCard.hidden = false;
    if (dom.btnHoldRevealSecret) dom.btnHoldRevealSecret.classList.add("is-holding");
    if (dom.btnHoldRevealLabel) {
      dom.btnHoldRevealLabel.textContent = "🤫 الكلمة ظاهرة للممثّل — ارفع الإصبع للإخفاء فوراً";
    }
  }

  function hideCharadesSecret() {
    state.charadesHoldActive = false;
    if (dom.charadesSecretCard) dom.charadesSecretCard.hidden = true;
    if (dom.charadesSecretAnswer) dom.charadesSecretAnswer.textContent = "";
    if (dom.charadesSecretExplanation) {
      dom.charadesSecretExplanation.textContent = "";
      dom.charadesSecretExplanation.hidden = true;
    }
    if (dom.charadesDecoyCard) dom.charadesDecoyCard.hidden = false;
    if (dom.btnHoldRevealSecret) dom.btnHoldRevealSecret.classList.remove("is-holding");
    if (dom.btnHoldRevealLabel) {
      dom.btnHoldRevealLabel.textContent = "اضغط مع الاستمرار لكشف الكلمة سراً";
    }
  }

  function resetVisualModalState() {
    stopMemoryInterval();
    hideCharadesSecret();
    state.memoryPhase = null;
    state.questionImageRequestId++;
    state.answerImageRequestId++;
    state.questionImageRetryCount = 0;
    state.answerImageRetryCount = 0;
    state.currentAnswerImgSrc = "";

    dom.modalVisualTypePill.hidden = true;
    dom.modalVisualTypePill.textContent = "";

    if (dom.stealStatusBanner) {
      dom.stealStatusBanner.hidden = true;
      dom.stealStatusBanner.className = "steal-status-banner";
    }
    if (dom.stealTeamSelector) {
      dom.stealTeamSelector.hidden = true;
      dom.stealTeamSelector.innerHTML = "";
    }

    if (dom.questionBodyBox) {
      dom.questionBodyBox.classList.remove("is-charades-mode");
    }
    if (dom.charadesView) {
      dom.charadesView.hidden = true;
    }
    if (dom.charadesActorStage) {
      dom.charadesActorStage.hidden = false;
    }
    if (dom.charadesTimerBox) {
      dom.charadesTimerBox.hidden = false;
      dom.charadesTimerBox.classList.remove("is-danger");
    }

    if (dom.timerSection) {
      dom.timerSection.hidden = false;
      dom.timerSection.classList.remove("steal-active");
    }

    dom.memoryReadyPanel.hidden = true;
    dom.memoryCountdownPanel.hidden = true;
    dom.memoryProgressBar.style.width = "100%";
    dom.timerProgressBar.style.width = "100%";
    dom.modalQuestionText.hidden = false;

    dom.visualImageStage.className = "visual-image-stage";
    dom.visualImageStage.style.removeProperty("--blur-amount");
    dom.visualImageStage.style.removeProperty("--blur-half");
    dom.visualImageStage.style.removeProperty("--zoom-amount");
    dom.visualImageStage.style.removeProperty("--zoom-half");

    if (dom.visualImageSkeleton) dom.visualImageSkeleton.hidden = true;
    if (dom.visualImageError) dom.visualImageError.hidden = true;
    if (dom.btnSkipBrokenMemory) dom.btnSkipBrokenMemory.hidden = true;

    dom.modalQuestionImage.removeAttribute("src");
    dom.modalQuestionImage.style.removeProperty("filter");
    dom.modalQuestionImage.style.removeProperty("transform");
    dom.modalQuestionImage.style.transformOrigin = "center";
    dom.modalQuestionImageWrap.hidden = true;
    dom.singleImageZoomHint.hidden = true;

    dom.modalAnswerImage.removeAttribute("src");
    if (dom.answerImageSkeleton) dom.answerImageSkeleton.hidden = true;
    if (dom.answerImageError) dom.answerImageError.hidden = true;
    dom.modalAnswerImageWrap.hidden = true;

    dom.blurControlsWrap.hidden = true;
    dom.btnReduceBlur.disabled = false;
    dom.btnReduceBlur.textContent = "👁️ تخفيف التغبيش (تلميح)";

    dom.zoomControlsWrap.hidden = true;
    dom.btnReduceZoom.disabled = false;
    dom.btnReduceZoom.textContent = "🔎 تخفيف الزوم (تلميح)";

    dom.spotDiffBadgeWrap.hidden = true;
    dom.spotDiffCountBadge.textContent = "";

    dom.modalMultiImagesWrap.hidden = true;
    dom.modalMultiImagesWrap.className = "multi-images-wrap";
    dom.modalMultiImagesWrap.innerHTML = "";

    if (dom.questionTacticalBar) dom.questionTacticalBar.hidden = false;
    dom.questionHintWrap.hidden = true;
    dom.btnShowHint.disabled = false;
    if (dom.questionSwapWrap) dom.questionSwapWrap.hidden = true;
    if (dom.btnSwapQuestion) dom.btnSwapQuestion.disabled = false;
    if (dom.swapUnavailableNote) dom.swapUnavailableNote.hidden = true;
    dom.questionHintBox.hidden = true;
    dom.questionHintBox.textContent = "";

    dom.modalAnswerExplanation.hidden = true;
    dom.modalAnswerExplanation.textContent = "";

    dom.btnRevealAnswer.disabled = false;
    if (dom.btnWrongAnswer) dom.btnWrongAnswer.disabled = false;
    dom.btnTimerReset.disabled = false;

    if (dom.preRevealActions) dom.preRevealActions.hidden = false;
    if (dom.stealOfferActions) dom.stealOfferActions.hidden = true;
    if (dom.stealActiveActions) dom.stealActiveActions.hidden = true;
    if (dom.closingRevealActions) dom.closingRevealActions.hidden = true;
    if (dom.postRevealActions) dom.postRevealActions.hidden = true;

    if (dom.qModalScrollBody) {
      dom.qModalScrollBody.scrollTop = 0;
    }
  }

  function formatDifferencesBadge(count) {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n === 1) return "🔍 المطلوب إيجاد فرق واحد (1)";
    if (n === 2) return "🔍 المطلوب إيجاد فرقين (2)";
    if (n <= 10) return `🔍 المطلوب إيجاد ${n} فروقات`;
    return `🔍 المطلوب إيجاد ${n} فرقاً`;
  }

  function updateSingleImageZoomability() {
    if (!state.currentQ) return;
    const vType = state.currentQ.visualType;
    const isMaskedNow =
      (MASKED_VISUAL_TYPES.has(vType) && !state.currentQ.revealed) ||
      (vType === "memory" && isMemoryLockedPhase());
    const hasSrc = Boolean(dom.modalQuestionImage.getAttribute("src"));
    const isLoadedClean =
      hasSrc &&
      !dom.visualImageStage.classList.contains("is-loading") &&
      !dom.visualImageStage.classList.contains("has-error");
    const canZoom = isLoadedClean && !isMaskedNow;

    dom.visualImageStage.classList.toggle("is-zoomable", canZoom);
    dom.singleImageZoomHint.hidden = !canZoom;
  }

  function createGalleryImageCard(item, galleryItems, idx) {
    const card = document.createElement("div");
    card.className = "multi-img-card";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.title = `${item.caption} — اضغط للتكبير`;

    const label = document.createElement("span");
    label.className = "multi-img-label";
    label.textContent = item.caption;

    const img = document.createElement("img");
    img.className = "multi-img-el";
    img.alt = item.caption;

    const hint = document.createElement("span");
    hint.className = "zoom-hint-badge";
    hint.textContent = "🔍 تكبير";

    const errorBox = document.createElement("div");
    errorBox.className = "multi-img-error-box";
    errorBox.hidden = true;

    const errText = document.createElement("div");
    errText.className = "multi-img-error-text";
    errText.textContent = "تعذّر تحميل هذه الصورة";

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn btn-primary btn-xs";
    retryBtn.textContent = "🔄 إعادة المحاولة";

    let cardRetryAttempt = 0;
    const loadCardImg = (attempt) => {
      card.classList.remove("has-img-error");
      errorBox.hidden = true;
      img.hidden = false;
      hint.hidden = false;

      imagePreloader
        .preloadOne(item.src, { retryAttempt: attempt })
        .then((loaded) => {
          img.src = loaded.src || item.src;
        })
        .catch(() => {
          card.classList.add("has-img-error");
          img.hidden = true;
          hint.hidden = true;
          errorBox.hidden = false;
        });
    };

    retryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cardRetryAttempt++;
      loadCardImg(cardRetryAttempt);
    });

    errorBox.appendChild(errText);
    errorBox.appendChild(retryBtn);

    card.appendChild(label);
    card.appendChild(img);
    card.appendChild(errorBox);
    card.appendChild(hint);

    const handleZoom = () => {
      if (card.classList.contains("has-img-error")) return;
      openLightbox(galleryItems, idx);
    };

    card.addEventListener("click", handleZoom);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleZoom();
      }
    });

    loadCardImg(0);
    return card;
  }

  function renderSpotDiffGallery(images) {
    const validImages = Array.isArray(images)
      ? images.map((s) => normalizeAssetPath(s)).filter(Boolean).slice(0, 2)
      : [];

    if (validImages.length === 0) {
      dom.modalMultiImagesWrap.hidden = true;
      return;
    }

    dom.modalMultiImagesWrap.innerHTML = "";
    dom.modalMultiImagesWrap.className = "multi-images-wrap layout-spot-diff";

    const spotLabels = ["الصورة أ", "الصورة ب"];
    const galleryItems = validImages.map((src, idx) => ({
      src,
      caption: spotLabels[idx] || `الصورة ${idx + 1}`
    }));

    galleryItems.forEach((item, idx) => {
      dom.modalMultiImagesWrap.appendChild(createGalleryImageCard(item, galleryItems, idx));
    });

    dom.modalMultiImagesWrap.hidden = false;
  }

  function renderMultiImageConnectionGallery(images, showPlus = false) {
    const validImages = Array.isArray(images)
      ? images.map((s) => normalizeAssetPath(s)).filter(Boolean).slice(0, 4)
      : [];

    if (validImages.length === 0) {
      dom.modalMultiImagesWrap.hidden = true;
      return;
    }

    dom.modalMultiImagesWrap.innerHTML = "";

    const count = validImages.length;
    const usePlusSeparators = Boolean(showPlus) && (count === 2 || count === 3);

    if (count === 2) {
      dom.modalMultiImagesWrap.className = usePlusSeparators
        ? "multi-images-wrap layout-multi-2-plus"
        : "multi-images-wrap layout-multi-2";
    } else if (count === 3) {
      dom.modalMultiImagesWrap.className = usePlusSeparators
        ? "multi-images-wrap layout-multi-3-plus"
        : "multi-images-wrap layout-multi-3";
    } else if (count >= 4) {
      dom.modalMultiImagesWrap.className = "multi-images-wrap layout-multi-4";
    } else {
      dom.modalMultiImagesWrap.className = "multi-images-wrap layout-multi-2";
    }

    const galleryItems = validImages.map((src, idx) => ({
      src,
      caption: `صورة ${idx + 1}`
    }));

    galleryItems.forEach((item, idx) => {
      dom.modalMultiImagesWrap.appendChild(createGalleryImageCard(item, galleryItems, idx));
      if (usePlusSeparators && idx < galleryItems.length - 1) {
        const plusEl = document.createElement("div");
        plusEl.className = "multi-plus-separator";
        plusEl.setAttribute("aria-hidden", "true");
        plusEl.textContent = "+";
        dom.modalMultiImagesWrap.appendChild(plusEl);
      }
    });

    dom.modalMultiImagesWrap.hidden = false;
  }

  /* =========================================================
     حساب النقاط، التلميح المخصوم، تبديل السؤال، وفرصة السرقة
     ========================================================= */
  function computeEffectiveQuestionPoints(cq = state.currentQ) {
    if (!cq || !cq.question) return 0;
    const basePoints = Number(cq.question.points) || 200;
    const hintPenalty = state.matchSettings.hintEnabled ? Number(state.matchSettings.hintPenalty) || 0 : 0;
    const hintUsed = Boolean(cq.hintUsed);
    const doubleActive = Boolean(cq.doubleActive);
    return Math.round(basePoints * (hintUsed ? 1 - hintPenalty : 1) * (doubleActive ? 2 : 1));
  }

  function computeDiscountedBasePoints(cq = state.currentQ) {
    if (!cq || !cq.question) return 0;
    const basePoints = Number(cq.question.points) || 200;
    const hintPenalty = state.matchSettings.hintEnabled ? Number(state.matchSettings.hintPenalty) || 0 : 0;
    return Math.round(basePoints * (cq.hintUsed ? 1 - hintPenalty : 1));
  }

  function computeStealQuestionPoints(cq = state.currentQ) {
    if (!cq || !cq.question) return 0;
    const basePoints = Number(cq.question.points) || 200;
    const hintPenalty = state.matchSettings.hintEnabled ? Number(state.matchSettings.hintPenalty) || 0 : 0;
    const stealMultiplier = Number(state.matchSettings.stealMultiplier) || 0.5;
    // لا تنتقل مضاعفة 2x أبداً إلى الفريق المنافس في حال السرقة
    return Math.round(basePoints * (cq.hintUsed ? 1 - hintPenalty : 1) * stealMultiplier);
  }

  function getDefaultStealingTeamIndex(ownerTeamIdx) {
    const count = state.teams.length;
    if (count < 2) return 0;
    return (ownerTeamIdx + 1) % count;
  }

  function captureInModalSnapshot(reason) {
    if (!state.currentQ) return null;
    const cq = state.currentQ;
    return {
      reason,
      teams: cloneTeamsState(),
      slotQuestion: cloneQuestion(cq.slot.question),
      slotRecycled: Boolean(cq.slot.recycled),
      slotPreviouslyPlayed: Boolean(cq.slot.previouslyPlayed),
      hintUsed: Boolean(cq.hintUsed),
      blurReduced: Boolean(cq.blurReduced),
      zoomReduced: Boolean(cq.zoomReduced),
      swappedOutIds: cq.swappedOutIds.slice(),
      phase: cq.phase,
      stealConsumed: Boolean(cq.stealConsumed),
      stealingTeamIdx: cq.stealingTeamIdx,
      stealPeekedAnswer: Boolean(cq.stealPeekedAnswer),
      isCharades: Boolean(cq.isCharades),
      charadesDuration: cq.charadesDuration,
      charadesTimerStarted: Boolean(cq.charadesTimerStarted),
      timerRemaining: state.timerRemaining,
      timerMax: state.timerMax,
      timerMode: state.timerMode,
      timerRunning: Boolean(state.timerRunning),
      memoryPhase: state.memoryPhase,
      memoryRemaining: state.memoryRemaining,
      memoryTotal: state.memoryTotal
    };
  }

  function restoreInModalSnapshot(snap) {
    if (!state.currentQ || !snap) return;
    const cq = state.currentQ;

    stopTimerInterval();
    stopMemoryInterval();
    hideCharadesSecret();

    state.teams = cloneTeamsState(snap.teams);
    cq.slot.question = cloneQuestion(snap.slotQuestion);
    cq.slot.recycled = Boolean(snap.slotRecycled);
    cq.slot.previouslyPlayed = Boolean(snap.slotPreviouslyPlayed);
    cq.question = cq.slot.question;
    cq.hintUsed = Boolean(snap.hintUsed);
    cq.blurReduced = Boolean(snap.blurReduced);
    cq.zoomReduced = Boolean(snap.zoomReduced);
    cq.swappedOutIds = Array.isArray(snap.swappedOutIds) ? snap.swappedOutIds.slice() : [];
    cq.phase = snap.phase || "answering";
    cq.stealConsumed = Boolean(snap.stealConsumed);
    cq.stealingTeamIdx = snap.stealingTeamIdx;
    cq.stealPeekedAnswer = Boolean(snap.stealPeekedAnswer);
    cq.isCharades = Boolean(snap.isCharades);
    cq.charadesDuration = snap.charadesDuration || getDefaultCharadesSeconds(cq.question.points);
    cq.charadesTimerStarted = Boolean(snap.charadesTimerStarted);
    cq.revealed = false;

    applyCurrentQuestionStage({
      blurReduced: cq.blurReduced,
      zoomReduced: cq.zoomReduced,
      hintUsed: cq.hintUsed,
      phase: cq.phase,
      stealConsumed: cq.stealConsumed,
      stealingTeamIdx: cq.stealingTeamIdx,
      stealPeekedAnswer: cq.stealPeekedAnswer,
      charadesDuration: cq.charadesDuration,
      charadesTimerStarted: cq.charadesTimerStarted,
      timerRemaining: snap.timerRemaining,
      timerMax: snap.timerMax,
      timerMode: snap.timerMode,
      timerRunning: snap.timerRunning,
      memoryPhase: snap.memoryPhase,
      memoryRemaining: snap.memoryRemaining,
      memoryTotal: snap.memoryTotal
    });

    renderScoreboard();
    renderGameBoard();
    persistActiveMatch();
  }

  function performInModalUndo() {
    if (!state.currentQ) return false;
    const cq = state.currentQ;
    if (Array.isArray(cq.inModalSnapshots) && cq.inModalSnapshots.length > 0) {
      const lastSnap = cq.inModalSnapshots.pop();
      restoreInModalSnapshot(lastSnap);
      if (window.SeenJeemAudio) window.SeenJeemAudio.playUndo();
      const labelMap = {
        steal: "فرصة السرقة",
        swap: "تبديل السؤال",
        hint: "كشف التلميح"
      };
      showToast(`↶ تم التراجع عن ${labelMap[lastSnap.reason] || "آخر خطوة"}`, "info");
      return true;
    }
    if (!cq.revealed) {
      cancelCurrentQuestion();
      return true;
    }
    return false;
  }

  function useQuestionHint() {
    if (!state.currentQ || state.currentQ.revealed || isMemoryLockedPhase()) return;
    if (state.currentQ.phase !== "answering") return;
    if (!state.matchSettings.hintEnabled || state.currentQ.hintUsed) return;

    const hintText =
      typeof state.currentQ.question.hint === "string"
        ? state.currentQ.question.hint.trim()
        : "";
    if (!hintText) return;

    state.currentQ.inModalSnapshots.push(captureInModalSnapshot("hint"));
    state.currentQ.hintUsed = true;

    updateQuestionPointsAndBanners();
    updateTacticalControlsUI();
    updateModalPhaseUI();
    persistActiveMatch();

    if (window.SeenJeemAudio) {
      if (typeof window.SeenJeemAudio.playHint === "function") {
        window.SeenJeemAudio.playHint();
      } else {
        window.SeenJeemAudio.playTick(false);
      }
    }

    const penaltyPct = Math.round((Number(state.matchSettings.hintPenalty) || 0) * 100);
    const effectivePts = computeEffectiveQuestionPoints(state.currentQ);
    if (penaltyPct > 0) {
      showToast(`💡 تم كشف التلميح (-${penaltyPct}%) — قيمة السؤال الآن ${effectivePts} نقطة`, "info");
    } else {
      showToast("💡 تم كشف التلميح", "info");
    }
  }

  function collectCurrentBoardQuestionIds(extraExcludeIds = []) {
    const ids = new Set(Array.isArray(extraExcludeIds) ? extraExcludeIds : []);
    state.boardCategories.forEach((bc) => {
      [...bc.rightColumn, ...bc.leftColumn].forEach((s) => {
        if (s && s.question && typeof s.question.id === "string") {
          ids.add(s.question.id);
        }
      });
    });
    return ids;
  }

  function getAvailableSwapCandidates(cq = state.currentQ) {
    if (!cq || !cq.category || !cq.slot) return [];
    const targetPoints = Number(cq.slot.points) || Number(cq.question.points) || 200;
    const rawCatId = cq.category.id;
    const mappedCatId = state.categoryIdRedirect.get(rawCatId) ?? rawCatId;
    const bankCat =
      state.allCategories.find((c) => c.id === mappedCatId || c.id === rawCatId) || cq.category;

    if (!bankCat || !Array.isArray(bankCat.questions)) return [];

    const excludedIds = collectCurrentBoardQuestionIds(cq.swappedOutIds || []);
    return bankCat.questions.filter(
      (q) => q && Number(q.points) === targetPoints && !excludedIds.has(q.id)
    );
  }

  function preloadSingleQuestionAssets(q) {
    if (!q || typeof q !== "object") return;
    if (q.questionImage) {
      imagePreloader.preloadOne(q.questionImage).catch(() => {});
    }
    if (Array.isArray(q.images)) {
      q.images.forEach((imgUrl) => {
        imagePreloader.preloadOne(imgUrl).catch(() => {});
      });
    }
    if (q.answerImage) {
      imagePreloader.preloadOne(q.answerImage).catch(() => {});
    }
  }

  function swapCurrentQuestion() {
    if (!state.currentQ || state.currentQ.revealed) return;
    if (state.currentQ.phase !== "answering") return;
    if (!state.matchSettings.swapEnabled) return;

    const cq = state.currentQ;
    const ownerTeam = state.teams[cq.activeTeamAtOpen];
    if (!ownerTeam || !ownerTeam.powerups || ownerTeam.powerups.swapLeft <= 0) return;

    const candidates = getAvailableSwapCandidates(cq);
    if (candidates.length === 0) {
      showToast("لا توجد أسئلة بديلة متاحة في البنك لهذه الفئة والصعوبة", "warning");
      updateTacticalControlsUI();
      return;
    }

    const selection = historyStore.selectQuestionsForTier(candidates, 1);
    const pickedItem = selection.picked[0];
    if (!pickedItem || !pickedItem.question) {
      showToast("لا توجد أسئلة بديلة متاحة", "warning");
      return;
    }

    // حفظ لقطة داخلية للتراجع قبل التبديل (دون تسجيل السؤال المُستبدَل كملعوب!)
    cq.inModalSnapshots.push(captureInModalSnapshot("swap"));

    const oldQuestionId = cq.question.id;
    cq.swappedOutIds.push(oldQuestionId);
    ownerTeam.powerups.swapLeft = Math.max(0, ownerTeam.powerups.swapLeft - 1);

    const newQ = cloneQuestion(pickedItem.question);
    const isRecycled = Boolean(pickedItem.recycled);

    // تحميل صور السؤال البديل مسبقاً إن كان بصرياً
    preloadSingleQuestionAssets(newQ);

    cq.slot.question = newQ;
    cq.slot.recycled = isRecycled;
    cq.slot.previouslyPlayed = isRecycled;
    cq.question = newQ;

    // إعادة ضبط التلميح والمؤقت والوسائط للسؤال الجديد مع الإبقاء على 2x نشطة إن كانت مفعّلة لهذا الدور
    cq.hintUsed = false;
    cq.blurReduced = false;
    cq.zoomReduced = false;
    cq.isCharades = isCharadesQuestion(cq.category, newQ);
    cq.charadesDuration = getDefaultCharadesSeconds(newQ.points);
    cq.charadesTimerStarted = false;
    cq.phase = "answering";
    cq.stealConsumed = false;
    cq.stealPeekedAnswer = false;
    cq.preStealSnapshot = null;

    applyCurrentQuestionStage(null);
    renderScoreboard();
    renderGameBoard();
    persistActiveMatch();

    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playLifeline();
    }
    showToast(
      `🔄 تم تبديل السؤال بنجاح! (متبقي ${ownerTeam.powerups.swapLeft} تبديل لـ ${ownerTeam.name})`,
      "success"
    );
  }

  function formatSecondsLabel(seconds) {
    const n = Math.max(1, Math.floor(Number(seconds) || DEFAULT_MEMORY_SECONDS));
    if (n === 1) return "ثانية واحدة";
    if (n === 2) return "ثانيتان";
    if (n <= 10) return `${n} ثوانٍ`;
    return `${n} ثانية`;
  }

  /** المرحلة الأولى لنوع memory: الاستعداد مع بدء التحميل المسبق للصورة بالخلفية */
  function prepareMemoryReadyPhase(seconds) {
    stopMemoryInterval();
    stopTimerInterval();

    state.memoryTotal = Math.max(1, Math.floor(Number(seconds) || DEFAULT_MEMORY_SECONDS));
    state.memoryRemaining = state.memoryTotal;
    state.memoryPhase = "ready";

    state.timerRunning = false;
    const configuredMain = getConfiguredMainTimerSeconds();
    state.timerRemaining = configuredMain;
    state.timerMax = configuredMain > 0 ? configuredMain : MAIN_TIMER_SECONDS;
    state.timerMode = "waiting-memory";

    dom.modalQuestionText.hidden = true;
    dom.modalQuestionImageWrap.hidden = true;
    dom.modalQuestionImage.removeAttribute("src");
    dom.memoryCountdownPanel.hidden = true;
    dom.memoryReadyPanel.hidden = false;
    dom.btnMemoryStart.textContent = `👁️ ابدأ عرض الصورة (${formatSecondsLabel(state.memoryTotal)})`;

    dom.btnRevealAnswer.disabled = true;
    if (dom.btnWrongAnswer) dom.btnWrongAnswer.disabled = true;
    dom.btnTimerReset.disabled = true;

    if (state.currentQ && state.currentQ.question.questionImage) {
      imagePreloader.preloadOne(state.currentQ.question.questionImage).catch(() => {});
    }

    renderTimerUI();
    updateTacticalControlsUI();
  }

  /**
   * المرحلة الثانية لنوع memory:
   * عدالة مؤقت الذاكرة: لا يبدأ العدّاد التنازلي مطلقاً قبل اكتمال تحميل الصورة فعلياً!
   */
  function startMemoryViewingPhase(isRetry = false) {
    if (!state.currentQ) return;
    if (!isRetry && state.memoryPhase !== "ready") return;
    if (isRetry && state.memoryPhase !== "loading") return;

    stopMemoryInterval();
    state.memoryRemaining = state.memoryTotal;
    state.memoryPhase = "loading";

    dom.memoryReadyPanel.hidden = true;
    dom.modalQuestionText.hidden = true;
    dom.memoryCountdownPanel.hidden = true;
    dom.visualImageStage.classList.add("visual-mode-memory-viewing");

    renderTimerUI();
    updateTacticalControlsUI();

    const attempt = isRetry ? state.questionImageRetryCount : 0;

    loadQuestionStageImage(state.currentQ.question.questionImage, {
      retryAttempt: attempt,
      loadingLabel: "⏳ جاري تحضير الصورة... لن يبدأ العدّاد قبل اكتمال التحميل",
      isMemory: true,
      onLoaded: () => {
        if (!state.currentQ || state.memoryPhase !== "loading") return;
        state.memoryPhase = "viewing";
        state.memoryRemaining = state.memoryTotal;
        dom.memoryCountdownPanel.hidden = false;
        updateSingleImageZoomability();
        renderTimerUI();
        renderMemoryCountdownUI();
        persistActiveMatch();

        if (window.SeenJeemAudio) {
          window.SeenJeemAudio.playTick(false);
        }

        state.memoryInterval = setInterval(() => {
          state.memoryRemaining = Math.max(0, state.memoryRemaining - 1);
          renderMemoryCountdownUI();

          if (state.memoryRemaining > 0 && state.memoryRemaining <= 3) {
            if (window.SeenJeemAudio) {
              window.SeenJeemAudio.playTick(true);
            }
          }

          if (state.memoryRemaining === 0) {
            finishMemoryViewingPhase();
          }
        }, 1000);
      },
      onError: () => {
        stopMemoryInterval();
        renderTimerUI();
      }
    });
  }

  function renderMemoryCountdownUI() {
    dom.memorySecondsDisplay.textContent = String(state.memoryRemaining);
    const pct = state.memoryTotal > 0 ? (state.memoryRemaining / state.memoryTotal) * 100 : 0;
    dom.memoryProgressBar.style.width = `${pct}%`;
    if (state.dualScreen.connected) {
      broadcastLiveDisplayState();
    }
  }

  /** المرحلة الثالثة لنوع memory: إخفاء الصورة وإظهار السؤال وبدء مؤقت الـ 60 ثانية */
  function finishMemoryViewingPhase() {
    if (!state.currentQ || (state.memoryPhase !== "viewing" && state.memoryPhase !== "loading")) {
      return;
    }
    stopMemoryInterval();
    state.questionImageRequestId++;
    state.memoryPhase = "question";

    if (dom.imageLightbox.classList.contains("open")) {
      closeLightbox();
    }

    dom.memoryCountdownPanel.hidden = true;
    dom.visualImageStage.classList.remove("visual-mode-memory-viewing", "is-loading", "has-error");
    if (dom.visualImageSkeleton) dom.visualImageSkeleton.hidden = true;
    if (dom.visualImageError) dom.visualImageError.hidden = true;
    dom.modalQuestionImageWrap.hidden = true;
    dom.modalQuestionImage.removeAttribute("src");
    dom.modalQuestionText.hidden = false;

    dom.btnRevealAnswer.disabled = false;
    if (dom.btnWrongAnswer) dom.btnWrongAnswer.disabled = false;
    dom.btnTimerReset.disabled = false;

    updateTacticalControlsUI();

    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playReveal();
    }

    startMainQuestionTimer();
    persistActiveMatch();
  }

  function reduceBlurLevel() {
    if (
      !state.currentQ ||
      state.currentQ.visualType !== "blur" ||
      state.currentQ.revealed ||
      state.currentQ.blurReduced
    ) {
      return;
    }
    state.currentQ.blurReduced = true;
    dom.visualImageStage.classList.add("blur-reduced");
    dom.btnReduceBlur.disabled = true;
    dom.btnReduceBlur.textContent = `✓ تم تخفيف التغبيش (${state.currentQ.halfBlur}px)`;
    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playTick(false);
    }
    renderHostCockpitUI();
    persistActiveMatch();
  }

  function reduceZoomLevel() {
    if (
      !state.currentQ ||
      state.currentQ.visualType !== "zoom" ||
      state.currentQ.revealed ||
      state.currentQ.zoomReduced
    ) {
      return;
    }
    state.currentQ.zoomReduced = true;
    dom.visualImageStage.classList.add("zoom-reduced");
    dom.btnReduceZoom.disabled = true;
    dom.btnReduceZoom.textContent = `✓ تم تخفيف الزوم (${state.currentQ.halfZoom}×)`;
    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playTick(false);
    }
    renderHostCockpitUI();
    persistActiveMatch();
  }

  function retryCurrentQuestionImage() {
    if (!state.currentQ) return;
    state.questionImageRetryCount++;
    if (state.currentQ.visualType === "memory" && state.memoryPhase === "loading") {
      startMemoryViewingPhase(true);
      return;
    }
    loadQuestionStageImage(state.currentQ.question.questionImage, {
      retryAttempt: state.questionImageRetryCount,
      loadingLabel: "جاري إعادة تحميل الصورة...",
      isMemory: false,
      onLoaded: () => {
        updateSingleImageZoomability();
      }
    });
  }

  /**
   * تهيئة وتحديث عرض السؤال الحالي (نصي / بصري / وضع من غير كلام) والمؤقت المرتبط به
   */
  function applyCurrentQuestionStage(restoredState = null) {
    if (!state.currentQ) return;
    const cq = state.currentQ;
    const slot = cq.slot;
    const q = cq.question;

    stopTimerInterval();
    resetVisualModalState();

    const rawVisualType =
      typeof q.visualType === "string" ? q.visualType.trim().toLowerCase() : "normal";
    const visualType = Object.prototype.hasOwnProperty.call(VISUAL_TYPE_META, rawVisualType)
      ? rawVisualType
      : "normal";

    const parsedBlur = Number(q.blurLevel);
    const blurLevel =
      Number.isFinite(parsedBlur) && parsedBlur > 0 ? parsedBlur : DEFAULT_BLUR_LEVEL;
    const halfBlur = Math.max(1, Math.round(blurLevel / 2));

    const parsedZoom = Number(q.zoomLevel);
    const zoomLevel =
      Number.isFinite(parsedZoom) && parsedZoom > 1 ? parsedZoom : DEFAULT_ZOOM_LEVEL;
    const halfZoom = Math.max(1.5, Math.round((zoomLevel / 2) * 10) / 10);

    const safeOriginRes = sanitizer.sanitizeZoomOrigin(q.zoomOrigin);
    const zoomOrigin = safeOriginRes.value || "center";

    cq.visualType = visualType;
    cq.blurLevel = blurLevel;
    cq.halfBlur = halfBlur;
    cq.zoomLevel = zoomLevel;
    cq.halfZoom = halfZoom;
    cq.zoomOrigin = zoomOrigin;
    cq.isCharades = isCharadesQuestion(cq.category, q);

    const ownerTeam = state.teams[cq.activeTeamAtOpen] || state.teams[0];
    dom.modalCategoryIcon.textContent = cq.category.icon || "🎯";
    dom.modalCategoryName.textContent = cq.category.name;

    if (cq.isCharades) {
      dom.modalVisualTypePill.textContent = "🎭 وضع التمثيل الصامت";
      dom.modalVisualTypePill.hidden = false;
    } else {
      const visualMeta = VISUAL_TYPE_META[visualType];
      if (visualMeta) {
        dom.modalVisualTypePill.textContent = `${visualMeta.icon} ${visualMeta.label}`;
        dom.modalVisualTypePill.hidden = false;
      }
    }

    const isMemoryWithImage =
      !cq.isCharades && visualType === "memory" && Boolean(normalizeAssetPath(q.questionImage));

    if (cq.isCharades) {
      // تفعيل واجهة CharadesQuestionView تلقائياً
      if (dom.questionBodyBox) dom.questionBodyBox.classList.add("is-charades-mode");
      dom.modalQuestionText.hidden = true;
      loadQuestionStageImage("");
      if (dom.charadesView) dom.charadesView.hidden = false;

      const parsedHeader = parseCharadesHeader(q.question, q.answer, cq.category.name);
      if (dom.charadesEyebrowText) dom.charadesEyebrowText.textContent = parsedHeader.eyebrow;
      if (dom.charadesTopicTitle) dom.charadesTopicTitle.textContent = parsedHeader.topic;
      if (dom.charadesWordCountPill) {
        dom.charadesWordCountPill.textContent = `🔢 عدد الكلمات: ${parsedHeader.wordCount}`;
      }
      hideCharadesSecret();
    } else {
      dom.modalQuestionText.textContent = q.question;

      if (visualType === "spot-diff") {
        loadQuestionStageImage("");
        const diffLabel = formatDifferencesBadge(q.differencesCount);
        if (diffLabel) {
          dom.spotDiffCountBadge.textContent = diffLabel;
          dom.spotDiffBadgeWrap.hidden = false;
        }
        renderSpotDiffGallery(q.images);
      } else if (visualType === "multi-image") {
        loadQuestionStageImage("");
        renderMultiImageConnectionGallery(q.images, Boolean(q.showPlus));
      } else if (!isMemoryWithImage) {
        dom.visualImageStage.classList.add("no-visual-transition");

        if (visualType === "blur") {
          dom.visualImageStage.style.setProperty("--blur-amount", `${blurLevel}px`);
          dom.visualImageStage.style.setProperty("--blur-half", `${halfBlur}px`);
          dom.visualImageStage.classList.add("visual-mode-blur");
          if (cq.blurReduced) {
            dom.visualImageStage.classList.add("blur-reduced");
            dom.btnReduceBlur.disabled = true;
            dom.btnReduceBlur.textContent = `✓ تم تخفيف التغبيش (${halfBlur}px)`;
          }
          dom.blurControlsWrap.hidden = false;
        } else if (visualType === "zoom") {
          dom.visualImageStage.style.setProperty("--zoom-amount", String(zoomLevel));
          dom.visualImageStage.style.setProperty("--zoom-half", String(halfZoom));
          dom.visualImageStage.classList.add("visual-mode-zoom");
          dom.modalQuestionImage.style.transformOrigin = zoomOrigin;
          if (cq.zoomReduced) {
            dom.visualImageStage.classList.add("zoom-reduced");
            dom.btnReduceZoom.disabled = true;
            dom.btnReduceZoom.textContent = `✓ تم تخفيف الزوم (${halfZoom}×)`;
          }
          dom.zoomControlsWrap.hidden = false;
        } else if (visualType === "invert") {
          dom.visualImageStage.classList.add("visual-mode-invert");
        } else if (visualType === "silhouette") {
          dom.visualImageStage.classList.add("visual-mode-silhouette");
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            dom.visualImageStage.classList.remove("no-visual-transition");
          });
        });

        if (q.questionImage) {
          loadQuestionStageImage(q.questionImage, {
            retryAttempt: 0,
            loadingLabel: "جاري تحميل صورة السؤال...",
            isMemory: false,
            onLoaded: () => {
              updateSingleImageZoomability();
            }
          });
        } else {
          loadQuestionStageImage("");
        }
      }
    }

    dom.answerSection.hidden = true;
    dom.btnCancelQuestion.hidden = false;
    loadAnswerStageImage("");

    if (dom.btnRevealAnswerLabel) {
      dom.btnRevealAnswerLabel.textContent = cq.isCharades
        ? "👁️ إظهار الإجابة للجميع"
        : "👁️ إظهار الإجابة";
    }
    if (dom.btnWrongAnswerLabel) {
      dom.btnWrongAnswerLabel.textContent = `❌ إجابة خاطئة (${ownerTeam.name})`;
    }

    if (restoredState && restoredState.revealed) {
      revealAnswer(true);
      return;
    }

    // ضبط المؤقت والمرحلة الحالية
    if (cq.phase === "steal-active") {
      const stealMax = state.matchSettings.stealTimerSeconds || 15;
      const rem =
        restoredState && Number.isFinite(Number(restoredState.timerRemaining))
          ? Math.max(0, Math.floor(Number(restoredState.timerRemaining)))
          : stealMax;
      state.timerMax = stealMax;
      state.timerRemaining = rem;
      state.timerMode = rem > 0 ? "steal" : "ended";
      const shouldRun =
        restoredState && restoredState.timerRunning !== undefined
          ? Boolean(restoredState.timerRunning) && rem > 0
          : rem > 0;
      if (shouldRun) {
        startTimer(rem, "steal");
      } else {
        state.timerRunning = false;
        renderTimerUI();
      }
      if (cq.stealPeekedAnswer) {
        populateAnswerCardContent(q, visualType);
        dom.answerSection.hidden = false;
      }
    } else if (cq.isCharades) {
      const dur = cq.charadesDuration || getDefaultCharadesSeconds(slot.points);
      cq.charadesDuration = dur;
      const rem =
        restoredState && Number.isFinite(Number(restoredState.timerRemaining))
          ? Math.max(0, Math.floor(Number(restoredState.timerRemaining)))
          : dur;
      state.timerMax = dur;
      state.timerRemaining = rem;
      state.timerMode = rem === 0 && cq.charadesTimerStarted ? "ended" : "charades";
      const shouldRun = Boolean(restoredState && restoredState.timerRunning && rem > 0);
      if (shouldRun) {
        cq.charadesTimerStarted = true;
        startTimer(rem, "charades");
      } else {
        state.timerRunning = false;
        renderTimerUI();
      }
    } else if (isMemoryWithImage) {
      if (restoredState && restoredState.memoryPhase === "question") {
        state.memoryPhase = "question";
        const configuredMain = getConfiguredMainTimerSeconds();
        if (restoredState.timerMode === "unlimited" || configuredMain === 0) {
          startMainQuestionTimer();
        } else {
          const rem =
            Number.isFinite(Number(restoredState.timerRemaining))
              ? Math.max(0, Math.floor(Number(restoredState.timerRemaining)))
              : configuredMain;
          if (rem > 0) {
            startTimer(rem, restoredState.timerMode || "main");
          } else {
            state.timerRemaining = 0;
            state.timerMax = configuredMain;
            state.timerMode = "ended";
            state.timerRunning = false;
            renderTimerUI();
          }
        }
      } else {
        prepareMemoryReadyPhase(q.memorySeconds || DEFAULT_MEMORY_SECONDS);
      }
    } else {
      const configuredMain = getConfiguredMainTimerSeconds();
      const restoredIsUnlimited =
        restoredState && restoredState.timerMode === "unlimited";
      const isUnlimitedMain =
        cq.phase !== "steal-active" && (restoredIsUnlimited || (!restoredState && configuredMain === 0));

      if (isUnlimitedMain) {
        startMainQuestionTimer();
      } else {
        const startSecs =
          restoredState && Number.isFinite(Number(restoredState.timerRemaining))
            ? Math.max(0, Math.floor(Number(restoredState.timerRemaining)))
            : configuredMain;
        const startMode =
          restoredState && typeof restoredState.timerMode === "string"
            ? restoredState.timerMode
            : "main";
        const shouldRun =
          restoredState && restoredState.timerRunning !== undefined
            ? Boolean(restoredState.timerRunning) && startSecs > 0
            : startSecs > 0 && cq.phase === "answering";

        if (shouldRun) {
          startTimer(startSecs, startMode);
        } else {
          state.timerRemaining = startSecs;
          state.timerMax = Math.max(startSecs, configuredMain || MAIN_TIMER_SECONDS);
          state.timerMode = startSecs === 0 ? "ended" : startMode;
          state.timerRunning = false;
          renderTimerUI();
        }
      }
    }

    closeFlagDrawer();
    renderQuestionFlagUI();
    updateQuestionPointsAndBanners();
    updateTacticalControlsUI();
    updateModalPhaseUI();
  }

  function openQuestionModal(catIdx, colKey, slotIdx, restoredOpenState = null) {
    clearClosingRevealTimer();
    const boardCat = state.boardCategories[catIdx];
    const slot = boardCat && boardCat[colKey] && boardCat[colKey][slotIdx];
    if (!slot || slot.played || !slot.question) return;

    // 1) حفظ اللقطة الأصلية قبل خصم بطاقة 2x أو أي تعديل داخل السؤال لصالح التراجع الدقيق (Undo Stack)
    state.preQuestionSnapshot =
      restoredOpenState && restoredOpenState.preQuestionSnapshot
        ? {
            teams: cloneTeamsState(restoredOpenState.preQuestionSnapshot.teams),
            activeTurn: normalizeTurnIndex(
              restoredOpenState.preQuestionSnapshot.activeTurn,
              state.teams.length
            ),
            doubleArmed: false,
            answeredThisRound: Number(restoredOpenState.preQuestionSnapshot.answeredThisRound) || 0,
            originalQuestion: restoredOpenState.preQuestionSnapshot.originalQuestion
              ? cloneQuestion(restoredOpenState.preQuestionSnapshot.originalQuestion)
              : cloneQuestion(slot.question),
            originalRecycled: Boolean(
              restoredOpenState.preQuestionSnapshot.originalRecycled !== undefined
                ? restoredOpenState.preQuestionSnapshot.originalRecycled
                : slot.recycled
            ),
            originalPreviouslyPlayed: Boolean(
              restoredOpenState.preQuestionSnapshot.originalPreviouslyPlayed !== undefined
                ? restoredOpenState.preQuestionSnapshot.originalPreviouslyPlayed
                : slot.previouslyPlayed
            )
          }
        : {
            teams: cloneTeamsState(),
            activeTurn: state.activeTurn,
            doubleArmed: false,
            answeredThisRound: state.answeredThisRound,
            originalQuestion: cloneQuestion(slot.question),
            originalRecycled: Boolean(slot.recycled),
            originalPreviouslyPlayed: Boolean(slot.previouslyPlayed)
          };

    const activeTeamAtOpen =
      restoredOpenState && Number.isInteger(restoredOpenState.activeTeamAtOpen)
        ? normalizeTurnIndex(restoredOpenState.activeTeamAtOpen, state.teams.length)
        : state.activeTurn;

    const ownerTeam = state.teams[activeTeamAtOpen];
    let doubleActive = false;

    if (restoredOpenState) {
      doubleActive = Boolean(
        restoredOpenState.doubleActive ||
          (Array.isArray(restoredOpenState.usedLifelinesHere) &&
            restoredOpenState.usedLifelinesHere.includes("double"))
      );
    } else if (state.doubleArmed && ownerTeam && ownerTeam.powerups && ownerTeam.powerups.doubleLeft > 0) {
      // قاعدة التفعيل العادلة: خصم بطاقة 2x تلقائياً فور فتح السؤال
      ownerTeam.powerups.doubleLeft = Math.max(0, ownerTeam.powerups.doubleLeft - 1);
      ownerTeam.lifelines.double = ownerTeam.powerups.doubleLeft === 0;
      state.doubleArmed = false;
      doubleActive = true;
      renderScoreboard();
      updateUndoButtonUI();
    }

    const isCharades = isCharadesQuestion(boardCat.category, slot.question);
    const defaultCharadesDur = getDefaultCharadesSeconds(slot.question.points);

    state.currentQ = {
      catIdx,
      colKey,
      slotIdx,
      slot,
      category: boardCat.category,
      question: slot.question,
      visualType: "normal",
      isCharades,
      charadesDuration:
        restoredOpenState && Number(restoredOpenState.charadesDuration)
          ? Number(restoredOpenState.charadesDuration)
          : defaultCharadesDur,
      charadesTimerStarted: Boolean(restoredOpenState && restoredOpenState.charadesTimerStarted),
      blurLevel: DEFAULT_BLUR_LEVEL,
      halfBlur: Math.round(DEFAULT_BLUR_LEVEL / 2),
      blurReduced: Boolean(restoredOpenState && restoredOpenState.blurReduced),
      zoomLevel: DEFAULT_ZOOM_LEVEL,
      halfZoom: 2,
      zoomOrigin: "center",
      zoomReduced: Boolean(restoredOpenState && restoredOpenState.zoomReduced),
      doubleActive,
      hintUsed: Boolean(
        restoredOpenState && (restoredOpenState.hintUsed || restoredOpenState.hintShown)
      ),
      swappedOutIds:
        restoredOpenState && Array.isArray(restoredOpenState.swappedOutIds)
          ? restoredOpenState.swappedOutIds.slice()
          : [],
      activeTeamAtOpen,
      phase:
        restoredOpenState && typeof restoredOpenState.phase === "string"
          ? restoredOpenState.phase
          : "answering",
      stealConsumed: Boolean(restoredOpenState && restoredOpenState.stealConsumed),
      stealingTeamIdx:
        restoredOpenState && Number.isInteger(restoredOpenState.stealingTeamIdx)
          ? normalizeTurnIndex(restoredOpenState.stealingTeamIdx, state.teams.length)
          : getDefaultStealingTeamIndex(activeTeamAtOpen),
      stealPeekedAnswer: Boolean(restoredOpenState && restoredOpenState.stealPeekedAnswer),
      preStealSnapshot:
        restoredOpenState && restoredOpenState.preStealSnapshot
          ? restoredOpenState.preStealSnapshot
          : null,
      inModalSnapshots:
        restoredOpenState && Array.isArray(restoredOpenState.inModalSnapshots)
          ? restoredOpenState.inModalSnapshots.slice()
          : [],
      revealed: false
    };

    openModal(dom.questionModal);
    applyCurrentQuestionStage(restoredOpenState);
    persistActiveMatch();

    if (!restoredOpenState && window.SeenJeemAudio) {
      window.SeenJeemAudio.playTileOpen();
    }
  }

  function updateQuestionPointsAndBanners() {
    if (!state.currentQ) return;
    const cq = state.currentQ;
    const basePoints = Number(cq.question.points) || 200;
    const discountedBase = computeDiscountedBasePoints(cq);
    const effectivePoints = computeEffectiveQuestionPoints(cq);
    const stealPoints = computeStealQuestionPoints(cq);
    const hintPenalty = state.matchSettings.hintEnabled ? Number(state.matchSettings.hintPenalty) || 0 : 0;
    const hasHintDiscount = Boolean(cq.hintUsed && hintPenalty > 0);

    dom.modalPointsPill.classList.remove(
      "pts-200",
      "pts-400",
      "pts-600",
      "doubled",
      "discounted",
      "steal-pill"
    );
    if (basePoints >= 600) {
      dom.modalPointsPill.classList.add("pts-600");
    } else if (basePoints >= 400) {
      dom.modalPointsPill.classList.add("pts-400");
    } else {
      dom.modalPointsPill.classList.add("pts-200");
    }

    if (cq.phase === "steal-active") {
      dom.modalPointsPill.classList.add("steal-pill");
      dom.modalPointsPill.innerHTML = `<span>🔥 سرقة: +${stealPoints} نقطة</span>`;
    } else if (cq.doubleActive && hasHintDiscount) {
      dom.modalPointsPill.classList.add("doubled", "discounted");
      dom.modalPointsPill.innerHTML = `<span class="pts-strike">${basePoints}</span><span>→</span><span class="pts-strike">${discountedBase}</span><span>→</span><strong>${effectivePoints} نقطة ⚡2x</strong>`;
    } else if (cq.doubleActive) {
      dom.modalPointsPill.classList.add("doubled");
      dom.modalPointsPill.innerHTML = `<span class="pts-strike">${basePoints}</span><span>→</span><strong>${effectivePoints} نقطة ⚡2x</strong>`;
    } else if (hasHintDiscount) {
      dom.modalPointsPill.classList.add("discounted");
      dom.modalPointsPill.innerHTML = `<span class="pts-strike">${basePoints}</span><strong>${effectivePoints} نقطة</strong>`;
    } else {
      dom.modalPointsPill.textContent = `${basePoints} نقطة`;
    }

    const banners = [];
    if (cq.doubleActive) {
      if (cq.phase === "steal-active") {
        banners.push(
          `<div class="active-lifeline-banner banner-double">⚡ مضاعفة 2x كانت لصاحب الدور فقط (لا تنتقل في السرقة)</div>`
        );
      } else {
        const progression = hasHintDiscount
          ? `${basePoints} → ${discountedBase} → ${effectivePoints}`
          : `${basePoints} → ${effectivePoints}`;
        banners.push(
          `<div class="active-lifeline-banner banner-double">⚡ مضاعفة 2x نشطة (${progression} نقطة)</div>`
        );
      }
    }
    if (cq.hintUsed) {
      const pct = Math.round(hintPenalty * 100);
      banners.push(
        `<div class="active-lifeline-banner banner-hint-discount">💡 تلميح مُفعّل (${
          pct > 0 ? `خصم ${pct}%` : "مجاني"
        })</div>`
      );
    }

    if (banners.length > 0) {
      dom.activeLifelinesBanners.innerHTML = banners.join("");
      dom.activeLifelinesBanners.hidden = false;
    } else {
      dom.activeLifelinesBanners.innerHTML = "";
      dom.activeLifelinesBanners.hidden = true;
    }
  }

  function updateTacticalControlsUI() {
    if (!state.currentQ) return;
    const cq = state.currentQ;
    const q = cq.question;
    const ownerTeam = state.teams[cq.activeTeamAtOpen];
    const memoryLocked = isMemoryLockedPhase();
    const isAnswering = !cq.revealed && cq.phase === "answering" && !memoryLocked;

    // 1) زر التلميح وبطاقته (يعرض hint فقط ولا يكشف explanation أبداً!)
    const hintText = typeof q.hint === "string" ? q.hint.trim() : "";
    const hasHint = hintText.length > 0;

    if (hasHint && (state.matchSettings.hintEnabled || cq.hintUsed) && !memoryLocked) {
      dom.questionHintWrap.hidden = false;
      const penaltyPct = Math.round((Number(state.matchSettings.hintPenalty) || 0) * 100);
      if (cq.hintUsed) {
        dom.btnShowHint.disabled = true;
        if (dom.btnShowHintText) {
          dom.btnShowHintText.textContent =
            penaltyPct > 0 ? `✓ تم كشف التلميح (-${penaltyPct}%)` : "✓ تم كشف التلميح";
        }
        dom.questionHintBox.textContent = `💡 التلميح: ${hintText}`;
        dom.questionHintBox.hidden = false;
      } else {
        dom.btnShowHint.disabled = !isAnswering;
        if (dom.btnShowHintText) {
          dom.btnShowHintText.textContent =
            penaltyPct > 0 ? `💡 كشف التلميح (-${penaltyPct}%)` : "💡 كشف التلميح (مجاني)";
        }
        dom.questionHintBox.hidden = true;
        dom.questionHintBox.textContent = "";
      }
    } else {
      dom.questionHintWrap.hidden = true;
      dom.questionHintBox.hidden = true;
      dom.questionHintBox.textContent = "";
    }

    // 2) زر تبديل السؤال (Swap Question)
    if (dom.questionSwapWrap && dom.btnSwapQuestion && dom.btnSwapQuestionText) {
      const swapEnabled = state.matchSettings.swapEnabled;
      const swapLeft = ownerTeam && ownerTeam.powerups ? ownerTeam.powerups.swapLeft : 0;

      if (!swapEnabled || cq.revealed || cq.phase !== "answering") {
        dom.questionSwapWrap.hidden = true;
      } else {
        dom.questionSwapWrap.hidden = false;
        const candidates = getAvailableSwapCandidates(cq);
        const hasAlternatives = candidates.length > 0;

        if (swapLeft <= 0) {
          dom.btnSwapQuestion.disabled = true;
          dom.btnSwapQuestionText.textContent = "🔄 تبديل السؤال (0 متبقي)";
          if (dom.swapUnavailableNote) dom.swapUnavailableNote.hidden = true;
        } else if (!hasAlternatives) {
          dom.btnSwapQuestion.disabled = true;
          dom.btnSwapQuestionText.textContent = `🔄 تبديل السؤال (متبقي ${swapLeft})`;
          if (dom.swapUnavailableNote) {
            dom.swapUnavailableNote.textContent = "لا توجد أسئلة بديلة متاحة";
            dom.swapUnavailableNote.hidden = false;
          }
        } else {
          dom.btnSwapQuestion.disabled = memoryLocked;
          dom.btnSwapQuestionText.textContent = `🔄 تبديل السؤال (متبقي ${swapLeft})`;
          if (dom.swapUnavailableNote) dom.swapUnavailableNote.hidden = true;
        }
      }
    }

    if (dom.questionTacticalBar) {
      const nothingToShow =
        dom.questionHintWrap.hidden &&
        (!dom.questionSwapWrap || dom.questionSwapWrap.hidden) &&
        dom.questionHintBox.hidden;
      dom.questionTacticalBar.hidden = nothingToShow;
    }
  }

  function updateModalPhaseUI() {
    if (!state.currentQ) return;
    const cq = state.currentQ;
    const ownerTeam = state.teams[cq.activeTeamAtOpen] || state.teams[0];
    const stealingTeam = state.teams[cq.stealingTeamIdx] || state.teams[1] || state.teams[0];
    const stealPoints = computeStealQuestionPoints(cq);

    // ترويسة الدور وشريط السرقة العلوي
    dom.modalTurnBadge.classList.remove("team-1-turn", "team-2-turn", "steal-turn-0", "steal-turn-1");
    if (cq.phase === "steal-active") {
      const stealAccent = cq.stealingTeamIdx === 0 ? "steal-turn-0" : "steal-turn-1";
      dom.modalTurnBadge.classList.add(stealAccent);
      dom.modalTurnBadge.innerHTML = `🔥 فرصة سرقة لـ <strong id="modal-active-team-name">${escapeHtml(
        stealingTeam.name
      )}</strong>`;

      if (dom.stealStatusBanner) {
        dom.stealStatusBanner.hidden = false;
        dom.stealStatusBanner.className = `steal-status-banner ${
          cq.stealingTeamIdx === 0 ? "steal-team-0" : "steal-team-1"
        }`;
      }
      if (dom.stealBannerText) {
        dom.stealBannerText.textContent = `فرصة سرقة لـ ${stealingTeam.name}`;
      }
      if (dom.stealBannerPtsBadge) {
        dom.stealBannerPtsBadge.textContent = `+${stealPoints} نقطة`;
      }

      // في حال وجود 3 فرق أو أكثر: عرض أزرار سريعة لاختيار الفريق السارق
      if (dom.stealTeamSelector) {
        if (state.teams.length >= 3) {
          dom.stealTeamSelector.innerHTML = "";
          state.teams.forEach((t, idx) => {
            if (idx === cq.activeTeamAtOpen) return;
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = `steal-team-pill${idx === cq.stealingTeamIdx ? " active" : ""}`;
            pill.textContent = t.name;
            pill.addEventListener("click", () => {
              cq.stealingTeamIdx = idx;
              updateModalPhaseUI();
              persistActiveMatch();
            });
            dom.stealTeamSelector.appendChild(pill);
          });
          dom.stealTeamSelector.hidden = false;
        } else {
          dom.stealTeamSelector.hidden = true;
          dom.stealTeamSelector.innerHTML = "";
        }
      }
    } else {
      dom.modalTurnBadge.classList.add(cq.activeTeamAtOpen === 0 ? "team-1-turn" : "team-2-turn");
      dom.modalTurnBadge.innerHTML = `دور: <strong id="modal-active-team-name">${escapeHtml(
        ownerTeam.name
      )}</strong>`;
      if (dom.stealStatusBanner) {
        dom.stealStatusBanner.hidden = true;
      }
    }

    if (cq.isCharades) {
      const inSteal = cq.phase === "steal-active";
      const isHostDual = state.dualScreen.connected;
      if (dom.timerSection) dom.timerSection.hidden = !inSteal;
      if (dom.charadesTimerBox) dom.charadesTimerBox.hidden = inSteal || cq.revealed;
      if (dom.charadesActorStage) dom.charadesActorStage.hidden = cq.revealed || isHostDual;
      if (dom.btnHoldRevealSecret) dom.btnHoldRevealSecret.hidden = inSteal || cq.revealed || isHostDual;
    } else {
      if (dom.timerSection) dom.timerSection.hidden = false;
    }

    // تحديث تسمية زر كشف الإجابة عند اتصال شاشة التلفزيون
    if (dom.btnRevealAnswerLabel) {
      if (state.dualScreen.connected) {
        dom.btnRevealAnswerLabel.textContent = "📺 إظهار الإجابة على التلفزيون";
      } else {
        dom.btnRevealAnswerLabel.textContent = cq.isCharades
          ? "👁️ إظهار الإجابة للجميع"
          : "👁️ إظهار الإجابة";
      }
    }

    // أزرار التذييل السفلي حسب المرحلة
    if (dom.preRevealActions) dom.preRevealActions.hidden = true;
    if (dom.stealOfferActions) dom.stealOfferActions.hidden = true;
    if (dom.stealActiveActions) dom.stealActiveActions.hidden = true;
    if (dom.closingRevealActions) dom.closingRevealActions.hidden = true;
    if (dom.postRevealActions) dom.postRevealActions.hidden = true;

    if (cq.revealed) {
      if (dom.postRevealActions) dom.postRevealActions.hidden = false;
    } else if (cq.phase === "steal-offer") {
      if (dom.stealOfferPrompt) {
        dom.stealOfferPrompt.textContent = `❌ إجابة غير صحيحة من ${ownerTeam.name} — اختر الإجراء التالي:`;
      }
      if (dom.btnOpenStealLabel) {
        dom.btnOpenStealLabel.textContent = `🔥 فتح فرصة السرقة (+${stealPoints} نقطة)`;
      }
      if (dom.stealOfferActions) dom.stealOfferActions.hidden = false;
    } else if (cq.phase === "steal-active") {
      if (dom.stealActivePrompt) {
        dom.stealActivePrompt.textContent = `🔥 حسم فرصة السرقة لـ ${stealingTeam.name} (بدون مضاعفة 2x):`;
      }
      if (dom.btnStealSuccessLabel) {
        dom.btnStealSuccessLabel.textContent = `✅ نجحت السرقة (+${stealPoints} نقطة)`;
      }
      if (dom.btnStealPeekAnswer) {
        dom.btnStealPeekAnswer.hidden = Boolean(cq.stealPeekedAnswer);
      }
      if (dom.stealActiveActions) dom.stealActiveActions.hidden = false;
    } else {
      if (dom.preRevealActions) dom.preRevealActions.hidden = false;
    }

    renderHostCockpitUI();
    renderTimerUI();
    if (state.dualScreen.connected) {
      broadcastLiveDisplayState();
    }
  }

  function handleWrongAnswerClick() {
    if (!state.currentQ || state.currentQ.revealed || isMemoryLockedPhase()) return;
    if (state.currentQ.phase !== "answering") return;

    hideCharadesSecret();
    pauseTimer();

    if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playWrongAnswer === "function") {
      window.SeenJeemAudio.playWrongAnswer();
    }

    if (state.matchSettings.stealEnabled && !state.currentQ.stealConsumed) {
      state.currentQ.phase = "steal-offer";
      updateQuestionPointsAndBanners();
      updateTacticalControlsUI();
      updateModalPhaseUI();
      persistActiveMatch();
    } else {
      closeWithoutPointsAndReveal();
    }
  }

  function cancelStealOffer() {
    if (!state.currentQ || state.currentQ.phase !== "steal-offer") return;
    state.currentQ.phase = "answering";
    updateQuestionPointsAndBanners();
    updateTacticalControlsUI();
    updateModalPhaseUI();
    persistActiveMatch();
  }

  function openStealPhase() {
    if (!state.currentQ || state.currentQ.revealed || isMemoryLockedPhase()) return;
    if (!state.matchSettings.stealEnabled || state.currentQ.stealConsumed) return;
    if (state.currentQ.phase !== "steal-offer" && state.currentQ.phase !== "answering") return;

    hideCharadesSecret();
    const cq = state.currentQ;

    // حفظ Snapshot قبل السرقة لصالح التراجع واستئناف الحالة
    const preStealSnap = captureInModalSnapshot("steal");
    cq.preStealSnapshot = preStealSnap;
    cq.inModalSnapshots.push(preStealSnap);

    cq.phase = "steal-active";
    cq.stealConsumed = true;
    cq.stealingTeamIdx = getDefaultStealingTeamIndex(cq.activeTeamAtOpen);

    const stealSecs = state.matchSettings.stealTimerSeconds || 15;
    startTimer(stealSecs, "steal");

    if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playStealAlert === "function") {
      window.SeenJeemAudio.playStealAlert();
    }

    updateQuestionPointsAndBanners();
    updateTacticalControlsUI();
    updateModalPhaseUI();
    persistActiveMatch();

    const stealingTeam = state.teams[cq.stealingTeamIdx];
    const stealPts = computeStealQuestionPoints(cq);
    if (stealingTeam) {
      showToast(`🔥 فرصة سرقة لـ ${stealingTeam.name} (+${stealPts} نقطة — ${stealSecs} ثانية)!`, "warning");
    }
  }

  function peekAnswerDuringSteal() {
    if (!state.currentQ || state.currentQ.phase !== "steal-active") return;
    pauseTimer();
    state.currentQ.stealPeekedAnswer = true;
    populateAnswerCardContent(state.currentQ.question, state.currentQ.visualType);
    dom.answerSection.hidden = false;
    if (dom.btnStealPeekAnswer) dom.btnStealPeekAnswer.hidden = true;
    if (window.SeenJeemAudio) window.SeenJeemAudio.playReveal();
    renderHostCockpitUI();
    persistActiveMatch();
    dom.answerSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function populateAnswerCardContent(q, vType) {
    if (MASKED_VISUAL_TYPES.has(vType)) {
      dom.visualImageStage.classList.remove("no-visual-transition");
      if (vType === "zoom" && state.currentQ) {
        dom.modalQuestionImage.style.transformOrigin = state.currentQ.zoomOrigin || "center";
      }
      dom.visualImageStage.classList.add("visual-revealed");
      if (vType === "blur") {
        dom.btnReduceBlur.disabled = true;
        dom.btnReduceBlur.textContent = "✓ تم كشف الصورة الأصلية";
      } else {
        dom.blurControlsWrap.hidden = true;
      }
      if (vType === "zoom") {
        dom.btnReduceZoom.disabled = true;
        dom.btnReduceZoom.textContent = "✓ تم كشف الصورة الكاملة";
      } else {
        dom.zoomControlsWrap.hidden = true;
      }
      updateSingleImageZoomability();
    } else if (vType === "memory") {
      dom.memoryCountdownPanel.hidden = true;
      dom.modalQuestionText.hidden = false;
      dom.modalQuestionImageWrap.hidden = true;
    }

    dom.modalAnswerText.textContent = q.answer;
    const explanationText = typeof q.explanation === "string" ? q.explanation.trim() : "";
    if (explanationText) {
      const prefix =
        state.currentQ && state.currentQ.isCharades ? "🎬 فكرة التمثيل" : "📌 التوضيح";
      dom.modalAnswerExplanation.textContent = `${prefix}: ${explanationText}`;
      dom.modalAnswerExplanation.hidden = false;
    } else {
      dom.modalAnswerExplanation.textContent = "";
      dom.modalAnswerExplanation.hidden = true;
    }

    const answerImgSrc =
      q.answerImage && q.answerImage.trim()
        ? q.answerImage
        : vType === "memory" && q.questionImage && q.questionImage.trim()
          ? q.questionImage
          : "";
    loadAnswerStageImage(answerImgSrc, 0);
  }

  function commitQuestionResolution({
    winnerTeamIndex,
    awardedPoints,
    actionType,
    undoLabel,
    showBriefAnswerPreview = false
  }) {
    if (!state.currentQ) return;

    stopTimerInterval();
    stopMemoryInterval();
    hideCharadesSecret();
    state.timerRunning = false;
    state.memoryPhase = null;

    const cq = state.currentQ;
    const baseSnap = state.preQuestionSnapshot || {
      teams: cloneTeamsState(),
      activeTurn: state.activeTurn,
      doubleArmed: false,
      answeredThisRound: state.answeredThisRound,
      originalQuestion: cloneQuestion(cq.question),
      originalRecycled: Boolean(cq.slot.recycled),
      originalPreviouslyPlayed: Boolean(cq.slot.previouslyPlayed)
    };
    const questionHistorySnapshot = historyStore.captureQuestionSnapshot(cq.question.id);

    matchStore.pushUndoSnapshot(
      {
        actionType,
        label: undoLabel,
        teams: baseSnap.teams,
        activeTurn: baseSnap.activeTurn,
        doubleArmed: Boolean(baseSnap.doubleArmed),
        answeredThisRound: baseSnap.answeredThisRound,
        matchEvents: cloneMatchEvents(),
        cellState: {
          catIdx: cq.catIdx,
          colKey: cq.colKey,
          slotIdx: cq.slotIdx,
          played: false,
          winnerTeam: null,
          question: baseSnap.originalQuestion ? cloneQuestion(baseSnap.originalQuestion) : cloneQuestion(cq.question),
          recycled: Boolean(baseSnap.originalRecycled),
          previouslyPlayed: Boolean(baseSnap.originalPreviouslyPlayed)
        },
        questionHistorySnapshot
      },
      state.matchSettings
    );

    const hasValidWinner =
      Number.isInteger(winnerTeamIndex) &&
      winnerTeamIndex >= 0 &&
      winnerTeamIndex < state.teams.length;

    if (hasValidWinner && awardedPoints > 0) {
      state.teams[winnerTeamIndex].score += awardedPoints;
    }

    // تسجيل الحدث في سجل إحصائيات المباراة (MatchEvent[])
    const askingTeam = state.teams[cq.activeTeamAtOpen] || state.teams[0];
    const awardedTeam = hasValidWinner ? state.teams[winnerTeamIndex] : null;
    const isStealWin = actionType === "steal-win" || (hasValidWinner && winnerTeamIndex !== cq.activeTeamAtOpen && cq.stealConsumed);
    const eventRecord = matchStore.sanitizeMatchEvent({
      questionId: cq.question.id,
      categoryId: cq.category.id,
      categoryName: cq.category.name,
      questionText: cq.question.question,
      answerText: cq.question.answer,
      explanation: cq.question.explanation || undefined,
      basePoints: Number(cq.question.points) || 200,
      effectivePoints: hasValidWinner ? awardedPoints : 0,
      askingTeamId: askingTeam ? askingTeam.id : `team-${cq.activeTeamAtOpen}`,
      awardedTeamId: awardedTeam ? awardedTeam.id : null,
      wasSteal: Boolean(isStealWin),
      wasDouble: Boolean(cq.doubleActive),
      hintUsed: Boolean(cq.hintUsed),
      wasSwapped: Boolean(Array.isArray(cq.swappedOutIds) && cq.swappedOutIds.length > 0),
      timestamp: Date.now()
    });
    if (eventRecord) {
      state.matchEvents.push(eventRecord);
    }

    // تسجيل السؤال النهائي في الخلية كـ «ملعوب» (الأسئلة المستبدلة عبر Swap لم تُسجَّل مطلقاً)
    cq.slot.played = true;
    cq.slot.winnerTeam = hasValidWinner ? winnerTeamIndex : null;
    historyStore.markQuestionPlayed(cq.question.id, Date.now());
    state.answeredThisRound++;

    // عودة الدور دائماً للترتيب الطبيعي بعد الفريق صاحب الدور الأصلي دون أي خلل بعد السرقة
    state.activeTurn = (cq.activeTeamAtOpen + 1) % state.teams.length;
    state.doubleArmed = false;

    const answerWasHidden = dom.answerSection.hidden;
    if (showBriefAnswerPreview && answerWasHidden) {
      // حفظ لقطة مؤقتة مكشوفة لعرض الإجابة على شاشة التلفزيون خلال نافذة المعاينة الختامية
      state.dualScreen.closingPreviewQuestion = buildDisplayQuestionPayload(cq, true);
      populateAnswerCardContent(cq.question, cq.visualType);
      dom.answerSection.hidden = false;
      if (dom.charadesActorStage) dom.charadesActorStage.hidden = true;
      if (dom.charadesTimerBox) dom.charadesTimerBox.hidden = true;
      if (dom.questionTacticalBar) dom.questionTacticalBar.hidden = true;
      if (dom.btnCancelQuestion) dom.btnCancelQuestion.hidden = true;
      if (dom.preRevealActions) dom.preRevealActions.hidden = true;
      if (dom.stealOfferActions) dom.stealOfferActions.hidden = true;
      if (dom.stealActiveActions) dom.stealActiveActions.hidden = true;
      if (dom.postRevealActions) dom.postRevealActions.hidden = true;
      if (dom.closingRevealActions) dom.closingRevealActions.hidden = false;
      dom.answerSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      state.dualScreen.closingPreviewQuestion = null;
    }

    state.currentQ = null;
    state.preQuestionSnapshot = null;

    renderScoreboard();
    renderGameBoard();
    updateUndoButtonUI();

    const noQuestionsLeft = countRemainingPlayableQuestions() === 0;
    if (noQuestionsLeft) {
      matchStore.clearSavedMatch();
      broadcastLiveDisplayState();
    } else {
      persistActiveMatch();
    }

    if (showBriefAnswerPreview && answerWasHidden) {
      clearClosingRevealTimer();
      state.closingRevealTimeout = setTimeout(() => {
        finishClosingRevealImmediately();
      }, CLOSING_REVEAL_DELAY_MS);
    } else {
      closeLightbox();
      resetVisualModalState();
      closeModal(dom.questionModal);
      if (noQuestionsLeft) {
        setTimeout(() => openWinnerModal(false), 380);
      }
    }
  }

  function closeWithoutPointsAndReveal() {
    if (!state.currentQ) return;
    const cq = state.currentQ;
    const ans = cq.question.answer;

    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playNoScore();
    }

    commitQuestionResolution({
      winnerTeamIndex: null,
      awardedPoints: 0,
      actionType: "no-score",
      undoLabel: `إغلاق سؤال (${cq.question.points}) بدون نقاط`,
      showBriefAnswerPreview: true
    });

    showToast(`أُغلق السؤال دون نقاط — الإجابة الصحيحة: ${ans}`, "info");
  }

  function resolveSteal(didSucceed) {
    if (!state.currentQ || state.currentQ.phase !== "steal-active") return;
    const cq = state.currentQ;
    const stealingIdx = cq.stealingTeamIdx;
    const stealingTeam = state.teams[stealingIdx];
    const stealPts = computeStealQuestionPoints(cq);
    const ans = cq.question.answer;

    if (didSucceed && stealingTeam) {
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playScore(true);
      }
      const stealTheme = stealingIdx === 0 ? "team1" : stealingIdx === 1 ? "team2" : "default";
      if (window.SeenJeemConfetti && dom.stealConfettiCanvas) {
        window.SeenJeemConfetti.startLightBurst(dom.stealConfettiCanvas, stealTheme);
      }
      if (liveSync && state.dualScreen.connected) {
        liveSync.broadcastConfetti("steal", stealTheme);
      }

      commitQuestionResolution({
        winnerTeamIndex: stealingIdx,
        awardedPoints: stealPts,
        actionType: "steal-win",
        undoLabel: `سرقة ناجحة (+${stealPts} نقطة) لـ ${stealingTeam.name}`,
        showBriefAnswerPreview: true
      });

      showToast(`🔥 نجحت السرقة! +${stealPts} نقطة لـ ${stealingTeam.name}`, "success");
    } else {
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playNoScore();
      }

      commitQuestionResolution({
        winnerTeamIndex: null,
        awardedPoints: 0,
        actionType: "steal-fail",
        undoLabel: `فشل محاولة السرقة (${cq.question.points})`,
        showBriefAnswerPreview: true
      });

      showToast(`فشلت السرقة — الإجابة الصحيحة: ${ans}`, "info");
    }
  }

  /* =========================================================
     المؤقت القياسي ومؤقت «من غير كلام» (Countdown Timers)
     ========================================================= */
  function getConfiguredMainTimerSeconds() {
    const raw =
      state.matchSettings && state.matchSettings.mainTimerSeconds !== undefined
        ? Number(state.matchSettings.mainTimerSeconds)
        : MAIN_TIMER_SECONDS;
    if (raw === 0) return 0;
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MAIN_TIMER_SECONDS;
  }

  function startMainQuestionTimer() {
    const secs = getConfiguredMainTimerSeconds();
    if (secs === 0) {
      stopTimerInterval();
      state.timerRemaining = 0;
      state.timerMax = 0;
      state.timerMode = "unlimited";
      state.timerRunning = false;
      renderTimerUI();
      if (state.dualScreen.connected) {
        broadcastLiveDisplayState();
      }
      return;
    }
    startTimer(secs, "main");
  }

  function stopTimerInterval() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  function startTimer(seconds, mode = "main") {
    stopTimerInterval();
    const cleanSecs = Math.max(0, Math.floor(Number(seconds) || 0));
    state.timerRemaining = cleanSecs;
    if (mode === "charades" && state.currentQ) {
      state.timerMax = Math.max(cleanSecs, state.currentQ.charadesDuration || 60);
    } else if (mode === "steal") {
      state.timerMax = Math.max(cleanSecs, state.matchSettings.stealTimerSeconds || 15);
    } else {
      state.timerMax = Math.max(cleanSecs, getConfiguredMainTimerSeconds() || MAIN_TIMER_SECONDS);
    }
    state.timerMode = cleanSecs > 0 ? mode : "ended";
    state.timerRunning = cleanSecs > 0;
    renderTimerUI();
    if (state.dualScreen.connected) {
      broadcastLiveDisplayState();
    }

    if (cleanSecs > 0) {
      state.timerInterval = setInterval(onTimerTick, 1000);
    }
  }

  function pauseTimer() {
    stopTimerInterval();
    state.timerRunning = false;
    renderTimerUI();
    if (state.dualScreen.connected) {
      broadcastLiveDisplayState();
    }
  }

  function resumeTimer() {
    if (state.timerRemaining <= 0) return;
    stopTimerInterval();
    state.timerRunning = true;
    if (state.timerMode === "ended") {
      state.timerMode =
        state.currentQ && state.currentQ.isCharades && state.currentQ.phase !== "steal-active"
          ? "charades"
          : "main";
    }
    renderTimerUI();
    if (state.dualScreen.connected) {
      broadcastLiveDisplayState();
    }
    state.timerInterval = setInterval(onTimerTick, 1000);
  }

  function toggleTimer() {
    if (!state.currentQ || state.currentQ.revealed || isMemoryLockedPhase()) return;
    if (state.currentQ.isCharades && state.currentQ.phase !== "steal-active") {
      toggleCharadesTimer();
      return;
    }
    if (state.timerRunning) {
      pauseTimer();
    } else if (state.timerRemaining > 0) {
      resumeTimer();
    }
    persistActiveMatch();
  }

  function setCharadesDuration(seconds) {
    if (!state.currentQ || !state.currentQ.isCharades || state.currentQ.revealed) return;
    if (state.currentQ.phase === "steal-active") return;
    if (state.currentQ.charadesTimerStarted || state.timerRunning) return;

    const validSecs = [60, 90, 120].includes(Number(seconds)) ? Number(seconds) : 60;
    state.currentQ.charadesDuration = validSecs;
    state.timerRemaining = validSecs;
    state.timerMax = validSecs;
    state.timerMode = "charades";
    renderTimerUI();
    persistActiveMatch();
  }

  function toggleCharadesTimer() {
    if (!state.currentQ || !state.currentQ.isCharades || state.currentQ.revealed) return;
    if (state.currentQ.phase === "steal-active") return;

    if (state.timerRunning) {
      pauseTimer();
    } else if (state.timerRemaining > 0) {
      state.currentQ.charadesTimerStarted = true;
      state.timerMode = "charades";
      resumeTimer();
    }
    persistActiveMatch();
  }

  function resetCharadesTimer() {
    if (!state.currentQ || !state.currentQ.isCharades || state.currentQ.revealed) return;
    if (state.currentQ.phase === "steal-active") return;

    stopTimerInterval();
    state.timerRunning = false;
    state.currentQ.charadesTimerStarted = false;
    const dur = state.currentQ.charadesDuration || getDefaultCharadesSeconds(state.currentQ.question.points);
    state.timerRemaining = dur;
    state.timerMax = dur;
    state.timerMode = "charades";
    renderTimerUI();
    persistActiveMatch();
  }

  function onTimerTick() {
    if (!state.timerRunning) return;
    state.timerRemaining = Math.max(0, state.timerRemaining - 1);

    const isCharadesRound =
      Boolean(state.currentQ && state.currentQ.isCharades) && state.timerMode === "charades";

    if (isCharadesRound) {
      // آخر 10 ثوانٍ في «من غير كلام»: تكتكة متسارعة عبر Web Audio API
      if (state.timerRemaining > 0 && state.timerRemaining <= 10) {
        if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playCharadesUrgentTick === "function") {
          window.SeenJeemAudio.playCharadesUrgentTick(state.timerRemaining);
        }
      }
    } else if (state.timerRemaining > 0 && state.timerRemaining <= 5) {
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playTick(state.timerRemaining <= 3);
      }
    }

    if (state.timerRemaining === 0) {
      stopTimerInterval();
      state.timerRunning = false;
      state.timerMode = "ended";
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playTimeUp();
      }
    }

    renderTimerUI();
    if (state.dualScreen.connected) {
      broadcastLiveDisplayState();
    }
  }

  function renderTimerUI() {
    const isSteal = state.timerMode === "steal" || Boolean(state.currentQ && state.currentQ.phase === "steal-active");
    const isUnlimited = state.timerMode === "unlimited" && !isSteal;
    const formatted = isUnlimited ? "∞" : formatTime(state.timerRemaining);
    dom.timerDisplay.textContent = formatted;

    const pct = isUnlimited
      ? 100
      : state.timerMax > 0
        ? Math.min(100, (state.timerRemaining / state.timerMax) * 100)
        : 0;
    dom.timerProgressBar.style.width = `${pct}%`;

    const isDanger = !isUnlimited && state.timerRemaining <= 5 && state.timerMode !== "waiting-memory";
    const isWarning = !isUnlimited && !isDanger && !isSteal && state.timerRemaining <= 15 && state.timerMode !== "waiting-memory";

    if (dom.timerSection) {
      dom.timerSection.classList.toggle("steal-active", isSteal && !isDanger);
    }

    dom.timerDisplay.classList.toggle("danger", isDanger);
    dom.timerDisplay.classList.toggle("warning", isWarning);
    dom.timerDisplay.classList.toggle("steal", isSteal && !isDanger);
    dom.timerDisplay.classList.toggle("paused", !isUnlimited && !state.timerRunning && state.timerRemaining > 0);

    dom.timerProgressBar.classList.toggle("danger", isDanger);
    dom.timerProgressBar.classList.toggle("warning", isWarning);
    dom.timerProgressBar.classList.toggle("steal", isSteal && !isDanger);

    dom.timerModeLabel.classList.remove("steal-mode", "ended-mode");
    if (state.timerMode === "waiting-memory") {
      if (state.memoryPhase === "ready") {
        dom.timerModeLabel.textContent = "🧠 اضغط «ابدأ عرض الصورة» للبدء";
      } else if (state.memoryPhase === "loading") {
        dom.timerModeLabel.textContent = "⏳ بانتظار اكتمال تحميل الصورة قبل بدء العداد...";
      } else {
        dom.timerModeLabel.textContent = "👁️ جاري عرض الصورة للمعاينة...";
      }
    } else if (isUnlimited) {
      dom.timerModeLabel.textContent = "∞ بدون مؤقت زمني";
    } else if (state.timerMode === "ended" || state.timerRemaining === 0) {
      dom.timerModeLabel.textContent = "⏰ انتهى الوقت!";
      dom.timerModeLabel.classList.add("ended-mode");
    } else if (isSteal) {
      const stealTeam =
        state.currentQ && state.teams[state.currentQ.stealingTeamIdx]
          ? state.teams[state.currentQ.stealingTeamIdx].name
          : "الفريق المنافس";
      dom.timerModeLabel.textContent = state.timerRunning
        ? `🔥 مؤقت السرقة (${stealTeam})`
        : `🔥 مؤقت السرقة متوقف (${stealTeam})`;
      dom.timerModeLabel.classList.add("steal-mode");
    } else {
      dom.timerModeLabel.textContent = state.timerRunning
        ? "الوقت الأساسي جارٍ"
        : "المؤقت متوقف مؤقتاً";
    }

    if (state.timerRunning) {
      dom.timerToggleIcon.textContent = "⏸️";
      dom.timerToggleText.textContent = "إيقاف";
    } else {
      dom.timerToggleIcon.textContent = "▶️";
      dom.timerToggleText.textContent = "استئناف";
    }
    const timerLocked = isUnlimited || isMemoryLockedPhase() || Boolean(state.currentQ && state.currentQ.revealed);
    dom.btnTimerToggle.disabled = state.timerRemaining === 0 || timerLocked;
    dom.btnTimerReset.disabled = timerLocked;

    // تحديث مؤقت «من غير كلام» المدمج
    if (state.currentQ && state.currentQ.isCharades && dom.charadesTimerDisplay) {
      const cq = state.currentQ;
      dom.charadesTimerDisplay.textContent = formatted;
      if (dom.charadesTimerProgress) {
        dom.charadesTimerProgress.style.width = `${pct}%`;
      }

      const isCharadesDanger = state.timerRemaining > 0 && state.timerRemaining <= 10 && cq.charadesTimerStarted;
      const isCharadesEnded = state.timerRemaining === 0 && cq.charadesTimerStarted;

      if (dom.charadesTimerBox) {
        dom.charadesTimerBox.classList.toggle("is-danger", isCharadesDanger);
      }
      dom.charadesTimerDisplay.classList.toggle("is-danger", isCharadesDanger);
      dom.charadesTimerDisplay.classList.toggle("is-ended", isCharadesEnded);
      dom.charadesTimerDisplay.classList.toggle(
        "is-paused",
        !state.timerRunning && cq.charadesTimerStarted && state.timerRemaining > 0
      );
      if (dom.charadesTimerProgress) {
        dom.charadesTimerProgress.classList.toggle("is-danger", isCharadesDanger || isCharadesEnded);
      }

      if (dom.charadesTimerStatus) {
        if (isCharadesEnded) {
          dom.charadesTimerStatus.textContent = "🔔 انتهى وقت التمثيل!";
        } else if (isCharadesDanger) {
          dom.charadesTimerStatus.textContent = "🔥 آخر الثواني — أسرع بالتخمين!";
        } else if (state.timerRunning) {
          dom.charadesTimerStatus.textContent = "🎭 التمثيل جارٍ الآن...";
        } else if (cq.charadesTimerStarted) {
          dom.charadesTimerStatus.textContent = "⏸️ المؤقت متوقف مؤقتاً";
        } else {
          dom.charadesTimerStatus.textContent = "جاهز لبدء التمثيل بعد كشف الكلمة";
        }
      }

      if (dom.charadesTimerToggleIcon && dom.charadesTimerToggleText && dom.btnCharadesTimerToggle) {
        if (state.timerRunning) {
          dom.charadesTimerToggleIcon.textContent = "⏸️";
          dom.charadesTimerToggleText.textContent = "إيقاف مؤقت";
        } else if (cq.charadesTimerStarted && state.timerRemaining > 0) {
          dom.charadesTimerToggleIcon.textContent = "▶️";
          dom.charadesTimerToggleText.textContent = "استئناف";
        } else {
          dom.charadesTimerToggleIcon.textContent = "▶️";
          dom.charadesTimerToggleText.textContent = "ابدأ";
        }
        dom.btnCharadesTimerToggle.disabled = state.timerRemaining === 0 || cq.revealed;
      }

      if (dom.charadesDurationPills) {
        const lockDurationSelect = cq.charadesTimerStarted || state.timerRunning || cq.revealed;
        dom.charadesDurationPills.querySelectorAll(".charades-dur-pill").forEach((pill) => {
          const secVal = Number(pill.dataset.charadesSec);
          const isSelected = secVal === cq.charadesDuration;
          pill.classList.toggle("active", isSelected);
          pill.disabled = lockDurationSelect && !isSelected;
        });
      }
    }
  }

  /* =========================================================
     إلغاء السؤال / إظهار الإجابة / احتساب النقاط
     ========================================================= */
  function cancelCurrentQuestion() {
    if (!state.currentQ || state.currentQ.revealed) return;

    stopTimerInterval();
    stopMemoryInterval();
    hideCharadesSecret();
    closeLightbox();
    state.timerRunning = false;
    state.memoryPhase = null;

    const cq = state.currentQ;
    const hadUsedPowerups = Boolean(cq.doubleActive || cq.swappedOutIds.length > 0);

    // استعادة الحالة الكاملة قبل فتح السؤال (بما في ذلك بطاقة 2x وأي بطاقة Swap والسؤال الأصلي للخلية)
    if (state.preQuestionSnapshot) {
      state.teams = cloneTeamsState(state.preQuestionSnapshot.teams);
      state.activeTurn = normalizeTurnIndex(
        state.preQuestionSnapshot.activeTurn,
        state.teams.length
      );
      state.doubleArmed = false;
      if (state.preQuestionSnapshot.originalQuestion) {
        cq.slot.question = cloneQuestion(state.preQuestionSnapshot.originalQuestion);
        cq.slot.recycled = Boolean(state.preQuestionSnapshot.originalRecycled);
        cq.slot.previouslyPlayed = Boolean(state.preQuestionSnapshot.originalPreviouslyPlayed);
      }
    }

    state.currentQ = null;
    state.preQuestionSnapshot = null;
    resetVisualModalState();
    closeModal(dom.questionModal);
    renderScoreboard();
    renderGameBoard();
    updateUndoButtonUI();
    persistActiveMatch();

    if (hadUsedPowerups) {
      showToast("تم إلغاء السؤال واسترجاع وسائل المساعدة المستخدمة فيه ↩️", "info");
    }
  }

  function revealAnswer(isSilentRestore = false) {
    if (!state.currentQ || state.currentQ.revealed || isMemoryLockedPhase()) return;

    stopTimerInterval();
    stopMemoryInterval();
    hideCharadesSecret();
    state.timerRunning = false;
    state.memoryPhase = null;
    state.currentQ.revealed = true;
    state.currentQ.phase = "revealed";

    if (!isSilentRestore && window.SeenJeemAudio) {
      window.SeenJeemAudio.playReveal();
    }

    const cq = state.currentQ;
    populateAnswerCardContent(cq.question, cq.visualType);

    const ownerIdx = cq.activeTeamAtOpen;
    const ownerPts = computeEffectiveQuestionPoints(cq);
    const rivalPts = computeDiscountedBasePoints(cq); // لا تنتقل 2x للمنافس أبداً

    const t0Pts = ownerIdx === 0 ? ownerPts : rivalPts;
    const t1Pts = ownerIdx === 1 ? ownerPts : rivalPts;

    dom.awardTeam1Label.textContent = `فاز ${state.teams[0].name}`;
    dom.awardTeam2Label.textContent = `فاز ${state.teams[1].name}`;
    dom.awardTeam1Pts.textContent =
      cq.doubleActive && ownerIdx === 0 ? `(+${t0Pts} • ⚡2x)` : `(+${t0Pts})`;
    dom.awardTeam2Pts.textContent =
      cq.doubleActive && ownerIdx === 1 ? `(+${t1Pts} • ⚡2x)` : `(+${t1Pts})`;

    dom.btnCancelQuestion.hidden = true;
    dom.answerSection.hidden = false;
    updateQuestionPointsAndBanners();
    updateTacticalControlsUI();
    updateModalPhaseUI();

    persistActiveMatch();
    if (!isSilentRestore) {
      dom.answerSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function awardQuestion(winnerTeamIndex) {
    if (!state.currentQ || !state.currentQ.revealed) return;

    const cq = state.currentQ;
    const ownerIdx = cq.activeTeamAtOpen;
    const hasWinner =
      Number.isInteger(winnerTeamIndex) &&
      winnerTeamIndex >= 0 &&
      winnerTeamIndex < state.teams.length;

    const awardedPoints = hasWinner
      ? winnerTeamIndex === ownerIdx
        ? computeEffectiveQuestionPoints(cq)
        : computeDiscountedBasePoints(cq)
      : 0;

    const undoLabel = hasWinner
      ? `منح ${awardedPoints} نقطة لـ ${state.teams[winnerTeamIndex].name}`
      : `إغلاق سؤال (${cq.question.points}) بدون نقاط`;

    if (hasWinner) {
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playScore(true);
      }
      showToast(`+${awardedPoints} نقطة لـ ${state.teams[winnerTeamIndex].name}! 🎉`, "success");
    } else {
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playNoScore();
      }
      showToast("لا أحد حصل على النقاط (0 نقطة)", "info");
    }

    commitQuestionResolution({
      winnerTeamIndex: hasWinner ? winnerTeamIndex : null,
      awardedPoints,
      actionType: hasWinner ? "award" : "no-score",
      undoLabel,
      showBriefAnswerPreview: false
    });
  }

  /* =========================================================
     وضع الشاشتين للعرض التلفزيوني ولوحة تحكم المقدّم (Dual-Screen Host)
     ========================================================= */
  function installHostAudioRouter() {
    if (!window.SeenJeemAudio || !liveSync || liveSync.isDisplayMode()) return;
    if (window.SeenJeemAudio.__dualRouted) return;

    const audioObj = window.SeenJeemAudio;
    const methods = [
      "playTileOpen",
      "playUndo",
      "playTick",
      "playCharadesUrgentTick",
      "playTimeUp",
      "playHint",
      "playDoubleArm",
      "playStealAlert",
      "playWrongAnswer",
      "playLifeline",
      "playReveal",
      "playScore",
      "playNoScore",
      "playVictory"
    ];

    methods.forEach((methodName) => {
      const origFn = audioObj[methodName];
      if (typeof origFn !== "function") return;
      audioObj[methodName] = function (...args) {
        if (audioObj.isMuted()) return;
        if (state.dualScreen.connected && state.dualScreen.audioRoute === "display") {
          liveSync.broadcastSfx(methodName, args);
          return;
        }
        return origFn.apply(audioObj, args);
      };
    });

    audioObj.__dualRouted = true;
  }

  function renderDualScreenStatusUI() {
    const connected = Boolean(state.dualScreen.connected);
    const route = state.dualScreen.audioRoute;

    if (dom.dualScreenStatusPill) {
      dom.dualScreenStatusPill.textContent = connected
        ? "🟢 شاشة العرض متصلة"
        : "⚪ وضع الشاشة الواحدة";
      dom.dualScreenStatusPill.classList.toggle("is-connected", connected);
      dom.dualScreenStatusPill.classList.toggle("is-single", !connected);
    }

    if (dom.btnToggleAudioRoute) {
      dom.btnToggleAudioRoute.hidden = !connected;
      dom.btnToggleAudioRoute.textContent =
        route === "display" ? "📺 الصوت: التلفزيون" : "💻 الصوت: المقدّم";
      dom.btnToggleAudioRoute.title =
        route === "display"
          ? "المؤثرات الصوتية تعمل من شاشة العرض (التلفزيون) فقط لمنع الصدى — اضغط للتبديل لجهاز المقدّم"
          : "المؤثرات الصوتية تعمل من جهاز المقدّم فقط — اضغط للتبديل للتلفزيون";
    }
    if (dom.btnResyncTv) dom.btnResyncTv.hidden = !connected;
    if (dom.btnCloseTv) dom.btnCloseTv.hidden = !connected;

    if (dom.btnOpenTvDisplay) {
      dom.btnOpenTvDisplay.classList.toggle("is-live", connected);
    }

    if (state.currentQ) {
      updateModalPhaseUI();
    }
  }

  function renderHostCockpitUI() {
    const isDualActive = Boolean(state.dualScreen.connected && state.currentQ);
    const qModalCard = dom.questionModal ? dom.questionModal.querySelector(".question-modal-card") : null;
    if (qModalCard) {
      qModalCard.classList.toggle("is-host-cockpit", isDualActive);
    }

    if (dom.hostTvStatusBar) dom.hostTvStatusBar.hidden = !isDualActive;
    if (dom.hostCockpitCard) dom.hostCockpitCard.hidden = !isDualActive;

    if (!isDualActive) return;

    const cq = state.currentQ;
    const q = cq.question;

    // 1) شريط معاينة ما هو مكشوف حالياً على التلفزيون
    if (dom.hostTvVisibilityPill) {
      dom.hostTvVisibilityPill.classList.remove("state-hidden", "state-hint", "state-revealed");
      if (cq.revealed || cq.stealPeekedAnswer) {
        dom.hostTvVisibilityPill.textContent = "✅ الإجابة مكشوفة";
        dom.hostTvVisibilityPill.classList.add("state-revealed");
      } else if (cq.hintUsed) {
        dom.hostTvVisibilityPill.textContent = "💡 التلميح مكشوف";
        dom.hostTvVisibilityPill.classList.add("state-hint");
      } else {
        dom.hostTvVisibilityPill.textContent = "🙈 الإجابة مخفية";
        dom.hostTvVisibilityPill.classList.add("state-hidden");
      }
    }

    if (dom.hostTvMaskPill) {
      let maskText = "";
      if (cq.isCharades) {
        maskText = cq.revealed ? "🎭 الكلمة مكشوفة" : "🎭 التلفزيون يعرض التصنيف وعدد الكلمات فقط";
      } else if (cq.visualType === "blur") {
        maskText = cq.revealed ? "✨ واضحة" : cq.blurReduced ? "👁️ تغبيش مخفّف" : "🌫️ مغبّشة";
      } else if (cq.visualType === "zoom") {
        maskText = cq.revealed ? "✨ كاملة" : cq.zoomReduced ? "🔎 زوم مخفّف" : "🔎 زوم شديد";
      } else if (cq.visualType === "memory") {
        maskText =
          state.memoryPhase === "ready"
            ? "🧠 شاشة الاستعداد"
            : state.memoryPhase === "viewing"
              ? `👁️ عرض الصورة (${state.memoryRemaining}ث)`
              : "❓ السؤال ظاهر";
      }
      dom.hostTvMaskPill.textContent = maskText;
      dom.hostTvMaskPill.hidden = !maskText;
    }

    // 2) بطاقة المقدّم السرية (الإجابة + التلميح + الشرح/فكرة التمثيل فوراً للمقدّم)
    if (dom.hostCockpitCharadesTag) {
      dom.hostCockpitCharadesTag.hidden = !cq.isCharades;
    }
    if (dom.hostCockpitAnswerText) {
      dom.hostCockpitAnswerText.textContent = q.answer || "";
    }

    const hintText = typeof q.hint === "string" ? q.hint.trim() : "";
    if (dom.hostCockpitHintRow && dom.hostCockpitHintText && dom.btnHostProjectHint) {
      if (hintText) {
        dom.hostCockpitHintRow.hidden = false;
        dom.hostCockpitHintText.textContent = hintText;
        const pct = Math.round((Number(state.matchSettings.hintPenalty) || 0) * 100);
        if (cq.hintUsed) {
          dom.btnHostProjectHint.disabled = true;
          dom.btnHostProjectHint.textContent = "✓ معروض على التلفزيون";
        } else if (!state.matchSettings.hintEnabled) {
          dom.btnHostProjectHint.disabled = true;
          dom.btnHostProjectHint.textContent = "التلميح معطّل بالإعدادات";
        } else {
          dom.btnHostProjectHint.disabled = cq.revealed || cq.phase !== "answering" || isMemoryLockedPhase();
          dom.btnHostProjectHint.textContent =
            pct > 0 ? `📺 إظهار التلميح على التلفزيون (-${pct}%)` : "📺 إظهار التلميح على التلفزيون";
        }
      } else {
        dom.hostCockpitHintRow.hidden = true;
      }
    }

    const expText = typeof q.explanation === "string" ? q.explanation.trim() : "";
    if (dom.hostCockpitExpRow && dom.hostCockpitExpText && dom.hostCockpitExpLabel) {
      if (expText) {
        dom.hostCockpitExpRow.hidden = false;
        dom.hostCockpitExpLabel.textContent = cq.isCharades
          ? "🎭 فكرة التمثيل (للممثّل فقط):"
          : "📌 الشرح:";
        dom.hostCockpitExpText.textContent = expText;
      } else {
        dom.hostCockpitExpRow.hidden = true;
      }
    }
  }

  function buildDisplayQuestionPayload(cq, forceAnswerRevealed = false) {
    if (!cq || !cq.question) return null;
    const q = cq.question;
    const allowAnswer = Boolean(forceAnswerRevealed || cq.revealed || cq.stealPeekedAnswer);
    const allowHint = Boolean(cq.hintUsed);
    const hintPenaltyPct = state.matchSettings.hintEnabled
      ? Math.round((Number(state.matchSettings.hintPenalty) || 0) * 100)
      : 0;

    const answerImgSrc =
      q.answerImage && q.answerImage.trim()
        ? q.answerImage
        : cq.visualType === "memory" && q.questionImage && q.questionImage.trim()
          ? q.questionImage
          : null;

    return {
      categoryId: cq.category.id,
      categoryName: cq.category.name,
      categoryIcon: cq.category.icon || "🎯",
      categoryColor: getCategoryAccentColor(cq.category),
      basePoints: Number(q.points) || 200,
      discountedBasePoints: computeDiscountedBasePoints(cq),
      effectivePoints: computeEffectiveQuestionPoints(cq),
      stealPoints: computeStealQuestionPoints(cq),
      hintPenaltyPct,
      visualType: cq.visualType || "normal",
      isCharades: Boolean(cq.isCharades),
      charadesHeader: cq.isCharades
        ? parseCharadesHeader(q.question, q.answer, cq.category.name)
        : null,
      phase: forceAnswerRevealed ? "closing-preview" : cq.phase || "answering",
      activeTeamAtOpen: cq.activeTeamAtOpen,
      stealingTeamIdx: cq.stealingTeamIdx,
      doubleActive: Boolean(cq.doubleActive),
      hintRevealed: allowHint,
      answerRevealed: allowAnswer,
      questionText: cq.isCharades ? null : q.question,
      questionImage: q.questionImage || null,
      images: Array.isArray(q.images) ? q.images.slice() : null,
      showPlus: Boolean(q.showPlus),
      differencesCount: q.differencesCount || null,
      blurLevel: cq.blurLevel,
      halfBlur: cq.halfBlur,
      blurReduced: Boolean(cq.blurReduced),
      zoomLevel: cq.zoomLevel,
      halfZoom: cq.halfZoom,
      zoomOrigin: cq.zoomOrigin || "center",
      zoomReduced: Boolean(cq.zoomReduced),
      timerRemaining: state.timerRemaining,
      timerMax: state.timerMax,
      timerMode: state.timerMode,
      timerRunning: Boolean(state.timerRunning),
      charadesDuration: cq.charadesDuration || 60,
      charadesTimerStarted: Boolean(cq.charadesTimerStarted),
      memoryPhase: state.memoryPhase,
      memoryRemaining: state.memoryRemaining,
      memoryTotal: state.memoryTotal,
      // بروتوكول منع تسريب الإجابات: لا نمرر التلميح أو الإجابة أو الشرح إلا عند كشفها صراحةً
      hintText: allowHint ? q.hint || null : null,
      answerText: allowAnswer ? q.answer || null : null,
      explanationText: allowAnswer ? q.explanation || null : null,
      answerImage: allowAnswer ? answerImgSrc : null
    };
  }

  function buildDisplayBoardPayload() {
    return state.boardCategories.map((bc) => {
      const allSlots = [...bc.rightColumn, ...bc.leftColumn];
      const remainingInCat = allSlots.filter((s) => !s.played && s.question).length;
      const mapSlot = (s) => ({
        points: Number(s.points) || 200,
        played: Boolean(s.played),
        winnerTeam: Number.isInteger(s.winnerTeam) ? s.winnerTeam : null,
        recycled: Boolean(s.recycled),
        hasQuestion: Boolean(s.question)
      });
      return {
        category: {
          id: bc.category.id,
          name: bc.category.name,
          icon: bc.category.icon || "🎯",
          color: getCategoryAccentColor(bc.category)
        },
        remainingInCat,
        rightColumn: bc.rightColumn.map(mapSlot),
        leftColumn: bc.leftColumn.map(mapSlot)
      };
    });
  }

  function buildDisplayWinnerPayload() {
    const t0 = state.teams[0] || { id: "team-0", name: "الفريق الأول", score: 0 };
    const t1 = state.teams[1] || { id: "team-1", name: "الفريق الثاني", score: 0 };
    const winnerIdx = t0.score > t1.score ? 0 : t1.score > t0.score ? 1 : null;
    const eyebrow = winnerIdx === null ? "منافسة متكافئة!" : "مبروك الفوز!";
    const title =
      winnerIdx === 0
        ? `الفائز: ${t0.name}`
        : winnerIdx === 1
          ? `الفائز: ${t1.name}`
          : "تعادل مثير بين الفريقين";
    return {
      winnerIdx,
      eyebrow,
      title,
      teams: state.teams.map((t) => ({ id: t.id, name: t.name, score: t.score })),
      analytics: computeMatchAnalytics()
    };
  }

  function broadcastLiveDisplayState() {
    if (!liveSync || !liveSync.isSupported() || liveSync.isDisplayMode()) return;

    const isGameActive = dom.gameScreen && dom.gameScreen.classList.contains("active");
    const isWinnerOpen = dom.winnerModal && dom.winnerModal.classList.contains("open");
    const isQuestionOpen =
      dom.questionModal &&
      dom.questionModal.classList.contains("open") &&
      (Boolean(state.currentQ) || Boolean(state.dualScreen.closingPreviewQuestion));

    let screen = "setup";
    if (isWinnerOpen) {
      screen = "winner";
    } else if (isQuestionOpen) {
      screen = "question";
    } else if (isGameActive) {
      screen = "board";
    }

    const snapshot = {
      screen,
      setupInfo: {
        team1Name: dom.team1Input ? dom.team1Input.value.trim() || "الفريق الأول" : "الفريق الأول",
        team2Name: dom.team2Input ? dom.team2Input.value.trim() || "الفريق الثاني" : "الفريق الثاني",
        selectedCount: state.selectedCategoryIds.length
      },
      teams: state.teams,
      activeTurn: state.activeTurn,
      doubleArmed: state.doubleArmed,
      remainingPlayable: countRemainingPlayableQuestions(),
      totalSlots: countTotalBoardSlots(),
      matchSettings: state.matchSettings,
      board: isGameActive ? buildDisplayBoardPayload() : [],
      questionView:
        screen === "question"
          ? state.currentQ
            ? buildDisplayQuestionPayload(state.currentQ, false)
            : state.dualScreen.closingPreviewQuestion
          : null,
      winnerView: screen === "winner" ? buildDisplayWinnerPayload() : null
    };

    liveSync.broadcastState(snapshot);
  }

  function openTVDisplayWindow() {
    if (!liveSync || !liveSync.isSupported()) {
      showToast("المتصفح الحالي لا يدعم المزامنة عبر BroadcastChannel", "warning");
      return;
    }
    const res = liveSync.openDisplayWindow();
    if (!res.ok) {
      showToast("يرجى السماح بفتح النوافذ المنبثقة (Pop-ups) لفتح شاشة العرض التلفزيوني 📺", "warning");
      return;
    }
    broadcastLiveDisplayState();
    showToast(
      res.reused
        ? "تم التركيز على نافذة شاشة العرض التلفزيوني 📺"
        : "تم فتح شاشة العرض التلفزيوني (TV) — اسحبها لشاشة التلفزيون واضغط ملء الشاشة 📺",
      "success"
    );
  }

  function toggleDualAudioRoute() {
    if (!liveSync) return;
    const next = state.dualScreen.audioRoute === "display" ? "host" : "display";
    state.dualScreen.audioRoute = liveSync.setAudioRoute(next);
    renderDualScreenStatusUI();
    showToast(
      next === "display"
        ? "📺 تم توجيه المؤثرات الصوتية إلى التلفزيون (شاشة العرض) فقط"
        : "💻 تم توجيه المؤثرات الصوتية إلى جهاز المقدّم فقط",
      "info"
    );
  }

  /* =========================================================
     إحصائيات نهاية المباراة (Match Analytics & Summary Dashboard)
     ========================================================= */
  function computeMatchAnalytics() {
    const events = Array.isArray(state.matchEvents) ? state.matchEvents : [];
    const totalQuestions = events.length;
    const totalCorrect = events.filter((e) => e.awardedTeamId !== null).length;
    const overallAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
    const totalSteals = events.filter((e) => e.wasSteal && e.awardedTeamId !== null).length;
    const totalStealPoints = events
      .filter((e) => e.wasSteal && e.awardedTeamId !== null)
      .reduce((sum, e) => sum + e.effectivePoints, 0);
    const totalDoubleUsed = events.filter((e) => e.wasDouble).length;
    const totalDoubleWins = events.filter(
      (e) => e.wasDouble && e.awardedTeamId !== null && e.awardedTeamId === e.askingTeamId
    ).length;
    const totalHintsUsed = events.filter((e) => e.hintUsed).length;
    const totalSwapsUsed = events.filter((e) => e.wasSwapped).length;

    const teamStats = state.teams.map((team, idx) => {
      const teamId = team.id || `team-${idx}`;
      const ownTurns = events.filter((e) => e.askingTeamId === teamId);
      const wonEvents = events.filter((e) => e.awardedTeamId === teamId);
      const ownCorrect = ownTurns.filter((e) => e.awardedTeamId === teamId).length;
      const stealsWon = wonEvents.filter((e) => e.wasSteal).length;
      const stealPoints = wonEvents
        .filter((e) => e.wasSteal)
        .reduce((sum, e) => sum + e.effectivePoints, 0);
      const doubleUsed = ownTurns.filter((e) => e.wasDouble).length;
      const doubleWins = ownTurns.filter((e) => e.wasDouble && e.awardedTeamId === teamId).length;
      const hintsUsed = ownTurns.filter((e) => e.hintUsed).length;
      const swapsUsed = ownTurns.filter((e) => e.wasSwapped).length;

      const byTier = { 200: 0, 400: 0, 600: 0 };
      wonEvents.forEach((e) => {
        if (byTier[e.basePoints] !== undefined) byTier[e.basePoints]++;
      });

      const accuracy = ownTurns.length > 0 ? Math.round((ownCorrect / ownTurns.length) * 100) : 0;

      return {
        teamId,
        name: team.name,
        score: team.score,
        turns: ownTurns.length,
        correct: wonEvents.length,
        ownCorrect,
        accuracy,
        stealsWon,
        stealPoints,
        doubleUsed,
        doubleWins,
        hintsUsed,
        swapsUsed,
        byTier
      };
    });

    const catMap = new Map();
    events.forEach((e) => {
      if (!catMap.has(e.categoryId)) {
        catMap.set(e.categoryId, {
          categoryId: e.categoryId,
          categoryName: e.categoryName,
          total: 0,
          teamWins: state.teams.map(() => 0),
          unanswered: 0
        });
      }
      const rec = catMap.get(e.categoryId);
      rec.total++;
      const winnerIdx = state.teams.findIndex((t, i) => (t.id || `team-${i}`) === e.awardedTeamId);
      if (winnerIdx >= 0) {
        rec.teamWins[winnerIdx]++;
      } else {
        rec.unanswered++;
      }
    });

    return {
      totalQuestions,
      totalCorrect,
      overallAccuracy,
      totalSteals,
      totalStealPoints,
      totalDoubleUsed,
      totalDoubleWins,
      totalHintsUsed,
      totalSwapsUsed,
      teamStats,
      categories: Array.from(catMap.values())
    };
  }

  function switchAnalyticsTab(tabName) {
    state.activeAnalyticsTab = tabName === "log" ? "log" : "overview";
    const isLog = state.activeAnalyticsTab === "log";
    if (dom.btnTabAnalyticsOverview) {
      dom.btnTabAnalyticsOverview.classList.toggle("active", !isLog);
      dom.btnTabAnalyticsOverview.setAttribute("aria-selected", String(!isLog));
    }
    if (dom.btnTabAnalyticsLog) {
      dom.btnTabAnalyticsLog.classList.toggle("active", isLog);
      dom.btnTabAnalyticsLog.setAttribute("aria-selected", String(isLog));
    }
    if (dom.analyticsOverviewPanel) dom.analyticsOverviewPanel.hidden = isLog;
    if (dom.analyticsLogPanel) dom.analyticsLogPanel.hidden = !isLog;
  }

  function renderWinnerAnalyticsDashboard() {
    if (!dom.winnerAnalyticsDashboard) return;
    const events = state.matchEvents || [];
    if (events.length === 0) {
      dom.winnerAnalyticsDashboard.hidden = true;
      return;
    }

    dom.winnerAnalyticsDashboard.hidden = false;
    const analytics = computeMatchAnalytics();

    if (dom.analyticsLogCount) {
      dom.analyticsLogCount.textContent = String(events.length);
    }

    if (dom.analyticsKpiGrid) {
      dom.analyticsKpiGrid.innerHTML = `
        <div class="analytics-kpi-card">
          <div class="analytics-kpi-value">${analytics.totalQuestions}</div>
          <div class="analytics-kpi-label">أسئلة محسومة</div>
        </div>
        <div class="analytics-kpi-card kpi-good">
          <div class="analytics-kpi-value">${analytics.overallAccuracy}%</div>
          <div class="analytics-kpi-label">دقة الإجابة</div>
        </div>
        <div class="analytics-kpi-card kpi-amber">
          <div class="analytics-kpi-value">🔥 ${analytics.totalSteals}</div>
          <div class="analytics-kpi-label">سرقات ناجحة (+${analytics.totalStealPoints})</div>
        </div>
        <div class="analytics-kpi-card kpi-violet">
          <div class="analytics-kpi-value">⚡ ${analytics.totalDoubleWins}/${analytics.totalDoubleUsed}</div>
          <div class="analytics-kpi-label">مضاعفات 2x ناجحة</div>
        </div>
      `;
    }

    if (dom.analyticsTeamCompare) {
      dom.analyticsTeamCompare.innerHTML = analytics.teamStats
        .map(
          (ts, idx) => `
          <div class="analytics-team-card team-${idx + 1}">
            <div class="analytics-team-head">
              <span class="team-badge-dot team-${idx + 1}-dot"></span>
              <span class="analytics-team-title">${escapeHtml(ts.name)}</span>
              <span class="analytics-acc-pill">${ts.accuracy}% دقة</span>
            </div>
            <div class="analytics-team-metrics">
              <span class="analytics-metric-chip">✅ ${ts.correct} إجابة صحيحة</span>
              <span class="analytics-metric-chip">🔥 ${ts.stealsWon} سرقة (+${ts.stealPoints})</span>
              <span class="analytics-metric-chip">⚡ ${ts.doubleWins} مضاعفة</span>
              <span class="analytics-metric-chip">💡 ${ts.hintsUsed} تلميح</span>
              <span class="analytics-metric-chip">🔄 ${ts.swapsUsed} تبديل</span>
            </div>
            <div class="analytics-tiers-row">
              <span class="tier-badge t200">200: ${ts.byTier[200]}</span>
              <span class="tier-badge t400">400: ${ts.byTier[400]}</span>
              <span class="tier-badge t600">600: ${ts.byTier[600]}</span>
            </div>
          </div>
        `
        )
        .join("");
    }

    if (dom.analyticsCategoriesBreakdown) {
      if (analytics.categories.length > 0) {
        dom.analyticsCategoriesBreakdown.innerHTML = `
          <div class="analytics-sub-heading">🎯 توزيع الفوز حسب الفئات</div>
          <div class="analytics-cats-list">
            ${analytics.categories
              .map(
                (cat) => `
                <div class="analytics-cat-row">
                  <span class="analytics-cat-name">${escapeHtml(cat.categoryName)}</span>
                  <div class="analytics-cat-scores">
                    <span class="cat-score-pill t1">${escapeHtml(state.teams[0].name)}: ${cat.teamWins[0] || 0}</span>
                    <span class="cat-score-pill t2">${escapeHtml(state.teams[1].name)}: ${cat.teamWins[1] || 0}</span>
                    ${cat.unanswered > 0 ? `<span class="cat-score-pill none">بدون نقاط: ${cat.unanswered}</span>` : ""}
                  </div>
                </div>
              `
              )
              .join("")}
          </div>
        `;
      } else {
        dom.analyticsCategoriesBreakdown.innerHTML = "";
      }
    }

    if (dom.analyticsEventsList) {
      const teamNameMap = new Map(state.teams.map((t, i) => [t.id || `team-${i}`, t.name]));
      dom.analyticsEventsList.innerHTML = events
        .map((ev, idx) => {
          const winnerName = ev.awardedTeamId ? teamNameMap.get(ev.awardedTeamId) || "فريق" : null;
          const winnerIdx = state.teams.findIndex(
            (t, i) => (t.id || `team-${i}`) === ev.awardedTeamId
          );
          const displayQ = ev.categoryId.startsWith("mgk-")
            ? parseCharadesHeader(ev.questionText, ev.answerText, ev.categoryName).topic
            : ev.questionText;

          const tags = [];
          if (ev.wasDouble) tags.push(`<span class="ev-tag tag-double">⚡ 2x</span>`);
          if (ev.wasSteal) tags.push(`<span class="ev-tag tag-steal">🔥 سرقة</span>`);
          if (ev.hintUsed) tags.push(`<span class="ev-tag tag-hint">💡 تلميح</span>`);
          if (ev.wasSwapped) tags.push(`<span class="ev-tag tag-swap">🔄 مُبدَّل</span>`);

          return `
            <div class="analytics-event-item">
              <div class="analytics-event-top">
                <span class="analytics-event-num">#${idx + 1}</span>
                <span class="analytics-event-cat">${escapeHtml(ev.categoryName)} (${ev.basePoints})</span>
                <div class="analytics-event-tags">${tags.join("")}</div>
                <span class="analytics-event-winner ${
                  winnerIdx === 0 ? "w-team-1" : winnerIdx === 1 ? "w-team-2" : "w-none"
                }">
                  ${winnerName ? `${escapeHtml(winnerName)} (+${ev.effectivePoints})` : "لا أحد (0)"}
                </span>
              </div>
              <div class="analytics-event-q">${escapeHtml(displayQ)}</div>
              <div class="analytics-event-a">✅ ${escapeHtml(ev.answerText)}</div>
            </div>
          `;
        })
        .join("");
    }

    switchAnalyticsTab("overview");
  }

  function copyMatchSummaryToClipboard() {
    const an = computeMatchAnalytics();
    const t0 = state.teams[0];
    const t1 = state.teams[1];
    const winnerLine =
      t0.score > t1.score
        ? `🏆 الفائز: ${t0.name}`
        : t1.score > t0.score
          ? `🏆 الفائز: ${t1.name}`
          : "🤝 تعادل مثير!";

    const lines = [
      "🎯 نتائج مباراة «سين جيم»",
      winnerLine,
      `• ${t0.name}: ${t0.score} نقطة (✅ ${an.teamStats[0].correct} | 🔥 ${an.teamStats[0].stealsWon} سرقة | ⚡ ${an.teamStats[0].doubleWins} مضاعفة)`,
      `• ${t1.name}: ${t1.score} نقطة (✅ ${an.teamStats[1].correct} | 🔥 ${an.teamStats[1].stealsWon} سرقة | ⚡ ${an.teamStats[1].doubleWins} مضاعفة)`,
      `📊 إجمالي الأسئلة المحسومة: ${an.totalQuestions} • دقة الإجابة: ${an.overallAccuracy}%`
    ];
    const text = lines.join("\n");

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast("تم نسخ ملخص وإحصائيات المباراة 📋", "success"))
        .catch(() => showToast("تعذّر النسخ التلقائي — يمكنك نسخه يدوياً", "warning"));
    } else {
      showToast("تم تجهيز الملخص بنجاح", "info");
    }
  }

  /* =========================================================
     شاشة الفائز (Winner Modal)
     ========================================================= */
  function openWinnerModal(endedManually = false) {
    // مسح الحفظ المؤقت تلقائياً عند انتهاء المباراة وإعلان الفائز
    matchStore.clearSavedMatch();

    const t1 = state.teams[0];
    const t2 = state.teams[1];

    dom.winnerTeam1Name.textContent = t1.name;
    dom.winnerTeam2Name.textContent = t2.name;
    dom.winnerTeam1Score.textContent = String(t1.score);
    dom.winnerTeam2Score.textContent = String(t2.score);

    const crown1 = dom.winnerCardTeam1.querySelector(".winner-crown");
    const crown2 = dom.winnerCardTeam2.querySelector(".winner-crown");

    dom.winnerCardTeam1.classList.remove("is-winner");
    dom.winnerCardTeam2.classList.remove("is-winner");
    if (dom.winnerModalCard) {
      dom.winnerModalCard.classList.remove("winner-team-1", "winner-team-2", "winner-draw");
    }
    crown1.hidden = true;
    crown2.hidden = true;

    let confettiTheme = null;
    if (t1.score > t2.score) {
      dom.winnerTrophy.textContent = "🏆";
      dom.winnerSubtitle.textContent = "مبروك الفوز!";
      dom.winnerTitle.textContent = `الفائز: ${t1.name}`;
      dom.winnerCardTeam1.classList.add("is-winner");
      if (dom.winnerModalCard) dom.winnerModalCard.classList.add("winner-team-1");
      crown1.hidden = false;
      confettiTheme = "team1";
    } else if (t2.score > t1.score) {
      dom.winnerTrophy.textContent = "🏆";
      dom.winnerSubtitle.textContent = "مبروك الفوز!";
      dom.winnerTitle.textContent = `الفائز: ${t2.name}`;
      dom.winnerCardTeam2.classList.add("is-winner");
      if (dom.winnerModalCard) dom.winnerModalCard.classList.add("winner-team-2");
      crown2.hidden = false;
      confettiTheme = "team2";
    } else {
      dom.winnerTrophy.textContent = "🤝";
      dom.winnerSubtitle.textContent = "منافسة متكافئة!";
      dom.winnerTitle.textContent = "تعادل مثير بين الفريقين";
      if (dom.winnerModalCard) dom.winnerModalCard.classList.add("winner-draw");
    }

    const remaining = countRemainingPlayableQuestions();
    dom.winnerStatsNote.textContent =
      remaining === 0
        ? `تم إكمال جميع أسئلة الجولة بنجاح (${state.answeredThisRound} سؤالاً تم لعبه في هذه الجولة).`
        : `تم إنهاء الجولة بعد لعب ${state.answeredThisRound} سؤالاً (متبقي ${remaining} سؤالاً على اللوحة).`;

    dom.btnResumeRound.hidden = !(endedManually && remaining > 0);
    renderWinnerAnalyticsDashboard();

    openModal(dom.winnerModal);
    broadcastLiveDisplayState();

    if (confettiTheme) {
      startVictoryConfetti(confettiTheme);
    } else {
      stopVictoryConfetti();
    }

    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playVictory();
    }
  }

  function startVictoryConfetti(theme = "default") {
    if (window.SeenJeemConfetti && dom.confettiCanvas) {
      window.SeenJeemConfetti.start(dom.confettiCanvas, theme);
    }
    if (liveSync && state.dualScreen.connected) {
      liveSync.broadcastConfetti("victory", theme);
    }
  }

  function stopVictoryConfetti() {
    if (window.SeenJeemConfetti) {
      window.SeenJeemConfetti.stop();
    }
  }

  function returnToSetupScreen() {
    clearClosingRevealTimer();
    stopTimerInterval();
    stopMemoryInterval();
    hideCharadesSecret();
    stopVictoryConfetti();
    closeLightbox();
    state.currentQ = null;
    state.preQuestionSnapshot = null;
    state.doubleArmed = false;
    state.matchEvents = [];
    state.dualScreen.closingPreviewQuestion = null;
    matchStore.clearSavedMatch();
    matchStore.clearUndoStack();
    resetVisualModalState();
    closeModal(dom.winnerModal);
    closeModal(dom.questionModal);

    dom.gameScreen.classList.remove("active");
    dom.gameScreen.setAttribute("aria-hidden", "true");
    dom.setupScreen.classList.add("active");
    dom.setupScreen.setAttribute("aria-hidden", "false");

    renderSetupScreen();
    syncWakeLockForCurrentScreen();
    broadcastLiveDisplayState();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* =========================================================
     الصوت وملء الشاشة واختصارات لوحة المفاتيح
     ========================================================= */
  function syncSoundButtonsUI() {
    const isMuted = Boolean(window.SeenJeemAudio && window.SeenJeemAudio.isMuted());
    const icon = isMuted ? "🔇" : "🔊";
    const label = isMuted ? "تشغيل الصوت (مكتوم حالياً)" : "كتم الصوت";
    [dom.btnToggleSoundSetup, dom.btnToggleSound].forEach((btn) => {
      if (!btn) return;
      btn.textContent = icon;
      btn.title = label;
      btn.setAttribute("aria-pressed", String(isMuted));
    });
    syncAudioMixerUI();
  }

  function toggleSoundMuted() {
    if (!window.SeenJeemAudio) return;
    const nextMuted = !window.SeenJeemAudio.isMuted();
    window.SeenJeemAudio.setMuted(nextMuted);
    syncSoundButtonsUI();
    showToast(nextMuted ? "تم كتم الصوت 🔇" : "تم تشغيل الصوت 🔊", "info");
  }

  function isFullscreenSupported() {
    const el = document.documentElement;
    return Boolean(
      (document.fullscreenEnabled || document.webkitFullscreenEnabled) &&
        (el.requestFullscreen || el.webkitRequestFullscreen)
    );
  }

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function syncFullscreenButtonUI() {
    if (!dom.btnToggleFullscreen) return;
    const isFull = Boolean(getFullscreenElement());
    dom.btnToggleFullscreen.textContent = isFull ? "🗗" : "⛶";
    dom.btnToggleFullscreen.title = isFull ? "خروج من ملء الشاشة" : "ملء الشاشة";
    dom.btnToggleFullscreen.setAttribute("aria-pressed", String(isFull));
  }

  function initFullscreenControls() {
    if (!dom.btnToggleFullscreen) return;
    if (!isFullscreenSupported()) {
      dom.btnToggleFullscreen.hidden = true;
      return;
    }
    dom.btnToggleFullscreen.hidden = false;
    syncFullscreenButtonUI();
  }

  function toggleFullscreen() {
    if (!isFullscreenSupported()) return;
    try {
      if (getFullscreenElement()) {
        const exitFn = document.exitFullscreen || document.webkitExitFullscreen;
        if (exitFn) {
          const res = exitFn.call(document);
          if (res && typeof res.catch === "function") res.catch(() => {});
        }
      } else {
        const el = document.documentElement;
        const reqFn = el.requestFullscreen || el.webkitRequestFullscreen;
        if (reqFn) {
          const res = reqFn.call(el);
          if (res && typeof res.catch === "function") res.catch(() => {});
        }
      }
    } catch (_err) {
      // تجاهل رفض ملء الشاشة من المتصفح
    }
  }

  function isEditableElementFocused() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      Boolean(active.isContentEditable)
    );
  }

  function closeQuestionModalAfterRevealWithoutScoring() {
    if (!state.currentQ) return;
    commitQuestionResolution({
      winnerTeamIndex: null,
      awardedPoints: 0,
      actionType: "close-question",
      undoLabel: `إغلاق سؤال (${state.currentQ.question.points})`,
      showBriefAnswerPreview: false
    });
  }

  function handleGlobalKeydown(e) {
    if (dom.imageLightbox.classList.contains("open")) {
      if (e.key === "Escape") {
        closeLightbox();
      } else if (e.key === "ArrowRight") {
        stepLightbox(-1);
      } else if (e.key === "ArrowLeft") {
        stepLightbox(1);
      }
      return;
    }

    if (dom.confirmModal.classList.contains("open")) {
      if (e.key === "Escape") {
        closeConfirmDialog();
      }
      return;
    }

    if (dom.resumeMatchModal && dom.resumeMatchModal.classList.contains("open")) {
      return;
    }

    if (dom.bankManagerModal.classList.contains("open")) {
      if (e.key === "Escape") {
        closeBankManagerModal();
      }
      return;
    }

    if (dom.winnerModal.classList.contains("open")) {
      return;
    }

    // اختصار التراجع Ctrl+Z / Cmd+Z (مُعطّل تلقائياً داخل الحقول النصية input / textarea)
    const isUndoCombo =
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey &&
      (e.code === "KeyZ" || e.key.toLowerCase() === "z" || e.key === "ئ");

    if (isUndoCombo) {
      if (isEditableElementFocused()) {
        return;
      }
      if (dom.gameScreen.classList.contains("active")) {
        if (dom.questionModal.classList.contains("open") && state.currentQ) {
          e.preventDefault();
          performInModalUndo();
        } else {
          e.preventDefault();
          performUndo();
        }
      }
      return;
    }

    // في حال عرض الإجابة الختامي المؤقت بعد السرقة، يسمح Enter / Escape / Space بالعودة الفورية
    if (dom.questionModal.classList.contains("open") && !state.currentQ && state.closingRevealTimeout) {
      if (e.key === "Escape" || e.key === "Enter" || e.code === "Space") {
        e.preventDefault();
        finishClosingRevealImmediately();
      }
      return;
    }

    // اختصارات المذيع داخل نافذة السؤال (مُعطّلة داخل الحقول النصية)
    if (!dom.questionModal.classList.contains("open") || !state.currentQ) {
      return;
    }

    if (isEditableElementFocused()) {
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }

    const key = e.key;
    const lowerKey = key.toLowerCase();
    const code = e.code;

    if (key === "Escape") {
      e.preventDefault();
      if (!state.currentQ.revealed) {
        cancelCurrentQuestion();
      } else {
        closeQuestionModalAfterRevealWithoutScoring();
      }
      return;
    }

    if (!state.currentQ.revealed) {
      const isHintKey = code === "KeyH" || lowerKey === "h" || key === "أ";
      const isStealKey = code === "KeyS" || lowerKey === "s" || key === "س";
      const isResetKey = code === "KeyR" || lowerKey === "r" || key === "ق";

      if (code === "Space" || key === " ") {
        // Space: تشغيل/إيقاف مؤقت «من غير كلام» عند التواجد داخل شاشة mgk-* أو المؤقت النشط
        if (!isMemoryLockedPhase() && state.currentQ.phase !== "steal-offer") {
          e.preventDefault();
          toggleTimer();
        }
      } else if (isHintKey) {
        // H: كشف التلميح (إن كان متاحاً)
        if (
          !isMemoryLockedPhase() &&
          state.currentQ.phase === "answering" &&
          !dom.questionHintWrap.hidden &&
          !dom.btnShowHint.disabled
        ) {
          e.preventDefault();
          useQuestionHint();
        }
      } else if (isStealKey) {
        // S: فتح فرصة السرقة عند إتاحتها
        if (
          !isMemoryLockedPhase() &&
          state.matchSettings.stealEnabled &&
          !state.currentQ.stealConsumed &&
          (state.currentQ.phase === "steal-offer" || state.currentQ.phase === "answering")
        ) {
          e.preventDefault();
          openStealPhase();
        }
      } else if (isResetKey) {
        if (!isMemoryLockedPhase()) {
          e.preventDefault();
          if (state.currentQ.phase === "steal-active") {
            startTimer(state.matchSettings.stealTimerSeconds || 15, "steal");
            persistActiveMatch();
          } else if (state.currentQ.isCharades) {
            resetCharadesTimer();
          } else {
            startMainQuestionTimer();
            persistActiveMatch();
          }
        }
      } else if (key === "Enter") {
        if (!isMemoryLockedPhase() && state.currentQ.phase === "answering") {
          e.preventDefault();
          revealAnswer(false);
        }
      }
    } else {
      if (key === "1") {
        e.preventDefault();
        awardQuestion(0);
      } else if (key === "2") {
        e.preventDefault();
        awardQuestion(1);
      } else if (key === "0") {
        e.preventDefault();
        awardQuestion(null);
      }
    }
  }

  function handlePageLifecycleSave() {
    hideCharadesSecret();
    persistActiveMatch();
  }

  function cleanupAppResources() {
    clearClosingRevealTimer();
    hideCharadesSecret();
    persistActiveMatch();
    stopTimerInterval();
    stopMemoryInterval();
    stopVictoryConfetti();
    if (liveSync && typeof liveSync.destroy === "function") {
      liveSync.destroy();
    }
    if (wakeLock && typeof wakeLock.destroy === "function") {
      wakeLock.destroy();
    }
    document.removeEventListener("keydown", handleGlobalKeydown);
    document.removeEventListener("fullscreenchange", syncFullscreenButtonUI);
    document.removeEventListener("webkitfullscreenchange", syncFullscreenButtonUI);
  }

  /* =========================================================
     فتح وإغلاق النوافذ المنبثقة
     ========================================================= */
  function openModal(modalEl) {
    if (!modalEl) return;
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    modalEl.classList.add("open");
    modalEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove("open");
    modalEl.setAttribute("aria-hidden", "true");
    const anyOpen = document.querySelector(".modal-overlay.open");
    if (!anyOpen) {
      document.body.style.overflow = "";
    }
  }

  /* =========================================================
     الحزمة الرابعة: PWA، Wake Lock، مراجعة الأسئلة، النسخ الاحتياطي، ولوحة الصوت
     ========================================================= */
  function showSwUpdateToast() {
    if (!dom.toastContainer) return;
    if (dom.toastContainer.querySelector(".toast-pwa-update")) return;

    const toast = document.createElement("div");
    toast.className = "toast toast-success toast-pwa-update";

    const iconEl = document.createElement("span");
    iconEl.className = "toast-icon";
    iconEl.textContent = "✨";

    const textEl = document.createElement("span");
    textEl.className = "toast-text";
    textEl.textContent = "يتوفر تحديث جديد لتطبيق «سين جيم»";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-xxs toast-action-btn";
    btn.textContent = "تحديث الآن";
    btn.addEventListener("click", () => {
      if (pwaManager) pwaManager.applyPendingUpdate();
    });

    toast.appendChild(iconEl);
    toast.appendChild(textEl);
    toast.appendChild(btn);
    dom.toastContainer.appendChild(toast);
  }

  function syncOnlineOfflineUI(isTransition = false) {
    const isOnline = pwaManager ? pwaManager.isOnline() : navigator.onLine !== false;
    if (dom.offlineStatusBadge) dom.offlineStatusBadge.hidden = isOnline;
    if (dom.offlineStatusBadgeGame) dom.offlineStatusBadgeGame.hidden = isOnline;

    if (isTransition) {
      if (!isOnline) {
        showToast("📡 انقطع الاتصال بالإنترنت — التطبيق يعمل الآن في وضع عدم الاتصال من الكاش المحلي", "warning");
      } else {
        showToast("🌐 عاد الاتصال بالإنترنت بنجاح!", "success");
      }
    }
  }

  function syncPwaInstallButtonUI() {
    if (!dom.btnInstallPwa) return;
    const show = Boolean(pwaManager && pwaManager.canInstall());
    dom.btnInstallPwa.hidden = !show;
  }

  function initPwaUI() {
    if (!pwaManager) return;
    pwaManager.init();
    syncOnlineOfflineUI(false);
    syncPwaInstallButtonUI();

    pwaManager.onInstallStateChange(() => {
      syncPwaInstallButtonUI();
    });
    pwaManager.onOnlineChange(({ isTransition }) => {
      syncOnlineOfflineUI(Boolean(isTransition));
    });
    pwaManager.onUpdateAvailable(() => {
      showSwUpdateToast();
    });
  }

  // --- Screen Wake Lock ---
  function syncWakeLockSetupUI() {
    if (!dom.toggleWakelockEnabled) return;
    const supported = Boolean(wakeLock && wakeLock.isSupported());
    const enabled = Boolean(wakeLock && wakeLock.isEnabled());
    dom.toggleWakelockEnabled.classList.toggle("active", enabled);
    dom.toggleWakelockEnabled.setAttribute("aria-checked", String(enabled));
    if (dom.tacticalCardWakelock) {
      dom.tacticalCardWakelock.classList.toggle("is-disabled", !enabled);
    }
    if (dom.wakelockStatusNote) {
      if (!supported) {
        dom.wakelockStatusNote.textContent = "المتصفح الحالي لا يدعم Wake Lock — يتم التعامل معه تلقائياً دون أي تأثير";
      } else if (enabled) {
        dom.wakelockStatusNote.textContent = "مفعّل تلقائياً أثناء لوحة اللعب وشاشة السؤال وشاشة التلفزيون";
      } else {
        dom.wakelockStatusNote.textContent = "معطّل حالياً — ستنطفئ الشاشة وفق إعدادات جهازك";
      }
    }
  }

  function syncWakeLockForCurrentScreen() {
    if (!wakeLock) return;
    const isGameActive = Boolean(dom.gameScreen && dom.gameScreen.classList.contains("active"));
    wakeLock.syncForContext(isGameActive);
  }

  // --- Flag Question System (تحديد سؤال للمراجعة) ---
  function renderQuestionFlagUI() {
    if (!dom.btnFlagQuestion || !state.currentQ || !flaggedStore) return;
    const qId = state.currentQ.question.id;
    const existing = flaggedStore.getFlag(qId);
    const isFlagged = Boolean(existing);

    dom.btnFlagQuestion.classList.toggle("is-flagged", isFlagged);
    if (dom.btnFlagQuestionLabel) {
      dom.btnFlagQuestionLabel.textContent = isFlagged ? "محدّد للمراجعة" : "مراجعة";
    }
    if (dom.btnRemoveFlag) {
      dom.btnRemoveFlag.hidden = !isFlagged;
    }
    if (existing) {
      state.selectedFlagReason = existing.reason || "typo";
      if (dom.flagNoteInput) dom.flagNoteInput.value = existing.note || "";
    } else {
      state.selectedFlagReason = "typo";
      if (dom.flagNoteInput) dom.flagNoteInput.value = "";
    }
    syncFlagReasonChipsUI();
  }

  function syncFlagReasonChipsUI() {
    if (!dom.flagReasonChips) return;
    dom.flagReasonChips.querySelectorAll(".flag-reason-chip").forEach((chip) => {
      const isSelected = chip.dataset.flagReason === state.selectedFlagReason;
      chip.classList.toggle("active", isSelected);
      chip.setAttribute("aria-checked", String(isSelected));
    });
  }

  function openFlagDrawer() {
    if (!state.currentQ || !dom.flagQuestionDrawer) return;
    renderQuestionFlagUI();
    state.flagDrawerOpen = true;
    dom.flagQuestionDrawer.hidden = false;
    if (dom.btnFlagQuestion) dom.btnFlagQuestion.setAttribute("aria-expanded", "true");
  }

  function closeFlagDrawer() {
    state.flagDrawerOpen = false;
    if (dom.flagQuestionDrawer) dom.flagQuestionDrawer.hidden = true;
    if (dom.btnFlagQuestion) dom.btnFlagQuestion.setAttribute("aria-expanded", "false");
  }

  function toggleFlagDrawer() {
    if (state.flagDrawerOpen) {
      closeFlagDrawer();
    } else {
      openFlagDrawer();
    }
  }

  function saveCurrentQuestionFlag() {
    if (!state.currentQ || !flaggedStore) return;
    const cq = state.currentQ;
    const q = cq.question;
    const note = dom.flagNoteInput ? dom.flagNoteInput.value.trim() : "";

    const saved = flaggedStore.flagQuestion({
      questionId: q.id,
      categoryId: cq.category.id,
      categoryName: cq.category.name,
      points: Number(q.points) || 200,
      questionText: q.question || "",
      answerText: q.answer || "",
      reason: state.selectedFlagReason || "typo",
      note: note || undefined
    });

    if (saved) {
      renderQuestionFlagUI();
      closeFlagDrawer();
      const reasonMeta = flaggedStore.getReasonMeta(saved.reason);
      showToast(`🚩 تم تحديد السؤال للمراجعة (${reasonMeta.label})`, "success");
    }
  }

  function removeCurrentQuestionFlag() {
    if (!state.currentQ || !flaggedStore) return;
    const removed = flaggedStore.unflagQuestion(state.currentQ.question.id);
    if (removed) {
      renderQuestionFlagUI();
      closeFlagDrawer();
      showToast("تمت إزالة السؤال من قائمة المراجعة", "info");
    }
  }

  function renderBankFlaggedSection() {
    if (!flaggedStore || !dom.bankFlaggedList) return;
    const items = flaggedStore.getAll();
    const count = items.length;

    if (dom.bankFlaggedCount) {
      dom.bankFlaggedCount.textContent =
        count === 1 ? "سؤال واحد" : count === 2 ? "سؤالان" : `${count} أسئلة`;
    }
    if (dom.btnExportFlaggedCsv) dom.btnExportFlaggedCsv.disabled = count === 0;
    if (dom.btnCopyFlaggedJson) dom.btnCopyFlaggedJson.disabled = count === 0;
    if (dom.btnClearAllFlagged) dom.btnClearAllFlagged.disabled = count === 0;

    dom.bankFlaggedList.innerHTML = "";
    if (count === 0) {
      dom.bankFlaggedList.innerHTML = `
        <div class="bank-flagged-empty">
          لا توجد أسئلة محدّدة للمراجعة حالياً. يمكنك الضغط على <strong>«🚩 مراجعة»</strong> أثناء أي سؤال لتسجيل ملاحظة سريعة دون مقاطعة الجولة.
        </div>
      `;
      return;
    }

    items.forEach((item) => {
      const reasonMeta = flaggedStore.getReasonMeta(item.reason);
      const row = document.createElement("div");
      row.className = "bank-flagged-item";
      row.innerHTML = `
        <div class="flagged-item-main">
          <div class="flagged-item-meta">
            <span class="flagged-reason-badge">${reasonMeta.icon} ${escapeHtml(reasonMeta.label)}</span>
            <span class="flagged-cat-tag">${escapeHtml(item.categoryName || item.categoryId)} • ${item.points}</span>
            <code class="flagged-qid">${escapeHtml(item.questionId)}</code>
          </div>
          <div class="flagged-item-q">${escapeHtml(item.questionText)}</div>
          <div class="flagged-item-a">✅ ${escapeHtml(item.answerText)}</div>
          ${item.note ? `<div class="flagged-item-note">📝 ${escapeHtml(item.note)}</div>` : ""}
        </div>
      `;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-ghost btn-xxs flagged-remove-btn";
      removeBtn.textContent = "✓ تم";
      removeBtn.title = "إزالة هذا السؤال من قائمة المراجعة";
      removeBtn.addEventListener("click", () => {
        flaggedStore.unflagQuestion(item.questionId);
        renderBankFlaggedSection();
        if (state.currentQ && state.currentQ.question.id === item.questionId) {
          renderQuestionFlagUI();
        }
        showToast("تمت إزالة السؤال من قائمة المراجعة ✓", "info");
      });
      row.appendChild(removeBtn);
      dom.bankFlaggedList.appendChild(row);
    });
  }

  function exportFlaggedAsCSV() {
    if (!flaggedStore || flaggedStore.getCount() === 0) return;
    const csv = flaggedStore.exportCSV();
    const dateStr = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seen-jeem-flagged-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("📄 تم تنزيل ملف الأسئلة المحدّدة للمراجعة (CSV)", "success");
  }

  function copyFlaggedAsJSON() {
    if (!flaggedStore || flaggedStore.getCount() === 0) return;
    const json = flaggedStore.exportJSON();
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(json)
        .then(() => showToast("📋 تم نسخ قائمة الأسئلة المحدّدة بصيغة JSON", "success"))
        .catch(() => showToast("تعذّر النسخ للحافظة — استخدم زر تصدير CSV", "warning"));
    } else {
      showToast("تعذّر النسخ للحافظة — استخدم زر تصدير CSV", "warning");
    }
  }

  // --- Full Backup & Restore (النسخ الاحتياطي والاستعادة) ---
  function clearPendingBackupImport() {
    state.pendingBackupData = null;
    if (dom.backupImportPreview) dom.backupImportPreview.hidden = true;
    if (dom.inputImportBackupFile) dom.inputImportBackupFile.value = "";
  }

  function showBackupFeedback(type, message) {
    if (!dom.backupFeedbackBox) return;
    dom.backupFeedbackBox.className = `bank-feedback-box ${type === "error" ? "is-error" : "is-success"}`;
    dom.backupFeedbackBox.textContent = message;
    dom.backupFeedbackBox.hidden = false;
  }

  function handleExportFullBackup() {
    if (!backupManager) return;
    const { filename, summary } = backupManager.downloadBackupFile();
    showBackupFeedback(
      "success",
      `✅ تم تنزيل النسخة الاحتياطية (${filename}) — تشمل ${summary.profilesCount} مجموعة، ${summary.playedRecordsCount} سجل لعب، ${summary.flaggedCount} سؤال مراجعة، و${summary.customCategoriesCount} فئة مخصّصة.`
    );
    showToast("🛡️ تم تنزيل النسخة الاحتياطية الكاملة بنجاح", "success");
  }

  function handleBackupFileSelected(event) {
    if (!backupManager) return;
    const file = event.target && event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const check = backupManager.validateBackupObject(parsed);
        if (!check.ok) {
          clearPendingBackupImport();
          showBackupFeedback("error", `❌ ${check.error}`);
          return;
        }
        state.pendingBackupData = check.parsed;
        const p = check.preview;
        const dateLabel = p.exportedAt ? formatTimestampArabic(p.exportedAt) : "غير محدّد";
        if (dom.backupPreviewSummary) {
          dom.backupPreviewSummary.innerHTML = `
            <strong>📦 معاينة النسخة الاحتياطية</strong> (تاريخ التصدير: ${escapeHtml(dateLabel)})<br/>
            <span>المجموعات: <strong>${p.profilesCount}</strong></span> •
            <span>سجلات اللعب: <strong>${p.playedRecordsCount}</strong></span> •
            <span>أسئلة المراجعة: <strong>${p.flaggedCount}</strong></span> •
            <span>الفئات المخصّصة: <strong>${p.customCategoriesCount}</strong></span>
          `;
        }
        if (dom.backupImportPreview) dom.backupImportPreview.hidden = false;
        if (dom.backupFeedbackBox) dom.backupFeedbackBox.hidden = true;
      } catch (_err) {
        clearPendingBackupImport();
        showBackupFeedback("error", "❌ تعذّر قراءة الملف — تأكد أنه ملف JSON صالح.");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function confirmRestoreBackup() {
    if (!backupManager || !state.pendingBackupData) return;
    const res = backupManager.restoreBackupObject(state.pendingBackupData, state.backupRestoreMode);
    if (!res.ok) {
      showBackupFeedback("error", `❌ ${res.error || "تعذّرت الاستعادة"}`);
      return;
    }

    // تحديث جميع أجزاء التطبيق فوراً بالبيانات المستعادة
    state.customCategories = loadCustomCategoriesFromStorage();
    state.setupSettings = matchStore.loadSavedSettings();
    rebuildMergedCategories();
    syncSoundButtonsUI();
    syncWakeLockSetupUI();
    renderSetupScreen();
    renderBankManagerModal();
    renderBankFlaggedSection();
    clearPendingBackupImport();

    const modeLabel = res.mode === "replace" ? "الاستبدال الكامل" : "الدمج الآمن";
    showBackupFeedback("success", `✅ تمت استعادة النسخة الاحتياطية بنجاح (${modeLabel}) وتحديث الواجهة فوراً.`);
    showToast(`🛡️ تمت استعادة النسخة الاحتياطية (${modeLabel}) بنجاح!`, "success");
  }

  // --- Audio Mixer Popover (التحكم المتقدم بالصوت) ---
  function syncAudioMixerUI() {
    if (!window.SeenJeemAudio) return;
    const audio = window.SeenJeemAudio;
    const volPct = Math.round((typeof audio.getVolume === "function" ? audio.getVolume() : 0.8) * 100);
    const prefs =
      typeof audio.getCategoryPrefs === "function"
        ? audio.getCategoryPrefs()
        : { timerTicks: true, uiEffects: true, celebrations: true };
    const isMuted = audio.isMuted();

    if (dom.audioVolumeSlider) dom.audioVolumeSlider.value = String(volPct);
    if (dom.audioVolumeValue) dom.audioVolumeValue.textContent = isMuted ? "مكتوم" : `${volPct}%`;

    const setSw = (el, val) => {
      if (!el) return;
      el.classList.toggle("active", Boolean(val));
      el.setAttribute("aria-checked", String(Boolean(val)));
    };
    setSw(dom.toggleSfxTimer, prefs.timerTicks);
    setSw(dom.toggleSfxUi, prefs.uiEffects);
    setSw(dom.toggleSfxCelebrations, prefs.celebrations);

    if (dom.btnMixerMute) {
      dom.btnMixerMute.textContent = isMuted ? "🔊 إلغاء الكتم" : "🔇 كتم الكل";
    }
  }

  function closeAudioMixerPopover() {
    state.audioMixerOpen = false;
    if (dom.audioMixerPopover) dom.audioMixerPopover.hidden = true;
    if (dom.btnAudioMixerSetup) dom.btnAudioMixerSetup.setAttribute("aria-expanded", "false");
    if (dom.btnAudioMixerGame) dom.btnAudioMixerGame.setAttribute("aria-expanded", "false");
  }

  function toggleAudioMixerPopover(anchorBtn) {
    if (!dom.audioMixerPopover) return;
    if (state.audioMixerOpen) {
      closeAudioMixerPopover();
      return;
    }
    syncAudioMixerUI();
    state.audioMixerOpen = true;
    dom.audioMixerPopover.hidden = false;
    if (anchorBtn) {
      anchorBtn.setAttribute("aria-expanded", "true");
    }
  }

  /* =========================================================
     ربط الأحداث وتهيئة اللعبة (Init)
     ========================================================= */
  function bindEvents() {
    if (dom.btnToggleSoundSetup) {
      dom.btnToggleSoundSetup.addEventListener("click", toggleSoundMuted);
    }

    // قسم إعداد وسائل المساعدة القابل للطي في شاشة الإعداد
    if (dom.btnToggleTacticalPanel) {
      dom.btnToggleTacticalPanel.addEventListener("click", () => toggleTacticalSetupPanel());
    }
    if (dom.toggleHintEnabled) {
      dom.toggleHintEnabled.addEventListener("click", () => {
        updateSetupSetting({ hintEnabled: !state.setupSettings.hintEnabled });
      });
    }
    if (dom.toggleDoubleEnabled) {
      dom.toggleDoubleEnabled.addEventListener("click", () => {
        const currentlyOn = state.setupSettings.doubleEnabled && state.setupSettings.doubleCount > 0;
        if (currentlyOn) {
          updateSetupSetting({ doubleEnabled: false, doubleCount: 0 });
        } else {
          const restored = Math.max(1, state.preferredDoubleCount || 1);
          updateSetupSetting({ doubleEnabled: true, doubleCount: restored });
        }
      });
    }
    if (dom.toggleSwapEnabled) {
      dom.toggleSwapEnabled.addEventListener("click", () => {
        const currentlyOn = state.setupSettings.swapEnabled && state.setupSettings.swapCount > 0;
        if (currentlyOn) {
          updateSetupSetting({ swapEnabled: false, swapCount: 0 });
        } else {
          const restored = Math.max(1, state.preferredSwapCount || 1);
          updateSetupSetting({ swapEnabled: true, swapCount: restored });
        }
      });
    }
    if (dom.toggleStealEnabled) {
      dom.toggleStealEnabled.addEventListener("click", () => {
        updateSetupSetting({ stealEnabled: !state.setupSettings.stealEnabled });
      });
    }
    if (dom.tacticalSetupPanel) {
      dom.tacticalSetupPanel.querySelectorAll(".tactical-opt-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.setting;
          const val = Number(btn.dataset.value);
          if (key && Number.isFinite(val)) {
            updateSetupSetting({ [key]: val });
          }
        });
      });
    }
    if (dom.btnResetTacticalDefaults) {
      dom.btnResetTacticalDefaults.addEventListener("click", resetTacticalSettingsToDefaults);
    }

    // مُبدّل المجموعات
    if (dom.btnToggleNewProfile) {
      dom.btnToggleNewProfile.addEventListener("click", () => toggleNewProfileForm());
    }
    if (dom.btnCancelNewProfile) {
      dom.btnCancelNewProfile.addEventListener("click", () => toggleNewProfileForm(false));
    }
    if (dom.newProfileForm) {
      dom.newProfileForm.addEventListener("submit", (e) => {
        e.preventDefault();
        handleCreateProfile(dom.newProfileInput ? dom.newProfileInput.value : "");
      });
    }
    document.querySelectorAll(".profile-preset-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const preset = chip.dataset.preset || "";
        if (preset) {
          handleCreateProfile(preset);
        }
      });
    });

    dom.btnSyncSheets.addEventListener("click", () => syncFromGoogleSheets(true));
    dom.btnOpenBankManager.addEventListener("click", openBankManagerModal);
    dom.btnRandomCategories.addEventListener("click", selectRandomCategories);
    dom.btnResetHistory.addEventListener("click", openResetConfirmModal);
    dom.btnStartGame.addEventListener("click", startNewGame);

    if (dom.categorySearchInput) {
      dom.categorySearchInput.addEventListener("input", (e) => {
        state.searchQuery = e.target.value || "";
        renderSetupScreen();
      });
    }

    if (dom.btnClearSearch) {
      dom.btnClearSearch.addEventListener("click", () => {
        state.searchQuery = "";
        if (dom.categorySearchInput) {
          dom.categorySearchInput.value = "";
          dom.categorySearchInput.focus();
        }
        renderSetupScreen();
      });
    }

    if (dom.btnHideCompleted) {
      dom.btnHideCompleted.addEventListener("click", () => {
        state.hideCompleted = !state.hideCompleted;
        renderSetupScreen();
      });
    }

    if (dom.btnClearSelections) {
      dom.btnClearSelections.addEventListener("click", clearAllSelectedCategories);
    }

    // نافذة إدارة بنك الأسئلة
    dom.btnCloseBankManager.addEventListener("click", closeBankManagerModal);
    if (dom.btnBankFooterClose) {
      dom.btnBankFooterClose.addEventListener("click", closeBankManagerModal);
    }
    if (dom.btnBankResetHistory) {
      dom.btnBankResetHistory.addEventListener("click", openResetConfirmModal);
    }
    if (dom.btnBankProfileReset) {
      dom.btnBankProfileReset.addEventListener("click", openResetConfirmModal);
    }
    if (dom.bankCategorySearch) {
      dom.bankCategorySearch.addEventListener("input", (e) => {
        state.bankSearchQuery = e.target.value || "";
        renderBankCategoriesOverview();
      });
    }
    if (dom.btnClearBankSearch) {
      dom.btnClearBankSearch.addEventListener("click", () => {
        state.bankSearchQuery = "";
        if (dom.bankCategorySearch) {
          dom.bankCategorySearch.value = "";
          dom.bankCategorySearch.focus();
        }
        renderBankCategoriesOverview();
      });
    }
    dom.bankManagerModal.addEventListener("click", (e) => {
      if (e.target === dom.bankManagerModal) {
        closeBankManagerModal();
      }
    });
    dom.btnImportJson.addEventListener("click", handleImportJson);
    dom.btnClearJsonInput.addEventListener("click", () => {
      dom.bankJsonInput.value = "";
      dom.bankImportFeedback.hidden = true;
      dom.bankJsonInput.focus();
    });
    dom.btnExportExtraJs.addEventListener("click", exportExtraQuestionsFile);
    dom.btnClearAllCustom.addEventListener("click", requestClearAllCustomCategories);

    // نافذة التأكيد العامة
    dom.btnConfirmCancel.addEventListener("click", closeConfirmDialog);
    dom.btnConfirmOk.addEventListener("click", () => {
      const action = state.pendingConfirmAction;
      closeConfirmDialog();
      if (typeof action === "function") {
        action();
      }
    });

    // نافذة استئناف المباراة المحفوظة
    if (dom.btnResumeSavedMatch) {
      dom.btnResumeSavedMatch.addEventListener("click", resumeSavedMatch);
    }
    if (dom.btnDiscardSavedMatch) {
      dom.btnDiscardSavedMatch.addEventListener("click", discardSavedMatchAndStartFresh);
    }

    // الشريط العلوي للوحة اللعب وزر التراجع
    document.querySelectorAll(".score-adjust-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const teamIdx = Number(btn.dataset.team);
        const delta = Number(btn.dataset.delta);
        adjustScore(teamIdx, delta);
      });
    });

    if (dom.btnUndoAction) {
      dom.btnUndoAction.addEventListener("click", performUndo);
    }
    dom.btnSwitchTurn.addEventListener("click", switchTurnManually);
    dom.btnEndRound.addEventListener("click", () => openWinnerModal(true));
    if (dom.btnReturnSetup) {
      dom.btnReturnSetup.addEventListener("click", () => {
        openConfirmDialog({
          title: "العودة لاختيار الفئات؟",
          message:
            "سيتم إنهاء الجولة الحالية والعودة لشاشة اختيار الفئات. الأسئلة التي لُعبت بالفعل ستبقى محفوظة في سجل المجموعة النشطة.",
          confirmText: "نعم، عُد للفئات",
          onConfirm: returnToSetupScreen
        });
      });
    }

    dom.btnToggleSound.addEventListener("click", toggleSoundMuted);
    if (dom.btnToggleFullscreen) {
      dom.btnToggleFullscreen.addEventListener("click", toggleFullscreen);
    }
    document.addEventListener("fullscreenchange", syncFullscreenButtonUI);
    document.addEventListener("webkitfullscreenchange", syncFullscreenButtonUI);

    // المؤقت القياسي ومؤقت «من غير كلام»
    dom.btnTimerToggle.addEventListener("click", toggleTimer);
    dom.btnTimerReset.addEventListener("click", () => {
      if (!state.currentQ || state.currentQ.revealed || isMemoryLockedPhase()) return;
      if (state.currentQ.phase === "steal-active") {
        startTimer(state.matchSettings.stealTimerSeconds || 15, "steal");
      } else {
        startMainQuestionTimer();
      }
      persistActiveMatch();
    });

    if (dom.btnCharadesTimerToggle) {
      dom.btnCharadesTimerToggle.addEventListener("click", toggleCharadesTimer);
    }
    if (dom.btnCharadesTimerReset) {
      dom.btnCharadesTimerReset.addEventListener("click", resetCharadesTimer);
    }
    if (dom.charadesDurationPills) {
      dom.charadesDurationPills.querySelectorAll(".charades-dur-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
          setCharadesDuration(Number(pill.dataset.charadesSec));
        });
      });
    }

    // آلية اضغط مع الاستمرار لكشف الكلمة سراً (Pointer Events + Mouse/Touch Fallbacks)
    if (dom.btnHoldRevealSecret) {
      const startHold = (e) => {
        if (e.type === "mousedown" && e.button !== 0) return;
        if (e.type === "pointerdown" && e.pointerType === "mouse" && e.button !== 0) return;
        if (e.cancelable) e.preventDefault();
        showCharadesSecret();
      };
      dom.btnHoldRevealSecret.addEventListener("pointerdown", startHold);
      dom.btnHoldRevealSecret.addEventListener("pointerup", hideCharadesSecret);
      dom.btnHoldRevealSecret.addEventListener("pointerleave", hideCharadesSecret);
      dom.btnHoldRevealSecret.addEventListener("pointercancel", hideCharadesSecret);
      dom.btnHoldRevealSecret.addEventListener("mousedown", startHold);
      dom.btnHoldRevealSecret.addEventListener("mouseup", hideCharadesSecret);
      dom.btnHoldRevealSecret.addEventListener("mouseleave", hideCharadesSecret);
      dom.btnHoldRevealSecret.addEventListener("touchstart", startHold, { passive: false });
      dom.btnHoldRevealSecret.addEventListener("touchend", hideCharadesSecret);
      dom.btnHoldRevealSecret.addEventListener("touchcancel", hideCharadesSecret);
      dom.btnHoldRevealSecret.addEventListener("contextmenu", (e) => e.preventDefault());
      dom.btnHoldRevealSecret.addEventListener("selectstart", (e) => e.preventDefault());
    }
    if (dom.charadesActorStage) {
      dom.charadesActorStage.addEventListener("contextmenu", (e) => e.preventDefault());
      dom.charadesActorStage.addEventListener("selectstart", (e) => e.preventDefault());
    }
    window.addEventListener("pointerup", () => {
      if (state.charadesHoldActive) hideCharadesSecret();
    });
    window.addEventListener("mouseup", () => {
      if (state.charadesHoldActive) hideCharadesSecret();
    });
    window.addEventListener("touchend", () => {
      if (state.charadesHoldActive) hideCharadesSecret();
    });
    window.addEventListener("blur", () => {
      if (state.charadesHoldActive) hideCharadesSecret();
    });

    // عناصر الأسئلة الصورية والتفاعلية والتلميح وتبديل السؤال
    dom.btnReduceBlur.addEventListener("click", reduceBlurLevel);
    dom.btnReduceZoom.addEventListener("click", reduceZoomLevel);
    dom.btnShowHint.addEventListener("click", useQuestionHint);
    if (dom.btnSwapQuestion) {
      dom.btnSwapQuestion.addEventListener("click", swapCurrentQuestion);
    }
    dom.btnMemoryStart.addEventListener("click", () => startMemoryViewingPhase(false));
    dom.btnMemorySkip.addEventListener("click", finishMemoryViewingPhase);

    if (dom.btnRetryVisualImage) {
      dom.btnRetryVisualImage.addEventListener("click", (e) => {
        e.stopPropagation();
        retryCurrentQuestionImage();
      });
    }
    if (dom.btnSkipBrokenMemory) {
      dom.btnSkipBrokenMemory.addEventListener("click", (e) => {
        e.stopPropagation();
        finishMemoryViewingPhase();
      });
    }
    if (dom.btnRetryAnswerImage) {
      dom.btnRetryAnswerImage.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!state.currentAnswerImgSrc) return;
        state.answerImageRetryCount++;
        loadAnswerStageImage(state.currentAnswerImgSrc, state.answerImageRetryCount);
      });
    }

    // منع سحب الصورة أو حفظها بالزر الأيمن لمنع الغش أثناء اللعب
    const preventImageCheat = (e) => {
      if (
        state.currentQ &&
        !state.currentQ.revealed &&
        (MASKED_VISUAL_TYPES.has(state.currentQ.visualType) ||
          (state.currentQ.visualType === "memory" && isMemoryLockedPhase()))
      ) {
        e.preventDefault();
      }
    };
    dom.visualImageStage.addEventListener("contextmenu", preventImageCheat);
    dom.visualImageStage.addEventListener("dragstart", preventImageCheat);
    dom.modalQuestionImage.addEventListener("contextmenu", preventImageCheat);
    dom.modalQuestionImage.addEventListener("dragstart", preventImageCheat);

    dom.visualImageStage.addEventListener("click", () => {
      if (!dom.visualImageStage.classList.contains("is-zoomable")) return;
      const src = dom.modalQuestionImage.getAttribute("src");
      if (!src) return;
      const caption = state.currentQ
        ? `${state.currentQ.category.name} — صورة السؤال`
        : "صورة السؤال";
      openLightbox([{ src, caption }], 0);
    });

    dom.modalAnswerImageWrap.addEventListener("click", () => {
      if (dom.answerImageStage && !dom.answerImageStage.classList.contains("is-zoomable")) return;
      const src = dom.modalAnswerImage.getAttribute("src");
      if (!src) return;
      const caption = state.currentQ
        ? `${state.currentQ.category.name} — صورة الإجابة`
        : "صورة الإجابة";
      openLightbox([{ src, caption }], 0);
    });

    // عارض تكبير الصور (Lightbox)
    dom.btnLightboxClose.addEventListener("click", closeLightbox);
    dom.btnLightboxPrev.addEventListener("click", (e) => {
      e.stopPropagation();
      stepLightbox(-1);
    });
    dom.btnLightboxNext.addEventListener("click", (e) => {
      e.stopPropagation();
      stepLightbox(1);
    });
    dom.imageLightbox.addEventListener("click", (e) => {
      if (e.target === dom.imageLightbox) {
        closeLightbox();
      }
    });

    // أزرار السؤال والإجابة والسرقة
    dom.btnCancelQuestion.addEventListener("click", cancelCurrentQuestion);
    dom.btnRevealAnswer.addEventListener("click", () => revealAnswer(false));
    if (dom.btnWrongAnswer) {
      dom.btnWrongAnswer.addEventListener("click", handleWrongAnswerClick);
    }
    if (dom.btnOpenSteal) {
      dom.btnOpenSteal.addEventListener("click", openStealPhase);
    }
    if (dom.btnSkipStealClose) {
      dom.btnSkipStealClose.addEventListener("click", closeWithoutPointsAndReveal);
    }
    if (dom.btnCancelStealOffer) {
      dom.btnCancelStealOffer.addEventListener("click", cancelStealOffer);
    }
    if (dom.btnStealSuccess) {
      dom.btnStealSuccess.addEventListener("click", () => resolveSteal(true));
    }
    if (dom.btnStealFail) {
      dom.btnStealFail.addEventListener("click", () => resolveSteal(false));
    }
    if (dom.btnStealPeekAnswer) {
      dom.btnStealPeekAnswer.addEventListener("click", peekAnswerDuringSteal);
    }
    if (dom.btnFinishClosingReveal) {
      dom.btnFinishClosingReveal.addEventListener("click", finishClosingRevealImmediately);
    }

    dom.btnAwardTeam1.addEventListener("click", () => awardQuestion(0));
    dom.btnAwardTeam2.addEventListener("click", () => awardQuestion(1));
    dom.btnAwardNone.addEventListener("click", () => awardQuestion(null));

    // شاشة الفائز وإحصائيات المباراة
    if (dom.btnTabAnalyticsOverview) {
      dom.btnTabAnalyticsOverview.addEventListener("click", () => switchAnalyticsTab("overview"));
    }
    if (dom.btnTabAnalyticsLog) {
      dom.btnTabAnalyticsLog.addEventListener("click", () => switchAnalyticsTab("log"));
    }
    if (dom.btnCopyMatchSummary) {
      dom.btnCopyMatchSummary.addEventListener("click", copyMatchSummaryToClipboard);
    }

    // أزرار وضع الشاشتين (TV Display) ولوحة المقدّم
    if (dom.btnOpenTvDisplay) {
      dom.btnOpenTvDisplay.addEventListener("click", openTVDisplayWindow);
    }
    if (dom.btnToggleAudioRoute) {
      dom.btnToggleAudioRoute.addEventListener("click", toggleDualAudioRoute);
    }
    if (dom.btnResyncTv) {
      dom.btnResyncTv.addEventListener("click", () => {
        broadcastLiveDisplayState();
        showToast("تمت إعادة مزامنة شاشة العرض التلفزيوني 🔄", "success");
      });
    }
    if (dom.btnCloseTv) {
      dom.btnCloseTv.addEventListener("click", () => {
        if (liveSync) liveSync.closeDisplayWindow();
        showToast("تم فصل شاشة العرض — عاد التطبيق لوضع الشاشة الواحدة", "info");
      });
    }
    if (dom.btnHostCockpitUndo) {
      dom.btnHostCockpitUndo.addEventListener("click", () => performInModalUndo());
    }
    if (dom.btnHostProjectHint) {
      dom.btnHostProjectHint.addEventListener("click", useQuestionHint);
    }
    if (dom.team1Input) {
      dom.team1Input.addEventListener("input", () => {
        if (state.dualScreen.connected) broadcastLiveDisplayState();
      });
    }
    if (dom.team2Input) {
      dom.team2Input.addEventListener("input", () => {
        if (state.dualScreen.connected) broadcastLiveDisplayState();
      });
    }

    if (dom.btnRematchRound) {
      dom.btnRematchRound.addEventListener("click", startNewGame);
    }
    dom.btnNewRound.addEventListener("click", returnToSetupScreen);
    dom.btnResumeRound.addEventListener("click", () => {
      stopVictoryConfetti();
      closeModal(dom.winnerModal);
      persistActiveMatch();
    });

    // أحداث الحزمة الرابعة: PWA، Wake Lock، التشكيلة المتوازنة، مراجعة الأسئلة، النسخ الاحتياطي، ولوحة الصوت
    if (dom.btnInstallPwa) {
      dom.btnInstallPwa.addEventListener("click", async () => {
        if (!pwaManager) return;
        const res = await pwaManager.promptInstall();
        if (res.ok) {
          showToast("📲 تم تثبيت تطبيق «سين جيم» بنجاح! يعمل الآن حتى دون إنترنت.", "success");
        }
      });
    }

    if (dom.toggleWakelockEnabled) {
      dom.toggleWakelockEnabled.addEventListener("click", () => {
        if (!wakeLock) return;
        const next = wakeLock.setEnabled(!wakeLock.isEnabled());
        syncWakeLockSetupUI();
        showToast(
          next
            ? "☀️ تم تفعيل منع إطفاء الشاشة أثناء اللعب والعرض"
            : "تم إيقاف منع إطفاء الشاشة (Wake Lock)",
          "info"
        );
      });
    }

    if (dom.btnBalancedCategories) {
      dom.btnBalancedCategories.addEventListener("click", selectBalancedCategories);
    }

    // تحديد السؤال للمراجعة داخل نافذة السؤال
    if (dom.btnFlagQuestion) {
      dom.btnFlagQuestion.addEventListener("click", toggleFlagDrawer);
    }
    if (dom.btnCloseFlagDrawer) {
      dom.btnCloseFlagDrawer.addEventListener("click", closeFlagDrawer);
    }
    if (dom.flagReasonChips) {
      dom.flagReasonChips.querySelectorAll(".flag-reason-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          state.selectedFlagReason = chip.dataset.flagReason || "typo";
          syncFlagReasonChipsUI();
        });
      });
    }
    if (dom.btnSaveFlag) {
      dom.btnSaveFlag.addEventListener("click", saveCurrentQuestionFlag);
    }
    if (dom.btnRemoveFlag) {
      dom.btnRemoveFlag.addEventListener("click", removeCurrentQuestionFlag);
    }

    // قسم الأسئلة المحدّدة للمراجعة داخل إدارة البنك
    if (dom.btnExportFlaggedCsv) {
      dom.btnExportFlaggedCsv.addEventListener("click", exportFlaggedAsCSV);
    }
    if (dom.btnCopyFlaggedJson) {
      dom.btnCopyFlaggedJson.addEventListener("click", copyFlaggedAsJSON);
    }
    if (dom.btnClearAllFlagged) {
      dom.btnClearAllFlagged.addEventListener("click", () => {
        if (!flaggedStore || flaggedStore.getCount() === 0) return;
        openConfirmModal({
          title: "مسح جميع الأسئلة المحدّدة للمراجعة؟",
          message: `سيتم حذف ${flaggedStore.getCount()} سؤالاً من قائمة المراجعة المحلية (يمكنك تصدير CSV قبل المسح).`,
          okText: "نعم، امسح القائمة",
          onConfirm: () => {
            flaggedStore.clearAll();
            renderBankFlaggedSection();
            showToast("تم مسح قائمة مراجعة الأسئلة", "info");
          }
        });
      });
    }

    // النسخ الاحتياطي والاستعادة الكاملة
    if (dom.btnExportFullBackup) {
      dom.btnExportFullBackup.addEventListener("click", handleExportFullBackup);
    }
    if (dom.inputImportBackupFile) {
      dom.inputImportBackupFile.addEventListener("change", handleBackupFileSelected);
    }
    document.querySelectorAll(".backup-mode-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        state.backupRestoreMode = pill.dataset.backupMode === "replace" ? "replace" : "merge";
        document.querySelectorAll(".backup-mode-pill").forEach((p) => {
          p.classList.toggle("active", p === pill);
        });
      });
    });
    if (dom.btnConfirmRestoreBackup) {
      dom.btnConfirmRestoreBackup.addEventListener("click", confirmRestoreBackup);
    }
    if (dom.btnCancelRestoreBackup) {
      dom.btnCancelRestoreBackup.addEventListener("click", clearPendingBackupImport);
    }

    // لوحة التحكم المتقدمة بالصوت (Audio Mixer Popover)
    if (dom.btnAudioMixerSetup) {
      dom.btnAudioMixerSetup.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleAudioMixerPopover(dom.btnAudioMixerSetup);
      });
    }
    if (dom.btnAudioMixerGame) {
      dom.btnAudioMixerGame.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleAudioMixerPopover(dom.btnAudioMixerGame);
      });
    }
    if (dom.btnCloseAudioMixer) {
      dom.btnCloseAudioMixer.addEventListener("click", closeAudioMixerPopover);
    }
    if (dom.audioVolumeSlider) {
      dom.audioVolumeSlider.addEventListener("input", () => {
        if (!window.SeenJeemAudio) return;
        const pct = Number(dom.audioVolumeSlider.value);
        window.SeenJeemAudio.setVolume(pct / 100);
        syncSoundButtonsUI();
      });
    }
    if (dom.toggleSfxTimer) {
      dom.toggleSfxTimer.addEventListener("click", () => {
        if (!window.SeenJeemAudio) return;
        const cur = window.SeenJeemAudio.getCategoryPrefs();
        window.SeenJeemAudio.setCategoryPrefs({ timerTicks: !cur.timerTicks });
        syncAudioMixerUI();
      });
    }
    if (dom.toggleSfxUi) {
      dom.toggleSfxUi.addEventListener("click", () => {
        if (!window.SeenJeemAudio) return;
        const cur = window.SeenJeemAudio.getCategoryPrefs();
        window.SeenJeemAudio.setCategoryPrefs({ uiEffects: !cur.uiEffects });
        syncAudioMixerUI();
      });
    }
    if (dom.toggleSfxCelebrations) {
      dom.toggleSfxCelebrations.addEventListener("click", () => {
        if (!window.SeenJeemAudio) return;
        const cur = window.SeenJeemAudio.getCategoryPrefs();
        window.SeenJeemAudio.setCategoryPrefs({ celebrations: !cur.celebrations });
        syncAudioMixerUI();
      });
    }
    if (dom.btnTestAudio) {
      dom.btnTestAudio.addEventListener("click", () => {
        if (!window.SeenJeemAudio) return;
        if (window.SeenJeemAudio.isMuted()) {
          window.SeenJeemAudio.setMuted(false);
          syncSoundButtonsUI();
        }
        window.SeenJeemAudio.playTestChime();
      });
    }
    if (dom.btnMixerMute) {
      dom.btnMixerMute.addEventListener("click", toggleSoundMuted);
    }
    document.addEventListener("click", (e) => {
      if (!state.audioMixerOpen || !dom.audioMixerPopover) return;
      if (
        !dom.audioMixerPopover.contains(e.target) &&
        e.target !== dom.btnAudioMixerSetup &&
        e.target !== dom.btnAudioMixerGame
      ) {
        closeAudioMixerPopover();
      }
    });

    // اختصارات لوحة المفاتيح وحفظ الحالة عند إخفاء التبويب أو الإغلاق
    document.addEventListener("keydown", handleGlobalKeydown);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) handlePageLifecycleSave();
    });
    window.addEventListener("beforeunload", cleanupAppResources);
  }

  function init() {
    // 0) التوجيه التلقائي لوضع شاشة العرض التلفزيوني (?mode=display) المتوافق مع النشر الساكن
    if (liveSync && liveSync.isDisplayMode()) {
      if (window.SeenJeemDisplayView && typeof window.SeenJeemDisplayView.init === "function") {
        window.SeenJeemDisplayView.init();
      }
      return;
    }

    const data = window.SEEN_JEEM_DATA;
    if (!data || !Array.isArray(data.categories)) {
      console.error("تعذر تحميل بنك الأسئلة window.SEEN_JEEM_DATA");
      showToast("خطأ في تحميل ملف بنك الأسئلة!", "warning");
      return;
    }

    // 1) تنقية المصادر المحلية عبر المنقّي الدفاعي
    const localSeenIds = new Set();
    const cleanBase = sanitizer.sanitizeCategoriesTree(data.categories, {
      allowLegacyLocalVisuals: true,
      seenQuestionIds: localSeenIds
    });
    const rawExtras = Array.isArray(window.SEEN_JEEM_EXTRA_CATEGORIES)
      ? window.SEEN_JEEM_EXTRA_CATEGORIES
      : [];
    const cleanExtras = sanitizer.sanitizeCategoriesTree(rawExtras, {
      allowLegacyLocalVisuals: true,
      seenQuestionIds: localSeenIds
    });

    state.baseCategories = cleanBase.categories;
    state.extraCategories = cleanExtras.categories;
    state.customCategories = loadCustomCategoriesFromStorage();
    state.localDiagnostics = {
      cleanedRowsCount:
        cleanBase.diagnostics.cleanedRowsCount + cleanExtras.diagnostics.cleanedRowsCount,
      duplicateCount:
        cleanBase.diagnostics.duplicateCount + cleanExtras.diagnostics.duplicateCount,
      duplicateIds: [
        ...cleanBase.diagnostics.duplicateIds,
        ...cleanExtras.diagnostics.duplicateIds
      ]
    };

    // 2) الإقلاع الفوري من الكاش المحلي المنقّى إن وُجد (Stale-While-Revalidate)
    const cachedSheets = sanitizer.loadCachedSheetsBank();
    if (cachedSheets && cachedSheets.categories.length > 0) {
      state.sheetsCategories = cachedSheets.categories;
      state.sheetsDiagnostics = cachedSheets.diagnostics;
      state.lastSheetsSyncAt = cachedSheets.syncedAt;
      state.sheetsSourceState = "cache";
    }

    // 3) تهيئة قناة المزامنة الفورية وموجّه الصوت لوضع الشاشتين
    installHostAudioRouter();
    if (liveSync && liveSync.isSupported()) {
      liveSync.connect();
      liveSync.onConnectionChange((isConnected) => {
        state.dualScreen.connected = isConnected;
        renderDualScreenStatusUI();
        if (isConnected) {
          broadcastLiveDisplayState();
          showToast("🟢 شاشة العرض التلفزيوني متصلة الآن — تم تفعيل لوحة المقدّم!", "success");
        } else {
          showToast("⚪ انفصلت شاشة العرض — عاد التطبيق لوضع الشاشة الواحدة", "info");
        }
      });
      liveSync.onMessage((msg) => {
        if (msg && msg.type === "SYNC_REQUEST") {
          broadcastLiveDisplayState();
        }
      });
    }

    rebuildMergedCategories();
    bindEvents();
    initPwaUI();
    syncSoundButtonsUI();
    syncWakeLockSetupUI();
    initFullscreenControls();
    renderDualScreenStatusUI();
    renderSetupScreen();

    if (cachedSheets && cachedSheets.categories.length > 0) {
      setSheetsStatus(
        "success",
        `⚡ تم تحميل البنك فوراً من الكاش المحلي (آخر مزامنة: ${formatTimestampArabic(cachedSheets.syncedAt)})`,
        false
      );
    }

    // 3) التحقق من وجود مباراة جارية محفوظة تلقائياً لعرض نافذة الاستئناف
    const savedMatch = matchStore.loadSavedMatch();
    if (savedMatch) {
      openResumeMatchPrompt(savedMatch);
    }

    // 4) مزامنة وتحديث البيانات من Google Sheets في الخلفية
    syncFromGoogleSheets(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
