/**
 * محرّك طور «جولة البرق السريعة» (60-Second Blitz Mode)
 * - يدعم اللعب الفردي (1 فريق) أو الجماعي (2 إلى 4 فرق)
 * - يفلتر تلقائياً الأسئلة النصية العادية فقط (بدون صور/بصريات، بدون mgk-*، بدون الأسئلة المحدّدة للمراجعة)
 * - يعتمد على historyStore للملف النشط (غير الملعوب أولاً ثم الأقدم لعباً) ويوسم المعروض فعلياً كملعوب
 * - يبني لقطة عرض منقّاة تماماً لشاشة التلفزيون (?mode=display) دون تسريب الإجابة نهائياً
 */
(function () {
  "use strict";

  const POINTS_PER_CORRECT = 100;

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function isEligibleBlitzQuestion(cat, q, flaggedStore) {
    if (!cat || !q || typeof q !== "object") return false;
    if (typeof cat.id === "string" && cat.id.toLowerCase().startsWith("mgk-")) return false;
    if (cat.group === "charades" || cat.group === "visual") return false;
    if (!q.id || typeof q.question !== "string" || !q.question.trim()) return false;
    if (typeof q.answer !== "string" || !q.answer.trim()) return false;
    if (flaggedStore && typeof flaggedStore.isFlagged === "function" && flaggedStore.isFlagged(q.id)) {
      return false;
    }
    const vType = typeof q.visualType === "string" ? q.visualType.trim().toLowerCase() : "normal";
    if (vType && vType !== "normal") return false;
    if (typeof q.questionImage === "string" && q.questionImage.trim()) return false;
    if (typeof q.audioUrl === "string" && q.audioUrl.trim()) return false;
    if (Number(q.differencesCount) > 0) return false;
    if (Array.isArray(q.images) && q.images.length > 0) return false;
    return true;
  }

  /**
   * بناء رزمة أسئلة مرتبة بحيث تتصدر الأسئلة غير الملعوبة في historyStore ثم الأقدم لعباً
   */
  function buildDeck({
    allCategories = [],
    sourceMode = "all", // "all" | "group" | "categories"
    selectedGroup = "all",
    selectedCategoryIds = [],
    resolveGroupFn = null,
    historyStore = null,
    flaggedStore = null
  }) {
    const selectedSet = new Set(Array.isArray(selectedCategoryIds) ? selectedCategoryIds : []);
    const candidates = [];

    (allCategories || []).forEach((cat) => {
      if (!cat || !Array.isArray(cat.questions)) return;
      if (sourceMode === "group" && selectedGroup !== "all") {
        const gId = typeof resolveGroupFn === "function" ? resolveGroupFn(cat) : cat.group;
        if (gId !== selectedGroup) return;
      } else if (sourceMode === "categories" && selectedSet.size > 0) {
        if (!selectedSet.has(cat.id)) return;
      }

      cat.questions.forEach((q) => {
        if (!isEligibleBlitzQuestion(cat, q, flaggedStore)) return;
        candidates.push({
          id: q.id,
          categoryId: cat.id,
          categoryName: cat.name,
          categoryIcon: cat.icon || "⚡",
          points: Number(q.points) || 200,
          question: q.question.trim(),
          answer: q.answer.trim(),
          explanation: typeof q.explanation === "string" ? q.explanation.trim() : ""
        });
      });
    });

    const unplayed = [];
    const played = [];
    candidates.forEach((item) => {
      const isPlayed =
        historyStore && typeof historyStore.isPlayed === "function"
          ? historyStore.isPlayed(item.id)
          : false;
      if (isPlayed) {
        const ts =
          typeof historyStore.getLastPlayedAt === "function"
            ? historyStore.getLastPlayedAt(item.id)
            : 0;
        played.push({ item, ts, rand: Math.random() });
      } else {
        unplayed.push(item);
      }
    });

    played.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.rand - b.rand));
    return [...shuffle(unplayed), ...played.map((p) => p.item)];
  }

  function createSession({
    matchId,
    teamNames = ["اللاعب الأول"],
    durationSeconds = 60,
    roundsPerTeam = 1,
    deck = []
  }) {
    const cleanDuration = [60, 90, 120].includes(Number(durationSeconds))
      ? Number(durationSeconds)
      : 60;
    const cleanRounds = [1, 2, 3].includes(Number(roundsPerTeam)) ? Number(roundsPerTeam) : 1;

    const teams = teamNames.map((name, idx) => ({
      id: `blitz-team-${idx}`,
      name: String(name || `الفريق ${idx + 1}`).trim() || `الفريق ${idx + 1}`,
      score: 0,
      correctCount: 0,
      wrongCount: 0,
      skipCount: 0,
      bestStreak: 0
    }));

    return {
      matchId: matchId || `blitz_${Date.now().toString(36)}`,
      phase: "ready", // "ready" | "playing" | "turn-summary" | "finished"
      durationSeconds: cleanDuration,
      roundsPerTeam: cleanRounds,
      totalTurns: teams.length * cleanRounds,
      currentTurnNumber: 0,
      activeTeamIdx: 0,
      currentRoundForTeam: 1,
      teams,
      deck: deck.slice(),
      deckCursor: 0,
      currentQuestion: null,
      timerRemaining: cleanDuration,
      timerRunning: false,
      currentStreak: 0,
      lastFeedback: null, // { type: "correct" | "wrong" | "skip", ts: number }
      turnLog: [],
      allTurnsLog: []
    };
  }

  function drawNextQuestion(session) {
    if (!session || !Array.isArray(session.deck) || session.deck.length === 0) return null;
    if (session.deckCursor >= session.deck.length) {
      session.deck = shuffle(session.deck);
      session.deckCursor = 0;
    }
    const q = session.deck[session.deckCursor++];
    session.currentQuestion = q;
    return q;
  }

  function buildSanitizedDisplayPayload(session) {
    if (!session || typeof session !== "object") return null;
    const activeTeam = session.teams[session.activeTeamIdx] || session.teams[0];
    return {
      mode: "blitz",
      phase: session.phase,
      durationSeconds: session.durationSeconds,
      roundsPerTeam: session.roundsPerTeam,
      currentRoundForTeam: session.currentRoundForTeam,
      activeTeamIdx: session.activeTeamIdx,
      activeTeamName: activeTeam ? activeTeam.name : "",
      activeTeamScore: activeTeam ? activeTeam.score : 0,
      teams: session.teams.map((t) => ({
        id: t.id,
        name: t.name,
        score: t.score,
        correctCount: t.correctCount,
        wrongCount: t.wrongCount,
        bestStreak: t.bestStreak
      })),
      timerRemaining: session.timerRemaining,
      timerMax: session.durationSeconds,
      timerRunning: Boolean(session.timerRunning),
      currentStreak: session.currentStreak,
      lastFeedback: session.lastFeedback,
      // بروتوكول منع التسريب: لا تُمرَّر الإجابة مطلقاً أثناء اللعب!
      questionText:
        session.phase === "playing" && session.currentQuestion
          ? session.currentQuestion.question
          : null,
      categoryName:
        session.phase === "playing" && session.currentQuestion
          ? session.currentQuestion.categoryName
          : null,
      categoryIcon:
        session.phase === "playing" && session.currentQuestion
          ? session.currentQuestion.categoryIcon
          : "⚡",
      turnSummary:
        session.phase === "turn-summary"
          ? session.turnLog.map((entry) => ({
              question: entry.question,
              answer: entry.answer,
              outcome: entry.outcome
            }))
          : []
    };
  }

  window.SeenJeemBlitzMode = {
    POINTS_PER_CORRECT,
    buildDeck,
    createSession,
    drawNextQuestion,
    buildSanitizedDisplayPayload
  };
})();
