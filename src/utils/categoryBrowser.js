/**
 * متصفّح الفئات الرئيسية والفرعية ونظام المفضلة والبحث الفوري (Category Browser — Pack 18)
 * - مستويان: شبكة بطاقات الفئات الرئيسية (Main) -> بطاقات الفئات الفرعية (Sub) مع شارات اختيار حية
 * - بحث عربي فوري بتطبيع كامل للحروف (أ/إ/آ -> ا، ة -> ه، ى -> ي) عبر جميع الفئات
 * - فلاتر سريعة: الكل | جديد لم يُلعب | بصري وصوتي | فئاتي الخاصة | المفضلة
 * - نظام المفضلة الدائم (seen-jeem-favorites-v1) مع تكامل النسخ الاحتياطي وحفظ الحساب
 * - الاختيار العشوائي الذكي («كمّلها عشوائياً») الذي يملأ الخانات المتبقية بأولوية للجديد وتنويع الفئات الرئيسية
 */
(function () {
  "use strict";

  const FAVORITES_STORAGE_KEY = "seen-jeem-favorites-v1";

  const MAIN_CATEGORY_CATALOG = Object.freeze([
    { id: "custom-packs", label: "فئاتي الخاصة", icon: "✨", color: "#f59e0b" },
    { id: "jordan-arab", label: "الأردن والعرب وإسلاميات", icon: "🇯🇴", color: "#ef4444" },
    { id: "culture-geo", label: "ثقافة وجغرافيا وتاريخ", icon: "🌍", color: "#06b6d4" },
    { id: "science-tech", label: "علوم وتقنية وطب", icon: "🔬", color: "#8b5cf6" },
    { id: "entertainment", label: "فنون وترفيه وذكريات", icon: "🎬", color: "#ec4899" },
    { id: "sports-life", label: "رياضة ولايف ستايل", icon: "⚽", color: "#10b981" },
    { id: "puzzles", label: "ألغاز وتحديات ذكاء", icon: "🧩", color: "#f59e0b" },
    { id: "visual", label: "تحديات بصرية وصور", icon: "👁️", color: "#6366f1" },
    { id: "charades", label: "من غير كلام", icon: "🎭", color: "#f97316" },
    { id: "general-misc", label: "منوّعات عامة", icon: "📚", color: "#38bdf8" }
  ]);

  const MAIN_CATALOG_MAP = new Map(MAIN_CATEGORY_CATALOG.map((m) => [m.id, m]));

  const DYNAMIC_COLORS = ["#06b6d4", "#a855f7", "#10b981", "#f59e0b", "#ec4899", "#3b82f6", "#ef4444", "#14b8a6"];

  /**
   * تطبيع النصوص العربية للبحث الفوري (أ/إ/آ -> ا، ة -> ه، ى -> ي، إزالة التشكيل)
   */
  function normalizeArabicSearch(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? Array.from(new Set(parsed.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())))
        : [];
    } catch (_err) {
      return [];
    }
  }

  function saveFavorites(ids, { notifyCloud = true } = {}) {
    const clean = Array.from(
      new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))
    );
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(clean));
    } catch (_err) {}
    if (notifyCloud && window.SeenJeemCloudSync && typeof window.SeenJeemCloudSync.scheduleAutoSync === "function") {
      window.SeenJeemCloudSync.scheduleAutoSync();
    }
    return clean;
  }

  function isFavorite(catId) {
    if (!catId) return false;
    return loadFavorites().includes(String(catId).trim());
  }

  function toggleFavorite(catId) {
    const cleanId = String(catId || "").trim();
    if (!cleanId) return { isFav: false, list: loadFavorites() };
    const list = loadFavorites();
    const idx = list.indexOf(cleanId);
    let isFav;
    if (idx >= 0) {
      list.splice(idx, 1);
      isFav = false;
    } else {
      list.push(cleanId);
      isFav = true;
    }
    const saved = saveFavorites(list, { notifyCloud: true });
    return { isFav, list: saved };
  }

  function importFavorites(incomingIds, mode = "merge") {
    const incoming = Array.isArray(incomingIds)
      ? incomingIds.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
      : [];
    if (mode === "replace") {
      return saveFavorites(incoming, { notifyCloud: false });
    }
    const current = loadFavorites();
    return saveFavorites([...current, ...incoming], { notifyCloud: false });
  }

  /**
   * تحديد شارات نوع المحتوى داخل الفئة الفرعية (نصي، صور، فروقات، صوتي)
   */
  function getCategoryContentBadges(cat) {
    const questions = cat && Array.isArray(cat.questions) ? cat.questions : [];
    let hasText = false;
    let hasImage = false;
    let hasDiff = false;
    let hasAudio = false;

    const imageVisualTypes = new Set(["blur", "zoom", "invert", "silhouette", "memory", "multi-image", "image"]);

    questions.forEach((q) => {
      if (!q || typeof q !== "object") return;
      const vt = typeof q.visualType === "string" ? q.visualType.trim().toLowerCase() : "normal";
      const audioUrl = typeof q.audioUrl === "string" && q.audioUrl.trim();
      const qImg = typeof q.questionImage === "string" && q.questionImage.trim();
      const imgs = Array.isArray(q.images) && q.images.length > 0;
      const diffCount = Number(q.differencesCount) || 0;

      if (vt === "audio" || audioUrl) {
        hasAudio = true;
      } else if (vt === "differences" || vt === "spot-diff" || diffCount > 0) {
        hasDiff = true;
      } else if (qImg || imgs || imageVisualTypes.has(vt)) {
        hasImage = true;
      } else {
        hasText = true;
      }
    });

    const badges = [];
    if (hasText) badges.push({ type: "text", icon: "📝", label: "نصي" });
    if (hasImage) badges.push({ type: "image", icon: "🖼️", label: "صور" });
    if (hasDiff) badges.push({ type: "diff", icon: "🔍", label: "فروقات" });
    if (hasAudio) badges.push({ type: "audio", icon: "🎵", label: "صوتي" });
    if (badges.length === 0) badges.push({ type: "text", icon: "📝", label: "نصي" });
    return badges;
  }

  function isMediaCategory(cat) {
    const badges = getCategoryContentBadges(cat);
    return badges.some((b) => b.type === "image" || b.type === "diff" || b.type === "audio");
  }

  function isCustomCategory(cat, customIdsSet) {
    if (!cat || typeof cat !== "object") return false;
    if (cat._isCustomPack || cat.source === "custom-pack" || cat.isCustom) return true;
    if (customIdsSet && typeof customIdsSet.has === "function" && customIdsSet.has(cat.id)) return true;
    return false;
  }

  /**
   * التحقق من أن الفئة تحتوي على سؤال واحد صالح على الأقل (لمنع عرض بطاقات فارغة)
   */
  function hasValidQuestions(cat) {
    if (!cat || !Array.isArray(cat.questions) || cat.questions.length === 0) return false;
    return cat.questions.some(
      (q) =>
        q &&
        typeof q === "object" &&
        ((typeof q.question === "string" && q.question.trim().length > 0) ||
          (typeof q.answer === "string" && q.answer.trim().length > 0))
    );
  }

  function resolveThemeEntry(rawNameOrId, fallbackIcon = "") {
    const themes = window.SeenJeemCategoryThemes;
    if (themes && typeof themes.resolveTheme === "function") {
      return themes.resolveTheme(rawNameOrId, { fallbackIcon });
    }
    const raw = typeof rawNameOrId === "string" ? rawNameOrId.trim() : "";
    const lower = raw.toLowerCase();
    if (MAIN_CATALOG_MAP.has(lower)) return MAIN_CATALOG_MAP.get(lower);
    const normExplicit = normalizeArabicSearch(raw);
    for (const item of MAIN_CATEGORY_CATALOG) {
      if (normalizeArabicSearch(item.label) === normExplicit) return item;
    }
    if (!raw) return MAIN_CATALOG_MAP.get("general-misc");
    const dynId = `main-${normExplicit.replace(/\s+/g, "-")}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    return {
      id: dynId,
      label: raw,
      icon: fallbackIcon || "📂",
      color: DYNAMIC_COLORS[hash % DYNAMIC_COLORS.length],
      accent: DYNAMIC_COLORS[hash % DYNAMIC_COLORS.length],
      gradient: "",
      isCountry: false,
      order: 500
    };
  }

  /**
   * تحديد الفئة الرئيسية لأي فئة فرعية عبر سجل الأعلام والألوان (categoryThemes.js)
   */
  function resolveMainCategoryInfo(cat, { resolveGroupFn, customIdsSet } = {}) {
    if (!cat || typeof cat !== "object") return resolveThemeEntry("general-misc");

    // 1) الفئات الخاصة بالمستخدم
    if (isCustomCategory(cat, customIdsSet)) {
      return resolveThemeEntry("custom-packs");
    }

    // 2) حقل mainCategory / section صريح من الشيت (يدعم الدول العربية الـ 22 والفئات الموسّعة أو أي قسم جديد)
    const rawExplicit =
      (typeof cat.mainCategory === "string" && cat.mainCategory.trim()) ||
      (typeof cat.section === "string" && cat.section.trim()) ||
      "";
    if (rawExplicit) {
      return resolveThemeEntry(rawExplicit, cat.mainIcon || "");
    }

    // 3) الاعتماد على resolveCategoryGroup الحالي إن كان موجوداً
    const groupId = typeof resolveGroupFn === "function" ? resolveGroupFn(cat) : cat.group;
    if (groupId) {
      return resolveThemeEntry(groupId);
    }

    // 4) أي فئة بدون فئة رئيسية -> منوّعات عامة
    return resolveThemeEntry("general-misc");
  }

  function resolveMainCategoryId(cat, opts = {}) {
    const info = resolveMainCategoryInfo(cat, opts);
    return info ? info.id : "general-misc";
  }

  /**
   * بناء قائمة بطاقات الفئات الرئيسية والدول العربية التي تملك محتوى فعلياً فقط (لا بطاقات فارغة!)
   */
  function buildMainCategoryGroups(allCategories, { resolveGroupFn, customIdsSet, selectedIds = [], getNewCountFn } = {}) {
    const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : []);
    const groupMap = new Map();

    (Array.isArray(allCategories) ? allCategories : []).forEach((cat) => {
      if (!cat || !cat.id || !hasValidQuestions(cat)) return;
      const meta = resolveMainCategoryInfo(cat, { resolveGroupFn, customIdsSet });
      if (!groupMap.has(meta.id)) {
        groupMap.set(meta.id, {
          ...meta,
          color: meta.accent || meta.color || "#38bdf8",
          accent: meta.accent || meta.color || "#38bdf8",
          gradient: meta.gradient || "",
          subcategories: [],
          subCount: 0,
          selectedCount: 0,
          newQuestionsTotal: 0
        });
      }
      const bucket = groupMap.get(meta.id);
      bucket.subcategories.push(cat);
      bucket.subCount += 1;
      if (selectedSet.has(cat.id)) bucket.selectedCount += 1;
      bucket.newQuestionsTotal += typeof getNewCountFn === "function" ? getNewCountFn(cat) : (cat.questions ? cat.questions.length : 0);
    });

    const themes = window.SeenJeemCategoryThemes;
    return Array.from(groupMap.values())
      .filter((g) => g.subCount > 0)
      .sort((a, b) => {
        const ordA = Number.isFinite(Number(a.order)) ? Number(a.order) : themes ? themes.getOrderIndex(a.id) : 500;
        const ordB = Number.isFinite(Number(b.order)) ? Number(b.order) : themes ? themes.getOrderIndex(b.id) : 500;
        if (ordA !== ordB) return ordA - ordB;
        return String(a.label || "").localeCompare(String(b.label || ""), "ar");
      });
  }

  /**
   * البحث الفوري + الفلاتر السريعة عبر الفئات الفرعية (يدعم النطاق الشامل أو التصفية داخل الفئة الرئيسية المفتوحة)
   */
  function filterSubcategories(
    allCategories,
    {
      query = "",
      quickFilter = "all", // "all" | "new" | "media" | "custom" | "favorites"
      activeMainId = null,
      scopeToActiveMain = false,
      favoritesList = null,
      customIdsSet = null,
      resolveGroupFn = null,
      getNewCountFn = null
    } = {}
  ) {
    const favSet = new Set(Array.isArray(favoritesList) ? favoritesList : loadFavorites());
    const themes = window.SeenJeemCategoryThemes;
    const normFn = themes && typeof themes.normalizeArabic === "function" ? themes.normalizeArabic : normalizeArabicSearch;
    const stripAlFn = themes && typeof themes.stripLeadingAl === "function" ? themes.stripLeadingAl : (s) => s;
    const normQ = normFn(query);
    const normQNoAl = stripAlFn(normQ);
    const isGlobalSearchOrFilter = !scopeToActiveMain && (Boolean(normQ) || quickFilter !== "all");

    return (Array.isArray(allCategories) ? allCategories : [])
      .filter((cat) => {
        if (!cat || !cat.id || !hasValidQuestions(cat)) return false;
        const mainMeta = resolveMainCategoryInfo(cat, { resolveGroupFn, customIdsSet });

        if ((scopeToActiveMain || !isGlobalSearchOrFilter) && activeMainId && mainMeta.id !== activeMainId) {
          return false;
        }

        if (quickFilter === "new") {
          const n = typeof getNewCountFn === "function" ? getNewCountFn(cat) : (cat.questions ? cat.questions.length : 0);
          if (n <= 0) return false;
        } else if (quickFilter === "media") {
          if (!isMediaCategory(cat)) return false;
        } else if (quickFilter === "custom") {
          if (!isCustomCategory(cat, customIdsSet)) return false;
        } else if (quickFilter === "favorites") {
          if (!favSet.has(cat.id)) return false;
        }

        if (normQ) {
          const aliasesStr = Array.isArray(mainMeta.aliases) ? mainMeta.aliases.join(" ") : "";
          const hay = normFn(`${cat.name || ""} ${cat.description || ""} ${mainMeta.label || ""} ${aliasesStr}`);
          if (!hay.includes(normQ) && (!normQNoAl || !hay.includes(normQNoAl))) return false;
        }

        return true;
      })
      .map((cat) => ({
        category: cat,
        mainMeta: resolveMainCategoryInfo(cat, { resolveGroupFn, customIdsSet })
      }));
  }

  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /**
   * زر «🎲 كمّلها عشوائياً»: يُكمل الخانات المتبقية فقط مع أولوية للفئات الجديدة وتنويع الفئات الرئيسية
   */
  function completeRandomSelection(
    allCategories,
    currentSelectedIds = [],
    targetCount = 6,
    { resolveGroupFn = null, customIdsSet = null, getNewCountFn = null, hasMinQuestionsFn = null } = {}
  ) {
    const target = Math.max(1, Number(targetCount) || 6);
    const all = Array.isArray(allCategories) ? allCategories.filter((c) => c && c.id) : [];
    const existingSet = new Set(Array.isArray(currentSelectedIds) ? currentSelectedIds : []);
    const result = Array.isArray(currentSelectedIds) ? currentSelectedIds.slice(0, target) : [];
    if (result.length >= target) return { selectedIds: result, addedCount: 0, addedGroupsCount: 0 };

    const eligible =
      typeof hasMinQuestionsFn === "function" && all.filter(hasMinQuestionsFn).length >= target
        ? all.filter(hasMinQuestionsFn)
        : all;

    const usedMainIds = new Set();
    result.forEach((id) => {
      const found = all.find((c) => c.id === id);
      if (found) usedMainIds.add(resolveMainCategoryInfo(found, { resolveGroupFn, customIdsSet }).id);
    });

    const newCountOf = (cat) =>
      typeof getNewCountFn === "function" ? getNewCountFn(cat) : cat.questions ? cat.questions.length : 0;

    const remainingPool = eligible.filter((c) => !existingSet.has(c.id));
    const unplayedPool = shuffle(remainingPool.filter((c) => newCountOf(c) > 0)).sort(
      (a, b) => newCountOf(b) - newCountOf(a)
    );
    const playedPool = shuffle(remainingPool.filter((c) => newCountOf(c) <= 0));

    let addedCount = 0;
    const addedGroups = new Set();

    const tryPickFrom = (pool, requireNewMain) => {
      for (const cat of pool) {
        if (result.length >= target) break;
        if (existingSet.has(cat.id)) continue;
        const mId = resolveMainCategoryInfo(cat, { resolveGroupFn, customIdsSet }).id;
        if (requireNewMain && usedMainIds.has(mId)) continue;
        result.push(cat.id);
        existingSet.add(cat.id);
        usedMainIds.add(mId);
        addedGroups.add(mId);
        addedCount += 1;
      }
    };

    // 1) غير ملعوبة من فئات رئيسية مختلفة عن المختارة حالياً
    tryPickFrom(unplayedPool, true);
    // 2) بقية غير الملعوبة
    tryPickFrom(unplayedPool, false);
    // 3) منوّعة من الملعوبة إذا استُنفدت غير الملعوبة
    tryPickFrom(playedPool, true);
    tryPickFrom(playedPool, false);

    return { selectedIds: result, addedCount, addedGroupsCount: addedGroups.size };
  }

  window.SeenJeemCategoryBrowser = {
    FAVORITES_STORAGE_KEY,
    MAIN_CATEGORY_CATALOG,
    normalizeArabicSearch,
    hasValidQuestions,
    loadFavorites,
    saveFavorites,
    isFavorite,
    toggleFavorite,
    importFavorites,
    getCategoryContentBadges,
    isMediaCategory,
    isCustomCategory,
    resolveMainCategoryInfo,
    resolveMainCategoryId,
    buildMainCategoryGroups,
    filterSubcategories,
    completeRandomSelection
  };
})();
