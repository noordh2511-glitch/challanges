/**
 * سجل الأعلام والأيقونات والألوان التلقائية للفئات الرئيسية وبطاقات الدول العربية الـ 22 (Pack 20)
 * - يوفّر هوية بصرية موحّدة (أيقونة/علم + لون تمييز accent + تدرّج متوافق مع الثيمات الثلاثة)
 * - يتعرّف تلقائياً على جميع الدول العربية الـ 22 بأي صيغة عربية (بهمزة أو بدون همزة، مع أو بدون «ال» التعريف)
 * - يولّد هوية احتياطية حتمية (Deterministic Fallback) لأي فئة رئيسية جديدة تُضاف مستقبلاً في الشيت
 */
(function () {
  "use strict";

  function normalizeArabic(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/[^\u0600-\u06FFa-zA-Z0-9\s-]/g, " ")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  }

  function stripLeadingAl(normText) {
    const s = String(normText || "").trim();
    if (!s) return "";
    return s.startsWith("ال") && s.length > 3 ? s.slice(2).trim() : s;
  }

  function hexToRgba(hex, alpha) {
    const clean = String(hex || "#38bdf8").replace("#", "").trim();
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const num = parseInt(full, 16);
    if (!Number.isFinite(num)) return `rgba(56, 189, 248, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function buildGradient(accent) {
    return `linear-gradient(145deg, ${hexToRgba(accent, 0.24)} 0%, ${hexToRgba(accent, 0.08)} 55%, rgba(15, 23, 42, 0.42) 100%)`;
  }

  function makeEntry(raw) {
    const accent = raw.accent || raw.color || "#38bdf8";
    return Object.freeze({
      id: raw.id,
      label: raw.label,
      icon: raw.icon,
      color: accent,
      accent,
      gradient: raw.gradient || buildGradient(accent),
      isCountry: Boolean(raw.isCountry),
      order: Number(raw.order) || 100,
      aliases: Object.freeze(Array.isArray(raw.aliases) ? raw.aliases : [])
    });
  }

  /* =========================================================
     أ) بطاقات الدول العربية الـ 22 (كل دولة كبطاقة فئة رئيسية مستقلة)
     ========================================================= */
  const ARAB_COUNTRIES = Object.freeze(
    [
      { id: "country-jordan", label: "الأردن", icon: "🇯🇴", accent: "#ef4444", order: 20, aliases: ["الاردن", "اردن", "المملكة الأردنية الهاشمية", "المملكه الاردنيه", "jordan"] },
      { id: "country-egypt", label: "مصر", icon: "🇪🇬", accent: "#f59e0b", order: 21, aliases: ["مصر", "جمهورية مصر العربية", "ام الدنيا", "egypt"] },
      { id: "country-saudi", label: "السعودية", icon: "🇸🇦", accent: "#10b981", order: 22, aliases: ["السعوديه", "سعوديه", "المملكة العربية السعودية", "المملكه العربيه السعوديه", "saudi", "ksa"] },
      { id: "country-palestine", label: "فلسطين", icon: "🇵🇸", accent: "#22c55e", order: 23, aliases: ["فلسطين", "دولة فلسطين", "القدس وفلسطين", "palestine"] },
      { id: "country-syria", label: "سوريا", icon: "🇸🇾", accent: "#e11d48", order: 24, aliases: ["سوريا", "سوريه", "سورية", "الجمهورية العربية السورية", "syria"] },
      { id: "country-lebanon", label: "لبنان", icon: "🇱🇧", accent: "#dc2626", order: 25, aliases: ["لبنان", "الجمهورية اللبنانية", "lebanon"] },
      { id: "country-uae", label: "الإمارات", icon: "🇦🇪", accent: "#14b8a6", order: 26, aliases: ["الامارات", "امارات", "الإمارات العربية المتحدة", "الامارات العربيه المتحده", "uae"] },
      { id: "country-kuwait", label: "الكويت", icon: "🇰🇼", accent: "#06b6d4", order: 27, aliases: ["الكويت", "كويت", "دولة الكويت", "kuwait"] },
      { id: "country-iraq", label: "العراق", icon: "🇮🇶", accent: "#b91c1c", order: 28, aliases: ["العراق", "عراق", "جمهورية العراق", "iraq"] },
      { id: "country-morocco", label: "المغرب", icon: "🇲🇦", accent: "#ef4444", order: 29, aliases: ["المغرب", "مغرب", "المملكة المغربية", "morocco"] },
      { id: "country-algeria", label: "الجزائر", icon: "🇩🇿", accent: "#16a34a", order: 30, aliases: ["الجزائر", "جزائر", "الجمهورية الجزائرية", "algeria"] },
      { id: "country-tunisia", label: "تونس", icon: "🇹🇳", accent: "#f43f5e", order: 31, aliases: ["تونس", "الجمهورية التونسية", "tunisia"] },
      { id: "country-qatar", label: "قطر", icon: "🇶🇦", accent: "#9f1239", order: 32, aliases: ["قطر", "دولة قطر", "qatar"] },
      { id: "country-bahrain", label: "البحرين", icon: "🇧🇭", accent: "#e11d48", order: 33, aliases: ["البحرين", "بحرين", "مملكة البحرين", "bahrain"] },
      { id: "country-oman", label: "عُمان", icon: "🇴🇲", accent: "#059669", order: 34, aliases: ["عمان", "عُمان", "سلطنة عمان", "سلطنة عُمان", "oman"] },
      { id: "country-yemen", label: "اليمن", icon: "🇾🇪", accent: "#dc2626", order: 35, aliases: ["اليمن", "يمن", "الجمهورية اليمنية", "yemen"] },
      { id: "country-sudan", label: "السودان", icon: "🇸🇩", accent: "#0d9488", order: 36, aliases: ["السودان", "سودان", "جمهورية السودان", "sudan"] },
      { id: "country-libya", label: "ليبيا", icon: "🇱🇾", accent: "#10b981", order: 37, aliases: ["ليبيا", "دولة ليبيا", "libya"] },
      { id: "country-mauritania", label: "موريتانيا", icon: "🇲🇷", accent: "#16a34a", order: 38, aliases: ["موريتانيا", "موريطانيا", "mauritania"] },
      { id: "country-somalia", label: "الصومال", icon: "🇸🇴", accent: "#38bdf8", order: 39, aliases: ["الصومال", "صومال", "somalia"] },
      { id: "country-djibouti", label: "جيبوتي", icon: "🇩🇯", accent: "#0ea5e9", order: 40, aliases: ["جيبوتي", "جمهورية جيبوتي", "djibouti"] },
      { id: "country-comoros", label: "جزر القمر", icon: "🇰🇲", accent: "#22c55e", order: 41, aliases: ["جزر القمر", "القمر", "comoros"] }
    ].map((c) => makeEntry({ ...c, isCountry: true }))
  );

  /* =========================================================
     ب) الفئات الرئيسية الموسّعة والمرجعية (مع التوافق التام مع الفئات الحالية)
     ========================================================= */
  const MAIN_THEMES = Object.freeze(
    [
      { id: "custom-packs", label: "فئاتي الخاصة", icon: "✨", accent: "#f59e0b", order: 1, aliases: ["فئاتي الخاصة", "فئات خاصة", "فئاتي", "custom", "custom-packs"] },
      { id: "egyptian-cinema", label: "الفن والسينما المصرية", icon: "🎬", accent: "#ec4899", order: 10, aliases: ["الفن والسينما المصرية", "السينما المصرية", "أفلام مصرية", "افلام مصريه", "فن وسينما مصرية"] },
      { id: "arab-drama", label: "الدراما العربية", icon: "📺", accent: "#a855f7", order: 11, aliases: ["الدراما العربية", "دراما عربية", "مسلسلات عربية", "الدراما والمسلسلات العربية"] },
      { id: "world-cinema-anime", label: "السينما العالمية والأنمي", icon: "🍿", accent: "#f43f5e", order: 12, aliases: ["السينما العالمية والأنمي", "السينما العالمية والانمي", "سينما عالمية", "أنمي", "انمي", "افلام عالمية"] },
      { id: "football-sports", label: "كرة القدم والرياضة", icon: "⚽", accent: "#10b981", order: 13, aliases: ["كرة القدم والرياضة", "كره القدم والرياضه", "رياضة وكرة قدم", "كرة القدم", "رياضة"] },
      { id: "music-songs", label: "الموسيقى والأغاني", icon: "🎵", accent: "#8b5cf6", order: 14, aliases: ["الموسيقى والأغاني", "الموسيقي والاغاني", "موسيقى وأغاني", "أغاني", "موسيقى"] },
      { id: "geo-science-culture", label: "جغرافيا وعلوم وثقافة عامة", icon: "🌍", accent: "#06b6d4", order: 15, aliases: ["جغرافيا وعلوم وثقافة عامة", "ثقافة عامة وعلوم وجغرافيا", "ثقافة وجغرافيا وعلوم"] },
      { id: "islamic-history", label: "إسلاميات وتاريخ إسلامي", icon: "🕌", accent: "#14b8a6", order: 16, aliases: ["إسلاميات وتاريخ إسلامي", "اسلاميات وتاريخ اسلامي", "إسلاميات", "تاريخ إسلامي", "ثقافة إسلامية"] },
      { id: "tech-cars-trend", label: "التكنولوجيا والسيارات والتريند", icon: "🎮", accent: "#6366f1", order: 17, aliases: ["التكنولوجيا والسيارات والتريند", "تكنولوجيا وسيارات وتريند", "تقنية وسيارات", "ألعاب وتقنية"] },

      // فئات المجموعات المرجعية الحالية لضمان استقرار البنك المدمج 100%
      { id: "jordan-arab", label: "الأردن والعرب وإسلاميات", icon: "🇯🇴", accent: "#ef4444", order: 50, aliases: ["الأردن والعرب وإسلاميات", "الاردن والعرب واسلاميات"] },
      { id: "culture-geo", label: "ثقافة وجغرافيا وتاريخ", icon: "🌍", accent: "#06b6d4", order: 51, aliases: ["ثقافة وجغرافيا وتاريخ", "ثقافه وجغرافيا وتاريخ"] },
      { id: "science-tech", label: "علوم وتقنية وطب", icon: "🔬", accent: "#8b5cf6", order: 52, aliases: ["علوم وتقنية وطب", "علوم وتقنيه وطب"] },
      { id: "entertainment", label: "فنون وترفيه وذكريات", icon: "🎬", accent: "#ec4899", order: 53, aliases: ["فنون وترفيه وذكريات"] },
      { id: "sports-life", label: "رياضة ولايف ستايل", icon: "⚽", accent: "#10b981", order: 54, aliases: ["رياضة ولايف ستايل", "رياضه ولايف ستايل"] },
      { id: "puzzles", label: "ألغاز وتحديات ذكاء", icon: "🧩", accent: "#f59e0b", order: 55, aliases: ["ألغاز وتحديات ذكاء", "الغاز وتحديات ذكاء"] },
      { id: "visual", label: "تحديات بصرية وصور", icon: "👁️", accent: "#6366f1", order: 56, aliases: ["تحديات بصرية وصور", "تحديات بصريه وصور"] },
      { id: "charades", label: "من غير كلام", icon: "🎭", accent: "#f97316", order: 57, aliases: ["من غير كلام", "تمثيل صامت"] },
      { id: "general-misc", label: "منوّعات عامة", icon: "📚", accent: "#38bdf8", order: 999, aliases: ["منوّعات عامة", "منوعات عامة", "منوعات", "عام"] }
    ].map(makeEntry)
  );

  const ALL_THEMES = Object.freeze([...MAIN_THEMES, ...ARAB_COUNTRIES]);

  const BY_ID = new Map();
  const BY_KEY = new Map();

  ALL_THEMES.forEach((entry) => {
    BY_ID.set(entry.id.toLowerCase(), entry);
    const allNames = [entry.label, ...entry.aliases];
    allNames.forEach((name) => {
      const n = normalizeArabic(name);
      if (!n) return;
      if (!BY_KEY.has(n)) BY_KEY.set(n, entry);
      const noAl = stripLeadingAl(n);
      if (noAl && !BY_KEY.has(noAl)) BY_KEY.set(noAl, entry);
    });
  });

  const FALLBACK_PALETTE = Object.freeze([
    { accent: "#06b6d4", icon: "📂" },
    { accent: "#a855f7", icon: "🌟" },
    { accent: "#10b981", icon: "🧭" },
    { accent: "#f59e0b", icon: "🎯" },
    { accent: "#ec4899", icon: "🎨" },
    { accent: "#3b82f6", icon: "📘" },
    { accent: "#f97316", icon: "🔥" },
    { accent: "#14b8a6", icon: "💎" }
  ]);

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * إرجاع الهوية البصرية الموحّدة لأي فئة رئيسية أو دولة عربية، أو توليد هوية احتياطية حتمية
   */
  function resolveTheme(rawNameOrId, { fallbackIcon = "" } = {}) {
    const raw = typeof rawNameOrId === "string" ? rawNameOrId.trim() : "";
    if (!raw) return BY_ID.get("general-misc");

    const lower = raw.toLowerCase();
    if (BY_ID.has(lower)) return BY_ID.get(lower);

    const norm = normalizeArabic(raw);
    if (BY_KEY.has(norm)) return BY_KEY.get(norm);

    const noAl = stripLeadingAl(norm);
    if (noAl && BY_KEY.has(noAl)) return BY_KEY.get(noAl);

    // Fallback حتمي لأي فئة رئيسية جديدة تُضاف مستقبلاً في الشيت
    const h = hashString(norm || lower);
    const pick = FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
    const dynId = `main-${(norm || lower).replace(/\s+/g, "-")}`;
    return makeEntry({
      id: dynId,
      label: raw,
      icon: (typeof fallbackIcon === "string" && fallbackIcon.trim()) || pick.icon,
      accent: pick.accent,
      isCountry: false,
      order: 200 + (h % 500)
    });
  }

  function isArabCountry(rawNameOrId) {
    const theme = resolveTheme(rawNameOrId);
    return Boolean(theme && theme.isCountry);
  }

  function getOrderIndex(themeId) {
    const found = BY_ID.get(String(themeId || "").toLowerCase());
    return found ? found.order : 500;
  }

  window.SeenJeemCategoryThemes = {
    ARAB_COUNTRIES,
    MAIN_THEMES,
    ALL_THEMES,
    normalizeArabic,
    stripLeadingAl,
    resolveTheme,
    isArabCountry,
    getOrderIndex,
    buildGradient
  };
})();
