/**
 * محرك لعبة «المافيا» اللاسلكية بالهواتف والتلفزيون — الراوي الآلي (Pack 14)
 * - يدعم 4 إلى 16 لاعباً (العدد المثالي 5+ مع السماح بـ 4 لاعبين للتجربة والجلسات الصغيرة)
 * - الأدوار: المافيا، الطبيب، المحقق، المهرج (اختياري لـ 6+ لاعبين)، والمواطن
 * - آلة حالات كاملة من 8 مراحل: setup -> role_reveal -> night -> dawn_report -> day_discussion -> day_voting -> vote_result -> game_over
 * - منع تسريب مطلق: لا تُعرض الأدوار السرية ولا قرارات الليل في DOM الشاشة الرئيسية أو التلفزيون أو publicState إطلاقاً
 * - التمويه الذكي الليلي: جميع الأحياء يتفاعلون في وقت واحد لمنع كشف الأدوار بصوت النقر
 * - تحكم اللاعب الأول (VIP) + وضع العرض الكامل النظيف + بطاقة نتيجة 1080×1350 + قاعة المشاهير
 */
(function () {
  "use strict";

  const ROLE_META = Object.freeze({
    mafia: {
      id: "mafia",
      label: "مافيا",
      icon: "🕵️",
      team: "mafia",
      description: "تعاون سراً مع شركائك لاختيار هدف كل ليلة وإقصائه دون أن يكشفك المواطنون."
    },
    doctor: {
      id: "doctor",
      label: "الطبيب",
      icon: "🩺",
      team: "citizens",
      description: "اختر كل ليلة لاعباً واحداً لحمايته سراً من محاولة إقصاء المافيا."
    },
    detective: {
      id: "detective",
      label: "المحقق",
      icon: "🔍",
      team: "citizens",
      description: "اختر كل ليلة لاعباً حياً لفحصه، وستصلك الحقيقة سراً على هاتفك مع بزوغ الفجر."
    },
    jester: {
      id: "jester",
      label: "المهرج",
      icon: "🃏",
      team: "jester",
      description: "هدفك الوحيد إقناع المدينة بإقصائك عبر التصويت النهاري لتفوز وحدك فوراً!"
    },
    citizen: {
      id: "citizen",
      label: "مواطن",
      icon: "🏘️",
      team: "citizens",
      description: "راقب النقاشات، اكتشف أفراد المافيا، وصوّت لإقصائهم لحماية المدينة."
    }
  });

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(secs) {
    const s = Math.max(0, Math.floor(Number(secs) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function shuffleArray(list, rng = Math.random) {
    const arr = Array.isArray(list) ? list.slice() : [];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function getDefaultMafiaCount(playerCount) {
    const n = Math.max(0, Math.floor(Number(playerCount) || 0));
    if (n >= 11) return 3;
    if (n >= 7) return 2;
    return 1;
  }

  function getMaxAllowedMafia(playerCount) {
    const n = Math.max(4, Math.floor(Number(playerCount) || 4));
    return Math.max(1, Math.min(4, Math.floor(n / 3)));
  }

  /**
   * دوال منطقية نقية وقابلة للاختبار البرمجي (Pure Engine Functions)
   */
  function assignRoles(players, config = {}, rng = Math.random) {
    const roster = Array.isArray(players) ? players.filter((p) => p && p.uid) : [];
    const n = roster.length;
    if (n < 4) throw new Error("تحتاج لعبة المافيا إلى 4 لاعبين على الأقل.");

    const maxMafia = getMaxAllowedMafia(n);
    const desiredMafia =
      config.mafiaCountMode === "manual" && Number.isFinite(Number(config.mafiaCount))
        ? Math.min(maxMafia, Math.max(1, Math.floor(Number(config.mafiaCount))))
        : getDefaultMafiaCount(n);

    const pool = [];
    for (let i = 0; i < desiredMafia; i++) pool.push("mafia");
    if (config.doctorEnabled !== false && pool.length < n) pool.push("doctor");
    if (config.detectiveEnabled !== false && pool.length < n) pool.push("detective");
    if (config.jesterEnabled === true && n >= 6 && pool.length < n) pool.push("jester");
    while (pool.length < n) pool.push("citizen");

    const shuffledRoles = shuffleArray(pool, rng);
    const roleMap = {};
    const mafiaMembers = [];

    roster.forEach((p, idx) => {
      const roleId = shuffledRoles[idx] || "citizen";
      roleMap[p.uid] = roleId;
      if (roleId === "mafia") {
        mafiaMembers.push({ uid: p.uid, name: p.name });
      }
    });

    const gameId = `mafia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const privateRolesByUid = {};
    roster.forEach((p) => {
      const roleId = roleMap[p.uid];
      const meta = ROLE_META[roleId] || ROLE_META.citizen;
      privateRolesByUid[p.uid] = {
        gameId,
        role: meta.id,
        roleLabel: meta.label,
        roleIcon: meta.icon,
        roleDescription: meta.description,
        team: meta.team,
        teammates: roleId === "mafia" ? mafiaMembers.filter((m) => m.uid !== p.uid).map((m) => ({ uid: m.uid, name: m.name })) : []
      };
    });

    return { gameId, roleMap, privateRolesByUid };
  }

  /**
   * فحص شروط الفوز بالترتيب الصارم:
   * 1) إقصاء المهرج بالتصويت النهاري -> فوز المهرج فوراً
   * 2) عدد المافيا الأحياء === 0 -> فوز المواطنين فوراً
   * 3) عدد المافيا الأحياء >= عدد بقية الأحياء غير المافيا -> فوز المافيا فوراً
   */
  function evaluateWinCondition(players, roleMap, { dayEliminatedUid = null } = {}) {
    if (dayEliminatedUid && roleMap[dayEliminatedUid] === "jester") {
      const jesterPlayer = players.find((p) => p.uid === dayEliminatedUid);
      return {
        winnerFaction: "jester",
        title: "🃏 فوز المهرج!",
        subtitle: `نجح ${jesterPlayer ? jesterPlayer.name : "المهرج"} في خداع المدينة وإقناعها بإقصائه بالتصويت!`,
        winnerUids: [dayEliminatedUid]
      };
    }

    const alive = players.filter((p) => p.alive);
    const aliveMafia = alive.filter((p) => roleMap[p.uid] === "mafia");
    const aliveNonMafia = alive.filter((p) => roleMap[p.uid] !== "mafia");

    if (aliveMafia.length === 0) {
      return {
        winnerFaction: "citizens",
        title: "🏘️ فوز المواطنين!",
        subtitle: "نجحت المدينة في كشف وإقصاء جميع أفراد المافيا!",
        winnerUids: players.filter((p) => roleMap[p.uid] !== "mafia" && roleMap[p.uid] !== "jester").map((p) => p.uid)
      };
    }

    if (aliveMafia.length >= aliveNonMafia.length) {
      return {
        winnerFaction: "mafia",
        title: "🕵️ فوز المافيا!",
        subtitle: "سيطرت المافيا على المدينة بعد تساوي أو تفوّق عددها على البقية!",
        winnerUids: players.filter((p) => roleMap[p.uid] === "mafia").map((p) => p.uid)
      };
    }

    return null;
  }

  /**
   * معالجة أحداث الليل بدقة (أغلبية المافيا + حماية الطبيب + فحص المحقق)
   */
  function resolveNightActions({
    players,
    roleMap,
    nightActions,
    roundNumber,
    lastProtectedUid = null,
    noConsecutiveProtect = true,
    rng = Math.random
  }) {
    const aliveSet = new Set(players.filter((p) => p.alive).map((p) => p.uid));
    const byUid = new Map(players.map((p) => [p.uid, p]));

    // 1) جمع تصويتات المافيا الأحياء
    const mafiaVoteCounts = new Map();
    players.forEach((p) => {
      if (!p.alive || roleMap[p.uid] !== "mafia") return;
      const act = nightActions && nightActions[p.uid];
      if (!act || Number(act.roundNumber) !== Number(roundNumber)) return;
      if (act.actionType !== "kill" || !act.targetUid) return;
      if (!aliveSet.has(act.targetUid) || roleMap[act.targetUid] === "mafia") return;
      mafiaVoteCounts.set(act.targetUid, (mafiaVoteCounts.get(act.targetUid) || 0) + 1);
    });

    let mafiaTargetUid = null;
    if (mafiaVoteCounts.size > 0) {
      let maxVotes = 0;
      mafiaVoteCounts.forEach((cnt) => {
        if (cnt > maxVotes) maxVotes = cnt;
      });
      const topTargets = [];
      mafiaVoteCounts.forEach((cnt, uid) => {
        if (cnt === maxVotes) topTargets.push(uid);
      });
      mafiaTargetUid = topTargets[Math.floor(rng() * topTargets.length)] || topTargets[0];
    }

    // 2) قرار الطبيب الحي
    let doctorUid = null;
    let doctorTargetUid = null;
    players.forEach((p) => {
      if (!p.alive || roleMap[p.uid] !== "doctor") return;
      doctorUid = p.uid;
      const act = nightActions && nightActions[p.uid];
      if (!act || Number(act.roundNumber) !== Number(roundNumber)) return;
      if (act.actionType !== "protect" || !act.targetUid) return;
      if (!aliveSet.has(act.targetUid)) return;
      if (noConsecutiveProtect && lastProtectedUid && act.targetUid === lastProtectedUid) return;
      doctorTargetUid = act.targetUid;
    });

    // 3) قرار المحقق الحي
    let detectiveUid = null;
    let investigationResult = null;
    players.forEach((p) => {
      if (!p.alive || roleMap[p.uid] !== "detective") return;
      detectiveUid = p.uid;
      const act = nightActions && nightActions[p.uid];
      if (!act || Number(act.roundNumber) !== Number(roundNumber)) return;
      if (act.actionType !== "investigate" || !act.targetUid) return;
      if (!aliveSet.has(act.targetUid) || act.targetUid === p.uid) return;
      const targetPlayer = byUid.get(act.targetUid);
      investigationResult = {
        roundNumber: Number(roundNumber),
        targetUid: act.targetUid,
        targetName: targetPlayer ? targetPlayer.name : "لاعب",
        isMafia: roleMap[act.targetUid] === "mafia"
      };
    });

    // 4) المقارنة الحاسمة بين المافيا والطبيب
    const saved = Boolean(mafiaTargetUid && doctorTargetUid && mafiaTargetUid === doctorTargetUid);
    const eliminatedUid = mafiaTargetUid && !saved ? mafiaTargetUid : null;

    return {
      mafiaTargetUid,
      doctorUid,
      doctorTargetUid,
      detectiveUid,
      investigationResult,
      saved,
      eliminatedUid,
      nextLastProtectedUid: doctorTargetUid || null
    };
  }

  /**
   * معالجة تصويت النهار السري (تعددية واضحة بدون تعادل وتفوّق على التخطي)
   */
  function resolveDayVotes({ players, dayVotes, roundNumber }) {
    const aliveList = players.filter((p) => p.alive);
    const aliveSet = new Set(aliveList.map((p) => p.uid));
    const byUid = new Map(players.map((p) => [p.uid, p]));

    const counts = new Map();
    let skipVotes = 0;
    const voteBreakdown = [];

    aliveList.forEach((voter) => {
      const v = dayVotes && dayVotes[voter.uid];
      const hasValidRound = Boolean(v && Number(v.roundNumber) === Number(roundNumber) && typeof v.targetUid === "string");

      if (!hasValidRound) {
        voteBreakdown.push({
          voterUid: voter.uid,
          voterName: voter.name,
          targetUid: "ABSTAIN",
          targetName: "لم يصوّت"
        });
        return;
      }

      if (v.targetUid === "SKIP") {
        skipVotes += 1;
        voteBreakdown.push({
          voterUid: voter.uid,
          voterName: voter.name,
          targetUid: "SKIP",
          targetName: "تخطي التصويت"
        });
        return;
      }

      if (v.targetUid !== voter.uid && aliveSet.has(v.targetUid)) {
        counts.set(v.targetUid, (counts.get(v.targetUid) || 0) + 1);
        const target = byUid.get(v.targetUid);
        voteBreakdown.push({
          voterUid: voter.uid,
          voterName: voter.name,
          targetUid: v.targetUid,
          targetName: target ? target.name : "لاعب"
        });
      } else {
        voteBreakdown.push({
          voterUid: voter.uid,
          voterName: voter.name,
          targetUid: "ABSTAIN",
          targetName: "تصويت غير صالح"
        });
      }
    });

    let topCount = 0;
    let topUids = [];
    counts.forEach((cnt, uid) => {
      if (cnt > topCount) {
        topCount = cnt;
        topUids = [uid];
      } else if (cnt === topCount) {
        topUids.push(uid);
      }
    });

    // يُقصى اللاعب فقط إذا حصل على أعلى أصوات بدون تعادل وتفوّق على أصوات التخطي
    let eliminatedUid = null;
    let outcome = "skip";
    if (topCount > 0 && topUids.length === 1 && topCount > skipVotes) {
      eliminatedUid = topUids[0];
      outcome = "eliminated";
    } else if (topCount > 0 && (topUids.length > 1 || topCount === skipVotes)) {
      outcome = "tie";
    } else {
      outcome = "skip";
    }

    const tally = [];
    counts.forEach((cnt, uid) => {
      const p = byUid.get(uid);
      tally.push({ uid, name: p ? p.name : "لاعب", votes: cnt });
    });
    tally.sort((a, b) => b.votes - a.votes);

    return {
      voteBreakdown,
      tally,
      skipVotes,
      eliminatedUid,
      outcome
    };
  }

  class MafiaController {
    constructor() {
      this.modal = null;
      this.body = null;
      this.isOpenFlag = false;
      this.cleanTvMode = false;

      // إعدادات الجلسة
      this.config = {
        mafiaCountMode: "auto", // "auto" | "manual"
        mafiaCount: 1,
        doctorEnabled: true,
        detectiveEnabled: true,
        jesterEnabled: false,
        revealRoleOnDeath: true,
        noConsecutiveProtect: true,
        nightSeconds: 45,
        discussionSeconds: 120,
        voteSeconds: 45,
        vipEnabled: true,
        showQrOnTv: true
      };

      // حالة الغرفة اللاسلكية
      this.room = {
        active: false,
        code: "",
        playerUrl: "",
        connected: false,
        joinLocked: false,
        vipUid: null,
        playersMap: {}
      };

      // حالة اللعبة (البيانات السرية محفوظة في ذاكرة JS فقط ولا تخرج للـ DOM أو publicState!)
      this.phase = "setup"; // setup | role_reveal | night | dawn_report | day_discussion | day_voting | vote_result | game_over
      this.gameId = "";
      this.roundNumber = 0;
      this.players = []; // [{ uid, name, alive, eliminatedAtRound, eliminatedBy, revealedRole }]
      this._secretRoles = {}; // uid -> roleId (سري!)
      this._privateIntel = {}; // uid -> { investigations: [], mafiaPicks: {}, lastProtectedUid: null } (سري!)
      this._nightActions = {}; // uid -> actionObj (سري!)
      this._dayVotes = {}; // uid -> voteObj (سري!)
      this._readyUids = new Set();
      this._lastProtectedUid = null;
      this._sessionTimeline = []; // أحداث مفصّلة تُكشف في game_over فقط!
      this._statsCounters = { doctorSaves: 0, detectiveHits: 0, detectiveChecks: 0, nightsPlayed: 0 };
      this._recordedSessionId = "";

      this.dawnSummary = null;
      this.voteResult = null;
      this.gameOverData = null;

      this.timer = {
        status: "idle", // idle | running | paused | finished | unlimited
        totalSeconds: 0,
        remainingSeconds: 0,
        endAtMs: null
      };
      this._timerInterval = null;
      this._lastTickSecond = null;
      this._qrCacheUrl = "";
      this._qrCacheSvg = "";
    }

    init() {
      this.modal = document.getElementById("mafia-modal");
      this.body = document.getElementById("mafia-body");
      if (!this.modal || !this.body) return;

      const btnClose = document.getElementById("btn-close-mafia");
      const btnOpenTv = document.getElementById("btn-mafia-open-tv");
      const btnCleanTv = document.getElementById("btn-mafia-clean-tv");
      const btnExitClean = document.getElementById("btn-mafia-exit-clean-tv");

      if (btnClose) btnClose.addEventListener("click", () => this.close());
      if (btnOpenTv) {
        btnOpenTv.addEventListener("click", () => {
          if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openTVDisplayWindow === "function") {
            window.SeenJeemHostBridge.openTVDisplayWindow();
          }
        });
      }
      if (btnCleanTv) btnCleanTv.addEventListener("click", () => this.setCleanTvMode(!this.cleanTvMode));
      if (btnExitClean) btnExitClean.addEventListener("click", () => this.setCleanTvMode(false));

      this.modal.addEventListener("click", (e) => {
        if (e.target === this.modal && !this.cleanTvMode) {
          this.close();
        }
      });

      this.body.addEventListener("click", (e) => this._handleBodyClick(e));
    }

    isOpen() {
      return Boolean(this.isOpenFlag);
    }

    open() {
      if (!this.modal) this.init();
      if (!this.modal) return;
      this.isOpenFlag = true;
      this.modal.classList.add("open");
      this.modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      this._render();
      this._syncDisplayAndFirebase();
    }

    close() {
      if (!this.modal) return;
      this._stopTimer();
      this.setCleanTvMode(false);
      this.isOpenFlag = false;
      this.modal.classList.remove("open");
      this.modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.broadcastTV === "function") {
        window.SeenJeemHostBridge.broadcastTV();
      }
    }

    setCleanTvMode(enabled) {
      this.cleanTvMode = Boolean(enabled);
      if (this.modal) {
        this.modal.classList.toggle("is-clean-tv-mode", this.cleanTvMode);
      }
      const exitBtn = document.getElementById("btn-mafia-exit-clean-tv");
      if (exitBtn) exitBtn.hidden = !this.cleanTvMode;
    }

    _toast(msg, type = "info") {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.showToast === "function") {
        window.SeenJeemHostBridge.showToast(msg, type);
      }
    }

    _playSfx(name) {
      const a = window.SeenJeemAudio;
      if (!a) return;
      if (name === "night" && typeof a.playMafiaNight === "function") a.playMafiaNight();
      else if (name === "dawn" && typeof a.playMafiaDawn === "function") a.playMafiaDawn();
      else if (name === "vote" && typeof a.playMafiaVotePulse === "function") a.playMafiaVotePulse();
      else if (name === "elim" && typeof a.playMafiaElimination === "function") a.playMafiaElimination();
      else if (name === "victory" && typeof a.playVictory === "function") a.playVictory();
      else if (name === "tick" && typeof a.playTick === "function") a.playTick(true);
    }

    _getOrderedLobbyPlayers() {
      const map = this.room.playersMap || {};
      return Object.keys(map)
        .map((uid) => {
          const p = map[uid];
          if (!p || !p.name) return null;
          return {
            uid,
            name: String(p.name).trim(),
            avatar: typeof p.avatar === "string" && p.avatar.trim() ? p.avatar.trim() : "👤",
            joinedAt: Number(p.joinedAt) || 0,
            online: p.online !== false
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    }

    _reconcileVipUid() {
      if (!this.room.active) return;
      const lobby = this._getOrderedLobbyPlayers();
      const onlineUids = new Set(lobby.map((p) => p.uid));
      let nextVip = this.room.vipUid;
      if (!nextVip || !onlineUids.has(nextVip)) {
        nextVip = lobby.length > 0 ? lobby[0].uid : null;
      }
      if (nextVip !== this.room.vipUid) {
        this.room.vipUid = nextVip;
        if (window.SeenJeemMafiaSync) {
          window.SeenJeemMafiaSync.setVipMeta({ vipUid: nextVip, vipEnabled: this.config.vipEnabled }).catch(() => {});
        }
      }
    }

    async openWirelessRoom() {
      const sync = window.SeenJeemMafiaSync;
      if (!sync) return;
      if (!sync.isConfigured()) {
        this._toast("⚠️ تعذّر فتح غرفة اللعب حالياً — تأكد من الاتصال بالإنترنت", "warning");
        return;
      }
      try {
        const info = await sync.createRoom({
          initialPublicState: this.buildSanitizedPublicState(),
          vipEnabled: this.config.vipEnabled,
          onPlayers: (map) => this._onPlayersChanged(map),
          onNightActions: (actions) => this._onNightActionsChanged(actions),
          onDayVotes: (votes) => this._onDayVotesChanged(votes),
          onVipCommand: (cmd) => this._onVipCommand(cmd),
          onConnectionState: (isConn) => {
            this.room.connected = isConn;
            this._render();
          }
        });
        this.room.active = true;
        this.room.code = info.roomCode;
        this.room.playerUrl = info.playerUrl;
        this.room.connected = true;
        this.room.joinLocked = false;
        this.room.vipUid = null;
        this.room.playersMap = {};
        this._qrCacheUrl = "";
        this._toast(`🎭 تم فتح غرفة المافيا: ${info.roomCode}`, "success");
        this._render();
        this._syncDisplayAndFirebase();
      } catch (err) {
        this._toast(`❌ ${(err && err.message) || "تعذّر فتح غرفة المافيا"}`, "warning");
      }
    }

    async closeWirelessRoom() {
      this._stopTimer();
      if (window.SeenJeemMafiaSync) {
        await window.SeenJeemMafiaSync.closeRoom();
      }
      this.room = {
        active: false,
        code: "",
        playerUrl: "",
        connected: false,
        joinLocked: false,
        vipUid: null,
        playersMap: {}
      };
      this.phase = "setup";
      this._resetMatchMemory();
      this._toast("🔴 تم إغلاق وحذف غرفة المافيا", "info");
      this._render();
      this._syncDisplayAndFirebase();
    }

    _resetMatchMemory() {
      this.gameId = "";
      this.roundNumber = 0;
      this.players = [];
      this._secretRoles = {};
      this._privateIntel = {};
      this._nightActions = {};
      this._dayVotes = {};
      this._readyUids = new Set();
      this._lastProtectedUid = null;
      this._sessionTimeline = [];
      this._statsCounters = { doctorSaves: 0, detectiveHits: 0, detectiveChecks: 0, nightsPlayed: 0 };
      this._recordedSessionId = "";
      this.dawnSummary = null;
      this.voteResult = null;
      this.gameOverData = null;
    }

    _onPlayersChanged(playersMap) {
      const cleanMap = playersMap && typeof playersMap === "object" ? playersMap : {};
      this.room.playersMap = cleanMap;
      if (!this.room.joinLocked && window.SeenJeemMafiaSync) {
        Object.keys(cleanMap).forEach((uid) => window.SeenJeemMafiaSync.approvePlayerUid(uid));
      }
      this._reconcileVipUid();
      if (this.phase === "setup") {
        this._render();
        this._syncDisplayAndFirebase();
      }
    }

    _onNightActionsChanged(actionsMap) {
      const clean = actionsMap && typeof actionsMap === "object" ? actionsMap : {};
      this._nightActions = clean;

      if (this.phase === "role_reveal") {
        const nextReady = new Set();
        this.players.forEach((p) => {
          const act = clean[p.uid];
          if (act && act.actionType === "ready" && act.gameId === this.gameId) {
            nextReady.add(p.uid);
          }
        });
        this._readyUids = nextReady;
        this._render();
        this._syncDisplayAndFirebase();
        if (this.players.length > 0 && this._readyUids.size >= this.players.length) {
          setTimeout(() => {
            if (this.phase === "role_reveal" && this._readyUids.size >= this.players.length) {
              this.startNightPhase(1);
            }
          }, 900);
        }
        return;
      }

      if (this.phase === "night") {
        // تحديث اختيارات شركاء المافيا لبعضهم فقط في privateIntel
        this._broadcastMafiaPartnerPicks();
        const alive = this.players.filter((p) => p.alive);
        const doneCount = this._countCompletedNightActions();
        this._render();
        this._syncDisplayAndFirebase();

        if (alive.length > 0 && doneCount >= alive.length) {
          this.resolveNightPhase();
        }
      }
    }

    _broadcastMafiaPartnerPicks() {
      const sync = window.SeenJeemMafiaSync;
      if (!sync || !this.room.active) return;
      const aliveMafia = this.players.filter((p) => p.alive && this._secretRoles[p.uid] === "mafia");
      if (aliveMafia.length <= 1) return;

      const byUid = new Map(this.players.map((p) => [p.uid, p]));
      const picks = {};
      aliveMafia.forEach((m) => {
        const act = this._nightActions[m.uid];
        if (act && Number(act.roundNumber) === this.roundNumber && act.actionType === "kill" && act.targetUid) {
          const target = byUid.get(act.targetUid);
          picks[m.uid] = {
            mafiaName: m.name,
            targetUid: act.targetUid,
            targetName: target ? target.name : "لاعب"
          };
        }
      });

      aliveMafia.forEach((m) => {
        const prev = this._privateIntel[m.uid] || {};
        const nextIntel = { ...prev, mafiaPicks: picks, roundNumber: this.roundNumber };
        this._privateIntel[m.uid] = nextIntel;
        sync.publishPrivateIntelForUid(m.uid, nextIntel).catch(() => {});
      });
    }

    _countCompletedNightActions() {
      let count = 0;
      this.players.forEach((p) => {
        if (!p.alive) return;
        const act = this._nightActions[p.uid];
        if (act && Number(act.roundNumber) === this.roundNumber && act.actionType && act.actionType !== "ready") {
          count += 1;
        }
      });
      return count;
    }

    _onDayVotesChanged(votesMap) {
      const clean = votesMap && typeof votesMap === "object" ? votesMap : {};
      this._dayVotes = clean;
      if (this.phase !== "day_voting") return;

      const alive = this.players.filter((p) => p.alive);
      const votedIds = this._getVotedAliveUids();
      this._render();
      this._syncDisplayAndFirebase();

      if (alive.length > 0 && votedIds.length >= alive.length) {
        this.resolveDayVotingPhase();
      }
    }

    _getVotedAliveUids() {
      const out = [];
      this.players.forEach((p) => {
        if (!p.alive) return;
        const v = this._dayVotes[p.uid];
        if (v && Number(v.roundNumber) === this.roundNumber && typeof v.targetUid === "string") {
          out.push(p.uid);
        }
      });
      return out;
    }

    _onVipCommand(cmd) {
      if (!cmd || !this.config.vipEnabled || cmd.uid !== this.room.vipUid) return;
      const type = cmd.type;
      const p = cmd.payload || {};

      if (type === "START_GAME" && this.phase === "setup") {
        this.startGame();
      } else if (type === "START_NIGHT" && this.phase === "role_reveal") {
        this.startNightPhase(1);
      } else if (type === "END_NIGHT_EARLY" && this.phase === "night") {
        this.resolveNightPhase();
      } else if (type === "START_DISCUSSION" && this.phase === "dawn_report") {
        this.startDiscussionPhase();
      } else if (type === "START_VOTING" && this.phase === "day_discussion") {
        this.startVotingPhase();
      } else if (type === "END_VOTING_EARLY" && this.phase === "day_voting") {
        this.resolveDayVotingPhase();
      } else if (type === "NEXT_NIGHT" && this.phase === "vote_result") {
        this.startNightPhase(this.roundNumber + 1);
      } else if (type === "NEW_ROUND" && this.phase === "game_over") {
        this.returnToLobbyForNewRound();
      } else if (type === "UPDATE_CONFIG" && this.phase === "setup") {
        if (typeof p.doctorEnabled === "boolean") this.config.doctorEnabled = p.doctorEnabled;
        if (typeof p.detectiveEnabled === "boolean") this.config.detectiveEnabled = p.detectiveEnabled;
        if (typeof p.jesterEnabled === "boolean") this.config.jesterEnabled = p.jesterEnabled;
        if (typeof p.revealRoleOnDeath === "boolean") this.config.revealRoleOnDeath = p.revealRoleOnDeath;
        this._render();
        this._syncDisplayAndFirebase();
      }
    }

    /* =========================================================
       دورة حياة المراحل الثماني (State Machine Transitions)
       ========================================================= */
    async startGame() {
      const lobby = this._getOrderedLobbyPlayers();
      if (lobby.length < 4) {
        this._toast("⚠️ يلزم انضمام 4 لاعبين على الأقل لبدء لعبة المافيا (المثالي 5+)", "warning");
        return;
      }
      if (lobby.length > 16) {
        this._toast("⚠️ الحد الأقصى للاعبين في الغرفة هو 16 لاعباً", "warning");
        return;
      }

      this._stopTimer();
      this._resetMatchMemory();

      this.players = lobby.map((p) => ({
        uid: p.uid,
        name: p.name,
        alive: true,
        eliminatedAtRound: null,
        eliminatedBy: null,
        revealedRole: null
      }));

      const { gameId, roleMap, privateRolesByUid } = assignRoles(this.players, this.config);
      this.gameId = gameId;
      this._secretRoles = roleMap;
      this.roundNumber = 0;
      this.phase = "role_reveal";

      const initialIntel = {};
      this.players.forEach((p) => {
        initialIntel[p.uid] = {
          gameId,
          investigations: [],
          mafiaPicks: {},
          lastProtectedUid: null
        };
      });
      this._privateIntel = initialIntel;

      if (this.room.active && window.SeenJeemMafiaSync) {
        await window.SeenJeemMafiaSync.publishPrivateRolesAndReset(privateRolesByUid, initialIntel);
      }

      this._playSfx("vote");
      this._render();
      this._syncDisplayAndFirebase();
    }

    async startNightPhase(nextRoundNum) {
      this._stopTimer();
      this.roundNumber = Math.max(1, Number(nextRoundNum) || this.roundNumber + 1);
      this.phase = "night";
      this._nightActions = {};
      this.dawnSummary = null;
      this.voteResult = null;

      // تصفير اختيارات شركاء المافيا لليلة الجديدة في privateIntel مع الإبقاء على lastProtectedUid و investigations
      if (this.room.active && window.SeenJeemMafiaSync) {
        await window.SeenJeemMafiaSync.clearRoundActions({ night: true, votes: true });
        this.players.forEach((p) => {
          if (this._secretRoles[p.uid] === "mafia") {
            const intel = { ...(this._privateIntel[p.uid] || {}), mafiaPicks: {}, roundNumber: this.roundNumber };
            this._privateIntel[p.uid] = intel;
            window.SeenJeemMafiaSync.publishPrivateIntelForUid(p.uid, intel).catch(() => {});
          }
        });
      }

      this._startTimer(this.config.nightSeconds, () => {
        if (this.phase === "night") this.resolveNightPhase();
      });

      this._playSfx("night");
      this._render();
      this._syncDisplayAndFirebase();
    }

    async resolveNightPhase() {
      if (this.phase !== "night") return;
      this._stopTimer();
      this._statsCounters.nightsPlayed += 1;

      const res = resolveNightActions({
        players: this.players,
        roleMap: this._secretRoles,
        nightActions: this._nightActions,
        roundNumber: this.roundNumber,
        lastProtectedUid: this._lastProtectedUid,
        noConsecutiveProtect: this.config.noConsecutiveProtect
      });

      this._lastProtectedUid = res.nextLastProtectedUid;

      // تحديث بيانات الطبيب السرية (lastProtectedUid)
      if (res.doctorUid) {
        const docIntel = {
          ...(this._privateIntel[res.doctorUid] || {}),
          lastProtectedUid: this.config.noConsecutiveProtect ? res.nextLastProtectedUid : null
        };
        this._privateIntel[res.doctorUid] = docIntel;
        if (this.room.active && window.SeenJeemMafiaSync) {
          window.SeenJeemMafiaSync.publishPrivateIntelForUid(res.doctorUid, docIntel).catch(() => {});
        }
      }

      // إرسال نتيجة فحص المحقق سراً إلى هاتفه فقط مع بزوغ الفجر
      if (res.detectiveUid && res.investigationResult) {
        this._statsCounters.detectiveChecks += 1;
        if (res.investigationResult.isMafia) this._statsCounters.detectiveHits += 1;

        const prevDet = this._privateIntel[res.detectiveUid] || { investigations: [] };
        const invList = Array.isArray(prevDet.investigations) ? prevDet.investigations.slice() : [];
        invList.push(res.investigationResult);
        const nextDet = { ...prevDet, investigations: invList };
        this._privateIntel[res.detectiveUid] = nextDet;
        if (this.room.active && window.SeenJeemMafiaSync) {
          window.SeenJeemMafiaSync.publishPrivateIntelForUid(res.detectiveUid, nextDet).catch(() => {});
        }

        const detPlayer = this.players.find((p) => p.uid === res.detectiveUid);
        this._sessionTimeline.push({
          roundNumber: this.roundNumber,
          icon: "🔍",
          text: `الليلة ${this.roundNumber}: فحص المحقق (${detPlayer ? detPlayer.name : "المحقق"}) اللاعب «${res.investigationResult.targetName}» ووجد أنه ${res.investigationResult.isMafia ? "من المافيا!" : "بريء"}`
        });
      }

      // معالجة النتيجة العلنية للفجر (دون كشف الطبيب أو الضحية الناجية عند الإنقاذ)
      let dawnHeadline = "☀️ أشرقت الشمس بسلام — لم يُقصَ أحد هذه الليلة!";
      let dawnSub = "عمّ الهدوء شوارع المدينة هذه الليلة.";
      let eliminatedInfo = null;

      if (res.saved) {
        this._statsCounters.doctorSaves += 1;
        dawnHeadline = "☀️ أشرقت الشمس — نجت المدينة! لم يُقصَ أحد هذه الليلة";
        dawnSub = "بفضل يقظة الطبيب، باءت محاولة المافيا بالفشل دون إقصاء أي لاعب!";
        const savedP = this.players.find((p) => p.uid === res.mafiaTargetUid);
        const docP = this.players.find((p) => p.uid === res.doctorUid);
        this._sessionTimeline.push({
          roundNumber: this.roundNumber,
          icon: "🩺",
          text: `الليلة ${this.roundNumber}: أنقذ الطبيب (${docP ? docP.name : "الطبيب"}) اللاعب «${savedP ? savedP.name : ""}» من إقصاء المافيا!`
        });
        this._playSfx("dawn");
      } else if (res.eliminatedUid) {
        const victim = this.players.find((p) => p.uid === res.eliminatedUid);
        if (victim) {
          victim.alive = false;
          victim.eliminatedAtRound = this.roundNumber;
          victim.eliminatedBy = "mafia";
          const roleMeta = ROLE_META[this._secretRoles[victim.uid]] || ROLE_META.citizen;
          if (this.config.revealRoleOnDeath) {
            victim.revealedRole = { role: roleMeta.id, label: roleMeta.label, icon: roleMeta.icon };
          }
          eliminatedInfo = {
            uid: victim.uid,
            name: victim.name,
            revealedRole: victim.revealedRole
          };
          dawnHeadline = `💀 أشرقت الشمس على خبر صادم — تم إقصاء ${victim.name}`;
          dawnSub = victim.revealedRole
            ? `كان دوره الحقيقي: ${victim.revealedRole.icon} ${victim.revealedRole.label}`
            : "تم إخفاء دوره حسب قواعد الجلسة — تحوّل الآن إلى وضع المتفرج.";
          this._sessionTimeline.push({
            roundNumber: this.roundNumber,
            icon: "💀",
            text: `الليلة ${this.roundNumber}: أقصت المافيا اللاعب «${victim.name}» (${roleMeta.label})`
          });
        }
        this._playSfx("elim");
      } else {
        this._playSfx("dawn");
      }

      this.dawnSummary = {
        roundNumber: this.roundNumber,
        saved: res.saved,
        eliminated: eliminatedInfo,
        headline: dawnHeadline,
        subtitle: dawnSub
      };

      // فحص شروط الفوز فوراً قبل الانتقال للنهار
      const win = evaluateWinCondition(this.players, this._secretRoles);
      if (win) {
        this._enterGameOver(win, dawnHeadline);
        return;
      }

      this.phase = "dawn_report";
      this._render();
      this._syncDisplayAndFirebase();
    }

    startDiscussionPhase() {
      if (this.phase !== "dawn_report") return;
      this._stopTimer();
      this.phase = "day_discussion";

      if (this.config.discussionSeconds > 0) {
        this._startTimer(this.config.discussionSeconds, () => {
          if (this.phase === "day_discussion") {
            this.startVotingPhase();
          }
        });
      } else {
        this.timer = { status: "unlimited", totalSeconds: 0, remainingSeconds: 0, endAtMs: null };
      }

      this._render();
      this._syncDisplayAndFirebase();
    }

    async startVotingPhase() {
      if (this.phase !== "day_discussion" && this.phase !== "dawn_report") return;
      this._stopTimer();
      this.phase = "day_voting";
      this._dayVotes = {};
      if (this.room.active && window.SeenJeemMafiaSync) {
        await window.SeenJeemMafiaSync.clearRoundActions({ votes: true });
      }

      this._startTimer(this.config.voteSeconds, () => {
        if (this.phase === "day_voting") this.resolveDayVotingPhase();
      });

      this._playSfx("vote");
      this._render();
      this._syncDisplayAndFirebase();
    }

    resolveDayVotingPhase() {
      if (this.phase !== "day_voting") return;
      this._stopTimer();

      const res = resolveDayVotes({
        players: this.players,
        dayVotes: this._dayVotes,
        roundNumber: this.roundNumber
      });

      let eliminatedInfo = null;
      let headline = "⚖️ لم يُقصَ أحد اليوم!";
      let subtitle =
        res.outcome === "tie"
          ? "حدث تعادل في الأصوات — تستمر اللعبة دون إقصاء."
          : "اختارت الأغلبية تخطي التصويت اليوم.";

      if (res.eliminatedUid) {
        const victim = this.players.find((p) => p.uid === res.eliminatedUid);
        if (victim) {
          victim.alive = false;
          victim.eliminatedAtRound = this.roundNumber;
          victim.eliminatedBy = "vote";
          const roleMeta = ROLE_META[this._secretRoles[victim.uid]] || ROLE_META.citizen;
          if (this.config.revealRoleOnDeath || roleMeta.id === "jester") {
            victim.revealedRole = { role: roleMeta.id, label: roleMeta.label, icon: roleMeta.icon };
          }
          eliminatedInfo = {
            uid: victim.uid,
            name: victim.name,
            revealedRole: victim.revealedRole
          };
          headline = `⚖️ قرّرت المدينة إقصاء ${victim.name}!`;
          subtitle = victim.revealedRole
            ? `كان دوره الحقيقي: ${victim.revealedRole.icon} ${victim.revealedRole.label}`
            : "تم إخفاء دوره حسب قواعد الجلسة.";
          this._sessionTimeline.push({
            roundNumber: this.roundNumber,
            icon: "⚖️",
            text: `النهار ${this.roundNumber}: صوّتت المدينة على إقصاء «${victim.name}» (${roleMeta.label})`
          });
        }
        this._playSfx("elim");
      } else {
        this._playSfx("dawn");
      }

      this.voteResult = {
        roundNumber: this.roundNumber,
        outcome: res.outcome,
        skipVotes: res.skipVotes,
        tally: res.tally,
        voteBreakdown: res.voteBreakdown,
        eliminated: eliminatedInfo,
        headline,
        subtitle
      };

      // فحص شروط الفوز بالترتيب الصارم (المهرج -> المواطنين -> المافيا)
      const win = evaluateWinCondition(this.players, this._secretRoles, {
        dayEliminatedUid: res.eliminatedUid
      });
      if (win) {
        this._enterGameOver(win, headline);
        return;
      }

      this.phase = "vote_result";
      this._render();
      this._syncDisplayAndFirebase();
    }

    _enterGameOver(winObj, closingEventText = "") {
      this._stopTimer();
      this.phase = "game_over";

      const winnerSet = new Set(winObj.winnerUids || []);
      const revealedRoster = this.players.map((p) => {
        const roleId = this._secretRoles[p.uid] || "citizen";
        const meta = ROLE_META[roleId] || ROLE_META.citizen;
        p.revealedRole = { role: meta.id, label: meta.label, icon: meta.icon };
        return {
          uid: p.uid,
          name: p.name,
          alive: p.alive,
          role: meta.id,
          roleLabel: meta.label,
          roleIcon: meta.icon,
          team: meta.team,
          won: winnerSet.has(p.uid),
          eliminatedAtRound: p.eliminatedAtRound,
          eliminatedBy: p.eliminatedBy
        };
      });

      this.gameOverData = {
        sessionId: this.gameId || `mafia_${Date.now().toString(36)}`,
        winnerFaction: winObj.winnerFaction,
        title: winObj.title,
        subtitle: winObj.subtitle,
        closingEventText,
        nightsPlayed: Math.max(1, this._statsCounters.nightsPlayed || this.roundNumber || 1),
        players: revealedRoster,
        timeline: this._sessionTimeline.slice(),
        highlights: {
          doctorSaves: this._statsCounters.doctorSaves,
          detectiveHits: this._statsCounters.detectiveHits,
          detectiveChecks: this._statsCounters.detectiveChecks
        },
        timestamp: Date.now()
      };

      this._recordMafiaStatsOnce(this.gameOverData);
      this._playSfx("victory");
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.triggerConfetti === "function") {
        window.SeenJeemHostBridge.triggerConfetti("victory", "default");
      }

      this._render();
      this._syncDisplayAndFirebase();
    }

    _recordMafiaStatsOnce(goData) {
      if (!goData || !goData.sessionId || this._recordedSessionId === goData.sessionId) return;
      this._recordedSessionId = goData.sessionId;
      const store = window.SeenJeemArchiveStore;
      if (!store || typeof store.recordMafiaSession !== "function") return;
      const profileId =
        window.SeenJeemHistoryStore && typeof window.SeenJeemHistoryStore.getActiveProfile === "function"
          ? window.SeenJeemHistoryStore.getActiveProfile().id
          : "default";
      store.recordMafiaSession({
        sessionId: goData.sessionId,
        profileId,
        playedAt: goData.timestamp,
        winnerFaction: goData.winnerFaction,
        nightsPlayed: goData.nightsPlayed,
        doctorSaves: goData.highlights.doctorSaves,
        detectiveHits: goData.highlights.detectiveHits,
        detectiveChecks: goData.highlights.detectiveChecks,
        players: goData.players.map((p) => ({
          name: p.name,
          role: p.role,
          won: p.won,
          alive: p.alive
        }))
      });
      if (window.SeenJeemCloudSync && typeof window.SeenJeemCloudSync.scheduleAutoSync === "function") {
        window.SeenJeemCloudSync.scheduleAutoSync();
      }
    }

    async returnToLobbyForNewRound() {
      this._stopTimer();
      this.phase = "setup";
      this._resetMatchMemory();
      if (this.room.active && window.SeenJeemMafiaSync) {
        await window.SeenJeemMafiaSync.clearRoundActions({ night: true, votes: true });
      }
      this._render();
      this._syncDisplayAndFirebase();
    }

    /* =========================================================
       إدارة المؤقت المتزامن (endAtMs + .info/serverTimeOffset)
       ========================================================= */
    _stopTimer() {
      if (this._timerInterval) {
        clearInterval(this._timerInterval);
        this._timerInterval = null;
      }
      this._lastTickSecond = null;
    }

    _startTimer(seconds, onExpire) {
      this._stopTimer();
      const total = Math.max(5, Math.floor(Number(seconds) || 45));
      const sync = window.SeenJeemMafiaSync;
      const nowServer = sync && typeof sync.getServerNowMs === "function" ? sync.getServerNowMs() : Date.now();
      const endAtMs = nowServer + total * 1000;

      this.timer = {
        status: "running",
        totalSeconds: total,
        remainingSeconds: total,
        endAtMs
      };

      this._timerInterval = setInterval(() => {
        const curServer = sync && typeof sync.getServerNowMs === "function" ? sync.getServerNowMs() : Date.now();
        const rem = Math.max(0, Math.ceil((endAtMs - curServer) / 1000));
        this.timer.remainingSeconds = rem;

        const el = document.getElementById("mafia-live-timer");
        if (el) {
          el.textContent = formatTime(rem);
          el.classList.toggle("danger", rem <= 10 && rem > 0);
        }

        if (this.phase === "day_discussion" && rem > 0 && rem <= 10 && rem !== this._lastTickSecond) {
          this._lastTickSecond = rem;
          this._playSfx("tick");
        }

        // بث المؤقت محلياً لشاشة التلفزيون دون أي كتابة إلى Firebase
        if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.broadcastTV === "function") {
          window.SeenJeemHostBridge.broadcastTV();
        }

        if (rem <= 0) {
          this.timer.status = "finished";
          this._stopTimer();
          if (typeof onExpire === "function") onExpire();
        }
      }, 300);
    }

    /* =========================================================
       بناء الحالة العامة المنقّاة (Anti-Spoiler 100%)
       ========================================================= */
    buildSanitizedPublicState() {
      const lobby = this._getOrderedLobbyPlayers();
      const roster =
        this.phase === "setup"
          ? lobby.map((p) => ({
              uid: p.uid,
              name: p.name,
              alive: true,
              revealedRole: null
            }))
          : this.players.map((p) => ({
              uid: p.uid,
              name: p.name,
              alive: Boolean(p.alive),
              eliminatedAtRound: p.eliminatedAtRound || null,
              // الدور السري لا يظهر إلا إذا أُقصي اللاعب وكان الكشف مفعّلاً، أو عند game_over!
              revealedRole: p.revealedRole ? { ...p.revealedRole } : null
            }));

      const aliveCount = roster.filter((p) => p.alive).length;
      const votedUids = this.phase === "day_voting" ? this._getVotedAliveUids() : [];
      const nightDoneCount = this.phase === "night" ? this._countCompletedNightActions() : 0;

      // استقرار كائن المؤقت للـ Shallow Diffing في Firebase
      const stableTimer = {
        status: this.timer.status,
        totalSeconds: this.timer.totalSeconds,
        endAtMs: this.timer.status === "running" ? this.timer.endAtMs : null
      };

      return {
        gameId: this.gameId,
        phase: this.phase,
        roundNumber: this.roundNumber,
        roomCode: this.room.code,
        joinLocked: this.room.joinLocked,
        vipEnabled: this.config.vipEnabled,
        vipUid: this.room.vipUid,
        rulesSummary: {
          doctorEnabled: this.config.doctorEnabled,
          detectiveEnabled: this.config.detectiveEnabled,
          jesterEnabled: this.config.jesterEnabled,
          revealRoleOnDeath: this.config.revealRoleOnDeath,
          noConsecutiveProtect: this.config.noConsecutiveProtect
        },
        playersRoster: roster,
        progressCounts: {
          total: roster.length,
          alive: aliveCount,
          readyCount: this._readyUids.size,
          readyUids: this.phase === "role_reveal" ? Array.from(this._readyUids) : [],
          nightDoneCount,
          votedCount: votedUids.length,
          votedUids
        },
        timer: stableTimer,
        dawnSummary: this.phase === "dawn_report" ? this.dawnSummary : null,
        voteResult: this.phase === "vote_result" ? this.voteResult : null,
        gameOverData: this.phase === "game_over" ? this.gameOverData : null
      };
    }

    buildSanitizedDisplayPayload() {
      const pub = this.buildSanitizedPublicState();
      return {
        ...pub,
        playerUrl: this.room.playerUrl,
        showQrOnTv: Boolean(this.config.showQrOnTv),
        remainingSeconds: this.timer.remainingSeconds
      };
    }

    _syncDisplayAndFirebase() {
      if (this.room.active && window.SeenJeemMafiaSync) {
        window.SeenJeemMafiaSync.publishPublicState(this.buildSanitizedPublicState()).catch(() => {});
      }
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.broadcastTV === "function") {
        window.SeenJeemHostBridge.broadcastTV();
      }
    }

    /* =========================================================
       التفاعل مع الأزرار ورسم واجهة الراوي الآلي (بدون أي أسرار!)
       ========================================================= */
    _handleBodyClick(e) {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.mafiaAct;
      if (!act) return;

      switch (act) {
        case "create-room":
          this.openWirelessRoom();
          break;
        case "close-room":
          this.closeWirelessRoom();
          break;
        case "toggle-lock":
          this.room.joinLocked = !this.room.joinLocked;
          if (window.SeenJeemMafiaSync) window.SeenJeemMafiaSync.setJoinLocked(this.room.joinLocked);
          this._render();
          this._syncDisplayAndFirebase();
          break;
        case "toggle-tv-qr":
          this.config.showQrOnTv = !this.config.showQrOnTv;
          this._render();
          this._syncDisplayAndFirebase();
          break;
        case "copy-url":
          if (this.room.playerUrl) {
            navigator.clipboard?.writeText(this.room.playerUrl).then(() => this._toast("📋 تم نسخ رابط انضمام لاعبي المافيا", "success"));
          }
          break;
        case "set-vip": {
          const uid = btn.dataset.uid;
          if (uid) {
            this.room.vipUid = uid;
            if (window.SeenJeemMafiaSync) {
              window.SeenJeemMafiaSync.setVipMeta({ vipUid: uid, vipEnabled: this.config.vipEnabled });
            }
            this._toast("👑 تم تعيين اللاعب الأول (VIP) للتحكم بالجلسة", "success");
            this._render();
            this._syncDisplayAndFirebase();
          }
          break;
        }
        case "kick-player": {
          const uid = btn.dataset.uid;
          if (uid && window.SeenJeemMafiaSync) {
            window.SeenJeemMafiaSync.kickPlayer(uid).then(() => {
              this._toast("🚫 تم طرد اللاعب من الغرفة", "info");
            });
          }
          break;
        }
        case "toggle-rule": {
          const key = btn.dataset.key;
          if (key && key in this.config) {
            this.config[key] = !this.config[key];
            if (key === "vipEnabled" && this.room.active && window.SeenJeemMafiaSync) {
              window.SeenJeemMafiaSync.setVipMeta({ vipEnabled: this.config.vipEnabled });
            }
            this._render();
            this._syncDisplayAndFirebase();
          }
          break;
        }
        case "set-mafia-count": {
          const val = btn.dataset.val;
          if (val === "auto") {
            this.config.mafiaCountMode = "auto";
          } else {
            this.config.mafiaCountMode = "manual";
            this.config.mafiaCount = Math.max(1, Number(val) || 1);
          }
          this._render();
          break;
        }
        case "set-timer": {
          const field = btn.dataset.field;
          const val = Number(btn.dataset.val);
          if (field && Number.isFinite(val)) {
            this.config[field] = val;
            this._render();
          }
          break;
        }
        case "start-game":
          this.startGame();
          break;
        case "start-night-1":
          this.startNightPhase(1);
          break;
        case "resolve-night-now":
          this.resolveNightPhase();
          break;
        case "start-discussion":
          this.startDiscussionPhase();
          break;
        case "start-voting":
          this.startVotingPhase();
          break;
        case "resolve-voting-now":
          this.resolveDayVotingPhase();
          break;
        case "next-night":
          this.startNightPhase(this.roundNumber + 1);
          break;
        case "new-round":
          this.returnToLobbyForNewRound();
          break;
        case "result-card":
          if (this.gameOverData && window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openMafiaResultCard === "function") {
            window.SeenJeemHostBridge.openMafiaResultCard(this.gameOverData);
          }
          break;
        case "exit-home":
          this.close();
          break;
        default:
          break;
      }
    }

    _getQrSvg() {
      if (!this.room.playerUrl || !window.SeenJeemQR) return "";
      if (this._qrCacheUrl !== this.room.playerUrl) {
        this._qrCacheUrl = this.room.playerUrl;
        try {
          this._qrCacheSvg = window.SeenJeemQR.toSVG(this.room.playerUrl, {
            size: 196,
            margin: 3,
            ariaLabel: `رمز QR لغرفة المافيا ${this.room.code}`
          });
        } catch (_err) {
          this._qrCacheSvg = "";
        }
      }
      return this._qrCacheSvg;
    }

    _render() {
      if (!this.body) return;
      if (this.phase === "setup") this.body.innerHTML = this._renderSetupHtml();
      else if (this.phase === "role_reveal") this.body.innerHTML = this._renderRoleRevealHtml();
      else if (this.phase === "night") this.body.innerHTML = this._renderNightHtml();
      else if (this.phase === "dawn_report") this.body.innerHTML = this._renderDawnHtml();
      else if (this.phase === "day_discussion") this.body.innerHTML = this._renderDiscussionHtml();
      else if (this.phase === "day_voting") this.body.innerHTML = this._renderVotingHtml();
      else if (this.phase === "vote_result") this.body.innerHTML = this._renderVoteResultHtml();
      else if (this.phase === "game_over") this.body.innerHTML = this._renderGameOverHtml();
    }

    _renderSetupHtml() {
      const lobby = this._getOrderedLobbyPlayers();
      const count = lobby.length;
      const canStart = this.room.active && count >= 4 && count <= 16;
      const maxMafia = getMaxAllowedMafia(Math.max(4, count));
      const effectiveMafia =
        this.config.mafiaCountMode === "manual"
          ? Math.min(maxMafia, Math.max(1, this.config.mafiaCount))
          : getDefaultMafiaCount(Math.max(4, count));
      const jesterAllowed = count >= 6;
      const fbReady = Boolean(window.SeenJeemMafiaSync && window.SeenJeemMafiaSync.isConfigured());

      return `
        <div class="mafia-stage mafia-setup-stage">
          <div class="mafia-intro-banner">
            <div>
              <strong>🎭 وضع الراوي الآلي (بدون مشرف بشري!)</strong>
              <p>الجميع يلعب من هواتفهم بسرية تامة، وهذه الشاشة (والتلفزيون) تدير الليل والنهار والتصويت دون كشف أي دور سري.</p>
            </div>
            <span class="mafia-ideal-badge">👥 4–16 لاعباً • المثالي 5+</span>
          </div>

          <!-- 1) قسم الغرفة اللاسلكية والـ QR -->
          <section class="bank-section mafia-room-section">
            <div class="bank-section-header">
              <h3 class="bank-section-title">📡 غرفة المافيا اللاسلكية</h3>
              <span class="bank-count-pill">${this.room.active ? `🟢 الغرفة نشطة (${count} لاعب)` : "⚪ لم تُفتح غرفة بعد"}</span>
            </div>

            ${
              !this.room.active
                ? `
                  <div class="mafia-open-room-box">
                    <p>${fbReady ? "افتح غرفة لعب فورية ليمسح اللاعبون رمز QR بهواتفهم وينضمّوا مباشرة." : "⚠️ خدمة اللعب عبر الهواتف غير متاحة حالياً — تأكد من الاتصال بالإنترنت."}</p>
                    <button type="button" class="btn btn-primary btn-lg" data-mafia-act="create-room" ${!fbReady ? "disabled" : ""}>
                      🎭 فتح غرفة المافيا وإنشاء QR Code
                    </button>
                  </div>
                `
                : `
                  <div class="mafia-lobby-grid">
                    <div class="mafia-qr-panel">
                      <div class="mafia-qr-svg">${this._getQrSvg()}</div>
                      <div class="mafia-room-code-big">رمز الغرفة: <strong>${escapeHtml(this.room.code)}</strong></div>
                      <div class="mafia-qr-btns">
                        <button type="button" class="btn btn-secondary btn-xs" data-mafia-act="copy-url">📋 نسخ رابط اللاعبين</button>
                        <a href="${escapeHtml(this.room.playerUrl)}" target="_blank" rel="noopener" class="btn btn-ghost btn-xs">↗️ فتح شاشة لاعب</a>
                        <button type="button" class="btn btn-gold-outline btn-xs" data-mafia-act="toggle-tv-qr">
                          ${this.config.showQrOnTv ? "📺 إخفاء QR من التلفزيون" : "📺 إظهار QR على التلفزيون"}
                        </button>
                      </div>
                      <div class="mafia-qr-btns">
                        <button type="button" class="btn btn-secondary btn-xs" data-mafia-act="toggle-lock">
                          ${this.room.joinLocked ? "🔒 الانضمام مقفل (فتح)" : "🔓 قفل الانضمام"}
                        </button>
                        <button type="button" class="btn btn-danger-outline btn-xs" data-mafia-act="close-room">🔴 إغلاق الغرفة</button>
                      </div>
                    </div>

                    <div class="mafia-players-panel">
                      <div class="mafia-sub-head">
                        <strong>اللاعبون المنضمون (${count} / 16)</strong>
                        <span class="mafia-count-hint">${count < 4 ? `متبقي ${4 - count} على الأقل للبدء` : count === 4 ? "جاهز للبدء (المثالي 5+)" : "✅ عدد ممتاز للبدء!"}</span>
                      </div>
                      ${
                        count === 0
                          ? `<div class="empty-inline-note">بانتظار مسح رمز QR من هواتف اللاعبين...</div>`
                          : `<div class="mafia-lobby-list">
                              ${lobby
                                .map((p, idx) => {
                                  const isVip = this.room.vipUid === p.uid;
                                  return `
                                    <div class="mafia-lobby-player${isVip ? " is-vip" : ""}">
                                      <span class="mafia-player-name">${escapeHtml(p.avatar || "👤")} ${escapeHtml(p.name)} ${isVip ? `<span class="mafia-vip-tag">👑 VIP</span>` : ""}</span>
                                      <div class="mafia-player-tools">
                                        ${!isVip ? `<button type="button" class="btn btn-ghost btn-xxs" data-mafia-act="set-vip" data-uid="${escapeHtml(p.uid)}" title="تعيين كمتحكم VIP">👑 VIP</button>` : ""}
                                        <button type="button" class="btn btn-danger-outline btn-xxs" data-mafia-act="kick-player" data-uid="${escapeHtml(p.uid)}" title="طرد اللاعب">🚫 طرد</button>
                                      </div>
                                    </div>
                                  `;
                                })
                                .join("")}
                            </div>`
                      }
                    </div>
                  </div>
                `
            }
          </section>

          <!-- 2) إعدادات الأدوار والقواعد والمؤقتات -->
          <section class="bank-section mafia-config-section">
            <div class="bank-section-header">
              <h3 class="bank-section-title">⚙️ توزيع الأدوار وقواعد الجلسة</h3>
              <span class="bank-count-pill">🕵️ ${effectiveMafia} مافيا • ${this.config.doctorEnabled ? "🩺 طبيب" : ""} ${this.config.detectiveEnabled ? "🔍 محقق" : ""} ${this.config.jesterEnabled && jesterAllowed ? "🃏 مهرج" : ""}</span>
            </div>

            <div class="mafia-config-grid">
              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">🕵️ عدد أفراد المافيا:</span>
                <div class="tactical-pills-row">
                  <button type="button" class="tactical-opt-btn${this.config.mafiaCountMode === "auto" ? " active" : ""}" data-mafia-act="set-mafia-count" data-val="auto">تلقائي (${getDefaultMafiaCount(Math.max(4, count))})</button>
                  ${[1, 2, 3].filter((n) => n <= Math.max(2, maxMafia)).map((n) => `
                    <button type="button" class="tactical-opt-btn${this.config.mafiaCountMode === "manual" && this.config.mafiaCount === n ? " active" : ""}" data-mafia-act="set-mafia-count" data-val="${n}" ${n > maxMafia ? "disabled" : ""}>${n}</button>
                  `).join("")}
                </div>
              </div>

              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">🎭 الأدوار الخاصة:</span>
                <div class="tactical-pills-row">
                  <button type="button" class="tactical-opt-btn${this.config.doctorEnabled ? " active" : ""}" data-mafia-act="toggle-rule" data-key="doctorEnabled">🩺 الطبيب</button>
                  <button type="button" class="tactical-opt-btn${this.config.detectiveEnabled ? " active" : ""}" data-mafia-act="toggle-rule" data-key="detectiveEnabled">🔍 المحقق</button>
                  <button type="button" class="tactical-opt-btn${this.config.jesterEnabled && jesterAllowed ? " active" : ""}" data-mafia-act="toggle-rule" data-key="jesterEnabled" ${!jesterAllowed ? "disabled title='يُتاح عند 6 لاعبين فأكثر'" : ""}>🃏 المهرج (6+)</button>
                </div>
              </div>

              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">📜 قواعد اللعب والتحكم:</span>
                <div class="tactical-pills-row">
                  <button type="button" class="tactical-opt-btn${this.config.revealRoleOnDeath ? " active" : ""}" data-mafia-act="toggle-rule" data-key="revealRoleOnDeath">👁️ كشف الدور عند الإقصاء</button>
                  <button type="button" class="tactical-opt-btn${this.config.noConsecutiveProtect ? " active" : ""}" data-mafia-act="toggle-rule" data-key="noConsecutiveProtect">🩺 منع حماية نفس الشخص مرتين متتاليتين</button>
                  <button type="button" class="tactical-opt-btn${this.config.vipEnabled ? " active" : ""}" data-mafia-act="toggle-rule" data-key="vipEnabled">👑 تحكم اللاعب الأول (VIP)</button>
                </div>
              </div>

              <div class="mafia-cfg-card">
                <span class="mafia-cfg-label">⏱️ المؤقتات:</span>
                <div class="mafia-timers-row">
                  <div class="mafia-timer-group">
                    <small>🌙 الليل:</small>
                    ${[30, 45, 60].map((s) => `<button type="button" class="tactical-opt-btn${this.config.nightSeconds === s ? " active" : ""}" data-mafia-act="set-timer" data-field="nightSeconds" data-val="${s}">${s}ث</button>`).join("")}
                  </div>
                  <div class="mafia-timer-group">
                    <small>💬 النقاش:</small>
                    ${[90, 120, 180, 0].map((s) => `<button type="button" class="tactical-opt-btn${this.config.discussionSeconds === s ? " active" : ""}" data-mafia-act="set-timer" data-field="discussionSeconds" data-val="${s}">${s === 0 ? "معطّل" : `${s}ث`}</button>`).join("")}
                  </div>
                  <div class="mafia-timer-group">
                    <small>🗳️ التصويت:</small>
                    ${[45, 60].map((s) => `<button type="button" class="tactical-opt-btn${this.config.voteSeconds === s ? " active" : ""}" data-mafia-act="set-timer" data-field="voteSeconds" data-val="${s}">${s}ث</button>`).join("")}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div class="mafia-setup-footer">
            <button type="button" class="btn btn-primary btn-lg mafia-start-btn" data-mafia-act="start-game" ${!canStart ? "disabled" : ""}>
              🎭 بدء الجلسة وتوزيع الأدوار السرية (${count} لاعب)
            </button>
          </div>
        </div>
      `;
    }

    _renderRoleRevealHtml() {
      const ready = this._readyUids;
      return `
        <div class="mafia-stage mafia-center-stage">
          <div class="mafia-phase-pill">🔐 المرحلة 1: توزيع الأدوار السرية</div>
          <h2 class="mafia-big-title">تفقدوا هواتفكم لمعرفة أدواركم سراً!</h2>
          <p class="mafia-big-sub">اضغط مع الاستمرار على بطاقتك في هاتفك لكشف دورك، ثم اضغط «✅ فهمت دوري — جاهز».</p>
          <div class="mafia-progress-counter">${ready.size} / ${this.players.length} جاهزين</div>
          <div class="mafia-status-chips">
            ${this.players
              .map(
                (p) => `
              <div class="mafia-status-chip${ready.has(p.uid) ? " is-done" : ""}">
                <span>${ready.has(p.uid) ? "✅" : "⏳"}</span>
                <span>${escapeHtml(p.name)}</span>
              </div>
            `
              )
              .join("")}
          </div>
          <div class="mafia-host-actions">
            <button type="button" class="btn btn-primary btn-lg" data-mafia-act="start-night-1">
              🌙 بدء الليلة الأولى الآن
            </button>
          </div>
        </div>
      `;
    }

    _renderNightHtml() {
      const alive = this.players.filter((p) => p.alive);
      const doneCount = this._countCompletedNightActions();
      return `
        <div class="mafia-stage mafia-center-stage is-night-theme">
          <div class="mafia-moon-orb" aria-hidden="true">🌙</div>
          <div class="mafia-phase-pill is-night">🌙 الليلة رقم ${this.roundNumber}</div>
          <h2 class="mafia-big-title">الليلة رقم ${this.roundNumber} — أغمضوا أعينكم وانظروا لهواتفكم</h2>
          <p class="mafia-big-sub">الجميع يُرسل اختياره في وقت واحد للحفاظ على سرية الأدوار (التمويه الذكي).</p>
          <div id="mafia-live-timer" class="mafia-giant-timer${this.timer.remainingSeconds <= 10 ? " danger" : ""}">${formatTime(this.timer.remainingSeconds)}</div>
          <div class="mafia-progress-counter">🔒 ${doneCount} / ${alive.length} أكملوا إجراء الليل</div>
          <div class="mafia-host-actions">
            <button type="button" class="btn btn-secondary btn-md" data-mafia-act="resolve-night-now">
              ☀️ إنهاء الليل وإعلان الفجر الآن
            </button>
          </div>
        </div>
      `;
    }

    _renderDawnHtml() {
      const ds = this.dawnSummary || {};
      return `
        <div class="mafia-stage mafia-center-stage is-dawn-theme">
          <div class="mafia-phase-pill is-dawn">☀️ فجر اليوم رقم ${this.roundNumber}</div>
          <div class="mafia-dawn-hero${ds.saved ? " is-saved" : ds.eliminated ? " is-elim" : ""}">
            <div class="mafia-dawn-icon">${ds.saved ? "🩺✨" : ds.eliminated ? "💀" : "☀️"}</div>
            <h2 class="mafia-big-title">${escapeHtml(ds.headline || "أشرقت الشمس على المدينة!")}</h2>
            <p class="mafia-big-sub">${escapeHtml(ds.subtitle || "")}</p>
          </div>
          ${this._renderRosterOverviewHtml()}
          <div class="mafia-host-actions">
            <button type="button" class="btn btn-primary btn-lg" data-mafia-act="start-discussion">
              💬 بدء نقاش النهار
            </button>
            <button type="button" class="btn btn-gold-outline btn-md" data-mafia-act="start-voting">
              🗳️ فتح التصويت مباشرة
            </button>
          </div>
        </div>
      `;
    }

    _renderDiscussionHtml() {
      const isUnl = this.timer.status === "unlimited";
      return `
        <div class="mafia-stage mafia-center-stage is-day-theme">
          <div class="mafia-phase-pill is-day">💬 نقاش النهار — اليوم ${this.roundNumber}</div>
          <h2 class="mafia-big-title">من تشتبهون أنه من المافيا؟</h2>
          <div id="mafia-live-timer" class="mafia-giant-timer${!isUnl && this.timer.remainingSeconds <= 10 ? " danger" : ""}">${isUnl ? "∞" : formatTime(this.timer.remainingSeconds)}</div>
          ${this._renderRosterOverviewHtml()}
          <div class="mafia-host-actions">
            <button type="button" class="btn btn-primary btn-lg" data-mafia-act="start-voting">
              🗳️ الانتقال إلى التصويت السري
            </button>
          </div>
        </div>
      `;
    }

    _renderVotingHtml() {
      const alive = this.players.filter((p) => p.alive);
      const votedSet = new Set(this._getVotedAliveUids());
      return `
        <div class="mafia-stage mafia-center-stage is-day-theme">
          <div class="mafia-phase-pill is-vote">🗳️ تصويت النهار السري — اليوم ${this.roundNumber}</div>
          <h2 class="mafia-big-title">صوّتوا سراً من هواتفكم!</h2>
          <div id="mafia-live-timer" class="mafia-giant-timer${this.timer.remainingSeconds <= 10 ? " danger" : ""}">${formatTime(this.timer.remainingSeconds)}</div>
          <div class="mafia-progress-counter">${votedSet.size} / ${alive.length} صوّتوا</div>
          <div class="mafia-status-chips">
            ${alive
              .map(
                (p) => `
              <div class="mafia-status-chip${votedSet.has(p.uid) ? " is-done" : ""}">
                <span>${votedSet.has(p.uid) ? "✅" : "⏳"}</span>
                <span>${escapeHtml(p.name)}</span>
              </div>
            `
              )
              .join("")}
          </div>
          <div class="mafia-host-actions">
            <button type="button" class="btn btn-secondary btn-md" data-mafia-act="resolve-voting-now">
              📊 إغلاق التصويت وكشف النتيجة
            </button>
          </div>
        </div>
      `;
    }

    _renderVoteResultHtml() {
      const vr = this.voteResult || { tally: [], voteBreakdown: [], skipVotes: 0 };
      return `
        <div class="mafia-stage mafia-center-stage is-day-theme">
          <div class="mafia-phase-pill is-vote">📊 نتائج تصويت اليوم ${this.roundNumber}</div>
          <div class="mafia-dawn-hero${vr.eliminated ? " is-elim" : " is-saved"}">
            <h2 class="mafia-big-title">${escapeHtml(vr.headline || "")}</h2>
            <p class="mafia-big-sub">${escapeHtml(vr.subtitle || "")}</p>
          </div>

          <div class="mafia-votes-table">
            ${(vr.tally || [])
              .map(
                (t) => `
              <div class="mafia-tally-pill${vr.eliminated && vr.eliminated.uid === t.uid ? " is-hit" : ""}">
                <span>${escapeHtml(t.name)}</span>
                <strong>${t.votes} صوت</strong>
              </div>
            `
              )
              .join("")}
            <div class="mafia-tally-pill is-skip">
              <span>⏭️ تخطي التصويت</span>
              <strong>${vr.skipVotes || 0} صوت</strong>
            </div>
          </div>

          <div class="mafia-vote-breakdown-grid">
            ${(vr.voteBreakdown || [])
              .map(
                (v) => `
              <div class="mafia-vote-row">
                <strong>${escapeHtml(v.voterName)}</strong>
                <span>⬅️</span>
                <span class="${v.targetUid === "SKIP" ? "is-skip-text" : ""}">${escapeHtml(v.targetName)}</span>
              </div>
            `
              )
              .join("")}
          </div>

          <div class="mafia-host-actions">
            <button type="button" class="btn btn-primary btn-lg" data-mafia-act="next-night">
              🌙 الانتقال إلى الليلة رقم ${this.roundNumber + 1}
            </button>
          </div>
        </div>
      `;
    }

    _renderGameOverHtml() {
      const go = this.gameOverData || { players: [], timeline: [], highlights: {} };
      const themeClass =
        go.winnerFaction === "mafia" ? "is-mafia-win" : go.winnerFaction === "jester" ? "is-jester-win" : "is-citizens-win";
      return `
        <div class="mafia-stage mafia-gameover-stage ${themeClass}">
          <div class="mafia-gameover-hero">
            <div class="mafia-winner-icon">${go.winnerFaction === "mafia" ? "🕵️🏆" : go.winnerFaction === "jester" ? "🃏🏆" : "🏘️🏆"}</div>
            <h2 class="mafia-big-title">${escapeHtml(go.title || "انتهت الجولة!")}</h2>
            <p class="mafia-big-sub">${escapeHtml(go.subtitle || "")}</p>
            ${go.closingEventText ? `<div class="mafia-closing-event">${escapeHtml(go.closingEventText)}</div>` : ""}
          </div>

          <div class="mafia-reveal-grid">
            ${(go.players || [])
              .map(
                (p) => `
              <div class="mafia-reveal-card team-${escapeHtml(p.team)}${p.won ? " is-winner" : ""}">
                <div class="mafia-reveal-top">
                  <span class="mafia-reveal-role">${escapeHtml(p.roleIcon)} ${escapeHtml(p.roleLabel)}</span>
                  <span class="mafia-life-pill ${p.alive ? "is-alive" : "is-dead"}">${p.alive ? "🟢 نجا" : "💀 أُقصي"}</span>
                </div>
                <strong class="mafia-reveal-name">${escapeHtml(p.name)}</strong>
              </div>
            `
              )
              .join("")}
          </div>

          ${
            go.timeline && go.timeline.length > 0
              ? `
                <section class="bank-section mafia-timeline-box">
                  <h3 class="bank-section-title">📜 أبرز أحداث الجلسة</h3>
                  <div class="mafia-timeline-list">
                    ${go.timeline.map((ev) => `<div class="mafia-timeline-item"><span>${escapeHtml(ev.icon)}</span><span>${escapeHtml(ev.text)}</span></div>`).join("")}
                  </div>
                </section>
              `
              : ""
          }

          <div class="mafia-host-actions">
            <button type="button" class="btn btn-gold-outline btn-lg" data-mafia-act="result-card">
              📸 حفظ / مشاركة بطاقة النتيجة
            </button>
            <button type="button" class="btn btn-primary btn-lg" data-mafia-act="new-round">
              🔄 جولة جديدة (نفس الغرفة واللاعبين)
            </button>
            <button type="button" class="btn btn-secondary btn-md" data-mafia-act="exit-home">
              إنهاء والعودة للرئيسية
            </button>
          </div>
        </div>
      `;
    }

    _renderRosterOverviewHtml() {
      const alive = this.players.filter((p) => p.alive);
      const dead = this.players.filter((p) => !p.alive);
      return `
        <div class="mafia-roster-split">
          <div class="mafia-roster-col">
            <h4>🟢 الأحياء (${alive.length})</h4>
            <div class="mafia-status-chips">
              ${alive.map((p) => `<span class="mafia-status-chip is-alive-chip">👤 ${escapeHtml(p.name)}</span>`).join("")}
            </div>
          </div>
          ${
            dead.length > 0
              ? `
                <div class="mafia-roster-col is-dead-col">
                  <h4>💀 المُقصَون (${dead.length})</h4>
                  <div class="mafia-status-chips">
                    ${dead
                      .map(
                        (p) =>
                          `<span class="mafia-status-chip is-dead-chip">👻 ${escapeHtml(p.name)}${p.revealedRole ? ` (${escapeHtml(p.revealedRole.icon)} ${escapeHtml(p.revealedRole.label)})` : ""}</span>`
                      )
                      .join("")}
                  </div>
                </div>
              `
              : ""
          }
        </div>
      `;
    }
  }

  window.SeenJeemMafia = new MafiaController();
  window.SeenJeemMafiaEngine = {
    ROLE_META,
    getDefaultMafiaCount,
    getMaxAllowedMafia,
    assignRoles,
    evaluateWinCondition,
    resolveNightActions,
    resolveDayVotes
  };
})();
