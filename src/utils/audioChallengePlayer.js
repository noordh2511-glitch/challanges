/**
 * مشغّل التحديات الصوتية المتزامنة (Audio Challenge Player — Pack 12)
 * - يدير تشغيل المقاطع الصوتية المباشرة (HTTPS أو DataURL) داخل الأسئلة بدون أي مكتبات خارجية
 * - يدعم قص المقطع برمجياً عبر audioStart و audioEnd بالثواني دون تعديل الملف الأصلي
 * - يدعم التشغيل السريع لمدة 5 ثوانٍ (Teaser 5s)، التقديم/الإرجاع النسبي، وضبط مستوى الصوت
 * - يكتشف حظر التشغيل التلقائي (Autoplay Policy) ويبلغ الواجهة لعرض زر التفعيل الفوري
 * - لا يعرض أو يسرّب اسم الملف أو الرابط الأصلي للجمهور
 */
(function () {
  "use strict";

  const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|opus|webm)(\?|#|$)/i;

  function isAudioDataUrl(val) {
    return typeof val === "string" && /^data:audio\//i.test(val.trim());
  }

  function isAudioUrl(val) {
    if (typeof val !== "string") return false;
    const t = val.trim();
    if (!t) return false;
    if (isAudioDataUrl(t)) return true;
    return AUDIO_EXT_RE.test(t);
  }

  function formatMmSs(sec) {
    const clean = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(clean / 60);
    const s = clean % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  class AudioChallengePlayer {
    constructor() {
      /** @type {HTMLAudioElement | null} */
      this._audio = null;
      this._src = "";
      this._questionId = "";
      this._clipStart = 0;
      this._clipEnd = null;
      this._rawDuration = 0;
      this._volume = 0.85;
      this._playing = false;
      this._autoplayBlocked = false;
      this._error = "";
      this._teaserStopAt = null;
      this._teaserTimer = null;
      this._listeners = new Set();
      this._rafProgressTimer = null;
    }

    _ensureAudioEl() {
      if (this._audio) return this._audio;
      const el = document.createElement("audio");
      el.preload = "metadata";
      el.crossOrigin = "anonymous";
      el.volume = this._volume;

      el.addEventListener("loadedmetadata", () => {
        const dur = Number(el.duration);
        this._rawDuration = Number.isFinite(dur) && dur > 0 ? dur : 0;
        if (this._clipStart > 0 && (this._rawDuration === 0 || this._clipStart < this._rawDuration)) {
          try {
            el.currentTime = this._clipStart;
          } catch (_err) {}
        }
        this._error = "";
        this._emit();
      });

      el.addEventListener("timeupdate", () => {
        if (!this._playing || el.paused) return;
        this._checkClipBounds();
        const now = Date.now();
        if (!this._lastTimeEmit || now - this._lastTimeEmit >= 180) {
          this._lastTimeEmit = now;
          this._emit();
        }
      });

      el.addEventListener("play", () => {
        this._playing = true;
        this._autoplayBlocked = false;
        this._error = "";
        this._startBoundsWatcher();
        this._emit();
      });

      el.addEventListener("pause", () => {
        this._playing = false;
        this._clearTeaserTimer();
        this._stopBoundsWatcher();
        this._emit();
      });

      el.addEventListener("ended", () => {
        this._playing = false;
        this._clearTeaserTimer();
        this._stopBoundsWatcher();
        this._emit();
      });

      el.addEventListener("error", () => {
        // إذا فشل مع crossOrigin="anonymous" نجرب إعادة التحميل بدون CORS للأصوات العابرة للنطاق
        if (el.crossOrigin && this._src && !isAudioDataUrl(this._src)) {
          el.removeAttribute("crossOrigin");
          el.src = this._src;
          try {
            el.load();
          } catch (_err) {}
          return;
        }
        this._playing = false;
        this._error = "تعذّر تحميل المقطع الصوتي — تأكد من صحة الرابط أو الاتصال.";
        this._stopBoundsWatcher();
        this._emit();
      });

      this._audio = el;
      return el;
    }

    _clearTeaserTimer() {
      if (this._teaserTimer) {
        clearTimeout(this._teaserTimer);
        this._teaserTimer = null;
      }
      this._teaserStopAt = null;
    }

    _startBoundsWatcher() {
      this._stopBoundsWatcher();
      this._rafProgressTimer = setInterval(() => {
        if (!this._audio || this._audio.paused) return;
        this._checkClipBounds();
        this._emit();
      }, 180);
    }

    _stopBoundsWatcher() {
      if (this._rafProgressTimer) {
        clearInterval(this._rafProgressTimer);
        this._rafProgressTimer = null;
      }
    }

    _getEffectiveEnd() {
      const hasClipEnd = Number.isFinite(this._clipEnd) && this._clipEnd > this._clipStart;
      if (hasClipEnd && this._rawDuration > 0) {
        return Math.min(this._clipEnd, this._rawDuration);
      }
      if (hasClipEnd) return this._clipEnd;
      return this._rawDuration > 0 ? this._rawDuration : 0;
    }

    _checkClipBounds() {
      if (!this._audio || !this._playing || this._audio.paused) return;
      const cur = Number(this._audio.currentTime) || 0;
      const effEnd = this._getEffectiveEnd();

      if (this._teaserStopAt !== null && cur >= this._teaserStopAt - 0.05) {
        this.pause();
        return;
      }
      if (effEnd > 0 && cur >= effEnd - 0.05) {
        this._playing = false;
        this._clearTeaserTimer();
        this._stopBoundsWatcher();
        try {
          this._audio.pause();
        } catch (_err) {}
        this._emit();
      }
    }

    onChange(cb) {
      if (typeof cb === "function") this._listeners.add(cb);
      return () => this._listeners.delete(cb);
    }

    _emit() {
      const snapshot = this.getState();
      this._listeners.forEach((cb) => {
        try {
          cb(snapshot);
        } catch (_err) {}
      });
    }

    load(src, { start = 0, end = null, questionId = "" } = {}) {
      const cleanSrc = typeof src === "string" ? src.trim() : "";
      const cleanStart = Number.isFinite(Number(start)) && Number(start) >= 0 ? Number(start) : 0;
      const parsedEnd = end !== null && end !== undefined && end !== "" ? Number(end) : null;
      const cleanEnd =
        parsedEnd !== null && Number.isFinite(parsedEnd) && parsedEnd > cleanStart ? parsedEnd : null;

      if (
        cleanSrc === this._src &&
        questionId === this._questionId &&
        cleanStart === this._clipStart &&
        cleanEnd === this._clipEnd &&
        this._audio
      ) {
        return this.getState();
      }

      this.stop({ keepSrc: false });
      this._src = cleanSrc;
      this._questionId = String(questionId || "");
      this._clipStart = cleanStart;
      this._clipEnd = cleanEnd;
      this._rawDuration = 0;
      this._error = "";
      this._autoplayBlocked = false;

      if (!cleanSrc) {
        this._emit();
        return this.getState();
      }

      const el = this._ensureAudioEl();
      if (isAudioDataUrl(cleanSrc)) {
        el.removeAttribute("crossOrigin");
      } else {
        el.crossOrigin = "anonymous";
      }
      el.volume = this._volume;
      el.src = cleanSrc;
      try {
        el.load();
      } catch (_err) {}
      this._emit();
      return this.getState();
    }

    async play() {
      if (!this._src) return { ok: false, reason: "no-src" };
      const el = this._ensureAudioEl();
      this._clearTeaserTimer();

      const effEnd = this._getEffectiveEnd();
      const cur = Number(el.currentTime) || 0;
      if (cur < this._clipStart || (effEnd > 0 && cur >= effEnd - 0.15)) {
        try {
          el.currentTime = this._clipStart;
        } catch (_err) {}
      }

      try {
        await el.play();
        this._autoplayBlocked = false;
        this._error = "";
        this._emit();
        return { ok: true };
      } catch (err) {
        const name = (err && err.name) || "";
        const msg = String((err && err.message) || "").toLowerCase();
        if (name === "NotAllowedError" || msg.includes("user didn't interact") || msg.includes("autoplay")) {
          this._autoplayBlocked = true;
          this._playing = false;
          this._emit();
          return { ok: false, reason: "autoplay-blocked" };
        }
        this._playing = false;
        this._error = "تعذّر تشغيل المقطع الصوتي.";
        this._emit();
        return { ok: false, reason: "play-error" };
      }
    }

    pause() {
      this._clearTeaserTimer();
      if (this._audio && !this._audio.paused) {
        try {
          this._audio.pause();
        } catch (_err) {}
      }
      this._playing = false;
      this._stopBoundsWatcher();
      this._emit();
    }

    async replay() {
      if (!this._src) return { ok: false, reason: "no-src" };
      const el = this._ensureAudioEl();
      this._clearTeaserTimer();
      try {
        el.currentTime = this._clipStart;
      } catch (_err) {}
      return this.play();
    }

    async playTeaser(seconds = 5) {
      if (!this._src) return { ok: false, reason: "no-src" };
      const el = this._ensureAudioEl();
      const durSec = Math.max(1, Number(seconds) || 5);
      this._clearTeaserTimer();

      try {
        el.currentTime = this._clipStart;
      } catch (_err) {}

      const effEnd = this._getEffectiveEnd();
      const targetStop =
        effEnd > 0 ? Math.min(effEnd, this._clipStart + durSec) : this._clipStart + durSec;
      this._teaserStopAt = targetStop;

      const res = await this.play();
      if (res.ok) {
        this._teaserStopAt = targetStop;
        this._teaserTimer = setTimeout(() => {
          this.pause();
        }, Math.round((targetStop - this._clipStart) * 1000) + 120);
        this._emit();
      } else {
        this._teaserStopAt = null;
      }
      return res;
    }

    seek(relativeSeconds) {
      if (!this._audio || !this._src) return;
      const rel = Math.max(0, Number(relativeSeconds) || 0);
      const effEnd = this._getEffectiveEnd();
      const maxRel = effEnd > this._clipStart ? effEnd - this._clipStart : 0;
      const clampedRel = maxRel > 0 ? Math.min(maxRel, rel) : rel;
      const target = this._clipStart + clampedRel;
      try {
        this._audio.currentTime = target;
      } catch (_err) {}
      this._emit();
    }

    setVolume(val) {
      const num = Number(val);
      if (!Number.isFinite(num)) return;
      this._volume = Math.min(1, Math.max(0, num));
      if (this._audio) {
        this._audio.volume = this._volume;
      }
      this._emit();
    }

    stop({ keepSrc = false } = {}) {
      this._clearTeaserTimer();
      this._stopBoundsWatcher();
      if (this._audio) {
        try {
          this._audio.pause();
          this._audio.currentTime = this._clipStart || 0;
        } catch (_err) {}
        if (!keepSrc) {
          this._audio.removeAttribute("src");
          try {
            this._audio.load();
          } catch (_err) {}
        }
      }
      this._playing = false;
      this._autoplayBlocked = false;
      if (!keepSrc) {
        this._src = "";
        this._questionId = "";
        this._clipStart = 0;
        this._clipEnd = null;
        this._rawDuration = 0;
        this._error = "";
      }
      this._emit();
    }

    getState() {
      const rawCur = this._audio ? Number(this._audio.currentTime) || 0 : this._clipStart;
      const effEnd = this._getEffectiveEnd();
      const clipDuration =
        effEnd > this._clipStart
          ? Math.max(0, effEnd - this._clipStart)
          : this._clipEnd && this._clipEnd > this._clipStart
            ? this._clipEnd - this._clipStart
            : 0;
      const relCur = Math.max(0, rawCur - this._clipStart);
      const clampedCur = clipDuration > 0 ? Math.min(clipDuration, relCur) : relCur;

      return {
        hasAudio: Boolean(this._src),
        questionId: this._questionId,
        playing: Boolean(this._playing),
        teaserActive: this._teaserStopAt !== null && Boolean(this._playing),
        currentTime: Math.round(clampedCur * 10) / 10,
        duration: Math.round(clipDuration * 10) / 10,
        clipStart: this._clipStart,
        clipEnd: this._clipEnd,
        volume: this._volume,
        autoplayBlocked: Boolean(this._autoplayBlocked),
        error: this._error
      };
    }
  }

  window.SeenJeemAudioChallenge = new AudioChallengePlayer();
  window.SeenJeemAudioChallengeUtils = {
    AudioChallengePlayer,
    isAudioDataUrl,
    isAudioUrl,
    formatMmSs
  };
})();
