/**
 * بنك كلمات لعبة «برا السالفة» المدمج (100% أوفلاين)
 * - 12 فئة عربية/أردنية مألوفة × 28 كلمة ملموسة وواضحة = 336 كلمة دون تكرار
 * - سجل عدم التكرار (bara-salfa-history-v1) في localStorage لكل فئة مع تصفير فئة أو الكل
 * - فئات خاصة (bara-salfa-custom-v1) في localStorage بحد أدنى 8 كلمات لكل فئة
 */
(function () {
  "use strict";

  const HISTORY_STORAGE_KEY = "bara-salfa-history-v1";
  const CUSTOM_STORAGE_KEY = "bara-salfa-custom-v1";
  const MIN_WORDS_PER_CATEGORY = 8;

  const BUILTIN_CATEGORIES = [
    {
      id: "bs_food",
      name: "أكلات شعبية ومطاعم",
      icon: "🍽️",
      color: "#f59e0b",
      builtin: true,
      words: [
        "منسف", "شاورما", "فلافل", "مقلوبة", "كنافة", "مسخن", "بيتزا",
        "برغر", "مجدرة", "ورق عنب", "ملوخية", "كبسة", "مندي", "حمص",
        "متبل", "فتة", "كبة", "مشاوي", "شيش طاووق", "معكرونة", "لازانيا",
        "سوشي", "برياني", "أوزي", "قلاية بندورة", "كفتة بالطحينية", "فاصوليا", "بامية"
      ]
    },
    {
      id: "bs_drinks",
      name: "مشروبات وحلويات",
      icon: "☕",
      color: "#d97706",
      builtin: true,
      words: [
        "قهوة تركية", "شاي بنعنع", "عصير ليمون ونعنع", "سحلب", "بقلاوة", "قطايف", "كابتشينو",
        "تمر هندي", "عصير مانجو", "عصير رمان", "هوت شوكليت", "آيس كوفي", "كركديه", "قمر الدين",
        "معمول", "عوامة", "بسبوسة", "حلاوة الجبن", "أم علي", "تشيز كيك", "دونات",
        "كرواسون", "بوظة", "شوكولاتة ساخنة", "عصير جزر", "قهوة عربية", "لبن شنينة", "ميلك شيك"
      ]
    },
    {
      id: "bs_animals",
      name: "حيوانات",
      icon: "🦁",
      color: "#10b981",
      builtin: true,
      words: [
        "أسد", "بطريق", "زرافة", "أخطبوط", "جمل", "صقر", "دولفين",
        "قنفذ", "كنغر", "حرباء", "فيل", "نمر", "ذئب", "ثعلب",
        "دب", "باندا", "قرد", "حصان", "غزال", "نسر", "بومة",
        "طاووس", "تمساح", "سلحفاة", "قرش", "حوت", "نعامة", "أرنب"
      ]
    },
    {
      id: "bs_vehicles",
      name: "سيارات ومركبات",
      icon: "🚗",
      color: "#06b6d4",
      builtin: true,
      words: [
        "تويوتا", "مرسيدس", "أودي", "تسلا", "شاحنة", "دراجة نارية", "قطار",
        "مروحية", "قارب", "إسعاف", "بي إم دبليو", "كيا", "هيونداي", "فورد",
        "جيب", "فيراري", "لامبورغيني", "باص", "تاكسي", "دراجة هوائية", "سفينة",
        "غواصة", "طائرة ركاب", "جرافة", "سيارة إطفاء", "سيارة شرطة", "سكوتر كهربائي", "مترو أنفاق"
      ]
    },
    {
      id: "bs_jobs",
      name: "مهن ووظائف",
      icon: "👨‍⚕️",
      color: "#3b82f6",
      builtin: true,
      words: [
        "صيدلاني", "طيار", "مبرمج", "نجار", "شيف", "حكم كرة قدم", "مصور",
        "رائد فضاء", "محامي", "حلاق", "طبيب أسنان", "مهندس معماري", "معلم", "محاسب",
        "ميكانيكي", "كهربائي", "خباز", "سائق تاكسي", "صحفي", "مذيع", "رجل إطفاء",
        "ضابط شرطة", "طبيب بيطري", "خياط", "مصمم جرافيك", "مزارع", "صياد سمك", "مدرب رياضي"
      ]
    },
    {
      id: "bs_places_world",
      name: "دول ومدن",
      icon: "🌍",
      color: "#14b8a6",
      builtin: true,
      words: [
        "الأردن", "البتراء", "العقبة", "القاهرة", "إسطنبول", "باريس", "طوكيو",
        "مكة المكرمة", "دبي", "لندن", "عمّان", "إربد", "الرياض", "جدة",
        "الدوحة", "بيروت", "دمشق", "القدس", "نيويورك", "روما", "مدريد",
        "برشلونة", "برلين", "موسكو", "سيول", "سنغافورة", "ماليزيا", "سويسرا"
      ]
    },
    {
      id: "bs_home",
      name: "أغراض بيتية",
      icon: "🏠",
      color: "#8b5cf6",
      builtin: true,
      words: [
        "مكيف", "مكنسة كهربائية", "ثلاجة", "غسالة", "مكواة", "وسادة", "شاحن",
        "مرآة", "إبريق شاي", "مقلاة", "فرن غاز", "مايكروويف", "خلاط", "غلاية ماء",
        "مروحة", "مدفأة", "بطانية", "سجادة", "ستارة", "ساعة حائط", "مصباح",
        "مكنسة يدوية", "سلة مهملات", "طاولة طعام", "أريكة", "خزانة ملابس", "سكين مطبخ", "طنجرة ضغط"
      ]
    },
    {
      id: "bs_clothes",
      name: "ملابس وإكسسوارات",
      icon: "👔",
      color: "#ec4899",
      builtin: true,
      words: [
        "شماغ", "جاكيت جلد", "ساعة يد", "نظارة شمسية", "حذاء رياضي", "ربطة عنق", "حقيبة ظهر",
        "قميص", "بنطال جينز", "ثوب عربي", "عباءة", "قبعة", "حزام جلد", "خاتم",
        "سوار", "عقد", "وشاح", "قفازات", "جوارب", "معطف شتوي", "بدلة رسمية",
        "حذاء كعب عالٍ", "محفظة نقود", "نظارة طبية", "بيجامة", "هودي", "شبشب", "كاب رياضي"
      ]
    },
    {
      id: "bs_sports",
      name: "رياضة وألعاب",
      icon: "⚽",
      color: "#22c55e",
      builtin: true,
      words: [
        "كرة قدم", "تنس", "سباحة", "شطرنج", "بلوت وطرنيب", "ملاكمة", "بولينغ",
        "رماية", "سباق سيارات", "كرة سلة", "كرة طائرة", "تنس طاولة", "غولف", "جري",
        "رفع أثقال", "مصارعة", "كاراتيه", "تايكوندو", "ركوب خيل", "تزلج على الجليد", "بلياردو",
        "مونوبولي", "أونو", "لودو", "داما", "كيرم", "دومينو", "تسلق جبال"
      ]
    },
    {
      id: "bs_public_places",
      name: "أماكن ومرافق عامة",
      icon: "🏛️",
      color: "#6366f1",
      builtin: true,
      words: [
        "مطار", "مستشفى", "ملعب", "مول", "مكتبة", "صيدلية", "حديقة حيوان",
        "محطة وقود", "سينما", "مخبز", "مدرسة", "جامعة", "مسجد", "بنك",
        "فندق", "مطعم", "مقهى", "متحف", "سوق شعبي", "شاطئ بحر", "منتزه",
        "صالة رياضية", "صالون حلاقة", "مركز شرطة", "محطة قطار", "مدينة ملاهي", "سوبرماركت", "ورشة صيانة"
      ]
    },
    {
      id: "bs_movies",
      name: "أفلام ومسلسلات عربية وعالمية",
      icon: "🎬",
      color: "#ef4444",
      builtin: true,
      words: [
        "الهيبة", "باب الحارة", "مدرسة المشاغبين", "تايتانيك", "سبايدرمان", "باتمان", "توم وجيري",
        "لا كاسا دي بابيل", "مرايا", "بقعة ضوء", "طاش ما طاش", "ضيعة ضايعة", "العيال كبرت", "الأسد الملك",
        "هاري بوتر", "فاست أند فيوريوس", "جون ويك", "أفاتار", "إنترستيلار", "بريكنغ باد", "قيم أوف ثرونز",
        "سكويد قيم", "ناروتو", "ون بيس", "المحقق كونان", "سبونج بوب", "غامبول", "توي ستوري"
      ]
    },
    {
      id: "bs_tech",
      name: "تقنية وتطبيقات",
      icon: "📱",
      color: "#0ea5e9",
      builtin: true,
      words: [
        "واتساب", "يوتيوب", "تيك توك", "خرائط جوجل", "بلايستيشن", "سماعة بلوتوث", "كاميرا",
        "طائرة درون", "ساعة ذكية", "إنستغرام", "سناب شات", "تيليغرام", "سبوتيفاي", "نتفليكس",
        "إكس بوكس", "آيباد", "لابتوب", "راوتر إنترنت", "فلاش ميموري", "طابعة", "ميكروفون",
        "شاشة ذكية", "نظارة واقع افتراضي", "باور بانك", "جوجل كروم", "تشات جي بي تي", "زوم", "أوبر"
      ]
    }
  ];

  function normalizeWordList(rawWords) {
    const arr = Array.isArray(rawWords)
      ? rawWords
      : typeof rawWords === "string"
        ? rawWords.split(/\r?\n/)
        : [];
    const seen = new Set();
    const out = [];
    arr.forEach((w) => {
      if (typeof w !== "string") return;
      const clean = w.trim().replace(/\s+/g, " ").slice(0, 48);
      if (!clean) return;
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(clean);
      }
    });
    return out;
  }

  function safeReadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed !== null && parsed !== undefined ? parsed : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function safeWriteJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function sanitizeCustomCategory(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 40) : "";
    const words = normalizeWordList(raw.words);
    if (!name || words.length < MIN_WORDS_PER_CATEGORY) return null;
    const id =
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim().slice(0, 48)
        : `bs_custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const icon = typeof raw.icon === "string" && raw.icon.trim() ? raw.icon.trim().slice(0, 8) : "✨";
    return {
      id,
      name,
      icon,
      color: typeof raw.color === "string" && raw.color.trim() ? raw.color.trim() : "#a855f7",
      builtin: false,
      words
    };
  }

  function loadCustomCategories() {
    const raw = safeReadJSON(CUSTOM_STORAGE_KEY, []);
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const list = [];
    raw.forEach((item) => {
      const clean = sanitizeCustomCategory(item);
      if (clean && !seen.has(clean.id)) {
        seen.add(clean.id);
        list.push(clean);
      }
    });
    return list;
  }

  function saveCustomCategories(list) {
    const clean = (Array.isArray(list) ? list : []).map(sanitizeCustomCategory).filter(Boolean);
    safeWriteJSON(CUSTOM_STORAGE_KEY, clean);
    return clean;
  }

  function upsertCustomCategory({ id = "", name, icon = "✨", words }) {
    const cleanName = typeof name === "string" ? name.trim().slice(0, 40) : "";
    const cleanWords = normalizeWordList(words);
    if (!cleanName) {
      return { ok: false, error: "يرجى كتابة اسم الفئة أولاً." };
    }
    if (cleanWords.length < MIN_WORDS_PER_CATEGORY) {
      return {
        ok: false,
        error: `يشترط إدخال ${MIN_WORDS_PER_CATEGORY} كلمات مختلفة على الأقل (المتوفر حالياً: ${cleanWords.length}).`
      };
    }

    const list = loadCustomCategories();
    const cleanIcon = typeof icon === "string" && icon.trim() ? icon.trim().slice(0, 8) : "✨";
    const existingIdx = id ? list.findIndex((c) => c.id === id) : -1;

    let saved;
    if (existingIdx >= 0) {
      saved = { ...list[existingIdx], name: cleanName, icon: cleanIcon, words: cleanWords };
      list[existingIdx] = saved;
    } else {
      saved = {
        id: `bs_custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        icon: cleanIcon,
        color: "#a855f7",
        builtin: false,
        words: cleanWords
      };
      list.push(saved);
    }

    saveCustomCategories(list);
    return { ok: true, category: saved };
  }

  function deleteCustomCategory(categoryId) {
    const list = loadCustomCategories().filter((c) => c.id !== categoryId);
    saveCustomCategories(list);
    resetCategoryHistory(categoryId);
    return list;
  }

  function getAllCategories() {
    const builtins = BUILTIN_CATEGORIES.map((c) => ({ ...c, words: c.words.slice() }));
    const customs = loadCustomCategories();
    return [...builtins, ...customs];
  }

  function getCategoryById(categoryId) {
    return getAllCategories().find((c) => c.id === categoryId) || null;
  }

  /* =========================================================
     سجل عدم التكرار (bara-salfa-history-v1)
     ========================================================= */
  function loadHistory() {
    const raw = safeReadJSON(HISTORY_STORAGE_KEY, {});
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    Object.keys(raw).forEach((catId) => {
      if (Array.isArray(raw[catId])) {
        out[catId] = normalizeWordList(raw[catId]);
      }
    });
    return out;
  }

  function saveHistory(historyMap) {
    safeWriteJSON(HISTORY_STORAGE_KEY, historyMap && typeof historyMap === "object" ? historyMap : {});
  }

  function getPlayedWords(categoryId) {
    const hist = loadHistory();
    return Array.isArray(hist[categoryId]) ? hist[categoryId].slice() : [];
  }

  function getCategoryStats(categoryId) {
    const cat = getCategoryById(categoryId);
    if (!cat) return { total: 0, played: 0, remaining: 0 };
    const playedSet = new Set(getPlayedWords(categoryId));
    const played = cat.words.filter((w) => playedSet.has(w)).length;
    return {
      total: cat.words.length,
      played,
      remaining: Math.max(0, cat.words.length - played)
    };
  }

  function markWordPlayed(categoryId, word) {
    if (!categoryId || !word) return;
    const hist = loadHistory();
    const list = Array.isArray(hist[categoryId]) ? hist[categoryId] : [];
    if (!list.includes(word)) {
      list.push(word);
      hist[categoryId] = list;
      saveHistory(hist);
    }
  }

  function resetCategoryHistory(categoryId) {
    const hist = loadHistory();
    if (hist[categoryId]) {
      delete hist[categoryId];
      saveHistory(hist);
    }
  }

  function resetAllHistory() {
    saveHistory({});
  }

  function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /**
   * سحب كلمة سرية غير مكررة من الفئة + 7 كلمات مشتتة من نفس الفئة (المجموع 8 خيارات مخلوطة عشوائياً)
   * إذا انتهت كلمات الفئة، يُصفَّر سجلها تلقائياً لبدء دورة جديدة دون توقف.
   */
  function drawWordAndChoices(categoryId, { excludeWord = "" } = {}) {
    const cat = getCategoryById(categoryId);
    if (!cat || !Array.isArray(cat.words) || cat.words.length < MIN_WORDS_PER_CATEGORY) {
      return null;
    }

    let playedSet = new Set(getPlayedWords(cat.id));
    let unplayed = cat.words.filter((w) => !playedSet.has(w) && w !== excludeWord);
    let cycled = false;

    if (unplayed.length === 0) {
      resetCategoryHistory(cat.id);
      playedSet = new Set();
      unplayed = cat.words.filter((w) => w !== excludeWord);
      if (unplayed.length === 0) unplayed = cat.words.slice();
      cycled = true;
    }

    const secretWord = unplayed[Math.floor(Math.random() * unplayed.length)];
    markWordPlayed(cat.id, secretWord);

    const distractorsPool = shuffleArray(cat.words.filter((w) => w !== secretWord));
    const distractors = distractorsPool.slice(0, 7);
    const guessChoices = shuffleArray([secretWord, ...distractors]);

    return {
      category: {
        id: cat.id,
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        builtin: Boolean(cat.builtin)
      },
      secretWord,
      guessChoices,
      cycled
    };
  }

  function pickRandomCategory() {
    const all = getAllCategories().filter((c) => c.words.length >= MIN_WORDS_PER_CATEGORY);
    if (all.length === 0) return null;
    return all[Math.floor(Math.random() * all.length)];
  }

  /* =========================================================
     دعم النسخ الاحتياطي والاستعادة (backupManager.js)
     ========================================================= */
  function exportBackupData() {
    return {
      customCategories: loadCustomCategories(),
      history: loadHistory()
    };
  }

  function importBackupData({ customCategories, history } = {}, mode = "merge") {
    const isReplace = mode === "replace";
    if (Array.isArray(customCategories)) {
      if (isReplace) {
        saveCustomCategories(customCategories);
      } else {
        const cur = loadCustomCategories();
        const byId = new Map(cur.map((c) => [c.id, c]));
        customCategories.forEach((raw) => {
          const clean = sanitizeCustomCategory(raw);
          if (clean && !byId.has(clean.id)) {
            byId.set(clean.id, clean);
          }
        });
        saveCustomCategories(Array.from(byId.values()));
      }
    }
    if (history && typeof history === "object" && !Array.isArray(history)) {
      if (isReplace) {
        const cleaned = {};
        Object.keys(history).forEach((k) => {
          if (Array.isArray(history[k])) cleaned[k] = normalizeWordList(history[k]);
        });
        saveHistory(cleaned);
      } else {
        const curH = loadHistory();
        Object.keys(history).forEach((k) => {
          if (!Array.isArray(history[k])) return;
          curH[k] = normalizeWordList([...(curH[k] || []), ...history[k]]);
        });
        saveHistory(curH);
      }
    }
  }

  window.SeenJeemBaraSalfaBank = {
    HISTORY_STORAGE_KEY,
    CUSTOM_STORAGE_KEY,
    MIN_WORDS_PER_CATEGORY,
    getAllCategories,
    getCategoryById,
    loadCustomCategories,
    upsertCustomCategory,
    deleteCustomCategory,
    getPlayedWords,
    getCategoryStats,
    markWordPlayed,
    resetCategoryHistory,
    resetAllHistory,
    drawWordAndChoices,
    pickRandomCategory,
    exportBackupData,
    importBackupData
  };
})();
