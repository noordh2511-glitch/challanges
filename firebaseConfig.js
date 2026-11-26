/**
 * إعدادات Firebase Realtime Database للتحكم اللاسلكي (Phase 4 — Pack 9)
 * -------------------------------------------------------------------
 * - اختياري 100%: يظل التطبيق يعمل محلياً وبوضع الأوفلاين بالكامل دون تعبئة هذه الحقول.
 * - يمكنك لصق إعدادات مشروعك من Firebase Console هنا مباشرة، أو إدخالها من داخل التطبيق
 *   عبر نافذة «📡 الغرفة اللاسلكية ← ⚙️ إعدادات الاتصال اللاسلكي» (تُحفظ محلياً في localStorage).
 */
(function () {
  "use strict";

  const STORAGE_KEY = "seen_jeem_firebase_config_v1";

  // إعدادات مشروع Firebase Realtime Database لتطبيق «سين جيم»
  window.SEEN_JEEM_FIREBASE_CONFIG = {
    apiKey: "AIzaSyBEHo7Xw7zHpuToqji2psRsX0rmDXJWTVE",
    authDomain: "seen-jeem-ad984.firebaseapp.com",
    databaseURL: "https://seen-jeem-ad984-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "seen-jeem-ad984",
    storageBucket: "seen-jeem-ad984.firebasestorage.app",
    messagingSenderId: "706774230284",
    appId: "1:706774230284:web:9997c69efcee687d185529",
    measurementId: "G-9KCRTSB014"
  };

  function sanitizeConfig(raw) {
    if (!raw || typeof raw !== "object") {
      return {
        apiKey: "",
        authDomain: "",
        databaseURL: "",
        projectId: "",
        storageBucket: "",
        messagingSenderId: "",
        appId: "",
        measurementId: ""
      };
    }
    const cleanStr = (v) => (typeof v === "string" ? v.trim() : "");
    return {
      apiKey: cleanStr(raw.apiKey),
      authDomain: cleanStr(raw.authDomain),
      databaseURL: cleanStr(raw.databaseURL).replace(/\/+$/, ""),
      projectId: cleanStr(raw.projectId),
      storageBucket: cleanStr(raw.storageBucket),
      messagingSenderId: cleanStr(raw.messagingSenderId),
      appId: cleanStr(raw.appId),
      measurementId: cleanStr(raw.measurementId)
    };
  }

  function isValidConfig(cfg) {
    if (!cfg || typeof cfg !== "object") return false;
    return Boolean(
      cfg.apiKey &&
        cfg.databaseURL &&
        /^https:\/\/.+/i.test(cfg.databaseURL) &&
        cfg.projectId &&
        cfg.appId
    );
  }

  function loadStoredOverride() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return sanitizeConfig(parsed);
    } catch (_err) {
      return null;
    }
  }

  function getConfig() {
    const stored = loadStoredOverride();
    if (stored && isValidConfig(stored)) {
      return stored;
    }
    const fileCfg = sanitizeConfig(window.SEEN_JEEM_FIREBASE_CONFIG);
    if (isValidConfig(fileCfg)) {
      return fileCfg;
    }
    return stored || fileCfg;
  }

  function isConfigured() {
    return isValidConfig(getConfig());
  }

  function saveOverrideConfig(rawCfg) {
    const clean = sanitizeConfig(rawCfg);
    if (!isValidConfig(clean)) {
      return {
        ok: false,
        error: "يرجى تعبئة الحقول المطلوبة: apiKey و databaseURL (يبدأ بـ https://) و projectId و appId."
      };
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      return { ok: true, config: clean };
    } catch (_err) {
      return { ok: false, error: "تعذّر حفظ الإعدادات في المتصفح (localStorage)." };
    }
  }

  function clearOverrideConfig() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_err) {
      // تجاهل
    }
  }

  /**
   * تحليل ذكي لنص الإعدادات سواء كان JSON خالصاً أو كود JS منسوخاً من Firebase Console
   */
  function parseConfigSnippet(rawText) {
    if (typeof rawText !== "string" || !rawText.trim()) return null;
    const text = rawText.trim();
    try {
      const direct = JSON.parse(text);
      if (direct && typeof direct === "object") return sanitizeConfig(direct);
    } catch (_err) {
      // جرّب استخراج الحقول من كود JS
    }

    const extract = (key) => {
      const re = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`);
      const m = text.match(re);
      return m ? m[1].trim() : "";
    };

    const extracted = sanitizeConfig({
      apiKey: extract("apiKey"),
      authDomain: extract("authDomain"),
      databaseURL: extract("databaseURL"),
      projectId: extract("projectId"),
      appId: extract("appId")
    });

    return extracted.apiKey || extracted.databaseURL || extracted.projectId ? extracted : null;
  }

  window.SeenJeemFirebaseConfig = {
    STORAGE_KEY,
    getConfig,
    isConfigured,
    isValidConfig,
    saveOverrideConfig,
    clearOverrideConfig,
    parseConfigSnippet,
    sanitizeConfig
  };
})();
