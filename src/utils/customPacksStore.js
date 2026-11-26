/**
 * مخزن الفئات الخاصة في IndexedDB مع ضغط الصور ودعم المقاطع الصوتية (Custom Packs Store — Pack 12)
 * - يخزّن الفئات الخاصة التي قد تحتوي على صور DataURL مضغوطة ومقاطع صوتية (≤ 2MB) داخل IndexedDB بسعة كبيرة
 * - يحافظ على التوافق الرجعي الكامل مع localStorage["seenJeem_customCategories_v1"]
 * - يوفّر compressImageFile(file) لضغط الصور قبل الحفظ و readAudioFileAsDataUrl(file) للتحقق من الحجم والنوع
 * - يوفّر التصدير/الاستيراد الفردي والدمج الكامل مع backupManager.js
 */
(function () {
  "use strict";

  const DB_NAME = "seen_jeem_custom_packs_v1";
  const DB_VERSION = 1;
  const STORE_NAME = "packs";
  const LEGACY_LS_KEY = "seenJeem_customCategories_v1";
  const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2MB
  const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|opus|webm)$/i;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
      } catch (err) {
        reject(err);
      }
    });
  }

  function sanitizePackObject(rawPack) {
    if (!rawPack || typeof rawPack !== "object") return null;
    const sanitizer = window.SeenJeemSheetSanitizer;
    if (sanitizer && typeof sanitizer.sanitizeCategoriesTree === "function") {
      const res = sanitizer.sanitizeCategoriesTree([rawPack], { allowLegacyLocalVisuals: true });
      const clean = res.categories && res.categories[0];
      if (!clean) return null;
      return {
        ...clean,
        updatedAt: Number(rawPack.updatedAt) || Date.now(),
        source: "custom-pack"
      };
    }
    const id = typeof rawPack.id === "string" && rawPack.id.trim() ? rawPack.id.trim() : `pack_${Date.now().toString(36)}`;
    const name = typeof rawPack.name === "string" && rawPack.name.trim() ? rawPack.name.trim() : "فئة خاصة";
    return {
      id,
      name,
      icon: rawPack.icon || "✨",
      color: rawPack.color || "#06b6d4",
      description: rawPack.description || "",
      group: rawPack.group || "general",
      questions: Array.isArray(rawPack.questions) ? rawPack.questions : [],
      updatedAt: Number(rawPack.updatedAt) || Date.now(),
      source: "custom-pack"
    };
  }

  /**
   * ضغط صورة مرفوعة من جهاز المستخدم عبر Canvas للحفاظ على سرعة الأداء وحجم النسخ الاحتياطية
   */
  function compressImageFile(file, { maxWidth = 1280, maxHeight = 1280, quality = 0.82 } = {}) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith("image/")) {
        reject(new Error("يرجى اختيار ملف صورة صالح (PNG / JPG / WebP)."));
        return;
      }
      // الحفاظ على صور SVG كما هي دون تحويل
      if (file.type === "image/svg+xml") {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("تعذّر قراءة ملف الصورة."));
        reader.readAsDataURL(file);
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error("تعذّر قراءة ملف الصورة."));
      reader.onload = () => {
        const rawDataUrl = String(reader.result || "");
        const img = new Image();
        img.onerror = () => resolve(rawDataUrl);
        img.onload = () => {
          try {
            let w = img.naturalWidth || img.width || 800;
            let h = img.naturalHeight || img.height || 600;
            const scale = Math.min(1, maxWidth / w, maxHeight / h);
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));

            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(rawDataUrl);
              return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            const targetMime = file.type === "image/png" ? "image/webp" : "image/jpeg";
            let out = canvas.toDataURL(targetMime, quality);
            if (!out || out.length < 32) {
              out = canvas.toDataURL("image/jpeg", quality);
            }
            resolve(out.length < rawDataUrl.length ? out : rawDataUrl);
          } catch (_err) {
            resolve(rawDataUrl);
          }
        };
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * قراءة ملف صوتي وتحويله إلى DataURL مع فحص النوع والحد الأقصى الآمن (2MB)
   */
  function readAudioFileAsDataUrl(file, { maxBytes = MAX_AUDIO_BYTES } = {}) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("لم يتم اختيار ملف صوتي."));
        return;
      }
      const mimeOk = typeof file.type === "string" && file.type.toLowerCase().startsWith("audio/");
      const extOk = typeof file.name === "string" && AUDIO_EXT_RE.test(file.name.trim());
      if (!mimeOk && !extOk) {
        reject(new Error("صيغة الملف غير مدعومة — يُقبل MP3 أو WAV أو OGG أو M4A فقط."));
        return;
      }
      if (file.size > maxBytes) {
        const mb = (file.size / (1024 * 1024)).toFixed(2);
        const limitMb = (maxBytes / (1024 * 1024)).toFixed(0);
        reject(new Error(`حجم الملف الصوتي (${mb}MB) يتجاوز الحد الأقصى المسموح (${limitMb}MB).`));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("تعذّر قراءة الملف الصوتي."));
      reader.onload = () => {
        const result = String(reader.result || "");
        if (!/^data:audio\//i.test(result)) {
          // في حال أعاد المتصفح data:application/octet-stream لملف m4a/mp3
          const idx = result.indexOf(",");
          if (idx > 0) {
            resolve(`data:audio/mpeg;base64,${result.slice(idx + 1)}`);
            return;
          }
          reject(new Error("تعذّر ترميز الملف الصوتي."));
          return;
        }
        resolve(result);
      };
      reader.readAsDataURL(file);
    });
  }

  class CustomPacksStore {
    constructor() {
      this._cache = [];
      this._ready = false;
      this._db = null;
    }

    async init() {
      if (this._ready) return this._cache.slice();
      try {
        this._db = await openDatabase();
      } catch (_err) {
        this._db = null;
      }

      let idbPacks = [];
      if (this._db) {
        idbPacks = await this._readAllFromIdb();
      }

      // قراءة أي فئات مخزّنة مسبقاً في localStorage للدمج السلس بدون فقدان
      let legacyPacks = [];
      try {
        const raw = localStorage.getItem(LEGACY_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) legacyPacks = parsed;
        }
      } catch (_err) {}

      const byId = new Map();
      legacyPacks.forEach((p) => {
        const clean = sanitizePackObject(p);
        if (clean) byId.set(clean.id, clean);
      });
      idbPacks.forEach((p) => {
        const clean = sanitizePackObject(p);
        if (clean) byId.set(clean.id, clean);
      });

      this._cache = Array.from(byId.values());
      this._ready = true;
      return this._cache.slice();
    }

    _readAllFromIdb() {
      return new Promise((resolve) => {
        if (!this._db) {
          resolve([]);
          return;
        }
        try {
          const tx = this._db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
          req.onerror = () => resolve([]);
        } catch (_err) {
          resolve([]);
        }
      });
    }

    _putInIdb(pack) {
      return new Promise((resolve) => {
        if (!this._db) {
          resolve(false);
          return;
        }
        try {
          const tx = this._db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).put(pack);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (_err) {
          resolve(false);
        }
      });
    }

    _deleteFromIdb(packId) {
      return new Promise((resolve) => {
        if (!this._db) {
          resolve(false);
          return;
        }
        try {
          const tx = this._db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).delete(packId);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (_err) {
          resolve(false);
        }
      });
    }

    _clearIdb() {
      return new Promise((resolve) => {
        if (!this._db) {
          resolve(false);
          return;
        }
        try {
          const tx = this._db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (_err) {
          resolve(false);
        }
      });
    }

    _tryMirrorLegacyLocalStorage() {
      // محاولة مزامنة الفئات الخفيفة إلى localStorage دون التعطل عند تجاوز الحصة (بسبب الوسائط)
      try {
        const json = JSON.stringify(this._cache);
        if (json.length <= 3 * 1024 * 1024) {
          localStorage.setItem(LEGACY_LS_KEY, json);
        }
      } catch (_err) {
        // IndexedDB هو المخزن المعتمد للوسائط الكبيرة
      }
    }

    getAllSync() {
      return this._cache.slice();
    }

    async getAll() {
      if (!this._ready) await this.init();
      return this._cache.slice();
    }

    async savePack(rawPack) {
      if (!this._ready) await this.init();
      const clean = sanitizePackObject(rawPack);
      if (!clean) return { ok: false, error: "بيانات الفئة غير صالحة." };
      const idx = this._cache.findIndex((p) => p.id === clean.id);
      if (idx >= 0) this._cache[idx] = clean;
      else this._cache.push(clean);
      await this._putInIdb(clean);
      this._tryMirrorLegacyLocalStorage();
      return { ok: true, pack: clean };
    }

    async deletePack(packId) {
      if (!this._ready) await this.init();
      this._cache = this._cache.filter((p) => p.id !== packId);
      await this._deleteFromIdb(packId);
      this._tryMirrorLegacyLocalStorage();
      return { ok: true };
    }

    async clearAll() {
      if (!this._ready) await this.init();
      this._cache = [];
      await this._clearIdb();
      try {
        localStorage.removeItem(LEGACY_LS_KEY);
      } catch (_err) {}
      return { ok: true };
    }

    async importPacks(rawList, mode = "merge") {
      if (!this._ready) await this.init();
      const arr = Array.isArray(rawList) ? rawList : rawList && typeof rawList === "object" ? [rawList] : [];
      const sanitized = arr.map((p) => sanitizePackObject(p)).filter(Boolean);
      if (sanitized.length === 0) {
        return { ok: false, error: "لم يتم العثور على فئات صالحة في الملف." };
      }

      if (mode === "replace") {
        this._cache = [];
        await this._clearIdb();
      }

      const byId = new Map(this._cache.map((p) => [p.id, p]));
      sanitized.forEach((pack) => {
        if (!byId.has(pack.id) || mode === "replace") {
          byId.set(pack.id, pack);
        } else {
          const cur = byId.get(pack.id);
          const seenQ = new Set((cur.questions || []).map((q) => q && q.id));
          const mergedQs = [...(cur.questions || [])];
          (pack.questions || []).forEach((q) => {
            if (q && q.id && !seenQ.has(q.id)) {
              seenQ.add(q.id);
              mergedQs.push(q);
            }
          });
          byId.set(pack.id, { ...cur, ...pack, questions: mergedQs });
        }
      });

      this._cache = Array.from(byId.values());
      for (let i = 0; i < this._cache.length; i++) {
        await this._putInIdb(this._cache[i]);
      }
      this._tryMirrorLegacyLocalStorage();
      return { ok: true, importedCount: sanitized.length, totalCount: this._cache.length };
    }

    exportSinglePackPayload(packId) {
      const pack = this._cache.find((p) => p.id === packId);
      if (!pack) return null;
      return {
        format: "seen-jeem-custom-pack",
        version: 2,
        exportedAt: Date.now(),
        pack
      };
    }

    downloadPackJson(packId) {
      const payload = this.exportSinglePackPayload(packId);
      if (!payload) return false;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = String(payload.pack.id || "custom-pack").replace(/[^a-zA-Z0-9_-]/g, "_");
      a.download = `seen-jeem-pack-${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      return true;
    }
  }

  window.SeenJeemCustomPacksStore = new CustomPacksStore();
  window.SeenJeemCustomPacksUtils = {
    MAX_AUDIO_BYTES,
    compressImageFile,
    readAudioFileAsDataUrl,
    sanitizePackObject
  };
})();
