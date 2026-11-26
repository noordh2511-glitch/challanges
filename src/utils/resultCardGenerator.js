/**
 * مولّد بطاقة نتيجة المباراة كصورة احترافية للمشاركة (Shareable Result Card — 1080×1350 / 4:5)
 * - يرسم بالكامل عبر HTML5 Canvas بدون أي مكتبات خارجية
 * - ينتظر اكتمال خط Cairo عبر document.fonts.ready مع ctx.direction = 'rtl'
 * - يتكيّف تلقائياً مع 2، 3، أو 4 فرق ومع الثيم النشط (dark-glass | royal-gold | high-contrast)
 */
(function () {
  "use strict";

  const WIDTH = 1080;
  const HEIGHT = 1350;
  const FONT_FAMILY = '"Cairo", "Segoe UI", Tahoma, Arial, sans-serif';

  const TEAM_COLORS = [
    { main: "#22d3ee", soft: "rgba(34, 211, 238, 0.16)", border: "rgba(34, 211, 238, 0.55)" },
    { main: "#fbbf24", soft: "rgba(251, 191, 36, 0.16)", border: "rgba(251, 191, 36, 0.55)" },
    { main: "#34d399", soft: "rgba(52, 211, 153, 0.16)", border: "rgba(52, 211, 153, 0.55)" },
    { main: "#e879f9", soft: "rgba(232, 121, 249, 0.16)", border: "rgba(232, 121, 249, 0.55)" }
  ];

  const THEME_PALETTES = {
    "dark-glass": {
      bgTop: "#091128",
      bgMid: "#0c1530",
      bgBot: "#050916",
      orb1: "rgba(6, 182, 212, 0.24)",
      orb2: "rgba(245, 158, 11, 0.2)",
      cardBg: "rgba(17, 26, 54, 0.86)",
      cardBorder: "rgba(148, 163, 184, 0.24)",
      heroBg: "rgba(20, 32, 68, 0.92)",
      heroBorder: "rgba(245, 158, 11, 0.5)",
      accent1: "#22d3ee",
      accent2: "#f59e0b",
      textPrimary: "#f8fafc",
      textSecondary: "#cbd5e1",
      textMuted: "#94a3b8",
      pillBg: "rgba(6, 182, 212, 0.16)",
      pillBorder: "rgba(6, 182, 212, 0.45)"
    },
    "royal-gold": {
      bgTop: "#0b1024",
      bgMid: "#15162f",
      bgBot: "#090a18",
      orb1: "rgba(245, 158, 11, 0.26)",
      orb2: "rgba(217, 119, 6, 0.2)",
      cardBg: "rgba(26, 24, 52, 0.9)",
      cardBorder: "rgba(251, 191, 36, 0.3)",
      heroBg: "rgba(38, 30, 56, 0.94)",
      heroBorder: "rgba(251, 191, 36, 0.72)",
      accent1: "#fcd34d",
      accent2: "#f59e0b",
      textPrimary: "#fefce8",
      textSecondary: "#fde68a",
      textMuted: "#d6c598",
      pillBg: "rgba(245, 158, 11, 0.18)",
      pillBorder: "rgba(251, 191, 36, 0.55)"
    },
    "high-contrast": {
      bgTop: "#000000",
      bgMid: "#0a0e18",
      bgBot: "#000000",
      orb1: "rgba(56, 189, 248, 0.14)",
      orb2: "rgba(250, 204, 21, 0.12)",
      cardBg: "#111827",
      cardBorder: "rgba(255, 255, 255, 0.52)",
      heroBg: "#0f172a",
      heroBorder: "#facc15",
      accent1: "#38bdf8",
      accent2: "#facc15",
      textPrimary: "#ffffff",
      textSecondary: "#f1f5f9",
      textMuted: "#cbd5e1",
      pillBg: "#1e293b",
      pillBorder: "#38bdf8"
    }
  };

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function truncateToWidth(ctx, text, maxWidth) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    if (ctx.measureText(raw).width <= maxWidth) return raw;
    let out = raw;
    while (out.length > 2 && ctx.measureText(`${out}…`).width > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}…`;
  }

  /** رسم كأس التتويج بمتجهات نظيفة بدون اعتماد على خطوط إيموجي النظام */
  function drawTrophyIcon(ctx, cx, cy, isDraw, accentColor) {
    ctx.save();
    ctx.translate(cx, cy);

    // هالة مضيئة خلف الأيقونة
    const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, 56);
    glow.addColorStop(0, "rgba(251, 191, 36, 0.4)");
    glow.addColorStop(1, "rgba(251, 191, 36, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 56, 0, Math.PI * 2);
    ctx.fill();

    if (isDraw) {
      // نجمة تعادل مزدوجة نظيفة
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 5;
      ctx.fillStyle = "rgba(251, 191, 36, 0.2)";
      ctx.beginPath();
      ctx.arc(-14, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(14, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }

    // جسم الكأس الذهبي
    const cupGrad = ctx.createLinearGradient(0, -34, 0, 28);
    cupGrad.addColorStop(0, "#fde68a");
    cupGrad.addColorStop(0.5, "#f59e0b");
    cupGrad.addColorStop(1, "#b45309");

    // مقابض الكأس
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(-26, -12, 12, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(26, -12, 12, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();

    // الكأس نفسه
    ctx.fillStyle = cupGrad;
    ctx.beginPath();
    ctx.moveTo(-26, -32);
    ctx.lineTo(26, -32);
    ctx.quadraticCurveTo(24, 6, 0, 12);
    ctx.quadraticCurveTo(-24, 6, -26, -32);
    ctx.closePath();
    ctx.fill();

    // الساق والقاعدة
    ctx.fillRect(-5, 11, 10, 14);
    drawRoundedRect(ctx, -20, 24, 40, 9, 4);
    ctx.fill();

    ctx.restore();
  }

  async function ensureArabicFontReady() {
    try {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      if (document.fonts && typeof document.fonts.load === "function") {
        await Promise.allSettled([
          document.fonts.load(`700 40px ${FONT_FAMILY}`, "سين جيم"),
          document.fonts.load(`900 56px ${FONT_FAMILY}`, "الفائز 1234567890")
        ]);
      }
    } catch (_err) {
      // متابعة آمنة بالخطوط الاحتياطية
    }
  }

  function formatArabicDate(ts) {
    try {
      return new Intl.DateTimeFormat("ar", {
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(new Date(ts || Date.now()));
    } catch (_err) {
      return new Date(ts || Date.now()).toISOString().slice(0, 10);
    }
  }

  function computeHighlights(matchEvents, analytics) {
    const events = Array.isArray(matchEvents) ? matchEvents : [];

    // 1) أقوى فئة (أكثر فئة شهدت إجابات صحيحة)
    let strongestCat = "—";
    if (analytics && Array.isArray(analytics.categories) && analytics.categories.length > 0) {
      const sortedCats = analytics.categories
        .map((c) => ({
          name: c.categoryName,
          correct: (c.teamWins || []).reduce((s, n) => s + (Number(n) || 0), 0)
        }))
        .sort((a, b) => b.correct - a.correct);
      if (sortedCats[0] && sortedCats[0].name) {
        strongestCat = sortedCats[0].name;
      }
    }

    // 2) أعلى ضربة في المباراة
    let topStrike = 0;
    events.forEach((ev) => {
      if (!ev.isFinalRound && ev.awardedTeamId && Number(ev.effectivePoints) > topStrike) {
        topStrike = Number(ev.effectivePoints);
      }
    });

    // 3) السرقات الناجحة (أو دقة الإجابة إن لم توجد سرقات)
    const stealsCount = analytics ? Number(analytics.totalSteals) || 0 : 0;
    const accuracy = analytics ? Number(analytics.overallAccuracy) || 0 : 0;

    return {
      strongestCat,
      topStrikeText: topStrike > 0 ? `+${topStrike} نقطة` : `${analytics ? analytics.totalQuestions : 0} سؤال`,
      thirdLabel: stealsCount > 0 ? "السرقات الناجحة" : "دقة الإجابات",
      thirdValue: stealsCount > 0 ? `${stealsCount} سرقة` : `${accuracy}%`
    };
  }

  /**
   * رسم بطاقة النتيجة على عنصر Canvas (1080×1350)
   */
  async function generateCanvas({
    teams = [],
    analytics = null,
    matchEvents = [],
    profileName = "عام",
    theme = "dark-glass",
    timestamp = Date.now()
  }) {
    await ensureArabicFontReady();

    const palette = THEME_PALETTES[theme] || THEME_PALETTES["dark-glass"];
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    ctx.direction = "rtl";
    ctx.textBaseline = "middle";

    // 1) الخلفية المتدرجة وهالات الأستوديو
    const bgGrad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bgGrad.addColorStop(0, palette.bgTop);
    bgGrad.addColorStop(0.5, palette.bgMid);
    bgGrad.addColorStop(1, palette.bgBot);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const orb1 = ctx.createRadialGradient(WIDTH * 0.82, HEIGHT * 0.14, 10, WIDTH * 0.82, HEIGHT * 0.14, 420);
    orb1.addColorStop(0, palette.orb1);
    orb1.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = orb1;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const orb2 = ctx.createRadialGradient(WIDTH * 0.18, HEIGHT * 0.84, 10, WIDTH * 0.18, HEIGHT * 0.84, 420);
    orb2.addColorStop(0, palette.orb2);
    orb2.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = orb2;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // إطار خارجي أنيق
    drawRoundedRect(ctx, 32, 32, WIDTH - 64, HEIGHT - 64, 38);
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 2) الترويسة: شعار «سين جيم» + اسم المجموعة + التاريخ
    const headerY = 104;
    // شارة الشعار في اليمين (RTL)
    drawRoundedRect(ctx, WIDTH - 266, headerY - 34, 198, 68, 20);
    const brandGrad = ctx.createLinearGradient(WIDTH - 266, headerY - 34, WIDTH - 68, headerY + 34);
    brandGrad.addColorStop(0, palette.accent1);
    brandGrad.addColorStop(1, palette.accent2);
    ctx.fillStyle = brandGrad;
    ctx.fill();

    ctx.fillStyle = "#060b19";
    ctx.font = `900 34px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText("سين جيم", WIDTH - 167, headerY + 2);

    // اسم المجموعة والتاريخ في اليسار
    ctx.textAlign = "left";
    ctx.fillStyle = palette.textPrimary;
    ctx.font = `800 26px ${FONT_FAMILY}`;
    ctx.fillText(truncateToWidth(ctx, `المجموعة: ${profileName}`, 460), 74, headerY - 14);

    ctx.fillStyle = palette.textMuted;
    ctx.font = `600 22px ${FONT_FAMILY}`;
    ctx.fillText(formatArabicDate(timestamp), 74, headerY + 20);

    // ترتيب الفرق تنازلياً مع الاحتفاظ بفهرس اللون الأصلي
    const ranked = teams
      .map((t, origIdx) => {
        const ts =
          analytics && Array.isArray(analytics.teamStats) && analytics.teamStats[origIdx]
            ? analytics.teamStats[origIdx]
            : { accuracy: 0, correct: 0 };
        return {
          origIdx,
          name: t.name || `الفريق ${origIdx + 1}`,
          score: Math.max(0, Math.round(Number(t.score) || 0)),
          accuracy: Number(ts.accuracy) || 0,
          correct: Number(ts.correct) || 0,
          color: TEAM_COLORS[origIdx % TEAM_COLORS.length]
        };
      })
      .sort((a, b) => b.score - a.score);

    const topScore = ranked[0] ? ranked[0].score : 0;
    const leaders = ranked.filter((r) => r.score === topScore);
    const isDraw = leaders.length !== 1;
    const runnerUpScore = ranked.find((r) => r.score < topScore)?.score ?? topScore;
    const margin = Math.max(0, topScore - runnerUpScore);

    // 3) القسم الرئيسي: لافتة الفائز أو التعادل
    const heroX = 68;
    const heroY = 186;
    const heroW = WIDTH - 136;
    const heroH = 278;

    drawRoundedRect(ctx, heroX, heroY, heroW, heroH, 30);
    ctx.fillStyle = palette.heroBg;
    ctx.fill();
    ctx.strokeStyle = isDraw ? palette.accent1 : palette.heroBorder;
    ctx.lineWidth = 3;
    ctx.stroke();

    drawTrophyIcon(ctx, WIDTH / 2, heroY + 72, isDraw, palette.accent2);

    ctx.textAlign = "center";
    ctx.fillStyle = palette.accent2;
    ctx.font = `800 26px ${FONT_FAMILY}`;
    ctx.fillText(isDraw ? "منافسة متكافئة ومثيرة!" : "بطل الجولة", WIDTH / 2, heroY + 136);

    ctx.fillStyle = palette.textPrimary;
    ctx.font = `900 50px ${FONT_FAMILY}`;
    const mainHeadline = isDraw
      ? leaders.length === 2
        ? `تعادل: ${leaders[0].name} و${leaders[1].name}`
        : `تعادل ${leaders.length} فرق في الصدارة!`
      : leaders[0].name;
    ctx.fillText(truncateToWidth(ctx, mainHeadline, heroW - 80), WIDTH / 2, heroY + 194);

    // شارة فارق النقاط
    const marginLabel = isDraw
      ? `الرصيد المتعادل: ${topScore} نقطة`
      : `تتويج برصيد ${topScore} نقطة  •  بفارق +${margin} نقطة`;
    drawRoundedRect(ctx, WIDTH / 2 - 260, heroY + 228, 520, 40, 999);
    ctx.fillStyle = palette.pillBg;
    ctx.fill();
    ctx.strokeStyle = palette.pillBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = palette.textSecondary;
    ctx.font = `700 22px ${FONT_FAMILY}`;
    ctx.fillText(truncateToWidth(ctx, marginLabel, 490), WIDTH / 2, heroY + 249);

    // 4) جدول الترتيب النهائي لجميع الفرق (يتكيّف لـ 2 أو 3 أو 4 فرق)
    const tableTitleY = 516;
    ctx.textAlign = "right";
    ctx.fillStyle = palette.textSecondary;
    ctx.font = `800 28px ${FONT_FAMILY}`;
    ctx.fillText("الترتيب النهائي للفرق", WIDTH - 74, tableTitleY);

    const listStartY = 556;
    const listAvailH = 445;
    const count = Math.max(2, ranked.length);
    const rowGap = count >= 4 ? 16 : 22;
    const rowH = Math.min(130, Math.floor((listAvailH - rowGap * (count - 1)) / count));

    ranked.forEach((team, idx) => {
      const y = listStartY + idx * (rowH + rowGap);
      const isLeader = team.score === topScore;

      drawRoundedRect(ctx, 68, y, WIDTH - 136, rowH, 24);
      ctx.fillStyle = isLeader ? team.color.soft : palette.cardBg;
      ctx.fill();
      ctx.strokeStyle = isLeader ? team.color.border : palette.cardBorder;
      ctx.lineWidth = isLeader ? 2.5 : 1.5;
      ctx.stroke();

      // شريط لون الفريق على الحافة اليمنى (RTL)
      drawRoundedRect(ctx, WIDTH - 84, y + 14, 10, rowH - 28, 6);
      ctx.fillStyle = team.color.main;
      ctx.fill();

      // شارة الترتيب (#1..#4)
      const rankCx = WIDTH - 130;
      const rankCy = y + rowH / 2;
      ctx.beginPath();
      ctx.arc(rankCx, rankCy, 26, 0, Math.PI * 2);
      ctx.fillStyle = isLeader ? team.color.main : "rgba(255,255,255,0.1)";
      ctx.fill();

      ctx.textAlign = "center";
      ctx.fillStyle = isLeader ? "#060b19" : palette.textPrimary;
      ctx.font = `900 26px ${FONT_FAMILY}`;
      ctx.fillText(`#${idx + 1}`, rankCx, rankCy + 2);

      // اسم الفريق ونسبة الدقة
      ctx.textAlign = "right";
      ctx.fillStyle = palette.textPrimary;
      ctx.font = `900 ${count >= 4 ? 30 : 34}px ${FONT_FAMILY}`;
      ctx.fillText(truncateToWidth(ctx, team.name, 480), WIDTH - 178, rankCy - 14);

      ctx.fillStyle = palette.textMuted;
      ctx.font = `700 21px ${FONT_FAMILY}`;
      ctx.fillText(`الدقة: ${team.accuracy}%   •   إجابات صحيحة: ${team.correct}`, WIDTH - 178, rankCy + 22);

      // النقاط في اليسار
      ctx.textAlign = "left";
      ctx.fillStyle = team.color.main;
      ctx.font = `900 ${count >= 4 ? 44 : 50}px ${FONT_FAMILY}`;
      ctx.fillText(String(team.score), 102, rankCy - 6);

      ctx.fillStyle = palette.textMuted;
      ctx.font = `700 18px ${FONT_FAMILY}`;
      ctx.fillText("نقطة", 106, rankCy + 28);
    });

    // 5) شريط أبرز الإحصائيات (Highlights)
    const hi = computeHighlights(matchEvents, analytics);
    const hiY = 1044;
    const hiGap = 20;
    const hiW = Math.floor((WIDTH - 136 - hiGap * 2) / 3);
    const hiH = 158;

    const hiCards = [
      { label: "الفئة الأقوى", value: hi.strongestCat, color: palette.accent1 },
      { label: "أعلى ضربة", value: hi.topStrikeText, color: palette.accent2 },
      { label: hi.thirdLabel, value: hi.thirdValue, color: "#34d399" }
    ];

    hiCards.forEach((item, idx) => {
      // الترتيب من اليمين لليسار
      const x = WIDTH - 68 - (idx + 1) * hiW - idx * hiGap;
      drawRoundedRect(ctx, x, hiY, hiW, hiH, 22);
      ctx.fillStyle = palette.cardBg;
      ctx.fill();
      ctx.strokeStyle = palette.cardBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillStyle = palette.textMuted;
      ctx.font = `700 22px ${FONT_FAMILY}`;
      ctx.fillText(item.label, x + hiW / 2, hiY + 46);

      ctx.fillStyle = item.color;
      ctx.font = `900 30px ${FONT_FAMILY}`;
      ctx.fillText(truncateToWidth(ctx, item.value, hiW - 28), x + hiW / 2, hiY + 104);
    });

    // 6) التذييل الأنيق
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(96, HEIGHT - 102);
    ctx.lineTo(WIDTH - 96, HEIGHT - 102);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = palette.textMuted;
    ctx.font = `700 22px ${FONT_FAMILY}`;
    ctx.fillText("سين جيم  •  لعبة المسابقات الثقافية الجماعية", WIDTH / 2, HEIGHT - 66);

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => {
      if (!canvas || typeof canvas.toBlob !== "function") {
        resolve(null);
        return;
      }
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  function getDefaultFilename() {
    const dateStr = new Date().toISOString().slice(0, 10);
    return `seen-jeem-result-${dateStr}.png`;
  }

  function downloadBlobAsPNG(blob, filename = getDefaultFilename()) {
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1800);
    return true;
  }

  function canNativeShareFiles() {
    try {
      if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
      if (typeof File === "undefined") return false;
      if (typeof navigator.canShare === "function") {
        const dummy = new File([new Uint8Array([0])], "test.png", { type: "image/png" });
        return Boolean(navigator.canShare({ files: [dummy] }));
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  async function shareResultBlob(blob, title = "نتيجة مباراة سين جيم") {
    if (!blob || !canNativeShareFiles()) return { ok: false, reason: "unsupported" };
    try {
      const file = new File([blob], getDefaultFilename(), { type: "image/png" });
      await navigator.share({
        title,
        text: "نتائج جولتنا في لعبة سين جيم 🎯🏆",
        files: [file]
      });
      return { ok: true };
    } catch (err) {
      if (err && err.name === "AbortError") {
        return { ok: false, reason: "aborted" };
      }
      return { ok: false, reason: "error" };
    }
  }

  async function copyResultBlobToClipboard(blob) {
    if (!blob) return { ok: false, reason: "no-blob" };
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.write === "function" &&
        typeof window.ClipboardItem === "function"
      ) {
        const item = new window.ClipboardItem({ "image/png": blob });
        await navigator.clipboard.write([item]);
        return { ok: true };
      }
      return { ok: false, reason: "unsupported" };
    } catch (_err) {
      return { ok: false, reason: "error" };
    }
  }

  window.SeenJeemResultCard = {
    WIDTH,
    HEIGHT,
    generateCanvas,
    canvasToBlob,
    getDefaultFilename,
    downloadBlobAsPNG,
    canNativeShareFiles,
    shareResultBlob,
    copyResultBlobToClipboard
  };
})();
