/**
 * محرك الصوت التفاعلي عبر Web Audio API للعبة "سين جيم"
 * يعمل بالكامل داخل المتصفح دون الحاجة لملفات صوتية خارجية (Zero External Audio Files).
 * - يربط جميع المؤثرات بعقدة تحكم رئيسية واحدة (Master GainNode) من 0 إلى 1 (الافتراضي 0.75)
 * - يدعم فصل فئات المؤثرات الصوتية:
 *   - timerTicks: دقات المؤقت وجرس انتهاء الوقت
 *   - uiEffects: نقرات البطاقات ووسائل المساعدة والتراجع والسرقة
 *   - celebrations: كشف الإجابة، احتساب النقاط، والاحتفال بالفوز
 */
(function () {
  "use strict";

  const MUTE_STORAGE_KEY = "seen_jeem_muted";
  const VOLUME_STORAGE_KEY = "seen_jeem_volume_v1";
  const PREFS_STORAGE_KEY = "seen_jeem_audio_prefs_v1";
  const DEFAULT_VOLUME = 0.75;

  const DEFAULT_CATEGORY_PREFS = Object.freeze({
    timerTicks: true,
    uiEffects: true,
    celebrations: true
  });

  function clampVolume(val) {
    const num = Number(val);
    if (!Number.isFinite(num)) return DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, Math.round(num * 100) / 100));
  }

  class SoundEngine {
    constructor() {
      /** @type {AudioContext | null} */
      this.ctx = null;
      /** @type {GainNode | null} */
      this.masterGain = null;
      /** @type {Map<string, { nodes: Array<AudioNode>, timers: Array<number>, gain?: GainNode }>} */
      this._soundboardGroups = new Map();
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
        if (raw === null) return DEFAULT_VOLUME;
        return clampVolume(raw);
      } catch (_err) {
        return DEFAULT_VOLUME;
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

    _syncMasterGain() {
      if (!this.ctx || !this.masterGain) return;
      try {
        const target = this.muted ? 0 : this.volume;
        this.masterGain.gain.setValueAtTime(target, this.ctx.currentTime);
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
          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
          this.masterGain.connect(this.ctx.destination);
        } else if (!this.masterGain) {
          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
          this.masterGain.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended") {
          const resumePromise = this.ctx.resume();
          if (resumePromise && typeof resumePromise.catch === "function") {
            resumePromise.catch(() => {});
          }
        }
        this._syncMasterGain();
        return this.ctx;
      } catch (_err) {
        return null;
      }
    }

    setMuted(muted, persist = true) {
      this.muted = Boolean(muted);
      if (persist) {
        this._saveMutedState(this.muted);
      }
      this._syncMasterGain();
    }

    isMuted() {
      return this.muted;
    }

    getVolume() {
      return this.volume;
    }

    setVolume(vol, persist = true) {
      this.volume = clampVolume(vol);
      if (persist) {
        this._saveVolumeState(this.volume);
      }
      if (this.volume > 0 && this.muted && persist) {
        this.setMuted(false, persist);
      } else {
        this._syncMasterGain();
      }
      return this.volume;
    }

    getCategoryPrefs() {
      return { ...this.categoryPrefs };
    }

    setCategoryPrefs(partial, persist = true) {
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
      if (persist) {
        this._saveCategoryPrefs();
      }
      return this.getCategoryPrefs();
    }

    /** مزامنة إعدادات الصوت القادمة من نافذة المقدّم إلى شاشة العرض التلفزيوني */
    applySyncedSettings(settings) {
      if (!settings || typeof settings !== "object") return;
      if (settings.volume !== undefined) {
        this.volume = clampVolume(settings.volume);
      }
      if (settings.muted !== undefined) {
        this.muted = Boolean(settings.muted);
      }
      if (settings.categoryPrefs && typeof settings.categoryPrefs === "object") {
        this.setCategoryPrefs(settings.categoryPrefs, false);
      }
      this._syncMasterGain();
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
        if (!ctx || !this.masterGain) return;

        // تمرير الإشارة عبر عقدة Master GainNode الواحدة (توازن صوتي مطابق عند 0.75)
        const noteVol = Math.max(0.0002, volume * 1.33);
        const startTime = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);
        if (freqEnd !== null) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);
        }

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(noteVol, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(startTime);
        osc.stop(startTime + duration + 0.02);
      } catch (_err) {
        // ضمان عدم رمي أي استثناء صوتي يعطّل اللعب
      }
    }

    /** نقرة اختبار ناعمة عند إفلات شريط مستوى الصوت */
    playVolumeTestTick() {
      this.playTone({ freq: 620, freqEnd: 780, duration: 0.075, type: "sine", volume: 0.095, delay: 0 });
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

    /** دقة قصيرة خفيفة لآخر 10 ثوانٍ في المؤقت العادي ومؤقت السرقة */
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

    /** نغمة نجاح سريعة تتصاعد طبقتها تدريجياً مع سلسلة الإجابات المتتالية (Streak) */
    playStreakSuccess(streak = 1) {
      const step = Math.min(10, Math.max(1, Math.floor(Number(streak) || 1))) - 1;
      const baseFreq = 523.25 * Math.pow(1.06, step);
      this.playTone({ freq: baseFreq, duration: 0.085, type: "triangle", volume: 0.11, delay: 0, category: "celebrations" });
      this.playTone({ freq: baseFreq * 1.25, duration: 0.14, type: "sine", volume: 0.12, delay: 0.06, category: "celebrations" });
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

    /* =========================================================
       لوحة المؤثرات الصوتية للمقدّم (Host Soundboard — 5 مؤثرات مركّبة)
       تمنع التراكم الصوتي المزعج عند إعادة الضغط وتمر عبر Master GainNode
       ========================================================= */
    _stopSoundboardKey(key) {
      const active = this._soundboardGroups.get(key);
      if (!active) return;
      try {
        if (active.gain && this.ctx) {
          active.gain.gain.cancelScheduledValues(this.ctx.currentTime);
          active.gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        }
        (active.nodes || []).forEach((n) => {
          try {
            if (typeof n.stop === "function") n.stop();
          } catch (_e) {}
          try {
            if (typeof n.disconnect === "function") n.disconnect();
          } catch (_e) {}
        });
      } catch (_err) {}
      this._soundboardGroups.delete(key);
    }

    _beginSoundboardGroup(key) {
      this._stopSoundboardKey(key);
      const ctx = this.ensureContext();
      if (!ctx || !this.masterGain) return null;
      const groupGain = ctx.createGain();
      groupGain.gain.setValueAtTime(1.0, ctx.currentTime);
      groupGain.connect(this.masterGain);
      const bucket = { nodes: [groupGain], gain: groupGain };
      this._soundboardGroups.set(key, bucket);
      return { ctx, groupGain, bucket };
    }

    _createNoiseBuffer(ctx, durationSec = 0.5) {
      const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    }

    /** 1) قرع طبول التشويق (~2.2 ثانية) */
    playDrumroll() {
      try {
        const g = this._beginSoundboardGroup("drumroll");
        if (!g) return;
        const { ctx, groupGain, bucket } = g;
        const now = ctx.currentTime;
        const noiseBuf = this._createNoiseBuffer(ctx, 0.12);

        let t = 0;
        let step = 0.14;
        while (t < 2.02) {
          const hitTime = now + t;
          const progress = t / 2.05;
          const amp = 0.08 + progress * 0.14;

          // صوت طبل منخفض
          const osc = ctx.createOscillator();
          const oscGain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(135 + progress * 35, hitTime);
          osc.frequency.exponentialRampToValueAtTime(75, hitTime + 0.065);
          oscGain.gain.setValueAtTime(0.0001, hitTime);
          oscGain.gain.linearRampToValueAtTime(amp, hitTime + 0.008);
          oscGain.gain.exponentialRampToValueAtTime(0.0001, hitTime + 0.075);
          osc.connect(oscGain);
          oscGain.connect(groupGain);
          osc.start(hitTime);
          osc.stop(hitTime + 0.085);
          bucket.nodes.push(osc, oscGain);

          // نقرة Snare خفيفة بفلتر Bandpass
          const src = ctx.createBufferSource();
          src.buffer = noiseBuf;
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.setValueAtTime(1800 + progress * 900, hitTime);
          bp.Q.setValueAtTime(1.4, hitTime);
          const nGain = ctx.createGain();
          nGain.gain.setValueAtTime(0.0001, hitTime);
          nGain.gain.linearRampToValueAtTime(amp * 0.75, hitTime + 0.005);
          nGain.gain.exponentialRampToValueAtTime(0.0001, hitTime + 0.055);
          src.connect(bp);
          bp.connect(nGain);
          nGain.connect(groupGain);
          src.start(hitTime);
          src.stop(hitTime + 0.065);
          bucket.nodes.push(src, bp, nGain);

          t += step;
          step = Math.max(0.045, step * 0.91);
        }

        // ضربة ختامية واضحة (Crash + Punch)
        const endT = now + 2.08;
        const crash = ctx.createBufferSource();
        crash.buffer = this._createNoiseBuffer(ctx, 0.45);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.setValueAtTime(2400, endT);
        const cGain = ctx.createGain();
        cGain.gain.setValueAtTime(0.0001, endT);
        cGain.gain.linearRampToValueAtTime(0.18, endT + 0.01);
        cGain.gain.exponentialRampToValueAtTime(0.0001, endT + 0.42);
        crash.connect(hp);
        hp.connect(cGain);
        cGain.connect(groupGain);
        crash.start(endT);
        crash.stop(endT + 0.44);
        bucket.nodes.push(crash, hp, cGain);
      } catch (_err) {}
    }

    /** 2) تصفيق واحتفال (Bandpass Noise متداخل يحاكي الجمهور) */
    playApplause() {
      try {
        const g = this._beginSoundboardGroup("applause");
        if (!g) return;
        const { ctx, groupGain, bucket } = g;
        const now = ctx.currentTime;
        const clapBuf = this._createNoiseBuffer(ctx, 0.14);

        // طبقة تصفيق خلفية دافئة
        const bed = ctx.createBufferSource();
        bed.buffer = this._createNoiseBuffer(ctx, 2.3);
        const bedFilter = ctx.createBiquadFilter();
        bedFilter.type = "bandpass";
        bedFilter.frequency.setValueAtTime(1450, now);
        bedFilter.Q.setValueAtTime(0.85, now);
        const bedGain = ctx.createGain();
        bedGain.gain.setValueAtTime(0.0001, now);
        bedGain.gain.linearRampToValueAtTime(0.11, now + 0.25);
        bedGain.gain.setValueAtTime(0.1, now + 1.55);
        bedGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.25);
        bed.connect(bedFilter);
        bedFilter.connect(bedGain);
        bedGain.connect(groupGain);
        bed.start(now);
        bed.stop(now + 2.3);
        bucket.nodes.push(bed, bedFilter, bedGain);

        // نبضات تصفيق فردية متداخلة
        for (let i = 0; i < 24; i++) {
          const onset = now + i * 0.08 + Math.random() * 0.045;
          const envScale = i < 4 ? 0.55 : i > 18 ? 0.45 : 1;
          const src = ctx.createBufferSource();
          src.buffer = clapBuf;
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.setValueAtTime(1100 + Math.random() * 1400, onset);
          bp.Q.setValueAtTime(2.0, onset);
          const cg = ctx.createGain();
          cg.gain.setValueAtTime(0.0001, onset);
          cg.gain.linearRampToValueAtTime(0.09 * envScale, onset + 0.006);
          cg.gain.exponentialRampToValueAtTime(0.0001, onset + 0.085);
          src.connect(bp);
          bp.connect(cg);
          cg.connect(groupGain);
          src.start(onset);
          src.stop(onset + 0.095);
          bucket.nodes.push(src, bp, cg);
        }
      } catch (_err) {}
    }

    /** 3) خطأ كوميدي درامي (Sad Trombone: Wah-Wah-Wah-Waaah) */
    playSadTrombone() {
      try {
        const g = this._beginSoundboardGroup("sad_trombone");
        if (!g) return;
        const { ctx, groupGain, bucket } = g;
        const now = ctx.currentTime;
        const notes = [
          { freq: 293.66, endFreq: 288, start: 0.0, dur: 0.34 },
          { freq: 277.18, endFreq: 271, start: 0.38, dur: 0.34 },
          { freq: 261.63, endFreq: 255, start: 0.76, dur: 0.34 },
          { freq: 246.94, endFreq: 218, start: 1.14, dur: 0.78 }
        ];

        notes.forEach((n, idx) => {
          const st = now + n.start;
          const osc = ctx.createOscillator();
          const lp = ctx.createBiquadFilter();
          const gain = ctx.createGain();

          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(n.freq, st);
          osc.frequency.exponentialRampToValueAtTime(n.endFreq, st + n.dur);

          lp.type = "lowpass";
          lp.frequency.setValueAtTime(980, st);
          lp.frequency.exponentialRampToValueAtTime(idx === 3 ? 380 : 620, st + n.dur);

          gain.gain.setValueAtTime(0.0001, st);
          gain.gain.linearRampToValueAtTime(0.15, st + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, st + n.dur);

          osc.connect(lp);
          lp.connect(gain);
          gain.connect(groupGain);

          osc.start(st);
          osc.stop(st + n.dur + 0.03);
          bucket.nodes.push(osc, lp, gain);
        });
      } catch (_err) {}
    }

    /** 4) تنبيه هدوء / انتباه (رنّة ثلاثية صافية) */
    playAttentionChime() {
      try {
        const g = this._beginSoundboardGroup("attention_chime");
        if (!g) return;
        const { ctx, groupGain, bucket } = g;
        const now = ctx.currentTime;
        const freqs = [659.25, 830.61, 987.77];

        freqs.forEach((freq, idx) => {
          const st = now + idx * 0.16;
          const dur = idx === 2 ? 0.65 : 0.32;
          const osc = ctx.createOscillator();
          const harm = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, st);
          harm.type = "triangle";
          harm.frequency.setValueAtTime(freq * 2, st);

          const harmGain = ctx.createGain();
          harmGain.gain.setValueAtTime(0.18, st);

          gain.gain.setValueAtTime(0.0001, st);
          gain.gain.linearRampToValueAtTime(0.16, st + 0.014);
          gain.gain.exponentialRampToValueAtTime(0.0001, st + dur);

          osc.connect(gain);
          harm.connect(harmGain);
          harmGain.connect(gain);
          gain.connect(groupGain);

          osc.start(st);
          harm.start(st);
          osc.stop(st + dur + 0.03);
          harm.stop(st + dur + 0.03);
          bucket.nodes.push(osc, harm, harmGain, gain);
        });
      } catch (_err) {}
    }

    /** 5) افتتاحية حماسية (Fanfare) */
    playFanfare() {
      try {
        const g = this._beginSoundboardGroup("fanfare");
        if (!g) return;
        const { ctx, groupGain, bucket } = g;
        const now = ctx.currentTime;
        const notes = [
          { freq: 523.25, start: 0.0, dur: 0.14 },
          { freq: 659.25, start: 0.13, dur: 0.14 },
          { freq: 783.99, start: 0.26, dur: 0.16 },
          { freq: 1046.5, start: 0.42, dur: 0.56 }
        ];

        notes.forEach((n, idx) => {
          const st = now + n.start;
          const osc = ctx.createOscillator();
          const sub = ctx.createOscillator();
          const lp = ctx.createBiquadFilter();
          const gain = ctx.createGain();

          osc.type = "triangle";
          osc.frequency.setValueAtTime(n.freq, st);
          sub.type = "sawtooth";
          sub.frequency.setValueAtTime(n.freq / 2, st);

          lp.type = "lowpass";
          lp.frequency.setValueAtTime(2200, st);

          gain.gain.setValueAtTime(0.0001, st);
          gain.gain.linearRampToValueAtTime(idx === 3 ? 0.17 : 0.13, st + 0.018);
          gain.gain.exponentialRampToValueAtTime(0.0001, st + n.dur);

          osc.connect(lp);
          sub.connect(lp);
          lp.connect(gain);
          gain.connect(groupGain);

          osc.start(st);
          sub.start(st);
          osc.stop(st + n.dur + 0.03);
          sub.stop(st + n.dur + 0.03);
          bucket.nodes.push(osc, sub, lp, gain);
        });
      } catch (_err) {}
    }

    playBuzzerWin() {
      try {
        if (!this._canPlay("celebrations")) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const freqs = [880, 1318.51, 1760];
        freqs.forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = idx === 0 ? "triangle" : "sine";
          const t = now + idx * 0.045;
          osc.frequency.setValueAtTime(f, t);
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.22 - idx * 0.04, t + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
          osc.connect(gain);
          gain.connect(this._masterGain);
          osc.start(t);
          osc.stop(t + 0.45);
        });
      } catch (_err) {}
    }

    playDiffFound() {
      try {
        if (!this._canPlay("uiEffects")) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const dest = this.masterGain || this._masterGain || ctx.destination;
        const now = ctx.currentTime;
        [587.33, 880].forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          const t = now + idx * 0.055;
          osc.frequency.setValueAtTime(f, t);
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.15, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
          osc.connect(gain);
          gain.connect(dest);
          osc.start(t);
          osc.stop(t + 0.18);
        });
      } catch (_err) {}
    }

    playDiffComplete() {
      try {
        if (!this._canPlay("celebrations")) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const dest = this.masterGain || this._masterGain || ctx.destination;
        const now = ctx.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "triangle";
          const t = now + idx * 0.07;
          osc.frequency.setValueAtTime(f, t);
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.18, t + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
          osc.connect(gain);
          gain.connect(dest);
          osc.start(t);
          osc.stop(t + 0.3);
        });
      } catch (_err) {}
    }

    playSoundboard(sfxId) {
      if (sfxId === "drumroll") this.playDrumroll();
      else if (sfxId === "applause") this.playApplause();
      else if (sfxId === "sad_trombone") this.playSadTrombone();
      else if (sfxId === "attention_chime") this.playAttentionChime();
      else if (sfxId === "fanfare") this.playFanfare();
    }
  }

  window.SeenJeemAudio = new SoundEngine();
})();
