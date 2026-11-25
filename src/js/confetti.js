/**
 * محرك قصاصات الاحتفال الخفيف عبر HTML5 Canvas لشاشة الفائز ونجاح السرقة في "سين جيم"
 * - لا يعتمد على أي مكتبات خارجية
 * - يحترم تفضيل تقليل الحركة (prefers-reduced-motion: reduce)
 * - ينظّف حلقات requestAnimationFrame ومستمعات الحجم تلقائياً
 */
(function () {
  "use strict";

  const PALETTES = {
    team1: ["#22d3ee", "#06b6d4", "#67e8f9", "#38bdf8", "#f59e0b", "#fde047", "#ffffff"],
    team2: ["#fbbf24", "#f59e0b", "#fb923c", "#fde047", "#ea580c", "#fef3c7", "#ffffff"],
    default: ["#22d3ee", "#f59e0b", "#fb923c", "#10b981", "#a78bfa", "#fde047"]
  };

  const DEFAULT_DURATION_MS = 4500;
  const DEFAULT_PARTICLE_COUNT = 95;

  class ConfettiOverlay {
    constructor() {
      /** @type {HTMLCanvasElement | null} */
      this.canvas = null;
      /** @type {CanvasRenderingContext2D | null} */
      this.ctx = null;
      this.rafId = null;
      this.startTime = 0;
      this.particles = [];
      this.resizeHandler = null;
    }

    prefersReducedMotion() {
      try {
        return Boolean(
          window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
      } catch (err) {
        return false;
      }
    }

    /**
     * تشغيل الاحتفال على عنصر canvas محدد
     * @param {HTMLCanvasElement | null} canvasEl
     * @param {"team1" | "team2" | "default"} theme
     * @param {{ particleCount?: number, durationMs?: number, burst?: boolean }} [options]
     */
    start(canvasEl, theme = "default", options = {}) {
      this.stop();
      if (!canvasEl || this.prefersReducedMotion()) return;

      const ctx = canvasEl.getContext("2d");
      if (!ctx) return;

      const durationMs = Math.max(800, Number(options.durationMs) || DEFAULT_DURATION_MS);
      const particleCount = Math.max(12, Number(options.particleCount) || DEFAULT_PARTICLE_COUNT);
      const isBurst = Boolean(options.burst);

      this.canvas = canvasEl;
      this.ctx = ctx;

      const resize = () => {
        if (!this.canvas || !this.ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.canvas.width = Math.floor(w * dpr);
        this.canvas.height = Math.floor(h * dpr);
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };

      resize();
      this.resizeHandler = resize;
      window.addEventListener("resize", this.resizeHandler);

      const colors = PALETTES[theme] || PALETTES.default;
      const width = window.innerWidth;
      const height = window.innerHeight;

      this.particles = Array.from({ length: particleCount }, (_, idx) => {
        if (isBurst) {
          return {
            x: width * (0.25 + Math.random() * 0.5),
            y: height * (0.12 + Math.random() * 0.18),
            vx: (Math.random() - 0.5) * 6.4,
            vy: -2.2 + Math.random() * 4.8,
            w: 5 + Math.random() * 5,
            h: 8 + Math.random() * 6,
            color: colors[idx % colors.length],
            rotation: Math.random() * Math.PI * 2,
            vRot: (Math.random() - 0.5) * 0.22,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.06 + Math.random() * 0.08,
            shape: idx % 3 === 0 ? "circle" : "rect"
          };
        }

        const fromLeft = idx % 2 === 0;
        return {
          x: fromLeft ? width * (0.1 + Math.random() * 0.35) : width * (0.55 + Math.random() * 0.35),
          y: -15 - Math.random() * (height * 0.35),
          vx: (Math.random() - 0.5) * 3.4,
          vy: 2.2 + Math.random() * 3.6,
          w: 6 + Math.random() * 6,
          h: 9 + Math.random() * 8,
          color: colors[idx % colors.length],
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.18,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.05 + Math.random() * 0.07,
          shape: idx % 4 === 0 ? "circle" : "rect"
        };
      });

      this.startTime = performance.now();

      const frame = (now) => {
        if (!this.ctx || !this.canvas) return;
        const elapsed = now - this.startTime;
        if (elapsed >= durationMs) {
          this.stop();
          return;
        }

        const w = window.innerWidth;
        const h = window.innerHeight;
        const fadeWindow = Math.min(900, durationMs * 0.4);
        const fadeFactor =
          elapsed > durationMs - fadeWindow ? Math.max(0, (durationMs - elapsed) / fadeWindow) : 1;

        this.ctx.clearRect(0, 0, w, h);

        for (let i = 0; i < this.particles.length; i++) {
          const p = this.particles[i];
          p.wobble += p.wobbleSpeed;
          p.x += p.vx + Math.sin(p.wobble) * 0.9;
          p.y += p.vy;
          p.vy = Math.min(p.vy + (isBurst ? 0.12 : 0.04), 6.5);
          p.rotation += p.vRot;

          if (!isBurst && p.y > h + 24 && elapsed < durationMs - 1400) {
            p.y = -18;
            p.x = Math.random() * w;
            p.vy = 2.0 + Math.random() * 3.0;
          }

          this.ctx.save();
          this.ctx.globalAlpha = 0.92 * fadeFactor;
          this.ctx.translate(p.x, p.y);
          this.ctx.rotate(p.rotation);
          this.ctx.fillStyle = p.color;

          if (p.shape === "circle") {
            this.ctx.beginPath();
            this.ctx.arc(0, 0, p.w * 0.45, 0, Math.PI * 2);
            this.ctx.fill();
          } else {
            this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          }
          this.ctx.restore();
        }

        this.rafId = requestAnimationFrame(frame);
      };

      this.rafId = requestAnimationFrame(frame);
    }

    /**
     * قصاصات احتفال خفيفة وسريعة عند نجاح السرقة
     */
    startLightBurst(canvasEl, theme = "default") {
      this.start(canvasEl, theme, {
        particleCount: 42,
        durationMs: 1900,
        burst: true
      });
    }

    stop() {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this.resizeHandler) {
        window.removeEventListener("resize", this.resizeHandler);
        this.resizeHandler = null;
      }
      if (this.ctx && this.canvas) {
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
      this.particles = [];
    }
  }

  window.SeenJeemConfetti = new ConfettiOverlay();
})();
