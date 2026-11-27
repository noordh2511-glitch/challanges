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
  const finalRoundEngine = window.SeenJeemFinalRound;
  const imagePreloader = window.SeenJeemImagePreloader;
  const liveSync = window.SeenJeemLiveSync;
  const wakeLock = window.SeenJeemWakeLock;
  const flaggedStore = window.SeenJeemFlaggedStore;
  const archiveStore = window.SeenJeemArchiveStore;
  const blitzEngine = window.SeenJeemBlitzMode;
  const charadesEngine = window.SeenJeemCharadesMode;
  const realtimeSync = window.SeenJeemRealtimeSync;
  const realtimeUtils = window.SeenJeemRealtimeUtils;
  const qrGenerator = window.SeenJeemQR;
  const firebaseCfgStore = window.SeenJeemFirebaseConfig;
  const backupManager = window.SeenJeemBackup;
  const resultCardGen = window.SeenJeemResultCard;
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
    differences: { icon: "🔍", label: "أوجد الفروقات" },
    "spot-diff": { icon: "👀", label: "أوجد الفروقات" },
    audio: { icon: "🎵", label: "تحدي صوتي" },
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

    // حالة أدوات الحزمة الرابعة والخامسة (مراجعة الأسئلة، النسخ الاحتياطي، الصوت، التحكيم، الجولة النهائية)
    flagDrawerOpen: false,
    selectedFlagReason: "wrong-answer",
    pendingBackupData: null,
    backupRestoreMode: "merge",
    audioMixerOpen: false,
    refereeAdjustments: [],
    refereePopoverTeamIdx: null,
    finalRound: null,
    finalTimerInterval: null,
    // حالة الحزمة السادسة (الثيم، مقياس التلفزيون، شاشة الاستراحة، وبطاقة النتيجة)
    theme: matchStore ? matchStore.loadTheme() : "dark-glass",
    tvScale: matchStore ? matchStore.loadTvScale() : 100,
    intermission: matchStore
      ? matchStore.getDefaultIntermission()
      : { active: false, message: "استراحة قصيرة — نعود بعد قليل", durationMinutes: 0, totalSeconds: 0, remainingSeconds: 0 },
    intermissionInterval: null,
    intermissionSelectedMinutes: 0,
    currentResultCardBlob: null,
    currentResultCardUrl: "",
    currentResultCardPrefix: "seen-jeem-result",
    customResultCardPayload: null,
    // حالة الحزمة السابعة (المعرف الفريد للمباراة، البرق السريع، من غير كلام المستقل، قاعة المشاهير)
    matchId: "",
    activeTournamentMatch: null,
    blitz: null,
    blitzTimerInterval: null,
    blitzConfig: { teamCount: 1, durationSeconds: 60, roundsPerTeam: 1, groupId: "all" },
    blitzLastFeedback: null,
    charadesSolo: null,
    csoloTimerInterval: null,
    csoloConfig: { teamCount: 2, durationSeconds: 90, roundsPerTeam: 3, skipLimit: 2, selectedCategoryIds: [] },
    csoloHoldActive: false,
    csoloLastFeedback: null,
    hofModeFilter: "all",
    hofActiveView: "seen-jeem",
    audioChallenge: {
      route: "display", // "display" (افتراضي مانع للصدى عند اتصال التلفزيون) | "host"
      status: {
        playing: false,
        teaserActive: false,
        currentTime: 0,
        duration: 0,
        volume: 0.85,
        autoplayBlocked: false,
        error: ""
      }
    },
    // حالة الحزمة التاسعة والعاشرة (الغرفة اللاسلكية عبر Firebase + تحصين الحزمة وإدارة الأجهزة)
    timerStatus: "idle", // "idle" | "running" | "paused" | "finished" | "unlimited"
    timerDurationMs: 0,
    timerEndAtMs: null,
    timerRemainingMs: 0,
    memoryTimerStatus: "idle",
    memoryTimerDurationMs: 0,
    memoryTimerEndAtMs: null,
    memoryTimerRemainingMs: 0,
    wireless: {
      active: false,
      connected: false,
      roomCode: "",
      hostToken: "",
      remoteUrl: "",
      playerUrl: "",
      showQrOnTv: false,
      hostQrHidden: false,
      settingsOpen: false,
      joinLocked: false,
      maxDevicesPerTeam: 0, // 0 = غير محدود | 1 = جهاز واحد لكل فريق
      stats: { writes: 0, skippedWrites: 0, bytesSent: 0, kbSent: 0, mediaUploads: 0 },
      buzzer: {
        state: "locked", // "locked" | "open" | "buzzed"
        roundId: "",
        winnerTeamIdx: null,
        winnerTeamName: "",
        runnerUpDeltaMs: null
      },
      playersMap: {},
      receivedWagers: {},
      allPlay: {
        active: false,
        phase: "idle", // "idle" | "open" | "revealed"
        questionId: "",
        answers: {}, // { [teamIdx]: { teamIdx, text, submittedAt, manual } }
        judgments: {} // { [teamIdx]: true | false | null }
      }
    }
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
    setupVolumeSlider: document.getElementById("setup-volume-slider"),
    setupVolumePct: document.getElementById("setup-volume-pct"),
    gameVolumeSlider: document.getElementById("game-volume-slider"),
    gameVolumePct: document.getElementById("game-volume-pct"),
    teamCountSelector: document.getElementById("team-count-selector"),
    teamsInputsGrid: document.getElementById("teams-inputs-grid"),
    teamsVsDivider: document.getElementById("teams-vs-divider"),
    team1Input: document.getElementById("team1-input"),
    team2Input: document.getElementById("team2-input"),
    team3Input: document.getElementById("team3-input"),
    team4Input: document.getElementById("team4-input"),
    teamInputCard3: document.getElementById("team-input-card-3"),
    teamInputCard4: document.getElementById("team-input-card-4"),
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

    // الشريط العلوي للوحة اللعب وزر التراجع (يدعم 2-4 فرق)
    scoreboardTeamsGrid: document.getElementById("scoreboard-teams-grid"),
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
    winnerScoresGrid: document.getElementById("winner-scores-grid"),
    winnerStatsNote: document.getElementById("winner-stats-note"),
    winnerRefereeNote: document.getElementById("winner-referee-note"),
    btnStartTiebreakerFromWinner: document.getElementById("btn-start-tiebreaker-from-winner"),

    // نافذة جولة الرهان النهائي وكسر التعادل (Phase 4 Pack 5)
    finalRoundModal: document.getElementById("final-round-modal"),
    finalRoundEyebrow: document.getElementById("final-round-eyebrow"),
    finalRoundTitle: document.getElementById("final-round-title"),
    finalTvStatusPill: document.getElementById("final-tv-status-pill"),
    btnFinalCancel: document.getElementById("btn-final-cancel"),
    finalStepWager: document.getElementById("final-step-wager"),
    finalStepQuestion: document.getElementById("final-step-question"),
    finalStepReveal: document.getElementById("final-step-reveal"),
    finalCatIcon: document.getElementById("final-cat-icon"),
    finalCatName: document.getElementById("final-cat-name"),
    finalQTierPill: document.getElementById("final-q-tier-pill"),
    btnFinalReroll: document.getElementById("btn-final-reroll"),
    finalPhaseWager: document.getElementById("final-phase-wager"),
    finalWagersGrid: document.getElementById("final-wagers-grid"),
    finalPhaseQuestion: document.getElementById("final-phase-question"),
    finalTimerDisplay: document.getElementById("final-timer-display"),
    finalTimerLabel: document.getElementById("final-timer-label"),
    finalTimerProgress: document.getElementById("final-timer-progress"),
    btnFinalTimerToggle: document.getElementById("btn-final-timer-toggle"),
    finalTimerToggleIcon: document.getElementById("final-timer-toggle-icon"),
    finalTimerToggleText: document.getElementById("final-timer-toggle-text"),
    btnFinalTimerReset: document.getElementById("btn-final-timer-reset"),
    finalQuestionText: document.getElementById("final-question-text"),
    finalHostAnswerBox: document.getElementById("final-host-answer-box"),
    finalHostAnswerText: document.getElementById("final-host-answer-text"),
    finalHostExpRow: document.getElementById("final-host-exp-row"),
    finalHostExpText: document.getElementById("final-host-exp-text"),
    finalJudgmentsGrid: document.getElementById("final-judgments-grid"),
    finalPhaseReveal: document.getElementById("final-phase-reveal"),
    finalRevealAnswerText: document.getElementById("final-reveal-answer-text"),
    finalRevealExpText: document.getElementById("final-reveal-exp-text"),
    finalResultsGrid: document.getElementById("final-results-grid"),
    btnFinalShowQuestion: document.getElementById("btn-final-show-question"),
    btnFinalRevealResults: document.getElementById("btn-final-reveal-results"),
    finalRevealFooterActions: document.getElementById("final-reveal-footer-actions"),
    btnFinalExtraTiebreaker: document.getElementById("btn-final-extra-tiebreaker"),
    btnFinalGoWinner: document.getElementById("btn-final-go-winner"),

    // الحزمة السادسة: بطاقة النتيجة، لوحة المؤثرات، شاشة الاستراحة، الثيم ومقياس التلفزيون
    setupTvScaleSlider: document.getElementById("setup-tv-scale-slider"),
    setupTvScaleVal: document.getElementById("setup-tv-scale-val"),
    btnResetTvScaleSetup: document.getElementById("btn-reset-tv-scale-setup"),
    btnOpenSoundboard: document.getElementById("btn-open-soundboard"),
    btnOpenIntermission: document.getElementById("btn-open-intermission"),
    btnOpenDisplayPrefs: document.getElementById("btn-open-display-prefs"),
    hostIntermissionActiveBar: document.getElementById("host-intermission-active-bar"),
    hostIntermissionCountdown: document.getElementById("host-intermission-countdown"),
    btnResumeFromIntermission: document.getElementById("btn-resume-from-intermission"),
    btnSoundboardInQuestion: document.getElementById("btn-soundboard-in-question"),
    btnIntermissionInQuestion: document.getElementById("btn-intermission-in-question"),
    btnOpenResultCard: document.getElementById("btn-open-result-card"),
    resultCardModal: document.getElementById("result-card-modal"),
    btnCloseResultCard: document.getElementById("btn-close-result-card"),
    resultCardLoading: document.getElementById("result-card-loading"),
    resultCardPreviewImg: document.getElementById("result-card-preview-img"),
    btnDownloadResultCard: document.getElementById("btn-download-result-card"),
    btnShareResultCard: document.getElementById("btn-share-result-card"),
    btnCopyResultCard: document.getElementById("btn-copy-result-card"),
    soundboardPopover: document.getElementById("soundboard-popover"),
    btnCloseSoundboard: document.getElementById("btn-close-soundboard"),
    intermissionPopover: document.getElementById("intermission-popover"),
    btnCloseIntermissionPopover: document.getElementById("btn-close-intermission-popover"),
    intermissionMessageInput: document.getElementById("intermission-message-input"),
    intermissionDurationPills: document.getElementById("intermission-duration-pills"),
    btnStartIntermission: document.getElementById("btn-start-intermission"),
    btnStopIntermissionPopover: document.getElementById("btn-stop-intermission-popover"),
    displayPrefsPopover: document.getElementById("display-prefs-popover"),
    btnCloseDisplayPrefs: document.getElementById("btn-close-display-prefs"),
    gameTvScaleSlider: document.getElementById("game-tv-scale-slider"),
    gameTvScaleVal: document.getElementById("game-tv-scale-val"),
    btnResetTvScaleGame: document.getElementById("btn-reset-tv-scale-game"),

    // قائمة التحكم التحكيمي السريع (Referee Popover)
    refereePopover: document.getElementById("referee-popover"),
    refereeTeamTitle: document.getElementById("referee-team-title"),
    btnCloseRefereePopover: document.getElementById("btn-close-referee-popover"),
    refereeCustomDeltaInput: document.getElementById("referee-custom-delta-input"),
    btnRefereeApplyDelta: document.getElementById("btn-referee-apply-delta"),
    btnRefDoubleMinus: document.getElementById("btn-ref-double-minus"),
    refDoubleVal: document.getElementById("ref-double-val"),
    btnRefDoublePlus: document.getElementById("btn-ref-double-plus"),
    btnRefSwapMinus: document.getElementById("btn-ref-swap-minus"),
    refSwapVal: document.getElementById("ref-swap-val"),
    btnRefSwapPlus: document.getElementById("btn-ref-swap-plus"),
    btnRefSetTurn: document.getElementById("btn-ref-set-turn"),
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
    btnCopyFlaggedReport: document.getElementById("btn-copy-flagged-report"),
    btnExportFlaggedJson: document.getElementById("btn-export-flagged-json"),
    btnExportFlaggedCsv: document.getElementById("btn-export-flagged-csv"),
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
    btnLightboxNext: document.getElementById("btn-lightbox-next"),

    // عناصر الحزمة السابعة (المربعات الذهبية، إطلاق الأطوار السريعة، البرق، من غير كلام المستقل، قاعة المشاهير)
    btnLaunchBlitzMode: document.getElementById("btn-launch-blitz-mode"),
    btnLaunchCharadesMode: document.getElementById("btn-launch-charades-mode"),
    btnOpenHallOfFame: document.getElementById("btn-open-hall-of-fame"),
    btnWinnerOpenHallOfFame: document.getElementById("btn-winner-open-hall-of-fame"),
    questionBodyBox: document.getElementById("question-body-box"),
    dailyDoubleBanner: document.getElementById("daily-double-banner"),
    dailyDoubleBannerSub: document.getElementById("daily-double-banner-sub"),
    dailyDoubleWagerPanel: document.getElementById("daily-double-wager-panel"),
    ddWagerTeamLabel: document.getElementById("dd-wager-team-label"),
    ddWagerBoundsLabel: document.getElementById("dd-wager-bounds-label"),
    ddWagerInput: document.getElementById("dd-wager-input"),
    btnDdLockWager: document.getElementById("btn-dd-lock-wager"),
    btnDdPresetBase: document.getElementById("btn-dd-preset-base"),
    btnDdPresetDouble: document.getElementById("btn-dd-preset-double"),
    btnDdPresetAllin: document.getElementById("btn-dd-preset-allin"),
    ddResolveActions: document.getElementById("dd-resolve-actions"),
    ddResolvePrompt: document.getElementById("dd-resolve-prompt"),
    btnDdCorrect: document.getElementById("btn-dd-correct"),
    btnDdCorrectLabel: document.getElementById("btn-dd-correct-label"),
    btnDdWrong: document.getElementById("btn-dd-wrong"),
    btnDdWrongLabel: document.getElementById("btn-dd-wrong-label"),

    // طور جولة البرق السريعة (60s Blitz)
    blitzModal: document.getElementById("blitz-modal"),
    btnBlitzOpenTv: document.getElementById("btn-blitz-open-tv"),
    btnCloseBlitz: document.getElementById("btn-close-blitz"),
    blitzSetupView: document.getElementById("blitz-setup-view"),
    blitzTeamCountPills: document.getElementById("blitz-team-count-pills"),
    blitzTeamNamesInputs: document.getElementById("blitz-team-names-inputs"),
    blitzDurationPills: document.getElementById("blitz-duration-pills"),
    blitzRoundsPills: document.getElementById("blitz-rounds-pills"),
    blitzSourceGroup: document.getElementById("blitz-source-group"),
    btnBlitzStartSession: document.getElementById("btn-blitz-start-session"),
    blitzReadyView: document.getElementById("blitz-ready-view"),
    blitzReadyBadge: document.getElementById("blitz-ready-badge"),
    blitzReadyTeamTitle: document.getElementById("blitz-ready-team-title"),
    blitzReadyDesc: document.getElementById("blitz-ready-desc"),
    blitzReadyScoreboard: document.getElementById("blitz-ready-scoreboard"),
    btnBlitzBeginTurn: document.getElementById("btn-blitz-begin-turn"),
    blitzPlayView: document.getElementById("blitz-play-view"),
    blitzPlayTeamName: document.getElementById("blitz-play-team-name"),
    blitzPlayTeamScore: document.getElementById("blitz-play-team-score"),
    blitzStreakPill: document.getElementById("blitz-streak-pill"),
    blitzTimerDisplay: document.getElementById("blitz-timer-display"),
    btnBlitzPause: document.getElementById("btn-blitz-pause"),
    blitzTimerProgress: document.getElementById("blitz-timer-progress"),
    blitzQCatPill: document.getElementById("blitz-q-cat-pill"),
    blitzQText: document.getElementById("blitz-q-text"),
    blitzQAnswer: document.getElementById("blitz-q-answer"),
    btnBlitzCorrect: document.getElementById("btn-blitz-correct"),
    btnBlitzSkip: document.getElementById("btn-blitz-skip"),
    btnBlitzWrong: document.getElementById("btn-blitz-wrong"),
    blitzSummaryView: document.getElementById("blitz-summary-view"),
    blitzSummaryTitle: document.getElementById("blitz-summary-title"),
    blitzSummaryStats: document.getElementById("blitz-summary-stats"),
    blitzSummaryList: document.getElementById("blitz-summary-list"),
    btnBlitzNextTurn: document.getElementById("btn-blitz-next-turn"),
    blitzFinishView: document.getElementById("blitz-finish-view"),
    blitzFinishTitle: document.getElementById("blitz-finish-title"),
    blitzFinishScores: document.getElementById("blitz-finish-scores"),
    btnBlitzResultCard: document.getElementById("btn-blitz-result-card"),
    btnBlitzOpenHof: document.getElementById("btn-blitz-open-hof"),
    btnBlitzPlayAgain: document.getElementById("btn-blitz-play-again"),

    // طور «من غير كلام» المستقل (Standalone Charades)
    charadesSoloModal: document.getElementById("charades-solo-modal"),
    btnCharadesOpenTv: document.getElementById("btn-charades-open-tv"),
    btnCloseCharadesSolo: document.getElementById("btn-close-charades-solo"),
    csoloSetupView: document.getElementById("csolo-setup-view"),
    csoloTeamCountPills: document.getElementById("csolo-team-count-pills"),
    csoloTeamNamesInputs: document.getElementById("csolo-team-names-inputs"),
    csoloDurationPills: document.getElementById("csolo-duration-pills"),
    csoloRoundsPills: document.getElementById("csolo-rounds-pills"),
    csoloSkipPills: document.getElementById("csolo-skip-pills"),
    csoloCategoriesChips: document.getElementById("csolo-categories-chips"),
    btnCsoloStartSession: document.getElementById("btn-csolo-start-session"),
    csoloReadyView: document.getElementById("csolo-ready-view"),
    csoloReadyBadge: document.getElementById("csolo-ready-badge"),
    csoloReadyTeamTitle: document.getElementById("csolo-ready-team-title"),
    csoloReadyDesc: document.getElementById("csolo-ready-desc"),
    csoloReadyScoreboard: document.getElementById("csolo-ready-scoreboard"),
    btnCsoloBeginTurn: document.getElementById("btn-csolo-begin-turn"),
    csoloPlayView: document.getElementById("csolo-play-view"),
    csoloPlayTeamName: document.getElementById("csolo-play-team-name"),
    csoloPlayTeamScore: document.getElementById("csolo-play-team-score"),
    csoloSkipsPill: document.getElementById("csolo-skips-pill"),
    csoloTimerDisplay: document.getElementById("csolo-timer-display"),
    btnCsoloPause: document.getElementById("btn-csolo-pause"),
    csoloTimerProgress: document.getElementById("csolo-timer-progress"),
    csoloEyebrow: document.getElementById("csolo-eyebrow"),
    csoloTopic: document.getElementById("csolo-topic"),
    csoloWordCount: document.getElementById("csolo-word-count"),
    csoloHostSecretBox: document.getElementById("csolo-host-secret-box"),
    csoloHostWord: document.getElementById("csolo-host-word"),
    csoloHostExpRow: document.getElementById("csolo-host-exp-row"),
    csoloHostExp: document.getElementById("csolo-host-exp"),
    csoloHoldStage: document.getElementById("csolo-hold-stage"),
    csoloDecoyCard: document.getElementById("csolo-decoy-card"),
    csoloSecretCard: document.getElementById("csolo-secret-card"),
    csoloSecretWord: document.getElementById("csolo-secret-word"),
    csoloSecretExp: document.getElementById("csolo-secret-exp"),
    btnCsoloHoldReveal: document.getElementById("btn-csolo-hold-reveal"),
    csoloHintBox: document.getElementById("csolo-hint-box"),
    btnCsoloGuessed: document.getElementById("btn-csolo-guessed"),
    btnCsoloSkip: document.getElementById("btn-csolo-skip"),
    btnCsoloHint: document.getElementById("btn-csolo-hint"),
    csoloSummaryView: document.getElementById("csolo-summary-view"),
    csoloSummaryTitle: document.getElementById("csolo-summary-title"),
    csoloSummaryStats: document.getElementById("csolo-summary-stats"),
    csoloSummaryList: document.getElementById("csolo-summary-list"),
    btnCsoloNextTurn: document.getElementById("btn-csolo-next-turn"),
    csoloFinishView: document.getElementById("csolo-finish-view"),
    csoloFinishTitle: document.getElementById("csolo-finish-title"),
    csoloFinishScores: document.getElementById("csolo-finish-scores"),
    btnCsoloResultCard: document.getElementById("btn-csolo-result-card"),
    btnCsoloOpenHof: document.getElementById("btn-csolo-open-hof"),
    btnCsoloPlayAgain: document.getElementById("btn-csolo-play-again"),

    // قاعة المشاهير وأرشيف المباريات (Hall of Fame)
    hallOfFameModal: document.getElementById("hall-of-fame-modal"),
    hofProfileSubtitle: document.getElementById("hof-profile-subtitle"),
    btnCloseHof: document.getElementById("btn-close-hof"),
    hofViewTabs: document.getElementById("hof-view-tabs"),
    hofSeenJeemSections: document.getElementById("hof-seen-jeem-sections"),
    hofBaraSalfaSection: document.getElementById("hof-bara-salfa-section"),
    hofBaraTotalRoundsPill: document.getElementById("hof-bara-total-rounds-pill"),
    hofBaraRecordsGrid: document.getElementById("hof-bara-records-grid"),
    hofBaraLeaderboardWrap: document.getElementById("hof-bara-leaderboard-wrap"),
    hofMafiaSection: document.getElementById("hof-mafia-section"),
    hofMafiaTotalSessionsPill: document.getElementById("hof-mafia-total-sessions-pill"),
    hofMafiaRecordsGrid: document.getElementById("hof-mafia-records-grid"),
    hofMafiaLeaderboardWrap: document.getElementById("hof-mafia-leaderboard-wrap"),
    hofTotalMatchesPill: document.getElementById("hof-total-matches-pill"),
    hofRecordsGrid: document.getElementById("hof-records-grid"),
    hofLeaderboardWrap: document.getElementById("hof-leaderboard-wrap"),
    hofModeFilters: document.getElementById("hof-mode-filters"),
    hofArchiveList: document.getElementById("hof-archive-list"),
    btnHofClearArchive: document.getElementById("btn-hof-clear-archive"),
    btnHofFooterClose: document.getElementById("btn-hof-footer-close"),

    // الحزمة الحادية عشرة: نظام البطولة ووضع «الكل يجاوب»
    btnLaunchTournament: document.getElementById("btn-launch-tournament"),
    btnWinnerReturnTournament: document.getElementById("btn-winner-return-tournament"),
    btnBlitzReturnTournament: document.getElementById("btn-blitz-return-tournament"),
    btnAllPlayOpen: document.getElementById("btn-allplay-open"),
    allPlayHostPanel: document.getElementById("allplay-host-panel"),

    // الحزمة الثانية عشرة: صورة الإجابة، أوجد الفروقات، التحدي الصوتي، وصانع الفئات
    diffLiveDots: document.getElementById("diff-live-dots"),
    diffHostControls: document.getElementById("diff-host-controls"),
    btnDiffIncrement: document.getElementById("btn-diff-increment"),
    btnDiffDecrement: document.getElementById("btn-diff-decrement"),
    btnDiffReset: document.getElementById("btn-diff-reset"),
    audioChallengePanel: document.getElementById("audio-challenge-panel"),
    audioChStatusText: document.getElementById("audio-ch-status-text"),
    btnAudioChRoute: document.getElementById("btn-audio-ch-route"),
    audioChVisualizer: document.getElementById("audio-ch-visualizer"),
    audioChCurTime: document.getElementById("audio-ch-cur-time"),
    audioChSeek: document.getElementById("audio-ch-seek"),
    audioChDurTime: document.getElementById("audio-ch-dur-time"),
    btnAudioChPlay: document.getElementById("btn-audio-ch-play"),
    btnAudioChPause: document.getElementById("btn-audio-ch-pause"),
    btnAudioChReplay: document.getElementById("btn-audio-ch-replay"),
    btnAudioChTeaser: document.getElementById("btn-audio-ch-teaser"),
    audioChVolume: document.getElementById("audio-ch-volume"),
    audioChError: document.getElementById("audio-ch-error"),
    answerImageToggleBar: document.getElementById("answer-image-toggle-bar"),
    btnAnsViewAnswer: document.getElementById("btn-ans-view-answer"),
    btnAnsViewQuestion: document.getElementById("btn-ans-view-question"),
    btnAnsViewCompare: document.getElementById("btn-ans-view-compare"),
    answerCompareGrid: document.getElementById("answer-compare-grid"),
    answerCompareQImg: document.getElementById("answer-compare-q-img"),
    answerCompareAImg: document.getElementById("answer-compare-a-img"),
    btnOpenCustomPackBuilder: document.getElementById("btn-open-custom-pack-builder"),
    btnBankOpenPackBuilder: document.getElementById("btn-bank-open-pack-builder"),

    // الحزمة الثالثة عشرة: المزامنة السحابية وبلاغات Google Sheets التلقائية
    btnCloudSyncPill: document.getElementById("btn-cloud-sync-pill"),
    cloudPillIcon: document.getElementById("cloud-pill-icon"),
    cloudPillLabel: document.getElementById("cloud-pill-label"),
    bankCloudSyncSection: document.getElementById("bank-cloud-sync-section"),
    cloudSyncStatusBadge: document.getElementById("cloud-sync-status-badge"),
    cloudSignedOutBox: document.getElementById("cloud-signed-out-box"),
    cloudSignedInBox: document.getElementById("cloud-signed-in-box"),
    btnCloudGoogleSignin: document.getElementById("btn-cloud-google-signin"),
    btnCloudGoogleRedirect: document.getElementById("btn-cloud-google-redirect"),
    cloudUserAvatar: document.getElementById("cloud-user-avatar"),
    cloudUserName: document.getElementById("cloud-user-name"),
    cloudUserEmail: document.getElementById("cloud-user-email"),
    cloudLastSyncText: document.getElementById("cloud-last-sync-text"),
    btnCloudSignout: document.getElementById("btn-cloud-signout"),
    btnCloudSyncNow: document.getElementById("btn-cloud-sync-now"),
    btnCloudPushLocal: document.getElementById("btn-cloud-push-local"),
    btnCloudPullCloud: document.getElementById("btn-cloud-pull-cloud"),
    cloudSyncFeedback: document.getElementById("cloud-sync-feedback"),
    btnSendPendingFlags: document.getElementById("btn-send-pending-flags"),
    sheetReportWebhookInput: document.getElementById("sheet-report-webhook-input"),
    sheetReportSecretInput: document.getElementById("sheet-report-secret-input"),
    btnSaveSheetReportCfg: document.getElementById("btn-save-sheet-report-cfg"),
    btnTestSheetReport: document.getElementById("btn-test-sheet-report"),
    sheetReportFeedback: document.getElementById("sheet-report-feedback"),

    // الغرفة اللاسلكية (Phase 4 Pack 9)
    btnOpenWirelessSetup: document.getElementById("btn-open-wireless-setup"),
    btnOpenWirelessGame: document.getElementById("btn-open-wireless-game"),
    btnOpenWirelessGameLabel: document.getElementById("btn-open-wireless-game-label"),
    wirelessBuzzerHostBar: document.getElementById("wireless-buzzer-host-bar"),
    wbStatusText: document.getElementById("wb-status-text"),
    btnWbOpen: document.getElementById("btn-wb-open"),
    btnWbLock: document.getElementById("btn-wb-lock"),
    btnWbReset: document.getElementById("btn-wb-reset"),
    wirelessRoomModal: document.getElementById("wireless-room-modal"),
    btnCloseWirelessModal: document.getElementById("btn-close-wireless-modal"),
    wirelessConnBadge: document.getElementById("wireless-conn-badge"),
    wirelessRoomCodePill: document.getElementById("wireless-room-code-pill"),
    wirelessRoomCodeText: document.getElementById("wireless-room-code-text"),
    btnCreateWirelessRoom: document.getElementById("btn-create-wireless-room"),
    btnCloseWirelessRoom: document.getElementById("btn-close-wireless-room"),
    btnToggleWirelessSettings: document.getElementById("btn-toggle-wireless-settings"),
    wirelessRoomFeedback: document.getElementById("wireless-room-feedback"),
    wirelessSettingsPanel: document.getElementById("wireless-settings-panel"),
    fbPasteSnippet: document.getElementById("fb-paste-snippet"),
    btnFbParseSnippet: document.getElementById("btn-fb-parse-snippet"),
    fbApiKey: document.getElementById("fb-api-key"),
    fbAuthDomain: document.getElementById("fb-auth-domain"),
    fbDatabaseUrl: document.getElementById("fb-database-url"),
    fbProjectId: document.getElementById("fb-project-id"),
    fbAppId: document.getElementById("fb-app-id"),
    btnFbSaveConfig: document.getElementById("btn-fb-save-config"),
    btnFbTestConn: document.getElementById("btn-fb-test-conn"),
    btnFbClearConfig: document.getElementById("btn-fb-clear-config"),
    wirelessQrGrid: document.getElementById("wireless-qr-grid"),
    btnToggleHostQrPrivacy: document.getElementById("btn-toggle-host-qr-privacy"),
    wirelessHostQrBox: document.getElementById("wireless-host-qr-box"),
    wirelessHostQrMasked: document.getElementById("wireless-host-qr-masked"),
    btnCopyRemoteUrl: document.getElementById("btn-copy-remote-url"),
    linkOpenRemoteTab: document.getElementById("link-open-remote-tab"),
    btnToggleTvQr: document.getElementById("btn-toggle-tv-qr"),
    wirelessPlayerQrBox: document.getElementById("wireless-player-qr-box"),
    wirelessPlayerCodeBig: document.getElementById("wireless-player-code-big"),
    wirelessConnectedTeams: document.getElementById("wireless-connected-teams"),
    btnCopyPlayerUrl: document.getElementById("btn-copy-player-url"),
    linkOpenPlayerTab: document.getElementById("link-open-player-tab"),
    wirelessBuzzerPanel: document.getElementById("wireless-buzzer-panel"),
    wirelessBuzzerStatePill: document.getElementById("wireless-buzzer-state-pill"),
    wirelessBuzzerResultBox: document.getElementById("wireless-buzzer-result-box"),
    btnModalWbOpen: document.getElementById("btn-modal-wb-open"),
    btnModalWbLock: document.getElementById("btn-modal-wb-lock"),
    btnModalWbReset: document.getElementById("btn-modal-wb-reset"),
    wirelessDiagnosticsBar: document.getElementById("wireless-diagnostics-bar"),
    wirelessDiagKb: document.getElementById("wireless-diag-kb"),
    wirelessDiagWrites: document.getElementById("wireless-diag-writes"),
    wirelessDiagSkipped: document.getElementById("wireless-diag-skipped"),
    wirelessDevicesPanel: document.getElementById("wireless-devices-panel"),
    wirelessDevicesCountPill: document.getElementById("wireless-devices-count-pill"),
    btnWirelessToggleLock: document.getElementById("btn-wireless-toggle-lock"),
    btnWirelessToggleCap: document.getElementById("btn-wireless-toggle-cap"),
    wirelessDevicesList: document.getElementById("wireless-devices-list")
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
      const finalLabel =
        cfg.finalRoundMode === "always"
          ? "⚔️ حسم: دائماً"
          : cfg.finalRoundMode === "off"
            ? "⚔️ حسم: معطّل"
            : "⚔️ حسم: عند التعادل";
      const ddCount = Number(cfg.dailyDoubleCount) || 0;
      const ddLabel = ddCount > 0 ? `🌟 ذهبي (${ddCount})` : "🌟 ذهبي (معطّل)";

      dom.tacticalSummaryPills.innerHTML = `
        <span class="tactical-summary-pill is-active">${timerLabel}</span>
        <span class="tactical-summary-pill ${ddCount > 0 ? "is-active" : "is-off"}">${ddLabel}</span>
        <span class="tactical-summary-pill ${cfg.finalRoundMode !== "off" ? "is-active" : "is-off"}">${finalLabel}</span>
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
      const rawVal = btn.dataset.value;
      const isStringKey = key === "finalRoundMode";
      const isMatch = isStringKey
        ? String(cfg[key]) === String(rawVal)
        : Number(cfg[key]) === Number(rawVal);
      btn.classList.toggle("active", isMatch);
      btn.setAttribute("aria-pressed", String(isMatch));
    });
  }

  function getConfiguredTeamCount() {
    const raw = Number(state.setupSettings && state.setupSettings.teamCount);
    return raw === 3 || raw === 4 ? raw : 2;
  }

  function getSetupTeamNames() {
    const count = getConfiguredTeamCount();
    const defaults = ["الفريق الأول", "الفريق الثاني", "الفريق الثالث", "الفريق الرابع"];
    const inputs = [dom.team1Input, dom.team2Input, dom.team3Input, dom.team4Input];
    const names = [];
    for (let i = 0; i < count; i++) {
      const val = inputs[i] && typeof inputs[i].value === "string" ? inputs[i].value.trim() : "";
      names.push(val || defaults[i]);
    }
    return names;
  }

  function renderTeamCountSetupUI() {
    const count = getConfiguredTeamCount();
    if (dom.teamsInputsGrid) {
      dom.teamsInputsGrid.dataset.teamCount = String(count);
    }
    if (dom.teamsVsDivider) {
      dom.teamsVsDivider.hidden = count !== 2;
    }
    if (dom.teamInputCard3) dom.teamInputCard3.hidden = count < 3;
    if (dom.teamInputCard4) dom.teamInputCard4.hidden = count < 4;

    if (dom.teamCountSelector) {
      dom.teamCountSelector.querySelectorAll(".team-count-pill").forEach((pill) => {
        const val = Number(pill.dataset.teamCount);
        const isActive = val === count;
        pill.classList.toggle("active", isActive);
        pill.setAttribute("aria-pressed", String(isActive));
      });
    }
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
    renderTeamCountSetupUI();
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
   * التحقق من امتلاك الفئة الحد الأدنى من الأسئلة المطلوبة لبناء عمود اللوحة (6 أسئلة: 2 لكل مستوى نقاط)
   */
  function hasFullBoardQuestions(cat) {
    if (!cat || !Array.isArray(cat.questions) || cat.questions.length < 6) return false;
    return POINT_TIERS.every(
      (tier) => cat.questions.filter((q) => Number(q.points) === tier).length >= 2
    );
  }

  function hasMinimumBoardQuestions(cat) {
    return Boolean(cat && Array.isArray(cat.questions) && cat.questions.length >= 6);
  }

  /**
   * اختيار عشوائي موزون بين أفضل المرشحين بحيث تتصدر الفئات الأكثر أسئلة جديدة وتتغير التشكيلة في كل ضغطة
   */
  function pickWeightedBestCategory(candidates, excludeIds) {
    const pool = candidates.filter((c) => c && !excludeIds.has(c.id));
    if (pool.length === 0) return null;

    const scored = pool
      .map((cat) => ({ cat, newCount: getCategoryNewCount(cat) }))
      .sort((a, b) => b.newCount - a.newCount);

    const topPool = scored.slice(0, Math.min(4, scored.length));
    const weights = topPool.map((item, idx) => Math.max(1, item.newCount + (topPool.length - idx) * 2));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < topPool.length; i++) {
      r -= weights[i];
      if (r <= 0) return topPool[i].cat;
    }
    return topPool[0].cat;
  }

  /**
   * اختيار «تشكيلة سريعة متوازنة» تلقائياً:
   * - تستبعد الفئات التي لا تملك الحد الأدنى من الأسئلة المطلوبة لبناء اللوحة
   * - توزّع الاختيار عبر أكبر عدد ممكن من المجموعات المختلفة (group)
   * - تعطي أولوية للأسئلة الجديدة في الملف النشط مع عشوائية موزونة بين أفضل المرشحين
   */
  function selectBalancedCategories() {
    if (!Array.isArray(state.allCategories) || state.allCategories.length === 0) return;

    const fullEligible = state.allCategories.filter(hasFullBoardQuestions);
    const minEligible =
      fullEligible.length >= REQUIRED_CATEGORIES
        ? fullEligible
        : state.allCategories.filter(hasMinimumBoardQuestions);
    const eligiblePool =
      minEligible.length >= REQUIRED_CATEGORIES ? minEligible : state.allCategories.slice();

    const groupBuckets = new Map();
    eligiblePool.forEach((cat) => {
      const gid = resolveCategoryGroup(cat);
      if (!groupBuckets.has(gid)) groupBuckets.set(gid, []);
      groupBuckets.get(gid).push(cat);
    });

    const orderedGroupIds = shuffleArray(
      Array.from(groupBuckets.keys()).filter((gid) => (groupBuckets.get(gid) || []).length > 0)
    );

    const picked = [];
    const pickedIds = new Set();
    const usedGroups = new Set();

    // المرور الأول: فئة واحدة من كل مجموعة مختلفة بأولوية للأسئلة الجديدة وعشوائية موزونة
    for (const gid of orderedGroupIds) {
      if (picked.length >= REQUIRED_CATEGORIES) break;
      const bucket = groupBuckets.get(gid) || [];
      const unplayedBucket = bucket.filter((c) => getCategoryNewCount(c) > 0);
      const candidate = pickWeightedBestCategory(
        unplayedBucket.length > 0 ? unplayedBucket : bucket,
        pickedIds
      );
      if (candidate) {
        picked.push(candidate);
        pickedIds.add(candidate.id);
        usedGroups.add(gid);
      }
    }

    // المرور الثاني: إكمال من أفضل الفئات المؤهلة المتبقية (في حال كان عدد المجموعات < 6)
    while (picked.length < REQUIRED_CATEGORIES) {
      const next = pickWeightedBestCategory(eligiblePool, pickedIds);
      if (!next) break;
      picked.push(next);
      pickedIds.add(next.id);
      usedGroups.add(resolveCategoryGroup(next));
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
      `🎲 تم اختيار تشكيلة متوازنة من ${picked.length} فئات عبر ${usedGroups.size} مجموعات مختلفة!`,
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
    if (window.SeenJeemCustomPacksStore && window.SeenJeemCustomPacksStore._ready) {
      return window.SeenJeemCustomPacksStore.getAllSync();
    }
    try {
      const raw = localStorage.getItem(CUSTOM_CATEGORIES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sanitized = sanitizer.sanitizeCategoriesTree(parsed, {
          allowLegacyLocalVisuals: true
        });
        return sanitized.categories;
      }
    } catch (err) {
      console.warn("تعذر قراءة الفئات المستوردة من localStorage:", err);
    }
    return [];
  }

  async function refreshCustomPacksFromStore() {
    if (!window.SeenJeemCustomPacksStore) return;
    try {
      const packs = await window.SeenJeemCustomPacksStore.getAll();
      state.customCategories = Array.isArray(packs) ? packs : [];
      rebuildMergedCategories();
      renderSetupScreen();
      if (dom.bankManagerModal && dom.bankManagerModal.classList.contains("open")) {
        renderBankManagerModal();
      }
    } catch (_err) {}
  }

  function saveCustomCategoriesToStorage() {
    if (window.SeenJeemCustomPacksStore && typeof window.SeenJeemCustomPacksStore.importPacks === "function") {
      window.SeenJeemCustomPacksStore.importPacks(state.customCategories, "replace").catch(() => {});
    }
    try {
      const json = JSON.stringify(state.customCategories);
      if (json.length <= 3 * 1024 * 1024) {
        localStorage.setItem(CUSTOM_CATEGORIES_STORAGE_KEY, json);
      }
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
      isDailyDouble: Boolean(cq.isDailyDouble),
      dailyDoublePhase: cq.dailyDoublePhase || "question",
      dailyDoubleWager: Number(cq.dailyDoubleWager) || 0,
      dailyDoubleMaxWager: Number(cq.dailyDoubleMaxWager) || 0,
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
      differencesFound: Math.max(0, Math.floor(Number(cq.differencesFound) || 0)),
      answerImageMode: cq.answerImageMode || "answer",
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
          matchId: state.matchId,
          activeProfileId: historyStore.getActiveProfileId(),
          selectedCategoryIds: state.selectedCategoryIds,
          matchSettings: state.matchSettings,
          teams: state.teams,
          activeTurn: state.activeTurn,
          doubleArmed: state.doubleArmed,
          answeredThisRound: state.answeredThisRound,
          matchEvents: state.matchEvents,
          refereeAdjustments: state.refereeAdjustments,
          finalRound: state.finalRound,
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
      handleBoardCompletedFlow();
    }
  }

  function cloneRefereeAdjustments(list = state.refereeAdjustments) {
    return Array.isArray(list) ? list.map((item) => ({ ...item })) : [];
  }

  function handleBoardCompletedFlow() {
    const mode =
      state.matchSettings && state.matchSettings.finalRoundMode
        ? state.matchSettings.finalRoundMode
        : "tie-only";

    if (finalRoundEngine) {
      if (mode === "always") {
        setTimeout(() => startFinalRound("always"), 280);
        return;
      }
      if (mode === "tie-only" && finalRoundEngine.isTopScoreTied(state.teams)) {
        setTimeout(() => startFinalRound("tie-breaker"), 280);
        return;
      }
    }

    matchStore.clearSavedMatch();
    setTimeout(() => openWinnerModal(false), 260);
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
    if (Array.isArray(snapshot.refereeAdjustments)) {
      state.refereeAdjustments = cloneRefereeAdjustments(snapshot.refereeAdjustments);
    }
    if (snapshot.actionType === "final-round-resolve") {
      if (snapshot.finalRound) {
        state.finalRound = JSON.parse(JSON.stringify(snapshot.finalRound));
        stopFinalRoundTimer();
        renderFinalRoundModal();
        openModal(dom.finalRoundModal);
      }
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

    const turnTeam = savedMatch.teams[savedMatch.activeTurn] || savedMatch.teams[0];

    if (dom.resumeMatchSummary) {
      const pillsHtml = savedMatch.teams
        .map(
          (t, idx) => `
          <div class="resume-team-pill team-${idx + 1}">
            <div class="resume-team-name">${escapeHtml(t.name)}</div>
            <div class="resume-team-score">${t.score}</div>
          </div>
          ${idx < savedMatch.teams.length - 1 && savedMatch.teams.length === 2 ? `<div class="resume-vs">VS</div>` : ""}
        `
        )
        .join("");

      dom.resumeMatchSummary.innerHTML = `
        <div class="resume-teams-row" data-team-count="${savedMatch.teams.length}">
          ${pillsHtml}
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

    state.matchId =
      typeof saved.matchId === "string" && saved.matchId.trim()
        ? saved.matchId.trim()
        : archiveStore
          ? archiveStore.generateMatchId("classic")
          : `classic_${Date.now()}`;
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
    state.refereeAdjustments = cloneRefereeAdjustments(saved.refereeAdjustments);
    state.finalRound = saved.finalRound ? JSON.parse(JSON.stringify(saved.finalRound)) : null;
    state.boardCategories = saved.boardCategories;

    const nameInputs = [dom.team1Input, dom.team2Input, dom.team3Input, dom.team4Input];
    state.teams.forEach((t, idx) => {
      if (nameInputs[idx]) nameInputs[idx].value = t.name;
    });
    if (state.setupSettings) {
      state.setupSettings.teamCount = Math.min(4, Math.max(2, state.teams.length));
    }

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

    // استعادة جولة الرهان النهائي أو نافذة السؤال إن كانت مفتوحة لحظة إغلاق/تحديث الصفحة
    if (state.finalRound && dom.finalRoundModal) {
      state.finalRound.timerRunning = false;
      renderFinalRoundModal();
      openModal(dom.finalRoundModal);
    } else if (saved.openQuestion) {
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
            winnerTeam: null,
            isDailyDouble: false
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

    // توزيع المربعات الذهبية المخفية (Hidden Daily Double) سراً على فئات 400/600 (حد أقصى مربع واحد لكل فئة وتجنب mgk-* قدر الإمكان)
    const ddTarget = Math.min(2, Math.max(0, Number(state.matchSettings.dailyDoubleCount) || 0));
    if (ddTarget > 0 && state.boardCategories.length > 0) {
      const nonCharadesCatIdxs = [];
      const charadesCatIdxs = [];
      state.boardCategories.forEach((bc, idx) => {
        const eligible = [...bc.rightColumn, ...bc.leftColumn].some(
          (s) => !s.played && s.question && (Number(s.points) === 400 || Number(s.points) === 600)
        );
        if (!eligible) return;
        const isMgk =
          String(bc.category.id || "").startsWith("mgk-") ||
          resolveCategoryGroup(bc.category) === "charades";
        if (isMgk) charadesCatIdxs.push(idx);
        else nonCharadesCatIdxs.push(idx);
      });

      const orderedCatPool = [...shuffleArray(nonCharadesCatIdxs), ...shuffleArray(charadesCatIdxs)];
      let placed = 0;
      for (const catIdx of orderedCatPool) {
        if (placed >= ddTarget) break;
        const bc = state.boardCategories[catIdx];
        const slots = [...bc.rightColumn, ...bc.leftColumn].filter(
          (s) => !s.played && s.question && (Number(s.points) === 400 || Number(s.points) === 600)
        );
        if (slots.length > 0) {
          const chosen = slots[Math.floor(Math.random() * slots.length)];
          chosen.isDailyDouble = true;
          placed++;
        }
      }
    }

    return { totalRecycledCount };
  }

  function startNewGame(options = null) {
    const reqCount =
      options && Number.isInteger(options.requiredCategories) && options.requiredCategories > 0
        ? options.requiredCategories
        : REQUIRED_CATEGORIES;
    if (state.selectedCategoryIds.length !== reqCount) return;

    if (!options || !options.keepTournamentMatch) {
      state.activeTournamentMatch = null;
    }

    clearClosingRevealTimer();
    stopFinalRoundTimer();
    closeRefereePopover();
    const teamNames = getSetupTeamNames();

    state.matchId = archiveStore ? archiveStore.generateMatchId("classic") : `classic_${Date.now()}`;
    state.matchSettings = matchStore.sanitizeSettings(state.setupSettings);
    const initialDouble = state.matchSettings.doubleEnabled ? state.matchSettings.doubleCount : 0;
    const initialSwap = state.matchSettings.swapEnabled ? state.matchSettings.swapCount : 0;

    state.teams = teamNames.map((name, idx) => ({
      id: `team-${idx}`,
      name,
      score: 0,
      powerups: { doubleLeft: initialDouble, swapLeft: initialSwap },
      lifelines: { double: initialDouble === 0, twoAnswers: false, callFriend: false }
    }));
    state.activeTurn = 0;
    state.doubleArmed = false;
    state.lastRenderedScores = state.teams.map(() => 0);
    state.answeredThisRound = 0;
    state.matchEvents = [];
    state.refereeAdjustments = [];
    state.finalRound = null;
    state.dualScreen.closingPreviewQuestion = null;
    matchStore.clearUndoStack();

    const { totalRecycledCount } = buildRoundBoard();

    stopVictoryConfetti();
    closeModal(dom.winnerModal);
    closeModal(dom.questionModal);
    closeModal(dom.finalRoundModal);

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
    if (dom.scoreboardTeamsGrid) {
      dom.scoreboardTeamsGrid.dataset.teamCount = String(state.teams.length);
      dom.scoreboardTeamsGrid.innerHTML = "";

      state.teams.forEach((team, idx) => {
        const isActive = state.activeTurn === idx;
        const prevScore = state.lastRenderedScores[idx];
        const didPop = prevScore !== undefined && prevScore !== team.score;
        state.lastRenderedScores[idx] = team.score;

        const card = document.createElement("div");
        card.id = `scoreboard-team-${idx + 1}`;
        card.className = `score-team-card team-${idx + 1}-card${isActive ? " active-turn" : ""}`;
        card.innerHTML = `
          <div class="score-team-top">
            <div class="score-team-identity">
              <span class="team-badge-dot team-${idx + 1}-dot"></span>
              <h2 class="score-team-name" title="${escapeHtml(team.name)}">${escapeHtml(team.name)}</h2>
            </div>
            <div class="score-team-top-actions">
              <span class="turn-pill">الدور الآن</span>
              <button
                type="button"
                class="team-mini-action-btn btn-set-turn-direct"
                data-set-turn="${idx}"
                title="تعيين الدور لهذا الفريق"
                aria-label="تعيين الدور لـ ${escapeHtml(team.name)}"
                ${isActive ? "hidden" : ""}
              >
                🎯
              </button>
              <button
                type="button"
                class="team-mini-action-btn btn-open-referee"
                data-ref-team="${idx}"
                title="تحكيم سريع: تعديل مخصّص للنقاط أو وسائل المساعدة"
                aria-label="تحكيم سريع لـ ${escapeHtml(team.name)}"
              >
                ⚖️
              </button>
            </div>
          </div>

          <div class="score-team-bottom">
            <div class="score-value-row">
              <button
                type="button"
                class="score-adjust-btn minus"
                data-team="${idx}"
                data-delta="-100"
                title="خصم 100 نقطة"
                aria-label="خصم 100 نقطة لـ ${escapeHtml(team.name)}"
              >
                -100
              </button>
              <div class="score-number${didPop ? " score-pop" : ""}">${team.score}</div>
              <button
                type="button"
                class="score-adjust-btn plus"
                data-team="${idx}"
                data-delta="100"
                title="إضافة 100 نقطة"
                aria-label="إضافة 100 نقطة لـ ${escapeHtml(team.name)}"
              >
                +100
              </button>
            </div>

            <div class="lifelines-status-row" aria-label="وسائل المساعدة لـ ${escapeHtml(team.name)}"></div>
          </div>
        `;

        card.querySelectorAll(".score-adjust-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            adjustScore(Number(btn.dataset.team), Number(btn.dataset.delta));
          });
        });

        const turnBtn = card.querySelector(".btn-set-turn-direct");
        if (turnBtn) {
          turnBtn.addEventListener("click", () => setActiveTurnManually(idx));
        }

        const refBtn = card.querySelector(".btn-open-referee");
        if (refBtn) {
          refBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openRefereePopover(idx, refBtn);
          });
        }

        const lifeRow = card.querySelector(".lifelines-status-row");
        renderTeamPowerupsChips(lifeRow, idx);

        dom.scoreboardTeamsGrid.appendChild(card);
      });
    }

    const remaining = countRemainingPlayableQuestions();
    const total = countTotalBoardSlots();
    if (dom.boardRemainingPill) {
      dom.boardRemainingPill.textContent = `متبقي ${remaining} / ${total}`;
    }
    if (state.refereePopoverTeamIdx !== null) {
      renderRefereePopover();
    }
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
      slot.played && Number.isInteger(slot.winnerTeam) && slot.winnerTeam >= 0 && slot.winnerTeam < 4
        ? ` won-team-${slot.winnerTeam}`
        : "";
    const recycledClass = !slot.played && slot.recycled ? " recycled-slot" : "";
    btn.className = `q-point-btn pts-${slot.points}${slot.played ? " played" : ""}${winnerClass}${recycledClass}`;
    btn.textContent = String(slot.points);
    btn.disabled = slot.played || !slot.question;

    if (slot.played) {
      if (Number.isInteger(slot.winnerTeam) && state.teams[slot.winnerTeam]) {
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

  function adjustScore(teamIndex, delta, isCustom = false) {
    const team = state.teams[teamIndex];
    const cleanDelta = Math.round(Number(delta));
    if (!team || !Number.isFinite(cleanDelta) || cleanDelta === 0) return;
    const nextScore = Math.max(0, team.score + cleanDelta);
    const actualDelta = nextScore - team.score;
    if (actualDelta === 0) {
      showToast(`رصيد ${team.name} بالفعل 0 نقطة`, "info");
      return;
    }

    matchStore.pushUndoSnapshot(
      {
        actionType: "manual-score",
        label: `تحكيم: ${actualDelta > 0 ? "+" : ""}${actualDelta} نقطة (${team.name})`,
        teams: cloneTeamsState(),
        activeTurn: state.activeTurn,
        doubleArmed: state.doubleArmed,
        answeredThisRound: state.answeredThisRound,
        matchEvents: cloneMatchEvents(),
        refereeAdjustments: cloneRefereeAdjustments(),
        cellState: null,
        questionHistorySnapshot: null
      },
      state.matchSettings
    );

    team.score = nextScore;
    state.refereeAdjustments.push({
      id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      teamId: team.id || `team-${teamIndex}`,
      teamName: team.name,
      type: "score",
      delta: actualDelta,
      detail: isCustom ? "تعديل تحكيمي مخصّص" : "تعديل تحكيمي سريع",
      timestamp: Date.now()
    });

    renderScoreboard();
    updateUndoButtonUI();
    persistActiveMatch();
    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playTileOpen();
    }
    showToast(
      `⚖️ تحكيم: ${actualDelta > 0 ? `+${actualDelta}` : actualDelta} نقطة لـ ${team.name} (الرصيد: ${team.score})`,
      "info"
    );
  }

  function setActiveTurnManually(targetTeamIdx) {
    if (!Number.isInteger(targetTeamIdx) || targetTeamIdx < 0 || targetTeamIdx >= state.teams.length) {
      return;
    }
    if (targetTeamIdx === state.activeTurn) return;

    const targetTeam = state.teams[targetTeamIdx];
    matchStore.pushUndoSnapshot(
      {
        actionType: "switch-turn",
        label: `تعيين الدور لـ ${targetTeam.name}`,
        teams: cloneTeamsState(),
        activeTurn: state.activeTurn,
        doubleArmed: state.doubleArmed,
        answeredThisRound: state.answeredThisRound,
        matchEvents: cloneMatchEvents(),
        refereeAdjustments: cloneRefereeAdjustments(),
        cellState: null,
        questionHistorySnapshot: null
      },
      state.matchSettings
    );

    state.doubleArmed = false;
    state.activeTurn = targetTeamIdx;
    renderScoreboard();
    updateUndoButtonUI();
    persistActiveMatch();
    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playTileOpen();
    }
    showToast(`🎯 تم تعيين الدور لـ ${targetTeam.name}`, "info");
  }

  function adjustTeamPowerup(teamIndex, key, delta) {
    const team = state.teams[teamIndex];
    if (!team || !team.powerups) return;
    const prop = key === "swap" ? "swapLeft" : "doubleLeft";
    const labelAr = key === "swap" ? "تبديل السؤال" : "مضاعفة 2x";
    const curVal = Number(team.powerups[prop]) || 0;
    const nextVal = Math.max(0, Math.min(3, curVal + delta));
    if (nextVal === curVal) return;

    matchStore.pushUndoSnapshot(
      {
        actionType: "referee-powerup",
        label: `تعديل رصيد ${labelAr} (${team.name})`,
        teams: cloneTeamsState(),
        activeTurn: state.activeTurn,
        doubleArmed: state.doubleArmed,
        answeredThisRound: state.answeredThisRound,
        matchEvents: cloneMatchEvents(),
        refereeAdjustments: cloneRefereeAdjustments(),
        cellState: null,
        questionHistorySnapshot: null
      },
      state.matchSettings
    );

    team.powerups[prop] = nextVal;
    if (prop === "doubleLeft") {
      team.lifelines.double = nextVal === 0;
      if (nextVal === 0 && state.activeTurn === teamIndex) {
        state.doubleArmed = false;
      }
    }
    state.refereeAdjustments.push({
      id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      teamId: team.id || `team-${teamIndex}`,
      teamName: team.name,
      type: "powerup",
      delta: nextVal - curVal,
      detail: labelAr,
      timestamp: Date.now()
    });

    renderScoreboard();
    updateUndoButtonUI();
    persistActiveMatch();
    showToast(`⚖️ ${team.name}: أصبح رصيد ${labelAr} = ${nextVal}`, "info");
  }

  function renderRefereePopover() {
    if (!dom.refereePopover || state.refereePopoverTeamIdx === null) return;
    const team = state.teams[state.refereePopoverTeamIdx];
    if (!team) {
      closeRefereePopover();
      return;
    }
    if (dom.refereeTeamTitle) {
      dom.refereeTeamTitle.textContent = `⚖️ تحكيم: ${team.name} (${team.score} نقطة)`;
    }
    if (dom.refDoubleVal) {
      dom.refDoubleVal.textContent = String(team.powerups ? team.powerups.doubleLeft : 0);
    }
    if (dom.refSwapVal) {
      dom.refSwapVal.textContent = String(team.powerups ? team.powerups.swapLeft : 0);
    }
    if (dom.btnRefSetTurn) {
      const alreadyTurn = state.activeTurn === state.refereePopoverTeamIdx;
      dom.btnRefSetTurn.disabled = alreadyTurn;
      dom.btnRefSetTurn.textContent = alreadyTurn
        ? "✓ هذا الفريق هو صاحب الدور حالياً"
        : "🎯 تعيين الدور لهذا الفريق الآن";
    }
  }

  function openRefereePopover(teamIdx) {
    if (!dom.refereePopover || !state.teams[teamIdx]) return;
    if (state.refereePopoverTeamIdx === teamIdx && !dom.refereePopover.hidden) {
      closeRefereePopover();
      return;
    }
    state.refereePopoverTeamIdx = teamIdx;
    if (dom.refereeCustomDeltaInput) dom.refereeCustomDeltaInput.value = "";
    renderRefereePopover();
    dom.refereePopover.hidden = false;
  }

  function closeRefereePopover() {
    state.refereePopoverTeamIdx = null;
    if (dom.refereePopover) dom.refereePopover.hidden = true;
  }

  function switchTurnManually() {
    const nextIdx = (state.activeTurn + 1) % state.teams.length;
    setActiveTurnManually(nextIdx);
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
    stopActiveAudioChallenge();
    hideCharadesSecret();
    state.memoryPhase = null;
    if (dom.diffHostControls) dom.diffHostControls.hidden = true;
    if (dom.diffLiveDots) dom.diffLiveDots.innerHTML = "";
    if (dom.spotDiffBadgeWrap) {
      dom.spotDiffBadgeWrap.hidden = true;
      dom.spotDiffBadgeWrap.classList.remove("is-complete");
    }
    if (dom.audioChallengePanel) dom.audioChallengePanel.hidden = true;
    if (dom.audioChError) {
      dom.audioChError.hidden = true;
      dom.audioChError.textContent = "";
    }
    if (dom.answerImageToggleBar) dom.answerImageToggleBar.hidden = true;
    if (dom.answerCompareGrid) dom.answerCompareGrid.hidden = true;
    if (dom.answerCompareQImg) dom.answerCompareQImg.removeAttribute("src");
    if (dom.answerCompareAImg) dom.answerCompareAImg.removeAttribute("src");
    if (dom.answerImageStage) dom.answerImageStage.hidden = false;
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
      differencesFound: Math.max(0, Math.floor(Number(cq.differencesFound) || 0)),
      answerImageMode: cq.answerImageMode || "answer",
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
    cq.differencesFound = Math.max(0, Math.floor(Number(snap.differencesFound) || 0));
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
      differencesFound: cq.differencesFound,
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
        hint: "كشف التلميح",
        diff: "تعديل عدّاد الفروقات"
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
    stopActiveAudioChallenge();
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
        state.memoryTimerStatus = "running";
        state.memoryTimerDurationMs = Math.max(0, state.memoryTotal) * 1000;
        state.memoryTimerRemainingMs = state.memoryTimerDurationMs;
        state.memoryTimerEndAtMs = getWirelessServerNowMs() + state.memoryTimerDurationMs;
        dom.memoryCountdownPanel.hidden = false;
        updateSingleImageZoomability();
        renderTimerUI();
        renderMemoryCountdownUI(false);
        if (state.dualScreen.connected || state.wireless.active) {
          broadcastLiveDisplayState();
        }
        persistActiveMatch();

        if (window.SeenJeemAudio) {
          window.SeenJeemAudio.playTick(false);
        }

        state.memoryInterval = setInterval(() => {
          state.memoryRemaining = Math.max(0, state.memoryRemaining - 1);
          renderMemoryCountdownUI(true);

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
        state.memoryTimerStatus = "idle";
        state.memoryTimerEndAtMs = null;
        renderTimerUI();
      }
    });
  }

  function renderMemoryCountdownUI(isPerSecondTick = true) {
    dom.memorySecondsDisplay.textContent = String(state.memoryRemaining);
    const pct = state.memoryTotal > 0 ? (state.memoryRemaining / state.memoryTotal) * 100 : 0;
    dom.memoryProgressBar.style.width = `${pct}%`;
    if (state.dualScreen.connected) {
      broadcastLiveDisplayState({ skipWireless: Boolean(isPerSecondTick) });
    }
  }

  /** المرحلة الثالثة لنوع memory: إخفاء الصورة وإظهار السؤال وبدء مؤقت الـ 60 ثانية */
  function finishMemoryViewingPhase() {
    if (!state.currentQ || (state.memoryPhase !== "viewing" && state.memoryPhase !== "loading")) {
      return;
    }
    stopMemoryInterval();
    state.memoryTimerStatus = "finished";
    state.memoryTimerEndAtMs = null;
    state.memoryTimerRemainingMs = 0;
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

      if (visualType === "audio") {
        loadQuestionStageImage("");
        setupAudioChallengeForQuestion(q);
      } else if (visualType === "spot-diff") {
        loadQuestionStageImage("");
        renderDifferencesLiveUI();
        renderSpotDiffGallery(q.images);
      } else if (visualType === "differences") {
        renderDifferencesLiveUI();
        if (q.questionImage) {
          loadQuestionStageImage(q.questionImage, {
            retryAttempt: 0,
            loadingLabel: "جاري تحميل صورة الفروقات...",
            isMemory: false,
            onLoaded: () => {
              updateSingleImageZoomability();
            }
          });
        } else {
          loadQuestionStageImage("");
        }
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
    if (cq.isDailyDouble && cq.dailyDoublePhase === "wager") {
      stopTimerInterval();
      stopMemoryInterval();
      state.timerRunning = false;
      state.timerRemaining = getConfiguredMainTimerSeconds() || MAIN_TIMER_SECONDS;
      state.timerMax = state.timerRemaining;
      state.timerMode = "main";
    } else if (cq.phase === "steal-active") {
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
    const isDailyDouble = Boolean(
      (restoredOpenState && restoredOpenState.isDailyDouble) || slot.isDailyDouble
    );
    const basePoints = Number(slot.question.points) || Number(slot.points) || 400;
    const ddMaxWager = Math.max(ownerTeam ? Number(ownerTeam.score) || 0 : 0, basePoints * 2, 100);
    const ddDefaultWager = Math.min(ddMaxWager, Math.max(100, basePoints));
    let doubleActive = false;
    let refundedDoubleForDailyDouble = false;

    if (restoredOpenState) {
      doubleActive = Boolean(
        !isDailyDouble &&
          (restoredOpenState.doubleActive ||
            (Array.isArray(restoredOpenState.usedLifelinesHere) &&
              restoredOpenState.usedLifelinesHere.includes("double")))
      );
    } else if (state.doubleArmed && isDailyDouble) {
      // حماية بطاقة 2x: لا تُستهلك إذا تزامن تفعيلها مع مربع ذهبي مخفي
      state.doubleArmed = false;
      doubleActive = false;
      refundedDoubleForDailyDouble = true;
      renderScoreboard();
      updateUndoButtonUI();
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
      isDailyDouble,
      dailyDoublePhase:
        isDailyDouble
          ? restoredOpenState && restoredOpenState.dailyDoublePhase === "question"
            ? "question"
            : "wager"
          : "question",
      dailyDoubleWager:
        isDailyDouble && restoredOpenState && Number(restoredOpenState.dailyDoubleWager) >= 100
          ? Number(restoredOpenState.dailyDoubleWager)
          : ddDefaultWager,
      dailyDoubleMaxWager:
        isDailyDouble && restoredOpenState && Number(restoredOpenState.dailyDoubleMaxWager) >= 100
          ? Number(restoredOpenState.dailyDoubleMaxWager)
          : ddMaxWager,
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
      differencesFound: Math.max(0, Math.floor(Number(restoredOpenState && restoredOpenState.differencesFound) || 0)),
      answerImageMode: (restoredOpenState && restoredOpenState.answerImageMode) || "answer",
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
    resetAllPlayState(false);
    applyCurrentQuestionStage(restoredOpenState);
    renderWirelessBuzzerBars();
    persistActiveMatch();

    if (!restoredOpenState && window.SeenJeemAudio) {
      if (isDailyDouble && typeof window.SeenJeemAudio.playFanfare === "function") {
        window.SeenJeemAudio.playFanfare();
      } else {
        window.SeenJeemAudio.playTileOpen();
      }
    }
    if (refundedDoubleForDailyDouble) {
      showToast("⚡ تم استرجاع بطاقة 2x لأن السؤال مربع ذهبي!", "info");
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

    if (cq.isDailyDouble && cq.dailyDoublePhase === "wager") {
      dom.modalPointsPill.classList.add("doubled");
      dom.modalPointsPill.textContent = `🌟 مربع ذهبي (${basePoints})`;
    } else if (cq.isDailyDouble) {
      dom.modalPointsPill.classList.add("doubled");
      dom.modalPointsPill.textContent = `🌟 رهان: ${cq.dailyDoubleWager} نقطة`;
    } else if (cq.phase === "steal-active") {
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

    // ترويسة الدور وشريط السرقة العلوي (يدعم 2 إلى 4 فرق)
    dom.modalTurnBadge.classList.remove(
      "team-1-turn",
      "team-2-turn",
      "team-3-turn",
      "team-4-turn",
      "steal-turn-0",
      "steal-turn-1",
      "steal-turn-2",
      "steal-turn-3"
    );
    if (cq.phase === "steal-active") {
      dom.modalTurnBadge.classList.add(`steal-turn-${cq.stealingTeamIdx}`);
      dom.modalTurnBadge.innerHTML = `🔥 فرصة سرقة لـ <strong id="modal-active-team-name">${escapeHtml(
        stealingTeam.name
      )}</strong>`;

      if (dom.stealStatusBanner) {
        dom.stealStatusBanner.hidden = false;
        dom.stealStatusBanner.className = `steal-status-banner steal-team-${cq.stealingTeamIdx}`;
      }
      if (dom.stealBannerText) {
        dom.stealBannerText.textContent = `فرصة سرقة لـ ${stealingTeam.name}`;
      }
      if (dom.stealBannerPtsBadge) {
        dom.stealBannerPtsBadge.textContent = `+${stealPoints} نقطة`;
      }

      // في حال وجود 3 فرق أو أكثر: عرض أزرار سريعة وملوّنة لاختيار الفريق السارق
      if (dom.stealTeamSelector) {
        if (state.teams.length >= 3) {
          dom.stealTeamSelector.innerHTML = "";
          state.teams.forEach((t, idx) => {
            if (idx === cq.activeTeamAtOpen) return;
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = `steal-team-pill team-${idx + 1}-pill${idx === cq.stealingTeamIdx ? " active" : ""}`;
            pill.dataset.stealTeam = String(idx);
            pill.innerHTML = `<span class="team-badge-dot team-${idx + 1}-dot"></span><span>${escapeHtml(t.name)}</span>`;
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
      dom.modalTurnBadge.classList.add(`team-${(cq.activeTeamAtOpen || 0) + 1}-turn`);
      dom.modalTurnBadge.innerHTML = `دور: <strong id="modal-active-team-name">${escapeHtml(
        ownerTeam.name
      )}</strong>`;
      if (dom.stealStatusBanner) {
        dom.stealStatusBanner.hidden = true;
      }
    }

    if (cq.isDailyDouble) {
      const inWager = cq.dailyDoublePhase === "wager";
      const basePts = Number(cq.question.points) || 400;
      const maxW = Math.max(100, Number(cq.dailyDoubleMaxWager) || basePts * 2);

      if (dom.dailyDoubleBanner) dom.dailyDoubleBanner.hidden = false;
      if (dom.dailyDoubleBannerSub) {
        dom.dailyDoubleBannerSub.textContent = inWager
          ? `خاص بـ ${ownerTeam.name} — اختر رهانك قبل رؤية السؤال (الصح +رهان / الخطأ -رهان بدون سرقة)`
          : `الرهان المثبّت لـ ${ownerTeam.name}: ±${cq.dailyDoubleWager} نقطة (لا توجد فرصة سرقة)`;
      }
      if (dom.dailyDoubleWagerPanel) dom.dailyDoubleWagerPanel.hidden = !inWager;

      if (inWager) {
        if (dom.ddWagerTeamLabel) dom.ddWagerTeamLabel.textContent = `🌟 رهان ${ownerTeam.name}`;
        if (dom.ddWagerBoundsLabel) dom.ddWagerBoundsLabel.textContent = `من 100 حتى ${maxW} نقطة`;
        if (dom.ddWagerInput) {
          dom.ddWagerInput.min = "100";
          dom.ddWagerInput.max = String(maxW);
          if (
            document.activeElement !== dom.ddWagerInput ||
            !dom.ddWagerInput.value
          ) {
            dom.ddWagerInput.value = String(cq.dailyDoubleWager || Math.min(maxW, basePts));
          }
        }
        if (dom.btnDdPresetBase) dom.btnDdPresetBase.textContent = `القيمة الأصلية (${Math.min(maxW, basePts)})`;
        if (dom.btnDdPresetDouble) dom.btnDdPresetDouble.textContent = `ضعف القيمة (${Math.min(maxW, basePts * 2)})`;
        if (dom.btnDdPresetAllin) dom.btnDdPresetAllin.textContent = `الكل All-In (${maxW})`;
      }

      if (dom.questionBodyBox) dom.questionBodyBox.hidden = inWager;
      if (dom.questionTacticalBar && inWager) dom.questionTacticalBar.hidden = true;
      if (dom.timerSection) dom.timerSection.hidden = inWager || cq.isCharades;
      if (dom.btnWrongAnswer) dom.btnWrongAnswer.hidden = true;
    } else {
      if (dom.dailyDoubleBanner) dom.dailyDoubleBanner.hidden = true;
      if (dom.dailyDoubleWagerPanel) dom.dailyDoubleWagerPanel.hidden = true;
      if (dom.questionBodyBox) dom.questionBodyBox.hidden = false;
      if (dom.btnWrongAnswer) dom.btnWrongAnswer.hidden = false;
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
    if (dom.ddResolveActions) dom.ddResolveActions.hidden = true;

    if (cq.isDailyDouble && cq.dailyDoublePhase === "wager") {
      // تذييل فارغ أثناء الرهان لأن زر التثبيت داخل لوحة الرهان
    } else if (cq.revealed && cq.isDailyDouble) {
      if (dom.ddResolvePrompt) {
        dom.ddResolvePrompt.textContent = `🌟 حسم المربع الذهبي لفريق «${ownerTeam.name}» (الرهان: ${cq.dailyDoubleWager} نقطة):`;
      }
      if (dom.btnDdCorrectLabel) {
        dom.btnDdCorrectLabel.textContent = `✅ إجابة صحيحة (+${cq.dailyDoubleWager})`;
      }
      if (dom.btnDdWrongLabel) {
        dom.btnDdWrongLabel.textContent = `❌ إجابة خاطئة (-${cq.dailyDoubleWager})`;
      }
      if (dom.ddResolveActions) dom.ddResolveActions.hidden = false;
    } else if (cq.revealed) {
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

  function setDailyDoublePreset(kind) {
    if (!state.currentQ || !state.currentQ.isDailyDouble || state.currentQ.dailyDoublePhase !== "wager") return;
    const cq = state.currentQ;
    const basePts = Number(cq.question.points) || 400;
    const maxW = Math.max(100, Number(cq.dailyDoubleMaxWager) || basePts * 2);
    let target = basePts;
    if (kind === "double") target = basePts * 2;
    else if (kind === "allin") target = maxW;
    const clamped = Math.min(maxW, Math.max(100, Math.round(target)));
    cq.dailyDoubleWager = clamped;
    if (dom.ddWagerInput) dom.ddWagerInput.value = String(clamped);
  }

  function lockDailyDoubleWager() {
    if (!state.currentQ || !state.currentQ.isDailyDouble || state.currentQ.dailyDoublePhase !== "wager") return;
    const cq = state.currentQ;
    const maxW = Math.max(100, Number(cq.dailyDoubleMaxWager) || 800);
    const raw = dom.ddWagerInput ? Number(dom.ddWagerInput.value) : cq.dailyDoubleWager;
    const clamped = Number.isFinite(raw) ? Math.min(maxW, Math.max(100, Math.round(raw))) : Math.min(maxW, 400);

    cq.dailyDoubleWager = clamped;
    cq.dailyDoublePhase = "question";
    if (window.SeenJeemAudio) window.SeenJeemAudio.playDoubleArm();
    applyCurrentQuestionStage(null);
    persistActiveMatch();
    showToast(`🔒 تم تثبيت رهان المربع الذهبي على ${clamped} نقطة — حظاً موفقاً!`, "success");
  }

  function resolveDailyDouble(didSucceed) {
    if (!state.currentQ || !state.currentQ.isDailyDouble || !state.currentQ.revealed) return;
    const cq = state.currentQ;
    const ownerIdx = cq.activeTeamAtOpen;
    const ownerTeam = state.teams[ownerIdx] || state.teams[0];
    const wager = Math.max(100, Number(cq.dailyDoubleWager) || 400);

    if (didSucceed) {
      if (window.SeenJeemAudio) window.SeenJeemAudio.playScore(true);
      showToast(`🌟 مذهل! +${wager} نقطة لـ ${ownerTeam.name} من المربع الذهبي!`, "success");
      commitQuestionResolution({
        winnerTeamIndex: ownerIdx,
        awardedPoints: wager,
        actionType: "daily-double-win",
        undoLabel: `مربع ذهبي ناجح (+${wager}) لـ ${ownerTeam.name}`,
        showBriefAnswerPreview: false
      });
    } else {
      if (window.SeenJeemAudio) window.SeenJeemAudio.playWrongAnswer();
      showToast(`❌ خسر ${ownerTeam.name} رهان المربع الذهبي (-${wager} نقطة)`, "warning");
      commitQuestionResolution({
        winnerTeamIndex: null,
        awardedPoints: 0,
        deductTeamIndex: ownerIdx,
        deductPoints: wager,
        actionType: "daily-double-loss",
        undoLabel: `خسارة رهان المربع الذهبي (-${wager}) لـ ${ownerTeam.name}`,
        showBriefAnswerPreview: false
      });
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

    // تفعيل شريط التبديل/المقارنة السلس عند وجود صورة السؤال وصورة الإجابة معاً (Pack 12)
    const hasBothImgs = Boolean(
      q.questionImage && q.questionImage.trim() && q.answerImage && q.answerImage.trim() && vType !== "memory" && vType !== "audio"
    );
    if (dom.answerImageToggleBar) {
      dom.answerImageToggleBar.hidden = !hasBothImgs;
    }
    if (hasBothImgs && state.currentQ) {
      setAnswerImageViewMode(state.currentQ.answerImageMode || "answer", true);
    } else {
      if (dom.answerCompareGrid) dom.answerCompareGrid.hidden = true;
      if (dom.answerImageStage) dom.answerImageStage.hidden = !Boolean(answerImgSrc);
    }
  }

  /* =========================================================
     الحزمة الثانية عشرة:
     1) التبديل والمقارنة السلسة بين صورة السؤال وصورة الإجابة
     2) عدّاد «أوجد الفروقات» الحي المتزامن
     3) التحديات الصوتية المتزامنة (Anti-Echo + BroadcastChannel)
     ========================================================= */
  function setAnswerImageViewMode(mode = "answer", silentBroadcast = false) {
    if (!state.currentQ || !state.currentQ.question) return;
    const cleanMode = mode === "question" || mode === "compare" ? mode : "answer";
    state.currentQ.answerImageMode = cleanMode;
    const q = state.currentQ.question;
    const qSrc = normalizeAssetPath(q.questionImage || "");
    const aSrc = normalizeAssetPath(q.answerImage || "");

    [
      [dom.btnAnsViewAnswer, "answer"],
      [dom.btnAnsViewQuestion, "question"],
      [dom.btnAnsViewCompare, "compare"]
    ].forEach(([btn, key]) => {
      if (!btn) return;
      btn.classList.toggle("active", cleanMode === key);
      btn.classList.toggle("btn-amber", cleanMode === key);
      btn.classList.toggle("btn-secondary", cleanMode !== key);
    });

    if (cleanMode === "compare" && qSrc && aSrc) {
      if (dom.answerCompareQImg) dom.answerCompareQImg.src = qSrc;
      if (dom.answerCompareAImg) dom.answerCompareAImg.src = aSrc;
      if (dom.answerCompareGrid) dom.answerCompareGrid.hidden = false;
      if (dom.answerImageStage) dom.answerImageStage.hidden = true;
    } else {
      if (dom.answerCompareGrid) dom.answerCompareGrid.hidden = true;
      if (dom.answerImageStage) dom.answerImageStage.hidden = false;
      const targetSrc = cleanMode === "question" && qSrc ? qSrc : aSrc;
      if (targetSrc) {
        loadAnswerStageImage(targetSrc, 0);
      }
    }

    if (!silentBroadcast) {
      broadcastLiveDisplayState();
    }
  }

  function renderDifferencesLiveUI() {
    if (!state.currentQ || !state.currentQ.question) return;
    const cq = state.currentQ;
    const q = cq.question;
    const isDiff = (cq.visualType === "differences" || cq.visualType === "spot-diff") && Number(q.differencesCount) > 0;
    if (!isDiff) {
      if (dom.spotDiffBadgeWrap) dom.spotDiffBadgeWrap.hidden = true;
      if (dom.diffHostControls) dom.diffHostControls.hidden = true;
      return;
    }
    const total = Math.min(20, Math.max(1, Math.round(Number(q.differencesCount) || 5)));
    const found = Math.min(total, Math.max(0, Math.floor(Number(cq.differencesFound) || 0)));
    cq.differencesFound = found;

    if (dom.spotDiffCountBadge) {
      dom.spotDiffCountBadge.textContent = `🔍 أوجد الفروقات: ${found} / ${total}`;
    }
    if (dom.spotDiffBadgeWrap) {
      dom.spotDiffBadgeWrap.hidden = false;
      dom.spotDiffBadgeWrap.classList.toggle("is-complete", found >= total);
    }
    if (dom.diffLiveDots) {
      dom.diffLiveDots.innerHTML = Array.from(
        { length: total },
        (_, i) => `<span class="diff-dot${i < found ? " is-found" : ""}"></span>`
      ).join("");
    }
    if (dom.diffHostControls) {
      dom.diffHostControls.hidden = false;
    }
    if (dom.btnDiffIncrement) dom.btnDiffIncrement.disabled = found >= total;
    if (dom.btnDiffDecrement) dom.btnDiffDecrement.disabled = found <= 0;
    if (dom.btnDiffReset) dom.btnDiffReset.disabled = found <= 0;
  }

  function incrementDifference() {
    if (!state.currentQ || !state.currentQ.question) return;
    const cq = state.currentQ;
    const total = Math.min(20, Math.max(1, Math.round(Number(cq.question.differencesCount) || 5)));
    if ((cq.differencesFound || 0) >= total) return;
    cq.inModalSnapshots.push(captureInModalSnapshot("diff"));
    cq.differencesFound = Math.min(total, (cq.differencesFound || 0) + 1);
    renderDifferencesLiveUI();
    persistActiveMatch();
    if (window.SeenJeemAudio) {
      if (cq.differencesFound >= total && typeof window.SeenJeemAudio.playDiffComplete === "function") {
        window.SeenJeemAudio.playDiffComplete();
        showToast(`🎉 رائع! تم اكتشاف جميع الفروقات (${total} / ${total})!`, "success");
      } else if (typeof window.SeenJeemAudio.playDiffFound === "function") {
        window.SeenJeemAudio.playDiffFound();
      }
    }
  }

  function decrementDifference() {
    if (!state.currentQ || !state.currentQ.question) return;
    const cq = state.currentQ;
    if ((cq.differencesFound || 0) <= 0) return;
    cq.inModalSnapshots.push(captureInModalSnapshot("diff"));
    cq.differencesFound = Math.max(0, (cq.differencesFound || 0) - 1);
    renderDifferencesLiveUI();
    persistActiveMatch();
  }

  function resetDifferences() {
    if (!state.currentQ || !state.currentQ.question) return;
    const cq = state.currentQ;
    if ((cq.differencesFound || 0) === 0) return;
    cq.inModalSnapshots.push(captureInModalSnapshot("diff"));
    cq.differencesFound = 0;
    renderDifferencesLiveUI();
    persistActiveMatch();
  }

  function getEffectiveAudioChallengeRoute() {
    return state.dualScreen.connected && state.audioChallenge.route !== "host" ? "display" : "host";
  }

  function stopActiveAudioChallenge() {
    if (window.SeenJeemAudioChallenge) {
      window.SeenJeemAudioChallenge.stop();
    }
    if (liveSync && state.dualScreen.connected && typeof liveSync.broadcastAudioControl === "function") {
      liveSync.broadcastAudioControl("STOP", {});
    }
    state.audioChallenge.status = {
      playing: false,
      teaserActive: false,
      currentTime: 0,
      duration: 0,
      volume: state.audioChallenge.status ? state.audioChallenge.status.volume : 0.85,
      autoplayBlocked: false,
      error: ""
    };
  }

  function setupAudioChallengeForQuestion(q) {
    if (!q || !dom.audioChallengePanel) return;
    const audioSrc = typeof q.audioUrl === "string" ? q.audioUrl.trim() : "";
    const clipStart = Number.isFinite(Number(q.audioStart)) && Number(q.audioStart) >= 0 ? Number(q.audioStart) : 0;
    const clipEnd =
      q.audioEnd !== undefined && q.audioEnd !== null && Number.isFinite(Number(q.audioEnd)) && Number(q.audioEnd) > clipStart
        ? Number(q.audioEnd)
        : null;

    dom.audioChallengePanel.hidden = false;
    state.audioChallenge.status = {
      playing: false,
      teaserActive: false,
      currentTime: 0,
      duration: clipEnd ? clipEnd - clipStart : 0,
      volume: state.audioChallenge.status ? state.audioChallenge.status.volume : 0.85,
      autoplayBlocked: false,
      error: audioSrc ? "" : "لا يوجد رابط أو ملف صوتي مرفق لهذا السؤال."
    };

    if (audioSrc && getEffectiveAudioChallengeRoute() === "host" && window.SeenJeemAudioChallenge) {
      window.SeenJeemAudioChallenge.load(audioSrc, {
        start: clipStart,
        end: clipEnd,
        questionId: q.id || ""
      });
    }
    renderAudioChallengeHostUI();
  }

  function renderAudioChallengeHostUI() {
    if (!dom.audioChallengePanel || dom.audioChallengePanel.hidden) return;
    const st = state.audioChallenge.status || {};
    const fmt =
      window.SeenJeemAudioChallengeUtils && window.SeenJeemAudioChallengeUtils.formatMmSs
        ? window.SeenJeemAudioChallengeUtils.formatMmSs
        : (s) => formatTime(s);
    const cur = Math.max(0, Number(st.currentTime) || 0);
    const dur = Math.max(0, Number(st.duration) || 0);
    const route = getEffectiveAudioChallengeRoute();

    if (dom.btnAudioChRoute) {
      dom.btnAudioChRoute.hidden = !state.dualScreen.connected;
      dom.btnAudioChRoute.textContent =
        route === "display" ? "📺 الصوت: التلفزيون فقط (بلا صدى)" : "💻 الصوت: جهاز المقدّم (معاينة)";
    }
    if (dom.audioChVisualizer) {
      dom.audioChVisualizer.classList.toggle("is-playing", Boolean(st.playing));
    }
    if (dom.audioChCurTime) dom.audioChCurTime.textContent = fmt(cur);
    if (dom.audioChDurTime) dom.audioChDurTime.textContent = dur > 0 ? fmt(dur) : "--:--";
    if (dom.audioChSeek) {
      dom.audioChSeek.max = String(dur > 0 ? dur : 100);
      dom.audioChSeek.value = String(dur > 0 ? Math.min(dur, cur) : 0);
      dom.audioChSeek.disabled = dur <= 0;
    }
    if (dom.btnAudioChPlay) dom.btnAudioChPlay.hidden = Boolean(st.playing);
    if (dom.btnAudioChPause) dom.btnAudioChPause.hidden = !Boolean(st.playing);
    if (dom.audioChStatusText) {
      dom.audioChStatusText.textContent = st.autoplayBlocked
        ? "🔇 يرجى النقر على شاشة التلفزيون لتفعيل الصوت"
        : st.teaserActive
          ? "⚡ تشغيل مقطع سريع (5ث)..."
          : st.playing
            ? "🔊 قيد التشغيل"
            : "⏸️ متوقف / جاهز";
    }
    if (dom.audioChError) {
      dom.audioChError.hidden = !st.error;
      dom.audioChError.textContent = st.error || "";
    }
  }

  async function sendAudioChallengeAction(action, payload = {}) {
    if (!state.currentQ || !state.currentQ.question) return;
    const q = state.currentQ.question;
    const src = typeof q.audioUrl === "string" ? q.audioUrl.trim() : "";
    if (!src && action !== "STOP") {
      showToast("لا يوجد ملف صوتي لهذا السؤال", "warning");
      return;
    }
    const clipStart = Number.isFinite(Number(q.audioStart)) && Number(q.audioStart) >= 0 ? Number(q.audioStart) : 0;
    const clipEnd =
      q.audioEnd !== undefined && q.audioEnd !== null && Number.isFinite(Number(q.audioEnd)) && Number(q.audioEnd) > clipStart
        ? Number(q.audioEnd)
        : null;
    const route = getEffectiveAudioChallengeRoute();

    if (route === "display" && liveSync && typeof liveSync.broadcastAudioControl === "function") {
      // منع الصدى: التأكد من إيقاف الصوت على جهاز المقدّم
      if (window.SeenJeemAudioChallenge) window.SeenJeemAudioChallenge.pause();
      liveSync.broadcastAudioControl(action, {
        ...payload,
        src,
        clipStart,
        clipEnd,
        questionId: q.id || ""
      });
      if (action === "PLAY" || action === "REPLAY" || action === "TEASER_5S") {
        state.audioChallenge.status.playing = true;
        state.audioChallenge.status.teaserActive = action === "TEASER_5S";
      } else if (action === "PAUSE" || action === "STOP") {
        state.audioChallenge.status.playing = false;
        state.audioChallenge.status.teaserActive = false;
      }
      renderAudioChallengeHostUI();
      broadcastLiveDisplayState();
      return;
    }

    // وضع الشاشة الواحدة أو معاينة المقدّم المحلية
    if (liveSync && state.dualScreen.connected && typeof liveSync.broadcastAudioControl === "function") {
      liveSync.broadcastAudioControl("PAUSE", {});
    }
    const player = window.SeenJeemAudioChallenge;
    if (!player) return;
    player.load(src, { start: clipStart, end: clipEnd, questionId: q.id || "" });
    if (action === "PLAY") await player.play();
    else if (action === "PAUSE") player.pause();
    else if (action === "REPLAY") await player.replay();
    else if (action === "TEASER_5S") await player.playTeaser(Number(payload.seconds) || 5);
    else if (action === "SEEK") player.seek(Number(payload.seconds) || 0);
    else if (action === "SET_VOLUME") player.setVolume(Number(payload.volume));
    else if (action === "STOP") player.stop();
  }

  function commitQuestionResolution({
    winnerTeamIndex = null,
    awardedPoints = 0,
    multiAwards = null,
    deductTeamIndex = null,
    deductPoints = 0,
    actionType = "award",
    undoLabel = "تعديل النقاط",
    showBriefAnswerPreview = false
  }) {
    if (!state.currentQ) return;

    stopTimerInterval();
    stopMemoryInterval();
    stopActiveAudioChallenge();
    hideCharadesSecret();
    resetAllPlayState(false);
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
        refereeAdjustments: cloneRefereeAdjustments(),
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

    const cleanMultiAwards = Array.isArray(multiAwards)
      ? multiAwards.filter(
          (a) =>
            a &&
            Number.isInteger(a.teamIdx) &&
            a.teamIdx >= 0 &&
            a.teamIdx < state.teams.length &&
            Number(a.points) > 0
        )
      : [];

    const hasValidWinner =
      cleanMultiAwards.length === 0 &&
      Number.isInteger(winnerTeamIndex) &&
      winnerTeamIndex >= 0 &&
      winnerTeamIndex < state.teams.length;

    if (cleanMultiAwards.length > 0) {
      cleanMultiAwards.forEach((a) => {
        state.teams[a.teamIdx].score += Number(a.points);
      });
    } else if (hasValidWinner && awardedPoints > 0) {
      state.teams[winnerTeamIndex].score += awardedPoints;
    }

    const cleanDeductPoints = Number(deductPoints) || 0;
    if (
      Number.isInteger(deductTeamIndex) &&
      deductTeamIndex >= 0 &&
      deductTeamIndex < state.teams.length &&
      cleanDeductPoints > 0
    ) {
      state.teams[deductTeamIndex].score = Math.max(0, state.teams[deductTeamIndex].score - cleanDeductPoints);
    }

    // تسجيل الحدث في سجل إحصائيات المباراة (MatchEvent[])
    const askingTeam = state.teams[cq.activeTeamAtOpen] || state.teams[0];
    const primaryMultiWinner = cleanMultiAwards.length === 1 ? cleanMultiAwards[0] : null;
    const effectiveWinnerIdx = hasValidWinner
      ? winnerTeamIndex
      : primaryMultiWinner
        ? primaryMultiWinner.teamIdx
        : null;
    const awardedTeam = effectiveWinnerIdx !== null ? state.teams[effectiveWinnerIdx] : null;
    const isStealWin = actionType === "steal-win" || (hasValidWinner && winnerTeamIndex !== cq.activeTeamAtOpen && cq.stealConsumed);
    const totalMultiAwarded = cleanMultiAwards.reduce((sum, a) => sum + Number(a.points || 0), 0);
    const eventRecord = matchStore.sanitizeMatchEvent({
      questionId: cq.question.id,
      categoryId: cq.category.id,
      categoryName: cq.category.name,
      questionText: cq.question.question,
      answerText: cq.question.answer,
      explanation: cq.question.explanation || undefined,
      basePoints: Number(cq.question.points) || 200,
      effectivePoints: cleanMultiAwards.length > 0 ? totalMultiAwarded : hasValidWinner ? awardedPoints : 0,
      askingTeamId: askingTeam ? askingTeam.id : `team-${cq.activeTeamAtOpen}`,
      awardedTeamId: awardedTeam ? awardedTeam.id : null,
      wasSteal: Boolean(isStealWin),
      wasDouble: Boolean(cq.doubleActive),
      wasDailyDouble: Boolean(cq.isDailyDouble),
      dailyDoubleWager: cq.isDailyDouble ? Number(cq.dailyDoubleWager) || 0 : 0,
      hintUsed: Boolean(cq.hintUsed),
      wasSwapped: Boolean(Array.isArray(cq.swappedOutIds) && cq.swappedOutIds.length > 0),
      timestamp: Date.now()
    });
    if (eventRecord) {
      state.matchEvents.push(eventRecord);
    }

    // تسجيل السؤال النهائي في الخلية كـ «ملعوب» (الأسئلة المستبدلة عبر Swap لم تُسجَّل مطلقاً)
    cq.slot.played = true;
    cq.slot.winnerTeam = effectiveWinnerIdx;
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
        handleBoardCompletedFlow();
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
     المؤقت القياسي ومؤقت «من غير كلام» (Countdown Timers + Timestamp Sync)
     ========================================================= */
  function getWirelessServerNowMs() {
    return realtimeSync && typeof realtimeSync.getServerNowMs === "function"
      ? realtimeSync.getServerNowMs()
      : Date.now();
  }

  function buildTimerDescriptor(status, durationSec, remainingSec, endAtMs = null) {
    const cleanStatus = status || "idle";
    const durationMs = Math.max(0, Math.round((Number(durationSec) || 0) * 1000));
    const remainingMs =
      cleanStatus === "unlimited" || cleanStatus === "finished" || cleanStatus === "ended"
        ? 0
        : Math.max(0, Math.round((Number(remainingSec) || 0) * 1000));
    return {
      status: cleanStatus,
      durationMs,
      endAtMs: cleanStatus === "running" && Number.isFinite(endAtMs) ? Math.round(endAtMs) : null,
      remainingMs
    };
  }

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
      state.timerStatus = "unlimited";
      state.timerDurationMs = 0;
      state.timerRemainingMs = 0;
      state.timerEndAtMs = null;
      renderTimerUI();
      if (state.dualScreen.connected || state.wireless.active) {
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
    state.timerStatus = cleanSecs > 0 ? "running" : "finished";
    state.timerDurationMs = state.timerMax * 1000;
    state.timerRemainingMs = cleanSecs * 1000;
    state.timerEndAtMs = cleanSecs > 0 ? getWirelessServerNowMs() + cleanSecs * 1000 : null;
    renderTimerUI();
    if (state.dualScreen.connected || state.wireless.active) {
      broadcastLiveDisplayState();
    }

    if (cleanSecs > 0) {
      state.timerInterval = setInterval(onTimerTick, 1000);
    }
  }

  function pauseTimer() {
    stopTimerInterval();
    state.timerRunning = false;
    state.timerStatus = state.timerMode === "unlimited" ? "unlimited" : state.timerRemaining > 0 ? "paused" : "finished";
    state.timerRemainingMs = Math.max(0, state.timerRemaining) * 1000;
    state.timerEndAtMs = null;
    renderTimerUI();
    if (state.dualScreen.connected || state.wireless.active) {
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
    state.timerStatus = "running";
    state.timerDurationMs = Math.max(state.timerMax, state.timerRemaining) * 1000;
    state.timerRemainingMs = state.timerRemaining * 1000;
    state.timerEndAtMs = getWirelessServerNowMs() + state.timerRemaining * 1000;
    renderTimerUI();
    if (state.dualScreen.connected || state.wireless.active) {
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
    state.timerStatus = "idle";
    state.timerDurationMs = validSecs * 1000;
    state.timerRemainingMs = validSecs * 1000;
    state.timerEndAtMs = null;
    renderTimerUI();
    if (state.dualScreen.connected || state.wireless.active) {
      broadcastLiveDisplayState();
    }
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
    state.timerStatus = "idle";
    state.timerDurationMs = dur * 1000;
    state.timerRemainingMs = dur * 1000;
    state.timerEndAtMs = null;
    renderTimerUI();
    if (state.dualScreen.connected || state.wireless.active) {
      broadcastLiveDisplayState();
    }
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
    } else if (state.timerRemaining > 0 && state.timerRemaining <= 10) {
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playTick(state.timerRemaining <= 5);
      }
    }

    let justFinished = false;
    if (state.timerRemaining === 0) {
      stopTimerInterval();
      state.timerRunning = false;
      state.timerMode = "ended";
      state.timerStatus = "finished";
      state.timerEndAtMs = null;
      state.timerRemainingMs = 0;
      justFinished = true;
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playTimeUp();
      }
    }

    renderTimerUI();
    // عدم كتابة كل ثانية إلى Firebase؛ نحدّث التلفزيون المحلي فقط، ونرسل لـ Firebase عند انتهاء المؤقت فقط
    if (justFinished) {
      if (state.dualScreen.connected || state.wireless.active) {
        broadcastLiveDisplayState();
      }
    } else if (state.dualScreen.connected) {
      broadcastLiveDisplayState({ skipWireless: true });
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

    const isDanger = !isUnlimited && state.timerRemaining <= 10 && state.timerMode !== "waiting-memory";
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
    stopActiveAudioChallenge();
    hideCharadesSecret();
    resetAllPlayState(false);
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

    if (dom.awardButtonsGrid) {
      dom.awardButtonsGrid.dataset.teamCount = String(state.teams.length);
      dom.awardButtonsGrid.innerHTML = "";
      state.teams.forEach((team, idx) => {
        const pts = idx === ownerIdx ? ownerPts : rivalPts;
        const ptsText = cq.doubleActive && idx === ownerIdx ? `(+${pts} • ⚡2x)` : `(+${pts})`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = `btn-award-team${idx + 1}`;
        btn.className = `btn btn-award-team${idx + 1}`;
        btn.innerHTML = `
          <span class="award-team-label">فاز ${escapeHtml(team.name)}</span>
          <span class="award-points-row">
            <span class="award-points-tag">${ptsText}</span>
            <kbd class="kbd-hint kbd-hint-light">${idx + 1}</kbd>
          </span>
        `;
        btn.addEventListener("click", () => awardQuestion(idx));
        dom.awardButtonsGrid.appendChild(btn);
      });

      const noneBtn = document.createElement("button");
      noneBtn.type = "button";
      noneBtn.id = "btn-award-none";
      noneBtn.className = "btn btn-award-none";
      noneBtn.innerHTML = `
        <span class="award-team-label">لا أحد</span>
        <span class="award-points-row">
          <span class="award-points-tag">(0)</span>
          <kbd class="kbd-hint">0</kbd>
        </span>
      `;
      noneBtn.addEventListener("click", () => awardQuestion(null));
      dom.awardButtonsGrid.appendChild(noneBtn);
    }

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
      "playVictory",
      "playVolumeTestTick",
      "playTestChime",
      "playDrumroll",
      "playApplause",
      "playSadTrombone",
      "playAttentionChime",
      "playFanfare",
      "playSoundboard",
      "playStreakSuccess",
      "playBuzzerWin"
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
    if (state.charadesSolo && dom.charadesSoloModal && dom.charadesSoloModal.classList.contains("open")) {
      renderCsoloView();
    }
  }

  function renderHostCockpitUI() {
    const isDdWager = Boolean(
      state.currentQ && state.currentQ.isDailyDouble && state.currentQ.dailyDoublePhase === "wager"
    );
    const isDualActive = Boolean(state.dualScreen.connected && state.currentQ && !isDdWager);
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

    const qTimerStatus =
      state.timerMode === "unlimited"
        ? "unlimited"
        : state.timerRunning
          ? "running"
          : state.timerRemaining === 0 || state.timerMode === "ended"
            ? "finished"
            : state.timerStatus === "paused"
              ? "paused"
              : "idle";

    return {
      questionId: q.id || "",
      categoryId: cq.category.id,
      categoryName: cq.category.name,
      categoryIcon: cq.category.icon || "🎯",
      categoryColor: getCategoryAccentColor(cq.category),
      basePoints: Number(q.points) || 200,
      discountedBasePoints: computeDiscountedBasePoints(cq),
      effectivePoints: computeEffectiveQuestionPoints(cq),
      stealPoints: computeStealQuestionPoints(cq),
      hintPenaltyPct,
      isDailyDouble: Boolean(cq.isDailyDouble),
      dailyDoublePhase: cq.dailyDoublePhase || "question",
      dailyDoubleWager: cq.isDailyDouble ? Number(cq.dailyDoubleWager) || 0 : 0,
      dailyDoubleMaxWager: cq.isDailyDouble ? Number(cq.dailyDoubleMaxWager) || 0 : 0,
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
      differencesFound: Math.max(0, Math.floor(Number(cq.differencesFound) || 0)),
      answerImageMode: cq.answerImageMode || "answer",
      audioChallenge:
        cq.visualType === "audio" && typeof q.audioUrl === "string" && q.audioUrl.trim()
          ? {
              hasAudio: true,
              audioSrc: q.audioUrl.trim(),
              clipStart: Number.isFinite(Number(q.audioStart)) && Number(q.audioStart) >= 0 ? Number(q.audioStart) : 0,
              clipEnd:
                q.audioEnd !== undefined && q.audioEnd !== null && Number.isFinite(Number(q.audioEnd)) && Number(q.audioEnd) > (Number(q.audioStart) || 0)
                  ? Number(q.audioEnd)
                  : null,
              playing: Boolean(state.audioChallenge.status && state.audioChallenge.status.playing),
              teaserActive: Boolean(state.audioChallenge.status && state.audioChallenge.status.teaserActive),
              currentTime: Number(state.audioChallenge.status && state.audioChallenge.status.currentTime) || 0,
              duration: Number(state.audioChallenge.status && state.audioChallenge.status.duration) || 0,
              volume: Number(state.audioChallenge.status && state.audioChallenge.status.volume) || 0.85,
              route: getEffectiveAudioChallengeRoute()
            }
          : null,
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
      timer: buildTimerDescriptor(
        qTimerStatus,
        state.timerMax,
        state.timerRemaining,
        state.timerEndAtMs
      ),
      charadesDuration: cq.charadesDuration || 60,
      charadesTimerStarted: Boolean(cq.charadesTimerStarted),
      memoryPhase: state.memoryPhase,
      memoryRemaining: state.memoryRemaining,
      memoryTotal: state.memoryTotal,
      memoryTimer:
        cq.visualType === "memory"
          ? buildTimerDescriptor(
              state.memoryPhase === "viewing" ? "running" : state.memoryTimerStatus,
              state.memoryTotal,
              state.memoryRemaining,
              state.memoryTimerEndAtMs
            )
          : null,
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
    const leaderIndices = finalRoundEngine
      ? finalRoundEngine.getLeaderIndices(state.teams)
      : [0];
    const isDraw = leaderIndices.length !== 1;
    const winnerIdx = !isDraw ? leaderIndices[0] : null;
    const eyebrow = isDraw ? "منافسة متكافئة!" : "مبروك الفوز!";
    const title = !isDraw && state.teams[winnerIdx]
      ? `الفائز: ${state.teams[winnerIdx].name}`
      : leaderIndices.length === 2
        ? `تعادل مثير بين ${state.teams[leaderIndices[0]].name} و${state.teams[leaderIndices[1]].name}`
        : `تعادل مثير بين ${leaderIndices.length} فرق في الصدارة!`;
    return {
      winnerIdx,
      leaderIndices,
      eyebrow,
      title,
      teams: state.teams.map((t) => ({ id: t.id, name: t.name, score: t.score })),
      analytics: computeMatchAnalytics()
    };
  }

  function broadcastLiveDisplayState({ skipWireless = false } = {}) {
    if (!liveSync || liveSync.isDisplayMode()) return;

    const isBaraOpen = Boolean(
      window.SeenJeemBaraSalfa &&
      typeof window.SeenJeemBaraSalfa.isOpen === "function" &&
      window.SeenJeemBaraSalfa.isOpen()
    );
    const isMafiaOpen = Boolean(
      window.SeenJeemMafia &&
      typeof window.SeenJeemMafia.isOpen === "function" &&
      window.SeenJeemMafia.isOpen()
    );
    const isAudioChallengeOpen = Boolean(
      window.SeenJeemAudioChallengeMode &&
      typeof window.SeenJeemAudioChallengeMode.isOpen === "function" &&
      window.SeenJeemAudioChallengeMode.isOpen()
    );
    const isTournamentOpen = Boolean(
      window.SeenJeemTournament &&
      typeof window.SeenJeemTournament.isOpen === "function" &&
      window.SeenJeemTournament.isOpen()
    );
    const isBlitzOpen =
      dom.blitzModal &&
      dom.blitzModal.classList.contains("open") &&
      Boolean(state.blitz);
    const isCsoloOpen =
      dom.charadesSoloModal &&
      dom.charadesSoloModal.classList.contains("open") &&
      Boolean(state.charadesSolo);
    const isGameActive = dom.gameScreen && dom.gameScreen.classList.contains("active");
    const isWinnerOpen = dom.winnerModal && dom.winnerModal.classList.contains("open");
    const isFinalOpen =
      dom.finalRoundModal &&
      dom.finalRoundModal.classList.contains("open") &&
      Boolean(state.finalRound);
    const isQuestionOpen =
      dom.questionModal &&
      dom.questionModal.classList.contains("open") &&
      (Boolean(state.currentQ) || Boolean(state.dualScreen.closingPreviewQuestion));

    let screen = "setup";
    let customWinnerView = null;
    if (isAudioChallengeOpen) {
      screen = "audio-challenge";
    } else if (isMafiaOpen) {
      screen = "mafia";
    } else if (isBaraOpen) {
      screen = "bara-salfa";
    } else if (isTournamentOpen) {
      screen = "tournament";
    } else if (isBlitzOpen) {
      if (state.blitz.phase === "finished") {
        screen = "winner";
        customWinnerView = buildSideModeWinnerPayload(state.blitz.teams, "⚡ نهاية جولة البرق السريعة!");
      } else {
        screen = "blitz";
      }
    } else if (isCsoloOpen) {
      if (state.charadesSolo.phase === "finished") {
        screen = "winner";
        customWinnerView = buildSideModeWinnerPayload(
          state.charadesSolo.teams,
          "🎭 نهاية تحدي «من غير كلام»!"
        );
      } else {
        screen = "charades-solo";
      }
    } else if (isWinnerOpen) {
      screen = "winner";
    } else if (isFinalOpen) {
      screen = "final";
    } else if (isQuestionOpen) {
      screen = "question";
    } else if (isGameActive) {
      screen = "board";
    }

    const acPayload =
      screen === "audio-challenge" &&
      window.SeenJeemAudioChallengeMode &&
      typeof window.SeenJeemAudioChallengeMode.buildSanitizedDisplayPayload === "function"
        ? window.SeenJeemAudioChallengeMode.buildSanitizedDisplayPayload()
        : null;
    const effectiveTeams =
      acPayload && Array.isArray(acPayload.teams) && acPayload.teams.length > 0 ? acPayload.teams : state.teams;

    const setupNames = getSetupTeamNames();
    const snapshot = {
      screen,
      setupInfo: {
        team1Name: setupNames[0] || "الفريق الأول",
        team2Name: setupNames[1] || "الفريق الثاني",
        teamNames: setupNames,
        selectedCount: state.selectedCategoryIds.length
      },
      teams: effectiveTeams,
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
      finalRoundView:
        screen === "final" && finalRoundEngine && state.finalRound
          ? (() => {
              const payload = finalRoundEngine.buildSanitizedDisplayPayload(state.finalRound, state.teams);
              if (payload) {
                const fr = state.finalRound;
                const st = fr.timerRunning
                  ? "running"
                  : fr.timerRemaining === 0
                    ? "finished"
                    : fr.timerStatus || "idle";
                payload.timer = buildTimerDescriptor(st, fr.timerMax || 60, fr.timerRemaining, fr.timerEndAtMs);
              }
              return payload;
            })()
          : null,
      winnerView:
        screen === "winner" ? customWinnerView || buildDisplayWinnerPayload() : null,
      blitzView:
        screen === "blitz" && blitzEngine && state.blitz
          ? (() => {
              const payload = blitzEngine.buildSanitizedDisplayPayload(state.blitz);
              if (payload) {
                const bz = state.blitz;
                const st = bz.timerRunning
                  ? "running"
                  : bz.timerRemaining === 0
                    ? "finished"
                    : bz.timerStatus || "idle";
                payload.timer = buildTimerDescriptor(st, bz.durationSeconds || 60, bz.timerRemaining, bz.timerEndAtMs);
              }
              return payload;
            })()
          : null,
      charadesSoloView:
        screen === "charades-solo" && charadesEngine && state.charadesSolo
          ? (() => {
              const payload = charadesEngine.buildSanitizedDisplayPayload(state.charadesSolo);
              if (payload) {
                const cs = state.charadesSolo;
                const st = cs.timerRunning
                  ? "running"
                  : cs.timerRemaining === 0
                    ? "finished"
                    : cs.timerStatus || "idle";
                payload.timer = buildTimerDescriptor(st, cs.durationSeconds || 90, cs.timerRemaining, cs.timerEndAtMs);
              }
              return payload;
            })()
          : null,
      baraSalfaView:
        screen === "bara-salfa" &&
        window.SeenJeemBaraSalfa &&
        typeof window.SeenJeemBaraSalfa.buildSanitizedDisplayPayload === "function"
          ? window.SeenJeemBaraSalfa.buildSanitizedDisplayPayload()
          : null,
      mafiaView:
        screen === "mafia" &&
        window.SeenJeemMafia &&
        typeof window.SeenJeemMafia.buildSanitizedDisplayPayload === "function"
          ? window.SeenJeemMafia.buildSanitizedDisplayPayload()
          : null,
      audioChallengeView: acPayload,
      tournamentView:
        screen === "tournament" &&
        window.SeenJeemTournament &&
        typeof window.SeenJeemTournament.buildSanitizedDisplayPayload === "function"
          ? window.SeenJeemTournament.buildSanitizedDisplayPayload()
          : null,
      allPlay: screen === "question" ? buildPublicAllPlayPayload() : null,
      intermission: {
        active: Boolean(state.intermission && state.intermission.active),
        message: (state.intermission && state.intermission.message) || "استراحة قصيرة — نعود بعد قليل",
        totalSeconds: Number(state.intermission && state.intermission.totalSeconds) || 0,
        remainingSeconds: Number(state.intermission && state.intermission.remainingSeconds) || 0,
        timer:
          state.intermission && state.intermission.active && Number(state.intermission.totalSeconds) > 0
            ? buildTimerDescriptor(
                state.intermission.remainingSeconds === 0 ? "finished" : state.intermission.timerStatus || "running",
                state.intermission.totalSeconds,
                state.intermission.remainingSeconds,
                state.intermission.timerEndAtMs
              )
            : null
      },
      displayPrefs: {
        theme: state.theme || "dark-glass",
        tvScale: Number(state.tvScale) || 100
      },
      audioSettings: getCurrentAudioSettingsPayload(),
      wireless: state.wireless.active
        ? {
            active: true,
            roomCode: state.wireless.roomCode,
            playerUrl: state.wireless.playerUrl,
            showQrOnTv: Boolean(state.wireless.showQrOnTv),
            joinLocked: Boolean(state.wireless.joinLocked),
            maxDevicesPerTeam: Number(state.wireless.maxDevicesPerTeam) === 1 ? 1 : 0,
            buzzer: { ...state.wireless.buzzer }
          }
        : {
            active: false,
            roomCode: "",
            playerUrl: "",
            showQrOnTv: false,
            joinLocked: false,
            maxDevicesPerTeam: 0,
            buzzer: null
          }
    };

    if (liveSync.isSupported()) {
      liveSync.broadcastState(snapshot);
    }
    if (state.wireless.active && !skipWireless) {
      publishWirelessSnapshot(snapshot);
    }
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
    const allEvents = Array.isArray(state.matchEvents) ? state.matchEvents : [];
    // فصل أسئلة اللوحة القياسية عن جولة الحسم النهائية لضمان دقة الإحصائيات
    const events = allEvents.filter((e) => !e.isFinalRound);
    const finalEvents = allEvents.filter((e) => Boolean(e.isFinalRound));
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
      finalRoundsPlayed: finalEvents.length,
      refereeAdjustmentsCount: Array.isArray(state.refereeAdjustments)
        ? state.refereeAdjustments.length
        : 0,
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
      dom.analyticsTeamCompare.dataset.teamCount = String(analytics.teamStats.length);
      dom.analyticsTeamCompare.innerHTML = analytics.teamStats
        .map((ts, idx) => {
          const maxTier = Math.max(1, ts.byTier[200], ts.byTier[400], ts.byTier[600]);
          const pct200 = Math.round((ts.byTier[200] / maxTier) * 100);
          const pct400 = Math.round((ts.byTier[400] / maxTier) * 100);
          const pct600 = Math.round((ts.byTier[600] / maxTier) * 100);
          return `
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
            <div class="analytics-tiers-bars">
              <div class="tier-bar-row">
                <span class="tier-badge t200">200</span>
                <div class="tier-bar-track"><div class="tier-bar-fill t200" style="width:${pct200}%"></div></div>
                <strong class="tier-bar-num">${ts.byTier[200]}</strong>
              </div>
              <div class="tier-bar-row">
                <span class="tier-badge t400">400</span>
                <div class="tier-bar-track"><div class="tier-bar-fill t400" style="width:${pct400}%"></div></div>
                <strong class="tier-bar-num">${ts.byTier[400]}</strong>
              </div>
              <div class="tier-bar-row">
                <span class="tier-badge t600">600</span>
                <div class="tier-bar-track"><div class="tier-bar-fill t600" style="width:${pct600}%"></div></div>
                <strong class="tier-bar-num">${ts.byTier[600]}</strong>
              </div>
            </div>
          </div>
        `;
        })
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
                    ${state.teams
                      .map(
                        (t, idx) =>
                          `<span class="cat-score-pill t${idx + 1}">${escapeHtml(t.name)}: ${cat.teamWins[idx] || 0}</span>`
                      )
                      .join("")}
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
          if (ev.isFinalRound) tags.push(`<span class="ev-tag tag-final">⚔️ جولة الحسم</span>`);
          if (ev.wasDailyDouble) tags.push(`<span class="ev-tag tag-dd">🌟 مربع ذهبي</span>`);
          if (ev.wasDouble) tags.push(`<span class="ev-tag tag-double">⚡ 2x</span>`);
          if (ev.wasSteal) tags.push(`<span class="ev-tag tag-steal">🔥 سرقة</span>`);
          if (ev.hintUsed) tags.push(`<span class="ev-tag tag-hint">💡 تلميح</span>`);
          if (ev.wasSwapped) tags.push(`<span class="ev-tag tag-swap">🔄 مُبدَّل</span>`);

          const winnerClass = winnerIdx >= 0 ? `w-team-${winnerIdx + 1}` : "w-none";
          const winnerBadgeText = ev.isFinalRound
            ? escapeHtml(ev.finalSummary || "جولة الرهان النهائي")
            : winnerName
              ? `${escapeHtml(winnerName)} (+${ev.effectivePoints})`
              : "لا أحد (0)";

          return `
            <div class="analytics-event-item${ev.isFinalRound ? " is-final-event" : ""}">
              <div class="analytics-event-top">
                <span class="analytics-event-num">#${idx + 1}</span>
                <span class="analytics-event-cat">${escapeHtml(ev.categoryName)} (${ev.basePoints})</span>
                <div class="analytics-event-tags">${tags.join("")}</div>
                <span class="analytics-event-winner ${winnerClass}">
                  ${winnerBadgeText}
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
    const leaderIndices = finalRoundEngine
      ? finalRoundEngine.getLeaderIndices(state.teams)
      : [0];
    const winnerLine =
      leaderIndices.length === 1 && state.teams[leaderIndices[0]]
        ? `🏆 الفائز: ${state.teams[leaderIndices[0]].name}`
        : `🤝 تعادل مثير في الصدارة (${leaderIndices.map((i) => state.teams[i].name).join(" / ")})!`;

    const teamLines = state.teams.map((team, idx) => {
      const ts = an.teamStats[idx] || { correct: 0, stealsWon: 0, doubleWins: 0 };
      return `• ${team.name}: ${team.score} نقطة (✅ ${ts.correct} | 🔥 ${ts.stealsWon} سرقة | ⚡ ${ts.doubleWins} مضاعفة)`;
    });

    const lines = [
      "🎯 نتائج مباراة «سين جيم»",
      winnerLine,
      ...teamLines,
      `📊 إجمالي الأسئلة المحسومة: ${an.totalQuestions} • دقة الإجابة: ${an.overallAccuracy}%`
    ];
    if (state.refereeAdjustments && state.refereeAdjustments.length > 0) {
      lines.push(`⚖️ تعديلات تحكيمية: ${state.refereeAdjustments.length}`);
    }
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
     شاشة الفائز (Winner Modal — يدعم 2 إلى 4 فرق وكسر التعادل)
     ========================================================= */
  function openWinnerModal(endedManually = false) {
    closeRefereePopover();
    stopFinalRoundTimer();
    closeModal(dom.finalRoundModal);
    matchStore.clearSavedMatch();

    const leaderIndices = finalRoundEngine
      ? finalRoundEngine.getLeaderIndices(state.teams)
      : [0];
    const isDraw = leaderIndices.length !== 1;
    const winnerIdx = !isDraw ? leaderIndices[0] : null;

    if (dom.winnerModalCard) {
      dom.winnerModalCard.classList.remove(
        "winner-team-1",
        "winner-team-2",
        "winner-team-3",
        "winner-team-4",
        "winner-draw"
      );
      dom.winnerModalCard.classList.add(
        winnerIdx !== null ? `winner-team-${winnerIdx + 1}` : "winner-draw"
      );
    }

    let confettiTheme = null;
    if (!isDraw && winnerIdx !== null && state.teams[winnerIdx]) {
      dom.winnerTrophy.textContent = "🏆";
      dom.winnerSubtitle.textContent = "مبروك الفوز!";
      dom.winnerTitle.textContent = `الفائز: ${state.teams[winnerIdx].name}`;
      confettiTheme = winnerIdx === 0 ? "team1" : winnerIdx === 1 ? "team2" : "default";
    } else {
      dom.winnerTrophy.textContent = "🤝";
      dom.winnerSubtitle.textContent = "منافسة متكافئة!";
      dom.winnerTitle.textContent =
        leaderIndices.length === 2
          ? `تعادل مثير بين ${state.teams[leaderIndices[0]].name} و${state.teams[leaderIndices[1]].name}`
          : `تعادل مثير بين ${leaderIndices.length} فرق في الصدارة!`;
    }

    if (dom.winnerScoresGrid) {
      dom.winnerScoresGrid.dataset.teamCount = String(state.teams.length);
      dom.winnerScoresGrid.innerHTML = state.teams
        .map((team, idx) => {
          const isLeader = leaderIndices.includes(idx);
          const crownLabel = isDraw ? "🤝 متعادل في الصدارة" : "👑 الفائز";
          return `
            <div class="winner-team-box team-${idx + 1}-box${isLeader ? " is-winner" : ""}">
              <div class="winner-crown"${isLeader ? "" : " hidden"}>${crownLabel}</div>
              <div class="winner-team-name">${escapeHtml(team.name)}</div>
              <div class="winner-team-score">${team.score}</div>
              <div class="winner-score-unit">نقطة</div>
            </div>
          `;
        })
        .join("");
    }

    const remaining = countRemainingPlayableQuestions();
    dom.winnerStatsNote.textContent =
      remaining === 0
        ? `تم إكمال جميع أسئلة الجولة بنجاح (${state.answeredThisRound} سؤالاً تم لعبه في هذه الجولة).`
        : `تم إنهاء الجولة بعد لعب ${state.answeredThisRound} سؤالاً (متبقي ${remaining} سؤالاً على اللوحة).`;

    // عرض بند التعديلات التحكيمية بشكل مستقل فقط إن وُجدت دون تشويه دقة الإجابات
    if (dom.winnerRefereeNote) {
      const scoreRefs = (state.refereeAdjustments || []).filter((r) => r.type === "score");
      if (scoreRefs.length > 0) {
        const refSummary = scoreRefs
          .map((r) => `${escapeHtml(r.teamName)} (${r.delta > 0 ? `+${r.delta}` : r.delta})`)
          .join(" • ");
        dom.winnerRefereeNote.innerHTML = `⚖️ <strong>تعديلات تحكيمية (${scoreRefs.length}):</strong> ${refSummary}`;
        dom.winnerRefereeNote.hidden = false;
      } else {
        dom.winnerRefereeNote.hidden = true;
        dom.winnerRefereeNote.textContent = "";
      }
    }

    // زر خوض جولة كسر تعادل عند وجود تعادل في الصدارة (حتى لو كان الخيار معطّلاً بالإعدادات)
    if (dom.btnStartTiebreakerFromWinner) {
      dom.btnStartTiebreakerFromWinner.hidden = !isDraw;
    }

    dom.btnResumeRound.hidden = !(endedManually && remaining > 0);

    // تسجيل نتيجة مباراة البطولة تلقائياً وإظهار زر العودة لجدول البطولة
    if (state.activeTournamentMatch && window.SeenJeemTournament && typeof window.SeenJeemTournament.recordMatchResult === "function") {
      const scoreA = state.teams[0] ? Number(state.teams[0].score) || 0 : 0;
      const scoreB = state.teams[1] ? Number(state.teams[1].score) || 0 : 0;
      window.SeenJeemTournament.recordMatchResult(state.activeTournamentMatch.matchId, { scoreA, scoreB });
      if (dom.btnWinnerReturnTournament) dom.btnWinnerReturnTournament.hidden = false;
    } else if (dom.btnWinnerReturnTournament) {
      dom.btnWinnerReturnTournament.hidden = true;
    }

    renderWinnerAnalyticsDashboard();
    recordClassicMatchToArchive();
    if (window.SeenJeemCloudSync) window.SeenJeemCloudSync.scheduleAutoSync();

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
    stopFinalRoundTimer();
    stopIntermission(true);
    closeRefereePopover();
    closeAllHostToolPopovers();
    closeResultCardModal();
    hideCharadesSecret();
    stopVictoryConfetti();
    closeLightbox();
    state.currentQ = null;
    state.preQuestionSnapshot = null;
    state.doubleArmed = false;
    state.matchEvents = [];
    state.refereeAdjustments = [];
    state.finalRound = null;
    state.dualScreen.closingPreviewQuestion = null;
    matchStore.clearSavedMatch();
    matchStore.clearUndoStack();
    resetVisualModalState();
    closeModal(dom.winnerModal);
    closeModal(dom.questionModal);
    closeModal(dom.finalRoundModal);

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

  function getCurrentAudioSettingsPayload() {
    if (!window.SeenJeemAudio) return null;
    return {
      volume:
        typeof window.SeenJeemAudio.getVolume === "function"
          ? window.SeenJeemAudio.getVolume()
          : 0.75,
      muted: Boolean(window.SeenJeemAudio.isMuted()),
      categoryPrefs:
        typeof window.SeenJeemAudio.getCategoryPrefs === "function"
          ? window.SeenJeemAudio.getCategoryPrefs()
          : null
    };
  }

  function broadcastAudioSettingsToDisplay() {
    if (!liveSync || !state.dualScreen.connected) return;
    const payload = getCurrentAudioSettingsPayload();
    if (payload && typeof liveSync.broadcastAudioSettings === "function") {
      liveSync.broadcastAudioSettings(payload);
    }
  }

  function toggleSoundMuted() {
    if (!window.SeenJeemAudio) return;
    const nextMuted = !window.SeenJeemAudio.isMuted();
    window.SeenJeemAudio.setMuted(nextMuted);
    syncSoundButtonsUI();
    broadcastAudioSettingsToDisplay();
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

    if (dom.resultCardModal && dom.resultCardModal.classList.contains("open")) {
      if (e.key === "Escape") {
        closeResultCardModal();
      }
      return;
    }

    // اختصارات لوحة المؤثرات الصوتية للمقدّم (Alt+1..5 — معطّلة تلقائياً داخل الحقول النصية)
    if (e.altKey && !e.ctrlKey && !e.metaKey && !isEditableElementFocused()) {
      const sfxByDigit = {
        Digit1: "drumroll",
        Digit2: "applause",
        Digit3: "sad_trombone",
        Digit4: "attention_chime",
        Digit5: "fanfare"
      };
      const sfxKey = sfxByDigit[e.code] || (e.key >= "1" && e.key <= "5" ? Object.values(sfxByDigit)[Number(e.key) - 1] : null);
      if (sfxKey && dom.gameScreen && dom.gameScreen.classList.contains("active")) {
        e.preventDefault();
        triggerSoundboardEffect(sfxKey);
        return;
      }
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

    if (dom.hallOfFameModal && dom.hallOfFameModal.classList.contains("open")) {
      if (e.key === "Escape") {
        closeHallOfFameModal();
      }
      return;
    }

    if (dom.wirelessRoomModal && dom.wirelessRoomModal.classList.contains("open")) {
      if (e.key === "Escape") {
        closeWirelessRoomModal();
      }
      return;
    }

    if (dom.blitzModal && dom.blitzModal.classList.contains("open")) {
      if (e.key === "Escape") {
        closeBlitzModal();
        return;
      }
      if (state.blitz && state.blitz.phase === "playing" && !isEditableElementFocused()) {
        if (e.key === "Enter" || e.key === "ArrowRight") {
          e.preventDefault();
          handleBlitzJudge("correct");
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          handleBlitzJudge("skip");
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          handleBlitzJudge("wrong");
        } else if (e.code === "Space" || e.key === " ") {
          e.preventDefault();
          toggleBlitzPause();
        }
      }
      return;
    }

    if (dom.charadesSoloModal && dom.charadesSoloModal.classList.contains("open")) {
      if (e.key === "Escape") {
        closeCharadesSoloModal();
      }
      return;
    }

    if (dom.winnerModal.classList.contains("open")) {
      return;
    }

    // اختصارات جولة الرهان النهائي (Space للمؤقت + Ctrl+Z للتراجع بعد الكشف)
    if (dom.finalRoundModal && dom.finalRoundModal.classList.contains("open") && state.finalRound) {
      const isUndoInFinal =
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.code === "KeyZ" || e.key.toLowerCase() === "z" || e.key === "ئ");
      if (isUndoInFinal && !isEditableElementFocused() && state.finalRound.phase === "reveal" && matchStore.canUndo()) {
        e.preventDefault();
        closeModal(dom.finalRoundModal);
        performUndo();
        return;
      }
      if ((e.code === "Space" || e.key === " ") && !isEditableElementFocused() && state.finalRound.phase === "question") {
        e.preventDefault();
        toggleFinalRoundTimer();
      }
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
      if (state.flagDrawerOpen) {
        closeFlagDrawer();
        return;
      }
      if (!state.currentQ.revealed) {
        cancelCurrentQuestion();
      } else {
        closeQuestionModalAfterRevealWithoutScoring();
      }
      return;
    }

    if (!state.currentQ.revealed) {
      if (state.currentQ.isDailyDouble && state.currentQ.dailyDoublePhase === "wager") {
        if (key === "Enter") {
          e.preventDefault();
          lockDailyDoubleWager();
        }
        return;
      }
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
      if (key === "1" && state.teams.length >= 1) {
        e.preventDefault();
        awardQuestion(0);
      } else if (key === "2" && state.teams.length >= 2) {
        e.preventDefault();
        awardQuestion(1);
      } else if (key === "3" && state.teams.length >= 3) {
        e.preventDefault();
        awardQuestion(2);
      } else if (key === "4" && state.teams.length >= 4) {
        e.preventDefault();
        awardQuestion(3);
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
    stopFinalRoundTimer();
    stopIntermissionTimerOnly();
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
      visualType: cq.visualType || q.visualType || "normal",
      questionText: q.question || "",
      answerText: q.answer || "",
      reason: state.selectedFlagReason || "wrong-answer",
      note: note || undefined,
      sheetSyncStatus: "pending"
    });

    if (saved) {
      renderQuestionFlagUI();
      closeFlagDrawer();
      const reasonMeta = flaggedStore.getReasonMeta(saved.reason);
      const reportSync = window.SeenJeemSheetReportSync;
      if (reportSync && reportSync.isConfigured() && navigator.onLine) {
        showToast(`🚩 تم تسجيل البلاغ (${reasonMeta.label}) — جاري إرساله تلقائياً للشيت...`, "info");
        reportSync.sendFlagRecord(saved).then((res) => {
          if (dom.bankManagerModal && dom.bankManagerModal.classList.contains("open")) {
            renderBankFlaggedSection();
          }
          if (res.ok) {
            showToast("✅ تم إرسال بلاغ السؤال إلى Google Sheets تلقائياً!", "success");
          } else {
            showToast(`⏳ تم حفظ البلاغ محلياً كمعلّق (${res.error || "سيُرسل لاحقاً"})`, "warning");
          }
        });
      } else {
        showToast(`🚩 تم تحديد السؤال للمراجعة (${reasonMeta.label})`, "success");
        if (window.SeenJeemCloudSync) window.SeenJeemCloudSync.scheduleAutoSync();
      }
    }
  }

  function removeCurrentQuestionFlag() {
    if (!state.currentQ || !flaggedStore) return;
    const removed = flaggedStore.unflagQuestion(state.currentQ.question.id);
    if (removed) {
      renderQuestionFlagUI();
      closeFlagDrawer();
      if (window.SeenJeemCloudSync) window.SeenJeemCloudSync.scheduleAutoSync();
      showToast("تمت إزالة السؤال من قائمة المراجعة", "info");
    }
  }

  function setCloudSyncFeedback(type, text) {
    if (!dom.cloudSyncFeedback) return;
    dom.cloudSyncFeedback.hidden = !text;
    dom.cloudSyncFeedback.className = `bank-feedback-box ${type ? `is-${type}` : ""}`;
    dom.cloudSyncFeedback.textContent = text || "";
  }

  function setSheetReportFeedback(type, text) {
    if (!dom.sheetReportFeedback) return;
    dom.sheetReportFeedback.hidden = !text;
    dom.sheetReportFeedback.className = `bank-feedback-box ${type ? `is-${type}` : ""}`;
    dom.sheetReportFeedback.textContent = text || "";
  }

  function renderCloudSyncUI(cloudState = null) {
    const cs = window.SeenJeemCloudSync;
    const st = cloudState || (cs ? cs.getState() : { signedIn: false, status: "signed-out", user: null });

    const statusMeta = {
      "signed-out": { pill: "☁️ المزامنة السحابية", badge: "⚪ وضع محلي فقط", cls: "" },
      synced: { pill: "🟢 متزامن", badge: "🟢 متزامن", cls: "is-synced" },
      syncing: { pill: "🔄 جاري المزامنة", badge: "🔄 جاري المزامنة...", cls: "" },
      "pending-offline": { pill: "🟡 بانتظار الاتصال", badge: "🟡 تغييرات محلية بانتظار الاتصال", cls: "is-pending" },
      error: { pill: "⚠️ تنبيه المزامنة", badge: "⚠️ تعذّرت آخر مزامنة", cls: "is-pending" }
    };
    const meta = statusMeta[st.status] || statusMeta["signed-out"];

    if (dom.btnCloudSyncPill) {
      dom.btnCloudSyncPill.classList.remove("is-synced", "is-pending");
      if (meta.cls) dom.btnCloudSyncPill.classList.add(meta.cls);
    }
    if (dom.cloudPillIcon) dom.cloudPillIcon.textContent = st.signedIn ? (st.status === "synced" ? "🟢" : st.status === "syncing" ? "🔄" : "🟡") : "☁️";
    if (dom.cloudPillLabel) dom.cloudPillLabel.textContent = st.signedIn ? (st.user && st.user.displayName ? st.user.displayName.split(" ")[0] : "متزامن") : "المزامنة";

    if (dom.cloudSyncStatusBadge) dom.cloudSyncStatusBadge.textContent = meta.badge;
    if (dom.cloudSignedOutBox) dom.cloudSignedOutBox.hidden = Boolean(st.signedIn);
    if (dom.cloudSignedInBox) dom.cloudSignedInBox.hidden = !st.signedIn;

    if (st.signedIn && st.user) {
      if (dom.cloudUserName) dom.cloudUserName.textContent = st.user.displayName || "المقدّم";
      if (dom.cloudUserEmail) dom.cloudUserEmail.textContent = st.user.email || "";
      if (dom.cloudUserAvatar) {
        if (st.user.photoURL) {
          dom.cloudUserAvatar.src = st.user.photoURL;
          dom.cloudUserAvatar.hidden = false;
        } else {
          dom.cloudUserAvatar.hidden = true;
        }
      }
      if (dom.cloudLastSyncText) {
        dom.cloudLastSyncText.textContent = st.lastSyncedAt
          ? `آخر مزامنة: ${formatTimestampArabic(st.lastSyncedAt)}`
          : "آخر مزامنة: الآن";
      }
    }

    if (st.error) {
      setCloudSyncFeedback("warning", st.error);
    }
  }

  function renderBankFlaggedSection() {
    if (!flaggedStore || !dom.bankFlaggedList) return;
    renderCloudSyncUI();
    const reportSync = window.SeenJeemSheetReportSync;
    if (reportSync) {
      const cfg = reportSync.getConfig();
      if (dom.sheetReportWebhookInput && document.activeElement !== dom.sheetReportWebhookInput) {
        dom.sheetReportWebhookInput.value = cfg.webhookUrl || "";
      }
      if (dom.sheetReportSecretInput && document.activeElement !== dom.sheetReportSecretInput) {
        dom.sheetReportSecretInput.value = cfg.secret || "";
      }
    }

    const items = flaggedStore.getAll();
    const count = items.length;
    const pendingCount =
      typeof flaggedStore.getPendingCount === "function"
        ? flaggedStore.getPendingCount()
        : items.filter((i) => i.sheetSyncStatus !== "sent").length;

    if (dom.bankFlaggedCount) {
      dom.bankFlaggedCount.textContent = String(count);
    }
    if (dom.btnSendPendingFlags) {
      dom.btnSendPendingFlags.disabled = pendingCount === 0 || !(reportSync && reportSync.isConfigured());
      dom.btnSendPendingFlags.textContent =
        pendingCount > 0
          ? `📤 إرسال جميع البلاغات المعلّقة للشيت (${pendingCount})`
          : "📤 لا توجد بلاغات معلّقة";
    }
    if (dom.btnCopyFlaggedReport) dom.btnCopyFlaggedReport.disabled = count === 0;
    if (dom.btnExportFlaggedJson) dom.btnExportFlaggedJson.disabled = count === 0;
    if (dom.btnExportFlaggedCsv) dom.btnExportFlaggedCsv.disabled = count === 0;
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
      const syncStatus = item.sheetSyncStatus || (item.reportedToSheet ? "sent" : "pending");
      const syncPillHtml =
        syncStatus === "sent"
          ? `<span class="flagged-sync-pill is-sent">✅ تم الإرسال للشيت</span>`
          : syncStatus === "failed"
            ? `<span class="flagged-sync-pill is-failed">⚠️ تعذّر الإرسال</span>`
            : `<span class="flagged-sync-pill is-pending">⏳ معلّق</span>`;

      const row = document.createElement("div");
      row.className = "bank-flagged-item";
      row.innerHTML = `
        <div class="flagged-item-main">
          <div class="flagged-item-meta">
            <span class="flagged-reason-badge">${reasonMeta.icon} ${escapeHtml(reasonMeta.label)}</span>
            ${syncPillHtml}
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
        if (window.SeenJeemCloudSync) window.SeenJeemCloudSync.scheduleAutoSync();
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

  function copyFlaggedReport() {
    if (!flaggedStore || flaggedStore.getCount() === 0) return;
    const report = flaggedStore.exportReportText();
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(report)
        .then(() => showToast("📋 تم نسخ تقرير الأسئلة للمراجعة بنجاح", "success"))
        .catch(() => showToast("تعذّر النسخ للحافظة — استخدم زر تصدير JSON", "warning"));
    } else {
      showToast("تعذّر النسخ للحافظة — استخدم زر تصدير JSON", "warning");
    }
  }

  function exportFlaggedAsJSON() {
    if (!flaggedStore || flaggedStore.getCount() === 0) return;
    const filename = flaggedStore.downloadJSON();
    showToast(`⬇️ تم تنزيل ملف المراجعة (${filename})`, "success");
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
          showToast(`❌ ${check.error}`, "error");
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
        showToast("❌ ملف النسخة الاحتياطية تالف أو غير صالح — لم تُعدَّل بياناتك الحالية", "error");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function executeBackupRestore(mode) {
    if (!backupManager || !state.pendingBackupData) return;
    const res = backupManager.restoreBackupObject(state.pendingBackupData, mode);
    if (!res.ok) {
      showBackupFeedback("error", `❌ ${res.error || "تعذّرت الاستعادة"}`);
      showToast(`❌ ${res.error || "تعذّرت الاستعادة"}`, "error");
      return;
    }

    // تحديث جميع أجزاء التطبيق فوراً بالبيانات المستعادة
    state.customCategories = loadCustomCategoriesFromStorage();
    state.setupSettings = matchStore.loadSavedSettings();
    applyTheme(matchStore.loadTheme(), false);
    applyTvScale(matchStore.loadTvScale(), false);
    broadcastDisplayPrefsToTV();
    rebuildMergedCategories();
    syncSoundButtonsUI();
    broadcastAudioSettingsToDisplay();
    syncWakeLockSetupUI();
    renderSetupScreen();
    renderBankManagerModal();
    renderBankFlaggedSection();
    if (dom.hallOfFameModal && dom.hallOfFameModal.classList.contains("open")) {
      renderHallOfFameModal();
    }
    clearPendingBackupImport();

    const modeLabel = res.mode === "replace" ? "الاستبدال الكامل" : "الدمج الذكي";
    showBackupFeedback("success", `✅ تمت استعادة النسخة الاحتياطية بنجاح (${modeLabel}) وتحديث الواجهة فوراً.`);
    showToast(`🛡️ تمت استعادة النسخة الاحتياطية (${modeLabel}) بنجاح!`, "success");
  }

  function confirmRestoreBackup() {
    if (!backupManager || !state.pendingBackupData) return;
    if (state.backupRestoreMode === "replace") {
      openConfirmDialog({
        title: "تأكيد الاستبدال الكامل للبيانات المحلية؟",
        message:
          "سيتم استبدال جميع ملفات المجموعات وسجل الأسئلة الملعوبة وقائمة المراجعة والتفضيلات بمحتوى النسخة الاحتياطية المختارة. هل أنت متأكد؟",
        confirmText: "نعم، استبدل البيانات",
        onConfirm: () => executeBackupRestore("replace")
      });
      return;
    }
    executeBackupRestore("merge");
  }

  // --- Audio Mixer Popover (التحكم المتقدم بالصوت) ---
  function syncAudioMixerUI() {
    if (!window.SeenJeemAudio) return;
    const audio = window.SeenJeemAudio;
    const volPct = Math.round((typeof audio.getVolume === "function" ? audio.getVolume() : 0.75) * 100);
    const prefs =
      typeof audio.getCategoryPrefs === "function"
        ? audio.getCategoryPrefs()
        : { timerTicks: true, uiEffects: true, celebrations: true };
    const isMuted = audio.isMuted();
    const displayPct = isMuted ? "0%" : `${volPct}%`;

    [dom.audioVolumeSlider, dom.setupVolumeSlider, dom.gameVolumeSlider].forEach((sl) => {
      if (sl) sl.value = String(isMuted ? 0 : volPct);
    });
    if (dom.audioVolumeValue) dom.audioVolumeValue.textContent = isMuted ? "مكتوم" : `${volPct}%`;
    if (dom.setupVolumePct) dom.setupVolumePct.textContent = displayPct;
    if (dom.gameVolumePct) dom.gameVolumePct.textContent = displayPct;

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
     الحزمة الخامسة: جولة الرهان النهائي وكسر التعادل (Final Wager Round)
     ========================================================= */
  function stopFinalRoundTimer() {
    if (state.finalTimerInterval) {
      clearInterval(state.finalTimerInterval);
      state.finalTimerInterval = null;
    }
    if (state.finalRound) {
      state.finalRound.timerRunning = false;
      state.finalRound.timerEndAtMs = null;
      state.finalRound.timerStatus = state.finalRound.timerRemaining === 0 ? "finished" : "paused";
    }
  }

  function startFinalRound(triggerReason = "tie-breaker", roundNumber = 1, previousUsedIds = []) {
    if (!finalRoundEngine || !dom.finalRoundModal) return;
    closeRefereePopover();
    stopVictoryConfetti();
    closeModal(dom.winnerModal);
    closeModal(dom.questionModal);
    stopFinalRoundTimer();

    const picked = finalRoundEngine.pickFinalQuestion({
      allCategories: state.allCategories,
      boardCategories: state.boardCategories,
      historyStore,
      flaggedStore,
      excludeQuestionIds: previousUsedIds
    });

    if (!picked) {
      showToast("لا تتوفر أسئلة نصية بديلة في البنك لجولة الحسم حالياً", "warning");
      openWinnerModal(false);
      return;
    }

    state.finalRound = finalRoundEngine.createFinalRoundState({
      triggerReason,
      teams: state.teams,
      picked,
      roundNumber,
      usedQuestionIds: previousUsedIds
    });

    renderFinalRoundModal();
    openModal(dom.finalRoundModal);
    persistActiveMatch();

    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playStealAlert();
    }
    showToast(
      triggerReason === "always"
        ? "⚔️ بدأت جولة الرهان النهائي الختامية!"
        : `⚔️ بدأت جولة كسر التعادل #${roundNumber}!`,
      "info"
    );
  }

  function rerollFinalQuestion() {
    if (!state.finalRound || state.finalRound.phase !== "wager" || !finalRoundEngine) return;
    const picked = finalRoundEngine.pickFinalQuestion({
      allCategories: state.allCategories,
      boardCategories: state.boardCategories,
      historyStore,
      flaggedStore,
      excludeQuestionIds: state.finalRound.usedQuestionIds || []
    });

    if (!picked) {
      showToast("لا توجد أسئلة حسم بديلة إضافية متاحة حالياً", "warning");
      return;
    }

    state.finalRound.category = picked.category;
    state.finalRound.question = picked.question;
    state.finalRound.usedQuestionIds = Array.from(
      new Set([...(state.finalRound.usedQuestionIds || []), picked.question.id])
    );

    renderFinalRoundModal();
    persistActiveMatch();
    if (window.SeenJeemAudio) window.SeenJeemAudio.playLifeline();
    showToast(`🔄 تم تغيير سؤال الحسم إلى فئة «${picked.category.name}»`, "info");
  }

  function renderFinalRoundTimerUI() {
    if (!state.finalRound || !dom.finalTimerDisplay) return;
    const fr = state.finalRound;
    const pct = fr.timerMax > 0 ? Math.min(100, (fr.timerRemaining / fr.timerMax) * 100) : 0;
    const isDanger = fr.timerRemaining <= 10;

    dom.finalTimerDisplay.textContent = formatTime(fr.timerRemaining);
    dom.finalTimerDisplay.classList.toggle("danger", isDanger);
    if (dom.finalTimerProgress) {
      dom.finalTimerProgress.style.width = `${pct}%`;
      dom.finalTimerProgress.classList.toggle("danger", isDanger);
    }
    if (dom.finalTimerLabel) {
      dom.finalTimerLabel.textContent =
        fr.timerRemaining === 0
          ? "⏰ انتهى وقت سؤال الحسم!"
          : fr.timerRunning
            ? "مؤقت سؤال الحسم جارٍ"
            : "المؤقت متوقف مؤقتاً";
    }
    if (dom.finalTimerToggleIcon && dom.finalTimerToggleText && dom.btnFinalTimerToggle) {
      dom.finalTimerToggleIcon.textContent = fr.timerRunning ? "⏸️" : "▶️";
      dom.finalTimerToggleText.textContent = fr.timerRunning ? "إيقاف مؤقت" : "ابدأ";
      dom.btnFinalTimerToggle.disabled = fr.timerRemaining === 0;
    }
  }

  function onFinalRoundTimerTick() {
    if (!state.finalRound || !state.finalRound.timerRunning) return;
    state.finalRound.timerRemaining = Math.max(0, state.finalRound.timerRemaining - 1);

    if (state.finalRound.timerRemaining > 0 && state.finalRound.timerRemaining <= 10) {
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playTick(state.finalRound.timerRemaining <= 5);
      }
    }
    let justFinished = false;
    if (state.finalRound.timerRemaining === 0) {
      stopFinalRoundTimer();
      state.finalRound.timerStatus = "finished";
      justFinished = true;
      if (window.SeenJeemAudio) {
        window.SeenJeemAudio.playTimeUp();
      }
    }

    renderFinalRoundTimerUI();
    if (justFinished) {
      if (state.dualScreen.connected || state.wireless.active) {
        broadcastLiveDisplayState();
      }
    } else if (state.dualScreen.connected) {
      broadcastLiveDisplayState({ skipWireless: true });
    }
  }

  function toggleFinalRoundTimer() {
    if (!state.finalRound || state.finalRound.phase !== "question") return;
    if (state.finalRound.timerRunning) {
      stopFinalRoundTimer();
      state.finalRound.timerStatus = "paused";
    } else if (state.finalRound.timerRemaining > 0) {
      stopFinalRoundTimer();
      state.finalRound.timerRunning = true;
      state.finalRound.timerStatus = "running";
      state.finalRound.timerEndAtMs = getWirelessServerNowMs() + state.finalRound.timerRemaining * 1000;
      state.finalTimerInterval = setInterval(onFinalRoundTimerTick, 1000);
    }
    renderFinalRoundTimerUI();
    if (state.dualScreen.connected || state.wireless.active) {
      broadcastLiveDisplayState();
    }
    persistActiveMatch();
  }

  function resetFinalRoundTimer() {
    if (!state.finalRound || state.finalRound.phase !== "question") return;
    stopFinalRoundTimer();
    state.finalRound.timerRemaining = state.finalRound.timerMax || 60;
    state.finalRound.timerStatus = "idle";
    state.finalRound.timerEndAtMs = null;
    renderFinalRoundTimerUI();
    if (state.dualScreen.connected || state.wireless.active) {
      broadcastLiveDisplayState();
    }
    persistActiveMatch();
  }

  function renderFinalRoundModal() {
    if (!state.finalRound || !finalRoundEngine) return;
    const fr = state.finalRound;
    const isTieBreaker = fr.triggerReason === "tie-breaker" || fr.triggerReason === "manual";

    if (dom.finalRoundEyebrow) {
      dom.finalRoundEyebrow.textContent = isTieBreaker
        ? `⚔️ كسر التعادل — الجولة ${fr.roundNumber}`
        : "⚔️ جولة الحسم الختامية";
    }
    if (dom.finalRoundTitle) {
      dom.finalRoundTitle.textContent = isTieBreaker ? "جولة كسر التعادل" : "جولة الرهان النهائي";
    }

    if (dom.finalTvStatusPill) {
      dom.finalTvStatusPill.hidden = !state.dualScreen.connected;
      if (state.dualScreen.connected) {
        dom.finalTvStatusPill.classList.remove("state-hidden", "state-hint", "state-revealed");
        if (fr.phase === "wager") {
          dom.finalTvStatusPill.textContent = "📺 التلفزيون: الفئة فقط (الرهان والسؤال مخفيان)";
          dom.finalTvStatusPill.classList.add("state-hidden");
        } else if (fr.phase === "question") {
          dom.finalTvStatusPill.textContent = "📺 التلفزيون: السؤال والمؤقت (الإجابة والرهانات مخفية)";
          dom.finalTvStatusPill.classList.add("state-hint");
        } else {
          dom.finalTvStatusPill.textContent = "✅ التلفزيون: الإجابة والرهانات مكشوفة";
          dom.finalTvStatusPill.classList.add("state-revealed");
        }
      }
    }

    if (dom.finalStepWager) dom.finalStepWager.classList.toggle("active", fr.phase === "wager");
    if (dom.finalStepQuestion) dom.finalStepQuestion.classList.toggle("active", fr.phase === "question");
    if (dom.finalStepReveal) dom.finalStepReveal.classList.toggle("active", fr.phase === "reveal");

    if (dom.finalCatIcon) dom.finalCatIcon.textContent = (fr.category && fr.category.icon) || "🏆";
    if (dom.finalCatName) dom.finalCatName.textContent = (fr.category && fr.category.name) || "";
    if (dom.finalQTierPill) {
      const pts = Number(fr.question && fr.question.points) || 600;
      dom.finalQTierPill.textContent = `${pts} نقطة`;
      dom.finalQTierPill.className = `q-points-pill pts-${pts}`;
    }
    if (dom.btnFinalReroll) {
      dom.btnFinalReroll.hidden = fr.phase !== "wager";
    }

    if (dom.finalPhaseWager) dom.finalPhaseWager.hidden = fr.phase !== "wager";
    if (dom.finalPhaseQuestion) dom.finalPhaseQuestion.hidden = fr.phase !== "question";
    if (dom.finalPhaseReveal) dom.finalPhaseReveal.hidden = fr.phase !== "reveal";

    if (dom.btnFinalShowQuestion) dom.btnFinalShowQuestion.hidden = fr.phase !== "wager";
    if (dom.btnFinalRevealResults) dom.btnFinalRevealResults.hidden = fr.phase !== "question";
    if (dom.finalRevealFooterActions) dom.finalRevealFooterActions.hidden = fr.phase !== "reveal";

    // المرحلة 1: بطاقات إدخال وتثبيت الرهانات السرية
    if (fr.phase === "wager" && dom.finalWagersGrid) {
      dom.finalWagersGrid.innerHTML = "";
      fr.participantIndices.forEach((teamIdx) => {
        const team = state.teams[teamIdx];
        const w = fr.wagers[teamIdx] || { amount: 0, locked: false, maxWager: 400 };
        if (!team) return;

        const card = document.createElement("div");
        card.className = `final-wager-card team-${teamIdx + 1}-card${w.locked ? " is-locked" : ""}`;
        card.innerHTML = `
          <div class="final-wager-head">
            <div class="final-wager-id">
              <span class="team-badge-dot team-${teamIdx + 1}-dot"></span>
              <strong>${escapeHtml(team.name)}</strong>
            </div>
            <span class="final-wager-cap">الرصيد: ${team.score} • الأقصى: ${w.maxWager}</span>
          </div>
          <div class="final-wager-input-row">
            <input
              type="number"
              class="final-wager-input"
              min="0"
              max="${w.maxWager}"
              step="10"
              value="${w.amount}"
              ${w.locked ? "disabled" : ""}
              aria-label="رهان ${escapeHtml(team.name)}"
            />
            <button type="button" class="btn ${w.locked ? "btn-ghost" : "btn-primary"} btn-xs btn-lock-wager">
              ${w.locked ? "🔓 تعديل" : "✅ تثبيت الرهان"}
            </button>
          </div>
          <div class="final-wager-presets">
            <button type="button" class="wager-preset-chip" data-pct="0" ${w.locked ? "disabled" : ""}>0</button>
            <button type="button" class="wager-preset-chip" data-pct="0.25" ${w.locked ? "disabled" : ""}>25%</button>
            <button type="button" class="wager-preset-chip" data-pct="0.5" ${w.locked ? "disabled" : ""}>50%</button>
            <button type="button" class="wager-preset-chip is-allin" data-pct="1" ${w.locked ? "disabled" : ""}>الكل (All-In)</button>
          </div>
        `;

        const inputEl = card.querySelector(".final-wager-input");
        inputEl.addEventListener("input", () => {
          const val = Math.max(0, Math.min(w.maxWager, Math.round(Number(inputEl.value) || 0)));
          fr.wagers[teamIdx].amount = val;
        });

        card.querySelectorAll(".wager-preset-chip").forEach((chip) => {
          chip.addEventListener("click", () => {
            const pct = Number(chip.dataset.pct);
            const nextAmt = Math.round(w.maxWager * pct);
            fr.wagers[teamIdx].amount = nextAmt;
            inputEl.value = String(nextAmt);
          });
        });

        const lockBtn = card.querySelector(".btn-lock-wager");
        lockBtn.addEventListener("click", () => {
          if (!fr.wagers[teamIdx].locked) {
            const clamped = Math.max(
              0,
              Math.min(w.maxWager, Math.round(Number(inputEl.value) || 0))
            );
            fr.wagers[teamIdx].amount = clamped;
            fr.wagers[teamIdx].locked = true;
            if (window.SeenJeemAudio) window.SeenJeemAudio.playTileOpen();
          } else {
            fr.wagers[teamIdx].locked = false;
          }
          renderFinalRoundModal();
          persistActiveMatch();
        });

        dom.finalWagersGrid.appendChild(card);
      });

      if (dom.btnFinalShowQuestion) {
        dom.btnFinalShowQuestion.disabled = !finalRoundEngine.areAllWagersLocked(fr);
      }
    }

    // المرحلة 2: عرض السؤال والمؤقت والتحكيم
    if (fr.phase === "question") {
      if (dom.finalQuestionText) dom.finalQuestionText.textContent = fr.question.question || "";
      if (dom.finalHostAnswerText) dom.finalHostAnswerText.textContent = fr.question.answer || "";
      const exp = typeof fr.question.explanation === "string" ? fr.question.explanation.trim() : "";
      if (dom.finalHostExpRow && dom.finalHostExpText) {
        dom.finalHostExpRow.hidden = !exp;
        dom.finalHostExpText.textContent = exp;
      }
      renderFinalRoundTimerUI();

      if (dom.finalJudgmentsGrid) {
        dom.finalJudgmentsGrid.innerHTML = "";
        fr.participantIndices.forEach((teamIdx) => {
          const team = state.teams[teamIdx];
          const w = fr.wagers[teamIdx] || { amount: 0 };
          const curJ = fr.judgments[teamIdx] || null;
          if (!team) return;

          const row = document.createElement("div");
          row.className = `final-judge-card team-${teamIdx + 1}-card`;
          row.innerHTML = `
            <div class="final-judge-info">
              <span class="team-badge-dot team-${teamIdx + 1}-dot"></span>
              <strong>${escapeHtml(team.name)}</strong>
              <span class="final-judge-wager-tag">الرهان السري: ${w.amount}</span>
            </div>
            <div class="final-judge-btns">
              <button type="button" class="btn btn-xs final-judge-btn is-correct${curJ === "correct" ? " active" : ""}" data-judge="correct">
                ✅ صحيحة (+${w.amount})
              </button>
              <button type="button" class="btn btn-xs final-judge-btn is-wrong${curJ === "wrong" ? " active" : ""}" data-judge="wrong">
                ❌ خاطئة (-${w.amount})
              </button>
            </div>
          `;
          row.querySelectorAll(".final-judge-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
              fr.judgments[teamIdx] = btn.dataset.judge === "correct" ? "correct" : "wrong";
              renderFinalRoundModal();
              persistActiveMatch();
            });
          });
          dom.finalJudgmentsGrid.appendChild(row);
        });
      }

      if (dom.btnFinalRevealResults) {
        dom.btnFinalRevealResults.disabled = !finalRoundEngine.areAllJudgmentsSet(fr);
      }
    }

    // المرحلة 3: كشف الإجابة والرهانات والنتائج
    if (fr.phase === "reveal") {
      if (dom.finalRevealAnswerText) dom.finalRevealAnswerText.textContent = fr.question.answer || "";
      const exp = typeof fr.question.explanation === "string" ? fr.question.explanation.trim() : "";
      if (dom.finalRevealExpText) {
        dom.finalRevealExpText.hidden = !exp;
        dom.finalRevealExpText.textContent = exp ? `📌 التوضيح: ${exp}` : "";
      }

      if (dom.finalResultsGrid && fr.results) {
        dom.finalResultsGrid.innerHTML = fr.participantIndices
          .map((teamIdx) => {
            const r = fr.results[teamIdx];
            if (!r) return "";
            const deltaText =
              r.effectiveDelta > 0
                ? `+${r.effectiveDelta}`
                : r.effectiveDelta < 0
                  ? `${r.effectiveDelta}`
                  : "0";
            return `
              <div class="final-result-card team-${teamIdx + 1}-card ${r.correct ? "is-correct" : "is-wrong"}">
                <div class="final-result-head">
                  <span class="team-badge-dot team-${teamIdx + 1}-dot"></span>
                  <strong>${escapeHtml(r.teamName)}</strong>
                  <span class="final-verdict-pill ${r.correct ? "ok" : "bad"}">
                    ${r.correct ? "✅ إجابة صحيحة" : "❌ إجابة خاطئة"}
                  </span>
                </div>
                <div class="final-result-body">
                  <span>الرهان: <strong>${r.wager}</strong></span>
                  <span class="final-result-delta ${r.correct ? "pos" : "neg"}">${deltaText}</span>
                  <span>الرصيد: ${r.prevScore} ← <strong>${r.nextScore}</strong></span>
                </div>
              </div>
            `;
          })
          .join("");
      }

      const stillTied = finalRoundEngine.isTopScoreTied(state.teams);
      if (dom.btnFinalExtraTiebreaker) {
        dom.btnFinalExtraTiebreaker.hidden = !stillTied;
      }
    }
  }

  function proceedToFinalQuestionPhase() {
    if (!state.finalRound || state.finalRound.phase !== "wager") return;
    if (!finalRoundEngine.areAllWagersLocked(state.finalRound)) return;

    state.finalRound.phase = "question";
    state.finalRound.timerRemaining = state.finalRound.timerMax || 60;
    stopFinalRoundTimer();
    state.finalRound.timerRunning = true;
    state.finalRound.timerStatus = "running";
    state.finalRound.timerEndAtMs = getWirelessServerNowMs() + state.finalRound.timerRemaining * 1000;
    state.finalTimerInterval = setInterval(onFinalRoundTimerTick, 1000);

    renderFinalRoundModal();
    persistActiveMatch();
    if (window.SeenJeemAudio) window.SeenJeemAudio.playReveal();
  }

  function resolveFinalRoundResults() {
    if (!state.finalRound || state.finalRound.phase !== "question" || !finalRoundEngine) return;
    if (!finalRoundEngine.areAllJudgmentsSet(state.finalRound)) return;

    stopFinalRoundTimer();
    const fr = state.finalRound;
    const preFinalSnapshot = JSON.parse(JSON.stringify(fr));
    const questionHistorySnapshot = historyStore.captureQuestionSnapshot(fr.question.id);

    // حفظ لقطة التراجع الكاملة (Undo Stack) قبل تطبيق تعديلات الرهان
    matchStore.pushUndoSnapshot(
      {
        actionType: "final-round-resolve",
        label: `حسم جولة الرهان النهائي (${fr.category.name})`,
        teams: cloneTeamsState(),
        activeTurn: state.activeTurn,
        doubleArmed: state.doubleArmed,
        answeredThisRound: state.answeredThisRound,
        matchEvents: cloneMatchEvents(),
        refereeAdjustments: cloneRefereeAdjustments(),
        finalRound: preFinalSnapshot,
        cellState: null,
        questionHistorySnapshot
      },
      state.matchSettings
    );

    const results = finalRoundEngine.computeFinalResolution(fr, state.teams);
    fr.results = results;
    fr.phase = "reveal";

    const summaryParts = [];
    fr.participantIndices.forEach((idx) => {
      const r = results[idx];
      if (!r || !state.teams[idx]) return;
      state.teams[idx].score = r.nextScore;
      const d = r.effectiveDelta > 0 ? `+${r.effectiveDelta}` : String(r.effectiveDelta);
      summaryParts.push(`${r.teamName} (${d})`);
    });

    // تسجيل السؤال في historyStore وإضافة حدث للجولة النهائية في matchEvents
    historyStore.markQuestionPlayed(fr.question.id, Date.now());
    const finalEv = matchStore.sanitizeMatchEvent({
      questionId: fr.question.id,
      categoryId: fr.category.id,
      categoryName: fr.category.name,
      questionText: fr.question.question,
      answerText: fr.question.answer,
      explanation: fr.question.explanation || undefined,
      basePoints: Number(fr.question.points) || 600,
      effectivePoints: 0,
      askingTeamId: state.teams[fr.participantIndices[0]]
        ? state.teams[fr.participantIndices[0]].id
        : "team-0",
      awardedTeamId: null,
      wasSteal: false,
      wasDouble: false,
      hintUsed: false,
      wasSwapped: false,
      isFinalRound: true,
      finalSummary: summaryParts.join(" • "),
      timestamp: Date.now()
    });
    if (finalEv) {
      state.matchEvents.push(finalEv);
    }

    renderScoreboard();
    updateUndoButtonUI();
    renderFinalRoundModal();
    persistActiveMatch();

    const anyCorrect = Object.values(results).some((r) => r.correct);
    if (window.SeenJeemAudio) {
      window.SeenJeemAudio.playScore(anyCorrect);
    }
    showToast("🏆 تم كشف الإجابة واحتساب نتائج الرهان النهائي!", "success");
  }

  function startExtraTieBreakerRound() {
    if (!state.finalRound) return;
    const nextRoundNum = (Number(state.finalRound.roundNumber) || 1) + 1;
    const usedIds = state.finalRound.usedQuestionIds ? state.finalRound.usedQuestionIds.slice() : [];
    startFinalRound("tie-breaker", nextRoundNum, usedIds);
  }

  function finishFinalRoundToWinner() {
    stopFinalRoundTimer();
    state.finalRound = null;
    closeModal(dom.finalRoundModal);
    openWinnerModal(false);
  }

  function cancelFinalRound() {
    stopFinalRoundTimer();
    state.finalRound = null;
    closeModal(dom.finalRoundModal);
    persistActiveMatch();
    if (countRemainingPlayableQuestions() === 0) {
      openWinnerModal(false);
    }
  }

  /* =========================================================
     الحزمة السادسة: بطاقة النتيجة، لوحة المؤثرات، الاستراحة، الثيمات ومقياس التلفزيون
     ========================================================= */
  function broadcastDisplayPrefsToTV() {
    if (!liveSync || !state.dualScreen.connected) return;
    if (typeof liveSync.broadcastDisplayPrefs === "function") {
      liveSync.broadcastDisplayPrefs({
        theme: state.theme,
        tvScale: state.tvScale
      });
    }
  }

  function applyTheme(themeName, shouldPersistAndSync = true) {
    const clean =
      shouldPersistAndSync && matchStore
        ? matchStore.saveTheme(themeName)
        : themeName === "royal-gold" || themeName === "high-contrast"
          ? themeName
          : "dark-glass";
    state.theme = clean;
    document.documentElement.dataset.theme = clean;

    document.querySelectorAll(".theme-choice-btn").forEach((btn) => {
      const active = btn.dataset.themeChoice === clean;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    if (shouldPersistAndSync) {
      broadcastDisplayPrefsToTV();
    }
  }

  function applyTvScale(scalePct, shouldPersistAndSync = true) {
    const clean =
      shouldPersistAndSync && matchStore
        ? matchStore.saveTvScale(scalePct)
        : Math.min(130, Math.max(90, Math.round((Number(scalePct) || 100) / 5) * 5));
    state.tvScale = clean;

    if (dom.setupTvScaleSlider) dom.setupTvScaleSlider.value = String(clean);
    if (dom.setupTvScaleVal) dom.setupTvScaleVal.textContent = `${clean}%`;
    if (dom.gameTvScaleSlider) dom.gameTvScaleSlider.value = String(clean);
    if (dom.gameTvScaleVal) dom.gameTvScaleVal.textContent = `${clean}%`;

    if (shouldPersistAndSync) {
      broadcastDisplayPrefsToTV();
    }
  }

  function closeAllHostToolPopovers(exceptEl = null) {
    const pairs = [
      [dom.soundboardPopover, dom.btnOpenSoundboard],
      [dom.intermissionPopover, dom.btnOpenIntermission],
      [dom.displayPrefsPopover, dom.btnOpenDisplayPrefs]
    ];
    pairs.forEach(([pop, btn]) => {
      if (pop && pop !== exceptEl) {
        pop.hidden = true;
      }
      if (btn && pop !== exceptEl) {
        btn.setAttribute("aria-expanded", "false");
      }
    });
  }

  function toggleHostToolPopover(popoverEl, triggerBtn) {
    if (!popoverEl) return;
    const willOpen = popoverEl.hidden;
    closeAllHostToolPopovers(willOpen ? popoverEl : null);
    popoverEl.hidden = !willOpen;
    if (triggerBtn) {
      triggerBtn.setAttribute("aria-expanded", String(willOpen));
    }
    if (willOpen && popoverEl === dom.intermissionPopover) {
      syncIntermissionHostUI();
    }
  }

  // --- لوحة المؤثرات الصوتية للمقدّم (Host Soundboard) ---
  const SOUNDBOARD_LABELS = {
    drumroll: "🥁 قرع طبول التشويق",
    applause: "👏 تصفيق واحتفال",
    sad_trombone: "🎺 خطأ كوميدي درامي",
    attention_chime: "🔔 تنبيه هدوء / انتباه",
    fanfare: "🎉 افتتاحية حماسية"
  };

  function triggerSoundboardEffect(sfxKey) {
    if (!window.SeenJeemAudio || !SOUNDBOARD_LABELS[sfxKey]) return;
    if (typeof window.SeenJeemAudio.playSoundboard === "function") {
      window.SeenJeemAudio.playSoundboard(sfxKey);
    }
    const btn = dom.soundboardPopover
      ? dom.soundboardPopover.querySelector(`[data-sfx="${sfxKey}"]`)
      : null;
    if (btn) {
      btn.classList.remove("is-firing");
      void btn.offsetWidth;
      btn.classList.add("is-firing");
    }
  }

  // --- شاشة الاستراحة التلفزيونية (Intermission Screen) ---
  function stopIntermissionTimerOnly() {
    if (state.intermissionInterval) {
      clearInterval(state.intermissionInterval);
      state.intermissionInterval = null;
    }
  }

  function syncIntermissionHostUI() {
    const active = Boolean(state.intermission && state.intermission.active);
    if (dom.hostIntermissionActiveBar) {
      dom.hostIntermissionActiveBar.hidden = !active;
    }
    if (dom.hostIntermissionCountdown) {
      dom.hostIntermissionCountdown.textContent =
        active && state.intermission.totalSeconds > 0
          ? `(${formatTime(state.intermission.remainingSeconds)})`
          : "";
    }
    if (dom.btnStartIntermission) dom.btnStartIntermission.hidden = active;
    if (dom.btnStopIntermissionPopover) dom.btnStopIntermissionPopover.hidden = !active;
    if (dom.btnOpenIntermission) {
      dom.btnOpenIntermission.classList.toggle("is-intermission-live", active);
    }
  }

  function startIntermission(rawMessage, durationMinutes = 0) {
    stopIntermissionTimerOnly();

    // إيقاف مؤقت أي عدّاد جارٍ (عام، من غير كلام، سرقة، أو الجولة النهائية) وأي مقطع صوتي دون إغلاق السؤال
    stopActiveAudioChallenge();
    if (state.timerRunning) {
      pauseTimer();
    }
    if (state.finalRound && state.finalRound.timerRunning) {
      stopFinalRoundTimer();
      renderFinalRoundTimerUI();
    }

    const msg =
      typeof rawMessage === "string" && rawMessage.trim()
        ? rawMessage.trim().slice(0, 120)
        : "استراحة قصيرة — نعود بعد قليل";
    const mins = Math.max(0, Math.floor(Number(durationMinutes) || 0));
    const totalSecs = mins * 60;

    state.intermission = {
      active: true,
      message: msg,
      durationMinutes: mins,
      totalSeconds: totalSecs,
      remainingSeconds: totalSecs,
      timerStatus: totalSecs > 0 ? "running" : "idle",
      timerEndAtMs: totalSecs > 0 ? getWirelessServerNowMs() + totalSecs * 1000 : null
    };

    if (totalSecs > 0) {
      state.intermissionInterval = setInterval(() => {
        if (!state.intermission || !state.intermission.active) {
          stopIntermissionTimerOnly();
          return;
        }
        state.intermission.remainingSeconds = Math.max(0, state.intermission.remainingSeconds - 1);
        syncIntermissionHostUI();
        if (state.intermission.remainingSeconds === 0) {
          stopIntermissionTimerOnly();
          state.intermission.timerStatus = "finished";
          state.intermission.timerEndAtMs = null;
          broadcastLiveDisplayState();
          if (window.SeenJeemAudio) window.SeenJeemAudio.playAttentionChime();
          showToast("☕ انتهى وقت الاستراحة — اضغط «استئناف اللعب» للعودة", "info");
        } else {
          broadcastLiveDisplayState({ skipWireless: true });
        }
      }, 1000);
    }

    closeAllHostToolPopovers();
    syncIntermissionHostUI();
    broadcastLiveDisplayState();

    showToast(
      mins > 0
        ? `☕ تم تفعيل شاشة الاستراحة (${mins} دقائق) وإيقاف المؤقت مؤقتاً`
        : "☕ تم تفعيل شاشة الاستراحة وإيقاف المؤقت مؤقتاً",
      "info"
    );
  }

  function stopIntermission(isSilent = false) {
    const wasActive = Boolean(state.intermission && state.intermission.active);
    stopIntermissionTimerOnly();
    state.intermission = matchStore
      ? matchStore.getDefaultIntermission()
      : { active: false, message: "استراحة قصيرة — نعود بعد قليل", durationMinutes: 0, totalSeconds: 0, remainingSeconds: 0 };

    closeAllHostToolPopovers();
    syncIntermissionHostUI();
    if (wasActive) {
      broadcastLiveDisplayState();
      if (!isSilent) {
        showToast("▶️ تم إنهاء الاستراحة والعودة للعرض (المؤقت يبقى متوقفاً حتى تستأنفه يدوياً)", "success");
      }
    }
  }

  // --- بطاقة نتيجة المباراة للمشاركة (Shareable Result Card) ---
  function clearResultCardObjectUrl() {
    if (state.currentResultCardUrl) {
      try {
        URL.revokeObjectURL(state.currentResultCardUrl);
      } catch (_e) {}
      state.currentResultCardUrl = "";
    }
    state.currentResultCardBlob = null;
  }

  async function openResultCardModal(customPayload = null) {
    if (!resultCardGen || !dom.resultCardModal) return;
    clearResultCardObjectUrl();
    state.customResultCardPayload = customPayload || null;

    if (dom.resultCardLoading) {
      dom.resultCardLoading.textContent = "⏳ جاري رسم بطاقة النتيجة عالية الدقة...";
      dom.resultCardLoading.hidden = false;
    }
    if (dom.resultCardPreviewImg) {
      dom.resultCardPreviewImg.hidden = true;
      dom.resultCardPreviewImg.removeAttribute("src");
    }
    if (dom.btnDownloadResultCard) dom.btnDownloadResultCard.disabled = true;
    if (dom.btnCopyResultCard) dom.btnCopyResultCard.disabled = true;
    if (dom.btnShareResultCard) {
      dom.btnShareResultCard.disabled = true;
      dom.btnShareResultCard.hidden = !resultCardGen.canNativeShareFiles();
    }

    openModal(dom.resultCardModal);

    try {
      let canvas = null;
      if (customPayload && customPayload.cardType === "bara-salfa" && typeof resultCardGen.generateBaraSalfaResultCard === "function") {
        state.currentResultCardPrefix = "bara-salfa-result";
        canvas = await resultCardGen.generateBaraSalfaResultCard(customPayload.sessionData, state.theme);
      } else if (customPayload && customPayload.cardType === "mafia" && typeof resultCardGen.generateMafiaResultCard === "function") {
        state.currentResultCardPrefix = "mafia-result";
        canvas = await resultCardGen.generateMafiaResultCard(customPayload.sessionData, state.theme);
      } else if (customPayload && customPayload.cardType === "audio-challenge" && typeof resultCardGen.generateAudioChallengeResultCard === "function") {
        state.currentResultCardPrefix = "audio-challenge-result";
        canvas = await resultCardGen.generateAudioChallengeResultCard(customPayload.sessionData, state.theme);
      } else if (customPayload && customPayload.cardType === "tournament" && typeof resultCardGen.generateTournamentResultCard === "function") {
        state.currentResultCardPrefix = "seen-jeem-tournament";
        canvas = await resultCardGen.generateTournamentResultCard(customPayload.tournamentData, state.theme);
      } else {
        state.currentResultCardPrefix = "seen-jeem-result";
        const payload = customPayload || {
          teams: state.teams,
          analytics: computeMatchAnalytics(),
          matchEvents: state.matchEvents,
          profileName: historyStore.getActiveProfile().name,
          theme: state.theme,
          timestamp: Date.now()
        };
        canvas = await resultCardGen.generateCanvas({
          teams: payload.teams,
          analytics: payload.analytics,
          matchEvents: payload.matchEvents || [],
          profileName: payload.profileName || historyStore.getActiveProfile().name,
          theme: payload.theme || state.theme,
          timestamp: payload.timestamp || Date.now()
        });
      }
      const blob = await resultCardGen.canvasToBlob(canvas);
      if (!blob) {
        if (dom.resultCardLoading) dom.resultCardLoading.textContent = "تعذّر توليد الصورة في هذا المتصفح";
        return;
      }

      state.currentResultCardBlob = blob;
      state.currentResultCardUrl = URL.createObjectURL(blob);

      if (dom.resultCardPreviewImg) {
        dom.resultCardPreviewImg.src = state.currentResultCardUrl;
        dom.resultCardPreviewImg.hidden = false;
      }
      if (dom.resultCardLoading) dom.resultCardLoading.hidden = true;
      if (dom.btnDownloadResultCard) dom.btnDownloadResultCard.disabled = false;
      if (dom.btnCopyResultCard) dom.btnCopyResultCard.disabled = false;
      if (dom.btnShareResultCard && !dom.btnShareResultCard.hidden) {
        dom.btnShareResultCard.disabled = false;
      }
    } catch (_err) {
      if (dom.resultCardLoading) dom.resultCardLoading.textContent = "تعذّر رسم بطاقة النتيجة";
      showToast("تعذّر توليد بطاقة النتيجة — حاول مرة أخرى", "warning");
    }
  }

  function closeResultCardModal() {
    closeModal(dom.resultCardModal);
    clearResultCardObjectUrl();
    state.customResultCardPayload = null;
  }

  /* =========================================================
     المرحلة الرابعة — الحزمة السابعة:
     1) طور «جولة البرق السريعة» (60-Second Blitz Mode)
     2) طور «من غير كلام» المستقل (Standalone Charades Mode)
     3) قاعة المشاهير وأرشيف المباريات (Hall of Fame & Archive)
     ========================================================= */

  function buildSideModeWinnerPayload(teamsList, eyebrowText) {
    const teams = Array.isArray(teamsList) ? teamsList : [];
    const maxScore = teams.reduce((m, t) => Math.max(m, Number(t.score) || 0), -Infinity);
    const leaderIndices = [];
    teams.forEach((t, idx) => {
      if ((Number(t.score) || 0) === maxScore) leaderIndices.push(idx);
    });
    const isDraw = teams.length > 1 && leaderIndices.length !== 1;
    const winnerIdx = !isDraw && leaderIndices.length === 1 ? leaderIndices[0] : null;
    const title =
      teams.length === 1
        ? `نتيجة ${teams[0].name}: ${teams[0].score} نقطة!`
        : !isDraw && winnerIdx !== null
          ? `الفائز: ${teams[winnerIdx].name}`
          : "تعادل مثير في الصدارة!";
    return {
      winnerIdx,
      leaderIndices,
      eyebrow: eyebrowText || "نهاية التحدي!",
      title,
      teams: teams.map((t, i) => ({ id: t.id || `team-${i}`, name: t.name, score: Number(t.score) || 0 })),
      analytics: null
    };
  }

  function renderSideTeamInputs(container, count, prefix, fallbackSolo) {
    if (!container) return;
    const existingValues = Array.from(container.querySelectorAll("input")).map((el) => el.value);
    const defaults =
      count === 1 && fallbackSolo
        ? ["اللاعب الأول"]
        : ["الفريق الأول", "الفريق الثاني", "الفريق الثالث", "الفريق الرابع"];
    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "text-input side-team-input";
      inp.dataset.sideTeamIdx = String(i);
      inp.maxLength = 24;
      inp.autocomplete = "off";
      inp.placeholder = defaults[i];
      inp.value = existingValues[i] && existingValues[i].trim() ? existingValues[i] : defaults[i];
      inp.setAttribute("aria-label", `${prefix} ${i + 1}`);
      container.appendChild(inp);
    }
  }

  function getSideTeamNames(container, count, fallbackSolo) {
    const defaults =
      count === 1 && fallbackSolo
        ? ["اللاعب الأول"]
        : ["الفريق الأول", "الفريق الثاني", "الفريق الثالث", "الفريق الرابع"];
    const inputs = container ? Array.from(container.querySelectorAll("input")) : [];
    const names = [];
    for (let i = 0; i < count; i++) {
      const v = inputs[i] && typeof inputs[i].value === "string" ? inputs[i].value.trim() : "";
      names.push(v || defaults[i]);
    }
    return names;
  }

  // --- 1) طور جولة البرق السريعة (60-Second Blitz Mode) ---
  function stopBlitzTimer() {
    if (state.blitzTimerInterval) {
      clearInterval(state.blitzTimerInterval);
      state.blitzTimerInterval = null;
    }
  }

  function renderBlitzSetupUI() {
    const cfg = state.blitzConfig;
    if (dom.blitzTeamCountPills) {
      dom.blitzTeamCountPills.querySelectorAll("[data-blitz-teams]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.blitzTeams) === cfg.teamCount);
      });
    }
    renderSideTeamInputs(dom.blitzTeamNamesInputs, cfg.teamCount, "اسم اللاعب أو الفريق", true);

    if (dom.blitzDurationPills) {
      dom.blitzDurationPills.querySelectorAll("[data-blitz-dur]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.blitzDur) === cfg.durationSeconds);
      });
    }
    if (dom.blitzRoundsPills) {
      dom.blitzRoundsPills.querySelectorAll("[data-blitz-rounds]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.blitzRounds) === cfg.roundsPerTeam);
      });
    }
    if (dom.blitzSourceGroup) {
      dom.blitzSourceGroup.innerHTML = `<option value="all">✨ كل الفئات النصية المتاحة</option>`;
      CATEGORY_GROUPS.filter((g) => g.id !== "all" && g.id !== "charades" && g.id !== "visual").forEach(
        (g) => {
          const opt = document.createElement("option");
          opt.value = g.id;
          opt.textContent = `${g.icon} ${g.label}`;
          if (g.id === cfg.groupId) opt.selected = true;
          dom.blitzSourceGroup.appendChild(opt);
        }
      );
    }
  }

  function openBlitzModal() {
    if (!blitzEngine || !dom.blitzModal) return;
    stopBlitzTimer();
    state.blitz = null;
    state.blitzLastFeedback = null;
    renderBlitzSetupUI();
    showOnlyBlitzSubView("setup");
    openModal(dom.blitzModal);
    if (wakeLock && state.setupSettings.wakeLockEnabled) wakeLock.syncForContext(true);
  }

  function closeBlitzModal() {
    stopBlitzTimer();
    state.blitz = null;
    state.blitzLastFeedback = null;
    closeModal(dom.blitzModal);
    broadcastLiveDisplayState();
    syncWakeLockForCurrentScreen();
  }

  function showOnlyBlitzSubView(viewName) {
    if (dom.blitzSetupView) dom.blitzSetupView.hidden = viewName !== "setup";
    if (dom.blitzReadyView) dom.blitzReadyView.hidden = viewName !== "ready";
    if (dom.blitzPlayView) dom.blitzPlayView.hidden = viewName !== "playing";
    if (dom.blitzSummaryView) dom.blitzSummaryView.hidden = viewName !== "turn-summary";
    if (dom.blitzFinishView) dom.blitzFinishView.hidden = viewName !== "finished";
  }

  function startBlitzSession() {
    if (!blitzEngine) return;
    const cfg = state.blitzConfig;
    const groupId = dom.blitzSourceGroup ? dom.blitzSourceGroup.value : "all";
    cfg.groupId = groupId;
    const teamNames = getSideTeamNames(dom.blitzTeamNamesInputs, cfg.teamCount, true);

    const deck = blitzEngine.buildDeck({
      allCategories: state.allCategories,
      sourceMode: groupId === "all" ? "all" : "group",
      selectedGroup: groupId,
      resolveGroupFn: resolveCategoryGroup,
      historyStore,
      flaggedStore
    });
    if (!deck || deck.length === 0) {
      showToast("⚠️ لا توجد أسئلة نصية عادية متاحة في هذا التصنيف!", "warning");
      return;
    }

    state.blitz = blitzEngine.createSession({
      matchId: archiveStore ? archiveStore.generateMatchId("blitz") : `blitz_${Date.now()}`,
      teamNames,
      durationSeconds: cfg.durationSeconds,
      roundsPerTeam: cfg.roundsPerTeam,
      deck
    });
    state.blitzLastFeedback = null;
    renderBlitzView();
    broadcastLiveDisplayState();
  }

  function renderBlitzView() {
    const s = state.blitz;
    if (!s) {
      showOnlyBlitzSubView("setup");
      return;
    }
    showOnlyBlitzSubView(s.phase);
    const activeTeam = s.teams[s.activeTeamIdx] || s.teams[0];
    const currentRound = s.currentRoundForTeam || Math.floor(s.currentTurnNumber / s.teams.length) + 1;

    if (s.phase === "ready") {
      if (dom.blitzReadyBadge) {
        dom.blitzReadyBadge.textContent = `الجولة ${currentRound} من ${s.roundsPerTeam}`;
      }
      if (dom.blitzReadyTeamTitle) {
        dom.blitzReadyTeamTitle.textContent = `استعد: ${activeTeam.name}`;
      }
      if (dom.blitzReadyDesc) {
        dom.blitzReadyDesc.textContent = `أجب على أكبر عدد ممكن من الأسئلة خلال ${s.durationSeconds} ثانية (+100 نقطة لكل إجابة صحيحة)!`;
      }
      if (dom.blitzReadyScoreboard) {
        dom.blitzReadyScoreboard.innerHTML = s.teams
          .map(
            (t, idx) =>
              `<div class="side-mini-score-pill team-${idx + 1}-card"><span>${escapeHtml(t.name)}</span><strong>${t.score}</strong></div>`
          )
          .join("");
      }
    } else if (s.phase === "playing") {
      if (dom.blitzPlayTeamName) dom.blitzPlayTeamName.textContent = activeTeam.name;
      if (dom.blitzPlayTeamScore) dom.blitzPlayTeamScore.textContent = `${activeTeam.score} نقطة`;
      if (dom.blitzStreakPill) {
        if (s.currentStreak >= 2) {
          dom.blitzStreakPill.textContent = `🔥 سلسلة ×${s.currentStreak}`;
          dom.blitzStreakPill.hidden = false;
        } else {
          dom.blitzStreakPill.hidden = true;
        }
      }
      renderBlitzTimerUI();
      if (s.currentQuestion) {
        if (dom.blitzQCatPill) {
          dom.blitzQCatPill.textContent = `${s.currentQuestion.categoryIcon || "⚡"} ${s.currentQuestion.categoryName}`;
        }
        if (dom.blitzQText) dom.blitzQText.textContent = s.currentQuestion.question;
        if (dom.blitzQAnswer) dom.blitzQAnswer.textContent = s.currentQuestion.answer;
      }
    } else if (s.phase === "turn-summary") {
      if (dom.blitzSummaryTitle) {
        dom.blitzSummaryTitle.textContent = `⏰ انتهى دور ${activeTeam.name}!`;
      }
      const correctInTurn = s.turnLog.filter((x) => x.outcome === "correct").length;
      const wrongInTurn = s.turnLog.filter((x) => x.outcome === "wrong").length;
      const skippedInTurn = s.turnLog.filter((x) => x.outcome === "skip").length;
      if (dom.blitzSummaryStats) {
        dom.blitzSummaryStats.innerHTML = `
          <span class="analytics-metric-chip">✅ صح: ${correctInTurn} (+${correctInTurn * 100})</span>
          <span class="analytics-metric-chip">❌ خطأ: ${wrongInTurn}</span>
          <span class="analytics-metric-chip">⏭️ تخطي: ${skippedInTurn}</span>
          <span class="analytics-metric-chip">🔥 أفضل سلسلة: ${activeTeam.bestStreak}</span>
        `;
      }
      if (dom.blitzSummaryList) {
        dom.blitzSummaryList.innerHTML =
          s.turnLog.length === 0
            ? `<div class="empty-inline-note">لم تُحسم أسئلة في هذا الدور.</div>`
            : s.turnLog
                .map((item) => {
                  const tag =
                    item.outcome === "correct"
                      ? `<span class="ev-tag tag-double">✅ +100</span>`
                      : item.outcome === "wrong"
                        ? `<span class="ev-tag tag-steal">❌ خطأ</span>`
                        : `<span class="ev-tag tag-swap">⏭️ تخطي</span>`;
                  return `
                    <div class="side-summary-item">
                      <div class="side-summary-q">${escapeHtml(item.question)}</div>
                      <div class="side-summary-bottom">
                        <span class="side-summary-a">✅ ${escapeHtml(item.answer)}</span>
                        ${tag}
                      </div>
                    </div>
                  `;
                })
                .join("");
      }
      if (dom.btnBlitzNextTurn) {
        const isLastTurn = s.currentTurnNumber + 1 >= s.totalTurns;
        dom.btnBlitzNextTurn.textContent = isLastTurn ? "🏆 عرض النتيجة النهائية" : "الدور التالي ←";
      }
    } else if (s.phase === "finished") {
      const winPayload = buildSideModeWinnerPayload(s.teams, "⚡ نهاية جولة البرق السريعة!");
      if (dom.blitzFinishTitle) dom.blitzFinishTitle.textContent = winPayload.title;
      if (dom.blitzFinishScores) {
        dom.blitzFinishScores.dataset.teamCount = String(s.teams.length);
        dom.blitzFinishScores.innerHTML = s.teams
          .map((t, idx) => {
            const isLeader = winPayload.leaderIndices.includes(idx);
            return `
              <div class="winner-team-box team-${idx + 1}-box${isLeader ? " is-winner" : ""}">
                ${isLeader ? `<div class="winner-crown">👑 الصدارة</div>` : ""}
                <div class="winner-team-name">${escapeHtml(t.name)}</div>
                <div class="winner-team-score">${t.score}</div>
                <div class="winner-score-unit">✅ ${t.correctCount} صح • 🔥 سلسلة ${t.bestStreak}</div>
              </div>
            `;
          })
          .join("");
      }
    }
  }

  function renderBlitzTimerUI() {
    const s = state.blitz;
    if (!s) return;
    const rem = Math.max(0, Number(s.timerRemaining) || 0);
    const max = Math.max(1, Number(s.durationSeconds) || 60);
    const pct = Math.min(100, (rem / max) * 100);
    const isDanger = s.phase === "playing" && rem > 0 && rem <= 10;

    if (dom.blitzTimerDisplay) {
      dom.blitzTimerDisplay.textContent = formatTime(rem);
      dom.blitzTimerDisplay.classList.toggle("danger", isDanger);
    }
    if (dom.blitzTimerProgress) {
      dom.blitzTimerProgress.style.width = `${pct}%`;
      dom.blitzTimerProgress.classList.toggle("danger", isDanger);
    }
    if (dom.btnBlitzPause) {
      dom.btnBlitzPause.innerHTML = s.timerRunning
        ? `⏸️ إيقاف <kbd class="kbd-hint">Space</kbd>`
        : `▶️ استئناف <kbd class="kbd-hint">Space</kbd>`;
    }
  }

  function beginBlitzTurn() {
    const s = state.blitz;
    if (!s || !blitzEngine) return;
    s.phase = "playing";
    s.timerRemaining = s.durationSeconds;
    s.timerRunning = true;
    s.timerStatus = "running";
    s.timerEndAtMs = getWirelessServerNowMs() + s.timerRemaining * 1000;
    s.currentStreak = 0;
    s.turnLog = [];
    s.currentQuestion = blitzEngine.drawNextQuestion(s);
    state.blitzLastFeedback = null;

    if (!s.currentQuestion) {
      showToast("نفدت الأسئلة المتاحة في الرزمة!", "warning");
      finishBlitzTurn();
      return;
    }

    stopBlitzTimer();
    state.blitzTimerInterval = setInterval(() => {
      if (!state.blitz || state.blitz.phase !== "playing" || !state.blitz.timerRunning) return;
      state.blitz.timerRemaining = Math.max(0, state.blitz.timerRemaining - 1);
      if (state.blitz.timerRemaining > 0 && state.blitz.timerRemaining <= 10 && window.SeenJeemAudio) {
        window.SeenJeemAudio.playCharadesUrgentTick(state.blitz.timerRemaining);
      }
      renderBlitzTimerUI();
      if (state.blitz.timerRemaining === 0) {
        if (window.SeenJeemAudio) window.SeenJeemAudio.playTimeUp();
        finishBlitzTurn();
      } else {
        broadcastLiveDisplayState({ skipWireless: true });
      }
    }, 1000);

    if (window.SeenJeemAudio) window.SeenJeemAudio.playTileOpen();
    renderBlitzView();
    broadcastLiveDisplayState();
  }

  function toggleBlitzPause() {
    const s = state.blitz;
    if (!s || s.phase !== "playing") return;
    s.timerRunning = !s.timerRunning;
    s.timerStatus = s.timerRunning ? "running" : "paused";
    s.timerEndAtMs = s.timerRunning ? getWirelessServerNowMs() + s.timerRemaining * 1000 : null;
    renderBlitzTimerUI();
    broadcastLiveDisplayState();
  }

  function handleBlitzJudge(outcome) {
    const s = state.blitz;
    if (!s || s.phase !== "playing" || !s.currentQuestion || !blitzEngine) return;
    const team = s.teams[s.activeTeamIdx];
    const q = s.currentQuestion;

    s.turnLog.push({
      questionId: q.id,
      question: q.question,
      answer: q.answer,
      categoryName: q.categoryName,
      outcome
    });

    if (outcome === "correct") {
      team.score += 100;
      team.correctCount += 1;
      s.currentStreak += 1;
      if (s.currentStreak > team.bestStreak) team.bestStreak = s.currentStreak;
      historyStore.markQuestionPlayed(q.id, Date.now());
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playStreakSuccess === "function") {
        window.SeenJeemAudio.playStreakSuccess(s.currentStreak);
      }
      s.lastFeedback = { type: "correct", ts: Date.now() };
    } else if (outcome === "wrong") {
      team.wrongCount += 1;
      s.currentStreak = 0;
      historyStore.markQuestionPlayed(q.id, Date.now());
      if (window.SeenJeemAudio) window.SeenJeemAudio.playWrongAnswer();
      s.lastFeedback = { type: "wrong", ts: Date.now() };
    } else {
      team.skipCount += 1;
      if (window.SeenJeemAudio) window.SeenJeemAudio.playTick(false);
      s.lastFeedback = { type: "skip", ts: Date.now() };
    }

    s.currentQuestion = blitzEngine.drawNextQuestion(s);
    if (!s.currentQuestion) {
      finishBlitzTurn();
      return;
    }

    renderBlitzView();
    broadcastLiveDisplayState();
  }

  function finishBlitzTurn() {
    stopBlitzTimer();
    const s = state.blitz;
    if (!s) return;
    s.timerRunning = false;
    s.timerStatus = "finished";
    s.timerEndAtMs = null;
    s.phase = "turn-summary";
    renderBlitzView();
    broadcastLiveDisplayState();
  }

  function advanceBlitzTurn() {
    const s = state.blitz;
    if (!s) return;
    s.currentTurnNumber += 1;
    if (s.currentTurnNumber >= s.totalTurns) {
      s.phase = "finished";
      recordBlitzToArchive();
      if (
        state.activeTournamentMatch &&
        window.SeenJeemTournament &&
        typeof window.SeenJeemTournament.recordMatchResult === "function"
      ) {
        const sA = s.teams[0] ? Number(s.teams[0].score) || 0 : 0;
        const sB = s.teams[1] ? Number(s.teams[1].score) || 0 : 0;
        window.SeenJeemTournament.recordMatchResult(state.activeTournamentMatch.matchId, { scoreA: sA, scoreB: sB });
        if (dom.btnBlitzReturnTournament) dom.btnBlitzReturnTournament.hidden = false;
      } else if (dom.btnBlitzReturnTournament) {
        dom.btnBlitzReturnTournament.hidden = true;
      }
      renderBlitzView();
      broadcastLiveDisplayState();
      if (window.SeenJeemAudio) window.SeenJeemAudio.playVictory();
      startVictoryConfetti("default");
    } else {
      s.activeTeamIdx = s.currentTurnNumber % s.teams.length;
      s.currentRoundForTeam = Math.floor(s.currentTurnNumber / s.teams.length) + 1;
      s.phase = "ready";
      s.timerRemaining = s.durationSeconds;
      s.currentStreak = 0;
      s.turnLog = [];
      renderBlitzView();
      broadcastLiveDisplayState();
    }
  }

  function recordBlitzToArchive() {
    const s = state.blitz;
    if (!archiveStore || !s) return;
    const totalAnswered = s.teams.reduce((sum, t) => sum + t.correctCount + t.wrongCount, 0);
    const maxScore = s.teams.reduce((m, t) => Math.max(m, t.score), -Infinity);
    const leaders = s.teams.filter((t) => t.score === maxScore);
    const isDraw = s.teams.length > 1 && leaders.length > 1;
    const winnerNames = leaders.map((t) => t.name);

    archiveStore.recordCompletedMatch({
      matchId: s.matchId,
      profileId: historyStore.getActiveProfileId(),
      mode: "blitz",
      playedAt: Date.now(),
      teams: s.teams.map((t) => {
        const attempts = t.correctCount + t.wrongCount;
        return {
          name: t.name,
          score: t.score,
          accuracy: attempts > 0 ? Math.round((t.correctCount / attempts) * 100) : 0,
          stealsCount: 0
        };
      }),
      winnerNames,
      isDraw,
      totalQuestions: totalAnswered,
      highestSingleHit: 100,
      topCategory: "⚡ جولة البرق"
    });
  }

  function openBlitzResultCard() {
    const s = state.blitz;
    if (!s) return;
    const totalQ = s.teams.reduce((sum, t) => sum + t.correctCount + t.wrongCount, 0);
    const totalCorrect = s.teams.reduce((sum, t) => sum + t.correctCount, 0);
    openResultCardModal({
      teams: s.teams.map((t, i) => ({ id: `team-${i}`, name: t.name, score: t.score })),
      analytics: {
        totalQuestions: totalQ,
        overallAccuracy: totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0,
        totalSteals: 0,
        totalDoubleWins: 0,
        teamStats: s.teams.map((t) => ({
          name: t.name,
          correct: t.correctCount,
          accuracy:
            t.correctCount + t.wrongCount > 0
              ? Math.round((t.correctCount / (t.correctCount + t.wrongCount)) * 100)
              : 0
        }))
      },
      matchEvents: [],
      profileName: `${historyStore.getActiveProfile().name} • ⚡ جولة البرق`,
      theme: state.theme,
      timestamp: Date.now()
    });
  }

  // --- 2) طور «من غير كلام» المستقل (Standalone Charades Mode) ---
  function stopCsoloTimer() {
    if (state.csoloTimerInterval) {
      clearInterval(state.csoloTimerInterval);
      state.csoloTimerInterval = null;
    }
  }

  function renderCsoloSetupUI() {
    const cfg = state.csoloConfig;
    if (dom.csoloTeamCountPills) {
      dom.csoloTeamCountPills.querySelectorAll("[data-csolo-teams]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.csoloTeams) === cfg.teamCount);
      });
    }
    renderSideTeamInputs(dom.csoloTeamNamesInputs, cfg.teamCount, "اسم الفريق", false);

    if (dom.csoloDurationPills) {
      dom.csoloDurationPills.querySelectorAll("[data-csolo-dur]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.csoloDur) === cfg.durationSeconds);
      });
    }
    if (dom.csoloRoundsPills) {
      dom.csoloRoundsPills.querySelectorAll("[data-csolo-rounds]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.csoloRounds) === cfg.roundsPerTeam);
      });
    }
    if (dom.csoloSkipPills) {
      dom.csoloSkipPills.querySelectorAll("[data-csolo-skip]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.csoloSkip) === cfg.skipLimit);
      });
    }

    if (dom.csoloCategoriesChips && charadesEngine) {
      const cats = charadesEngine.getCharadesCategories(state.allCategories);
      dom.csoloCategoriesChips.innerHTML = "";
      if (cats.length === 0) {
        dom.csoloCategoriesChips.innerHTML = `<span class="empty-inline-note">لا توجد فئات «من غير كلام» متاحة حالياً.</span>`;
        return;
      }
      cats.forEach((cat) => {
        const selected = cfg.selectedCategoryIds.includes(cat.id);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `csolo-cat-chip${selected ? " active" : ""}`;
        btn.dataset.catId = cat.id;
        btn.textContent = `${cat.icon || "🎭"} ${cat.name.replace(/^من غير كلام\s*[-–:]\s*/i, "")}`;
        btn.addEventListener("click", () => {
          const idx = cfg.selectedCategoryIds.indexOf(cat.id);
          if (idx >= 0) cfg.selectedCategoryIds.splice(idx, 1);
          else cfg.selectedCategoryIds.push(cat.id);
          btn.classList.toggle("active", cfg.selectedCategoryIds.includes(cat.id));
        });
        dom.csoloCategoriesChips.appendChild(btn);
      });
    }
  }

  function showOnlyCsoloSubView(viewName) {
    if (dom.csoloSetupView) dom.csoloSetupView.hidden = viewName !== "setup";
    if (dom.csoloReadyView) dom.csoloReadyView.hidden = viewName !== "ready";
    if (dom.csoloPlayView) dom.csoloPlayView.hidden = viewName !== "playing";
    if (dom.csoloSummaryView) dom.csoloSummaryView.hidden = viewName !== "turn-summary";
    if (dom.csoloFinishView) dom.csoloFinishView.hidden = viewName !== "finished";
  }

  function openCharadesSoloModal() {
    if (!charadesEngine || !dom.charadesSoloModal) return;
    stopCsoloTimer();
    state.charadesSolo = null;
    state.csoloHoldActive = false;
    state.csoloLastFeedback = null;
    renderCsoloSetupUI();
    showOnlyCsoloSubView("setup");
    openModal(dom.charadesSoloModal);
    if (wakeLock && state.setupSettings.wakeLockEnabled) wakeLock.syncForContext(true);
  }

  function closeCharadesSoloModal() {
    stopCsoloTimer();
    setCsoloHoldReveal(false);
    state.charadesSolo = null;
    state.csoloLastFeedback = null;
    closeModal(dom.charadesSoloModal);
    broadcastLiveDisplayState();
    syncWakeLockForCurrentScreen();
  }

  function startCsoloSession() {
    if (!charadesEngine) return;
    const cfg = state.csoloConfig;
    const teamNames = getSideTeamNames(dom.csoloTeamNamesInputs, cfg.teamCount, false);
    const deck = charadesEngine.buildDeck({
      allCategories: state.allCategories,
      selectedCategoryIds: cfg.selectedCategoryIds,
      parseHeaderFn: parseCharadesHeader,
      historyStore,
      flaggedStore
    });

    if (!deck || deck.length === 0) {
      showToast("⚠️ لا توجد بطاقات «من غير كلام» متاحة للفئات المختارة!", "warning");
      return;
    }

    state.charadesSolo = charadesEngine.createSession({
      matchId: archiveStore ? archiveStore.generateMatchId("charades") : `charades_${Date.now()}`,
      teamNames,
      durationSeconds: cfg.durationSeconds,
      roundsPerTeam: cfg.roundsPerTeam,
      skipLimit: cfg.skipLimit,
      deck
    });
    state.csoloLastFeedback = null;
    renderCsoloView();
    broadcastLiveDisplayState();
  }

  function setCsoloHoldReveal(isRevealing) {
    state.csoloHoldActive = Boolean(isRevealing);
    if (dom.csoloDecoyCard) dom.csoloDecoyCard.hidden = state.csoloHoldActive;
    if (dom.csoloSecretCard) dom.csoloSecretCard.hidden = !state.csoloHoldActive;
    if (dom.btnCsoloHoldReveal) {
      dom.btnCsoloHoldReveal.classList.toggle("is-holding", state.csoloHoldActive);
    }
  }

  function renderCsoloTimerUI() {
    const s = state.charadesSolo;
    if (!s) return;
    const rem = Math.max(0, Number(s.timerRemaining) || 0);
    const max = Math.max(1, Number(s.durationSeconds) || 90);
    const pct = Math.min(100, (rem / max) * 100);
    const isDanger = s.phase === "playing" && rem > 0 && rem <= 10;

    if (dom.csoloTimerDisplay) {
      dom.csoloTimerDisplay.textContent = formatTime(rem);
      dom.csoloTimerDisplay.classList.toggle("danger", isDanger);
    }
    if (dom.csoloTimerProgress) {
      dom.csoloTimerProgress.style.width = `${pct}%`;
      dom.csoloTimerProgress.classList.toggle("danger", isDanger);
    }
    if (dom.btnCsoloPause) {
      dom.btnCsoloPause.textContent = s.timerRunning ? "⏸️ إيقاف" : "▶️ استئناف";
    }
  }

  function renderCsoloView() {
    const s = state.charadesSolo;
    if (!s) {
      showOnlyCsoloSubView("setup");
      return;
    }
    showOnlyCsoloSubView(s.phase);
    const activeTeam = s.teams[s.activeTeamIdx] || s.teams[0];
    const currentRound = s.currentRoundForTeam || Math.floor(s.currentTurnNumber / s.teams.length) + 1;

    if (s.phase === "ready") {
      if (dom.csoloReadyBadge) dom.csoloReadyBadge.textContent = `الجولة ${currentRound} من ${s.roundsPerTeam}`;
      if (dom.csoloReadyTeamTitle) dom.csoloReadyTeamTitle.textContent = `دور التمثيل: ${activeTeam.name}`;
      if (dom.csoloReadyDesc) {
        dom.csoloReadyDesc.textContent = state.dualScreen.connected
          ? `📺 شاشة التلفزيون متصلة — ستظهر الكلمة وفكرة التمثيل لك هنا سراً فقط بينما يشاهد الجمهور التصنيف وعدد الكلمات.`
          : `يستعد الممثّل أمام الشاشة بينما يدير الفريق ظهره، ويستخدم زر الضغط المطوّل لكشف الكلمة سراً.`;
      }
      if (dom.csoloReadyScoreboard) {
        dom.csoloReadyScoreboard.innerHTML = s.teams
          .map(
            (t, idx) =>
              `<div class="side-mini-score-pill team-${idx + 1}-card"><span>${escapeHtml(t.name)}</span><strong>${t.score}</strong></div>`
          )
          .join("");
      }
    } else if (s.phase === "playing") {
      if (dom.csoloPlayTeamName) dom.csoloPlayTeamName.textContent = activeTeam.name;
      if (dom.csoloPlayTeamScore) dom.csoloPlayTeamScore.textContent = `${activeTeam.score} نقطة`;
      if (dom.csoloSkipsPill) {
        dom.csoloSkipsPill.textContent =
          s.skipLimit === 0
            ? "تخطي: غير محدود"
            : `تخطي متبقي: ${Math.max(0, s.skipLimit - s.skipsUsedThisTurn)}`;
      }
      renderCsoloTimerUI();

      const card = s.currentCard;
      if (card) {
        const hdr = card.header || { eyebrow: "🎭 من غير كلام", topic: card.categoryName, wordCount: "" };
        if (dom.csoloEyebrow) dom.csoloEyebrow.textContent = hdr.eyebrow || "🎭 من غير كلام";
        if (dom.csoloTopic) dom.csoloTopic.textContent = hdr.topic || card.categoryName;
        if (dom.csoloWordCount) {
          dom.csoloWordCount.textContent = `🔢 عدد الكلمات: ${hdr.wordCount || hdr.wordCountLabel || ""}`;
        }

        const isDual = state.dualScreen.connected;
        if (dom.csoloHostSecretBox) dom.csoloHostSecretBox.hidden = !isDual;
        if (dom.csoloHoldStage) dom.csoloHoldStage.hidden = isDual;

        if (dom.csoloHostWord) dom.csoloHostWord.textContent = card.answer;
        if (dom.csoloHostExpRow && dom.csoloHostExp) {
          dom.csoloHostExp.textContent = card.explanation || "";
          dom.csoloHostExpRow.hidden = !card.explanation;
        }
        if (dom.csoloSecretWord) dom.csoloSecretWord.textContent = card.answer;
        if (dom.csoloSecretExp) {
          dom.csoloSecretExp.textContent = card.explanation ? `🎬 فكرة التمثيل: ${card.explanation}` : "";
          dom.csoloSecretExp.hidden = !card.explanation;
        }

        if (dom.csoloHintBox) {
          if (s.hintRevealedForCurrent && card.hint) {
            dom.csoloHintBox.textContent = `💡 تلميح للجمهور: ${card.hint}`;
            dom.csoloHintBox.hidden = false;
          } else {
            dom.csoloHintBox.hidden = true;
            dom.csoloHintBox.textContent = "";
          }
        }
        if (dom.btnCsoloHint) {
          dom.btnCsoloHint.disabled = !card.hint || s.hintRevealedForCurrent;
          dom.btnCsoloHint.textContent = !card.hint
            ? "💡 لا يوجد تلميح"
            : s.hintRevealedForCurrent
              ? "✓ التلميح ظاهر للجمهور"
              : "💡 تلميح للجمهور";
        }
        if (dom.btnCsoloSkip && charadesEngine) {
          dom.btnCsoloSkip.disabled = !charadesEngine.canSkipInCurrentTurn(s);
        }
      }
    } else if (s.phase === "turn-summary") {
      if (dom.csoloSummaryTitle) dom.csoloSummaryTitle.textContent = `⏰ انتهى دور ${activeTeam.name}!`;
      const guessedCount = s.turnLog.filter((x) => x.outcome === "guessed").length;
      const skippedCount = s.turnLog.filter((x) => x.outcome === "skip").length;
      if (dom.csoloSummaryStats) {
        dom.csoloSummaryStats.innerHTML = `
          <span class="analytics-metric-chip">✅ تم التخمين: ${guessedCount} (+${guessedCount * 100})</span>
          <span class="analytics-metric-chip">⏭️ تخطي: ${skippedCount}</span>
        `;
      }
      if (dom.csoloSummaryList) {
        dom.csoloSummaryList.innerHTML =
          s.turnLog.length === 0
            ? `<div class="empty-inline-note">لم تُخمَّن كلمات في هذا الدور.</div>`
            : s.turnLog
                .map((item) => {
                  const tag =
                    item.outcome === "guessed"
                      ? `<span class="ev-tag tag-double">✅ +100</span>`
                      : `<span class="ev-tag tag-swap">⏭️ تخطي</span>`;
                  return `
                    <div class="side-summary-item">
                      <div class="side-summary-q">🎭 ${escapeHtml(item.answer || item.word)}</div>
                      <div class="side-summary-bottom">
                        <span class="side-summary-a">${escapeHtml(item.topic || item.categoryName)}</span>
                        ${tag}
                      </div>
                    </div>
                  `;
                })
                .join("");
      }
      if (dom.btnCsoloNextTurn) {
        const isLast = s.currentTurnNumber + 1 >= s.totalTurns;
        dom.btnCsoloNextTurn.textContent = isLast ? "🏆 عرض النتيجة النهائية" : "الدور التالي ←";
      }
    } else if (s.phase === "finished") {
      const winPayload = buildSideModeWinnerPayload(s.teams, "🎭 نهاية تحدي «من غير كلام»!");
      if (dom.csoloFinishTitle) dom.csoloFinishTitle.textContent = winPayload.title;
      if (dom.csoloFinishScores) {
        dom.csoloFinishScores.dataset.teamCount = String(s.teams.length);
        dom.csoloFinishScores.innerHTML = s.teams
          .map((t, idx) => {
            const isLeader = winPayload.leaderIndices.includes(idx);
            return `
              <div class="winner-team-box team-${idx + 1}-box${isLeader ? " is-winner" : ""}">
                ${isLeader ? `<div class="winner-crown">👑 الفائز</div>` : ""}
                <div class="winner-team-name">${escapeHtml(t.name)}</div>
                <div class="winner-team-score">${t.score}</div>
                <div class="winner-score-unit">✅ ${t.guessedCount} كلمة • ⏭️ ${t.skippedCount} تخطي</div>
              </div>
            `;
          })
          .join("");
      }
    }
  }

  function beginCsoloTurn() {
    const s = state.charadesSolo;
    if (!s || !charadesEngine) return;
    setCsoloHoldReveal(false);
    s.phase = "playing";
    s.timerRemaining = s.durationSeconds;
    s.timerRunning = true;
    s.timerStatus = "running";
    s.timerEndAtMs = getWirelessServerNowMs() + s.timerRemaining * 1000;
    s.skipsUsedThisTurn = 0;
    s.turnLog = [];
    s.currentCard = charadesEngine.drawNextCard(s);
    s.lastFeedback = null;

    if (!s.currentCard) {
      showToast("نفدت البطاقات المتاحة!", "warning");
      finishCsoloTurn();
      return;
    }

    stopCsoloTimer();
    state.csoloTimerInterval = setInterval(() => {
      if (!state.charadesSolo || state.charadesSolo.phase !== "playing" || !state.charadesSolo.timerRunning) return;
      state.charadesSolo.timerRemaining = Math.max(0, state.charadesSolo.timerRemaining - 1);
      if (
        state.charadesSolo.timerRemaining > 0 &&
        state.charadesSolo.timerRemaining <= 10 &&
        window.SeenJeemAudio
      ) {
        window.SeenJeemAudio.playCharadesUrgentTick(state.charadesSolo.timerRemaining);
      }
      renderCsoloTimerUI();
      if (state.charadesSolo.timerRemaining === 0) {
        if (window.SeenJeemAudio) window.SeenJeemAudio.playTimeUp();
        finishCsoloTurn();
      } else {
        broadcastLiveDisplayState({ skipWireless: true });
      }
    }, 1000);

    if (window.SeenJeemAudio) window.SeenJeemAudio.playTileOpen();
    renderCsoloView();
    broadcastLiveDisplayState();
  }

  function toggleCsoloPause() {
    const s = state.charadesSolo;
    if (!s || s.phase !== "playing") return;
    s.timerRunning = !s.timerRunning;
    s.timerStatus = s.timerRunning ? "running" : "paused";
    s.timerEndAtMs = s.timerRunning ? getWirelessServerNowMs() + s.timerRemaining * 1000 : null;
    renderCsoloTimerUI();
    broadcastLiveDisplayState();
  }

  function handleCsoloGuessed() {
    const s = state.charadesSolo;
    if (!s || s.phase !== "playing" || !s.currentCard || !charadesEngine) return;
    setCsoloHoldReveal(false);
    const team = s.teams[s.activeTeamIdx];
    const card = s.currentCard;

    team.score += 100;
    team.guessedCount += 1;
    s.turnLog.push({
      questionId: card.id,
      topic: (card.header && card.header.topic) || card.categoryName,
      answer: card.answer,
      word: card.answer,
      categoryName: card.categoryName,
      outcome: "guessed"
    });
    // تسجيل الكلمة المخمَّنة كـ «ملعوبة» في historyStore
    historyStore.markQuestionPlayed(card.id, Date.now());
    if (window.SeenJeemAudio) window.SeenJeemAudio.playScore(true);
    s.lastFeedback = { type: "guessed", ts: Date.now() };

    s.currentCard = charadesEngine.drawNextCard(s);
    if (!s.currentCard) {
      finishCsoloTurn();
      return;
    }
    renderCsoloView();
    broadcastLiveDisplayState();
  }

  function handleCsoloSkip() {
    const s = state.charadesSolo;
    if (!s || s.phase !== "playing" || !s.currentCard || !charadesEngine) return;
    if (!charadesEngine.canSkipInCurrentTurn(s)) {
      showToast("استنفدت حد التخطي المسموح في هذا الدور!", "warning");
      return;
    }
    setCsoloHoldReveal(false);
    const team = s.teams[s.activeTeamIdx];
    const card = s.currentCard;

    s.skipsUsedThisTurn += 1;
    team.skippedCount += 1;
    // لا تُسجَّل الكلمة المتخطّاة كـ «ملعوبة» في historyStore ليتمكن اللاعبون من رؤيتها لاحقاً
    s.turnLog.push({
      questionId: card.id,
      topic: (card.header && card.header.topic) || card.categoryName,
      answer: card.answer,
      word: card.answer,
      categoryName: card.categoryName,
      outcome: "skip"
    });
    if (window.SeenJeemAudio) window.SeenJeemAudio.playTick(false);
    s.lastFeedback = { type: "skip", ts: Date.now() };

    s.currentCard = charadesEngine.drawNextCard(s);
    if (!s.currentCard) {
      finishCsoloTurn();
      return;
    }
    renderCsoloView();
    broadcastLiveDisplayState();
  }

  function handleCsoloHint() {
    const s = state.charadesSolo;
    if (!s || s.phase !== "playing" || !s.currentCard || !s.currentCard.hint || s.hintRevealedForCurrent) return;
    s.hintRevealedForCurrent = true;
    if (window.SeenJeemAudio) window.SeenJeemAudio.playHint();
    renderCsoloView();
    broadcastLiveDisplayState();
  }

  function finishCsoloTurn() {
    stopCsoloTimer();
    setCsoloHoldReveal(false);
    const s = state.charadesSolo;
    if (!s) return;
    s.timerRunning = false;
    s.timerStatus = "finished";
    s.timerEndAtMs = null;
    s.phase = "turn-summary";
    renderCsoloView();
    broadcastLiveDisplayState();
  }

  function advanceCsoloTurn() {
    const s = state.charadesSolo;
    if (!s) return;
    s.currentTurnNumber += 1;
    if (s.currentTurnNumber >= s.totalTurns) {
      s.phase = "finished";
      recordCsoloToArchive();
      renderCsoloView();
      broadcastLiveDisplayState();
      if (window.SeenJeemAudio) window.SeenJeemAudio.playVictory();
      startVictoryConfetti("default");
    } else {
      s.activeTeamIdx = s.currentTurnNumber % s.teams.length;
      s.currentRoundForTeam = Math.floor(s.currentTurnNumber / s.teams.length) + 1;
      s.phase = "ready";
      s.timerRemaining = s.durationSeconds;
      s.skipsUsedThisTurn = 0;
      s.turnLog = [];
      renderCsoloView();
      broadcastLiveDisplayState();
    }
  }

  function recordCsoloToArchive() {
    const s = state.charadesSolo;
    if (!archiveStore || !s) return;
    const totalGuessed = s.teams.reduce((sum, t) => sum + t.guessedCount, 0);
    const maxScore = s.teams.reduce((m, t) => Math.max(m, t.score), -Infinity);
    const leaders = s.teams.filter((t) => t.score === maxScore);
    const isDraw = s.teams.length > 1 && leaders.length > 1;
    const winnerNames = leaders.map((t) => t.name);

    archiveStore.recordCompletedMatch({
      matchId: s.matchId,
      profileId: historyStore.getActiveProfileId(),
      mode: "charades",
      playedAt: Date.now(),
      teams: s.teams.map((t) => ({
        name: t.name,
        score: t.score,
        accuracy:
          t.guessedCount + t.skippedCount > 0
            ? Math.round((t.guessedCount / (t.guessedCount + t.skippedCount)) * 100)
            : 0,
        stealsCount: 0
      })),
      winnerNames,
      isDraw,
      totalQuestions: totalGuessed,
      highestSingleHit: 100,
      topCategory: "🎭 من غير كلام"
    });
  }

  function openCsoloResultCard() {
    const s = state.charadesSolo;
    if (!s) return;
    const totalG = s.teams.reduce((sum, t) => sum + t.guessedCount, 0);
    openResultCardModal({
      teams: s.teams.map((t, i) => ({ id: `team-${i}`, name: t.name, score: t.score })),
      analytics: {
        totalQuestions: totalG,
        overallAccuracy: 100,
        totalSteals: 0,
        totalDoubleWins: 0,
        teamStats: s.teams.map((t) => ({ name: t.name, correct: t.guessedCount, accuracy: 100 }))
      },
      matchEvents: [],
      profileName: `${historyStore.getActiveProfile().name} • 🎭 من غير كلام`,
      theme: state.theme,
      timestamp: Date.now()
    });
  }

  // --- 3) قاعة المشاهير وأرشيف المباريات (Hall of Fame & Match Archive) ---
  function recordClassicMatchToArchive() {
    if (!archiveStore) return;
    if (state.answeredThisRound <= 0 && (!state.matchEvents || state.matchEvents.length === 0)) return;
    if (!state.matchId) {
      state.matchId = archiveStore.generateMatchId("classic");
    }

    const an = computeMatchAnalytics();
    const leaderIndices = finalRoundEngine
      ? finalRoundEngine.getLeaderIndices(state.teams)
      : [0];
    const isDraw = leaderIndices.length !== 1;
    const winnerNames = leaderIndices
      .map((idx) => (state.teams[idx] ? state.teams[idx].name : ""))
      .filter(Boolean);

    const highestSingleHit = (state.matchEvents || []).reduce(
      (max, ev) => (!ev.isFinalRound ? Math.max(max, Number(ev.effectivePoints) || 0) : max),
      0
    );
    const topCat =
      an.categories && an.categories.length > 0
        ? an.categories.slice().sort((a, b) => b.total - a.total)[0].categoryName
        : "";

    archiveStore.recordCompletedMatch({
      matchId: state.matchId,
      profileId: historyStore.getActiveProfileId(),
      mode: "classic",
      playedAt: Date.now(),
      teams: state.teams.map((t, idx) => {
        const ts = an.teamStats[idx] || { stealsWon: 0, accuracy: 0 };
        return {
          name: t.name,
          score: Number(t.score) || 0,
          accuracy: Number(ts.accuracy) || 0,
          stealsCount: Number(ts.stealsWon) || 0
        };
      }),
      winnerNames,
      isDraw,
      totalQuestions: an.totalQuestions,
      highestSingleHit,
      topCategory: topCat
    });
  }

  function openHallOfFameModal() {
    if (!archiveStore || !dom.hallOfFameModal) return;
    renderHallOfFameModal();
    openModal(dom.hallOfFameModal);
  }

  function closeHallOfFameModal() {
    closeModal(dom.hallOfFameModal);
  }

  function openArchivedMatchResultCard(record) {
    if (!record || !Array.isArray(record.teams) || record.teams.length === 0) return;
    const modeLabels = {
      classic: "كلاسيكي",
      blitz: "⚡ جولة البرق",
      charades: "🎭 من غير كلام"
    };
    const totalAcc =
      record.teams.length > 0
        ? Math.round(
            record.teams.reduce((s, t) => s + (Number(t.accuracy) || 0), 0) / record.teams.length
          )
        : 0;
    openResultCardModal({
      teams: record.teams.map((t, i) => ({
        id: `team-${i}`,
        name: t.name,
        score: Number(t.score) || 0
      })),
      analytics: {
        totalQuestions: Number(record.totalQuestions) || 0,
        overallAccuracy: totalAcc,
        totalSteals: record.teams.reduce((s, t) => s + (Number(t.stealsCount) || 0), 0),
        totalDoubleWins: 0,
        teamStats: record.teams.map((t) => ({
          name: t.name,
          correct: 0,
          accuracy: Number(t.accuracy) || 0
        }))
      },
      matchEvents: [],
      profileName: `${historyStore.getActiveProfile().name} • ${
        modeLabels[record.mode] || "كلاسيكي"
      }`,
      theme: state.theme,
      timestamp: record.playedAt || Date.now()
    });
  }

  function renderHallOfFameModal() {
    if (!archiveStore) return;
    const profile = historyStore.getActiveProfile();
    const isBaraView = state.hofActiveView === "bara-salfa";
    const isMafiaView = state.hofActiveView === "mafia";
    const activeTabName = isMafiaView ? "mafia" : isBaraView ? "bara-salfa" : "seen-jeem";

    if (dom.hofViewTabs) {
      dom.hofViewTabs.querySelectorAll("[data-hof-view]").forEach((tab) => {
        const active = tab.dataset.hofView === activeTabName;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
    }
    if (dom.hofSeenJeemSections) dom.hofSeenJeemSections.hidden = isBaraView || isMafiaView;
    if (dom.hofBaraSalfaSection) dom.hofBaraSalfaSection.hidden = !isBaraView;
    if (dom.hofMafiaSection) dom.hofMafiaSection.hidden = !isMafiaView;

    if (isMafiaView) {
      const mafiaHof =
        typeof archiveStore.computeMafiaHallOfFame === "function"
          ? archiveStore.computeMafiaHallOfFame(profile.id)
          : { totalSessions: 0, summary: {}, leaderboard: [] };
      const sm = mafiaHof.summary || {};

      if (dom.hofProfileSubtitle) {
        dom.hofProfileSubtitle.textContent = `المجموعة النشطة: ${profile.name} • إحصائيات جلسات «المافيا» المحفوظة`;
      }
      if (dom.hofMafiaTotalSessionsPill) {
        dom.hofMafiaTotalSessionsPill.textContent = `${mafiaHof.totalSessions} جلسة`;
      }
      if (dom.btnHofClearArchive) {
        dom.btnHofClearArchive.textContent = "🗑️ تصفير إحصائيات المافيا للمجموعة";
        dom.btnHofClearArchive.disabled = mafiaHof.totalSessions === 0;
      }

      if (dom.hofMafiaRecordsGrid) {
        dom.hofMafiaRecordsGrid.innerHTML = `
          <div class="hof-record-card">
            <div class="hof-rec-icon">🕵️</div>
            <div class="hof-rec-val">${sm.mafiaWins || 0}</div>
            <div class="hof-rec-lbl">انتصارات المافيا</div>
            <div class="hof-rec-sub">مقابل ${sm.citizenWins || 0} للمواطنين${sm.jesterWins ? ` • ${sm.jesterWins} للمهرج` : ""}</div>
          </div>
          <div class="hof-record-card">
            <div class="hof-rec-icon">🩺</div>
            <div class="hof-rec-val">${sm.totalDoctorSaves || 0}</div>
            <div class="hof-rec-lbl">إنقاذات الطبيب</div>
            <div class="hof-rec-sub">عمليات حماية ليلية ناجحة</div>
          </div>
          <div class="hof-record-card">
            <div class="hof-rec-icon">🔍</div>
            <div class="hof-rec-val">${sm.detectiveChecks > 0 ? `${sm.detectiveAccuracy}%` : "—"}</div>
            <div class="hof-rec-lbl">دقة كشوفات المحقق</div>
            <div class="hof-rec-sub">${sm.detectiveChecks > 0 ? `${sm.detectiveHits} كشف مافيا من ${sm.detectiveChecks}` : "لا توجد فحوصات بعد"}</div>
          </div>
        `;
      }

      if (dom.hofMafiaLeaderboardWrap) {
        if (!mafiaHof.leaderboard || mafiaHof.leaderboard.length === 0) {
          dom.hofMafiaLeaderboardWrap.innerHTML = `<div class="empty-inline-note">أكمل أول جلسة «المافيا» لتظهر إحصائيات اللاعبين ونسب الفوز كمافيا ومواطنين لمجموعة «${escapeHtml(profile.name)}».</div>`;
        } else {
          dom.hofMafiaLeaderboardWrap.innerHTML = `
            <div class="hof-table-scroll">
              <table class="hof-leaderboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>اللاعب</th>
                    <th>الجولات</th>
                    <th>الفوز العام</th>
                    <th>فوز كمافيا</th>
                    <th>فوز كمواطن</th>
                  </tr>
                </thead>
                <tbody>
                  ${mafiaHof.leaderboard
                    .slice(0, 20)
                    .map(
                      (row, idx) => `
                    <tr class="${idx === 0 ? "is-rank-1" : ""}">
                      <td><strong>${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}</strong></td>
                      <td><strong>${escapeHtml(row.displayName)}</strong></td>
                      <td>${row.sessions}</td>
                      <td><strong>${row.winRate}%</strong> (${row.totalWins}/${row.sessions})</td>
                      <td>${row.mafiaWinRate !== null ? `${row.mafiaWinRate}% (${row.mafiaWins}/${row.mafiaGames})` : "—"}</td>
                      <td>${row.citizenWinRate !== null ? `${row.citizenWinRate}% (${row.citizenWins}/${row.citizenGames})` : "—"}</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `;
        }
      }
      return;
    }

    if (isBaraView) {
      const baraHof =
        typeof archiveStore.computeBaraSalfaHallOfFame === "function"
          ? archiveStore.computeBaraSalfaHallOfFame(profile.id)
          : { totalRounds: 0, leaderboard: [], records: {} };

      if (dom.hofProfileSubtitle) {
        dom.hofProfileSubtitle.textContent = `المجموعة النشطة: ${profile.name} • إحصائيات جولات «برا السالفة» المحفوظة`;
      }
      if (dom.hofBaraTotalRoundsPill) {
        dom.hofBaraTotalRoundsPill.textContent = `${baraHof.totalRounds} جولة`;
      }
      if (dom.btnHofClearArchive) {
        dom.btnHofClearArchive.textContent = "🗑️ تصفير إحصائيات برا السالفة للمجموعة";
        dom.btnHofClearArchive.disabled = baraHof.totalRounds === 0;
      }

      if (dom.hofBaraRecordsGrid) {
        const br = baraHof.records || {};
        dom.hofBaraRecordsGrid.innerHTML = `
          <div class="hof-record-card">
            <div class="hof-rec-icon">🔍</div>
            <div class="hof-rec-val">${br.topDetective ? `${br.topDetective.rate}%` : "—"}</div>
            <div class="hof-rec-lbl">أفضل محقق</div>
            <div class="hof-rec-sub">${br.topDetective ? `${escapeHtml(br.topDetective.name)} (${br.topDetective.correctVotes} تصويت صائب)` : "لا توجد جولات بعد"}</div>
          </div>
          <div class="hof-record-card">
            <div class="hof-rec-icon">🎭</div>
            <div class="hof-rec-val">${br.topInfiltrator ? `${br.topInfiltrator.rate}%` : "—"}</div>
            <div class="hof-rec-lbl">أخطر متسلّل</div>
            <div class="hof-rec-sub">${br.topInfiltrator ? `${escapeHtml(br.topInfiltrator.name)} (${br.topInfiltrator.correctGuesses} تخمين ناجح)` : "بانتظار المتسللين"}</div>
          </div>
          <div class="hof-record-card">
            <div class="hof-rec-icon">👑</div>
            <div class="hof-rec-val">${br.topScorer ? `${br.topScorer.score} نقطة` : "—"}</div>
            <div class="hof-rec-lbl">أعلى مجموع نقاط</div>
            <div class="hof-rec-sub">${br.topScorer ? `${escapeHtml(br.topScorer.name)} (${br.topScorer.rounds} جولة)` : "أكمل أول جولة"}</div>
          </div>
        `;
      }

      if (dom.hofBaraLeaderboardWrap) {
        if (!baraHof.leaderboard || baraHof.leaderboard.length === 0) {
          dom.hofBaraLeaderboardWrap.innerHTML = `<div class="empty-inline-note">أكمل أول جولة في «برا السالفة» ليظهر جدول المتصدرين وإحصائيات المحققين والمتسللين لمجموعة «${escapeHtml(profile.name)}».</div>`;
        } else {
          dom.hofBaraLeaderboardWrap.innerHTML = `
            <div class="hof-table-scroll">
              <table class="hof-leaderboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>اللاعب</th>
                    <th>الجولات</th>
                    <th>النقاط</th>
                    <th>دقة التصويت</th>
                    <th>تخمين الكلمة</th>
                  </tr>
                </thead>
                <tbody>
                  ${baraHof.leaderboard
                    .slice(0, 20)
                    .map(
                      (row, idx) => `
                    <tr class="${idx === 0 ? "is-rank-1" : ""}">
                      <td><strong>${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}</strong></td>
                      <td><strong>${escapeHtml(row.displayName)}</strong></td>
                      <td>${row.rounds}</td>
                      <td><strong>${row.totalScore}</strong></td>
                      <td>${row.insiderRounds > 0 ? `${row.detectionRate}% (${row.correctVotes}/${row.insiderRounds})` : "—"}</td>
                      <td>${row.outsiderRounds > 0 ? `${row.guessRate}% (${row.correctGuesses}/${row.outsiderRounds})` : "—"}</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `;
        }
      }
      return;
    }

    const hof = archiveStore.computeHallOfFame(profile.id);
    const filtered = archiveStore.getForProfile(profile.id, state.hofModeFilter);

    if (dom.hofProfileSubtitle) {
      dom.hofProfileSubtitle.textContent = `المجموعة النشطة: ${profile.name} • يتم حفظ آخر 50 مباراة تلقائياً لكل مجموعة`;
    }
    if (dom.hofTotalMatchesPill) {
      dom.hofTotalMatchesPill.textContent = `${hof.totalMatches} مباراة`;
    }
    if (dom.btnHofClearArchive) {
      dom.btnHofClearArchive.textContent = "🗑️ تصفير أرشيف المجموعة النشطة";
      dom.btnHofClearArchive.disabled = hof.totalMatches === 0;
    }

    if (dom.hofModeFilters) {
      dom.hofModeFilters.querySelectorAll(".hof-filter-pill").forEach((pill) => {
        pill.classList.toggle("active", pill.dataset.hofMode === state.hofModeFilter);
      });
    }

    // 1) بطاقات الأرقام القياسية الأربع
    if (dom.hofRecordsGrid) {
      const r = hof.records;
      dom.hofRecordsGrid.innerHTML = `
        <div class="hof-record-card">
          <div class="hof-rec-icon">💎</div>
          <div class="hof-rec-val">${r.highestScore ? r.highestScore.score : "—"}</div>
          <div class="hof-rec-lbl">أعلى رصيد في مباراة</div>
          <div class="hof-rec-sub">${r.highestScore ? escapeHtml(r.highestScore.teamName) : "لا توجد مباريات بعد"}</div>
        </div>
        <div class="hof-record-card">
          <div class="hof-rec-icon">🌟</div>
          <div class="hof-rec-val">${r.highestSingleHit ? `+${r.highestSingleHit.points}` : "—"}</div>
          <div class="hof-rec-lbl">أكبر ضربة سؤال كلاسيكي</div>
          <div class="hof-rec-sub">${r.highestSingleHit ? escapeHtml(r.highestSingleHit.category || "مربع ذهبي / 2x") : "مضاعفة أو مربع ذهبي"}</div>
        </div>
        <div class="hof-record-card">
          <div class="hof-rec-icon">👑</div>
          <div class="hof-rec-val">${r.mostWinsTeam ? `${r.mostWinsTeam.wins} فوز` : "—"}</div>
          <div class="hof-rec-lbl">أكثر فريق فوزاً</div>
          <div class="hof-rec-sub">${r.mostWinsTeam ? `${escapeHtml(r.mostWinsTeam.name)} (${r.mostWinsTeam.winRate}%)` : "بانتظار الأبطال"}</div>
        </div>
        <div class="hof-record-card">
          <div class="hof-rec-icon">🔥</div>
          <div class="hof-rec-val">${r.longestWinStreak ? `×${r.longestWinStreak.streak}` : "—"}</div>
          <div class="hof-rec-lbl">أطول سلسلة انتصارات</div>
          <div class="hof-rec-sub">${r.longestWinStreak ? escapeHtml(r.longestWinStreak.name) : "انتصارات متتالية"}</div>
        </div>
      `;
    }

    // 2) جدول المتصدرين التراكمي
    if (dom.hofLeaderboardWrap) {
      if (hof.leaderboard.length === 0) {
        dom.hofLeaderboardWrap.innerHTML = `<div class="empty-inline-note">أكمل أول مباراة ليظهر جدول المتصدرين التراكمي لمجموعة «${escapeHtml(profile.name)}».</div>`;
      } else {
        dom.hofLeaderboardWrap.innerHTML = `
          <div class="hof-table-scroll">
            <table class="hof-leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الفريق</th>
                  <th>المباريات</th>
                  <th>الفوز</th>
                  <th>النسبة</th>
                  <th>مجموع النقاط</th>
                  <th>متوسط النقاط</th>
                </tr>
              </thead>
              <tbody>
                ${hof.leaderboard
                  .slice(0, 15)
                  .map(
                    (row, idx) => `
                  <tr class="${idx === 0 ? "is-rank-1" : ""}">
                    <td><strong>${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}</strong></td>
                    <td><strong>${escapeHtml(row.displayName)}</strong></td>
                    <td>${row.matches}</td>
                    <td>${row.wins}</td>
                    <td>${row.winRate}%</td>
                    <td><strong>${row.totalScore}</strong></td>
                    <td>${row.avgScore}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      }
    }

    // 3) أرشيف المباريات
    if (dom.hofArchiveList) {
      if (filtered.length === 0) {
        dom.hofArchiveList.innerHTML = `<div class="empty-inline-note">لا توجد مباريات محفوظة ضمن هذا التصنيف بعد.</div>`;
        return;
      }
      const modeBadges = {
        classic: `<span class="hof-mode-badge mode-classic">🎯 كلاسيكي</span>`,
        blitz: `<span class="hof-mode-badge mode-blitz">⚡ البرق</span>`,
        charades: `<span class="hof-mode-badge mode-charades">🎭 من غير كلام</span>`
      };

      dom.hofArchiveList.innerHTML = "";
      filtered.forEach((rec) => {
        const card = document.createElement("article");
        card.className = "hof-archive-card";
        const winnerSet = new Set(Array.isArray(rec.winnerNames) ? rec.winnerNames : []);
        const primaryWinner = rec.winnerNames && rec.winnerNames[0] ? rec.winnerNames[0] : "";
        const scoresHtml = rec.teams
          .map(
            (t, i) =>
              `<span class="hof-team-chip team-${(i % 4) + 1}${!rec.isDraw && winnerSet.has(t.name) ? " is-winner" : ""}">${escapeHtml(t.name)}: <strong>${t.score}</strong></span>`
          )
          .join("");
        const outcomeText = rec.isDraw
          ? "🤝 تعادل"
          : primaryWinner
            ? `🏆 الفائز: ${escapeHtml(primaryWinner)}`
            : "🏁 مكتملة";

        card.innerHTML = `
          <div class="hof-archive-top">
            <div class="hof-archive-meta">
              ${modeBadges[rec.mode] || modeBadges.classic}
              <span class="hof-archive-date">${escapeHtml(formatTimestampArabic(rec.playedAt))}</span>
              <span class="hof-archive-winner">${outcomeText}</span>
            </div>
            <div class="hof-archive-actions">
              <button type="button" class="btn btn-gold-outline btn-xxs" data-hof-card="${escapeHtml(rec.matchId)}" title="توليد بطاقة نتيجة PNG لهذه المباراة">
                📸 بطاقة النتيجة
              </button>
              <button type="button" class="btn btn-danger-outline btn-xxs" data-hof-del="${escapeHtml(rec.matchId)}" title="حذف السجل">
                🗑️
              </button>
            </div>
          </div>
          <div class="hof-archive-teams">${scoresHtml}</div>
          <div class="hof-archive-foot">
            <span>📊 الأسئلة: <strong>${rec.totalQuestions}</strong></span>
            ${rec.highestSingleHit > 0 && rec.mode === "classic" ? `<span>🌟 أكبر ضربة: <strong>+${rec.highestSingleHit}</strong></span>` : ""}
            ${rec.topCategory ? `<span>🎯 ${escapeHtml(rec.topCategory)}</span>` : ""}
          </div>
        `;

        const cardBtn = card.querySelector("[data-hof-card]");
        if (cardBtn) {
          cardBtn.addEventListener("click", () => openArchivedMatchResultCard(rec));
        }
        const delBtn = card.querySelector("[data-hof-del]");
        if (delBtn) {
          delBtn.addEventListener("click", () => {
            archiveStore.deleteMatch(rec.matchId);
            renderHallOfFameModal();
            showToast("🗑️ تم حذف سجل المباراة من الأرشيف", "info");
          });
        }
        dom.hofArchiveList.appendChild(card);
      });
    }
  }

  /* =========================================================
     المرحلة الرابعة — الحزمة التاسعة:
     التحكم اللاسلكي عبر QR Code + جرس السرعة + الرهان السري (Firebase RTDB)
     ========================================================= */

  function setWirelessFeedback(kind, msg) {
    if (!dom.wirelessRoomFeedback) return;
    if (!msg) {
      dom.wirelessRoomFeedback.hidden = true;
      dom.wirelessRoomFeedback.textContent = "";
      return;
    }
    dom.wirelessRoomFeedback.hidden = false;
    dom.wirelessRoomFeedback.className = `wireless-feedback-box is-${kind || "info"}`;
    dom.wirelessRoomFeedback.textContent = msg;
  }

  function populateFirebaseSettingsInputs() {
    if (!firebaseCfgStore) return;
    const cfg = firebaseCfgStore.getConfig();
    if (dom.fbApiKey) dom.fbApiKey.value = cfg.apiKey || "";
    if (dom.fbAuthDomain) dom.fbAuthDomain.value = cfg.authDomain || "";
    if (dom.fbDatabaseUrl) dom.fbDatabaseUrl.value = cfg.databaseURL || "";
    if (dom.fbProjectId) dom.fbProjectId.value = cfg.projectId || "";
    if (dom.fbAppId) dom.fbAppId.value = cfg.appId || "";
  }

  function readFirebaseSettingsFromForm() {
    return {
      apiKey: dom.fbApiKey ? dom.fbApiKey.value.trim() : "",
      authDomain: dom.fbAuthDomain ? dom.fbAuthDomain.value.trim() : "",
      databaseURL: dom.fbDatabaseUrl ? dom.fbDatabaseUrl.value.trim() : "",
      projectId: dom.fbProjectId ? dom.fbProjectId.value.trim() : "",
      appId: dom.fbAppId ? dom.fbAppId.value.trim() : ""
    };
  }

  function saveFirebaseSettingsFromForm() {
    if (!firebaseCfgStore) return;
    const res = firebaseCfgStore.saveOverrideConfig(readFirebaseSettingsFromForm());
    if (!res.ok) {
      setWirelessFeedback("error", `❌ ${res.error}`);
      return;
    }
    setWirelessFeedback("success", "✅ تم حفظ إعدادات Firebase محلياً — يمكنك الآن اختبار الاتصال أو إنشاء غرفة لاسلكية.");
    showToast("💾 تم حفظ إعدادات Firebase محلياً", "success");
  }

  async function testFirebaseConnectionFromForm() {
    if (!realtimeSync) return;
    const cfg = readFirebaseSettingsFromForm();
    setWirelessFeedback("info", "⏳ جاري الاتصال بـ Firebase وتسجيل الدخول المجهول...");
    if (dom.btnFbTestConn) dom.btnFbTestConn.disabled = true;
    const res = await realtimeSync.testConnection(cfg);
    if (dom.btnFbTestConn) dom.btnFbTestConn.disabled = false;
    if (res.ok) {
      setWirelessFeedback("success", `✅ ${res.message}`);
      showToast("🔌 تم التحقق من اتصال Firebase بنجاح!", "success");
    } else {
      setWirelessFeedback("error", `❌ ${res.error}`);
    }
  }

  function openWirelessRoomModal() {
    if (!dom.wirelessRoomModal) return;
    populateFirebaseSettingsInputs();
    if (firebaseCfgStore && !firebaseCfgStore.isConfigured() && !state.wireless.active) {
      state.wireless.settingsOpen = true;
    }
    // تنظيف تلقائي صامت للغرف السابقة الخاملة (>24 ساعة) المملوكة لهذا الجهاز فقط
    if (realtimeSync && typeof realtimeSync.cleanupStaleOwnedRooms === "function") {
      realtimeSync.cleanupStaleOwnedRooms({ silent: true }).catch(() => {});
    }
    renderWirelessRoomModal();
    openModal(dom.wirelessRoomModal);
  }

  function closeWirelessRoomModal() {
    closeModal(dom.wirelessRoomModal);
  }

  function renderWirelessDiagnosticsUI(statsOverride = null) {
    const stats =
      statsOverride ||
      (realtimeSync && typeof realtimeSync.getSessionStats === "function"
        ? realtimeSync.getSessionStats()
        : state.wireless.stats);
    state.wireless.stats = stats || state.wireless.stats;
    if (dom.wirelessDiagnosticsBar) {
      dom.wirelessDiagnosticsBar.hidden = !state.wireless.active;
    }
    if (!state.wireless.active || !stats) return;
    if (dom.wirelessDiagKb) dom.wirelessDiagKb.textContent = `${Number(stats.kbSent || 0).toFixed(2)} KB`;
    if (dom.wirelessDiagWrites) dom.wirelessDiagWrites.textContent = String(stats.writes || 0);
    if (dom.wirelessDiagSkipped) dom.wirelessDiagSkipped.textContent = String(stats.skippedWrites || 0);
  }

  function renderWirelessRoomModal() {
    const wl = state.wireless;

    if (dom.wirelessSettingsPanel) {
      dom.wirelessSettingsPanel.hidden = !wl.settingsOpen;
    }
    if (dom.btnToggleWirelessSettings) {
      dom.btnToggleWirelessSettings.setAttribute("aria-expanded", String(Boolean(wl.settingsOpen)));
    }

    if (dom.wirelessConnBadge) {
      if (!wl.active) {
        dom.wirelessConnBadge.className = "dual-status-pill is-single";
        dom.wirelessConnBadge.textContent = "⚪ الوضع المحلي (الغرفة غير مفعّلة)";
      } else if (wl.connected) {
        dom.wirelessConnBadge.className = "dual-status-pill is-connected";
        dom.wirelessConnBadge.textContent = "🟢 الغرفة اللاسلكية متصلة";
      } else {
        dom.wirelessConnBadge.className = "dual-status-pill is-single";
        dom.wirelessConnBadge.textContent = "🟡 جاري إعادة الاتصال بـ Firebase...";
      }
    }

    if (dom.btnOpenWirelessGameLabel) {
      dom.btnOpenWirelessGameLabel.textContent = wl.active ? `📡 ${wl.roomCode}` : "لاسلكي";
    }
    if (dom.btnOpenWirelessGame) {
      dom.btnOpenWirelessGame.classList.toggle("is-live", wl.active);
    }

    if (dom.wirelessRoomCodePill) dom.wirelessRoomCodePill.hidden = !wl.active;
    if (dom.wirelessRoomCodeText) dom.wirelessRoomCodeText.textContent = wl.roomCode || "------";
    if (dom.btnCreateWirelessRoom) dom.btnCreateWirelessRoom.hidden = wl.active;
    if (dom.btnCloseWirelessRoom) dom.btnCloseWirelessRoom.hidden = !wl.active;
    if (dom.wirelessQrGrid) dom.wirelessQrGrid.hidden = !wl.active;
    if (dom.wirelessBuzzerPanel) dom.wirelessBuzzerPanel.hidden = !wl.active;
    if (dom.wirelessDevicesPanel) dom.wirelessDevicesPanel.hidden = !wl.active;

    renderWirelessDiagnosticsUI();

    if (wl.active) {
      if (dom.wirelessHostQrBox && dom.wirelessHostQrMasked) {
        dom.wirelessHostQrBox.hidden = wl.hostQrHidden;
        dom.wirelessHostQrMasked.hidden = !wl.hostQrHidden;
        if (!wl.hostQrHidden && qrGenerator && wl.remoteUrl && dom.wirelessHostQrBox.dataset.qrUrl !== wl.remoteUrl) {
          dom.wirelessHostQrBox.dataset.qrUrl = wl.remoteUrl;
          dom.wirelessHostQrBox.innerHTML = qrGenerator.toSVG(wl.remoteUrl, {
            size: 196,
            margin: 3,
            ariaLabel: "رمز QR السري لريموت المقدّم"
          });
        }
      }
      if (dom.btnToggleHostQrPrivacy) {
        dom.btnToggleHostQrPrivacy.textContent = wl.hostQrHidden ? "👁️ إظهار QR المقدّم" : "🙈 إخفاء QR المقدّم";
      }
      if (dom.linkOpenRemoteTab) dom.linkOpenRemoteTab.href = wl.remoteUrl || "#";

      if (dom.wirelessPlayerQrBox && qrGenerator && wl.playerUrl && dom.wirelessPlayerQrBox.dataset.qrUrl !== wl.playerUrl) {
        dom.wirelessPlayerQrBox.dataset.qrUrl = wl.playerUrl;
        dom.wirelessPlayerQrBox.innerHTML = qrGenerator.toSVG(wl.playerUrl, {
          size: 196,
          margin: 3,
          ariaLabel: `رمز QR لانضمام الفرق للغرفة ${wl.roomCode}`
        });
      }
      if (dom.wirelessPlayerCodeBig) dom.wirelessPlayerCodeBig.textContent = wl.roomCode || "------";
      if (dom.linkOpenPlayerTab) dom.linkOpenPlayerTab.href = wl.playerUrl || "#";
      if (dom.btnToggleTvQr) {
        dom.btnToggleTvQr.textContent = wl.showQrOnTv ? "🙈 إخفاء QR من التلفزيون" : "📺 إظهار QR على التلفزيون";
      }

      renderWirelessConnectedTeamsUI();
      renderWirelessDevicesPanel();
    }

    renderWirelessBuzzerBars();
  }

  function getActiveWirelessTeamsForDisplay() {
    if (state.teams && state.teams.length >= 2) return state.teams;
    const names = getSetupTeamNames();
    return names.map((name, idx) => ({ id: `team-${idx}`, name }));
  }

  function renderWirelessConnectedTeamsUI() {
    if (!dom.wirelessConnectedTeams) return;
    const counts = {};
    Object.values(state.wireless.playersMap || {}).forEach((p) => {
      if (p && Number.isInteger(Number(p.teamIdx))) {
        const idx = Number(p.teamIdx);
        counts[idx] = (counts[idx] || 0) + 1;
      }
    });
    const teams = getActiveWirelessTeamsForDisplay();
    dom.wirelessConnectedTeams.innerHTML = teams
      .map((t, idx) => {
        const c = counts[idx] || 0;
        const dupWarn = c > 1 ? ` <span class="wireless-dup-badge" title="أكثر من جهاز متصل بنفس الفريق">⚠️</span>` : "";
        return `<span class="wireless-team-count-chip team-${idx + 1}${c > 1 ? " has-dup" : ""}"><span class="team-badge-dot team-${idx + 1}-dot"></span>${escapeHtml(t.name)}: <strong>${c} 📱</strong>${dupWarn}</span>`;
      })
      .join("");
  }

  function renderWirelessDevicesPanel() {
    const wl = state.wireless;
    if (dom.btnWirelessToggleLock) {
      dom.btnWirelessToggleLock.className = wl.joinLocked
        ? "btn btn-amber btn-sm"
        : "btn btn-secondary btn-sm";
      dom.btnWirelessToggleLock.textContent = wl.joinLocked
        ? "🔒 الانضمام مقفل — اضغط للفتح"
        : "🔓 قفل الانضمام للغرفة";
    }
    if (dom.btnWirelessToggleCap) {
      dom.btnWirelessToggleCap.className =
        wl.maxDevicesPerTeam === 1 ? "btn btn-primary btn-sm" : "btn btn-gold-outline btn-sm";
      dom.btnWirelessToggleCap.textContent =
        wl.maxDevicesPerTeam === 1
          ? "👤 حد الأجهزة: جهاز واحد لكل فريق"
          : "👥 حد الأجهزة لكل فريق: غير محدود";
    }

    const entries = Object.entries(wl.playersMap || {})
      .map(([devId, info]) => ({
        deviceId: (info && info.deviceId) || devId,
        teamIdx: Number.isInteger(Number(info && info.teamIdx)) ? Number(info.teamIdx) : 0,
        label: (info && info.label) || "جهاز متصل",
        teamName: (info && info.teamName) || ""
      }))
      .filter((d) => Boolean(d.deviceId));

    if (dom.wirelessDevicesCountPill) {
      dom.wirelessDevicesCountPill.textContent = `${entries.length} جهاز متصل`;
    }
    if (!dom.wirelessDevicesList) return;

    const teams = getActiveWirelessTeamsForDisplay();
    const grouped = teams.map((t, idx) => ({
      idx,
      name: t.name,
      devices: entries.filter((d) => d.teamIdx === idx)
    }));

    dom.wirelessDevicesList.innerHTML = grouped
      .map((g) => {
        const hasDup = g.devices.length > 1;
        const rowsHtml =
          g.devices.length === 0
            ? `<div class="wireless-device-empty">لا توجد أجهزة متصلة بهذا الفريق حالياً</div>`
            : g.devices
                .map(
                  (d) => `
                <div class="wireless-device-row">
                  <div class="wireless-device-meta">
                    <span class="wireless-device-online-dot" aria-hidden="true"></span>
                    <strong class="wireless-device-label">${escapeHtml(d.label)}</strong>
                    <span class="wireless-device-id">${escapeHtml(d.deviceId.slice(-6))}</span>
                  </div>
                  <button
                    type="button"
                    class="btn btn-danger-outline btn-xxs"
                    data-kick-device="${escapeHtml(d.deviceId)}"
                    title="طرد هذا الجهاز من الغرفة"
                  >
                    🚫 طرد
                  </button>
                </div>
              `
                )
                .join("");

        return `
          <div class="wireless-device-team-group team-${g.idx + 1}${hasDup ? " has-dup" : ""}">
            <div class="wireless-device-team-head">
              <div class="wireless-device-team-title">
                <span class="team-badge-dot team-${g.idx + 1}-dot"></span>
                <strong>${escapeHtml(g.name)}</strong>
                <span class="wireless-device-count-badge">${g.devices.length} 📱</span>
              </div>
              ${hasDup ? `<span class="wireless-dup-warning">⚠️ أكثر من جهاز بنفس الفريق</span>` : ""}
            </div>
            <div class="wireless-device-team-rows">${rowsHtml}</div>
          </div>
        `;
      })
      .join("");

    dom.wirelessDevicesList.querySelectorAll("[data-kick-device]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const devId = btn.dataset.kickDevice;
        if (devId) kickWirelessDevice(devId);
      });
    });
  }

  async function toggleWirelessJoinLock() {
    if (!state.wireless.active || !realtimeSync) return;
    state.wireless.joinLocked = !state.wireless.joinLocked;
    await realtimeSync.updateRoomControl({ joinLocked: state.wireless.joinLocked });
    renderWirelessDevicesPanel();
    broadcastLiveDisplayState();
    showToast(
      state.wireless.joinLocked
        ? "🔒 تم قفل الانضمام للغرفة (الأجهزة المسجّلة مسبقاً تستمر بالعمل)"
        : "🔓 تم فتح الانضمام للغرفة للأجهزة الجديدة",
      "info"
    );
  }

  async function toggleWirelessMaxDevicesPerTeam(explicitVal = null) {
    if (!state.wireless.active || !realtimeSync) return;
    const nextVal =
      explicitVal === 0 || explicitVal === 1
        ? explicitVal
        : state.wireless.maxDevicesPerTeam === 1
          ? 0
          : 1;
    state.wireless.maxDevicesPerTeam = nextVal;
    await realtimeSync.updateRoomControl({ maxDevicesPerTeam: nextVal });
    renderWirelessDevicesPanel();
    broadcastLiveDisplayState();
    showToast(
      nextVal === 1
        ? "👤 تم تفعيل حد جهاز واحد فقط لكل فريق"
        : "👥 تم إلغاء حد الأجهزة (غير محدود لكل فريق)",
      "info"
    );
  }

  async function kickWirelessDevice(deviceId) {
    if (!state.wireless.active || !realtimeSync || !deviceId) return;
    const info = state.wireless.playersMap && state.wireless.playersMap[deviceId];
    const label = (info && info.label) || "الجهاز";
    const res = await realtimeSync.kickPlayer(deviceId);
    if (res && res.ok) {
      if (state.wireless.playersMap && state.wireless.playersMap[deviceId]) {
        delete state.wireless.playersMap[deviceId];
      }
      renderWirelessConnectedTeamsUI();
      renderWirelessDevicesPanel();
      showToast(`🚫 تم طرد «${label}» من الغرفة فوراً`, "warning");
    } else {
      showToast((res && res.error) || "تعذّر طرد الجهاز", "warning");
    }
  }

  function canUseAllPlayForCurrentQuestion() {
    return Boolean(
      state.currentQ &&
        !state.currentQ.isCharades &&
        !state.currentQ.isDailyDouble &&
        !state.currentQ.revealed
    );
  }

  function resetAllPlayState(clearRemote = false) {
    const prevQId = state.wireless.allPlay && state.wireless.allPlay.questionId;
    state.wireless.allPlay = {
      active: false,
      phase: "idle",
      questionId: "",
      answers: {},
      judgments: {}
    };
    if (clearRemote && realtimeSync && prevQId && typeof realtimeSync.clearAllPlayAnswers === "function") {
      realtimeSync.clearAllPlayAnswers(prevQId);
    }
    renderAllPlayHostPanel();
  }

  function buildPublicAllPlayPayload() {
    const ap = state.wireless.allPlay;
    if (!ap || !ap.active) return null;
    const submittedTeamIndices = [];
    Object.keys(ap.answers || {}).forEach((k) => {
      const idx = Number(k);
      const entry = ap.answers[k];
      if (Number.isInteger(idx) && entry && String(entry.text || "").trim()) {
        submittedTeamIndices.push(idx);
      }
    });
    const payload = {
      active: true,
      phase: ap.phase === "revealed" ? "revealed" : "open",
      questionId: ap.questionId || "",
      submittedTeamIndices
    };
    if (ap.phase === "revealed") {
      payload.revealedAnswers = state.teams.map((t, idx) => {
        const ans = ap.answers[idx];
        const j = ap.judgments[idx];
        return {
          teamIdx: idx,
          teamName: t.name,
          text: ans && ans.text ? String(ans.text) : "",
          correct: j === true ? true : j === false ? false : null
        };
      });
    }
    return payload;
  }

  function openAllPlayForCurrentQuestion() {
    if (!state.currentQ) return;
    if (state.currentQ.isCharades) {
      showToast("وضع «الكل يجاوب» غير متاح لأسئلة التمثيل «من غير كلام»", "warning");
      return;
    }
    if (state.currentQ.isDailyDouble) {
      showToast("وضع «الكل يجاوب» غير متاح للمربعات الذهبية المخفية", "warning");
      return;
    }
    const qId = String(state.currentQ.question.id || `q_${Date.now()}`);
    state.wireless.allPlay = {
      active: true,
      phase: "open",
      questionId: qId,
      answers: {},
      judgments: {}
    };
    if (realtimeSync && state.wireless.active && typeof realtimeSync.clearAllPlayAnswers === "function") {
      realtimeSync.clearAllPlayAnswers(qId);
    }
    if (!state.timerRunning) {
      if (state.timerMode === "unlimited" || state.timerRemaining <= 0) {
        state.timerMax = 45;
        state.timerRemaining = 45;
        state.timerMode = "main";
      }
      startTimerInterval();
    }
    renderAllPlayHostPanel();
    broadcastLiveDisplayState();
    showToast("📝 تم فتح وضع «الكل يجاوب» — الفرق تكتب إجاباتها الآن!", "success");
  }

  function handleIncomingAllPlayAnswers(allMap) {
    const ap = state.wireless.allPlay;
    if (!ap || !ap.active || !ap.questionId || !allMap || typeof allMap !== "object") return;
    const cleanKey = String(ap.questionId).replace(/[.#$\[\]\/]/g, "_");
    const qBucket = allMap[cleanKey] || allMap[ap.questionId];
    if (!qBucket || typeof qBucket !== "object") return;

    let changed = false;
    Object.values(qBucket).forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const idx = Number(entry.teamIdx);
      const txt = typeof entry.text === "string" ? entry.text.trim().slice(0, 140) : "";
      if (!Number.isInteger(idx) || idx < 0 || idx >= state.teams.length || !txt) return;
      const prev = ap.answers[idx];
      if (!prev || prev.text !== txt || prev.submittedAt !== entry.submittedAt) {
        ap.answers[idx] = {
          teamIdx: idx,
          text: txt,
          submittedAt: entry.submittedAt || Date.now(),
          manual: false
        };
        changed = true;
      }
    });

    if (changed) {
      renderAllPlayHostPanel();
      broadcastLiveDisplayState();
    }
  }

  function revealAllPlayAnswers() {
    const ap = state.wireless.allPlay;
    if (!ap || !ap.active) return;
    stopTimerInterval();
    state.timerRunning = false;
    ap.phase = "revealed";
    state.teams.forEach((_t, idx) => {
      if (ap.judgments[idx] === undefined) ap.judgments[idx] = null;
    });
    if (state.currentQ && !state.currentQ.revealed) {
      revealAnswer(false);
    }
    renderAllPlayHostPanel();
    broadcastLiveDisplayState();
  }

  function setAllPlayJudgment(teamIdx, isCorrect) {
    const ap = state.wireless.allPlay;
    if (!ap || !ap.active || ap.phase !== "revealed") return;
    const idx = Number(teamIdx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.teams.length) return;
    ap.judgments[idx] = Boolean(isCorrect);
    renderAllPlayHostPanel();
    broadcastLiveDisplayState();
  }

  function setManualAllPlayAnswer(teamIdx, text) {
    const ap = state.wireless.allPlay;
    if (!ap || !ap.active) return;
    const idx = Number(teamIdx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.teams.length) return;
    const clean = String(text || "").trim().slice(0, 140);
    if (clean) {
      ap.answers[idx] = { teamIdx: idx, text: clean, submittedAt: Date.now(), manual: true };
    } else {
      delete ap.answers[idx];
    }
    broadcastLiveDisplayState();
  }

  function commitAllPlayAwards() {
    const ap = state.wireless.allPlay;
    const cq = state.currentQ;
    if (!ap || !ap.active || !cq) return;

    const ownerIdx = cq.activeTeamAtOpen;
    const ownerPts = computeEffectiveQuestionPoints(cq); // يشمل 2x لصاحب الدور فقط
    const otherPts = computeDiscountedBasePoints(cq); // بدون 2x لبقية الفرق
    const awards = [];
    const awardedNames = [];

    state.teams.forEach((team, idx) => {
      if (ap.judgments[idx] === true) {
        const pts = idx === ownerIdx ? ownerPts : otherPts;
        awards.push({ teamIdx: idx, points: pts });
        awardedNames.push(`${team.name} (+${pts})`);
      }
    });

    const label =
      awardedNames.length > 0
        ? `الكل يجاوب: ${awardedNames.join("، ")}`
        : "الكل يجاوب: بدون نقاط";

    if (realtimeSync && state.wireless.active && ap.questionId && typeof realtimeSync.clearAllPlayAnswers === "function") {
      realtimeSync.clearAllPlayAnswers(ap.questionId);
    }

    commitQuestionResolution({
      multiAwards: awards,
      actionType: "all-play",
      undoLabel: label,
      showBriefAnswerPreview: false
    });

    if (window.SeenJeemAudio) {
      if (awards.length > 0) window.SeenJeemAudio.playCorrect();
      else window.SeenJeemAudio.playWrong();
    }
    showToast(
      awards.length > 0 ? `✔️ تم اعتماد نقاط الكل يجاوب: ${awardedNames.join(" • ")}` : "تم إغلاق سؤال «الكل يجاوب» دون نقاط",
      awards.length > 0 ? "success" : "info"
    );
  }

  function renderAllPlayHostPanel() {
    if (!dom.allPlayHostPanel) return;
    const ap = state.wireless.allPlay;
    if (!ap || !ap.active || !state.currentQ) {
      dom.allPlayHostPanel.hidden = true;
      dom.allPlayHostPanel.innerHTML = "";
      return;
    }

    dom.allPlayHostPanel.hidden = false;
    const cq = state.currentQ;
    const ownerPts = computeEffectiveQuestionPoints(cq);
    const otherPts = computeDiscountedBasePoints(cq);
    const subCount = state.teams.filter((_t, i) => ap.answers[i] && ap.answers[i].text).length;

    if (ap.phase === "open") {
      dom.allPlayHostPanel.innerHTML = `
        <div class="allplay-panel-head">
          <strong>📝 وضع «الكل يجاوب» مفتوح (${subCount} / ${state.teams.length} أرسلوا)</strong>
          <div class="allplay-head-actions">
            <button type="button" id="btn-allplay-reveal" class="btn btn-amber btn-xs">🔒 إغلاق وكشف الإجابات</button>
            <button type="button" id="btn-allplay-cancel" class="btn btn-ghost btn-xxs">إلغاء</button>
          </div>
        </div>
        <div class="allplay-teams-list">
          ${state.teams
            .map((team, idx) => {
              const ans = ap.answers[idx];
              return `
                <div class="allplay-team-row team-${idx + 1}">
                  <div class="allplay-team-info">
                    <strong>${escapeHtml(team.name)}</strong>
                    <span class="allplay-status-pill ${ans ? "is-sent" : ""}">${ans ? "✅ تم الاستلام" : "⏳ بانتظار الإجابة"}</span>
                  </div>
                  <input
                    type="text"
                    class="text-input allplay-manual-input"
                    data-ap-manual-idx="${idx}"
                    value="${escapeHtml(ans ? ans.text : "")}"
                    placeholder="إدخال يدوي (للفريق بدون هاتف)..."
                    maxlength="140"
                    autocomplete="off"
                  />
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    } else {
      dom.allPlayHostPanel.innerHTML = `
        <div class="allplay-panel-head">
          <strong>📋 تقييم إجابات «الكل يجاوب» (اختر الفرق الصحيحة ثم اعتمد النقاط)</strong>
          <button type="button" id="btn-allplay-commit" class="btn btn-steal-win btn-xs">✔️ اعتماد النقاط</button>
        </div>
        <div class="allplay-teams-list">
          ${state.teams
            .map((team, idx) => {
              const ans = ap.answers[idx];
              const j = ap.judgments[idx];
              const pts = idx === cq.activeTeamAtOpen ? ownerPts : otherPts;
              return `
                <div class="allplay-team-row is-revealed team-${idx + 1}${j === true ? " is-ok" : j === false ? " is-bad" : ""}">
                  <div class="allplay-team-info">
                    <strong>${escapeHtml(team.name)} <small>(+${pts}${idx === cq.activeTeamAtOpen && cq.doubleActive ? " ⚡2x" : ""})</small></strong>
                    <input
                      type="text"
                      class="text-input allplay-manual-input"
                      data-ap-manual-idx="${idx}"
                      value="${escapeHtml(ans ? ans.text : "")}"
                      placeholder="— لم تُرسل إجابة (يمكن كتابتها يدوياً) —"
                      maxlength="140"
                      autocomplete="off"
                    />
                  </div>
                  <div class="allplay-judge-btns">
                    <button type="button" class="btn btn-xs ${j === true ? "btn-steal-win" : "btn-secondary"}" data-ap-judge-idx="${idx}" data-ap-judge-val="1">✅ صح</button>
                    <button type="button" class="btn btn-xs ${j === false ? "btn-danger-outline active" : "btn-ghost"}" data-ap-judge-idx="${idx}" data-ap-judge-val="0">❌ خطأ</button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }

    const btnRev = dom.allPlayHostPanel.querySelector("#btn-allplay-reveal");
    if (btnRev) btnRev.addEventListener("click", revealAllPlayAnswers);
    const btnCancel = dom.allPlayHostPanel.querySelector("#btn-allplay-cancel");
    if (btnCancel) {
      btnCancel.addEventListener("click", () => {
        resetAllPlayState(true);
        broadcastLiveDisplayState();
      });
    }
    const btnCommit = dom.allPlayHostPanel.querySelector("#btn-allplay-commit");
    if (btnCommit) btnCommit.addEventListener("click", commitAllPlayAwards);

    dom.allPlayHostPanel.querySelectorAll("[data-ap-manual-idx]").forEach((inp) => {
      inp.addEventListener("change", () => {
        setManualAllPlayAnswer(Number(inp.dataset.apManualIdx), inp.value);
      });
    });
    dom.allPlayHostPanel.querySelectorAll("[data-ap-judge-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setAllPlayJudgment(Number(btn.dataset.apJudgeIdx), btn.dataset.apJudgeVal === "1");
      });
    });
  }

  function renderWirelessBuzzerBars() {
    const wl = state.wireless;
    const bz = wl.buzzer;

    if (dom.wirelessBuzzerHostBar) {
      dom.wirelessBuzzerHostBar.hidden = !wl.active;
    }
    if (dom.btnAllPlayOpen) {
      dom.btnAllPlayOpen.hidden = !canUseAllPlayForCurrentQuestion();
    }

    let summaryText = "🔒 مقفل";
    if (bz.state === "open") {
      summaryText = "🔔 مفتوح الآن للفرق — بانتظار أسرع ضغطة!";
    } else if (bz.state === "buzzed" && bz.winnerTeamName) {
      const deltaTxt =
        bz.runnerUpDeltaMs !== null && bz.runnerUpDeltaMs !== undefined
          ? ` (+${bz.runnerUpDeltaMs}ms عن الثاني)`
          : "";
      summaryText = `🏆 الأسرع: ${bz.winnerTeamName}${deltaTxt}`;
    }

    if (dom.wbStatusText) dom.wbStatusText.textContent = summaryText;
    if (dom.wirelessBuzzerStatePill) {
      dom.wirelessBuzzerStatePill.textContent =
        bz.state === "open" ? "🔔 مفتوح" : bz.state === "buzzed" ? `🏆 ${bz.winnerTeamName}` : "🔒 مقفل";
    }
    if (dom.wirelessBuzzerResultBox) {
      dom.wirelessBuzzerResultBox.textContent = summaryText;
    }
  }

  function buildWirelessHostPrivatePayload() {
    const priv = {
      dailyDoubleKeys: [],
      questionText: null,
      answerText: null,
      hintText: null,
      explanationText: null,
      blitzAnswer: null,
      csoloWord: null,
      csoloExp: null,
      finalAnswer: null,
      receivedWagers: state.wireless.receivedWagers || {},
      allPlayAnswers: state.wireless.allPlay && state.wireless.allPlay.active ? state.wireless.allPlay.answers : {},
      allPlayJudgments: state.wireless.allPlay && state.wireless.allPlay.active ? state.wireless.allPlay.judgments : {}
    };

    if (Array.isArray(state.boardCategories)) {
      state.boardCategories.forEach((bc, catIdx) => {
        ["rightColumn", "leftColumn"].forEach((colKey) => {
          (bc[colKey] || []).forEach((slot, slotIdx) => {
            if (slot && slot.isDailyDouble && !slot.played) {
              priv.dailyDoubleKeys.push(`${catIdx}:${colKey}:${slotIdx}`);
            }
          });
        });
      });
    }

    if (state.currentQ && state.currentQ.question) {
      const q = state.currentQ.question;
      priv.questionText = q.question || "";
      priv.answerText = q.answer || "";
      priv.hintText = q.hint || "";
      priv.explanationText = q.explanation || "";
    }

    if (state.blitz && state.blitz.currentQuestion) {
      priv.blitzAnswer = state.blitz.currentQuestion.answer || "";
    }

    if (state.charadesSolo && state.charadesSolo.currentCard) {
      priv.csoloWord = state.charadesSolo.currentCard.answer || "";
      priv.csoloExp = state.charadesSolo.currentCard.explanation || "";
    }

    if (state.finalRound && state.finalRound.question) {
      priv.finalAnswer = state.finalRound.question.answer || "";
    }

    if (
      window.SeenJeemAudioChallengeMode &&
      typeof window.SeenJeemAudioChallengeMode.isOpen === "function" &&
      window.SeenJeemAudioChallengeMode.isOpen() &&
      typeof window.SeenJeemAudioChallengeMode.buildHostPrivatePayload === "function"
    ) {
      priv.audioChallenge = window.SeenJeemAudioChallengeMode.buildHostPrivatePayload();
    }

    return priv;
  }

  function publishWirelessSnapshot(rawSnapshot) {
    if (!state.wireless.active || !realtimeSync || !realtimeSync.isActive()) return;
    // تطبيق تنقية Anti-Spoiler الصارمة قبل الإرسال إلى Firebase RTDB
    const cleanPublic =
      liveSync && typeof liveSync.enforceAntiSpoiler === "function"
        ? liveSync.enforceAntiSpoiler(rawSnapshot)
        : rawSnapshot;
    cleanPublic.buzzer = { ...state.wireless.buzzer };
    const hostPrivate = buildWirelessHostPrivatePayload();
    realtimeSync.publishStates(cleanPublic, hostPrivate);
  }

  async function createWirelessRoom() {
    if (!realtimeSync) return;
    if (!firebaseCfgStore || !firebaseCfgStore.isConfigured()) {
      state.wireless.settingsOpen = true;
      renderWirelessRoomModal();
      setWirelessFeedback("warning", "⚠️ يرجى إدخال وحفظ إعدادات Firebase أولاً قبل إنشاء الغرفة اللاسلكية.");
      return;
    }

    setWirelessFeedback("info", "⏳ جاري إنشاء الغرفة اللاسلكية وتوليد رموز QR المحلية...");
    if (dom.btnCreateWirelessRoom) dom.btnCreateWirelessRoom.disabled = true;

    try {
      const info = await realtimeSync.createRoom({
        onCommand: (cmd) => handleRemoteHostCommand(cmd),
        onBuzzes: (allBuzzes) => handleIncomingBuzzes(allBuzzes),
        onWagers: (allWagers) => handleIncomingWagers(allWagers),
        onPlayers: (playersMap) => handleIncomingPlayers(playersMap),
        onAllPlayAnswers: (allMap) => handleIncomingAllPlayAnswers(allMap),
        onConnectionState: (isConn) => {
          state.wireless.connected = isConn;
          renderWirelessRoomModal();
        },
        onStatsUpdate: (stats) => {
          renderWirelessDiagnosticsUI(stats);
        }
      });

      state.wireless.active = true;
      state.wireless.connected = true;
      state.wireless.roomCode = info.roomCode;
      state.wireless.hostToken = info.hostToken;
      state.wireless.remoteUrl = info.remoteUrl;
      state.wireless.playerUrl = info.playerUrl;
      state.wireless.hostQrHidden = false;
      state.wireless.settingsOpen = false;
      state.wireless.joinLocked = false;
      state.wireless.maxDevicesPerTeam = 0;
      state.wireless.stats = realtimeSync.getSessionStats();
      state.wireless.buzzer = {
        state: "locked",
        roundId: "",
        winnerTeamIdx: null,
        winnerTeamName: "",
        runnerUpDeltaMs: null
      };

      setWirelessFeedback("success", `✅ تم إنشاء الغرفة ${info.roomCode} بنجاح — امسح QR المقدّم بهاتفك ثم أخفه قبل عرض الشاشة للاعبين.`);
      renderWirelessRoomModal();
      broadcastLiveDisplayState();
      showToast(`📡 الغرفة اللاسلكية ${info.roomCode} جاهزة الآن!`, "success");
    } catch (err) {
      setWirelessFeedback("error", `❌ ${(err && err.message) || "تعذّر إنشاء الغرفة اللاسلكية."}`);
    } finally {
      if (dom.btnCreateWirelessRoom) dom.btnCreateWirelessRoom.disabled = false;
    }
  }

  async function closeWirelessRoom() {
    if (!realtimeSync) return;
    await realtimeSync.closeRoom();
    state.wireless.active = false;
    state.wireless.connected = false;
    state.wireless.roomCode = "";
    state.wireless.hostToken = "";
    state.wireless.remoteUrl = "";
    state.wireless.playerUrl = "";
    state.wireless.showQrOnTv = false;
    state.wireless.joinLocked = false;
    state.wireless.maxDevicesPerTeam = 0;
    state.wireless.stats = { writes: 0, skippedWrites: 0, bytesSent: 0, kbSent: 0, mediaUploads: 0 };
    state.wireless.playersMap = {};
    state.wireless.receivedWagers = {};
    state.wireless.buzzer = {
      state: "locked",
      roundId: "",
      winnerTeamIdx: null,
      winnerTeamName: "",
      runnerUpDeltaMs: null
    };
    setWirelessFeedback("info", "تم إغلاق الغرفة اللاسلكية وحذف بياناتها من Firebase والسجل المحلي بنجاح.");
    renderWirelessRoomModal();
    broadcastLiveDisplayState();
    showToast("🔴 تم إغلاق وحذف الغرفة اللاسلكية", "info");
  }

  function openSpeedBuzzer() {
    if (!state.wireless.active) return;
    const roundId = `bz_${Date.now().toString(36)}`;
    state.wireless.buzzer = {
      state: "open",
      roundId,
      winnerTeamIdx: null,
      winnerTeamName: "",
      runnerUpDeltaMs: null
    };
    if (realtimeSync) realtimeSync.clearBuzzRound(roundId);
    renderWirelessBuzzerBars();
    broadcastLiveDisplayState();
    showToast("🔔 تم فتح جرس السرعة لجميع الفرق!", "info");
  }

  function lockSpeedBuzzer() {
    if (!state.wireless.active) return;
    state.wireless.buzzer.state = "locked";
    renderWirelessBuzzerBars();
    broadcastLiveDisplayState();
  }

  function resetSpeedBuzzer() {
    if (!state.wireless.active) return;
    const prevRound = state.wireless.buzzer.roundId;
    state.wireless.buzzer = {
      state: "locked",
      roundId: "",
      winnerTeamIdx: null,
      winnerTeamName: "",
      runnerUpDeltaMs: null
    };
    if (realtimeSync && prevRound) realtimeSync.clearBuzzRound(prevRound);
    renderWirelessBuzzerBars();
    broadcastLiveDisplayState();
  }

  function handleIncomingBuzzes(allBuzzes) {
    if (!state.wireless.active) return;
    const bz = state.wireless.buzzer;
    if (!bz.roundId || (bz.state !== "open" && bz.state !== "buzzed")) return;

    const roundEntries = allBuzzes && allBuzzes[bz.roundId];
    if (!roundEntries || typeof roundEntries !== "object") return;

    const sorted = Object.values(roundEntries)
      .filter((e) => e && typeof e.ts === "number")
      .sort((a, b) => a.ts - b.ts);

    if (sorted.length === 0) return;

    const first = sorted[0];
    const second = sorted[1] || null;
    const deltaMs = second ? Math.max(0, Math.round(second.ts - first.ts)) : null;
    const wasOpen = bz.state === "open";

    state.wireless.buzzer = {
      state: "buzzed",
      roundId: bz.roundId,
      winnerTeamIdx: Number(first.teamIdx),
      winnerTeamName: first.teamName || (state.teams[first.teamIdx] && state.teams[first.teamIdx].name) || "فريق",
      runnerUpDeltaMs: deltaMs
    };

    if (wasOpen) {
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playBuzzerWin === "function") {
        window.SeenJeemAudio.playBuzzerWin();
      }
      if (
        window.SeenJeemAudioChallengeMode &&
        typeof window.SeenJeemAudioChallengeMode.isOpen === "function" &&
        window.SeenJeemAudioChallengeMode.isOpen() &&
        typeof window.SeenJeemAudioChallengeMode.onWirelessBuzz === "function"
      ) {
        window.SeenJeemAudioChallengeMode.onWirelessBuzz(state.wireless.buzzer);
      }
      showToast(`🔔 الأسرع بالجرس: ${state.wireless.buzzer.winnerTeamName}!`, "success");
    }

    renderWirelessBuzzerBars();
    broadcastLiveDisplayState();
  }

  function handleIncomingWagers(allWagers) {
    if (!state.wireless.active || !state.finalRound) return;
    const fr = state.finalRound;
    const roundKey = `r${fr.roundNumber || 1}`;
    const roundWagers = (allWagers && allWagers[roundKey]) || {};
    state.wireless.receivedWagers = roundWagers;

    let changed = false;
    Object.keys(roundWagers).forEach((teamKey) => {
      const entry = roundWagers[teamKey];
      if (!entry || !Number.isInteger(Number(entry.teamIdx))) return;
      const idx = Number(entry.teamIdx);
      if (fr.wagers && fr.wagers[idx]) {
        const clamped = Math.max(0, Math.min(fr.wagers[idx].maxWager, Math.round(Number(entry.amount) || 0)));
        if (fr.phase === "wager") {
          if (fr.wagers[idx].amount !== clamped || fr.wagers[idx].locked !== Boolean(entry.locked)) {
            fr.wagers[idx].amount = clamped;
            fr.wagers[idx].locked = Boolean(entry.locked);
            changed = true;
          }
        }
      }
    });

    if (changed) {
      renderFinalRoundModal();
      persistActiveMatch();
    } else {
      broadcastLiveDisplayState();
    }
  }

  function handleIncomingPlayers(playersMap) {
    const cleanMap = playersMap && typeof playersMap === "object" ? playersMap : {};
    state.wireless.playersMap = cleanMap;
    // اعتماد الأجهزة المنضمة أثناء فتح الغرفة كي تستمر بسلاسة بعد تفعيل القفل وعند تحديث الصفحة
    if (!state.wireless.joinLocked && realtimeSync && typeof realtimeSync.approveDevice === "function") {
      Object.keys(cleanMap).forEach((devId) => {
        if (devId) realtimeSync.approveDevice(devId);
      });
    }
    renderWirelessConnectedTeamsUI();
    renderWirelessDevicesPanel();
  }

  function handleRemoteHostCommand(cmd) {
    if (!cmd || typeof cmd.type !== "string") return;
    const p = cmd.payload && typeof cmd.payload === "object" ? cmd.payload : {};

    switch (cmd.type) {
      case "OPEN_CELL":
        if (dom.gameScreen.classList.contains("active") && !state.currentQ) {
          openQuestionModal(Number(p.catIdx), p.colKey === "leftColumn" ? "leftColumn" : "rightColumn", Number(p.slotIdx));
        }
        break;
      case "TOGGLE_DOUBLE_ARM":
        toggleArmDoublePoints(state.activeTurn);
        break;
      case "REVEAL_HINT":
        useQuestionHint();
        break;
      case "REVEAL_ANSWER":
        revealAnswer(false);
        break;
      case "AWARD_TEAM":
        if (state.currentQ && state.currentQ.isDailyDouble && typeof p.dailyDoubleSuccess === "boolean") {
          resolveDailyDouble(p.dailyDoubleSuccess);
        } else {
          awardQuestion(p.teamIdx === null || p.teamIdx === undefined ? null : Number(p.teamIdx));
        }
        break;
      case "WRONG_ANSWER":
        handleWrongAnswerClick();
        break;
      case "OPEN_STEAL":
        openStealPhase();
        break;
      case "STEAL_RESULT":
        if (p.skip) closeWithoutPointsAndReveal();
        else resolveSteal(Boolean(p.success));
        break;
      case "SWAP_QUESTION":
        swapCurrentQuestion();
        break;
      case "TOGGLE_TIMER":
        toggleTimer();
        break;
      case "RESET_TIMER":
        if (dom.btnTimerReset && !dom.btnTimerReset.disabled) dom.btnTimerReset.click();
        break;
      case "SET_DAILY_DOUBLE_WAGER":
        if (state.currentQ && state.currentQ.isDailyDouble && state.currentQ.dailyDoublePhase === "wager") {
          if (dom.ddWagerInput && Number.isFinite(Number(p.wager))) {
            dom.ddWagerInput.value = String(Math.round(Number(p.wager)));
          }
          lockDailyDoubleWager();
        }
        break;
      case "PLAY_SFX":
        if (typeof p.sfx === "string") triggerSoundboardEffect(p.sfx);
        break;
      case "TOGGLE_INTERMISSION":
        if (state.intermission && state.intermission.active) stopIntermission(false);
        else startIntermission(state.intermission ? state.intermission.message : "", 0);
        break;
      case "REFEREE_ACTION":
        if (p.setTurn && Number.isInteger(Number(p.teamIdx))) {
          setActiveTurnManually(Number(p.teamIdx));
        } else if (Number.isInteger(Number(p.teamIdx)) && Number(p.delta)) {
          adjustScore(Number(p.teamIdx), Number(p.delta), true);
        }
        break;
      case "UNDO":
        if (dom.questionModal.classList.contains("open") && state.currentQ) {
          performInModalUndo();
        } else {
          const wasWirelessOpen = dom.wirelessRoomModal && dom.wirelessRoomModal.classList.contains("open");
          if (wasWirelessOpen) closeWirelessRoomModal();
          performUndo();
          if (wasWirelessOpen) openWirelessRoomModal();
        }
        break;
      case "BUZZER_OPEN":
        openSpeedBuzzer();
        break;
      case "BUZZER_LOCK":
        lockSpeedBuzzer();
        break;
      case "BUZZER_RESET":
        resetSpeedBuzzer();
        break;
      case "ALLPLAY_OPEN":
        openAllPlayForCurrentQuestion();
        break;
      case "ALLPLAY_REVEAL":
        revealAllPlayAnswers();
        break;
      case "ALLPLAY_TOGGLE_JUDGE":
        setAllPlayJudgment(Number(p.teamIdx), Boolean(p.correct));
        break;
      case "ALLPLAY_COMMIT":
        commitAllPlayAwards();
        break;
      case "DIFF_INCREMENT":
        incrementDifference();
        break;
      case "DIFF_DECREMENT":
        decrementDifference();
        break;
      case "DIFF_RESET":
        resetDifferences();
        break;
      case "AUDIO_PLAY":
        sendAudioChallengeAction("PLAY");
        break;
      case "AUDIO_PAUSE":
        sendAudioChallengeAction("PAUSE");
        break;
      case "AUDIO_REPLAY":
        sendAudioChallengeAction("REPLAY");
        break;
      case "AUDIO_TEASER_5S":
        sendAudioChallengeAction("TEASER_5S", { seconds: 5 });
        break;
      case "AUDIO_SEEK":
        sendAudioChallengeAction("SEEK", { seconds: Number(p.seconds) || 0 });
        break;
      case "AUDIO_CHALLENGE_MODE_ACTION":
        if (
          window.SeenJeemAudioChallengeMode &&
          typeof window.SeenJeemAudioChallengeMode.handleRemoteCommand === "function"
        ) {
          window.SeenJeemAudioChallengeMode.handleRemoteCommand(p);
        }
        break;
      case "TOGGLE_JOIN_LOCK":
        toggleWirelessJoinLock();
        break;
      case "SET_MAX_DEVICES_PER_TEAM":
        toggleWirelessMaxDevicesPerTeam(p.maxDevicesPerTeam === 1 ? 1 : p.maxDevicesPerTeam === 0 ? 0 : null);
        break;
      case "KICK_PLAYER":
        if (typeof p.deviceId === "string" && p.deviceId.trim()) {
          kickWirelessDevice(p.deviceId.trim());
        }
        break;
      case "BLITZ_ACTION":
        if (p.action === "correct" || p.action === "skip" || p.action === "wrong") handleBlitzJudge(p.action);
        else if (p.action === "pause") toggleBlitzPause();
        else if (p.action === "begin") beginBlitzTurn();
        else if (p.action === "next") advanceBlitzTurn();
        break;
      case "CHARADES_ACTION":
        if (p.action === "guessed") handleCsoloGuessed();
        else if (p.action === "skip") handleCsoloSkip();
        else if (p.action === "hint") handleCsoloHint();
        else if (p.action === "pause") toggleCsoloPause();
        else if (p.action === "begin") beginCsoloTurn();
        else if (p.action === "next") advanceCsoloTurn();
        break;
      case "FINAL_ROUND_ACTION":
        if (!state.finalRound) break;
        if (p.action === "start-question") {
          state.finalRound.participantIndices.forEach((idx) => {
            if (state.finalRound.wagers[idx]) state.finalRound.wagers[idx].locked = true;
          });
          proceedToFinalQuestionPhase();
        } else if (p.action === "judge" && Number.isInteger(Number(p.teamIdx))) {
          state.finalRound.judgments[Number(p.teamIdx)] = p.correct ? "correct" : "wrong";
          renderFinalRoundModal();
          persistActiveMatch();
        } else if (p.action === "reveal") {
          resolveFinalRoundResults();
        }
        break;
      default:
        break;
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
          const rawVal = btn.dataset.value;
          if (!key) return;
          if (key === "finalRoundMode") {
            updateSetupSetting({ [key]: String(rawVal || "tie-only") });
          } else {
            const val = Number(rawVal);
            if (Number.isFinite(val)) {
              updateSetupSetting({ [key]: val });
            }
          }
        });
      });
    }
    if (dom.teamCountSelector) {
      dom.teamCountSelector.querySelectorAll(".team-count-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
          const count = Number(pill.dataset.teamCount);
          if (count === 2 || count === 3 || count === 4) {
            updateSetupSetting({ teamCount: count });
            renderTeamCountSetupUI();
            if (state.dualScreen.connected) broadcastLiveDisplayState();
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
    [dom.team1Input, dom.team2Input, dom.team3Input, dom.team4Input].forEach((inp) => {
      if (!inp) return;
      inp.addEventListener("input", () => {
        if (state.dualScreen.connected) broadcastLiveDisplayState();
      });
    });

    // أحداث الحزمة الخامسة: جولة الرهان النهائي + التحكم التحكيمي السريع
    if (dom.btnStartTiebreakerFromWinner) {
      dom.btnStartTiebreakerFromWinner.addEventListener("click", () => {
        startFinalRound("manual", 1, []);
      });
    }
    if (dom.btnFinalCancel) {
      dom.btnFinalCancel.addEventListener("click", cancelFinalRound);
    }
    if (dom.btnFinalReroll) {
      dom.btnFinalReroll.addEventListener("click", rerollFinalQuestion);
    }
    if (dom.btnFinalShowQuestion) {
      dom.btnFinalShowQuestion.addEventListener("click", proceedToFinalQuestionPhase);
    }
    if (dom.btnFinalTimerToggle) {
      dom.btnFinalTimerToggle.addEventListener("click", toggleFinalRoundTimer);
    }
    if (dom.btnFinalTimerReset) {
      dom.btnFinalTimerReset.addEventListener("click", resetFinalRoundTimer);
    }
    if (dom.btnFinalRevealResults) {
      dom.btnFinalRevealResults.addEventListener("click", resolveFinalRoundResults);
    }
    if (dom.btnFinalExtraTiebreaker) {
      dom.btnFinalExtraTiebreaker.addEventListener("click", startExtraTieBreakerRound);
    }
    if (dom.btnFinalGoWinner) {
      dom.btnFinalGoWinner.addEventListener("click", finishFinalRoundToWinner);
    }

    // قائمة التحكم التحكيمي السريع (Referee Popover)
    if (dom.btnCloseRefereePopover) {
      dom.btnCloseRefereePopover.addEventListener("click", closeRefereePopover);
    }
    if (dom.btnRefereeApplyDelta) {
      dom.btnRefereeApplyDelta.addEventListener("click", () => {
        if (state.refereePopoverTeamIdx === null || !dom.refereeCustomDeltaInput) return;
        const val = Number(dom.refereeCustomDeltaInput.value);
        if (!Number.isFinite(val) || val === 0) {
          showToast("أدخل قيمة موجبة أو سالبة صالحة (مثال: 150 أو -50)", "warning");
          return;
        }
        adjustScore(state.refereePopoverTeamIdx, val, true);
        dom.refereeCustomDeltaInput.value = "";
      });
    }
    if (dom.refereePopover) {
      dom.refereePopover.querySelectorAll(".ref-delta-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          if (state.refereePopoverTeamIdx === null) return;
          adjustScore(state.refereePopoverTeamIdx, Number(chip.dataset.refDelta), true);
        });
      });
    }
    if (dom.btnRefDoubleMinus) {
      dom.btnRefDoubleMinus.addEventListener("click", () => {
        if (state.refereePopoverTeamIdx !== null) adjustTeamPowerup(state.refereePopoverTeamIdx, "double", -1);
      });
    }
    if (dom.btnRefDoublePlus) {
      dom.btnRefDoublePlus.addEventListener("click", () => {
        if (state.refereePopoverTeamIdx !== null) adjustTeamPowerup(state.refereePopoverTeamIdx, "double", 1);
      });
    }
    if (dom.btnRefSwapMinus) {
      dom.btnRefSwapMinus.addEventListener("click", () => {
        if (state.refereePopoverTeamIdx !== null) adjustTeamPowerup(state.refereePopoverTeamIdx, "swap", -1);
      });
    }
    if (dom.btnRefSwapPlus) {
      dom.btnRefSwapPlus.addEventListener("click", () => {
        if (state.refereePopoverTeamIdx !== null) adjustTeamPowerup(state.refereePopoverTeamIdx, "swap", 1);
      });
    }
    if (dom.btnRefSetTurn) {
      dom.btnRefSetTurn.addEventListener("click", () => {
        if (state.refereePopoverTeamIdx !== null) {
          setActiveTurnManually(state.refereePopoverTeamIdx);
          closeRefereePopover();
        }
      });
    }
    document.addEventListener("click", (e) => {
      if (state.refereePopoverTeamIdx === null || !dom.refereePopover || dom.refereePopover.hidden) return;
      if (!dom.refereePopover.contains(e.target) && !e.target.closest(".btn-open-referee")) {
        closeRefereePopover();
      }
    });

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
    if (dom.btnCopyFlaggedReport) {
      dom.btnCopyFlaggedReport.addEventListener("click", copyFlaggedReport);
    }
    if (dom.btnExportFlaggedJson) {
      dom.btnExportFlaggedJson.addEventListener("click", exportFlaggedAsJSON);
    }
    if (dom.btnExportFlaggedCsv) {
      dom.btnExportFlaggedCsv.addEventListener("click", exportFlaggedAsCSV);
    }
    if (dom.btnClearAllFlagged) {
      dom.btnClearAllFlagged.addEventListener("click", () => {
        if (!flaggedStore || flaggedStore.getCount() === 0) return;
        openConfirmDialog({
          title: "مسح جميع الأسئلة المحدّدة للمراجعة؟",
          message: `سيتم حذف ${flaggedStore.getCount()} سؤالاً من قائمة المراجعة المحلية (يمكنك تصدير JSON أو CSV قبل المسح).`,
          confirmText: "نعم، امسح القائمة",
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
    const handleVolumeSliderInput = (sliderEl) => {
      if (!window.SeenJeemAudio || !sliderEl) return;
      const pct = Number(sliderEl.value);
      window.SeenJeemAudio.setVolume(pct / 100);
      if (pct === 0) {
        window.SeenJeemAudio.setMuted(true);
      } else if (window.SeenJeemAudio.isMuted()) {
        window.SeenJeemAudio.setMuted(false);
      }
      syncSoundButtonsUI();
      broadcastAudioSettingsToDisplay();
    };

    const handleVolumeSliderRelease = () => {
      if (!window.SeenJeemAudio || window.SeenJeemAudio.isMuted()) return;
      if (typeof window.SeenJeemAudio.playVolumeTestTick === "function") {
        window.SeenJeemAudio.playVolumeTestTick();
      } else if (typeof window.SeenJeemAudio.playTestChime === "function") {
        window.SeenJeemAudio.playTestChime();
      }
    };

    [dom.audioVolumeSlider, dom.setupVolumeSlider, dom.gameVolumeSlider].forEach((sl) => {
      if (!sl) return;
      sl.addEventListener("input", () => handleVolumeSliderInput(sl));
      sl.addEventListener("change", handleVolumeSliderRelease);
    });
    if (dom.toggleSfxTimer) {
      dom.toggleSfxTimer.addEventListener("click", () => {
        if (!window.SeenJeemAudio) return;
        const cur = window.SeenJeemAudio.getCategoryPrefs();
        window.SeenJeemAudio.setCategoryPrefs({ timerTicks: !cur.timerTicks });
        syncAudioMixerUI();
        broadcastAudioSettingsToDisplay();
      });
    }
    if (dom.toggleSfxUi) {
      dom.toggleSfxUi.addEventListener("click", () => {
        if (!window.SeenJeemAudio) return;
        const cur = window.SeenJeemAudio.getCategoryPrefs();
        window.SeenJeemAudio.setCategoryPrefs({ uiEffects: !cur.uiEffects });
        syncAudioMixerUI();
        broadcastAudioSettingsToDisplay();
      });
    }
    if (dom.toggleSfxCelebrations) {
      dom.toggleSfxCelebrations.addEventListener("click", () => {
        if (!window.SeenJeemAudio) return;
        const cur = window.SeenJeemAudio.getCategoryPrefs();
        window.SeenJeemAudio.setCategoryPrefs({ celebrations: !cur.celebrations });
        syncAudioMixerUI();
        broadcastAudioSettingsToDisplay();
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

    // أحداث الحزمة السادسة: بطاقة النتيجة، لوحة المؤثرات، شاشة الاستراحة، الثيمات ومقياس التلفزيون
    document.querySelectorAll(".theme-choice-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const chosen = btn.dataset.themeChoice || "dark-glass";
        applyTheme(chosen, true);
        const labels = {
          "dark-glass": "🌌 زجاجي داكن",
          "royal-gold": "👑 ملكي ذهبي",
          "high-contrast": "🔆 تباين عالٍ"
        };
        showToast(`🎨 تم تطبيق ثيم «${labels[chosen] || chosen}»`, "info");
      });
    });

    [dom.setupTvScaleSlider, dom.gameTvScaleSlider].forEach((sl) => {
      if (!sl) return;
      sl.addEventListener("input", () => {
        applyTvScale(Number(sl.value), true);
      });
    });
    [dom.btnResetTvScaleSetup, dom.btnResetTvScaleGame].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        applyTvScale(100, true);
        showToast("تمت إعادة ضبط حجم خط شاشة التلفزيون إلى 100%", "info");
      });
    });

    if (dom.btnOpenSoundboard) {
      dom.btnOpenSoundboard.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHostToolPopover(dom.soundboardPopover, dom.btnOpenSoundboard);
      });
    }
    if (dom.btnSoundboardInQuestion) {
      dom.btnSoundboardInQuestion.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHostToolPopover(dom.soundboardPopover, dom.btnSoundboardInQuestion);
      });
    }
    if (dom.btnCloseSoundboard) {
      dom.btnCloseSoundboard.addEventListener("click", () => closeAllHostToolPopovers());
    }
    if (dom.soundboardPopover) {
      dom.soundboardPopover.querySelectorAll(".soundboard-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          triggerSoundboardEffect(btn.dataset.sfx);
        });
      });
    }

    if (dom.btnOpenIntermission) {
      dom.btnOpenIntermission.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHostToolPopover(dom.intermissionPopover, dom.btnOpenIntermission);
      });
    }
    if (dom.btnIntermissionInQuestion) {
      dom.btnIntermissionInQuestion.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHostToolPopover(dom.intermissionPopover, dom.btnIntermissionInQuestion);
      });
    }
    if (dom.btnCloseIntermissionPopover) {
      dom.btnCloseIntermissionPopover.addEventListener("click", () => closeAllHostToolPopovers());
    }
    if (dom.intermissionDurationPills) {
      dom.intermissionDurationPills.querySelectorAll(".intermission-dur-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
          state.intermissionSelectedMinutes = Math.max(0, Number(pill.dataset.intermissionMin) || 0);
          dom.intermissionDurationPills.querySelectorAll(".intermission-dur-pill").forEach((p) => {
            p.classList.toggle("active", p === pill);
          });
        });
      });
    }
    if (dom.btnStartIntermission) {
      dom.btnStartIntermission.addEventListener("click", () => {
        const msg = dom.intermissionMessageInput ? dom.intermissionMessageInput.value : "";
        startIntermission(msg, state.intermissionSelectedMinutes);
      });
    }
    if (dom.btnStopIntermissionPopover) {
      dom.btnStopIntermissionPopover.addEventListener("click", () => stopIntermission(false));
    }
    if (dom.btnResumeFromIntermission) {
      dom.btnResumeFromIntermission.addEventListener("click", () => stopIntermission(false));
    }

    if (dom.btnOpenDisplayPrefs) {
      dom.btnOpenDisplayPrefs.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHostToolPopover(dom.displayPrefsPopover, dom.btnOpenDisplayPrefs);
      });
    }
    if (dom.btnCloseDisplayPrefs) {
      dom.btnCloseDisplayPrefs.addEventListener("click", () => closeAllHostToolPopovers());
    }

    if (dom.btnOpenResultCard) {
      dom.btnOpenResultCard.addEventListener("click", () => openResultCardModal(null));
    }
    if (dom.btnCloseResultCard) {
      dom.btnCloseResultCard.addEventListener("click", closeResultCardModal);
    }

    // --- ربط أحداث الحزمة السابعة (المربعات الذهبية، البرق، من غير كلام المستقل، قاعة المشاهير) ---
    if (dom.btnDdPresetBase) dom.btnDdPresetBase.addEventListener("click", () => setDailyDoublePreset("base"));
    if (dom.btnDdPresetDouble) dom.btnDdPresetDouble.addEventListener("click", () => setDailyDoublePreset("double"));
    if (dom.btnDdPresetAllin) dom.btnDdPresetAllin.addEventListener("click", () => setDailyDoublePreset("allin"));
    if (dom.btnDdLockWager) dom.btnDdLockWager.addEventListener("click", lockDailyDoubleWager);
    if (dom.ddWagerInput) {
      dom.ddWagerInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          lockDailyDoubleWager();
        }
      });
    }
    if (dom.btnDdCorrect) dom.btnDdCorrect.addEventListener("click", () => resolveDailyDouble(true));
    if (dom.btnDdWrong) dom.btnDdWrong.addEventListener("click", () => resolveDailyDouble(false));

    // أزرار الإطلاق من شاشة الإعداد وشاشة الفائز
    if (dom.btnLaunchBlitzMode) dom.btnLaunchBlitzMode.addEventListener("click", openBlitzModal);
    if (dom.btnLaunchCharadesMode) dom.btnLaunchCharadesMode.addEventListener("click", openCharadesSoloModal);
    if (dom.btnOpenHallOfFame) dom.btnOpenHallOfFame.addEventListener("click", openHallOfFameModal);
    if (dom.btnWinnerOpenHallOfFame) dom.btnWinnerOpenHallOfFame.addEventListener("click", openHallOfFameModal);

    // أحداث نافذة جولة البرق السريعة (60s Blitz)
    if (dom.btnBlitzOpenTv) dom.btnBlitzOpenTv.addEventListener("click", openTVDisplayWindow);
    if (dom.btnCloseBlitz) dom.btnCloseBlitz.addEventListener("click", closeBlitzModal);
    if (dom.blitzTeamCountPills) {
      dom.blitzTeamCountPills.querySelectorAll("[data-blitz-teams]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.blitzConfig.teamCount = Number(btn.dataset.blitzTeams) || 1;
          renderBlitzSetupUI();
        });
      });
    }
    if (dom.blitzDurationPills) {
      dom.blitzDurationPills.querySelectorAll("[data-blitz-dur]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.blitzConfig.durationSeconds = Number(btn.dataset.blitzDur) || 60;
          renderBlitzSetupUI();
        });
      });
    }
    if (dom.blitzRoundsPills) {
      dom.blitzRoundsPills.querySelectorAll("[data-blitz-rounds]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.blitzConfig.roundsPerTeam = Number(btn.dataset.blitzRounds) || 1;
          renderBlitzSetupUI();
        });
      });
    }
    if (dom.btnBlitzStartSession) dom.btnBlitzStartSession.addEventListener("click", startBlitzSession);
    if (dom.btnBlitzBeginTurn) dom.btnBlitzBeginTurn.addEventListener("click", beginBlitzTurn);
    if (dom.btnBlitzPause) dom.btnBlitzPause.addEventListener("click", toggleBlitzPause);
    if (dom.btnBlitzCorrect) dom.btnBlitzCorrect.addEventListener("click", () => handleBlitzJudge("correct"));
    if (dom.btnBlitzSkip) dom.btnBlitzSkip.addEventListener("click", () => handleBlitzJudge("skip"));
    if (dom.btnBlitzWrong) dom.btnBlitzWrong.addEventListener("click", () => handleBlitzJudge("wrong"));
    if (dom.btnBlitzNextTurn) dom.btnBlitzNextTurn.addEventListener("click", advanceBlitzTurn);
    if (dom.btnBlitzResultCard) dom.btnBlitzResultCard.addEventListener("click", openBlitzResultCard);
    if (dom.btnBlitzOpenHof) {
      dom.btnBlitzOpenHof.addEventListener("click", () => {
        closeBlitzModal();
        openHallOfFameModal();
      });
    }
    if (dom.btnBlitzPlayAgain) dom.btnBlitzPlayAgain.addEventListener("click", openBlitzModal);

    // أحداث نافذة طور «من غير كلام» المستقل
    if (dom.btnCharadesOpenTv) dom.btnCharadesOpenTv.addEventListener("click", openTVDisplayWindow);
    if (dom.btnCloseCharadesSolo) dom.btnCloseCharadesSolo.addEventListener("click", closeCharadesSoloModal);
    if (dom.csoloTeamCountPills) {
      dom.csoloTeamCountPills.querySelectorAll("[data-csolo-teams]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.csoloConfig.teamCount = Number(btn.dataset.csoloTeams) || 2;
          renderCsoloSetupUI();
        });
      });
    }
    if (dom.csoloDurationPills) {
      dom.csoloDurationPills.querySelectorAll("[data-csolo-dur]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.csoloConfig.durationSeconds = Number(btn.dataset.csoloDur) || 90;
          renderCsoloSetupUI();
        });
      });
    }
    if (dom.csoloRoundsPills) {
      dom.csoloRoundsPills.querySelectorAll("[data-csolo-rounds]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.csoloConfig.roundsPerTeam = Number(btn.dataset.csoloRounds) || 3;
          renderCsoloSetupUI();
        });
      });
    }
    if (dom.csoloSkipPills) {
      dom.csoloSkipPills.querySelectorAll("[data-csolo-skip]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.csoloConfig.skipLimit = Number(btn.dataset.csoloSkip);
          renderCsoloSetupUI();
        });
      });
    }
    if (dom.btnCsoloStartSession) dom.btnCsoloStartSession.addEventListener("click", startCsoloSession);
    if (dom.btnCsoloBeginTurn) dom.btnCsoloBeginTurn.addEventListener("click", beginCsoloTurn);
    if (dom.btnCsoloPause) dom.btnCsoloPause.addEventListener("click", toggleCsoloPause);
    if (dom.btnCsoloGuessed) dom.btnCsoloGuessed.addEventListener("click", handleCsoloGuessed);
    if (dom.btnCsoloSkip) dom.btnCsoloSkip.addEventListener("click", handleCsoloSkip);
    if (dom.btnCsoloHint) dom.btnCsoloHint.addEventListener("click", handleCsoloHint);
    if (dom.btnCsoloNextTurn) dom.btnCsoloNextTurn.addEventListener("click", advanceCsoloTurn);
    if (dom.btnCsoloResultCard) dom.btnCsoloResultCard.addEventListener("click", openCsoloResultCard);
    if (dom.btnCsoloOpenHof) {
      dom.btnCsoloOpenHof.addEventListener("click", () => {
        closeCharadesSoloModal();
        openHallOfFameModal();
      });
    }
    if (dom.btnCsoloPlayAgain) dom.btnCsoloPlayAgain.addEventListener("click", openCharadesSoloModal);

    if (dom.btnCsoloHoldReveal) {
      const startHold = (e) => {
        if (e.cancelable) e.preventDefault();
        setCsoloHoldReveal(true);
      };
      const endHold = () => setCsoloHoldReveal(false);
      dom.btnCsoloHoldReveal.addEventListener("pointerdown", startHold);
      dom.btnCsoloHoldReveal.addEventListener("pointerup", endHold);
      dom.btnCsoloHoldReveal.addEventListener("pointerleave", endHold);
      dom.btnCsoloHoldReveal.addEventListener("pointercancel", endHold);
      dom.btnCsoloHoldReveal.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    // أحداث نافذة قاعة المشاهير والأرشيف
    if (dom.btnCloseHof) dom.btnCloseHof.addEventListener("click", closeHallOfFameModal);
    if (dom.btnHofFooterClose) dom.btnHofFooterClose.addEventListener("click", closeHallOfFameModal);
    if (dom.hallOfFameModal) {
      dom.hallOfFameModal.addEventListener("click", (e) => {
        if (e.target === dom.hallOfFameModal) closeHallOfFameModal();
      });
    }
    if (dom.hofViewTabs) {
      dom.hofViewTabs.querySelectorAll("[data-hof-view]").forEach((tab) => {
        tab.addEventListener("click", () => {
          const v = tab.dataset.hofView;
          state.hofActiveView = v === "bara-salfa" ? "bara-salfa" : v === "mafia" ? "mafia" : "seen-jeem";
          renderHallOfFameModal();
        });
      });
    }
    if (dom.hofModeFilters) {
      dom.hofModeFilters.querySelectorAll(".hof-filter-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
          state.hofModeFilter = pill.dataset.hofMode || "all";
          renderHallOfFameModal();
        });
      });
    }
    if (dom.btnHofClearArchive) {
      dom.btnHofClearArchive.addEventListener("click", () => {
        const profile = historyStore.getActiveProfile();
        if (state.hofActiveView === "mafia") {
          openConfirmDialog({
            title: `تصفير إحصائيات «المافيا» لمجموعة «${profile.name}»؟`,
            message: "سيتم حذف جميع جلسات وإحصائيات «المافيا» المحفوظة لهذه المجموعة فقط.",
            confirmText: "نعم، صفّر الإحصائيات",
            onConfirm: () => {
              if (typeof archiveStore.clearMafiaProfileStats === "function") {
                archiveStore.clearMafiaProfileStats(profile.id);
              }
              renderHallOfFameModal();
              showToast(`🗑️ تم تصفير إحصائيات «المافيا» لمجموعة «${profile.name}»`, "info");
            }
          });
          return;
        }
        if (state.hofActiveView === "bara-salfa") {
          openConfirmDialog({
            title: `تصفير إحصائيات «برا السالفة» لمجموعة «${profile.name}»؟`,
            message: "سيتم حذف جميع جولات وإحصائيات «برا السالفة» المحفوظة لهذه المجموعة فقط.",
            confirmText: "نعم، صفّر الإحصائيات",
            onConfirm: () => {
              if (typeof archiveStore.clearBaraSalfaProfileStats === "function") {
                archiveStore.clearBaraSalfaProfileStats(profile.id);
              }
              renderHallOfFameModal();
              showToast(`🗑️ تم تصفير إحصائيات «برا السالفة» لمجموعة «${profile.name}»`, "info");
            }
          });
          return;
        }
        openConfirmDialog({
          title: `تصفير أرشيف مجموعة «${profile.name}»؟`,
          message:
            "سيتم حذف جميع سجلات المباريات والأرقام القياسية لهذه المجموعة فقط، دون التأثير على سجل الأسئلة الملعوبة أو المجموعات الأخرى.",
          confirmText: "نعم، صفّر الأرشيف",
          onConfirm: () => {
            archiveStore.clearProfileArchive(profile.id);
            renderHallOfFameModal();
            showToast(`🗑️ تم تصفير أرشيف مجموعة «${profile.name}»`, "info");
          }
        });
      });
    }

    if (dom.btnAllPlayOpen) {
      dom.btnAllPlayOpen.addEventListener("click", openAllPlayForCurrentQuestion);
    }
    if (dom.btnWinnerReturnTournament) {
      dom.btnWinnerReturnTournament.addEventListener("click", () => {
        closeModal(dom.winnerModal);
        stopVictoryConfetti();
        state.activeTournamentMatch = null;
        returnToSetupScreen();
        if (window.SeenJeemTournament) window.SeenJeemTournament.open();
      });
    }
    if (dom.btnBlitzReturnTournament) {
      dom.btnBlitzReturnTournament.addEventListener("click", () => {
        closeBlitzModal();
        state.activeTournamentMatch = null;
        if (window.SeenJeemTournament) window.SeenJeemTournament.open();
      });
    }

    // --- ربط أحداث الحزمة الثانية عشرة (الفروقات، صورة الإجابة، التحديات الصوتية، صانع الفئات) ---
    if (dom.btnDiffIncrement) dom.btnDiffIncrement.addEventListener("click", incrementDifference);
    if (dom.btnDiffDecrement) dom.btnDiffDecrement.addEventListener("click", decrementDifference);
    if (dom.btnDiffReset) dom.btnDiffReset.addEventListener("click", resetDifferences);

    if (dom.btnAnsViewAnswer) dom.btnAnsViewAnswer.addEventListener("click", () => setAnswerImageViewMode("answer"));
    if (dom.btnAnsViewQuestion) dom.btnAnsViewQuestion.addEventListener("click", () => setAnswerImageViewMode("question"));
    if (dom.btnAnsViewCompare) dom.btnAnsViewCompare.addEventListener("click", () => setAnswerImageViewMode("compare"));
    if (dom.answerCompareQImg) {
      dom.answerCompareQImg.addEventListener("click", () => {
        if (dom.answerCompareQImg.src) openLightbox([{ src: dom.answerCompareQImg.src, caption: "صورة السؤال" }], 0);
      });
    }
    if (dom.answerCompareAImg) {
      dom.answerCompareAImg.addEventListener("click", () => {
        if (dom.answerCompareAImg.src) openLightbox([{ src: dom.answerCompareAImg.src, caption: "صورة الإجابة" }], 0);
      });
    }

    if (dom.btnAudioChPlay) dom.btnAudioChPlay.addEventListener("click", () => sendAudioChallengeAction("PLAY"));
    if (dom.btnAudioChPause) dom.btnAudioChPause.addEventListener("click", () => sendAudioChallengeAction("PAUSE"));
    if (dom.btnAudioChReplay) dom.btnAudioChReplay.addEventListener("click", () => sendAudioChallengeAction("REPLAY"));
    if (dom.btnAudioChTeaser) dom.btnAudioChTeaser.addEventListener("click", () => sendAudioChallengeAction("TEASER_5S", { seconds: 5 }));
    if (dom.audioChSeek) {
      dom.audioChSeek.addEventListener("change", () => {
        sendAudioChallengeAction("SEEK", { seconds: Number(dom.audioChSeek.value) || 0 });
      });
    }
    if (dom.audioChVolume) {
      dom.audioChVolume.addEventListener("input", () => {
        const vol = Math.min(1, Math.max(0, (Number(dom.audioChVolume.value) || 85) / 100));
        state.audioChallenge.status.volume = vol;
        sendAudioChallengeAction("SET_VOLUME", { volume: vol });
      });
    }
    if (dom.btnAudioChRoute) {
      dom.btnAudioChRoute.addEventListener("click", () => {
        stopActiveAudioChallenge();
        state.audioChallenge.route = state.audioChallenge.route === "host" ? "display" : "host";
        renderAudioChallengeHostUI();
        broadcastLiveDisplayState();
        showToast(
          state.audioChallenge.route === "host"
            ? "💻 تم توجيه صوت التحدي الصوتي لجهاز المقدّم (معاينة محلية)"
            : "📺 تم توجيه صوت التحدي الصوتي لشاشة التلفزيون فقط (بلا صدى)",
          "info"
        );
      });
    }

    if (window.SeenJeemAudioChallenge) {
      window.SeenJeemAudioChallenge.onChange((st) => {
        if (getEffectiveAudioChallengeRoute() !== "host") return;
        const prevPlaying = Boolean(state.audioChallenge.status && state.audioChallenge.status.playing);
        state.audioChallenge.status = { ...state.audioChallenge.status, ...st };
        renderAudioChallengeHostUI();
        if (prevPlaying !== Boolean(st.playing)) {
          broadcastLiveDisplayState();
        } else if (state.dualScreen.connected) {
          broadcastLiveDisplayState({ skipWireless: true });
        }
      });
    }

    if (dom.btnOpenCustomPackBuilder && window.SeenJeemCustomPackBuilder) {
      dom.btnOpenCustomPackBuilder.addEventListener("click", () => window.SeenJeemCustomPackBuilder.open());
    }
    if (dom.btnBankOpenPackBuilder && window.SeenJeemCustomPackBuilder) {
      dom.btnBankOpenPackBuilder.addEventListener("click", () => {
        closeBankManagerModal();
        window.SeenJeemCustomPackBuilder.open();
      });
    }

    // --- ربط أحداث الحزمة الثالثة عشرة (المزامنة السحابية + بلاغات Google Sheets التلقائية) ---
    if (dom.btnCloudSyncPill) {
      dom.btnCloudSyncPill.addEventListener("click", () => {
        openBankManagerModal();
        if (dom.bankCloudSyncSection) {
          dom.bankCloudSyncSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
    if (window.SeenJeemCloudSync) {
      window.SeenJeemCloudSync.onChange((st) => renderCloudSyncUI(st));
    }
    if (dom.btnCloudGoogleSignin) {
      dom.btnCloudGoogleSignin.addEventListener("click", async () => {
        const cs = window.SeenJeemCloudSync;
        if (!cs) return;
        setCloudSyncFeedback("info", "⏳ جاري فتح نافذة تسجيل الدخول بحساب Google...");
        const res = await cs.signInWithGoogle({ useRedirect: false });
        if (res.ok) {
          if (dom.btnCloudGoogleRedirect) dom.btnCloudGoogleRedirect.hidden = true;
          setCloudSyncFeedback("success", "✅ تم تسجيل الدخول والمزامنة السحابية الذكية بنجاح!");
          showToast("☁️ تم ربط حساب Google والمزامنة بنجاح!", "success");
        } else {
          if (dom.btnCloudGoogleRedirect) dom.btnCloudGoogleRedirect.hidden = !res.suggestRedirect;
          setCloudSyncFeedback("warning", `⚠️ ${res.error || "تعذّر تسجيل الدخول."}`);
        }
      });
    }
    if (dom.btnCloudGoogleRedirect) {
      dom.btnCloudGoogleRedirect.addEventListener("click", () => {
        if (window.SeenJeemCloudSync) {
          window.SeenJeemCloudSync.signInWithGoogle({ useRedirect: true });
        }
      });
    }
    if (dom.btnCloudSignout) {
      dom.btnCloudSignout.addEventListener("click", async () => {
        if (!window.SeenJeemCloudSync) return;
        await window.SeenJeemCloudSync.signOut();
        setCloudSyncFeedback("info", "تم تسجيل الخروج بنجاح — جميع بياناتك المحلية محفوظة على هذا الجهاز.");
        showToast("🚪 تم تسجيل الخروج من المزامنة السحابية (البيانات المحلية محفوظة)", "info");
      });
    }
    if (dom.btnCloudSyncNow) {
      dom.btnCloudSyncNow.addEventListener("click", async () => {
        if (!window.SeenJeemCloudSync) return;
        setCloudSyncFeedback("info", "🔄 جاري الدمج الذكي مع السحابة...");
        const res = await window.SeenJeemCloudSync.syncNow({ silent: false });
        if (res.ok) {
          setCloudSyncFeedback("success", "✅ اكتملت المزامنة والدمج الذكي بنجاح!");
          showToast("🟢 تمت المزامنة السحابية بنجاح!", "success");
        } else {
          setCloudSyncFeedback("warning", `⚠️ ${res.error || "تعذّرت المزامنة."}`);
        }
      });
    }
    if (dom.btnCloudPushLocal) {
      dom.btnCloudPushLocal.addEventListener("click", () => {
        openConfirmDialog({
          title: "اعتماد نسخة هذا الجهاز على السحابة؟",
          message: "سيتم استبدال النسخة المحفوظة في حسابك السحابي بنسخة هذا الجهاز الحالية.",
          confirmText: "⬆️ نعم، اعتمد نسخة هذا الجهاز",
          onConfirm: async () => {
            const res = await window.SeenJeemCloudSync.pushLocalOverride();
            setCloudSyncFeedback(
              res.ok ? "success" : "error",
              res.ok ? "✅ تم اعتماد نسخة هذا الجهاز على السحابة." : `❌ ${res.error}`
            );
          }
        });
      });
    }
    if (dom.btnCloudPullCloud) {
      dom.btnCloudPullCloud.addEventListener("click", () => {
        openConfirmDialog({
          title: "استرجاع نسخة السحابة على هذا الجهاز؟",
          message: "سيتم استبدال السجلات النصية المحلية على هذا الجهاز بنسخة حسابك السحابي (دون المساس بصور وصوتيات فئاتي الخاصة).",
          confirmText: "⬇️ نعم، استرجع نسخة السحابة",
          onConfirm: async () => {
            const res = await window.SeenJeemCloudSync.pullCloudOverride();
            setCloudSyncFeedback(
              res.ok ? "success" : "error",
              res.ok ? "✅ تم استرجاع نسخة السحابة على هذا الجهاز." : `❌ ${res.error}`
            );
          }
        });
      });
    }

    if (dom.btnSaveSheetReportCfg) {
      dom.btnSaveSheetReportCfg.addEventListener("click", () => {
        const rs = window.SeenJeemSheetReportSync;
        if (!rs) return;
        const res = rs.saveConfig({
          webhookUrl: dom.sheetReportWebhookInput ? dom.sheetReportWebhookInput.value : "",
          secret: dom.sheetReportSecretInput ? dom.sheetReportSecretInput.value : ""
        });
        if (res.ok) {
          setSheetReportFeedback("success", "✅ تم حفظ إعدادات إرسال البلاغات إلى Google Sheets بنجاح.");
          renderBankFlaggedSection();
          showToast("💾 تم حفظ رابط بلاغات Google Sheets", "success");
        } else {
          setSheetReportFeedback("error", `❌ ${res.error}`);
        }
      });
    }
    if (dom.btnTestSheetReport) {
      dom.btnTestSheetReport.addEventListener("click", async () => {
        const rs = window.SeenJeemSheetReportSync;
        if (!rs) return;
        const saveRes = rs.saveConfig({
          webhookUrl: dom.sheetReportWebhookInput ? dom.sheetReportWebhookInput.value : "",
          secret: dom.sheetReportSecretInput ? dom.sheetReportSecretInput.value : ""
        });
        if (!saveRes.ok) {
          setSheetReportFeedback("error", `❌ ${saveRes.error}`);
          return;
        }
        dom.btnTestSheetReport.disabled = true;
        setSheetReportFeedback("info", "⏳ جاري إرسال صف تجريبي إلى Google Sheets...");
        const res = await rs.testConnection();
        dom.btnTestSheetReport.disabled = false;
        if (res.ok) {
          setSheetReportFeedback("success", "✅ نجح الاتصال! تم إضافة صف تجريبي في ورقة Flagged_Reports.");
          showToast("🧪 نجح اختبار الإرسال إلى Google Sheets!", "success");
        } else {
          setSheetReportFeedback("error", `❌ ${res.error}`);
        }
      });
    }
    if (dom.btnSendPendingFlags) {
      dom.btnSendPendingFlags.addEventListener("click", async () => {
        const rs = window.SeenJeemSheetReportSync;
        if (!rs) return;
        dom.btnSendPendingFlags.disabled = true;
        setSheetReportFeedback("info", "📤 جاري إرسال البلاغات المعلّقة إلى Google Sheets...");
        const res = await rs.sendAllPending();
        renderBankFlaggedSection();
        if (res.total === 0) {
          setSheetReportFeedback("info", "جميع البلاغات مرسلة مسبقاً — لا توجد بلاغات معلّقة.");
        } else if (res.ok) {
          setSheetReportFeedback("success", `✅ تم إرسال جميع البلاغات المعلّقة بنجاح (${res.sent} / ${res.total}).`);
          showToast(`📤 تم إرسال ${res.sent} بلاغ إلى الشيت بنجاح!`, "success");
        } else {
          setSheetReportFeedback("warning", `⚠️ تم إرسال ${res.sent} وفشل ${res.failed}: ${res.error || ""}`);
        }
      });
    }

    // --- ربط أحداث الحزمة التاسعة (الغرفة اللاسلكية + QR + إعدادات Firebase + جرس السرعة) ---
    if (dom.btnOpenWirelessSetup) dom.btnOpenWirelessSetup.addEventListener("click", openWirelessRoomModal);
    if (dom.btnOpenWirelessGame) dom.btnOpenWirelessGame.addEventListener("click", openWirelessRoomModal);
    if (dom.btnCloseWirelessModal) dom.btnCloseWirelessModal.addEventListener("click", closeWirelessRoomModal);
    if (dom.wirelessRoomModal) {
      dom.wirelessRoomModal.addEventListener("click", (e) => {
        if (e.target === dom.wirelessRoomModal) closeWirelessRoomModal();
      });
    }
    if (dom.btnCreateWirelessRoom) dom.btnCreateWirelessRoom.addEventListener("click", createWirelessRoom);
    if (dom.btnCloseWirelessRoom) {
      dom.btnCloseWirelessRoom.addEventListener("click", () => {
        openConfirmDialog({
          title: "إغلاق الغرفة اللاسلكية؟",
          message: "سيتم فصل جميع الهواتف المتصلة وحذف بيانات الغرفة من Firebase فوراً، مع استمرار المباراة محلياً دون انقطاع.",
          confirmText: "نعم، أغلق الغرفة",
          onConfirm: () => closeWirelessRoom()
        });
      });
    }
    if (dom.btnToggleWirelessSettings) {
      dom.btnToggleWirelessSettings.addEventListener("click", () => {
        state.wireless.settingsOpen = !state.wireless.settingsOpen;
        renderWirelessRoomModal();
      });
    }
    if (dom.btnFbParseSnippet && dom.fbPasteSnippet) {
      dom.btnFbParseSnippet.addEventListener("click", () => {
        if (!firebaseCfgStore) return;
        const parsed = firebaseCfgStore.parseConfigSnippet(dom.fbPasteSnippet.value);
        if (!parsed) {
          setWirelessFeedback("warning", "تعذّر استخراج الإعدادات من النص — تأكد من لصق كائن firebaseConfig بشكل صحيح.");
          return;
        }
        if (dom.fbApiKey) dom.fbApiKey.value = parsed.apiKey;
        if (dom.fbAuthDomain) dom.fbAuthDomain.value = parsed.authDomain;
        if (dom.fbDatabaseUrl) dom.fbDatabaseUrl.value = parsed.databaseURL;
        if (dom.fbProjectId) dom.fbProjectId.value = parsed.projectId;
        if (dom.fbAppId) dom.fbAppId.value = parsed.appId;
        setWirelessFeedback("success", "✨ تم استخراج حقول Firebase بنجاح — اضغط «💾 حفظ الإعدادات» ثم «🔌 اختبار الاتصال».");
      });
    }
    if (dom.btnFbSaveConfig) dom.btnFbSaveConfig.addEventListener("click", saveFirebaseSettingsFromForm);
    if (dom.btnFbTestConn) dom.btnFbTestConn.addEventListener("click", testFirebaseConnectionFromForm);
    if (dom.btnFbClearConfig) {
      dom.btnFbClearConfig.addEventListener("click", () => {
        if (firebaseCfgStore) firebaseCfgStore.clearOverrideConfig();
        populateFirebaseSettingsInputs();
        setWirelessFeedback("info", "تم مسح إعدادات Firebase المحفوظة في المتصفح.");
      });
    }
    if (dom.btnToggleHostQrPrivacy) {
      dom.btnToggleHostQrPrivacy.addEventListener("click", () => {
        state.wireless.hostQrHidden = !state.wireless.hostQrHidden;
        renderWirelessRoomModal();
      });
    }
    if (dom.btnToggleTvQr) {
      dom.btnToggleTvQr.addEventListener("click", () => {
        state.wireless.showQrOnTv = !state.wireless.showQrOnTv;
        renderWirelessRoomModal();
        broadcastLiveDisplayState();
      });
    }
    if (dom.btnCopyRemoteUrl) {
      dom.btnCopyRemoteUrl.addEventListener("click", () => {
        if (!state.wireless.remoteUrl) return;
        navigator.clipboard?.writeText(state.wireless.remoteUrl).then(() => {
          showToast("📋 تم نسخ رابط ريموت المقدّم السري", "success");
        });
      });
    }
    if (dom.btnCopyPlayerUrl) {
      dom.btnCopyPlayerUrl.addEventListener("click", () => {
        if (!state.wireless.playerUrl) return;
        navigator.clipboard?.writeText(state.wireless.playerUrl).then(() => {
          showToast("📋 تم نسخ رابط انضمام الفرق", "success");
        });
      });
    }
    [dom.btnWbOpen, dom.btnModalWbOpen].forEach((b) => b && b.addEventListener("click", openSpeedBuzzer));
    [dom.btnWbLock, dom.btnModalWbLock].forEach((b) => b && b.addEventListener("click", lockSpeedBuzzer));
    [dom.btnWbReset, dom.btnModalWbReset].forEach((b) => b && b.addEventListener("click", resetSpeedBuzzer));
    if (dom.btnWirelessToggleLock) {
      dom.btnWirelessToggleLock.addEventListener("click", toggleWirelessJoinLock);
    }
    if (dom.btnWirelessToggleCap) {
      dom.btnWirelessToggleCap.addEventListener("click", () => toggleWirelessMaxDevicesPerTeam());
    }
    if (dom.resultCardModal) {
      dom.resultCardModal.addEventListener("click", (e) => {
        if (e.target === dom.resultCardModal) closeResultCardModal();
      });
    }
    if (dom.btnDownloadResultCard) {
      dom.btnDownloadResultCard.addEventListener("click", () => {
        if (!resultCardGen || !state.currentResultCardBlob) return;
        const fname = resultCardGen.getDefaultFilename(state.currentResultCardPrefix || "seen-jeem-result");
        resultCardGen.downloadBlobAsPNG(state.currentResultCardBlob, fname);
        showToast(`⬇️ تم تنزيل بطاقة النتيجة (${fname})`, "success");
      });
    }
    if (dom.btnShareResultCard) {
      dom.btnShareResultCard.addEventListener("click", async () => {
        if (!resultCardGen || !state.currentResultCardBlob) return;
        const res = await resultCardGen.shareResultBlob(state.currentResultCardBlob);
        if (res.ok) {
          showToast("📤 تمت مشاركة بطاقة النتيجة بنجاح!", "success");
        } else if (res.reason !== "aborted") {
          showToast("تعذّرت المشاركة المباشرة — يمكنك تنزيل الصورة أو نسخها", "warning");
        }
      });
    }
    if (dom.btnCopyResultCard) {
      dom.btnCopyResultCard.addEventListener("click", async () => {
        if (!resultCardGen || !state.currentResultCardBlob) return;
        const res = await resultCardGen.copyResultBlobToClipboard(state.currentResultCardBlob);
        if (res.ok) {
          showToast("📋 تم نسخ صورة بطاقة النتيجة إلى الحافظة!", "success");
        } else {
          showToast("المتصفح لا يدعم نسخ الصور للحافظة — استخدم زر تنزيل PNG", "warning");
        }
      });
    }

    document.addEventListener("click", (e) => {
      const pops = [dom.soundboardPopover, dom.intermissionPopover, dom.displayPrefsPopover];
      const triggers = [
        dom.btnOpenSoundboard,
        dom.btnSoundboardInQuestion,
        dom.btnOpenIntermission,
        dom.btnIntermissionInQuestion,
        dom.btnOpenDisplayPrefs
      ];
      if (triggers.some((t) => t && (e.target === t || t.contains(e.target)))) return;
      if (pops.some((p) => p && !p.hidden && p.contains(e.target))) return;
      closeAllHostToolPopovers();
    });

    // اختصارات لوحة المفاتيح وحفظ الحالة عند إخفاء التبويب أو الإغلاق
    document.addEventListener("keydown", handleGlobalKeydown);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) handlePageLifecycleSave();
    });
    window.addEventListener("beforeunload", cleanupAppResources);
  }

  function init() {
    // 0) التوجيه التلقائي للأوضاع المستقلة (?mode=display | ?mode=remote | ?mode=player) بتوافق تام مع النشر الساكن
    const urlMode = realtimeUtils ? realtimeUtils.getUrlMode() : liveSync && liveSync.isDisplayMode() ? "display" : "host";
    if (urlMode === "display") {
      if (window.SeenJeemDisplayView && typeof window.SeenJeemDisplayView.init === "function") {
        window.SeenJeemDisplayView.init();
      }
      return;
    }
    if (urlMode === "remote") {
      if (window.SeenJeemRemoteHostView && typeof window.SeenJeemRemoteHostView.init === "function") {
        window.SeenJeemRemoteHostView.init();
      }
      return;
    }
    if (urlMode === "player") {
      if (window.SeenJeemPlayerView && typeof window.SeenJeemPlayerView.init === "function") {
        window.SeenJeemPlayerView.init();
      }
      return;
    }
    if (urlMode === "bara-player") {
      if (window.SeenJeemBaraPlayerView && typeof window.SeenJeemBaraPlayerView.init === "function") {
        window.SeenJeemBaraPlayerView.init();
      }
      return;
    }
    if (urlMode === "mafia-player") {
      if (window.SeenJeemMafiaPlayerView && typeof window.SeenJeemMafiaPlayerView.init === "function") {
        window.SeenJeemMafiaPlayerView.init();
      }
      return;
    }

    // جسر خفيف يسمح لوحدات «برا السالفة» و«المافيا» و«تحدي الصوت» و«نظام البطولة» بالوصول المنظّم لمشاهد التلفزيون والغرفة اللاسلكية وبطاقة النتيجة
    window.SeenJeemHostBridge = {
      broadcastTV: (opts = { skipWireless: true }) =>
        broadcastLiveDisplayState(opts && typeof opts === "object" ? opts : { skipWireless: true }),
      triggerConfetti: (kind = "victory", theme = "default") => startVictoryConfetti(kind, theme),
      showToast: (msg, type = "info") => showToast(msg, type),
      openTVDisplayWindow: () => openTVDisplayWindow(),
      openWirelessRoomModal: () => openWirelessRoomModal(),
      openSpeedBuzzer: () => openSpeedBuzzer(),
      lockSpeedBuzzer: () => lockSpeedBuzzer(),
      isDualScreenConnected: () => Boolean(state.dualScreen && state.dualScreen.connected),
      getWirelessInfo: () => ({
        active: Boolean(state.wireless && state.wireless.active),
        roomCode: (state.wireless && state.wireless.roomCode) || "",
        buzzer: state.wireless && state.wireless.buzzer ? { ...state.wireless.buzzer } : null
      }),
      getAllCategories: () => (Array.isArray(state.allCategories) ? state.allCategories : []),
      openBaraResultCard: (sessionData) => openResultCardModal({ cardType: "bara-salfa", sessionData }),
      openMafiaResultCard: (sessionData) => openResultCardModal({ cardType: "mafia", sessionData }),
      openAudioChallengeResultCard: (sessionData) => openResultCardModal({ cardType: "audio-challenge", sessionData }),
      openTournamentResultCard: (tournamentData) => openResultCardModal({ cardType: "tournament", tournamentData }),
      refreshCustomPacks: () => refreshCustomPacksFromStore(),
      onCloudDataApplied: ({ silent } = {}) => {
        applyTheme(matchStore.loadTheme(), false);
        applyTvScale(matchStore.loadTvScale(), false);
        renderSetupScreen();
        if (dom.bankManagerModal && dom.bankManagerModal.classList.contains("open")) {
          renderBankManagerModal();
        }
        if (dom.hallOfFameModal && dom.hallOfFameModal.classList.contains("open")) {
          renderHallOfFameModal();
        }
        if (!silent) {
          showToast("☁️ تم تحديث بياناتك من السحابة بنجاح", "success");
        }
      },
      launchTournamentMatch: (matchInfo) => {
        if (!matchInfo || !matchInfo.matchId) return;
        state.activeTournamentMatch = matchInfo;
        const format = matchInfo.format || "classic-4";
        const nameA = (matchInfo.teamA && matchInfo.teamA.name) || matchInfo.teamAName || "الفريق الأول";
        const nameB = (matchInfo.teamB && matchInfo.teamB.name) || matchInfo.teamBName || "الفريق الثاني";
        if (format === "blitz") {
          state.blitzConfig.teamCount = 2;
          state.blitzConfig.durationSeconds = 60;
          state.blitzConfig.roundsPerTeam = 1;
          openBlitzModal();
          const inputs = dom.blitzTeamNamesInputs ? dom.blitzTeamNamesInputs.querySelectorAll("input") : [];
          if (inputs[0]) inputs[0].value = nameA;
          if (inputs[1]) inputs[1].value = nameB;
          startBlitzSession();
          return;
        }
        const reqCats = format === "classic-6" ? 6 : 4;
        updateSetupSetting({ teamCount: 2 });
        renderTeamCountSetupUI();
        if (dom.team1Input) dom.team1Input.value = nameA;
        if (dom.team2Input) dom.team2Input.value = nameB;
        // اختيار تلقائي متوازن لأفضل الفئات ذات الأسئلة الجديدة
        const sortedCats = [...state.allCategories].sort((a, b) => {
          const countNew = (cat) =>
            (cat && Array.isArray(cat.questions) ? cat.questions : []).filter(
              (q) => q && !historyStore.isPlayed(q.id)
            ).length;
          return countNew(b) - countNew(a);
        });
        state.selectedCategoryIds = sortedCats.slice(0, reqCats).map((c) => c.id);
        startNewGame({ requiredCategories: reqCats, keepTournamentMatch: true });
      }
    };

    const btnLaunchBaraSalfa = document.getElementById("btn-launch-bara-salfa");
    if (btnLaunchBaraSalfa && window.SeenJeemBaraSalfa) {
      window.SeenJeemBaraSalfa.init();
      btnLaunchBaraSalfa.addEventListener("click", () => window.SeenJeemBaraSalfa.open());
    }
    const btnLaunchMafia = document.getElementById("btn-launch-mafia");
    if (btnLaunchMafia && window.SeenJeemMafia) {
      window.SeenJeemMafia.init();
      btnLaunchMafia.addEventListener("click", () => window.SeenJeemMafia.open());
    }
    const btnLaunchAudioChallenge = document.getElementById("btn-launch-audio-challenge");
    if (btnLaunchAudioChallenge && window.SeenJeemAudioChallengeMode) {
      window.SeenJeemAudioChallengeMode.init();
      btnLaunchAudioChallenge.addEventListener("click", () => window.SeenJeemAudioChallengeMode.open());
    }
    const btnLaunchTournament = document.getElementById("btn-launch-tournament");
    if (btnLaunchTournament && window.SeenJeemTournament) {
      window.SeenJeemTournament.init();
      btnLaunchTournament.addEventListener("click", () => window.SeenJeemTournament.open());
    }
    if (window.SeenJeemCustomPackBuilder) {
      window.SeenJeemCustomPackBuilder.init();
    }
    if (window.SeenJeemCustomPacksStore) {
      window.SeenJeemCustomPacksStore.init().then(() => refreshCustomPacksFromStore()).catch(() => {});
    }
    if (window.SeenJeemCloudSync) {
      window.SeenJeemCloudSync.init();
      renderCloudSyncUI();
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
        } else if (msg && msg.type === "AUDIO_CHALLENGE_STATUS" && msg.payload) {
          if (
            window.SeenJeemAudioChallengeMode &&
            typeof window.SeenJeemAudioChallengeMode.isOpen === "function" &&
            window.SeenJeemAudioChallengeMode.isOpen() &&
            typeof window.SeenJeemAudioChallengeMode.onDisplayAudioStatus === "function"
          ) {
            window.SeenJeemAudioChallengeMode.onDisplayAudioStatus(msg.payload);
            return;
          }
          const prevPlaying = Boolean(state.audioChallenge.status && state.audioChallenge.status.playing);
          state.audioChallenge.status = { ...state.audioChallenge.status, ...msg.payload };
          renderAudioChallengeHostUI();
          if (prevPlaying !== Boolean(msg.payload.playing) && state.wireless.active) {
            broadcastLiveDisplayState();
          }
        }
      });
    }

    rebuildMergedCategories();
    bindEvents();
    applyTheme(state.theme, false);
    applyTvScale(state.tvScale, false);
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
