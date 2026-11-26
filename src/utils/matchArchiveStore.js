/**
 * قاعة المشاهير وأرشيف المباريات (Hall of Fame & Match Archive Store)
 * - يُحفظ في localStorage تحت المفتاح `seen-jeem-archive-v1`
 * - يحتفظ بآخر 50 مباراة مكتملة لكل ملف مجموعة (profileId) مع حذف الأقدم تلقائياً
 * - يمنع التكرار عبر matchId فريد، ويحسب الأرقام القياسية وجدول المتصدرين التراكمي
 */
(function () {
  "use strict";

  const STORAGE_KEY = "seen-jeem-archive-v1";
  const BARA_STATS_STORAGE_KEY = "bara-salfa-stats-v1";
  const MAX_PER_PROFILE = 50;
  const MAX_BARA_ROUNDS_PER_PROFILE = 200;
  const VALID_MODES = new Set(["classic", "blitz", "charades"]);
  const DEFAULT_TEAM_COLORS = ["#22d3ee", "#fbbf24", "#34d399", "#e879f9"];

  function normalizeTeamKey(name) {
    if (typeof name !== "string") return "";
    return name
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .toLowerCase();
  }

  function sanitizeTeamEntry(raw, idx) {
    if (!raw || typeof raw !== "object") return null;
    const name =
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 32)
        : `الفريق ${idx + 1}`;
    const scoreNum = Number(raw.score);
    const score = Number.isFinite(scoreNum) ? Math.max(0, Math.round(scoreNum)) : 0;
    const accNum = Number(raw.accuracy);
    const accuracy = Number.isFinite(accNum) ? Math.min(100, Math.max(0, Math.round(accNum))) : 0;
    const stealsNum = Number(raw.stealsCount);
    const stealsCount = Number.isFinite(stealsNum) ? Math.max(0, Math.floor(stealsNum)) : 0;
    const color =
      typeof raw.color === "string" && raw.color.trim()
        ? raw.color.trim()
        : DEFAULT_TEAM_COLORS[idx % DEFAULT_TEAM_COLORS.length];

    return { name, score, color, accuracy, stealsCount };
  }

  function sanitizeMatchRecord(raw) {
    if (!raw || typeof raw !== "object") return null;
    const matchId = typeof raw.matchId === "string" ? raw.matchId.trim() : "";
    if (!matchId) return null;

    const profileId =
      typeof raw.profileId === "string" && raw.profileId.trim() ? raw.profileId.trim() : "default";
    const mode = VALID_MODES.has(raw.mode) ? raw.mode : "classic";
    const playedAt =
      Number.isFinite(Number(raw.playedAt)) && Number(raw.playedAt) > 0
        ? Math.floor(Number(raw.playedAt))
        : Date.now();

    const teams = Array.isArray(raw.teams)
      ? raw.teams.map((t, i) => sanitizeTeamEntry(t, i)).filter(Boolean)
      : [];
    if (teams.length === 0) return null;

    let maxScore = -Infinity;
    teams.forEach((t) => {
      if (t.score > maxScore) maxScore = t.score;
    });
    const derivedWinners = teams.filter((t) => t.score === maxScore).map((t) => t.name);
    const winnerNames =
      Array.isArray(raw.winnerNames) && raw.winnerNames.length > 0
        ? raw.winnerNames.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim())
        : derivedWinners;
    const isDraw =
      raw.isDraw !== undefined ? Boolean(raw.isDraw) : winnerNames.length !== 1 && teams.length > 1;

    return {
      matchId,
      profileId,
      mode,
      playedAt,
      winnerNames,
      isDraw,
      teams,
      topCategory: typeof raw.topCategory === "string" ? raw.topCategory.trim() : "",
      highestSingleHit: Math.max(0, Math.round(Number(raw.highestSingleHit) || 0)),
      totalQuestions: Math.max(0, Math.floor(Number(raw.totalQuestions) || 0))
    };
  }

  class MatchArchiveStore {
    constructor() {
      /** @type {Array<Object>} */
      this._records = [];
      /** @type {Array<Object>} */
      this._baraRounds = [];
      this._load();
      this._loadBaraRounds();
    }

    _load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          this._records = [];
          return;
        }
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed)
          ? parsed
          : parsed && Array.isArray(parsed.records)
            ? parsed.records
            : [];
        const seen = new Set();
        this._records = [];
        list.forEach((item) => {
          const clean = sanitizeMatchRecord(item);
          if (clean && !seen.has(clean.matchId)) {
            seen.add(clean.matchId);
            this._records.push(clean);
          }
        });
        this._records.sort((a, b) => b.playedAt - a.playedAt);
      } catch (_err) {
        this._records = [];
      }
    }

    _save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._records));
      } catch (_err) {
        // تجاهل أخطاء الامتلاء
      }
    }

    _enforceProfileLimit(profileId) {
      const kept = [];
      let profileCount = 0;
      this._records.sort((a, b) => b.playedAt - a.playedAt);
      for (let i = 0; i < this._records.length; i++) {
        const rec = this._records[i];
        if (rec.profileId === profileId) {
          if (profileCount < MAX_PER_PROFILE) {
            kept.push(rec);
            profileCount++;
          }
        } else {
          kept.push(rec);
        }
      }
      this._records = kept;
    }

    generateMatchId(prefix = "match") {
      return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    hasMatch(matchId) {
      if (typeof matchId !== "string" || !matchId.trim()) return false;
      const id = matchId.trim();
      return this._records.some((r) => r.matchId === id);
    }

    /**
     * حفظ مباراة مكتملة بدون تكرار (باستخدام matchId الفريد)
     */
    recordCompletedMatch(rawRecord) {
      const clean = sanitizeMatchRecord(rawRecord);
      if (!clean) return { ok: false, duplicate: false };

      if (this.hasMatch(clean.matchId)) {
        return { ok: true, duplicate: true, record: this.getById(clean.matchId) };
      }

      this._records.unshift(clean);
      this._enforceProfileLimit(clean.profileId);
      this._save();
      return { ok: true, duplicate: false, record: { ...clean } };
    }

    getAll() {
      return this._records.map((r) => ({ ...r, teams: r.teams.map((t) => ({ ...t })) }));
    }

    getById(matchId) {
      const found = this._records.find((r) => r.matchId === matchId);
      return found ? { ...found, teams: found.teams.map((t) => ({ ...t })) } : null;
    }

    getForProfile(profileId, modeFilter = "all") {
      const pid = profileId || "default";
      return this._records
        .filter((r) => r.profileId === pid && (modeFilter === "all" || r.mode === modeFilter))
        .map((r) => ({ ...r, teams: r.teams.map((t) => ({ ...t })) }));
    }

    deleteMatch(matchId) {
      const prev = this._records.length;
      this._records = this._records.filter((r) => r.matchId !== matchId);
      if (this._records.length !== prev) {
        this._save();
        return true;
      }
      return false;
    }

    clearProfileArchive(profileId) {
      const pid = profileId || "default";
      const prev = this._records.length;
      this._records = this._records.filter((r) => r.profileId !== pid);
      const removed = prev - this._records.length;
      if (removed > 0) this._save();
      return removed;
    }

    importRecords(rawList, mode = "merge") {
      const incoming = (Array.isArray(rawList) ? rawList : [])
        .map(sanitizeMatchRecord)
        .filter(Boolean);

      if (mode === "replace") {
        const seen = new Set();
        this._records = [];
        incoming.forEach((r) => {
          if (!seen.has(r.matchId)) {
            seen.add(r.matchId);
            this._records.push(r);
          }
        });
      } else {
        const byId = new Map(this._records.map((r) => [r.matchId, r]));
        incoming.forEach((r) => {
          if (!byId.has(r.matchId)) {
            byId.set(r.matchId, r);
          }
        });
        this._records = Array.from(byId.values());
      }

      const profileIds = new Set(this._records.map((r) => r.profileId));
      profileIds.forEach((pid) => this._enforceProfileLimit(pid));
      this._save();
      return this._records.length;
    }

    /**
     * حساب الأرقام القياسية وجدول المتصدرين التراكمي للملف النشط
     */
    computeHallOfFame(profileId) {
      const matches = this.getForProfile(profileId, "all");
      if (matches.length === 0) {
        return {
          totalMatches: 0,
          records: {
            highestScore: null,
            highestSingleHit: null,
            mostWinsTeam: null,
            longestWinStreak: null
          },
          leaderboard: []
        };
      }

      let highestScore = null;
      let highestSingleHit = null;

      /** @type {Map<string, Object>} */
      const teamAgg = new Map();

      // الترتيب الزمني التصاعدي لحساب سلسلة الانتصارات المتتالية (Win Streak) بدقة
      const chronological = matches.slice().sort((a, b) => a.playedAt - b.playedAt);
      /** @type {Map<string, number>} */
      const curStreakByKey = new Map();
      /** @type {Map<string, { name: string, streak: number }>} */
      const bestStreakByKey = new Map();

      chronological.forEach((m) => {
        if (m.mode === "classic" && m.highestSingleHit > 0) {
          if (!highestSingleHit || m.highestSingleHit > highestSingleHit.points) {
            highestSingleHit = {
              points: m.highestSingleHit,
              playedAt: m.playedAt,
              category: m.topCategory || ""
            };
          }
        }

        const winnerKeys = new Set(
          !m.isDraw && Array.isArray(m.winnerNames) ? m.winnerNames.map(normalizeTeamKey) : []
        );

        m.teams.forEach((t) => {
          if (!highestScore || t.score > highestScore.score) {
            highestScore = {
              teamName: t.name,
              score: t.score,
              playedAt: m.playedAt,
              mode: m.mode
            };
          }

          const key = normalizeTeamKey(t.name);
          if (!key) return;
          if (!teamAgg.has(key)) {
            teamAgg.set(key, {
              key,
              displayName: t.name,
              color: t.color,
              matches: 0,
              wins: 0,
              draws: 0,
              totalScore: 0
            });
          }
          const rec = teamAgg.get(key);
          rec.displayName = t.name;
          rec.matches++;
          rec.totalScore += t.score;

          if (m.isDraw && m.teams.length > 1) {
            rec.draws++;
            curStreakByKey.set(key, 0);
          } else if (winnerKeys.has(key)) {
            rec.wins++;
            const nextSt = (curStreakByKey.get(key) || 0) + 1;
            curStreakByKey.set(key, nextSt);
            const prevBest = bestStreakByKey.get(key);
            if (!prevBest || nextSt > prevBest.streak) {
              bestStreakByKey.set(key, { name: t.name, streak: nextSt });
            }
          } else {
            curStreakByKey.set(key, 0);
          }
        });
      });

      const leaderboard = Array.from(teamAgg.values())
        .map((item) => ({
          ...item,
          winRate: item.matches > 0 ? Math.round((item.wins / item.matches) * 100) : 0,
          avgScore: item.matches > 0 ? Math.round(item.totalScore / item.matches) : 0,
          bestStreak: (bestStreakByKey.get(item.key) && bestStreakByKey.get(item.key).streak) || 0
        }))
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.winRate !== a.winRate) return b.winRate - a.winRate;
          return b.avgScore - a.avgScore;
        });

      const mostWinsTeam =
        leaderboard.length > 0 && leaderboard[0].wins > 0
          ? { name: leaderboard[0].displayName, wins: leaderboard[0].wins, winRate: leaderboard[0].winRate }
          : null;

      let longestWinStreak = null;
      bestStreakByKey.forEach((val) => {
        if (val.streak > 0 && (!longestWinStreak || val.streak > longestWinStreak.streak)) {
          longestWinStreak = { name: val.name, streak: val.streak };
        }
      });

      return {
        totalMatches: matches.length,
        records: {
          highestScore,
          highestSingleHit,
          mostWinsTeam,
          longestWinStreak
        },
        leaderboard
      };
    }

    /* =========================================================
       إحصائيات «برا السالفة» لقاعة المشاهير (bara-salfa-stats-v1)
       ========================================================= */
    _sanitizeBaraRound(raw) {
      if (!raw || typeof raw !== "object") return null;
      const roundId = typeof raw.roundId === "string" ? raw.roundId.trim() : "";
      if (!roundId) return null;
      const profileId =
        typeof raw.profileId === "string" && raw.profileId.trim() ? raw.profileId.trim() : "default";
      const players = Array.isArray(raw.players)
        ? raw.players
            .filter((p) => p && typeof p.name === "string" && p.name.trim())
            .map((p) => ({
              name: p.name.trim().slice(0, 28),
              isOutsider: Boolean(p.isOutsider),
              points: Math.max(0, Math.round(Number(p.points) || 0)),
              correctVote: Boolean(p.correctVote),
              correctGuess: Boolean(p.correctGuess)
            }))
        : [];
      if (players.length === 0) return null;
      return {
        roundId,
        profileId,
        playedAt:
          Number.isFinite(Number(raw.playedAt)) && Number(raw.playedAt) > 0
            ? Math.floor(Number(raw.playedAt))
            : Date.now(),
        categoryName: typeof raw.categoryName === "string" ? raw.categoryName.trim().slice(0, 48) : "",
        players
      };
    }

    _loadBaraRounds() {
      try {
        const raw = localStorage.getItem(BARA_STATS_STORAGE_KEY);
        if (!raw) {
          this._baraRounds = [];
          return;
        }
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed) ? parsed : [];
        const seen = new Set();
        this._baraRounds = [];
        arr.forEach((item) => {
          const clean = this._sanitizeBaraRound(item);
          if (clean && !seen.has(clean.roundId)) {
            seen.add(clean.roundId);
            this._baraRounds.push(clean);
          }
        });
        this._baraRounds.sort((a, b) => b.playedAt - a.playedAt);
      } catch (_err) {
        this._baraRounds = [];
      }
    }

    _saveBaraRounds() {
      try {
        localStorage.setItem(BARA_STATS_STORAGE_KEY, JSON.stringify(this._baraRounds));
      } catch (_err) {}
    }

    recordBaraSalfaRound(rawRound) {
      const clean = this._sanitizeBaraRound(rawRound);
      if (!clean) return { ok: false, duplicate: false };
      if (this._baraRounds.some((r) => r.roundId === clean.roundId)) {
        return { ok: true, duplicate: true };
      }
      this._baraRounds.unshift(clean);
      // حد أقصى 200 جولة لكل ملف
      let countForProfile = 0;
      this._baraRounds = this._baraRounds.filter((r) => {
        if (r.profileId !== clean.profileId) return true;
        countForProfile++;
        return countForProfile <= MAX_BARA_ROUNDS_PER_PROFILE;
      });
      this._saveBaraRounds();
      return { ok: true, duplicate: false };
    }

    getAllBaraSalfaRounds() {
      return this._baraRounds.slice();
    }

    importBaraSalfaRounds(rawList, mode = "merge") {
      const incoming = (Array.isArray(rawList) ? rawList : [])
        .map((r) => this._sanitizeBaraRound(r))
        .filter(Boolean);
      if (mode === "replace") {
        const seen = new Set();
        this._baraRounds = [];
        incoming.forEach((r) => {
          if (!seen.has(r.roundId)) {
            seen.add(r.roundId);
            this._baraRounds.push(r);
          }
        });
      } else {
        const byId = new Map(this._baraRounds.map((r) => [r.roundId, r]));
        incoming.forEach((r) => {
          if (!byId.has(r.roundId)) byId.set(r.roundId, r);
        });
        this._baraRounds = Array.from(byId.values());
      }
      this._baraRounds.sort((a, b) => b.playedAt - a.playedAt);
      this._saveBaraRounds();
      return this._baraRounds.length;
    }

    clearBaraSalfaProfileStats(profileId) {
      const pid = profileId || "default";
      const prev = this._baraRounds.length;
      this._baraRounds = this._baraRounds.filter((r) => r.profileId !== pid);
      if (this._baraRounds.length !== prev) this._saveBaraRounds();
      return prev - this._baraRounds.length;
    }

    computeBaraSalfaHallOfFame(profileId) {
      const pid = profileId || "default";
      const rounds = this._baraRounds.filter((r) => r.profileId === pid);
      if (rounds.length === 0) {
        return {
          totalRounds: 0,
          records: { topDetective: null, topInfiltrator: null, topScorer: null },
          leaderboard: []
        };
      }

      const agg = new Map();
      rounds.forEach((rd) => {
        rd.players.forEach((p) => {
          const key = normalizeTeamKey(p.name);
          if (!key) return;
          if (!agg.has(key)) {
            agg.set(key, {
              key,
              displayName: p.name,
              rounds: 0,
              totalScore: 0,
              insiderRounds: 0,
              correctVotes: 0,
              outsiderRounds: 0,
              correctGuesses: 0
            });
          }
          const rec = agg.get(key);
          rec.displayName = p.name;
          rec.rounds += 1;
          rec.totalScore += p.points;
          if (p.isOutsider) {
            rec.outsiderRounds += 1;
            if (p.correctGuess) rec.correctGuesses += 1;
          } else {
            rec.insiderRounds += 1;
            if (p.correctVote) rec.correctVotes += 1;
          }
        });
      });

      const leaderboard = Array.from(agg.values())
        .map((item) => ({
          ...item,
          detectionRate: item.insiderRounds > 0 ? Math.round((item.correctVotes / item.insiderRounds) * 100) : 0,
          guessRate: item.outsiderRounds > 0 ? Math.round((item.correctGuesses / item.outsiderRounds) * 100) : 0
        }))
        .sort((a, b) => {
          if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
          if (b.correctVotes !== a.correctVotes) return b.correctVotes - a.correctVotes;
          return b.rounds - a.rounds;
        });

      let topDetective = null;
      let topInfiltrator = null;
      leaderboard.forEach((p) => {
        if (
          p.correctVotes > 0 &&
          (!topDetective ||
            p.correctVotes > topDetective.correctVotes ||
            (p.correctVotes === topDetective.correctVotes && p.detectionRate > topDetective.detectionRate))
        ) {
          topDetective = { name: p.displayName, correctVotes: p.correctVotes, rate: p.detectionRate };
        }
        if (
          p.correctGuesses > 0 &&
          (!topInfiltrator ||
            p.guessRate > topInfiltrator.rate ||
            (p.guessRate === topInfiltrator.rate && p.correctGuesses > topInfiltrator.correctGuesses))
        ) {
          topInfiltrator = { name: p.displayName, correctGuesses: p.correctGuesses, rate: p.guessRate };
        }
      });

      const topScorer =
        leaderboard.length > 0 && leaderboard[0].totalScore > 0
          ? { name: leaderboard[0].displayName, score: leaderboard[0].totalScore, rounds: leaderboard[0].rounds }
          : null;

      return {
        totalRounds: rounds.length,
        records: { topDetective, topInfiltrator, topScorer },
        leaderboard
      };
    }
  }

  window.SeenJeemArchiveStore = new MatchArchiveStore();
})();
