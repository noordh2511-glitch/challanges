/**
 * محرّك طور «من غير كلام» المستقل (Standalone Charades Mode)
 * - يدعم 2 إلى 4 فرق واختيار فئة أو أكثر من فئات mgk-* (أو الكل)
 * - يدعم حد التخطي المسموح في الدور (غير محدود / 2 / 3) دون وسم المتخطّى كملعوب في historyStore
 * - يفرض منع تسريب الكلمة السرية وطريقة التمثيل (explanation) على شاشة التلفزيون (?mode=display)
 */
(function () {
  "use strict";

  const POINTS_PER_GUESSED = 100;

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

  function getCharadesCategories(allCategories = []) {
    return (allCategories || []).filter(
      (cat) =>
        cat &&
        Array.isArray(cat.questions) &&
        cat.questions.length > 0 &&
        ((typeof cat.id === "string" && cat.id.toLowerCase().startsWith("mgk-")) ||
          cat.group === "charades")
    );
  }

  function buildDeck({
    allCategories = [],
    selectedCategoryIds = [],
    historyStore = null,
    flaggedStore = null,
    parseHeaderFn = null
  }) {
    const mgkCats = getCharadesCategories(allCategories);
    const chosenSet = new Set(Array.isArray(selectedCategoryIds) ? selectedCategoryIds : []);
    const activeCats =
      chosenSet.size > 0 ? mgkCats.filter((c) => chosenSet.has(c.id)) : mgkCats;

    const candidates = [];
    activeCats.forEach((cat) => {
      cat.questions.forEach((q) => {
        if (!q || !q.id || typeof q.answer !== "string" || !q.answer.trim()) return;
        if (flaggedStore && typeof flaggedStore.isFlagged === "function" && flaggedStore.isFlagged(q.id)) {
          return;
        }
        const parsedHeader =
          typeof parseHeaderFn === "function"
            ? parseHeaderFn(q.question || "", q.answer, cat.name)
            : { eyebrow: "🎭 من غير كلام", topic: cat.name, wordCountLabel: "" };

        candidates.push({
          id: q.id,
          categoryId: cat.id,
          categoryName: cat.name,
          categoryIcon: cat.icon || "🎭",
          points: Number(q.points) || 200,
          question: q.question || "",
          answer: q.answer.trim(),
          explanation: typeof q.explanation === "string" ? q.explanation.trim() : "",
          hint: typeof q.hint === "string" ? q.hint.trim() : "",
          header: parsedHeader
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
    teamNames = ["الفريق الأول", "الفريق الثاني"],
    durationSeconds = 90,
    roundsPerTeam = 3,
    skipLimit = 2, // 0 = غير محدود | 2 | 3
    deck = []
  }) {
    const cleanDuration = [60, 90, 120].includes(Number(durationSeconds))
      ? Number(durationSeconds)
      : 90;
    const cleanRounds = [2, 3, 5].includes(Number(roundsPerTeam)) ? Number(roundsPerTeam) : 3;
    const cleanSkipLimit = [0, 2, 3].includes(Number(skipLimit)) ? Number(skipLimit) : 2;

    const teams = teamNames.map((name, idx) => ({
      id: `charades-team-${idx}`,
      name: String(name || `الفريق ${idx + 1}`).trim() || `الفريق ${idx + 1}`,
      score: 0,
      guessedCount: 0,
      skippedCount: 0
    }));

    return {
      matchId: matchId || `charades_${Date.now().toString(36)}`,
      phase: "ready", // "ready" | "playing" | "turn-summary" | "finished"
      durationSeconds: cleanDuration,
      roundsPerTeam: cleanRounds,
      skipLimit: cleanSkipLimit, // 0 = unlimited
      totalTurns: teams.length * cleanRounds,
      currentTurnNumber: 0,
      activeTeamIdx: 0,
      currentRoundForTeam: 1,
      teams,
      deck: deck.slice(),
      deckCursor: 0,
      currentCard: null,
      hintRevealedForCurrent: false,
      skipsUsedThisTurn: 0,
      timerRemaining: cleanDuration,
      timerRunning: false,
      lastFeedback: null,
      turnLog: [],
      allTurnsLog: []
    };
  }

  function drawNextCard(session) {
    if (!session || !Array.isArray(session.deck) || session.deck.length === 0) return null;
    if (session.deckCursor >= session.deck.length) {
      session.deck = shuffle(session.deck);
      session.deckCursor = 0;
    }
    const card = session.deck[session.deckCursor++];
    session.currentCard = card;
    session.hintRevealedForCurrent = false;
    return card;
  }

  function canSkipInCurrentTurn(session) {
    if (!session) return false;
    if (session.skipLimit === 0) return true;
    return session.skipsUsedThisTurn < session.skipLimit;
  }

  function buildSanitizedDisplayPayload(session) {
    if (!session || typeof session !== "object") return null;
    const activeTeam = session.teams[session.activeTeamIdx] || session.teams[0];
    const card = session.currentCard;
    const allowHint = Boolean(session.phase === "playing" && card && session.hintRevealedForCurrent && card.hint);

    return {
      mode: "charades",
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
        guessedCount: t.guessedCount,
        skippedCount: t.skippedCount
      })),
      timerRemaining: session.timerRemaining,
      timerMax: session.durationSeconds,
      timerRunning: Boolean(session.timerRunning),
      lastFeedback: session.lastFeedback,
      // بروتوكول منع التسريب: لا يُمرَّر answer أو explanation أبداً على شاشة التلفزيون أثناء الدور!
      header: session.phase === "playing" && card ? card.header : null,
      categoryName: session.phase === "playing" && card ? card.categoryName : null,
      hintText: allowHint ? card.hint : null,
      turnSummary:
        session.phase === "turn-summary"
          ? session.turnLog.map((entry) => ({
              topic: entry.topic,
              answer: entry.answer,
              outcome: entry.outcome
            }))
          : []
    };
  }

  window.SeenJeemCharadesMode = {
    POINTS_PER_GUESSED,
    getCharadesCategories,
    buildDeck,
    createSession,
    drawNextCard,
    canSkipInCurrentTurn,
    buildSanitizedDisplayPayload
  };
})();
