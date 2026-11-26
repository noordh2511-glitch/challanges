/**
 * نظام الحفظ التلقائي للمباراة + مكدّس التراجع غير القابل للطفرة (Auto-Save & Immutable Undo Stack)
 * - يحفظ حالة المباراة الجارية في localStorage بعد كل إجراء مع إمكانية الاستعادة الكاملة بعد تحديث الصفحة
 * - يدعم إعدادات وسائل المساعدة التكتيكية (Hint Discount, 2x Double, Swap, Steal Mode) ورصيد كل فريق
 * - يدعم سجل أحداث المباراة (matchEvents) مع التراجع الدقيق عبر Undo Stack (Ctrl+Z)
 * - يحافظ على التوافق الرجعي الكامل مع أي مباراة محفوظة مسبقاً في localStorage
 */
(function () {
  "use strict";

  const MATCH_STORAGE_KEY = "seen_jeem_active_match_v1";
  const TACTICAL_SETTINGS_KEY = "seen_jeem_tactical_settings_v1";
  const THEME_STORAGE_KEY = "seen_jeem_theme_v1";
  const TV_SCALE_STORAGE_KEY = "seen_jeem_tv_scale_v1";
  const SCHEMA_VERSION = 1;
  const MAX_UNDO_STEPS = 15;

  const VALID_THEMES = new Set(["dark-glass", "royal-gold", "high-contrast"]);
  const DEFAULT_INTERMISSION_MESSAGE = "استراحة قصيرة — نعود بعد قليل";

  const DEFAULT_MATCH_SETTINGS = Object.freeze({
    teamCount: 2, // 2 | 3 | 4
    finalRoundMode: "tie-only", // "tie-only" | "always" | "off"
    dailyDoubleCount: 1, // 0 | 1 | 2
    mainTimerSeconds: 0, // 0 (معطّل افتراضياً) | 30 | 45 | 60 | 90
    hintEnabled: true,
    hintPenalty: 0.25, // 0 | 0.25 | 0.5
    doubleEnabled: true,
    doubleCount: 1, // 0..3
    swapEnabled: true,
    swapCount: 1, // 0..3
    stealEnabled: true,
    stealMultiplier: 0.5, // 0.5 | 1
    stealTimerSeconds: 15 // 10 | 15 | 20
  });

  const VALID_TEAM_COUNTS = new Set([2, 3, 4]);
  const VALID_FINAL_ROUND_MODES = new Set(["tie-only", "always", "off"]);
  const VALID_DAILY_DOUBLE_COUNTS = new Set([0, 1, 2]);
  const VALID_MAIN_TIMERS = new Set([0, 30, 45, 60, 90]);
  const VALID_HINT_PENALTIES = new Set([0, 0.25, 0.5]);
  const VALID_STEAL_MULTIPLIERS = new Set([0.5, 1]);
  const VALID_STEAL_TIMERS = new Set([10, 15, 20]);
  const VALID_BASE_POINTS = new Set([200, 400, 600]);

  /**
   * نسخ عميق لكائنات البيانات النقية (JSON-safe)
   */
  function deepClone(value) {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => deepClone(item));
    }
    const out = {};
    Object.keys(value).forEach((key) => {
      const v = value[key];
      if (v !== undefined) {
        out[key] = deepClone(v);
      }
    });
    return out;
  }

  /**
   * تجميد عميق (Deep Freeze) لضمان عدم قابلية أي لقطة أو مكدّس للطفرة مطلقاً
   */
  function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    Object.keys(obj).forEach((key) => {
      const prop = obj[key];
      if (prop && typeof prop === "object" && !Object.isFrozen(prop)) {
        deepFreeze(prop);
      }
    });
    return Object.freeze(obj);
  }

  function clampInt(val, min, max, fallback) {
    const num = Number(val);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  }

  /**
   * تنقية إعدادات وسائل المساعدة واللعب التكتيكي مع قيم افتراضية متوازنة وآمنة للتوافق الرجعي
   */
  function sanitizeMatchSettings(raw) {
    if (!raw || typeof raw !== "object") {
      return { ...DEFAULT_MATCH_SETTINGS };
    }

    const rawTeamCount = Number(raw.teamCount);
    const teamCount = VALID_TEAM_COUNTS.has(rawTeamCount)
      ? rawTeamCount
      : DEFAULT_MATCH_SETTINGS.teamCount;

    const finalRoundMode = VALID_FINAL_ROUND_MODES.has(raw.finalRoundMode)
      ? raw.finalRoundMode
      : DEFAULT_MATCH_SETTINGS.finalRoundMode;

    const rawDdCount = Number(raw.dailyDoubleCount);
    const dailyDoubleCount =
      raw.dailyDoubleCount !== undefined && VALID_DAILY_DOUBLE_COUNTS.has(rawDdCount)
        ? rawDdCount
        : DEFAULT_MATCH_SETTINGS.dailyDoubleCount;

    const rawMainTimer = Number(raw.mainTimerSeconds);
    const mainTimerSeconds =
      raw.mainTimerSeconds !== undefined && VALID_MAIN_TIMERS.has(rawMainTimer)
        ? rawMainTimer
        : DEFAULT_MATCH_SETTINGS.mainTimerSeconds;

    const hintEnabled =
      raw.hintEnabled !== undefined ? Boolean(raw.hintEnabled) : DEFAULT_MATCH_SETTINGS.hintEnabled;
    const rawPenalty = Number(raw.hintPenalty);
    const hintPenalty = VALID_HINT_PENALTIES.has(rawPenalty)
      ? rawPenalty
      : DEFAULT_MATCH_SETTINGS.hintPenalty;

    const doubleCount = clampInt(raw.doubleCount, 0, 3, DEFAULT_MATCH_SETTINGS.doubleCount);
    const doubleEnabled =
      raw.doubleEnabled !== undefined ? Boolean(raw.doubleEnabled) && doubleCount > 0 : doubleCount > 0;

    const swapCount = clampInt(raw.swapCount, 0, 3, DEFAULT_MATCH_SETTINGS.swapCount);
    const swapEnabled =
      raw.swapEnabled !== undefined ? Boolean(raw.swapEnabled) && swapCount > 0 : swapCount > 0;

    const stealEnabled =
      raw.stealEnabled !== undefined ? Boolean(raw.stealEnabled) : DEFAULT_MATCH_SETTINGS.stealEnabled;
    const rawStealMult = Number(raw.stealMultiplier);
    const stealMultiplier = VALID_STEAL_MULTIPLIERS.has(rawStealMult)
      ? rawStealMult
      : DEFAULT_MATCH_SETTINGS.stealMultiplier;

    const rawStealSecs = Number(raw.stealTimerSeconds);
    const stealTimerSeconds = VALID_STEAL_TIMERS.has(rawStealSecs)
      ? rawStealSecs
      : DEFAULT_MATCH_SETTINGS.stealTimerSeconds;

    return {
      teamCount,
      finalRoundMode,
      dailyDoubleCount,
      mainTimerSeconds,
      hintEnabled,
      hintPenalty,
      doubleEnabled,
      doubleCount: doubleEnabled ? doubleCount : 0,
      swapEnabled,
      swapCount: swapEnabled ? swapCount : 0,
      stealEnabled,
      stealMultiplier,
      stealTimerSeconds
    };
  }

  function sanitizeTeamSnapshot(rawTeam, idx, fallbackName, settings = DEFAULT_MATCH_SETTINGS) {
    const safeSettings = sanitizeMatchSettings(settings);
    const defaultDouble = safeSettings.doubleEnabled ? safeSettings.doubleCount : 0;
    const defaultSwap = safeSettings.swapEnabled ? safeSettings.swapCount : 0;
    const defaultId = `team-${idx}`;

    if (!rawTeam || typeof rawTeam !== "object") {
      return {
        id: defaultId,
        name: fallbackName,
        score: 0,
        powerups: {
          doubleLeft: defaultDouble,
          swapLeft: defaultSwap
        },
        lifelines: { double: defaultDouble === 0, twoAnswers: false, callFriend: false }
      };
    }

    const id =
      typeof rawTeam.id === "string" && rawTeam.id.trim() ? rawTeam.id.trim() : defaultId;
    const name =
      typeof rawTeam.name === "string" && rawTeam.name.trim()
        ? rawTeam.name.trim()
        : fallbackName;
    const scoreNum = Number(rawTeam.score);
    const score = Number.isFinite(scoreNum) ? Math.max(0, Math.round(scoreNum)) : 0;
    const rawLife = rawTeam.lifelines && typeof rawTeam.lifelines === "object" ? rawTeam.lifelines : {};
    const rawPower = rawTeam.powerups && typeof rawTeam.powerups === "object" ? rawTeam.powerups : null;

    let doubleLeft;
    let swapLeft;

    if (rawPower) {
      doubleLeft = clampInt(rawPower.doubleLeft, 0, 3, defaultDouble);
      swapLeft = clampInt(rawPower.swapLeft, 0, 3, defaultSwap);
    } else {
      doubleLeft = rawLife.double === true ? 0 : defaultDouble;
      swapLeft = defaultSwap;
    }

    return {
      id,
      name,
      score,
      powerups: {
        doubleLeft,
        swapLeft
      },
      lifelines: {
        double: doubleLeft === 0,
        twoAnswers: Boolean(rawLife.twoAnswers),
        callFriend: Boolean(rawLife.callFriend)
      }
    };
  }

  function sanitizeTeamsList(rawTeams, settings = DEFAULT_MATCH_SETTINGS) {
    if (!Array.isArray(rawTeams) || rawTeams.length < 2) {
      return [
        sanitizeTeamSnapshot(null, 0, "الفريق الأول", settings),
        sanitizeTeamSnapshot(null, 1, "الفريق الثاني", settings)
      ];
    }
    return rawTeams.map((team, idx) => {
      const fallback = idx === 0 ? "الفريق الأول" : idx === 1 ? "الفريق الثاني" : `الفريق ${idx + 1}`;
      return sanitizeTeamSnapshot(team, idx, fallback, settings);
    });
  }

  /**
   * تنقية حدث مباراة واحد (MatchEvent)
   */
  function sanitizeMatchEvent(raw) {
    if (!raw || typeof raw !== "object") return null;
    const questionId = typeof raw.questionId === "string" ? raw.questionId.trim() : "";
    const categoryId = typeof raw.categoryId === "string" ? raw.categoryId.trim() : "";
    if (!questionId || !categoryId) return null;

    const rawBase = Number(raw.basePoints);
    const basePoints = VALID_BASE_POINTS.has(rawBase) ? rawBase : 200;
    const rawEff = Number(raw.effectivePoints);
    const effectivePoints = Number.isFinite(rawEff) && rawEff >= 0 ? Math.round(rawEff) : 0;

    const askingTeamId =
      typeof raw.askingTeamId === "string" && raw.askingTeamId.trim()
        ? raw.askingTeamId.trim()
        : "team-0";
    const awardedTeamId =
      typeof raw.awardedTeamId === "string" && raw.awardedTeamId.trim()
        ? raw.awardedTeamId.trim()
        : null;

    const ts = Number(raw.timestamp);

    const clean = {
      questionId,
      categoryId,
      categoryName: typeof raw.categoryName === "string" ? raw.categoryName.trim() : categoryId,
      questionText: typeof raw.questionText === "string" ? raw.questionText.trim() : "",
      answerText: typeof raw.answerText === "string" ? raw.answerText.trim() : "",
      basePoints,
      effectivePoints,
      askingTeamId,
      awardedTeamId,
      wasSteal: Boolean(raw.wasSteal),
      wasDouble: Boolean(raw.wasDouble),
      hintUsed: Boolean(raw.hintUsed),
      wasSwapped: Boolean(raw.wasSwapped),
      timestamp: Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : Date.now()
    };

    if (typeof raw.explanation === "string" && raw.explanation.trim()) {
      clean.explanation = raw.explanation.trim();
    }
    if (raw.isFinalRound) {
      clean.isFinalRound = true;
      if (raw.finalSummary && typeof raw.finalSummary === "string") {
        clean.finalSummary = raw.finalSummary.trim();
      }
    }
    if (raw.wasDailyDouble) {
      clean.wasDailyDouble = true;
      const w = Number(raw.dailyDoubleWager);
      if (Number.isFinite(w) && w >= 0) {
        clean.dailyDoubleWager = Math.round(w);
      }
    }

    return clean;
  }

  function sanitizeRefereeAdjustment(raw) {
    if (!raw || typeof raw !== "object") return null;
    const teamId = typeof raw.teamId === "string" && raw.teamId.trim() ? raw.teamId.trim() : "";
    if (!teamId) return null;
    const delta = Number(raw.delta);
    if (!Number.isFinite(delta) || delta === 0) return null;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : `ref_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      teamId,
      teamName: typeof raw.teamName === "string" ? raw.teamName.trim() : teamId,
      type: raw.type === "powerup" ? "powerup" : "score",
      delta: Math.round(delta),
      detail: typeof raw.detail === "string" ? raw.detail.trim() : "",
      timestamp: Number.isFinite(Number(raw.timestamp)) ? Math.floor(Number(raw.timestamp)) : Date.now()
    };
  }

  function sanitizeRefereeAdjustmentsList(rawList) {
    if (!Array.isArray(rawList)) return [];
    return rawList.map(sanitizeRefereeAdjustment).filter(Boolean);
  }

  function sanitizeMatchEventsList(rawList) {
    if (!Array.isArray(rawList)) return [];
    const out = [];
    for (let i = 0; i < rawList.length; i++) {
      const clean = sanitizeMatchEvent(rawList[i]);
      if (clean) out.push(clean);
    }
    return out;
  }

  function sanitizeUndoEntry(raw, fallbackSettings = DEFAULT_MATCH_SETTINGS) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.teams) || raw.teams.length < 2) {
      return null;
    }

    const teams = sanitizeTeamsList(raw.teams, fallbackSettings);
    const rawTurn = Number(raw.activeTurn);
    const activeTurn =
      Number.isInteger(rawTurn) && rawTurn >= 0 && rawTurn < teams.length ? rawTurn : 0;
    const doubleArmed = Boolean(raw.doubleArmed);
    const answeredNum = Number(raw.answeredThisRound);
    const answeredThisRound =
      Number.isFinite(answeredNum) && answeredNum >= 0 ? Math.floor(answeredNum) : 0;

    let cellState = null;
    if (raw.cellState && typeof raw.cellState === "object") {
      const catIdx = Number(raw.cellState.catIdx);
      const colKey = raw.cellState.colKey === "leftColumn" ? "leftColumn" : "rightColumn";
      const slotIdx = Number(raw.cellState.slotIdx);
      if (Number.isInteger(catIdx) && catIdx >= 0 && Number.isInteger(slotIdx) && slotIdx >= 0) {
        const rawWinner = raw.cellState.winnerTeam;
        const winnerTeam =
          Number.isInteger(rawWinner) && rawWinner >= 0 && rawWinner < teams.length
            ? rawWinner
            : null;
        cellState = {
          catIdx,
          colKey,
          slotIdx,
          played: Boolean(raw.cellState.played),
          winnerTeam,
          ...(raw.cellState.question && typeof raw.cellState.question === "object"
            ? {
                question: deepClone(raw.cellState.question),
                recycled: Boolean(raw.cellState.recycled),
                previouslyPlayed: Boolean(raw.cellState.previouslyPlayed)
              }
            : {})
        };
      }
    }

    let questionHistorySnapshot = null;
    if (
      raw.questionHistorySnapshot &&
      typeof raw.questionHistorySnapshot === "object" &&
      typeof raw.questionHistorySnapshot.questionId === "string" &&
      raw.questionHistorySnapshot.questionId.trim()
    ) {
      const ts = Number(raw.questionHistorySnapshot.lastPlayedAt);
      questionHistorySnapshot = {
        profileId:
          typeof raw.questionHistorySnapshot.profileId === "string" &&
          raw.questionHistorySnapshot.profileId.trim()
            ? raw.questionHistorySnapshot.profileId.trim()
            : "default",
        questionId: raw.questionHistorySnapshot.questionId.trim(),
        wasPlayed: Boolean(raw.questionHistorySnapshot.wasPlayed),
        lastPlayedAt: Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : null
      };
    }

    const matchEvents = Array.isArray(raw.matchEvents)
      ? sanitizeMatchEventsList(raw.matchEvents)
      : null;

    const refereeAdjustments = Array.isArray(raw.refereeAdjustments)
      ? sanitizeRefereeAdjustmentsList(raw.refereeAdjustments)
      : null;

    const finalRound =
      raw.finalRound && typeof raw.finalRound === "object"
        ? deepClone(raw.finalRound)
        : null;

    return deepFreeze({
      id:
        typeof raw.id === "string" && raw.id
          ? raw.id
          : `undo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : Date.now(),
      actionType: typeof raw.actionType === "string" ? raw.actionType : "action",
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "آخر إجراء",
      teams,
      activeTurn,
      doubleArmed,
      answeredThisRound,
      matchEvents,
      refereeAdjustments,
      finalRound,
      cellState,
      questionHistorySnapshot
    });
  }

  class MatchStore {
    constructor() {
      /** @type {ReadonlyArray<Object>} */
      this._undoStack = Object.freeze([]);
    }

    getDefaultSettings() {
      return { ...DEFAULT_MATCH_SETTINGS };
    }

    sanitizeSettings(raw) {
      return sanitizeMatchSettings(raw);
    }

    sanitizeMatchEvent(raw) {
      return sanitizeMatchEvent(raw);
    }

    sanitizeMatchEvents(rawList) {
      return sanitizeMatchEventsList(rawList);
    }

    loadSavedSettings() {
      try {
        const raw = localStorage.getItem(TACTICAL_SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_MATCH_SETTINGS };
        return sanitizeMatchSettings(JSON.parse(raw));
      } catch (_err) {
        return { ...DEFAULT_MATCH_SETTINGS };
      }
    }

    saveSettings(settings) {
      try {
        const clean = sanitizeMatchSettings(settings);
        localStorage.setItem(TACTICAL_SETTINGS_KEY, JSON.stringify(clean));
        return clean;
      } catch (_err) {
        return sanitizeMatchSettings(settings);
      }
    }

    getMaxUndoSteps() {
      return MAX_UNDO_STEPS;
    }

    getUndoCount() {
      return this._undoStack.length;
    }

    canUndo() {
      return this._undoStack.length > 0;
    }

    peekUndo() {
      if (this._undoStack.length === 0) return null;
      return this._undoStack[this._undoStack.length - 1];
    }

    getUndoStack() {
      return this._undoStack;
    }

    clearUndoStack() {
      this._undoStack = Object.freeze([]);
    }

    /**
     * دفع لقطة غير قابلة للطفرة إلى مكدّس التراجع (بحد أقصى 15 إجراء)
     */
    pushUndoSnapshot(rawSnapshot, settings = DEFAULT_MATCH_SETTINGS) {
      const frozenEntry = sanitizeUndoEntry(deepClone(rawSnapshot), settings);
      if (!frozenEntry) return this._undoStack.length;

      const trimmedBase =
        this._undoStack.length >= MAX_UNDO_STEPS
          ? this._undoStack.slice(this._undoStack.length - (MAX_UNDO_STEPS - 1))
          : this._undoStack.slice();

      trimmedBase.push(frozenEntry);
      this._undoStack = Object.freeze(trimmedBase);
      return this._undoStack.length;
    }

    /**
     * سحب أحدث لقطة من مكدّس التراجع دون طفرة المصفوفة السابقة
     */
    popUndoSnapshot() {
      if (this._undoStack.length === 0) return null;
      const top = this._undoStack[this._undoStack.length - 1];
      this._undoStack = Object.freeze(this._undoStack.slice(0, this._undoStack.length - 1));
      return top;
    }

    restoreUndoStack(serializedStack, settings = DEFAULT_MATCH_SETTINGS) {
      if (!Array.isArray(serializedStack)) {
        this._undoStack = Object.freeze([]);
        return;
      }
      const valid = serializedStack
        .map((item) => sanitizeUndoEntry(item, settings))
        .filter(Boolean)
        .slice(-MAX_UNDO_STEPS);
      this._undoStack = Object.freeze(valid);
    }

    /**
     * حفظ حالة المباراة الجارية في localStorage
     */
    saveMatch(matchState) {
      if (!matchState || typeof matchState !== "object") return false;
      if (!Array.isArray(matchState.boardCategories) || matchState.boardCategories.length === 0) {
        return false;
      }

      try {
        const cleanSettings = sanitizeMatchSettings(matchState.matchSettings);
        const cleanTeams = sanitizeTeamsList(matchState.teams, cleanSettings);
        const rawTurn = Number(matchState.activeTurn);
        const activeTurn =
          Number.isInteger(rawTurn) && rawTurn >= 0 && rawTurn < cleanTeams.length ? rawTurn : 0;

        const serializeSlot = (slot) => {
          const rawWinner = slot && slot.winnerTeam;
          const winnerTeam =
            Number.isInteger(rawWinner) && rawWinner >= 0 && rawWinner < cleanTeams.length
              ? rawWinner
              : null;
          return {
            points: Number(slot.points) || 200,
            question: slot.question ? deepClone(slot.question) : null,
            played: Boolean(slot.played),
            previouslyPlayed: Boolean(slot.previouslyPlayed),
            recycled: Boolean(slot.recycled),
            isDailyDouble: Boolean(slot.isDailyDouble),
            winnerTeam
          };
        };

        const serializedBoard = matchState.boardCategories.map((bc) => ({
          category: {
            id: bc.category.id,
            name: bc.category.name,
            icon: bc.category.icon || "🎯",
            color: bc.category.color || "",
            description: bc.category.description || "",
            ...(bc.category.group ? { group: bc.category.group } : {})
          },
          rightColumn: Array.isArray(bc.rightColumn) ? bc.rightColumn.map(serializeSlot) : [],
          leftColumn: Array.isArray(bc.leftColumn) ? bc.leftColumn.map(serializeSlot) : []
        }));

        const payload = {
          schemaVersion: SCHEMA_VERSION,
          savedAt: Date.now(),
          matchId:
            typeof matchState.matchId === "string" && matchState.matchId.trim()
              ? matchState.matchId.trim()
              : `classic_${Date.now().toString(36)}`,
          activeProfileId:
            typeof matchState.activeProfileId === "string" && matchState.activeProfileId
              ? matchState.activeProfileId
              : "default",
          selectedCategoryIds: Array.isArray(matchState.selectedCategoryIds)
            ? matchState.selectedCategoryIds.slice()
            : [],
          matchSettings: cleanSettings,
          teams: cleanTeams,
          activeTurn,
          doubleArmed: Boolean(matchState.doubleArmed),
          answeredThisRound: Math.max(0, Math.floor(Number(matchState.answeredThisRound) || 0)),
          matchEvents: sanitizeMatchEventsList(matchState.matchEvents),
          refereeAdjustments: sanitizeRefereeAdjustmentsList(matchState.refereeAdjustments),
          finalRound:
            matchState.finalRound && typeof matchState.finalRound === "object"
              ? deepClone(matchState.finalRound)
              : null,
          boardCategories: serializedBoard,
          openQuestion: matchState.openQuestion ? deepClone(matchState.openQuestion) : null,
          undoStack: deepClone(this._undoStack)
        };

        localStorage.setItem(MATCH_STORAGE_KEY, JSON.stringify(payload));
        return true;
      } catch (_err) {
        return false;
      }
    }

    /**
     * قراءة المباراة غير المكتملة المحفوظة (مع توافق رجعي آمن لأي حقول جديدة)
     */
    loadSavedMatch() {
      try {
        const raw = localStorage.getItem(MATCH_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          parsed.schemaVersion !== SCHEMA_VERSION ||
          !Array.isArray(parsed.boardCategories) ||
          parsed.boardCategories.length === 0 ||
          !Array.isArray(parsed.teams) ||
          parsed.teams.length < 2
        ) {
          return null;
        }

        let playableRemaining = 0;
        let totalSlots = 0;
        parsed.boardCategories.forEach((bc) => {
          const slots = [
            ...(Array.isArray(bc.rightColumn) ? bc.rightColumn : []),
            ...(Array.isArray(bc.leftColumn) ? bc.leftColumn : [])
          ];
          totalSlots += slots.length;
          slots.forEach((s) => {
            if (s && !s.played && s.question) {
              playableRemaining++;
            }
          });
        });

        // إذا كانت اللوحة مكتملة تماماً ولا يوجد سؤال مفتوح ولا جولة نهائية نشطة، فهي منتهية
        if (playableRemaining === 0 && !parsed.openQuestion && !parsed.finalRound) {
          this.clearSavedMatch();
          return null;
        }

        const matchSettings = sanitizeMatchSettings(parsed.matchSettings);
        const teams = sanitizeTeamsList(parsed.teams, matchSettings);
        const rawTurn = Number(parsed.activeTurn);
        const activeTurn =
          Number.isInteger(rawTurn) && rawTurn >= 0 && rawTurn < teams.length ? rawTurn : 0;

        return {
          schemaVersion: SCHEMA_VERSION,
          savedAt: Number(parsed.savedAt) || Date.now(),
          matchId:
            typeof parsed.matchId === "string" && parsed.matchId.trim()
              ? parsed.matchId.trim()
              : `classic_${Date.now().toString(36)}`,
          activeProfileId:
            typeof parsed.activeProfileId === "string" && parsed.activeProfileId
              ? parsed.activeProfileId
              : "default",
          selectedCategoryIds: Array.isArray(parsed.selectedCategoryIds)
            ? parsed.selectedCategoryIds.filter((id) => typeof id === "string")
            : [],
          matchSettings,
          teams,
          activeTurn,
          doubleArmed: Boolean(parsed.doubleArmed),
          answeredThisRound: Math.max(0, Math.floor(Number(parsed.answeredThisRound) || 0)),
          matchEvents: sanitizeMatchEventsList(parsed.matchEvents),
          refereeAdjustments: sanitizeRefereeAdjustmentsList(parsed.refereeAdjustments),
          finalRound:
            parsed.finalRound && typeof parsed.finalRound === "object"
              ? deepClone(parsed.finalRound)
              : null,
          boardCategories: parsed.boardCategories,
          openQuestion:
            parsed.openQuestion && typeof parsed.openQuestion === "object"
              ? parsed.openQuestion
              : null,
          undoStack: Array.isArray(parsed.undoStack) ? parsed.undoStack : [],
          playableRemaining,
          totalSlots
        };
      } catch (_err) {
        return null;
      }
    }

    clearSavedMatch() {
      try {
        localStorage.removeItem(MATCH_STORAGE_KEY);
      } catch (_err) {
        // تجاهل
      }
    }

    getDefaultIntermission() {
      return {
        active: false,
        message: DEFAULT_INTERMISSION_MESSAGE,
        durationMinutes: 0,
        totalSeconds: 0,
        remainingSeconds: 0
      };
    }

    sanitizeIntermission(raw) {
      const def = this.getDefaultIntermission();
      if (!raw || typeof raw !== "object") return def;
      const msg =
        typeof raw.message === "string" && raw.message.trim()
          ? raw.message.trim().slice(0, 120)
          : DEFAULT_INTERMISSION_MESSAGE;
      const totalSeconds = Math.max(0, Math.floor(Number(raw.totalSeconds) || 0));
      const remainingSeconds = Math.max(0, Math.min(totalSeconds || 3600, Math.floor(Number(raw.remainingSeconds) || 0)));
      return {
        active: Boolean(raw.active),
        message: msg,
        durationMinutes: Math.max(0, Math.floor(Number(raw.durationMinutes) || 0)),
        totalSeconds,
        remainingSeconds
      };
    }

    loadTheme() {
      try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        return VALID_THEMES.has(raw) ? raw : "dark-glass";
      } catch (_err) {
        return "dark-glass";
      }
    }

    saveTheme(theme) {
      const clean = VALID_THEMES.has(theme) ? theme : "dark-glass";
      try {
        localStorage.setItem(THEME_STORAGE_KEY, clean);
      } catch (_err) {}
      return clean;
    }

    loadTvScale() {
      try {
        const raw = Number(localStorage.getItem(TV_SCALE_STORAGE_KEY));
        if (Number.isFinite(raw) && raw >= 90 && raw <= 130) {
          return Math.round(raw / 5) * 5;
        }
        return 100;
      } catch (_err) {
        return 100;
      }
    }

    saveTvScale(scale) {
      const num = Number(scale);
      const clean =
        Number.isFinite(num) ? Math.min(130, Math.max(90, Math.round(num / 5) * 5)) : 100;
      try {
        localStorage.setItem(TV_SCALE_STORAGE_KEY, String(clean));
      } catch (_err) {}
      return clean;
    }
  }

  window.SeenJeemMatchStore = new MatchStore();
})();
