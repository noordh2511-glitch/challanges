/**
 * محرّك جولة الرهان النهائي وكسر التعادل (Final Wager & Tie-Breaker Engine)
 * - يدير آلة حالات واضحة من 3 مراحل: wager -> question -> reveal
 * - يختار سؤال الحسم ذكياً من خارج اللوحة (نصي عادي فقط، بدون mgk-*، بدون الأسئلة المحدّدة للمراجعة،
 *   بأولوية لمستوى 600 ثم 400 وغير الملعوب في historyStore للملف النشط)
 * - يفرض بروتوكول منع التسريب (Anti-Spoiler) على لقطة شاشة العرض التلفزيوني (?mode=display)
 */
(function () {
  "use strict";

  const DEFAULT_FINAL_TIMER_SECONDS = 60;
  const MIN_WAGER_CAP = 400;

  function cloneSimple(obj) {
    if (!obj || typeof obj !== "object") return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (_err) {
      return { ...obj };
    }
  }

  /**
   * إرجاع فهارس الفرق المتعادلة في المركز الأول
   * @param {Array<{ score: number }>} teams
   * @returns {number[]}
   */
  function getLeaderIndices(teams) {
    if (!Array.isArray(teams) || teams.length === 0) return [];
    let maxScore = -Infinity;
    teams.forEach((t) => {
      const s = Number(t && t.score) || 0;
      if (s > maxScore) maxScore = s;
    });
    const leaders = [];
    teams.forEach((t, idx) => {
      if ((Number(t && t.score) || 0) === maxScore) {
        leaders.push(idx);
      }
    });
    return leaders;
  }

  function isTopScoreTied(teams) {
    return getLeaderIndices(teams).length >= 2;
  }

  /**
   * الحد الأقصى العادل للرهان: Math.max(team.score, 400)
   */
  function computeMaxWager(teamScore) {
    const s = Number(teamScore);
    const safeScore = Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0;
    return Math.max(safeScore, MIN_WAGER_CAP);
  }

  /**
   * التحقق من أن السؤال نصي عادي صالح لجولة الحسم (بدون صور، بدون mgk-*، بدون مراجعة)
   */
  function isEligibleFinalQuestion(cat, q, excludedIds, flaggedStore) {
    if (!cat || !q || typeof q !== "object") return false;
    if (typeof cat.id === "string" && cat.id.toLowerCase().startsWith("mgk-")) return false;
    if (cat.group === "charades" || cat.group === "visual") return false;
    if (!q.id || excludedIds.has(q.id)) return false;
    if (flaggedStore && typeof flaggedStore.isFlagged === "function" && flaggedStore.isFlagged(q.id)) {
      return false;
    }

    const vType = typeof q.visualType === "string" ? q.visualType.trim().toLowerCase() : "normal";
    if (vType && vType !== "normal") return false;
    if (typeof q.questionImage === "string" && q.questionImage.trim()) return false;
    if (Array.isArray(q.images) && q.images.length > 0) return false;
    if (typeof q.question !== "string" || !q.question.trim()) return false;
    if (typeof q.answer !== "string" || !q.answer.trim()) return false;
    return true;
  }

  /**
   * اختيار سؤال حسم ذكي من البنك:
   * - خارج لوحة المباراة الحالية + خارج الأسئلة المستبعدة مسبقاً
   * - نصي عادي فقط، يستبعد mgk-* ويستبعد الأسئلة المحدّدة للمراجعة
   * - أولوية لأسئلة 600 ثم 400 (و200 كبديل أخير)
   * - أولوية للأسئلة غير الملعوبة في historyStore للملف النشط (وإلا الأقدم لعباً)
   */
  function pickFinalQuestion({
    allCategories = [],
    boardCategories = [],
    historyStore = null,
    flaggedStore = null,
    excludeQuestionIds = []
  }) {
    const excludedIds = new Set(Array.isArray(excludeQuestionIds) ? excludeQuestionIds : []);
    (boardCategories || []).forEach((bc) => {
      [...(bc.rightColumn || []), ...(bc.leftColumn || [])].forEach((slot) => {
        if (slot && slot.question && slot.question.id) {
          excludedIds.add(slot.question.id);
        }
      });
    });

    const tiersToTry = [600, 400, 200];

    for (let tIdx = 0; tIdx < tiersToTry.length; tIdx++) {
      const targetPoints = tiersToTry[tIdx];
      const candidates = [];
      const catByQId = new Map();

      (allCategories || []).forEach((cat) => {
        if (!cat || !Array.isArray(cat.questions)) return;
        cat.questions.forEach((q) => {
          if (Number(q.points) !== targetPoints) return;
          if (!isEligibleFinalQuestion(cat, q, excludedIds, flaggedStore)) return;
          candidates.push(q);
          catByQId.set(q.id, cat);
        });
      });

      if (candidates.length > 0) {
        let pickedQ = null;
        if (historyStore && typeof historyStore.selectQuestionsForTier === "function") {
          const sel = historyStore.selectQuestionsForTier(candidates, 1);
          if (sel && Array.isArray(sel.picked) && sel.picked[0] && sel.picked[0].question) {
            pickedQ = sel.picked[0].question;
          }
        }
        if (!pickedQ) {
          pickedQ = candidates[Math.floor(Math.random() * candidates.length)];
        }
        const pickedCat = catByQId.get(pickedQ.id);
        return {
          category: {
            id: pickedCat.id,
            name: pickedCat.name,
            icon: pickedCat.icon || "🏆",
            color: pickedCat.color || "#f59e0b"
          },
          question: cloneSimple(pickedQ)
        };
      }
    }

    return null;
  }

  /**
   * إنشاء حالة جولة نهائية جديدة في المرحلة الأولى (wager)
   */
  function createFinalRoundState({
    triggerReason = "tie-breaker", // "tie-breaker" | "always" | "manual"
    teams = [],
    picked = null,
    roundNumber = 1,
    usedQuestionIds = []
  }) {
    if (!picked || !picked.question || !picked.category) return null;

    const participantIndices =
      triggerReason === "always"
        ? teams.map((_, idx) => idx)
        : getLeaderIndices(teams);

    const safeParticipants =
      participantIndices.length >= 2 ? participantIndices : teams.map((_, idx) => idx);

    const wagers = {};
    const judgments = {};
    safeParticipants.forEach((idx) => {
      const team = teams[idx] || { score: 0 };
      const maxWager = computeMaxWager(team.score);
      wagers[idx] = {
        amount: 0,
        locked: false,
        maxWager
      };
      judgments[idx] = null;
    });

    const nextUsed = Array.from(
      new Set([...(Array.isArray(usedQuestionIds) ? usedQuestionIds : []), picked.question.id])
    );

    return {
      phase: "wager", // "wager" | "question" | "reveal"
      triggerReason,
      roundNumber: Math.max(1, Math.floor(Number(roundNumber) || 1)),
      participantIndices: safeParticipants,
      category: cloneSimple(picked.category),
      question: cloneSimple(picked.question),
      wagers,
      judgments,
      results: null,
      timerRemaining: DEFAULT_FINAL_TIMER_SECONDS,
      timerMax: DEFAULT_FINAL_TIMER_SECONDS,
      timerRunning: false,
      usedQuestionIds: nextUsed
    };
  }

  function areAllWagersLocked(finalState) {
    if (!finalState || !Array.isArray(finalState.participantIndices)) return false;
    return (
      finalState.participantIndices.length > 0 &&
      finalState.participantIndices.every((idx) => {
        const w = finalState.wagers && finalState.wagers[idx];
        return Boolean(w && w.locked);
      })
    );
  }

  function areAllJudgmentsSet(finalState) {
    if (!finalState || !Array.isArray(finalState.participantIndices)) return false;
    return (
      finalState.participantIndices.length > 0 &&
      finalState.participantIndices.every((idx) => {
        const j = finalState.judgments && finalState.judgments[idx];
        return j === "correct" || j === "wrong";
      })
    );
  }

  /**
   * احتساب نتائج جولة الحسم (+رهان للصحيح، و-رهان للخاطئ مع الالتزام بعدم السماح بنقاط سالبة وفق matchStore)
   */
  function computeFinalResolution(finalState, teams) {
    if (!finalState || !Array.isArray(teams)) return null;
    const results = {};

    finalState.participantIndices.forEach((idx) => {
      const team = teams[idx];
      if (!team) return;
      const wObj = finalState.wagers[idx] || { amount: 0, maxWager: computeMaxWager(team.score) };
      const wager = Math.max(0, Math.min(wObj.maxWager, Math.round(Number(wObj.amount) || 0)));
      const isCorrect = finalState.judgments[idx] === "correct";
      const prevScore = Math.max(0, Math.round(Number(team.score) || 0));
      const rawDelta = isCorrect ? wager : -wager;
      const nextScore = Math.max(0, prevScore + rawDelta);
      const effectiveDelta = nextScore - prevScore;

      results[idx] = {
        teamIdx: idx,
        teamId: team.id || `team-${idx}`,
        teamName: team.name,
        wager,
        correct: isCorrect,
        prevScore,
        nextScore,
        rawDelta,
        effectiveDelta
      };
    });

    return results;
  }

  /**
   * بناء لقطة منقّاة تماماً لشاشة العرض التلفزيوني (?mode=display) — بروتوكول منع التسريب الصارم:
   * - في مرحلة wager: الفئة وحالة التثبيت فقط (ممنوع نص السؤال، وممنوع مبالغ الرهان، وممنوع الإجابة!)
   * - في مرحلة question: الفئة ونص السؤال والمؤقت فقط (ممنوع مبالغ الرهان، وممنوع الإجابة أو الشرح!)
   * - في مرحلة reveal: تُكشف الإجابة والشرح ومبالغ الرهان والنتائج النهائية
   */
  function buildSanitizedDisplayPayload(finalState, teams) {
    if (!finalState || typeof finalState !== "object") return null;
    const phase =
      finalState.phase === "question" || finalState.phase === "reveal"
        ? finalState.phase
        : "wager";

    const participants = (finalState.participantIndices || []).map((idx) => {
      const t = (teams && teams[idx]) || { id: `team-${idx}`, name: `الفريق ${idx + 1}`, score: 0 };
      const w = (finalState.wagers && finalState.wagers[idx]) || { amount: 0, locked: false };
      const res = phase === "reveal" && finalState.results ? finalState.results[idx] || null : null;

      return {
        teamIdx: idx,
        teamId: t.id || `team-${idx}`,
        name: t.name,
        score: Number(t.score) || 0,
        locked: Boolean(w.locked),
        // بروتوكول منع التسريب: لا يُمرَّر مبلغ الرهان أو النتيجة قبل مرحلة reveal أبداً!
        wager: phase === "reveal" && res ? res.wager : null,
        correct: phase === "reveal" && res ? Boolean(res.correct) : null,
        rawDelta: phase === "reveal" && res ? res.rawDelta : null,
        effectiveDelta: phase === "reveal" && res ? res.effectiveDelta : null,
        prevScore: phase === "reveal" && res ? res.prevScore : null,
        nextScore: phase === "reveal" && res ? res.nextScore : null
      };
    });

    return {
      phase,
      triggerReason: finalState.triggerReason || "tie-breaker",
      roundNumber: Number(finalState.roundNumber) || 1,
      category: finalState.category
        ? {
            id: finalState.category.id || "",
            name: finalState.category.name || "",
            icon: finalState.category.icon || "🏆",
            color: finalState.category.color || "#f59e0b"
          }
        : { id: "", name: "", icon: "🏆", color: "#f59e0b" },
      participants,
      timerRemaining: Number(finalState.timerRemaining) || 0,
      timerMax: Number(finalState.timerMax) || DEFAULT_FINAL_TIMER_SECONDS,
      timerRunning: Boolean(finalState.timerRunning),
      // منع تسريب نص السؤال في مرحلة wager
      questionText:
        (phase === "question" || phase === "reveal") && finalState.question
          ? finalState.question.question || ""
          : null,
      // منع تسريب الإجابة والشرح قبل مرحلة reveal
      answerText:
        phase === "reveal" && finalState.question ? finalState.question.answer || "" : null,
      explanationText:
        phase === "reveal" && finalState.question && finalState.question.explanation
          ? finalState.question.explanation
          : null,
      stillTiedAfterReveal: phase === "reveal" ? isTopScoreTied(teams) : false
    };
  }

  window.SeenJeemFinalRound = {
    DEFAULT_FINAL_TIMER_SECONDS,
    MIN_WAGER_CAP,
    getLeaderIndices,
    isTopScoreTied,
    computeMaxWager,
    pickFinalQuestion,
    createFinalRoundState,
    areAllWagersLocked,
    areAllJudgmentsSet,
    computeFinalResolution,
    buildSanitizedDisplayPayload
  };
})();
