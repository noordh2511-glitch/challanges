/**
 * المنقّي الدفاعي لبيانات الشيت والملفات المحلية + كاش العمل دون إنترنت (Stale-While-Revalidate)
 * - ينقّي جميع صفوف الأسئلة والفئات القادمة من Google Sheets CSV أو JSON/الملفات المحلية
 * - يصفر تماماً (undefined) جميع الأعمدة البصرية لأسئلة normal لمنع أعطال الرموز العالقة (مثل , أو ],[ أو ]]})
 * - يتحقق بصرامة من points (200|400|600)، visualType، الأرقام البصرية بدون NaN، zoomOrigin، و showPlus
 * - يزيل المعرّفات المكررة (id) ويسجّلها في تقرير تشخيص «صحة البنك» دون إيقاف التطبيق
 * - يحفظ آخر نسخة صالحة ومنقّاة من الشيت محلياً للإقلاع الفوري دون إنترنت وتحديثها في الخلفية
 */
(function () {
  "use strict";

  const CACHE_STORAGE_KEY = "seen_jeem_sheets_bank_cache_v1";
  const CACHE_SCHEMA_VERSION = 1;

  const VALID_POINTS = new Set([200, 400, 600]);
  const APPROVED_VISUAL_TYPES = new Set(["normal", "blur", "zoom", "multi-image", "memory"]);
  const LEGACY_LOCAL_VISUAL_TYPES = new Set(["spot-diff", "invert", "silhouette"]);

  const VISUAL_FIELD_KEYS = [
    "questionImage",
    "answerImage",
    "images",
    "blurLevel",
    "differencesCount",
    "zoomLevel",
    "zoomOrigin",
    "memorySeconds",
    "showPlus"
  ];

  const DEFAULT_BLUR_LEVEL = 18;
  const MIN_BLUR_LEVEL = 2;
  const MAX_BLUR_LEVEL = 60;

  const DEFAULT_ZOOM_LEVEL = 3.8;
  const MIN_ZOOM_LEVEL = 1.2;
  const MAX_ZOOM_LEVEL = 10;

  const DEFAULT_MEMORY_SECONDS = 10;
  const MIN_MEMORY_SECONDS = 3;
  const MAX_MEMORY_SECONDS = 60;

  const VALID_ORIGIN_KEYWORDS = new Set(["center", "top", "bottom", "left", "right"]);

  /**
   * الكشف عن الرموز العالقة الناتجة عن بقايا JSON/CSV في خلايا الشيت مثل , أو ],[ أو ]]}
   * @param {string} str
   * @returns {boolean}
   */
  function isStuckJsonArtifact(str) {
    if (typeof str !== "string") return false;
    const trimmed = str.trim();
    if (!trimmed) return false;
    return /^[\s,\[\]\{\}"':;\\]+$/.test(trimmed);
  }

  /**
   * قراءة قيمة خلية من كائن صف مع تجاهل حالة الأحرف والمسافات في أسماء الأعمدة
   */
  function getCellRaw(rowObj, ...candidateKeys) {
    if (!rowObj || typeof rowObj !== "object") return undefined;
    for (let i = 0; i < candidateKeys.length; i++) {
      const exactKey = candidateKeys[i];
      if (Object.prototype.hasOwnProperty.call(rowObj, exactKey)) {
        return rowObj[exactKey];
      }
    }
    const keys = Object.keys(rowObj);
    for (let i = 0; i < candidateKeys.length; i++) {
      const target = candidateKeys[i].toLowerCase();
      for (let j = 0; j < keys.length; j++) {
        if (keys[j].trim().toLowerCase() === target) {
          return rowObj[keys[j]];
        }
      }
    }
    return undefined;
  }

  function hasNonEmptyRawValue(val) {
    if (val === undefined || val === null) return false;
    if (typeof val === "string") return val.trim().length > 0;
    if (Array.isArray(val)) return val.some((item) => hasNonEmptyRawValue(item));
    if (typeof val === "boolean") return val === true;
    if (typeof val === "number") return !Number.isNaN(val);
    return true;
  }

  function clampNumber(num, min, max) {
    return Math.min(max, Math.max(min, num));
  }

  /**
   * تحليل رقم آمن مع حدود منطقية وقيمة افتراضية ومنع NaN تماماً
   */
  function sanitizeBoundedNumber(rawVal, { min, max, fallback, integer = false }) {
    if (rawVal === undefined || rawVal === null || (typeof rawVal === "string" && !rawVal.trim())) {
      return { value: fallback, usedDefault: true, wasInvalid: false };
    }
    const str = typeof rawVal === "string" ? rawVal.trim() : String(rawVal);
    if (isStuckJsonArtifact(str)) {
      return { value: fallback, usedDefault: true, wasInvalid: true };
    }
    const parsed = Number(str);
    if (!Number.isFinite(parsed)) {
      return { value: fallback, usedDefault: true, wasInvalid: true };
    }
    const clamped = clampNumber(parsed, min, max);
    const finalVal = integer ? Math.round(clamped) : Math.round(clamped * 100) / 100;
    const wasOutOfRange = finalVal !== parsed && (!integer || Math.round(parsed) !== parsed);
    return { value: finalVal, usedDefault: false, wasInvalid: wasOutOfRange };
  }

  /**
   * تحليل zoomOrigin بأمان (يقبل نسب مئوية مثل "50% 50%" أو كلمات محاذاة قياسية مع fallback إلى "center")
   * @param {unknown} rawVal
   * @returns {{ value: string, wasInvalid: boolean }}
   */
  function sanitizeZoomOrigin(rawVal) {
    if (rawVal === undefined || rawVal === null) {
      return { value: "center", wasInvalid: false };
    }
    const trimmed = String(rawVal).trim().replace(/\s+/g, " ");
    if (!trimmed) {
      return { value: "center", wasInvalid: false };
    }
    if (isStuckJsonArtifact(trimmed)) {
      return { value: "center", wasInvalid: true };
    }

    // صيغة نسبتين مئويتين: "50% 50%" أو "38.5% 44%"
    const twoPctMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/);
    if (twoPctMatch) {
      const x = Number(twoPctMatch[1]);
      const y = Number(twoPctMatch[2]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const cx = clampNumber(Math.round(x * 10) / 10, 0, 100);
        const cy = clampNumber(Math.round(y * 10) / 10, 0, 100);
        return { value: `${cx}% ${cy}%`, wasInvalid: x < 0 || x > 100 || y < 0 || y > 100 };
      }
    }

    // صيغة نسبة مئوية واحدة: "50%"
    const onePctMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)%$/);
    if (onePctMatch) {
      const x = Number(onePctMatch[1]);
      if (Number.isFinite(x)) {
        const cx = clampNumber(Math.round(x * 10) / 10, 0, 100);
        return { value: `${cx}% 50%`, wasInvalid: x < 0 || x > 100 };
      }
    }

    // كلمات مفتاحية قياسية (center / top left / center center ...)
    const lowerParts = trimmed.toLowerCase().split(" ");
    if (
      lowerParts.length >= 1 &&
      lowerParts.length <= 2 &&
      lowerParts.every((part) => VALID_ORIGIN_KEYWORDS.has(part))
    ) {
      if (lowerParts.length === 1 || (lowerParts[0] === "center" && lowerParts[1] === "center")) {
        return { value: lowerParts[0], wasInvalid: false };
      }
      return { value: `${lowerParts[0]} ${lowerParts[1]}`, wasInvalid: false };
    }

    return { value: "center", wasInvalid: true };
  }

  /**
   * تحليل showPlus كقيمة منطقية صريحة (true فقط للقيم الصالحة مثل true | 'true' | 'TRUE' | '1')
   * @param {unknown} rawVal
   * @returns {{ value: boolean, wasInvalid: boolean }}
   */
  function sanitizeShowPlus(rawVal) {
    if (rawVal === undefined || rawVal === null) {
      return { value: false, wasInvalid: false };
    }
    if (typeof rawVal === "boolean") {
      return { value: rawVal, wasInvalid: false };
    }
    if (typeof rawVal === "number") {
      if (rawVal === 1) return { value: true, wasInvalid: false };
      if (rawVal === 0) return { value: false, wasInvalid: false };
      return { value: false, wasInvalid: true };
    }
    const trimmed = String(rawVal).trim();
    if (!trimmed) {
      return { value: false, wasInvalid: false };
    }
    const lower = trimmed.toLowerCase();
    if (lower === "true" || trimmed === "1") {
      return { value: true, wasInvalid: false };
    }
    if (lower === "false" || trimmed === "0") {
      return { value: false, wasInvalid: false };
    }
    return { value: false, wasInvalid: true };
  }

  /**
   * تنظيف مسار صورة مفردة مع رفض أي بقايا JSON عالقة
   */
  function sanitizeImagePath(rawVal) {
    if (rawVal === undefined || rawVal === null) {
      return { value: undefined, wasInvalid: false };
    }
    const trimmed = String(rawVal).trim();
    if (!trimmed) {
      return { value: undefined, wasInvalid: false };
    }
    if (isStuckJsonArtifact(trimmed) || /[\r\n]/.test(trimmed)) {
      return { value: undefined, wasInvalid: true };
    }
    return { value: trimmed, wasInvalid: false };
  }

  /**
   * تنظيف قائمة الصور المتعددة (سواء كانت مصفوفة أو نصاً مفصولاً بـ |)
   */
  function sanitizeImagesList(rawVal) {
    if (rawVal === undefined || rawVal === null) {
      return { value: undefined, wasInvalid: false };
    }
    let parts = [];
    let hadInvalid = false;

    if (Array.isArray(rawVal)) {
      rawVal.forEach((item) => {
        const res = sanitizeImagePath(item);
        if (res.wasInvalid) hadInvalid = true;
        if (res.value) parts.push(res.value);
      });
    } else if (typeof rawVal === "string") {
      const trimmed = rawVal.trim();
      if (!trimmed) {
        return { value: undefined, wasInvalid: false };
      }
      if (isStuckJsonArtifact(trimmed)) {
        return { value: undefined, wasInvalid: true };
      }
      trimmed.split("|").forEach((segment) => {
        const res = sanitizeImagePath(segment);
        if (res.wasInvalid) hadInvalid = true;
        if (res.value) parts.push(res.value);
      });
    } else {
      return { value: undefined, wasInvalid: true };
    }

    return {
      value: parts.length > 0 ? parts : undefined,
      wasInvalid: hadInvalid
    };
  }

  function sanitizeOptionalText(rawVal) {
    if (rawVal === undefined || rawVal === null) {
      return { value: undefined, wasInvalid: false };
    }
    const trimmed = String(rawVal).trim();
    if (!trimmed) {
      return { value: undefined, wasInvalid: false };
    }
    if (isStuckJsonArtifact(trimmed)) {
      return { value: undefined, wasInvalid: true };
    }
    return { value: trimmed, wasInvalid: false };
  }

  /**
   * تنقية صف سؤال واحد بشكل دفاعي صارم ونقي (بدون آثار جانبية)
   *
   * @param {Record<string, any>} rawRow
   * @param {{ defaultCategoryId?: string, allowLegacyLocalVisuals?: boolean }} [options]
   */
  function sanitizeQuestionRow(rawRow, options = {}) {
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      return {
        valid: false,
        question: null,
        rejectedReason: "non-object-row",
        hadStuckFieldsCleaned: false,
        cleanedFields: []
      };
    }

    const cleanedFields = [];

    const idRaw = getCellRaw(rawRow, "id");
    const id = typeof idRaw === "string" || typeof idRaw === "number" ? String(idRaw).trim() : "";

    const catIdRaw = getCellRaw(rawRow, "categoryId");
    const fallbackCatId = typeof options.defaultCategoryId === "string" ? options.defaultCategoryId.trim() : "";
    const categoryId =
      typeof catIdRaw === "string" && catIdRaw.trim() ? catIdRaw.trim() : fallbackCatId;

    const questionRaw = getCellRaw(rawRow, "question");
    const questionText = typeof questionRaw === "string" ? questionRaw.trim() : "";

    const answerRaw = getCellRaw(rawRow, "answer");
    const answerText =
      typeof answerRaw === "string" || typeof answerRaw === "number" ? String(answerRaw).trim() : "";

    if (
      !id ||
      isStuckJsonArtifact(id) ||
      !categoryId ||
      isStuckJsonArtifact(categoryId) ||
      !questionText ||
      isStuckJsonArtifact(questionText) ||
      !answerText ||
      isStuckJsonArtifact(answerText)
    ) {
      return {
        valid: false,
        question: null,
        rejectedReason: "missing-required-fields",
        hadStuckFieldsCleaned: false,
        cleanedFields: []
      };
    }

    // التحقق الصارم من النقاط: رقم صحيح ضمن 200 | 400 | 600 فقط
    const pointsRaw = getCellRaw(rawRow, "points", "po");
    const pointsStr =
      pointsRaw !== undefined && pointsRaw !== null ? String(pointsRaw).trim() : "";
    const pointsNum = pointsStr ? Number(pointsStr) : NaN;
    if (!Number.isInteger(pointsNum) || !VALID_POINTS.has(pointsNum)) {
      return {
        valid: false,
        question: null,
        rejectedReason: "invalid-points",
        hadStuckFieldsCleaned: false,
        cleanedFields: []
      };
    }

    // التحقق الصارم من visualType
    const vtRaw = getCellRaw(rawRow, "visualType");
    const vtTrimmed = vtRaw !== undefined && vtRaw !== null ? String(vtRaw).trim().toLowerCase() : "";
    let visualType = "normal";

    if (!vtTrimmed) {
      visualType = "normal";
    } else if (APPROVED_VISUAL_TYPES.has(vtTrimmed)) {
      visualType = vtTrimmed;
    } else if (options.allowLegacyLocalVisuals && LEGACY_LOCAL_VISUAL_TYPES.has(vtTrimmed)) {
      visualType = vtTrimmed;
    } else {
      visualType = "normal";
      cleanedFields.push("visualType");
    }

    // الحقول النصية الاختيارية المشتركة (hint, explanation)
    const hintRes = sanitizeOptionalText(getCellRaw(rawRow, "hint"));
    if (hintRes.wasInvalid) cleanedFields.push("hint");

    const explanationRes = sanitizeOptionalText(getCellRaw(rawRow, "explanation"));
    if (explanationRes.wasInvalid) cleanedFields.push("explanation");

    // حماية إلزامية لأسئلة normal: تصفير وتجاهل جميع الأعمدة البصرية بالكامل (undefined)
    if (visualType === "normal") {
      VISUAL_FIELD_KEYS.forEach((fieldKey) => {
        const rawFieldVal = getCellRaw(rawRow, fieldKey);
        if (fieldKey === "showPlus") {
          const spCheck = sanitizeShowPlus(rawFieldVal);
          if (spCheck.wasInvalid || spCheck.value === true) {
            cleanedFields.push(fieldKey);
          }
        } else if (hasNonEmptyRawValue(rawFieldVal)) {
          cleanedFields.push(fieldKey);
        }
      });

      const cleanNormalQuestion = {
        id,
        categoryId,
        points: pointsNum,
        visualType: "normal",
        question: questionText,
        answer: answerText,
        questionImage: undefined,
        answerImage: undefined,
        images: undefined,
        hint: hintRes.value,
        explanation: explanationRes.value,
        blurLevel: undefined,
        differencesCount: undefined,
        zoomLevel: undefined,
        zoomOrigin: undefined,
        memorySeconds: undefined,
        showPlus: undefined
      };

      return {
        valid: true,
        question: cleanNormalQuestion,
        hadStuckFieldsCleaned: cleanedFields.length > 0,
        cleanedFields
      };
    }

    // معالجة آمنة لأسئلة التحديات البصرية
    const qImgRes = sanitizeImagePath(getCellRaw(rawRow, "questionImage"));
    if (qImgRes.wasInvalid) cleanedFields.push("questionImage");

    const aImgRes = sanitizeImagePath(getCellRaw(rawRow, "answerImage"));
    if (aImgRes.wasInvalid) cleanedFields.push("answerImage");

    const imgsRes = sanitizeImagesList(getCellRaw(rawRow, "images"));
    if (imgsRes.wasInvalid) cleanedFields.push("images");

    let blurLevel;
    const rawBlur = getCellRaw(rawRow, "blurLevel");
    if (visualType === "blur") {
      const blurRes = sanitizeBoundedNumber(rawBlur, {
        min: MIN_BLUR_LEVEL,
        max: MAX_BLUR_LEVEL,
        fallback: DEFAULT_BLUR_LEVEL,
        integer: false
      });
      if (blurRes.wasInvalid) cleanedFields.push("blurLevel");
      blurLevel = blurRes.value;
    } else if (hasNonEmptyRawValue(rawBlur)) {
      cleanedFields.push("blurLevel");
      blurLevel = undefined;
    }

    let zoomLevel;
    let zoomOrigin;
    const rawZoom = getCellRaw(rawRow, "zoomLevel");
    const rawOrigin = getCellRaw(rawRow, "zoomOrigin");
    if (visualType === "zoom") {
      const zoomRes = sanitizeBoundedNumber(rawZoom, {
        min: MIN_ZOOM_LEVEL,
        max: MAX_ZOOM_LEVEL,
        fallback: DEFAULT_ZOOM_LEVEL,
        integer: false
      });
      if (zoomRes.wasInvalid) cleanedFields.push("zoomLevel");
      zoomLevel = zoomRes.value;

      const originRes = sanitizeZoomOrigin(rawOrigin);
      if (originRes.wasInvalid) cleanedFields.push("zoomOrigin");
      zoomOrigin = originRes.value;
    } else {
      if (hasNonEmptyRawValue(rawZoom)) cleanedFields.push("zoomLevel");
      if (hasNonEmptyRawValue(rawOrigin)) cleanedFields.push("zoomOrigin");
      zoomLevel = undefined;
      zoomOrigin = undefined;
    }

    let memorySeconds;
    const rawMemory = getCellRaw(rawRow, "memorySeconds");
    if (visualType === "memory") {
      const memRes = sanitizeBoundedNumber(rawMemory, {
        min: MIN_MEMORY_SECONDS,
        max: MAX_MEMORY_SECONDS,
        fallback: DEFAULT_MEMORY_SECONDS,
        integer: true
      });
      if (memRes.wasInvalid) cleanedFields.push("memorySeconds");
      memorySeconds = memRes.value;
    } else if (hasNonEmptyRawValue(rawMemory)) {
      cleanedFields.push("memorySeconds");
      memorySeconds = undefined;
    }

    let differencesCount;
    const rawDiff = getCellRaw(rawRow, "differencesCount");
    if (visualType === "spot-diff") {
      if (hasNonEmptyRawValue(rawDiff)) {
        const diffRes = sanitizeBoundedNumber(rawDiff, {
          min: 1,
          max: 20,
          fallback: 3,
          integer: true
        });
        if (diffRes.wasInvalid) cleanedFields.push("differencesCount");
        differencesCount = diffRes.value;
      }
    } else if (hasNonEmptyRawValue(rawDiff)) {
      cleanedFields.push("differencesCount");
      differencesCount = undefined;
    }

    let showPlus;
    const rawShowPlus = getCellRaw(rawRow, "showPlus");
    if (visualType === "multi-image") {
      const spRes = sanitizeShowPlus(rawShowPlus);
      if (spRes.wasInvalid) cleanedFields.push("showPlus");
      showPlus = spRes.value;
    } else {
      const spRes = sanitizeShowPlus(rawShowPlus);
      if (spRes.wasInvalid || spRes.value === true) {
        cleanedFields.push("showPlus");
      }
      showPlus = undefined;
    }

    const cleanVisualQuestion = {
      id,
      categoryId,
      points: pointsNum,
      visualType,
      question: questionText,
      answer: answerText,
      questionImage: qImgRes.value,
      answerImage: aImgRes.value,
      images: imgsRes.value,
      hint: hintRes.value,
      explanation: explanationRes.value,
      blurLevel,
      differencesCount,
      zoomLevel,
      zoomOrigin,
      memorySeconds,
      showPlus
    };

    return {
      valid: true,
      question: cleanVisualQuestion,
      hadStuckFieldsCleaned: cleanedFields.length > 0,
      cleanedFields
    };
  }

  /**
   * تنقية صف فئة من الشيت أو الملفات المحلية
   */
  function sanitizeCategoryRow(rawCat) {
    if (!rawCat || typeof rawCat !== "object" || Array.isArray(rawCat)) return null;
    const idRaw = getCellRaw(rawCat, "id");
    const nameRaw = getCellRaw(rawCat, "name");
    const id = idRaw !== undefined && idRaw !== null ? String(idRaw).trim() : "";
    const name = nameRaw !== undefined && nameRaw !== null ? String(nameRaw).trim() : "";

    if (!id || !name || isStuckJsonArtifact(id) || isStuckJsonArtifact(name)) {
      return null;
    }

    const iconRaw = getCellRaw(rawCat, "icon");
    const icon = iconRaw && String(iconRaw).trim() && !isStuckJsonArtifact(String(iconRaw))
      ? String(iconRaw).trim()
      : "🎯";

    const colorRaw = getCellRaw(rawCat, "color");
    const colorTrimmed = colorRaw ? String(colorRaw).trim() : "";
    const color = /^#[0-9a-fA-F]{3,8}$|^rgba?\([^)]+\)$|^hsla?\([^)]+\)$/.test(colorTrimmed)
      ? colorTrimmed
      : "";

    const descRaw = getCellRaw(rawCat, "description");
    const description =
      descRaw && !isStuckJsonArtifact(String(descRaw)) ? String(descRaw).trim() : "";

    const groupRaw = getCellRaw(rawCat, "group");
    const group =
      groupRaw && !isStuckJsonArtifact(String(groupRaw))
        ? String(groupRaw).trim().toLowerCase()
        : undefined;

    return {
      id,
      name,
      icon,
      color,
      description,
      ...(group ? { group } : {}),
      questions: []
    };
  }

  /**
   * محلل CSV قياسي (RFC-4180)
   */
  function parseCSV(csvText) {
    if (typeof csvText !== "string") return [];
    const text = csvText.replace(/^\uFEFF/, "");
    if (!text.trim()) return [];

    const rows = [];
    let currentRow = [];
    let currentField = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          currentField += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          currentField += ch;
        }
      } else {
        if (ch === '"' && currentField === "") {
          inQuotes = true;
        } else if (ch === ",") {
          currentRow.push(currentField);
          currentField = "";
        } else if (ch === "\r") {
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = "";
          if (next === "\n") i++;
        } else if (ch === "\n") {
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = "";
        } else {
          currentField += ch;
        }
      }
    }

    if (currentField !== "" || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
    if (nonEmptyRows.length <= 1) return [];

    const headers = nonEmptyRows[0].map((h) => h.trim());
    const records = [];

    for (let r = 1; r < nonEmptyRows.length; r++) {
      const row = nonEmptyRows[r];
      const obj = {};
      headers.forEach((header, idx) => {
        if (!header) return;
        obj[header] = typeof row[idx] === "string" ? row[idx] : "";
      });
      records.push(obj);
    }

    return records;
  }

  /**
   * تنقية دفعة فئات محلية (مثل questions.js / extra-questions.js / المستوردة)
   */
  function sanitizeCategoriesTree(rawCategories, options = {}) {
    const safeList = Array.isArray(rawCategories) ? rawCategories : [];
    const seenIds = options.seenQuestionIds instanceof Set ? options.seenQuestionIds : new Set();
    const categories = [];
    const duplicateIds = [];
    let validQuestionsCount = 0;
    let cleanedRowsCount = 0;
    let rejectedRowsCount = 0;

    safeList.forEach((rawCat) => {
      if (!rawCat || typeof rawCat !== "object") return;
      if (rawCat._shellOnly && typeof rawCat.id === "string" && rawCat.id.trim()) {
        const shellCat = { id: rawCat.id.trim(), _shellOnly: true, questions: [] };
        const rawQs = Array.isArray(rawCat.questions) ? rawCat.questions : [];
        rawQs.forEach((rawQ) => {
          const res = sanitizeQuestionRow(rawQ, {
            defaultCategoryId: shellCat.id,
            allowLegacyLocalVisuals: Boolean(options.allowLegacyLocalVisuals)
          });
          if (!res.valid || !res.question) {
            rejectedRowsCount++;
            return;
          }
          if (seenIds.has(res.question.id)) {
            duplicateIds.push(res.question.id);
            return;
          }
          seenIds.add(res.question.id);
          if (res.hadStuckFieldsCleaned) cleanedRowsCount++;
          shellCat.questions.push(res.question);
          validQuestionsCount++;
        });
        if (shellCat.questions.length > 0) {
          categories.push(shellCat);
        }
        return;
      }

      const cleanCat = sanitizeCategoryRow(rawCat);
      if (!cleanCat) return;

      const rawQs = Array.isArray(rawCat.questions) ? rawCat.questions : [];
      rawQs.forEach((rawQ) => {
        const res = sanitizeQuestionRow(rawQ, {
          defaultCategoryId: cleanCat.id,
          allowLegacyLocalVisuals: Boolean(options.allowLegacyLocalVisuals)
        });
        if (!res.valid || !res.question) {
          rejectedRowsCount++;
          return;
        }
        if (seenIds.has(res.question.id)) {
          duplicateIds.push(res.question.id);
          return;
        }
        seenIds.add(res.question.id);
        if (res.hadStuckFieldsCleaned) cleanedRowsCount++;
        cleanCat.questions.push(res.question);
        validQuestionsCount++;
      });

      categories.push(cleanCat);
    });

    return {
      categories,
      diagnostics: {
        validQuestionsCount,
        cleanedRowsCount,
        rejectedRowsCount,
        duplicateCount: duplicateIds.length,
        duplicateIds
      }
    };
  }

  /**
   * تنقية وتحويل نصي CSV (الفئات + الأسئلة) من Google Sheets مع تقرير تشخيص مفصّل
   */
  function sanitizeSheetsCsvToCategories(categoriesCsvText, questionsCsvText, localKnownCategoryIds = []) {
    const catRows = parseCSV(categoriesCsvText);
    const qRows = parseCSV(questionsCsvText);
    const knownLocalSet = new Set(Array.isArray(localKnownCategoryIds) ? localKnownCategoryIds : []);

    const catMap = new Map();
    const orderedCats = [];

    catRows.forEach((row) => {
      const cleanCat = sanitizeCategoryRow(row);
      if (!cleanCat || catMap.has(cleanCat.id)) return;
      catMap.set(cleanCat.id, cleanCat);
      orderedCats.push(cleanCat);
    });

    const seenQuestionIds = new Set();
    const duplicateIds = [];
    let validQuestionsCount = 0;
    let cleanedRowsCount = 0;
    let rejectedRowsCount = 0;

    qRows.forEach((row) => {
      const res = sanitizeQuestionRow(row, { allowLegacyLocalVisuals: false });
      if (!res.valid || !res.question) {
        rejectedRowsCount++;
        return;
      }

      const qObj = res.question;
      if (seenQuestionIds.has(qObj.id)) {
        duplicateIds.push(qObj.id);
        return;
      }

      let targetCat = catMap.get(qObj.categoryId);
      if (!targetCat && knownLocalSet.has(qObj.categoryId)) {
        targetCat = { id: qObj.categoryId, _shellOnly: true, questions: [] };
        catMap.set(qObj.categoryId, targetCat);
        orderedCats.push(targetCat);
      }

      if (!targetCat) {
        rejectedRowsCount++;
        return;
      }

      seenQuestionIds.add(qObj.id);
      if (res.hadStuckFieldsCleaned) {
        cleanedRowsCount++;
      }
      targetCat.questions.push(qObj);
      validQuestionsCount++;
    });

    return {
      categories: orderedCats,
      realCategoriesCount: orderedCats.filter((c) => !c._shellOnly).length,
      questionsCount: validQuestionsCount,
      diagnostics: {
        totalRawRows: qRows.length,
        validQuestionsCount,
        cleanedRowsCount,
        rejectedRowsCount,
        duplicateCount: duplicateIds.length,
        duplicateIds
      }
    };
  }

  /**
   * تحميل آخر نسخة صالحة ومنقّاة من الشيت من الكاش المحلي (Stale-While-Revalidate)
   */
  function loadCachedSheetsBank() {
    try {
      const raw = localStorage.getItem(CACHE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
        !Array.isArray(parsed.categories)
      ) {
        return null;
      }
      const syncedAt = Number(parsed.syncedAt);
      // إعادة التحقق السريع من نظافة الكاش عند قراءته
      const revalidated = sanitizeCategoriesTree(parsed.categories, {
        allowLegacyLocalVisuals: false
      });
      return {
        syncedAt: Number.isFinite(syncedAt) && syncedAt > 0 ? syncedAt : null,
        categories: revalidated.categories,
        diagnostics: parsed.diagnostics && typeof parsed.diagnostics === "object"
          ? {
              totalRawRows: Number(parsed.diagnostics.totalRawRows) || 0,
              validQuestionsCount: Number(parsed.diagnostics.validQuestionsCount) || revalidated.diagnostics.validQuestionsCount,
              cleanedRowsCount: Number(parsed.diagnostics.cleanedRowsCount) || 0,
              rejectedRowsCount: Number(parsed.diagnostics.rejectedRowsCount) || 0,
              duplicateCount: Number(parsed.diagnostics.duplicateCount) || 0,
              duplicateIds: Array.isArray(parsed.diagnostics.duplicateIds)
                ? parsed.diagnostics.duplicateIds.slice(0, 50)
                : []
            }
          : revalidated.diagnostics
      };
    } catch (_err) {
      return null;
    }
  }

  /**
   * حفظ النسخة الصالحة والمنقّاة من الشيت في الكاش المحلي
   */
  function saveCachedSheetsBank(categories, diagnostics, syncedAt = Date.now()) {
    try {
      const payload = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        syncedAt,
        categories: Array.isArray(categories) ? categories : [],
        diagnostics: diagnostics
          ? {
              ...diagnostics,
              duplicateIds: Array.isArray(diagnostics.duplicateIds)
                ? diagnostics.duplicateIds.slice(0, 50)
                : []
            }
          : null
      };
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (_err) {
      return false;
    }
  }

  window.SeenJeemSheetSanitizer = {
    APPROVED_VISUAL_TYPES,
    VALID_POINTS,
    parseCSV,
    sanitizeZoomOrigin,
    sanitizeShowPlus,
    sanitizeBoundedNumber,
    sanitizeQuestionRow,
    sanitizeCategoryRow,
    sanitizeCategoriesTree,
    sanitizeSheetsCsvToCategories,
    loadCachedSheetsBank,
    saveCachedSheetsBank
  };
})();
