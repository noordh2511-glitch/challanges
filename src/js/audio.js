/**
 * محرك الصوت التفاعلي عبر Web Audio API للعبة "سين جيم"
 * يعمل بالكامل داخل المتصفح دون الحاجة لملفات صوتية خارجية (Zero External Audio Files).
 * يدعم التحكم بدرجة الصوت الرئيسية (Master Volume) وفصل فئات المؤثرات الصوتية:
 * - timerTicks: دقات المؤقت وجرس انتهاء الوقت
 * - uiEffects: نقرات البطاقات ووسائل المساعدة والتراجع والسرقة
 * - celebrations: كشف الإجابة، احتساب النقاط، والاحتفال بالفوز
 */
(function () {
  "use strict";

  const MUTE_STORAGE_KEY = "seen_jeem_muted";
  const VOLUME_STORAGE_KEY = "seen_jeem_volume_v1";
  const PREFS_STORAGE_KEY = "seen_jeem_audio_prefs_v1";

  const DEFAULT_CATEGORY_PREFS = Object.freeze({
    timerTicks: true,
    uiEffects: true,
    celebrations: true
  });

  function clampVolume(val) {
    const num = Number(val);
    if (!Number.isFinite(num)) return 0.8;
    return Math.min(1, Math.max(0, Math.round(num * 100) / 100));
  }

  class SoundEngine {
    constructor() {
      /** @type {AudioContext | null} */
      this.ctx = null;
      this.muted = this._loadMutedState();
      this.volume = this._loadVolumeState();
      this.categoryPrefs = this._loadCategoryPrefs();
    }

    _loadMutedState() {
      try {
        return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
      } catch (_err) {
        return false;
      }
    }

    _saveMutedState(muted) {
      try {
        localStorage.setItem(MUTE_STORAGE_KEY, muted ? "true" : "false");
      } catch (_err) {
        // تجاهل أخطاء التخزين في الوضع الخاص
      }
    }

    _loadVolumeState() {
      try {
        const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
        if (raw === null) return 0.8;
        return clampVolume(raw);
      } catch (_err) {
        return 0.8;
      }
    }

    _saveVolumeState(vol) {
      try {
        localStorage.setItem(VOLUME_STORAGE_KEY, String(vol));
      } catch (_err) {
        // تجاهل
      }
    }

    _loadCategoryPrefs() {
      try {
        const raw = localStorage.getItem(PREFS_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_CATEGORY_PREFS };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CATEGORY_PREFS };
        return {
          timerTicks: parsed.timerTicks !== undefined ? Boolean(parsed.timerTicks) : true,
          uiEffects: parsed.uiEffects !== undefined ? Boolean(parsed.uiEffects) : true,
          celebrations: parsed.celebrations !== undefined ? Boolean(parsed.celebrations) : true
        };
      } catch (_err) {
        return { ...DEFAULT_CATEGORY_PREFS };
      }
    }

    _saveCategoryPrefs() {
      try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(this.categoryPrefs));
      } catch (_err) {
        // تجاهل
      }
    }

    ensureContext() {
      if (this.muted || this.volume <= 0) return null;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!this.ctx) {
          this.ctx = new AudioCtx();
        }
        if (this.ctx.state === "suspended") {
          const resumePromise = this.ctx.resume();
          if (resumePromise && typeof resumePromise.catch === "function") {
            resumePromise.catch(() => {});
          }
        }
        return this.ctx;
      } catch (_err) {
        return null;
      }
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      this._saveMutedState(this.muted);
    }

    isMuted() {
      return this.muted;
    }

    getVolume() {
      return this.volume;
    }

    setVolume(vol) {
      this.volume = clampVolume(vol);
      this._saveVolumeState(this.volume);
      if (this.volume > 0 && this.muted) {
        this.setMuted(false);
      }
      return this.volume;
    }

    getCategoryPrefs() {
      return { ...this.categoryPrefs };
    }

    setCategoryPrefs(partial) {
      if (!partial || typeof partial !== "object") return this.getCategoryPrefs();
      if (partial.timerTicks !== undefined) {
        this.categoryPrefs.timerTicks = Boolean(partial.timerTicks);
      }
      if (partial.uiEffects !== undefined) {
        this.categoryPrefs.uiEffects = Boolean(partial.uiEffects);
      }
      if (partial.celebrations !== undefined) {
        this.categoryPrefs.celebrations = Boolean(partial.celebrations);
      }
      this._saveCategoryPrefs();
      return this.getCategoryPrefs();
    }

    isCategoryEnabled(category) {
      if (!category) return true;
      return this.categoryPrefs[category] !== false;
    }

    playTone({
      freq = 440,
      duration = 0.15,
      type = "sine",
      volume = 0.12,
      delay = 0,
      freqEnd = null,
      category = null
    }) {
      try {
        if (category && !this.isCategoryEnabled(category)) return;
        const ctx = this.ensureContext();
        if (!ctx) return;

        // مضاعفة مستوى الصوت الرئيسي (1.25x عند 100% ليظل 80% مطابقاً تماماً للمستوى الافتراضي الأصلي)
        const scaledVol = Math.max(0.0002, volume * (this.volume / 0.8));
        const startTime = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);
        if (freqEnd !== null) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);
        }

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(scaledVol, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration + 0.02);
      } catch (_err) {
        // ضمان عدم رمي أي استثناء صوتي يعطّل اللعب
      }
    }

    /** نغمة قصيرة لاختبار مستوى الصوت الحالي */
    playTestChime() {
      this.playTone({ freq: 523.25, duration: 0.11, type: "triangle", volume: 0.11, delay: 0 });
      this.playTone({ freq: 783.99, duration: 0.18, type: "sine", volume: 0.12, delay: 0.09 });
    }

    /** نقرة ناعمة واضحة عند فتح بطاقة سؤال */
    playTileOpen() {
      this.playTone({ freq: 392, freqEnd: 620, duration: 0.085, type: "sine", volume: 0.1, delay: 0, category: "uiEffects" });
      this.playTone({ freq: 784, duration: 0.06, type: "triangle", volume: 0.055, delay: 0.04, category: "uiEffects" });
    }

    /** نقرة خفيفة عكسية عند التراجع (Undo) */
    playUndo() {
      this.playTone({ freq: 540, freqEnd: 360, duration: 0.075, type: "triangle", volume: 0.09, delay: 0, category: "uiEffects" });
      this.playTone({ freq: 330, duration: 0.055, type: "sine", volume: 0.06, delay: 0.035, category: "uiEffects" });
    }

    /** دقة قصيرة خفيفة لآخر 5 ثوانٍ في المؤقت العادي */
    playTick(urgent = false) {
      this.playTone({
        freq: urgent ? 920 : 680,
        duration: 0.065,
        type: "triangle",
        volume: urgent ? 0.1 : 0.065,
        category: "timerTicks"
      });
    }

    /** تكتكة متسارعة خاصة بآخر 10 ثوانٍ في مؤقت «من غير كلام» */
    playCharadesUrgentTick(secondsLeft) {
      const secs = Math.max(1, Math.min(10, Math.floor(Number(secondsLeft) || 10)));
      if (secs >= 7) {
        this.playTone({ freq: 720, duration: 0.06, type: "triangle", volume: 0.08, delay: 0, category: "timerTicks" });
      } else if (secs >= 4) {
        this.playTone({ freq: 840, duration: 0.055, type: "triangle", volume: 0.095, delay: 0, category: "timerTicks" });
        this.playTone({ freq: 890, duration: 0.05, type: "triangle", volume: 0.085, delay: 0.48, category: "timerTicks" });
      } else {
        const base = secs === 1 ? 1040 : secs === 2 ? 980 : 920;
        this.playTone({ freq: base, duration: 0.048, type: "triangle", volume: 0.11, delay: 0, category: "timerTicks" });
        this.playTone({ freq: base + 40, duration: 0.045, type: "triangle", volume: 0.1, delay: 0.24, category: "timerTicks" });
        this.playTone({ freq: base + 80, duration: 0.045, type: "triangle", volume: 0.1, delay: 0.48, category: "timerTicks" });
        this.playTone({ freq: base + 120, duration: 0.045, type: "triangle", volume: 0.105, delay: 0.72, category: "timerTicks" });
      }
    }

    /** نغمة جرس واضحة عند انتهاء الوقت (00:00) */
    playTimeUp() {
      this.playTone({ freq: 260, freqEnd: 185, duration: 0.22, type: "sawtooth", volume: 0.14, delay: 0, category: "timerTicks" });
      this.playTone({ freq: 210, freqEnd: 145, duration: 0.34, type: "sawtooth", volume: 0.15, delay: 0.24, category: "timerTicks" });
      this.playTone({ freq: 520, duration: 0.18, type: "triangle", volume: 0.09, delay: 0, category: "timerTicks" });
    }

    /** نغمة خفيفة عند كشف التلميح */
    playHint() {
      this.playTone({ freq: 587.33, duration: 0.09, type: "sine", volume: 0.085, delay: 0, category: "uiEffects" });
      this.playTone({ freq: 880, duration: 0.14, type: "triangle", volume: 0.08, delay: 0.07, category: "uiEffects" });
    }

    /** نغمة شحن/إلغاء بطاقة المضاعفة 2x على لوحة اللعب */
    playDoubleArm(armed = true) {
      if (armed) {
        this.playTone({ freq: 440, freqEnd: 660, duration: 0.1, type: "triangle", volume: 0.11, delay: 0, category: "uiEffects" });
        this.playTone({ freq: 880, duration: 0.16, type: "sine", volume: 0.12, delay: 0.08, category: "uiEffects" });
      } else {
        this.playTone({ freq: 660, freqEnd: 415, duration: 0.11, type: "sine", volume: 0.08, delay: 0, category: "uiEffects" });
      }
    }

    /** تنبيه صوتي مميز عند فتح فرصة السرقة */
    playStealAlert() {
      this.playTone({ freq: 493.88, duration: 0.09, type: "sawtooth", volume: 0.09, delay: 0, category: "uiEffects" });
      this.playTone({ freq: 659.25, duration: 0.09, type: "triangle", volume: 0.11, delay: 0.08, category: "uiEffects" });
      this.playTone({ freq: 987.77, duration: 0.22, type: "triangle", volume: 0.13, delay: 0.16, category: "uiEffects" });
    }

    /** نغمة خطأ سريعة عند إجابة الفريق صاحب الدور بشكل خاطئ */
    playWrongAnswer() {
      this.playTone({ freq: 260, freqEnd: 190, duration: 0.16, type: "sawtooth", volume: 0.095, delay: 0, category: "uiEffects" });
    }

    /** نغمة تصاعدية نشيطة عند تفعيل وسيلة مساعدة / تبديل السؤال */
    playLifeline() {
      this.playTone({ freq: 523.25, duration: 0.11, type: "triangle", volume: 0.11, delay: 0, category: "uiEffects" });
      this.playTone({ freq: 659.25, duration: 0.11, type: "triangle", volume: 0.12, delay: 0.085, category: "uiEffects" });
      this.playTone({ freq: 783.99, duration: 0.13, type: "triangle", volume: 0.12, delay: 0.17, category: "uiEffects" });
      this.playTone({ freq: 1046.5, duration: 0.22, type: "sine", volume: 0.13, delay: 0.25, category: "uiEffects" });
    }

    /** رنين ناعم عند كشف الإجابة الصحيحة */
    playReveal() {
      this.playTone({ freq: 440, duration: 0.13, type: "sine", volume: 0.1, delay: 0, category: "celebrations" });
      this.playTone({ freq: 554.37, duration: 0.16, type: "sine", volume: 0.11, delay: 0.08, category: "celebrations" });
      this.playTone({ freq: 659.25, duration: 0.24, type: "triangle", volume: 0.1, delay: 0.16, category: "celebrations" });
    }

    /** وتر تصاعدي مبهج عند احتساب النقاط لأحد الفريقين */
    playScore(awarded = true) {
      if (!awarded) {
        this.playNoScore();
        return;
      }
      this.playTone({ freq: 523.25, duration: 0.12, type: "triangle", volume: 0.12, delay: 0, category: "celebrations" });
      this.playTone({ freq: 659.25, duration: 0.14, type: "triangle", volume: 0.12, delay: 0.08, category: "celebrations" });
      this.playTone({ freq: 783.99, duration: 0.26, type: "triangle", volume: 0.14, delay: 0.16, category: "celebrations" });
    }

    /** نغمة هابطة هادئة عند اختيار «لا أحد (0)» */
    playNoScore() {
      this.playTone({ freq: 330, freqEnd: 277, duration: 0.14, type: "sine", volume: 0.085, delay: 0, category: "celebrations" });
      this.playTone({ freq: 262, freqEnd: 205, duration: 0.22, type: "sine", volume: 0.08, delay: 0.12, category: "celebrations" });
    }

    /** مقطوعة احتفالية قصيرة عند إعلان الفائز */
    playVictory() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((n, idx) => {
        this.playTone({
          freq: n,
          duration: idx === notes.length - 1 ? 0.52 : 0.14,
          type: "triangle",
          volume: idx === notes.length - 1 ? 0.15 : 0.12,
          delay: idx * 0.11,
          category: "celebrations"
        });
      });
    }
  }

  window.SeenJeemAudio = new SoundEngine();
})();
