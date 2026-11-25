/**
 * مدير تطبيق الويب التقدمي والعمل دون إنترنت (PWA Manager)
 * - يسجّل Service Worker (sw.js) ويعالج التحديثات عبر إشعار «تحديث الآن»
 * - يلتقط حدث beforeinstallprompt لعرض زر «تثبيت التطبيق» ويخفيه عند التثبيت
 * - يراقب حالة الاتصال (navigator.onLine + online/offline) لتحديث شارة وضع عدم الاتصال
 */
(function () {
  "use strict";

  class PWAManager {
    constructor() {
      /** @type {BeforeInstallPromptEvent | null} */
      this._deferredPrompt = null;
      /** @type {ServiceWorkerRegistration | null} */
      this._registration = null;
      /** @type {ServiceWorker | null} */
      this._waitingWorker = null;
      this._online = typeof navigator !== "undefined" ? navigator.onLine !== false : true;
      this._isInstalled = this._detectStandalone();
      this._initialized = false;
      this._reloadingForUpdate = false;

      /** @type {Set<Function>} */
      this._installListeners = new Set();
      /** @type {Set<Function>} */
      this._onlineListeners = new Set();
      /** @type {Set<Function>} */
      this._updateListeners = new Set();
    }

    _detectStandalone() {
      try {
        if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
          return true;
        }
        if (typeof navigator !== "undefined" && navigator.standalone === true) {
          return true;
        }
      } catch (_err) {
        // تجاهل
      }
      return false;
    }

    init() {
      if (this._initialized) return;
      this._initialized = true;

      // 1) مراقبة التثبيت (beforeinstallprompt / appinstalled)
      window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        this._deferredPrompt = event;
        this._emitInstallState();
      });

      window.addEventListener("appinstalled", () => {
        this._deferredPrompt = null;
        this._isInstalled = true;
        this._emitInstallState();
      });

      // 2) مراقبة حالة الاتصال بالإنترنت
      window.addEventListener("online", () => {
        if (!this._online) {
          this._online = true;
          this._emitOnlineState(true);
        }
      });

      window.addEventListener("offline", () => {
        if (this._online) {
          this._online = false;
          this._emitOnlineState(true);
        }
      });

      // 3) تسجيل Service Worker فقط على HTTP/HTTPS الآمن (بما يشمل localhost)
      this._registerServiceWorker();
    }

    _canRegisterSW() {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
      const proto = window.location && window.location.protocol;
      return proto === "https:" || proto === "http:";
    }

    async _registerServiceWorker() {
      if (!this._canRegisterSW()) return;
      try {
        const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
        this._registration = reg;

        if (reg.waiting && navigator.serviceWorker.controller) {
          this._waitingWorker = reg.waiting;
          this._emitUpdateAvailable();
        }

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              this._waitingWorker = installing;
              this._emitUpdateAvailable();
            }
          });
        });

        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (this._reloadingForUpdate) return;
          this._reloadingForUpdate = true;
          window.location.reload();
        });
      } catch (_err) {
        // فشل التسجيل في بيئة غير مدعومة يتم التعامل معه بصمت دون كسر التطبيق
      }
    }

    canInstall() {
      return Boolean(this._deferredPrompt && !this._isInstalled);
    }

    isInstalled() {
      return Boolean(this._isInstalled);
    }

    isOnline() {
      return Boolean(this._online);
    }

    hasPendingUpdate() {
      return Boolean(this._waitingWorker);
    }

    async promptInstall() {
      if (!this._deferredPrompt) {
        return { ok: false, outcome: "unavailable" };
      }
      try {
        const promptEvent = this._deferredPrompt;
        this._deferredPrompt = null;
        this._emitInstallState();
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        const accepted = Boolean(choice && choice.outcome === "accepted");
        if (accepted) {
          this._isInstalled = true;
          this._emitInstallState();
        }
        return { ok: accepted, outcome: choice ? choice.outcome : "dismissed" };
      } catch (_err) {
        return { ok: false, outcome: "error" };
      }
    }

    applyPendingUpdate() {
      if (!this._waitingWorker) return false;
      try {
        this._waitingWorker.postMessage({ type: "SKIP_WAITING" });
        return true;
      } catch (_err) {
        return false;
      }
    }

    onInstallStateChange(cb) {
      if (typeof cb !== "function") return () => {};
      this._installListeners.add(cb);
      return () => this._installListeners.delete(cb);
    }

    onOnlineChange(cb) {
      if (typeof cb !== "function") return () => {};
      this._onlineListeners.add(cb);
      return () => this._onlineListeners.delete(cb);
    }

    onUpdateAvailable(cb) {
      if (typeof cb !== "function") return () => {};
      this._updateListeners.add(cb);
      return () => this._updateListeners.delete(cb);
    }

    _emitInstallState() {
      const payload = { canInstall: this.canInstall(), isInstalled: this._isInstalled };
      this._installListeners.forEach((cb) => {
        try {
          cb(payload);
        } catch (_err) {}
      });
    }

    _emitOnlineState(isTransition = false) {
      const payload = { online: this._online, isTransition };
      this._onlineListeners.forEach((cb) => {
        try {
          cb(payload);
        } catch (_err) {}
      });
    }

    _emitUpdateAvailable() {
      this._updateListeners.forEach((cb) => {
        try {
          cb();
        } catch (_err) {}
      });
    }
  }

  window.SeenJeemPWA = new PWAManager();
})();
