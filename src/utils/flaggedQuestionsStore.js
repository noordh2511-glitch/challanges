/**
 * مخزن الأسئلة المحدّدة للمراجعة (Flagged Questions Store)
 * يُحفظ في localStorage تحت المفتاح `seen-jeem-flagged-v1`
 *
 * Schema:
 * {
 *   questionId: string,
 *   categoryId: string,
 *   categoryName: string,
 *   points: 200 | 400 | 600,
 *   questionText: string,
 *   answerText: string,
 *   reason: 'typo' | 'unclear' | 'broken-image' | 'wrong-info' | 'difficulty' | 'other',
 *   note?: string,
 *   flaggedAt: number
 * }
 */
(function () {
  "use strict";

  const STORAGE_KEY = "seen-jeem-flagged-v1";
  const VALID_POINTS = new Set([200, 400, 600]);

  const FLAG_REASONS = Object.freeze([
    { id: "typo", label: "خطأ إملائي", icon: "✏️" },
    { id: "unclear", label: "صياغة غير واضحة", icon: "❓" },
    { id: "broken-image", label: "صورة معطّلة", icon: "🖼️" },
    { id: "wrong-info", label: "معلومة غير دقيقة", icon: "⚠️" },
    { id: "difficulty", label: "صعوبة غير مناسبة", icon: "⚖️" },
    { id: "other", label: "أخرى", icon: "📝" }
  ]);

  const VALID_REASON_IDS = new Set(FLAG_REASONS.map((r) => r.id));

  function sanitizeFlagRecord(raw) {
    if (!raw || typeof raw !== "object") return null;
    const questionId = typeof raw.questionId === "string" ? raw.questionId.trim() : "";
    if (!questionId) return null;

    const categoryId = typeof raw.categoryId === "string" ? raw.categoryId.trim() : "";
    const categoryName = typeof raw.categoryName === "string" ? raw.categoryName.trim() : "";
    const ptsNum = Number(raw.points);
    const points = VALID_POINTS.has(ptsNum) ? ptsNum : 200;
    const questionText = typeof raw.questionText === "string" ? raw.questionText.trim() : "";
    const answerText = typeof raw.answerText === "string" ? raw.answerText.trim() : "";
    const reason = VALID_REASON_IDS.has(raw.reason) ? raw.reason : "other";
    const note =
      typeof raw.note === "string" && raw.note.trim()
        ? raw.note.trim().slice(0, 240)
        : undefined;
    const flaggedAt =
      Number.isFinite(Number(raw.flaggedAt)) && Number(raw.flaggedAt) > 0
        ? Math.floor(Number(raw.flaggedAt))
        : Date.now();

    const record = {
      questionId,
      categoryId,
      categoryName,
      points,
      questionText,
      answerText,
      reason,
      flaggedAt
    };
    if (note) {
      record.note = note;
    }
    return record;
  }

  function csvCell(val) {
    const str = String(val === undefined || val === null ? "" : val).replace(/"/g, '""');
    return `"${str}"`;
  }

  class FlaggedQuestionsStore {
    constructor() {
      /** @type {Array<Object>} */
      this._items = [];
      this._load();
    }

    _load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          this._items = [];
          return;
        }
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed)
          ? parsed
          : parsed && Array.isArray(parsed.items)
            ? parsed.items
            : [];
        const seen = new Set();
        this._items = [];
        list.forEach((item) => {
          const clean = sanitizeFlagRecord(item);
          if (clean && !seen.has(clean.questionId)) {
            seen.add(clean.questionId);
            this._items.push(clean);
          }
        });
        this._items.sort((a, b) => b.flaggedAt - a.flaggedAt);
      } catch (_err) {
        this._items = [];
      }
    }

    _save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._items));
      } catch (_err) {
        // تجاهل أخطاء امتلاء التخزين
      }
    }

    getReasons() {
      return FLAG_REASONS;
    }

    getReasonMeta(reasonId) {
      return FLAG_REASONS.find((r) => r.id === reasonId) || FLAG_REASONS[FLAG_REASONS.length - 1];
    }

    getAll() {
      return this._items.map((item) => ({ ...item }));
    }

    getCount() {
      return this._items.length;
    }

    isFlagged(questionId) {
      if (typeof questionId !== "string" || !questionId.trim()) return false;
      const id = questionId.trim();
      return this._items.some((item) => item.questionId === id);
    }

    getFlag(questionId) {
      if (typeof questionId !== "string" || !questionId.trim()) return null;
      const id = questionId.trim();
      const found = this._items.find((item) => item.questionId === id);
      return found ? { ...found } : null;
    }

    flagQuestion(payload) {
      const clean = sanitizeFlagRecord({
        ...payload,
        flaggedAt: Date.now()
      });
      if (!clean) return null;

      const idx = this._items.findIndex((item) => item.questionId === clean.questionId);
      if (idx !== -1) {
        this._items[idx] = clean;
      } else {
        this._items.unshift(clean);
      }
      this._items.sort((a, b) => b.flaggedAt - a.flaggedAt);
      this._save();
      return { ...clean };
    }

    unflagQuestion(questionId) {
      if (typeof questionId !== "string" || !questionId.trim()) return false;
      const id = questionId.trim();
      const prevLen = this._items.length;
      this._items = this._items.filter((item) => item.questionId !== id);
      if (this._items.length !== prevLen) {
        this._save();
        return true;
      }
      return false;
    }

    clearAll() {
      const cleared = this._items.length;
      this._items = [];
      this._save();
      return cleared;
    }

    importFlags(rawItems, mode = "merge") {
      const list = Array.isArray(rawItems) ? rawItems : [];
      const cleanIncoming = list.map(sanitizeFlagRecord).filter(Boolean);

      if (mode === "replace") {
        const seen = new Set();
        this._items = [];
        cleanIncoming.forEach((item) => {
          if (!seen.has(item.questionId)) {
            seen.add(item.questionId);
            this._items.push(item);
          }
        });
      } else {
        const byId = new Map(this._items.map((item) => [item.questionId, item]));
        cleanIncoming.forEach((item) => {
          const existing = byId.get(item.questionId);
          if (!existing || item.flaggedAt >= existing.flaggedAt) {
            byId.set(item.questionId, item);
          }
        });
        this._items = Array.from(byId.values());
      }

      this._items.sort((a, b) => b.flaggedAt - a.flaggedAt);
      this._save();
      return this._items.length;
    }

    exportJSON() {
      return JSON.stringify(this._items, null, 2);
    }

    exportCSV() {
      const header = [
        "questionId",
        "categoryId",
        "categoryName",
        "points",
        "reason",
        "reasonAr",
        "note",
        "questionText",
        "answerText",
        "flaggedAtISO"
      ].join(",");

      const rows = this._items.map((item) => {
        const meta = this.getReasonMeta(item.reason);
        return [
          csvCell(item.questionId),
          csvCell(item.categoryId),
          csvCell(item.categoryName),
          csvCell(item.points),
          csvCell(item.reason),
          csvCell(meta.label),
          csvCell(item.note || ""),
          csvCell(item.questionText),
          csvCell(item.answerText),
          csvCell(new Date(item.flaggedAt).toISOString())
        ].join(",");
      });

      // BOM UTF-8 لضمان عرض النص العربي بشكل سليم عند فتحه في Excel / Google Sheets
      return "\uFEFF" + [header, ...rows].join("\r\n");
    }
  }

  window.SeenJeemFlaggedStore = new FlaggedQuestionsStore();
})();
