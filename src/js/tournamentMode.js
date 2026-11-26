/**
 * نظام البطولات المتكامل للعبة «سين جيم» (Tournament Mode — Pack 11)
 * - خروج المغلوب (Knockout Bracket) لـ 4 أو 8 فرق (ربع نهائي ← نصف نهائي ← نهائي)
 * - دوري النقاط (Round-Robin League) لـ 4 إلى 8 فرق مع جدول ترتيب شامل
 * - أنماط المباريات: لوحة كلاسيكية (6 فئات)، لوحة سريعة (4 فئات)، أو جولة البرق (Blitz)
 * - حفظ تلقائي في localStorage (seen-jeem-tournament-v1) + مزامنة شاشة التلفزيون + تتويج وبطاقة نتيجة
 */
(function () {
  "use strict";

  const STORAGE_KEY = "seen-jeem-tournament-v1";
  const TEAM_PALETTE = [
    "#22d3ee",
    "#fbbf24",
    "#34d399",
    "#e879f9",
    "#f87171",
    "#60a5fa",
    "#fb923c",
    "#a78bfa"
  ];
  const DEFAULT_NAMES = [
    "فريق الصقور",
    "فريق النجوم",
    "فريق الزمرد",
    "فريق الملوك",
    "فريق العاصفة",
    "فريق الفرسان",
    "فريق الأبطال",
    "فريق التحدي"
  ];

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    return copy;
  }

  function buildKnockoutMatches(teams) {
    const count = teams.length === 8 ? 8 : 4;
    const matches = [];
    if (count === 4) {
      // نصف نهائي (2) + نهائي (1)
      matches.push(
        { id: "sf_1", round: 1, roundLabel: "نصف النهائي", slotLabel: "نصف النهائي 1", teamAId: teams[0].id, teamBId: teams[1].id, scoreA: null, scoreB: null, winnerId: null, status: "ready", nextMatchId: "final_1", nextSlot: "A" },
        { id: "sf_2", round: 1, roundLabel: "نصف النهائي", slotLabel: "نصف النهائي 2", teamAId: teams[2].id, teamBId: teams[3].id, scoreA: null, scoreB: null, winnerId: null, status: "ready", nextMatchId: "final_1", nextSlot: "B" },
        { id: "final_1", round: 2, roundLabel: "النهائي 🏆", slotLabel: "المباراة النهائية", teamAId: null, teamBId: null, scoreA: null, scoreB: null, winnerId: null, status: "pending", nextMatchId: null, nextSlot: null }
      );
    } else {
      // ربع نهائي (4) + نصف نهائي (2) + نهائي (1)
      for (let i = 0; i < 4; i++) {
        matches.push({
          id: `qf_${i + 1}`,
          round: 1,
          roundLabel: "ربع النهائي",
          slotLabel: `ربع النهائي ${i + 1}`,
          teamAId: teams[i * 2].id,
          teamBId: teams[i * 2 + 1].id,
          scoreA: null,
          scoreB: null,
          winnerId: null,
          status: "ready",
          nextMatchId: `sf_${Math.floor(i / 2) + 1}`,
          nextSlot: i % 2 === 0 ? "A" : "B"
        });
      }
      matches.push(
        { id: "sf_1", round: 2, roundLabel: "نصف النهائي", slotLabel: "نصف النهائي 1", teamAId: null, teamBId: null, scoreA: null, scoreB: null, winnerId: null, status: "pending", nextMatchId: "final_1", nextSlot: "A" },
        { id: "sf_2", round: 2, roundLabel: "نصف النهائي", slotLabel: "نصف النهائي 2", teamAId: null, teamBId: null, scoreA: null, scoreB: null, winnerId: null, status: "pending", nextMatchId: "final_1", nextSlot: "B" },
        { id: "final_1", round: 3, roundLabel: "النهائي 🏆", slotLabel: "المباراة النهائية", teamAId: null, teamBId: null, scoreA: null, scoreB: null, winnerId: null, status: "pending", nextMatchId: null, nextSlot: null }
      );
    }
    return matches;
  }

  function buildLeagueMatches(teams) {
    const matches = [];
    let idx = 1;
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        matches.push({
          id: `lg_${idx}`,
          round: 1,
          roundLabel: "مباريات الدوري",
          slotLabel: `المواجهة #${idx}`,
          teamAId: teams[i].id,
          teamBId: teams[j].id,
          scoreA: null,
          scoreB: null,
          winnerId: null,
          isDraw: false,
          status: "ready"
        });
        idx++;
      }
    }
    return matches;
  }

  class TournamentController {
    constructor() {
      this.modalEl = null;
      this.bodyEl = null;
      this.isOpenFlag = false;
      this.tournament = this._load();

      // مسودة الإعداد عند إنشاء بطولة جديدة
      this.draft = {
        name: "بطولة سين جيم الكبرى",
        type: "knockout", // "knockout" | "league"
        teamCount: 4,
        matchFormat: "classic-6", // "classic-6" | "classic-4" | "blitz"
        teams: DEFAULT_NAMES.slice(0, 8).map((name, i) => ({
          id: `tm_${i + 1}`,
          name,
          color: TEAM_PALETTE[i % TEAM_PALETTE.length]
        }))
      };
    }

    init() {
      this.modalEl = document.getElementById("tournament-modal");
      this.bodyEl = document.getElementById("tournament-body");
      document.getElementById("btn-close-tournament")?.addEventListener("click", () => this.close());
      document.getElementById("btn-tournament-open-tv")?.addEventListener("click", () => {
        if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openTVDisplayWindow === "function") {
          window.SeenJeemHostBridge.openTVDisplayWindow();
          setTimeout(() => this._syncTV(), 200);
        }
      });
    }

    _load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.teams) || !Array.isArray(parsed.matches)) {
          return null;
        }
        return parsed;
      } catch (_err) {
        return null;
      }
    }

    _save() {
      try {
        if (this.tournament) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tournament));
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (_err) {}
    }

    isOpen() {
      return this.isOpenFlag;
    }

    hasActiveTournament() {
      return Boolean(this.tournament);
    }

    open() {
      if (!this.modalEl) this.init();
      if (!this.modalEl) return;
      this.tournament = this._load();
      this.isOpenFlag = true;
      this.modalEl.classList.add("open");
      this.modalEl.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      this._render();
      this._syncTV();
    }

    close() {
      this.isOpenFlag = false;
      if (this.modalEl) {
        this.modalEl.classList.remove("open");
        this.modalEl.setAttribute("aria-hidden", "true");
      }
      const anyOpen = document.querySelector(".modal-overlay.open");
      if (!anyOpen) document.body.style.overflow = "";
      this._syncTV();
    }

    _syncTV() {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.broadcastTV === "function") {
        window.SeenJeemHostBridge.broadcastTV();
      }
    }

    _toast(msg, kind = "info") {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.showToast === "function") {
        window.SeenJeemHostBridge.showToast(msg, kind);
      }
    }

    _findTeam(teamId) {
      if (!this.tournament || !teamId) return null;
      return this.tournament.teams.find((t) => t.id === teamId) || null;
    }

    computeLeagueStandings() {
      if (!this.tournament) return [];
      const table = new Map();
      this.tournament.teams.forEach((t) => {
        table.set(t.id, {
          id: t.id,
          name: t.name,
          color: t.color,
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          diff: 0,
          leaguePoints: 0
        });
      });

      this.tournament.matches.forEach((m) => {
        if (m.status !== "completed") return;
        const a = table.get(m.teamAId);
        const b = table.get(m.teamBId);
        if (!a || !b) return;
        const sA = Math.max(0, Number(m.scoreA) || 0);
        const sB = Math.max(0, Number(m.scoreB) || 0);
        a.played++;
        b.played++;
        a.pointsFor += sA;
        a.pointsAgainst += sB;
        b.pointsFor += sB;
        b.pointsAgainst += sA;
        if (sA > sB) {
          a.wins++;
          b.losses++;
          a.leaguePoints += 3;
        } else if (sB > sA) {
          b.wins++;
          a.losses++;
          b.leaguePoints += 3;
        } else {
          a.draws++;
          b.draws++;
          a.leaguePoints += 1;
          b.leaguePoints += 1;
        }
      });

      return Array.from(table.values())
        .map((r) => ({ ...r, diff: r.pointsFor - r.pointsAgainst }))
        .sort((a, b) => {
          if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
          if (b.diff !== a.diff) return b.diff - a.diff;
          return b.pointsFor - a.pointsFor;
        });
    }

    createTournament({ randomize = false } = {}) {
      const count =
        this.draft.type === "knockout"
          ? this.draft.teamCount === 8
            ? 8
            : 4
          : Math.min(8, Math.max(4, Number(this.draft.teamCount) || 4));

      let selectedTeams = this.draft.teams.slice(0, count).map((t, idx) => ({
        id: `tm_${idx + 1}`,
        name: (t.name || "").trim().slice(0, 24) || DEFAULT_NAMES[idx],
        color: t.color || TEAM_PALETTE[idx % TEAM_PALETTE.length]
      }));

      if (randomize) {
        selectedTeams = shuffle(selectedTeams);
      }

      const matches =
        this.draft.type === "knockout"
          ? buildKnockoutMatches(selectedTeams)
          : buildLeagueMatches(selectedTeams);

      this.tournament = {
        id: `trn_${Date.now().toString(36)}`,
        name: (this.draft.name || "").trim().slice(0, 48) || "بطولة سين جيم الكبرى",
        type: this.draft.type,
        matchFormat: this.draft.matchFormat,
        createdAt: Date.now(),
        status: "active", // "active" | "completed"
        championId: null,
        teams: selectedTeams,
        matches
      };

      this._save();
      this._render();
      this._syncTV();
      this._toast(`🏆 تم إنشاء «${this.tournament.name}» بنجاح!`, "success");
    }

    startMatch(matchId) {
      if (!this.tournament) return;
      const m = this.tournament.matches.find((x) => x.id === matchId);
      if (!m || !m.teamAId || !m.teamBId) return;
      const teamA = this._findTeam(m.teamAId);
      const teamB = this._findTeam(m.teamBId);
      if (!teamA || !teamB) return;

      this.close();
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.launchTournamentMatch === "function") {
        window.SeenJeemHostBridge.launchTournamentMatch({
          tournamentId: this.tournament.id,
          tournamentName: this.tournament.name,
          matchId: m.id,
          slotLabel: m.slotLabel,
          format: this.tournament.matchFormat,
          teamA,
          teamB
        });
      }
    }

    /**
     * تسجيل نتيجة مباراة مكتملة تلقائياً عند انتهاء مباراة «سين جيم» أو «البرق»
     */
    recordMatchResult(matchId, { scoreA, scoreB }) {
      this.tournament = this._load() || this.tournament;
      if (!this.tournament || !matchId) return { ok: false };
      const m = this.tournament.matches.find((x) => x.id === matchId);
      if (!m) return { ok: false };

      const sA = Math.max(0, Math.round(Number(scoreA) || 0));
      const sB = Math.max(0, Math.round(Number(scoreB) || 0));
      m.scoreA = sA;
      m.scoreB = sB;

      if (this.tournament.type === "knockout") {
        if (sA === sB) {
          m.status = "tie-pending";
          m.winnerId = null;
          this._save();
          if (this.isOpenFlag) this._render();
          this._syncTV();
          return { ok: true, tied: true };
        }
        const winnerId = sA > sB ? m.teamAId : m.teamBId;
        this._advanceKnockoutWinner(m, winnerId);
      } else {
        m.status = "completed";
        m.isDraw = sA === sB;
        m.winnerId = sA > sB ? m.teamAId : sB > sA ? m.teamBId : null;
        const allDone = this.tournament.matches.every((x) => x.status === "completed");
        if (allDone) {
          const standings = this.computeLeagueStandings();
          this.tournament.status = "completed";
          this.tournament.championId = standings[0] ? standings[0].id : null;
          this._celebrateChampion();
        }
      }

      this._save();
      if (this.isOpenFlag) this._render();
      this._syncTV();
      return { ok: true, completed: this.tournament.status === "completed" };
    }

    resolveKnockoutTie(matchId, winnerId) {
      if (!this.tournament) return;
      const m = this.tournament.matches.find((x) => x.id === matchId);
      if (!m || (winnerId !== m.teamAId && winnerId !== m.teamBId)) return;
      this._advanceKnockoutWinner(m, winnerId);
      this._save();
      this._render();
      this._syncTV();
      const winner = this._findTeam(winnerId);
      this._toast(`🏆 تم اعتماد فوز «${winner ? winner.name : ""}» وصعوده للدور التالي!`, "success");
    }

    _advanceKnockoutWinner(match, winnerId) {
      match.status = "completed";
      match.winnerId = winnerId;

      if (match.nextMatchId) {
        const nextMatch = this.tournament.matches.find((x) => x.id === match.nextMatchId);
        if (nextMatch) {
          if (match.nextSlot === "A") nextMatch.teamAId = winnerId;
          else nextMatch.teamBId = winnerId;
          if (nextMatch.teamAId && nextMatch.teamBId && nextMatch.status === "pending") {
            nextMatch.status = "ready";
          }
        }
      } else {
        // المباراة النهائية
        this.tournament.status = "completed";
        this.tournament.championId = winnerId;
        this._celebrateChampion();
      }
    }

    _celebrateChampion() {
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio.playVictory === "function") {
        window.SeenJeemAudio.playVictory();
      }
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.triggerConfetti === "function") {
        window.SeenJeemHostBridge.triggerConfetti("victory", "default");
      }
    }

    openTournamentResultCard() {
      if (!this.tournament) return;
      const standings =
        this.tournament.type === "league"
          ? this.computeLeagueStandings().map((s) => ({
              name: s.name,
              points: s.leaguePoints,
              wins: s.wins
            }))
          : (() => {
              const champ = this._findTeam(this.tournament.championId);
              const finalM = this.tournament.matches.find((m) => !m.nextMatchId);
              const runnerId =
                finalM && finalM.winnerId
                  ? finalM.winnerId === finalM.teamAId
                    ? finalM.teamBId
                    : finalM.teamAId
                  : null;
              const runner = this._findTeam(runnerId);
              const list = [];
              if (champ) list.push({ name: champ.name, points: 1000, wins: 3 });
              if (runner) list.push({ name: runner.name, points: 500, wins: 2 });
              this.tournament.teams.forEach((t) => {
                if (t.id !== (champ && champ.id) && t.id !== (runner && runner.id)) {
                  list.push({ name: t.name, points: 200, wins: 0 });
                }
              });
              return list;
            })();

      const completedMatches = this.tournament.matches.filter((m) => m.status === "completed").length;
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openTournamentResultCard === "function") {
        window.SeenJeemHostBridge.openTournamentResultCard({
          name: this.tournament.name,
          standings,
          completedMatches,
          timestamp: Date.now()
        });
      }
    }

    resetTournament() {
      this.tournament = null;
      this._save();
      this._render();
      this._syncTV();
      this._toast("🗑️ تم إنهاء البطولة السابقة — يمكنك إعداد بطولة جديدة", "info");
    }

    buildSanitizedDisplayPayload() {
      if (!this.tournament) {
        return { active: false, name: this.draft.name, type: this.draft.type };
      }
      const t = this.tournament;
      const teamById = {};
      t.teams.forEach((tm) => {
        teamById[tm.id] = { id: tm.id, name: tm.name, color: tm.color };
      });
      return {
        active: true,
        id: t.id,
        name: t.name,
        type: t.type,
        matchFormat: t.matchFormat,
        status: t.status,
        champion: t.championId ? teamById[t.championId] || null : null,
        teams: t.teams.map((tm) => ({ id: tm.id, name: tm.name, color: tm.color })),
        matches: t.matches.map((m) => ({
          id: m.id,
          round: m.round,
          roundLabel: m.roundLabel,
          slotLabel: m.slotLabel,
          teamA: m.teamAId ? teamById[m.teamAId] || null : null,
          teamB: m.teamBId ? teamById[m.teamBId] || null : null,
          scoreA: m.scoreA,
          scoreB: m.scoreB,
          winnerId: m.winnerId,
          status: m.status
        })),
        standings: t.type === "league" ? this.computeLeagueStandings() : []
      };
    }

    /* =========================================================
       رسم واجهة الإعداد وواجهة الشجرة / الدوري
       ========================================================= */
    _render() {
      if (!this.bodyEl) return;
      if (!this.tournament) {
        this.bodyEl.innerHTML = this._renderSetupHtml();
        this._bindSetupEvents();
      } else {
        this.bodyEl.innerHTML = this._renderActiveTournamentHtml();
        this._bindActiveEvents();
      }
    }

    _renderSetupHtml() {
      const d = this.draft;
      const teamCounts = d.type === "knockout" ? [4, 8] : [4, 5, 6, 7, 8];
      if (!teamCounts.includes(d.teamCount)) d.teamCount = 4;

      return `
        <div class="trn-setup-wrap">
          <div class="bs-section">
            <label for="trn-name-input" class="input-label">🏆 اسم البطولة:</label>
            <input type="text" id="trn-name-input" class="text-input" maxlength="48" value="${escapeHtml(d.name)}" placeholder="بطولة العائلة / بطولة الأصدقاء..." />
          </div>

          <div class="bs-section bs-options-grid">
            <div class="bs-opt-block">
              <span class="bs-opt-label">🏅 نظام البطولة:</span>
              <div class="bs-pills-row">
                <button type="button" class="tactical-opt-btn${d.type === "knockout" ? " active" : ""}" data-trn-type="knockout">🏆 خروج المغلوب (Bracket)</button>
                <button type="button" class="tactical-opt-btn${d.type === "league" ? " active" : ""}" data-trn-type="league">📊 دوري النقاط (الكل ضد الكل)</button>
              </div>
            </div>

            <div class="bs-opt-block">
              <span class="bs-opt-label">👥 عدد الفرق المشاركة:</span>
              <div class="bs-pills-row">
                ${teamCounts
                  .map(
                    (c) =>
                      `<button type="button" class="tactical-opt-btn${d.teamCount === c ? " active" : ""}" data-trn-count="${c}">${c} فرق</button>`
                  )
                  .join("")}
              </div>
            </div>

            <div class="bs-opt-block">
              <span class="bs-opt-label">🎯 نمط مباريات البطولة:</span>
              <div class="bs-pills-row">
                <button type="button" class="tactical-opt-btn${d.matchFormat === "classic-6" ? " active" : ""}" data-trn-fmt="classic-6">كلاسيكي كامل (6 فئات)</button>
                <button type="button" class="tactical-opt-btn${d.matchFormat === "classic-4" ? " active" : ""}" data-trn-fmt="classic-4">سريع (4 فئات)</button>
                <button type="button" class="tactical-opt-btn${d.matchFormat === "blitz" ? " active" : ""}" data-trn-fmt="blitz">⚡ جولة البرق (Blitz)</button>
              </div>
            </div>
          </div>

          <div class="bs-section">
            <div class="bs-sec-head">
              <h3>🎨 الفرق المشاركة (${d.teamCount} فرق)</h3>
              <button type="button" id="trn-btn-shuffle-draft" class="btn btn-gold-outline btn-xxs">🎲 خلط الترتيب</button>
            </div>
            <div class="trn-teams-grid">
              ${d.teams
                .slice(0, d.teamCount)
                .map(
                  (tm, idx) => `
                <div class="trn-team-input-row">
                  <input type="color" class="trn-color-picker" data-trn-color="${idx}" value="${escapeHtml(tm.color)}" aria-label="لون الفريق ${idx + 1}" />
                  <input type="text" class="text-input" data-trn-team-name="${idx}" maxlength="24" value="${escapeHtml(tm.name)}" placeholder="اسم الفريق ${idx + 1}" />
                </div>
              `
                )
                .join("")}
            </div>
          </div>

          <div class="bs-stage-actions">
            <button type="button" id="trn-btn-create-ordered" class="btn btn-primary btn-lg">🏆 إطلاق البطولة بالترتيب الحالي</button>
            <button type="button" id="trn-btn-create-random" class="btn btn-amber btn-lg">🎲 إطلاق بقرعة عشوائية</button>
          </div>
        </div>
      `;
    }

    _bindSetupEvents() {
      const nameInp = document.getElementById("trn-name-input");
      if (nameInp) nameInp.addEventListener("input", () => (this.draft.name = nameInp.value));

      this.bodyEl.querySelectorAll("[data-trn-type]").forEach((b) => {
        b.addEventListener("click", () => {
          this.draft.type = b.dataset.trnType === "league" ? "league" : "knockout";
          if (this.draft.type === "knockout" && this.draft.teamCount !== 4 && this.draft.teamCount !== 8) {
            this.draft.teamCount = 4;
          }
          this._render();
        });
      });

      this.bodyEl.querySelectorAll("[data-trn-count]").forEach((b) => {
        b.addEventListener("click", () => {
          this.draft.teamCount = Number(b.dataset.trnCount) || 4;
          this._render();
        });
      });

      this.bodyEl.querySelectorAll("[data-trn-fmt]").forEach((b) => {
        b.addEventListener("click", () => {
          this.draft.matchFormat = b.dataset.trnFmt || "classic-6";
          this._render();
        });
      });

      this.bodyEl.querySelectorAll("[data-trn-team-name]").forEach((inp) => {
        inp.addEventListener("input", () => {
          const i = Number(inp.dataset.trnTeamName);
          if (this.draft.teams[i]) this.draft.teams[i].name = inp.value;
        });
      });

      this.bodyEl.querySelectorAll("[data-trn-color]").forEach((inp) => {
        inp.addEventListener("input", () => {
          const i = Number(inp.dataset.trnColor);
          if (this.draft.teams[i]) this.draft.teams[i].color = inp.value;
        });
      });

      document.getElementById("trn-btn-shuffle-draft")?.addEventListener("click", () => {
        const active = shuffle(this.draft.teams.slice(0, this.draft.teamCount));
        for (let i = 0; i < active.length; i++) this.draft.teams[i] = active[i];
        this._render();
      });

      document.getElementById("trn-btn-create-ordered")?.addEventListener("click", () => this.createTournament({ randomize: false }));
      document.getElementById("trn-btn-create-random")?.addEventListener("click", () => this.createTournament({ randomize: true }));
    }

    _renderMatchCardHtml(m) {
      const a = this._findTeam(m.teamAId);
      const b = this._findTeam(m.teamBId);
      const isDone = m.status === "completed";
      const isTie = m.status === "tie-pending";
      const isReady = m.status === "ready" && a && b;

      return `
        <article class="trn-match-card is-${escapeHtml(m.status)}">
          <div class="trn-match-head">
            <span>${escapeHtml(m.slotLabel)}</span>
            <span class="trn-match-badge">${isDone ? "✅ مكتملة" : isTie ? "⚔️ تعادل" : isReady ? "🟢 جاهزة" : "⏳ بانتظار المتأهلين"}</span>
          </div>
          <div class="trn-match-team${isDone && m.winnerId === m.teamAId ? " is-winner" : ""}">
            <span class="trn-dot" style="background:${escapeHtml(a ? a.color : "#475569")}"></span>
            <strong class="trn-team-lbl">${escapeHtml(a ? a.name : "— بانتظار المتأهل —")}</strong>
            <span class="trn-score-val">${m.scoreA !== null ? m.scoreA : "—"}</span>
          </div>
          <div class="trn-match-team${isDone && m.winnerId === m.teamBId ? " is-winner" : ""}">
            <span class="trn-dot" style="background:${escapeHtml(b ? b.color : "#475569")}"></span>
            <strong class="trn-team-lbl">${escapeHtml(b ? b.name : "— بانتظار المتأهل —")}</strong>
            <span class="trn-score-val">${m.scoreB !== null ? m.scoreB : "—"}</span>
          </div>
          ${
            isReady
              ? `<button type="button" class="btn btn-primary btn-xs trn-start-btn" data-trn-start="${escapeHtml(m.id)}">▶️ ابدأ المباراة</button>`
              : isTie && a && b
                ? `<div class="trn-tie-resolve">
                    <span class="bs-hint">انتهت المباراة بتعادل — اختر الفائز بعد الفاصل أو أعد جولة حسم:</span>
                    <div class="trn-tie-btns">
                      <button type="button" class="btn btn-steal-win btn-xxs" data-trn-tie-win="${escapeHtml(m.id)}|${escapeHtml(a.id)}">👑 فوز ${escapeHtml(a.name)}</button>
                      <button type="button" class="btn btn-amber btn-xxs" data-trn-tie-win="${escapeHtml(m.id)}|${escapeHtml(b.id)}">👑 فوز ${escapeHtml(b.name)}</button>
                      <button type="button" class="btn btn-secondary btn-xxs" data-trn-start="${escapeHtml(m.id)}">⚔️ إعادة حسم</button>
                    </div>
                  </div>`
                : ""
          }
        </article>
      `;
    }

    _renderActiveTournamentHtml() {
      const t = this.tournament;
      const champ = this._findTeam(t.championId);
      const formatNames = {
        "classic-6": "كلاسيكي كامل (6 فئات)",
        "classic-4": "لوحة سريعة (4 فئات)",
        blitz: "⚡ جولة البرق (Blitz)"
      };
      const doneCount = t.matches.filter((m) => m.status === "completed").length;

      let bodyHtml = "";
      if (t.type === "knockout") {
        const roundsMap = new Map();
        t.matches.forEach((m) => {
          if (!roundsMap.has(m.round)) roundsMap.set(m.round, { label: m.roundLabel, list: [] });
          roundsMap.get(m.round).list.push(m);
        });
        bodyHtml = `
          <div class="trn-bracket-grid">
            ${Array.from(roundsMap.values())
              .map(
                (col) => `
              <div class="trn-bracket-col">
                <h4 class="trn-col-title">${escapeHtml(col.label)}</h4>
                <div class="trn-col-matches">${col.list.map((m) => this._renderMatchCardHtml(m)).join("")}</div>
              </div>
            `
              )
              .join("")}
          </div>
        `;
      } else {
        const standings = this.computeLeagueStandings();
        bodyHtml = `
          <div class="bs-section">
            <h4 class="trn-col-title">📊 جدول ترتيب الدوري</h4>
            <div class="hof-table-scroll">
              <table class="hof-leaderboard-table">
                <thead>
                  <tr><th>#</th><th>الفريق</th><th>لعب</th><th>فاز</th><th>تعادل</th><th>خسر</th><th>النقاط المسجّلة</th><th>نقاط الدوري</th></tr>
                </thead>
                <tbody>
                  ${standings
                    .map(
                      (s, i) => `
                    <tr class="${i === 0 && s.played > 0 ? "is-rank-1" : ""}">
                      <td><strong>${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</strong></td>
                      <td><span class="trn-dot" style="background:${escapeHtml(s.color)};display:inline-block;margin-left:6px"></span><strong>${escapeHtml(s.name)}</strong></td>
                      <td>${s.played}</td>
                      <td>${s.wins}</td>
                      <td>${s.draws}</td>
                      <td>${s.losses}</td>
                      <td>${s.pointsFor}</td>
                      <td><strong>${s.leaguePoints}</strong></td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
          <div class="bs-section">
            <h4 class="trn-col-title">⚔️ مواجهات الدوري (${doneCount} / ${t.matches.length})</h4>
            <div class="trn-league-matches">${t.matches.map((m) => this._renderMatchCardHtml(m)).join("")}</div>
          </div>
        `;
      }

      return `
        <div class="trn-active-wrap">
          <div class="trn-top-summary">
            <div>
              <h3 class="trn-name-heading">🏆 ${escapeHtml(t.name)}</h3>
              <span class="bs-hint">${t.type === "knockout" ? "نظام خروج المغلوب" : "نظام دوري النقاط"} • ${formatNames[t.matchFormat] || ""} • المكتمل: ${doneCount}/${t.matches.length}</span>
            </div>
            <div class="trn-top-btns">
              ${
                t.status === "completed"
                  ? `<button type="button" id="trn-btn-result-card" class="btn btn-amber btn-xs">📸 بطاقة تتويج البطولة</button>`
                  : ""
              }
              <button type="button" id="trn-btn-new" class="btn btn-danger-outline btn-xs">🗑️ بطولة جديدة</button>
            </div>
          </div>

          ${
            t.status === "completed" && champ
              ? `
                <div class="trn-champion-banner">
                  <div class="trn-champ-crown">👑🏆👑</div>
                  <div class="trn-champ-sub">بطل «${escapeHtml(t.name)}»</div>
                  <div class="trn-champ-name">${escapeHtml(champ.name)}</div>
                </div>
              `
              : ""
          }

          ${bodyHtml}
        </div>
      `;
    }

    _bindActiveEvents() {
      this.bodyEl.querySelectorAll("[data-trn-start]").forEach((btn) => {
        btn.addEventListener("click", () => this.startMatch(btn.dataset.trnStart));
      });
      this.bodyEl.querySelectorAll("[data-trn-tie-win]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [mId, wId] = (btn.dataset.trnTieWin || "").split("|");
          if (mId && wId) this.resolveKnockoutTie(mId, wId);
        });
      });
      document.getElementById("trn-btn-result-card")?.addEventListener("click", () => this.openTournamentResultCard());
      document.getElementById("trn-btn-new")?.addEventListener("click", () => this.resetTournament());
    }
  }

  window.SeenJeemTournament = new TournamentController();
})();
