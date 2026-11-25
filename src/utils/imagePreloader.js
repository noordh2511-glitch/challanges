/**
 * محرك التحميل المسبق لصور التحديات البصرية (Board Image Preloader)
 * - يجمع جميع صور أسئلة اللوحة الحالية فور بدء المباراة (questionImage, answerImage, images)
 * - يحمّل الصور في الخلفية عبر new Image() + img.decode() بتزامن محدود (5 صور بالتوازي) دون تجميد الواجهة
 * - يحتفظ بالصور الجاهزة في ذاكرة الكاش لضمان بدء عداد الذاكرة البصرية (memory) بعد التحميل الفعلي فقط
 */
(function () {
  "use strict";

  const DEFAULT_CONCURRENCY = 5;
  const MAX_CACHE_ENTRIES = 180;

  function normalizeAssetUrl(rawPath) {
    if (typeof rawPath !== "string") return "";
    let p = rawPath.trim();
    if (!p) return "";
    if (/^(https?:|data:|blob:|file:)/i.test(p)) return p;
    return p.replace(/^(\.\/|\/)+/, "");
  }

  function addRetryCacheBuster(url, attempt) {
    if (!attempt || attempt <= 0) return url;
    if (/^(data:|blob:|file:)/i.test(url)) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_retry=${attempt}_${Date.now()}`;
  }

  class ImagePreloader {
    constructor() {
      /** @type {Map<string, HTMLImageElement>} */
      this._decodedCache = new Map();
      /** @type {Map<string, Promise<HTMLImageElement>>} */
      this._inFlight = new Map();
      this._batchToken = 0;
    }

    normalizeUrl(rawPath) {
      return normalizeAssetUrl(rawPath);
    }

    isCached(rawUrl) {
      const url = normalizeAssetUrl(rawUrl);
      if (!url) return false;
      const img = this._decodedCache.get(url);
      return Boolean(img && img.complete && img.naturalWidth > 0);
    }

    _rememberImage(url, img) {
      if (this._decodedCache.size >= MAX_CACHE_ENTRIES && !this._decodedCache.has(url)) {
        const oldestKey = this._decodedCache.keys().next().value;
        if (oldestKey) {
          this._decodedCache.delete(oldestKey);
        }
      }
      this._decodedCache.set(url, img);
    }

    /**
     * تحميل وفك ترميز صورة واحدة (مع إعادة استخدام أي طلب جارٍ لنفس الرابط)
     * @param {string} rawUrl
     * @param {{ retryAttempt?: number }} [options]
     * @returns {Promise<HTMLImageElement>}
     */
    preloadOne(rawUrl, options = {}) {
      const cleanUrl = normalizeAssetUrl(rawUrl);
      if (!cleanUrl) {
        return Promise.reject(new Error("empty-image-url"));
      }

      const retryAttempt = Number(options.retryAttempt) || 0;
      if (retryAttempt === 0 && this.isCached(cleanUrl)) {
        return Promise.resolve(this._decodedCache.get(cleanUrl));
      }

      const effectiveUrl = addRetryCacheBuster(cleanUrl, retryAttempt);
      if (retryAttempt === 0 && this._inFlight.has(cleanUrl)) {
        return this._inFlight.get(cleanUrl);
      }

      const promise = new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = "async";

        let settled = false;
        const finishOk = () => {
          if (settled) return;
          settled = true;
          this._inFlight.delete(cleanUrl);
          if (typeof img.decode === "function") {
            img
              .decode()
              .catch(() => {})
              .finally(() => {
                this._rememberImage(cleanUrl, img);
                resolve(img);
              });
          } else {
            this._rememberImage(cleanUrl, img);
            resolve(img);
          }
        };

        const finishErr = () => {
          if (settled) return;
          settled = true;
          this._inFlight.delete(cleanUrl);
          reject(new Error(`failed-to-load:${cleanUrl}`));
        };

        img.onload = finishOk;
        img.onerror = finishErr;
        img.src = effectiveUrl;

        if (img.complete && img.naturalWidth > 0) {
          finishOk();
        }
      });

      if (retryAttempt === 0) {
        this._inFlight.set(cleanUrl, promise);
      }

      return promise;
    }

    /**
     * جمع جميع روابط الصور المستخدمة في أسئلة لوحة المباراة الحالية
     * مع إعطاء الأولوية لأسئلة memory ثم blur/zoom ثم بقية الصور
     */
    collectBoardUrls(boardCategories) {
      if (!Array.isArray(boardCategories)) return [];

      const highPriority = [];
      const normalPriority = [];
      const seen = new Set();

      const pushUnique = (rawUrl, isHigh) => {
        const clean = normalizeAssetUrl(rawUrl);
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        if (isHigh) {
          highPriority.push(clean);
        } else {
          normalPriority.push(clean);
        }
      };

      boardCategories.forEach((bc) => {
        const slots = [
          ...(Array.isArray(bc.rightColumn) ? bc.rightColumn : []),
          ...(Array.isArray(bc.leftColumn) ? bc.leftColumn : [])
        ];
        slots.forEach((slot) => {
          if (!slot || slot.played || !slot.question) return;
          const q = slot.question;
          const vt = typeof q.visualType === "string" ? q.visualType.toLowerCase() : "normal";
          const isUrgentVisual = vt === "memory" || vt === "blur" || vt === "zoom" || vt === "multi-image";

          if (q.questionImage) pushUnique(q.questionImage, isUrgentVisual);
          if (Array.isArray(q.images)) {
            q.images.forEach((u) => pushUnique(u, isUrgentVisual));
          }
          if (q.answerImage) pushUnique(q.answerImage, false);
        });
      });

      return [...highPriority, ...normalPriority];
    }

    /**
     * تحميل قائمة روابط الصور في الخلفية بحد تزامن منضبط (افتراضياً 5 بالتوازي)
     */
    preloadBoardImages(boardCategories, concurrency = DEFAULT_CONCURRENCY) {
      const urls = this.collectBoardUrls(boardCategories);
      if (urls.length === 0) {
        return Promise.resolve({ total: 0, loaded: 0, failed: 0 });
      }

      const currentToken = ++this._batchToken;
      const safeConcurrency = Math.max(1, Math.min(6, Math.floor(Number(concurrency) || DEFAULT_CONCURRENCY)));
      let cursor = 0;
      let loaded = 0;
      let failed = 0;

      const worker = async () => {
        while (cursor < urls.length && currentToken === this._batchToken) {
          const index = cursor++;
          const targetUrl = urls[index];
          try {
            await this.preloadOne(targetUrl);
            loaded++;
          } catch (_err) {
            failed++;
          }
        }
      };

      const workersCount = Math.min(safeConcurrency, urls.length);
      const workers = [];
      for (let w = 0; w < workersCount; w++) {
        workers.push(worker());
      }

      return Promise.all(workers).then(() => ({
        total: urls.length,
        loaded,
        failed
      }));
    }
  }

  window.SeenJeemImagePreloader = new ImagePreloader();
})();
