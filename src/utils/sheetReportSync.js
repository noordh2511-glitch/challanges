/**
 * مزامنة وإرسال بلاغات الأسئلة تلقائياً إلى Google Sheets (Sheet Report Sync — Pack 13)
 * - يرسل البلاغات عبر POST بهيدر Content-Type: text/plain;charset=utf-8 لتفادي فشل CORS Preflight مع Google Apps Script
 * - لا يعلّق الواجهة مطلقاً عند انقطاع الإنترنت أو بطء الشبكة (AbortController 10 ثوانٍ)
 * - يتتبع حالة كل بلاغ (pending | sent | failed) لمنع التكرار، مع زر إرسال جميع البلاغات المعلّقة وزر اختبار الإرسال
 */
(function () {
  "use strict";

  const CONFIG_STORAGE_KEY = "seen_jeem_sheet_report_cfg_v1";
  const REQUEST_TIMEOUT_MS = 10000;

  function sanitizeConfig(raw) {
    if (!raw || typeof raw !== "object") return { webhookUrl: "", secret: "" };
    const webhookUrl = typeof raw.webhookUrl === "string" ? raw.webhookUrl.trim() : "";
    const secret = typeof raw.secret === "string" ? raw.secret.trim().slice(0, 128) : "";
    return { webhookUrl, secret };
  }

  function isValidWebhookUrl(url) {
    if (typeof url !== "string") return false;
    const t = url.trim();
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(\?.*)?$/i.test(t) || /^https:\/\/.+/i.test(t);
  }

  class SheetReportSync {
    constructor() {
      this._cfg = this._loadConfig();
    }

    _loadConfig() {
      try {
        const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (!raw) return { webhookUrl: "", secret: "" };
        return sanitizeConfig(JSON.parse(raw));
      } catch (_err) {
        return { webhookUrl: "", secret: "" };
      }
    }

    getConfig() {
      return { ...this._cfg };
    }

    isConfigured() {
      return isValidWebhookUrl(this._cfg.webhookUrl);
    }

    saveConfig(raw) {
      const clean = sanitizeConfig(raw);
      if (clean.webhookUrl && !isValidWebhookUrl(clean.webhookUrl)) {
        return {
          ok: false,
          error: "يرجى إدخال رابط Google Apps Script Web App صحيح يبدأ بـ https://script.google.com/macros/s/..."
        };
      }
      this._cfg = clean;
      try {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(clean));
      } catch (_err) {}
      if (window.SeenJeemCloudSync && typeof window.SeenJeemCloudSync.scheduleAutoSync === "function") {
        window.SeenJeemCloudSync.scheduleAutoSync();
      }
      return { ok: true, config: this.getConfig() };
    }

    async _postPayload(payload) {
      if (!this.isConfigured()) {
        return { ok: false, reason: "not-configured", error: "رابط Google Apps Script غير مُعدّ بعد." };
      }
      if (!navigator.onLine) {
        return { ok: false, reason: "offline", error: "لا يوجد اتصال بالإنترنت — تم حفظ البلاغ كمعلّق." };
      }

      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;

      try {
        const body = JSON.stringify({
          ...payload,
          secret: this._cfg.secret || ""
        });
        // قاعدة CORS مع Google Apps Script: استخدام text/plain;charset=utf-8 لتجنب OPTIONS Preflight
        const resp = await fetch(this._cfg.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body,
          ...(controller ? { signal: controller.signal } : {})
        });
        if (timer) clearTimeout(timer);

        if (!resp.ok) {
          return { ok: false, reason: "http-error", error: `فشل الخادم برمز HTTP ${resp.status}` };
        }
        let parsed = null;
        try {
          parsed = await resp.json();
        } catch (_parseErr) {
          // بعض نشرات Apps Script تعيد نصاً عادياً عند النجاح
          return { ok: true, status: "saved" };
        }
        if (parsed && parsed.ok === false) {
          return { ok: false, reason: "script-rejected", error: parsed.error || "رفض السكربت الطلب (تحقق من REPORT_SECRET)." };
        }
        return { ok: true, status: (parsed && parsed.status) || "saved", response: parsed };
      } catch (err) {
        if (timer) clearTimeout(timer);
        const isAbort = err && err.name === "AbortError";
        return {
          ok: false,
          reason: isAbort ? "timeout" : "network-error",
          error: isAbort
            ? "انتهت مهلة الاتصال بالخادم (10 ثوانٍ) — تم حفظ البلاغ كمعلّق."
            : "تعذّر الاتصال برابط Google Apps Script — تحقق من الرابط وصلاحية الوصول (Anyone)."
        };
      }
    }

    async sendFlagRecord(flagRecord) {
      if (!flagRecord || !flagRecord.questionId) {
        return { ok: false, error: "بيانات البلاغ غير مكتملة." };
      }
      const flaggedStore = window.SeenJeemFlaggedStore;
      const reasonMeta =
        flaggedStore && typeof flaggedStore.getReasonMeta === "function"
          ? flaggedStore.getReasonMeta(flagRecord.reason)
          : { label: flagRecord.reason || "أخرى" };

      const res = await this._postPayload({
        reportId: flagRecord.reportId || `rep_${flagRecord.questionId}_${flagRecord.flaggedAt || Date.now()}`,
        reportedAt: flagRecord.reportedAt || flagRecord.flaggedAt || Date.now(),
        questionId: flagRecord.questionId,
        categoryId: flagRecord.categoryId || "",
        categoryName: flagRecord.categoryName || flagRecord.categoryId || "",
        points: Number(flagRecord.points) || 200,
        visualType: flagRecord.visualType || "normal",
        questionText: flagRecord.questionText || "",
        answerText: flagRecord.answerText || "",
        reason: flagRecord.reason || "other",
        reasonLabel: reasonMeta.label,
        note: flagRecord.note || ""
      });

      if (flaggedStore && typeof flaggedStore.updateSyncStatus === "function") {
        const nextStatus = res.ok ? "sent" : res.reason === "offline" || res.reason === "not-configured" ? "pending" : "failed";
        flaggedStore.updateSyncStatus(flagRecord.questionId, nextStatus);
      }
      if (window.SeenJeemCloudSync && typeof window.SeenJeemCloudSync.scheduleAutoSync === "function") {
        window.SeenJeemCloudSync.scheduleAutoSync();
      }
      return res;
    }

    async sendAllPending() {
      const flaggedStore = window.SeenJeemFlaggedStore;
      if (!flaggedStore) return { ok: false, total: 0, sent: 0, failed: 0, error: "مخزن البلاغات غير متاح." };
      if (!this.isConfigured()) {
        return { ok: false, total: 0, sent: 0, failed: 0, error: "يرجى إدخال وحفظ رابط Google Apps Script أولاً." };
      }
      const pending = flaggedStore.getAll().filter((item) => item.sheetSyncStatus !== "sent" && !item.reportedToSheet);
      if (pending.length === 0) {
        return { ok: true, total: 0, sent: 0, failed: 0 };
      }

      let sent = 0;
      let failed = 0;
      let lastError = "";
      for (let i = 0; i < pending.length; i++) {
        const r = await this.sendFlagRecord(pending[i]);
        if (r.ok) sent++;
        else {
          failed++;
          lastError = r.error || lastError;
        }
      }
      return { ok: failed === 0, total: pending.length, sent, failed, error: lastError };
    }

    async testConnection() {
      return this._postPayload({
        isTest: true,
        reportId: `test_${Date.now().toString(36)}`,
        reportedAt: Date.now(),
        questionId: "TEST-001",
        categoryId: "test",
        categoryName: "اختبار اتصال سين جيم",
        points: 200,
        visualType: "normal",
        questionText: "صف تجريبي للتحقق من ربط البلاغات التلقائي مع Google Sheets",
        answerText: "الاتصال يعمل بنجاح ✅",
        reason: "other",
        reasonLabel: "اختبار اتصال",
        note: "يمكنك حذف هذا الصف التجريبي بأمان"
      });
    }
  }

  window.SeenJeemSheetReportSync = new SheetReportSync();
})();
