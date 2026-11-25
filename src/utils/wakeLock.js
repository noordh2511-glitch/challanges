/**
 * إدارة منع إطفاء الشاشة تلقائياً (Screen Wake Lock API Manager)
 * - يفعّل القفل تلقائياً أثناء لوحة اللعب أو شاشة السؤال أو شاشة العرض التلفزيوني (?mode=display)
 * - يعيد طلب القفل تلقائياً عبر visibilitychange فور عودة التبويب إلى الواجهة
 * - يعالج عدم دعم المتصفح أو رفض الإذن بصمت تام دون أي خطأ في Console
 */
(function () {
  "use strict";

  const STORAGE_KEY = "seen_jeem_wakelock_enabled_v1";

  class WakeLockManager {
    constructor() {
      /** @type {WakeLockSentinel | null} */
      this._sentinel = null;
      this._enabled = this._loadEnabledPref();
      this._desiredActive = false;
      this._acquiring = false;
      /** @type {Set<Function>} */
      this._listeners = new Set();

      this._onVisibilityChange = this._handleVisibilityChange.bind(this);
      this._onPageHide = this._handlePageHide.bind(this);

      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this._onVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", this._onPageHide);
      }
    }

    _loadEnabledPref() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return true; // مفعّل افتراضياً لراحة الجلسات
        return raw !== "false";
      } catch (_err) {
        return true;
      }
    }

    _saveEnabledPref(enabled) {
      try {
        localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
      } catch (_err) {
        // تجاهل في الوضع الخاص
      }
    }

    isSupported() {
      return Boolean(
        typeof navigator !== "undefined" &&
          navigator.wakeLock &&
          typeof navigator.wakeLock.request === "function"
      );
    }

    isEnabled() {
      return Boolean(this._enabled);
    }

    isActive() {
      return Boolean(this._sentinel && !this._sentinel.released);
    }

    setEnabled(enabled) {
      this._enabled = Boolean(enabled);
      this._saveEnabledPref(this._enabled);
      if (this._enabled && this._desiredActive) {
        this.acquire();
      } else if (!this._enabled) {
        this.release();
      }
      this._emit();
      return this._enabled;
    }

    /**
     * مزامنة حالة Wake Lock مع السياق الحالي (لوحة اللعب / السؤال / التلفزيون = true، شاشة الإعداد = false)
     * @param {boolean} shouldStayAwake
     */
    syncForContext(shouldStayAwake) {
      this._desiredActive = Boolean(shouldStayAwake);
      if (this._desiredActive && this._enabled) {
        this.acquire();
      } else {
        this.release();
      }
    }

    async acquire() {
      if (!this._enabled || !this._desiredActive) return false;
      if (!this.isSupported()) return false;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      if (this.isActive() || this._acquiring) return this.isActive();

      this._acquiring = true;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        this._sentinel = sentinel;
        sentinel.addEventListener("release", () => {
          if (this._sentinel === sentinel) {
            this._sentinel = null;
          }
          this._emit();
        });
        this._emit();
        return true;
      } catch (_err) {
        // رفض الإذن أو عدم الدعم يتم بصمت تام
        this._sentinel = null;
        this._emit();
        return false;
      } finally {
        this._acquiring = false;
      }
    }

    async release() {
      const current = this._sentinel;
      this._sentinel = null;
      if (!current) {
        this._emit();
        return;
      }
      try {
        if (!current.released) {
          await current.release();
        }
      } catch (_err) {
        // تجاهل بصمت
      }
      this._emit();
    }

    _handleVisibilityChange() {
      if (document.visibilityState === "visible" && this._desiredActive && this._enabled) {
        this.acquire();
      }
    }

    _handlePageHide() {
      this.release();
    }

    onChange(cb) {
      if (typeof cb !== "function") return () => {};
      this._listeners.add(cb);
      return () => this._listeners.delete(cb);
    }

    _emit() {
      const payload = {
        supported: this.isSupported(),
        enabled: this._enabled,
        active: this.isActive(),
        desiredActive: this._desiredActive
      };
      this._listeners.forEach((cb) => {
        try {
          cb(payload);
        } catch (_err) {}
      });
    }

    destroy() {
      this._desiredActive = false;
      this.release();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", this._onVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", this._onPageHide);
      }
    }
  }

  window.SeenJeemWakeLock = new WakeLockManager();
})();
