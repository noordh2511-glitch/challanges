/**
 * محرك وواجهة لعبة «برا السالفة» (الوضع المحلي أوفلاين + الوضع اللاسلكي عبر Firebase + التلفزيون)
 * - آلة حالات من 8 مراحل: setup -> role_reveal -> questions -> discussion -> voting -> outsider_reveal -> outsider_guess -> round_results
 * - يدعم 3 إلى 12 لاعباً، و1 أو 2 «برا السالفة» (2 يُفعّل عند 6 لاعبين فأكثر)
 * - نقاط تراكمية (+100 للمصوّت الصحيح داخل السالفة، +100 للي برا السالفة عند تخمين الكلمة الصحيحة)
 * - عزل كامل عن لعبة «سين جيم» مع توحيد الهوية البصرية وAudio وConfetti وTV BroadcastChannel
 */
(function () {
  "use strict";

  const LAST_PLAYERS_KEY = "bara-salfa-last-players-v1";
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 12;

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

  function loadSavedLocalNames() {
    try {
      const raw = localStorage.getItem(LAST_PLAYERS_KEY);
      if (!raw) return ["أحمد", "سارة", "عمر", "ليان"];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length < MIN_PLAYERS) {
        return ["أحمد", "سارة", "عمر", "ليان"];
      }
      return parsed
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim().slice(0, 24))
        .slice(0, MAX_PLAYERS);
    } catch (_err) {
      return ["أحمد", "سارة", "عمر", "ليان"];
    }
  }

  function saveLocalNames(names) {
    try {
      localStorage.setItem(LAST_PLAYERS_KEY, JSON.stringify(names.slice(0, MAX_PLAYERS)));
    } catch (_err) {}
  }

  /**
   * توليد أزواج أسئلة عادلة بحيث يسأل كل لاعب مرة ويُسأل مرة دون أن يسأل نفسه
   */
  function generateQuestionPairs(players, previousPairs = []) {
    if (!Array.isArray(players) || players.length < 2) return [];
    const prevSet = new Set(previousPairs.map((p) => `${p.askerId}->${p.targetId}`));
    let bestOrder = shuffle(players);
    for (let attempt = 0; attempt < 12; attempt++) {
      const cand = shuffle(players);
      let overlaps = 0;
      for (let i = 0; i < cand.length; i++) {
        const next = cand[(i + 1) % cand.length];
        if (prevSet.has(`${cand[i].id}->${next.id}`)) overlaps++;
      }
      bestOrder = cand;
      if (overlaps === 0) break;
    }
    return bestOrder.map((asker, i) => {
      const target = bestOrder[(i + 1) % bestOrder.length];
      return {
        askerId: asker.id,
        askerName: asker.name,
        targetId: target.id,
        targetName: target.name
      };
    });
  }

  class BaraSalfaController {
    constructor() {
      this.modalEl = null;
      this.bodyEl = null;
      this.isOpenFlag = false;

      // إعدادات الجلسة
      this.playMode = "local"; // "local" | "wireless"
      this.selectedCategoryId = "random"; // "random" | categoryId
      this.outsiderCount = 1; // 1 | 2 (فقط عند >= 6 لاعبين)
      this.discussionSeconds = 90; // 0 | 60 | 90 | 120 | 180
      this.showQrOnTv = true;
      this.customPanelOpen = false;
      this.editingCustomId = "";
      this.customFeedback = "";

      // اللاعبون والنقاط التراكمية
      this.localNames = loadSavedLocalNames();
      this.scoresById = {}; // { playerId: number }
      this.players = []; // [{ id, name }]

      // حالة الوضع اللاسلكي
      this.wireless = {
        active: false,
        connected: false,
        roomCode: "",
        playerUrl: "",
        joinLocked: false,
        playersMap: {}, // { uid: { uid, name, online } }
        actionsMap: {}, // { uid: { readyRound, voteRound, voteTargetUid, guessRound, guessWord } }
        feedback: "",
        feedbackKind: "info"
      };

      // حالة الجولة الحالية (8 مراحل)
      this.phase = "setup"; // setup | role_reveal | questions | discussion | voting | outsider_reveal | outsider_guess | round_results
      this.roundNumber = 0;
      this.lastSecretWord = "";
      this.round = null;

      // مؤقت النقاش
      this._timerInterval = null;
      this.timerRemaining = 0;
      this.timerRunning = false;
      this.timerStatus = "idle"; // idle | running | paused | finished | unlimited
      this.timerEndAtMs = null;

      // مؤقتات ومرجع Hold-to-Reveal
      this._holdActive = false;
    }

    init() {
      this.modalEl = document.getElementById("bara-salfa-modal");
      this.bodyEl = document.getElementById("bara-salfa-body");
      const closeBtn = document.getElementById("btn-close-bara-salfa");
      const openTvBtn = document.getElementById("btn-bara-open-tv");

      if (closeBtn) {
        closeBtn.addEventListener("click", () => this.requestClose());
      }
      if (openTvBtn) {
        openTvBtn.addEventListener("click", () => {
          if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.openTVDisplayWindow === "function") {
            window.SeenJeemHostBridge.openTVDisplayWindow();
            setTimeout(() => this._syncTV(), 200);
          }
        });
      }

      // إنهاء الضغط المطوّل عند رفع الإصبع أو فقدان التركيز
      const endHold = () => this._setHoldReveal(false);
      window.addEventListener("pointerup", endHold);
      window.addEventListener("mouseup", endHold);
      window.addEventListener("touchend", endHold);
      window.addEventListener("blur", endHold);
    }

    isOpen() {
      return this.isOpenFlag;
    }

    open() {
      if (!this.modalEl) this.init();
      if (!this.modalEl) return;
      this.isOpenFlag = true;
      this.modalEl.classList.add("open");
      this.modalEl.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      this._render();
      this._syncTV();
    }

    requestClose() {
      if (this.phase !== "setup" || this.wireless.active) {
        if (this.wireless.active) {
          this.closeWirelessRoom();
        }
      }
      this.close();
    }

    close() {
      this._stopDiscussionTimer();
      this._setHoldReveal(false);
      this.isOpenFlag = false;
      if (this.modalEl) {
        this.modalEl.classList.remove("open");
        this.modalEl.setAttribute("aria-hidden", "true");
      }
      const anyOpen = document.querySelector(".modal-overlay.open");
      if (!anyOpen) document.body.style.overflow = "";
      this._syncTV();
    }

    _toast(msg, kind = "info") {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.showToast === "function") {
        window.SeenJeemHostBridge.showToast(msg, kind);
      }
    }

    _playSfx(method, ...args) {
      if (window.SeenJeemAudio && typeof window.SeenJeemAudio[method] === "function") {
        window.SeenJeemAudio[method](...args);
      }
    }

    _getServerNowMs() {
      const sync = window.SeenJeemBaraSalfaSync;
      return sync && typeof sync.getServerNowMs === "function" ? sync.getServerNowMs() : Date.now();
    }

    _getActivePlayersList() {
      if (this.playMode === "wireless") {
        return Object.values(this.wireless.playersMap || {})
          .filter((p) => p && p.uid && p.name)
          .sort((a, b) => (Number(a.joinedAt) || 0) - (Number(b.joinedAt) || 0))
          .slice(0, MAX_PLAYERS)
          .map((p) => ({ id: p.uid, name: String(p.name).trim() }));
      }
      return this.localNames
        .map((name, idx) => ({ id: `lp_${idx}`, name: name.trim() }))
        .filter((p) => p.name)
        .slice(0, MAX_PLAYERS);
    }

    _getStandingsList() {
      const list = this.players.length > 0 ? this.players : this._getActivePlayersList();
      return list
        .map((p) => ({
          id: p.id,
          name: p.name,
          score: Number(this.scoresById[p.id]) || 0
        }))
        .sort((a, b) => b.score - a.score);
    }

    /* =========================================================
       إدارة الغرفة اللاسلكية (/baraRooms/{roomCode})
       ========================================================= */
    async createWirelessRoom() {
      const sync = window.SeenJeemBaraSalfaSync;
      if (!sync) return;
      if (!sync.isConfigured()) {
        this.wireless.feedbackKind = "warning";
        this.wireless.feedback = "⚠️ يرجى ضبط إعدادات Firebase أولاً من زر «📡 الغرفة اللاسلكية» في الشاشة الرئيسية.";
        this._render();
        return;
      }
      this.wireless.feedbackKind = "info";
      this.wireless.feedback = "⏳ جاري إنشاء غرفة «برا السالفة» اللاسلكية وتوليد رمز QR...";
      this._render();

      try {
        const info = await sync.createRoom({
          initialPublicState: this._buildFirebasePublicState(),
          onPlayers: (map) => {
            this.wireless.playersMap = map && typeof map === "object" ? map : {};
            if (!this.wireless.joinLocked) {
              Object.keys(this.wireless.playersMap).forEach((uid) => sync.approvePlayerUid(uid));
            }
            if (this.phase === "setup") {
              this._syncWirelessAndTV();
            }
            this._render();
          },
          onPlayerActions: (map) => {
            this.wireless.actionsMap = map && typeof map === "object" ? map : {};
            this._handleIncomingWirelessActions();
          },
          onConnectionState: (isConn) => {
            this.wireless.connected = isConn;
            this._render();
          }
        });

        this.wireless.active = true;
        this.wireless.connected = true;
        this.wireless.roomCode = info.roomCode;
        this.wireless.playerUrl = info.playerUrl;
        this.wireless.joinLocked = false;
        this.wireless.playersMap = {};
        this.wireless.actionsMap = {};
        this.wireless.feedbackKind = "success";
        this.wireless.feedback = `✅ الغرفة ${info.roomCode} جاهزة — اطلب من اللاعبين مسح QR أو إدخال الرمز للانضمام.`;
        this._syncWirelessAndTV();
        this._render();
        this._toast(`📡 غرفة برا السالفة ${info.roomCode} جاهزة!`, "success");
      } catch (err) {
        this.wireless.feedbackKind = "error";
        this.wireless.feedback = `❌ ${(err && err.message) || "تعذّر إنشاء الغرفة اللاسلكية."}`;
        this._render();
      }
    }

    async closeWirelessRoom() {
      const sync = window.SeenJeemBaraSalfaSync;
      if (sync) await sync.closeRoom();
      this.wireless.active = false;
      this.wireless.connected = false;
      this.wireless.roomCode = "";
      this.wireless.playerUrl = "";
      this.wireless.joinLocked = false;
      this.wireless.playersMap = {};
      this.wireless.actionsMap = {};
      this.wireless.feedback = "تم إغلاق وحذف الغرفة اللاسلكية بنجاح.";
      this.wireless.feedbackKind = "info";
      if (this.playMode === "wireless" && this.phase !== "setup") {
        this.phase = "setup";
        this.round = null;
        this._stopDiscussionTimer();
      }
      this._syncTV();
      this._render();
      this._toast("🔴 تم إغلاق وحذف غرفة برا السالفة", "info");
    }

    async toggleWirelessLock() {
      if (!this.wireless.active || !window.SeenJeemBaraSalfaSync) return;
      this.wireless.joinLocked = !this.wireless.joinLocked;
      await window.SeenJeemBaraSalfaSync.setJoinLocked(this.wireless.joinLocked);
      this._syncWirelessAndTV();
      this._render();
      this._toast(
        this.wireless.joinLocked ? "🔒 تم قفل الانضمام للغرفة" : "🔓 تم فتح الانضمام للغرفة",
        "info"
      );
    }

    async kickWirelessPlayer(uid) {
      if (!this.wireless.active || !window.SeenJeemBaraSalfaSync || !uid) return;
      const pName =
        (this.wireless.playersMap[uid] && this.wireless.playersMap[uid].name) || "اللاعب";
      const res = await window.SeenJeemBaraSalfaSync.kickPlayer(uid);
      if (res && res.ok) {
        delete this.wireless.playersMap[uid];
        delete this.wireless.actionsMap[uid];
        this._syncWirelessAndTV();
        this._render();
        this._toast(`🚫 تم طرد «${pName}» من الغرفة`, "warning");
      }
    }

    _handleIncomingWirelessActions() {
      if (this.playMode !== "wireless" || !this.round) return;
      const r = this.round;
      const actions = this.wireless.actionsMap || {};

      if (this.phase === "role_reveal") {
        r.readyIds = this.players
          .filter((p) => actions[p.id] && Number(actions[p.id].readyRound) === this.roundNumber)
          .map((p) => p.id);
        this._syncWirelessAndTV();
        this._render();
      } else if (this.phase === "voting") {
        this.players.forEach((p) => {
          const act = actions[p.id];
          if (act && Number(act.voteRound) === this.roundNumber && act.voteTargetUid && act.voteTargetUid !== p.id) {
            if (this.players.some((t) => t.id === act.voteTargetUid)) {
              r.votes[p.id] = act.voteTargetUid;
            }
          }
        });
        this._syncWirelessAndTV();
        this._render();
      } else if (this.phase === "outsider_guess") {
        r.outsiderIds.forEach((oid) => {
          const act = actions[oid];
          if (act && Number(act.guessRound) === this.roundNumber && typeof act.guessWord === "string" && act.guessWord) {
            r.outsiderGuesses[oid] = act.guessWord;
          }
        });
        const allGuessed = r.outsiderIds.every((oid) => Boolean(r.outsiderGuesses[oid]));
        if (allGuessed && r.outsiderIds.length > 0) {
          this.finalizeRoundResults();
          return;
        }
        this._syncWirelessAndTV();
        this._render();
      }
    }

    /* =========================================================
       بناء الحزم المنقّاة (Firebase publicState + TV displayView)
       ========================================================= */
    _buildDiscussionTimerDescriptor() {
      if (this.discussionSeconds === 0) {
        return { status: "unlimited", durationMs: 0, endAtMs: null, remainingMs: 0 };
      }
      return {
        status: this.timerStatus,
        durationMs: this.discussionSeconds * 1000,
        endAtMs: this.timerStatus === "running" ? this.timerEndAtMs : null,
        remainingMs: Math.max(0, this.timerRemaining) * 1000
      };
    }

    _buildFirebasePublicState() {
      const r = this.round;
      const roster = (this.phase === "setup" ? this._getActivePlayersList() : this.players).map((p) => ({
        id: p.id,
        name: p.name,
        score: Number(this.scoresById[p.id]) || 0
      }));

      const allowOutsiderReveal =
        this.phase === "outsider_reveal" || this.phase === "outsider_guess" || this.phase === "round_results";
      const allowChoices = this.phase === "outsider_guess" || this.phase === "round_results";
      const allowSecretWord = this.phase === "round_results";

      const currentPair =
        r && r.pairs && r.pairs[r.pairIndex] ? r.pairs[r.pairIndex] : null;

      return {
        phase: this.phase,
        roundNumber: this.roundNumber,
        joinLocked: Boolean(this.wireless.joinLocked),
        categoryName: r ? r.category.name : "",
        categoryIcon: r ? r.category.icon : "🕵️",
        outsiderCount: r ? r.outsiderIds.length : this.outsiderCount,
        playersRoster: roster,
        readyIds: r && this.phase === "role_reveal" ? (r.readyIds || []).slice() : [],
        votedIds: r && this.phase === "voting" ? Object.keys(r.votes || {}) : [],
        currentPair: this.phase === "questions" ? currentPair : null,
        pairIndex: r ? r.pairIndex : 0,
        totalPairs: r && r.pairs ? r.pairs.length : 0,
        questionCycle: r ? r.questionCycle : 1,
        timer: this.phase === "discussion" ? this._buildDiscussionTimerDescriptor() : null,
        // بروتوكول منع التسريب الصارم: الخيارات في مرحلة التخمين فقط، والكلمة السرية في النتائج فقط
        guessChoices: allowChoices && r ? r.guessChoices.slice() : null,
        outsiderGuessedIds: this.phase === "outsider_guess" && r ? Object.keys(r.outsiderGuesses || {}) : [],
        revealData: allowOutsiderReveal && r
          ? {
              outsiderIds: r.outsiderIds.slice(),
              outsiderNames: r.outsiderIds.map((id) => this._findPlayerName(id)),
              voteBreakdown: r.voteBreakdown || [],
              topVotedIds: r.topVotedIds || [],
              secretWord: allowSecretWord ? r.secretWord : null,
              outsiderGuesses: allowSecretWord ? { ...r.outsiderGuesses } : null,
              roundScores: allowSecretWord ? r.roundScores || [] : null,
              standings: allowSecretWord ? this._getStandingsList() : null
            }
          : null
      };
    }

    buildSanitizedDisplayPayload() {
      const base = this._buildFirebasePublicState();
      const r = this.round;
      return {
        ...base,
        playMode: this.playMode,
        roomCode: this.wireless.active ? this.wireless.roomCode : "",
        playerUrl: this.wireless.active ? this.wireless.playerUrl : "",
        showQrOnTv: Boolean(this.wireless.active && this.showQrOnTv),
        localRevealPlayerName:
          this.playMode === "local" && this.phase === "role_reveal" && r && this.players[r.revealIdx]
            ? this.players[r.revealIdx].name
            : "",
        localRevealIndex: r ? r.revealIdx : 0,
        localVoterName:
          this.playMode === "local" && this.phase === "voting" && r && this.players[r.voteIdx]
            ? this.players[r.voteIdx].name
            : "",
        localVoterIndex: r ? r.voteIdx : 0,
        discussionRemainingSeconds: this.timerRemaining,
        discussionTotalSeconds: this.discussionSeconds,
        discussionTimerRunning: this.timerRunning
      };
    }

    _syncTV() {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.broadcastTV === "function") {
        window.SeenJeemHostBridge.broadcastTV();
      }
    }

    _syncWirelessAndTV({ skipWireless = false } = {}) {
      this._syncTV();
      if (!skipWireless && this.playMode === "wireless" && this.wireless.active && window.SeenJeemBaraSalfaSync) {
        window.SeenJeemBaraSalfaSync.publishPublicState(this._buildFirebasePublicState());
      }
    }

    _findPlayerName(id) {
      const p = this.players.find((x) => x.id === id);
      return p ? p.name : "لاعب";
    }

    /* =========================================================
       بدء جولة جديدة والانتقال بين المراحل الثماني
       ========================================================= */
    async startRound() {
      const bank = window.SeenJeemBaraSalfaBank;
      if (!bank) return;

      const activePlayers = this._getActivePlayersList();
      if (activePlayers.length < MIN_PLAYERS) {
        this._toast(`يلزم وجود ${MIN_PLAYERS} لاعبين على الأقل لبدء اللعبة`, "warning");
        return;
      }

      // تصفير أي أسماء فارغة وحفظ الأسماء المحلية
      if (this.playMode === "local") {
        saveLocalNames(activePlayers.map((p) => p.name));
      }

      this.players = activePlayers;
      this.players.forEach((p) => {
        if (this.scoresById[p.id] === undefined) this.scoresById[p.id] = 0;
      });

      const effectiveOutsiders = this.players.length >= 6 && this.outsiderCount === 2 ? 2 : 1;
      this.outsiderCount = effectiveOutsiders;

      let catId = this.selectedCategoryId;
      if (catId === "random") {
        const randCat = bank.pickRandomCategory();
        if (!randCat) {
          this._toast("لا توجد فئات صالحة في بنك الكلمات!", "warning");
          return;
        }
        catId = randCat.id;
      }

      const drawn = bank.drawWordAndChoices(catId, { excludeWord: this.lastSecretWord });
      if (!drawn) {
        this._toast("تعذّر سحب كلمة من الفئة المختارة (تأكد من وجود 8 كلمات على الأقل).", "warning");
        return;
      }

      this.roundNumber += 1;
      this.lastSecretWord = drawn.secretWord;
      const shuffledIds = shuffle(this.players.map((p) => p.id));
      const outsiderIds = shuffledIds.slice(0, effectiveOutsiders);
      const pairs = generateQuestionPairs(this.players);

      this.round = {
        category: drawn.category,
        secretWord: drawn.secretWord,
        guessChoices: drawn.guessChoices,
        outsiderIds,
        pairs,
        pairIndex: 0,
        questionCycle: 1,
        // مرحلة كشف الأدوار
        revealIdx: 0,
        peekedCurrent: false,
        readyIds: [],
        // مرحلة التصويت
        voteIdx: 0,
        voterReadyToPick: false,
        votes: {}, // { voterId: targetId }
        voteBreakdown: [],
        topVotedIds: [],
        // مرحلة تخمين اللي برا السالفة
        guessOutsiderIdx: 0,
        outsiderGuesses: {}, // { outsiderId: word }
        roundScores: []
      };

      this._stopDiscussionTimer();
      this.timerRemaining = this.discussionSeconds;
      this.timerRunning = false;
      this.timerStatus = this.discussionSeconds === 0 ? "unlimited" : "idle";
      this.timerEndAtMs = null;

      this.phase = "role_reveal";
      this._setHoldReveal(false);
      this._playSfx("playTileOpen");

      if (this.playMode === "wireless" && this.wireless.active && window.SeenJeemBaraSalfaSync) {
        this.wireless.actionsMap = {};
        const rolesByUid = {};
        this.players.forEach((p) => {
          const isOutsider = outsiderIds.includes(p.id);
          rolesByUid[p.id] = {
            roundNumber: this.roundNumber,
            isOutsider,
            categoryName: drawn.category.name,
            categoryIcon: drawn.category.icon,
            secretWord: isOutsider ? null : drawn.secretWord
          };
        });
        await window.SeenJeemBaraSalfaSync.publishPrivateRolesAndResetActions(rolesByUid);
      }

      this._syncWirelessAndTV();
      this._render();
    }

    _setHoldReveal(active) {
      this._holdActive = Boolean(active);
      const card = document.getElementById("bs-local-secret-card");
      const btn = document.getElementById("bs-btn-hold-reveal");
      if (card) card.classList.toggle("is-revealed", this._holdActive);
      if (btn) btn.classList.toggle("is-holding", this._holdActive);
      if (this._holdActive && this.round && !this.round.peekedCurrent) {
        this.round.peekedCurrent = true;
        const nextBtn = document.getElementById("bs-btn-next-reveal");
        if (nextBtn) nextBtn.disabled = false;
      }
    }

    advanceLocalRoleReveal() {
      if (!this.round) return;
      this._setHoldReveal(false);
      this.round.revealIdx += 1;
      this.round.peekedCurrent = false;
      this._playSfx("playTileOpen");
      if (this.round.revealIdx >= this.players.length) {
        this.enterQuestionsPhase();
      } else {
        this._syncWirelessAndTV();
        this._render();
      }
    }

    enterQuestionsPhase() {
      if (!this.round) return;
      this.phase = "questions";
      this.round.pairIndex = 0;
      this._playSfx("playReveal");
      this._syncWirelessAndTV();
      this._render();
    }

    stepQuestionPair(delta) {
      if (!this.round) return;
      const next = this.round.pairIndex + delta;
      if (next < 0) return;
      if (next >= this.round.pairs.length) {
        this.enterDiscussionPhase();
        return;
      }
      this.round.pairIndex = next;
      this._playSfx("playTileOpen");
      this._syncWirelessAndTV();
      this._render();
    }

    startSecondQuestionCycle() {
      if (!this.round) return;
      const extraPairs = generateQuestionPairs(this.players, this.round.pairs);
      this.round.pairs = extraPairs;
      this.round.pairIndex = 0;
      this.round.questionCycle += 1;
      this._playSfx("playLifeline");
      this._syncWirelessAndTV();
      this._render();
    }

    /* =========================================================
       مرحلة النقاش ومؤقت النقاش بالطوابع الزمنية
       ========================================================= */
    _stopDiscussionTimer() {
      if (this._timerInterval) {
        clearInterval(this._timerInterval);
        this._timerInterval = null;
      }
    }

    enterDiscussionPhase() {
      if (!this.round) return;
      this.phase = "discussion";
      this._stopDiscussionTimer();
      this.timerRemaining = this.discussionSeconds;
      if (this.discussionSeconds > 0) {
        this.timerRunning = true;
        this.timerStatus = "running";
        this.timerEndAtMs = this._getServerNowMs() + this.timerRemaining * 1000;
        this._startDiscussionInterval();
      } else {
        this.timerRunning = false;
        this.timerStatus = "unlimited";
        this.timerEndAtMs = null;
      }
      this._playSfx("playReveal");
      this._syncWirelessAndTV();
      this._render();
    }

    _startDiscussionInterval() {
      this._stopDiscussionTimer();
      this._timerInterval = setInterval(() => {
        if (!this.timerRunning || this.phase !== "discussion") {
          this._stopDiscussionTimer();
          return;
        }
        this.timerRemaining = Math.max(0, this.timerRemaining - 1);
        if (this.timerRemaining > 0 && this.timerRemaining <= 10) {
          this._playSfx("playTick", this.timerRemaining <= 5);
        }
        const el = document.getElementById("bs-disc-timer-num");
        if (el) {
          el.textContent = formatTime(this.timerRemaining);
          el.classList.toggle("danger", this.timerRemaining <= 10);
        }
        if (this.timerRemaining === 0) {
          this._stopDiscussionTimer();
          this.timerRunning = false;
          this.timerStatus = "finished";
          this.timerEndAtMs = null;
          this._playSfx("playTimeUp");
          this._syncWirelessAndTV({ skipWireless: false });
          this._render();
        } else {
          // تحديث التلفزيون المحلي فقط دون كتابة كل ثانية إلى Firebase
          this._syncWirelessAndTV({ skipWireless: true });
        }
      }, 1000);
    }

    toggleDiscussionTimer() {
      if (this.phase !== "discussion" || this.discussionSeconds === 0) return;
      if (this.timerRunning) {
        this._stopDiscussionTimer();
        this.timerRunning = false;
        this.timerStatus = "paused";
        this.timerEndAtMs = null;
      } else if (this.timerRemaining > 0) {
        this.timerRunning = true;
        this.timerStatus = "running";
        this.timerEndAtMs = this._getServerNowMs() + this.timerRemaining * 1000;
        this._startDiscussionInterval();
      }
      this._syncWirelessAndTV();
      this._render();
    }

    resetDiscussionTimer() {
      if (this.phase !== "discussion" || this.discussionSeconds === 0) return;
      this._stopDiscussionTimer();
      this.timerRemaining = this.discussionSeconds;
      this.timerRunning = false;
      this.timerStatus = "idle";
      this.timerEndAtMs = null;
      this._syncWirelessAndTV();
      this._render();
    }

    /* =========================================================
       مرحلة التصويت السري -> كشف اللي برا السالفة -> تخمين الكلمة -> النتائج
       ========================================================= */
    enterVotingPhase() {
      if (!this.round) return;
      this._stopDiscussionTimer();
      this.timerRunning = false;
      this.phase = "voting";
      this.round.voteIdx = 0;
      this.round.voterReadyToPick = false;
      this.round.votes = {};
      this._playSfx("playTileOpen");
      this._syncWirelessAndTV();
      this._render();
    }

    recordLocalVote(targetId) {
      if (!this.round || this.phase !== "voting") return;
      const voter = this.players[this.round.voteIdx];
      if (!voter || !targetId || targetId === voter.id) return;
      this.round.votes[voter.id] = targetId;
      this.round.voteIdx += 1;
      this.round.voterReadyToPick = false;
      this._playSfx("playTileOpen");
      if (this.round.voteIdx >= this.players.length) {
        this.enterOutsiderRevealPhase();
      } else {
        this._syncWirelessAndTV();
        this._render();
      }
    }

    enterOutsiderRevealPhase() {
      if (!this.round) return;
      const r = this.round;
      const counts = {};
      r.voteBreakdown = this.players.map((voter) => {
        const targetId = r.votes[voter.id] || null;
        if (targetId) counts[targetId] = (counts[targetId] || 0) + 1;
        return {
          voterId: voter.id,
          voterName: voter.name,
          targetId,
          targetName: targetId ? this._findPlayerName(targetId) : "لم يصوّت"
        };
      });

      const maxVotes = Object.values(counts).reduce((m, c) => Math.max(m, c), 0);
      r.topVotedIds = maxVotes > 0 ? Object.keys(counts).filter((id) => counts[id] === maxVotes) : [];
      r.voteCounts = counts;

      this.phase = "outsider_reveal";
      this._playSfx("playDrumroll");
      this._syncWirelessAndTV();
      this._render();
    }

    enterOutsiderGuessPhase() {
      if (!this.round) return;
      this.phase = "outsider_guess";
      this.round.guessOutsiderIdx = 0;
      this.round.outsiderGuesses = {};
      this._playSfx("playReveal");
      this._syncWirelessAndTV();
      this._render();
    }

    recordLocalOutsiderGuess(word) {
      if (!this.round || this.phase !== "outsider_guess" || !word) return;
      const oid = this.round.outsiderIds[this.round.guessOutsiderIdx];
      if (!oid) return;
      this.round.outsiderGuesses[oid] = word;
      this.round.guessOutsiderIdx += 1;
      this._playSfx("playTileOpen");
      if (this.round.guessOutsiderIdx >= this.round.outsiderIds.length) {
        this.finalizeRoundResults();
      } else {
        this._syncWirelessAndTV();
        this._render();
      }
    }

    finalizeRoundResults() {
      if (!this.round) return;
      const r = this.round;
      const outsiderSet = new Set(r.outsiderIds);

      r.roundScores = this.players.map((p) => {
        const isOutsider = outsiderSet.has(p.id);
        let delta = 0;
        let reason = "";
        if (isOutsider) {
          const guessed = r.outsiderGuesses[p.id] || "";
          if (guessed === r.secretWord) {
            delta = 100;
            reason = `خمّن الكلمة الصحيحة («${r.secretWord}»)`;
          } else {
            reason = guessed ? `اختار «${guessed}» (خطأ)` : "لم يخمن الكلمة";
          }
        } else {
          const votedId = r.votes[p.id] || "";
          if (votedId && outsiderSet.has(votedId)) {
            delta = 100;
            reason = `كشف «${this._findPlayerName(votedId)}»`;
          } else {
            reason = votedId ? `صوّت على «${this._findPlayerName(votedId)}»` : "لم يصوّت";
          }
        }
        this.scoresById[p.id] = (Number(this.scoresById[p.id]) || 0) + delta;
        return {
          id: p.id,
          name: p.name,
          isOutsider,
          delta,
          totalScore: this.scoresById[p.id],
          reason
        };
      });

      this.phase = "round_results";
      this._playSfx("playVictory");
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.triggerConfetti === "function") {
        window.SeenJeemHostBridge.triggerConfetti("victory", "default");
      }
      this._syncWirelessAndTV();
      this._render();
    }

    returnToCategorySelect() {
      this._stopDiscussionTimer();
      this.phase = "setup";
      this.round = null;
      this._syncWirelessAndTV();
      this._render();
    }

    /* =========================================================
       رسم الواجهة الكاملة لجميع المراحل الـ 8
       ========================================================= */
    _render() {
      if (!this.bodyEl) return;

      if (this.phase === "setup") {
        this.bodyEl.innerHTML = this._renderSetupHtml();
        this._bindSetupEvents();
      } else if (this.phase === "role_reveal") {
        this.bodyEl.innerHTML = this._renderRoleRevealHtml();
        this._bindRoleRevealEvents();
      } else if (this.phase === "questions") {
        this.bodyEl.innerHTML = this._renderQuestionsHtml();
        this._bindQuestionsEvents();
      } else if (this.phase === "discussion") {
        this.bodyEl.innerHTML = this._renderDiscussionHtml();
        this._bindDiscussionEvents();
      } else if (this.phase === "voting") {
        this.bodyEl.innerHTML = this._renderVotingHtml();
        this._bindVotingEvents();
      } else if (this.phase === "outsider_reveal") {
        this.bodyEl.innerHTML = this._renderOutsiderRevealHtml();
        this._bindOutsiderRevealEvents();
      } else if (this.phase === "outsider_guess") {
        this.bodyEl.innerHTML = this._renderOutsiderGuessHtml();
        this._bindOutsiderGuessEvents();
      } else if (this.phase === "round_results") {
        this.bodyEl.innerHTML = this._renderResultsHtml();
        this._bindResultsEvents();
      }
    }

    _renderSetupHtml() {
      const bank = window.SeenJeemBaraSalfaBank;
      const categories = bank ? bank.getAllCategories() : [];
      const activePlayers = this._getActivePlayersList();
      const canHaveTwoOutsiders = activePlayers.length >= 6;
      if (!canHaveTwoOutsiders && this.outsiderCount === 2) this.outsiderCount = 1;

      const customCats = bank ? bank.loadCustomCategories() : [];
      const editingCat = this.editingCustomId ? customCats.find((c) => c.id === this.editingCustomId) : null;

      const catsHtml = `
        <button type="button" class="bs-cat-chip${this.selectedCategoryId === "random" ? " active" : ""}" data-bs-cat="random">
          <span class="bs-cat-ico">🎲</span>
          <span class="bs-cat-name">فئة عشوائية</span>
          <span class="bs-cat-meta">${categories.length} فئة متاحة</span>
        </button>
        ${categories
          .map((c) => {
            const st = bank.getCategoryStats(c.id);
            return `
              <button type="button" class="bs-cat-chip${this.selectedCategoryId === c.id ? " active" : ""}" data-bs-cat="${escapeHtml(c.id)}">
                <span class="bs-cat-ico">${escapeHtml(c.icon)}</span>
                <span class="bs-cat-name">${escapeHtml(c.name)}</span>
                <span class="bs-cat-meta">${st.remaining}/${st.total} جديد</span>
              </button>
            `;
          })
          .join("")}
      `;

      const localPlayersHtml = `
        <div class="bs-section">
          <div class="bs-sec-head">
            <h3>👥 اللاعبون (${this.localNames.length} / ${MAX_PLAYERS})</h3>
            <span class="bs-hint">من 3 إلى 12 لاعباً — تُحفظ الأسماء تلقائياً</span>
          </div>
          <div class="bs-add-player-row">
            <input type="text" id="bs-new-player-input" class="text-input" maxlength="24" placeholder="اكتب اسم لاعب واضغط Enter أو إضافة..." autocomplete="off" />
            <button type="button" id="bs-btn-add-player" class="btn btn-primary btn-sm" ${this.localNames.length >= MAX_PLAYERS ? "disabled" : ""}>+ إضافة</button>
          </div>
          <div class="bs-players-chips">
            ${this.localNames
              .map(
                (name, idx) => `
              <span class="bs-player-chip">
                <span>${idx + 1}. ${escapeHtml(name)}</span>
                ${
                  this.localNames.length > MIN_PLAYERS
                    ? `<button type="button" class="bs-chip-del" data-bs-del-player="${idx}" aria-label="حذف ${escapeHtml(name)}">✕</button>`
                    : ""
                }
              </span>
            `
              )
              .join("")}
          </div>
        </div>
      `;

      const wl = this.wireless;
      const wlPlayers = this._getActivePlayersList();
      const qrSvg =
        wl.active && wl.playerUrl && window.SeenJeemQR
          ? window.SeenJeemQR.toSVG(wl.playerUrl, { size: 176, margin: 3, ariaLabel: `QR غرفة برا السالفة ${wl.roomCode}` })
          : "";

      const wirelessLobbyHtml = `
        <div class="bs-section bs-wireless-lobby">
          <div class="bs-sec-head">
            <h3>📡 غرفة «برا السالفة» اللاسلكية</h3>
            <span class="dual-status-pill ${wl.active && wl.connected ? "is-connected" : "is-single"}">
              ${!wl.active ? "⚪ غير مفتوحة" : wl.connected ? `🟢 متصلة (${wl.roomCode})` : "🟡 يعيد الاتصال..."}
            </span>
          </div>
          ${
            wl.feedback
              ? `<div class="wireless-feedback-box is-${escapeHtml(wl.feedbackKind)}">${escapeHtml(wl.feedback)}</div>`
              : ""
          }
          ${
            !wl.active
              ? `<div class="bs-wl-init-row">
                  <button type="button" id="bs-btn-create-room" class="btn btn-primary btn-sm">📡 فتح غرفة لاسلكية الآن</button>
                  <span class="bs-hint">يمسح اللاعبون رمز QR بهواتفهم لتلقّي أدوارهم السرية والتصويت مباشرة.</span>
                </div>`
              : `
                <div class="bs-wl-active-grid">
                  <div class="bs-wl-qr-col">
                    <div class="wireless-qr-svg-wrap">${qrSvg}</div>
                    <div class="wireless-player-code-display">رمز الغرفة: <strong>${escapeHtml(wl.roomCode)}</strong></div>
                    <div class="wireless-qr-actions">
                      <button type="button" id="bs-btn-copy-url" class="btn btn-ghost btn-xxs">📋 نسخ الرابط</button>
                      <a href="${escapeHtml(wl.playerUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-xxs">↗️ فتح شاشة لاعب</a>
                    </div>
                  </div>
                  <div class="bs-wl-players-col">
                    <div class="bs-wl-guard-row">
                      <button type="button" id="bs-btn-toggle-lock" class="btn ${wl.joinLocked ? "btn-amber" : "btn-secondary"} btn-xs">
                        ${wl.joinLocked ? "🔒 مقفلة (افتح)" : "🔓 قفل الانضمام"}
                      </button>
                      <button type="button" id="bs-btn-toggle-tv-qr" class="btn btn-gold-outline btn-xs">
                        ${this.showQrOnTv ? "🙈 إخفاء QR من التلفزيون" : "📺 إظهار QR على التلفزيون"}
                      </button>
                      <button type="button" id="bs-btn-close-room" class="btn btn-danger-outline btn-xs">🔴 إغلاق وحذف الغرفة الآن</button>
                    </div>
                    <div class="bs-wl-roster-head">اللاعبون المنضمّون (${wlPlayers.length} / ${MAX_PLAYERS}):</div>
                    <div class="bs-wl-roster-list">
                      ${
                        wlPlayers.length === 0
                          ? `<div class="wireless-device-empty">بانتظار انضمام اللاعبين عبر مسح QR أو إدخال رمز الغرفة...</div>`
                          : wlPlayers
                              .map(
                                (p) => `
                              <div class="wireless-device-row">
                                <div class="wireless-device-meta">
                                  <span class="wireless-device-online-dot"></span>
                                  <strong>${escapeHtml(p.name)}</strong>
                                  <span class="bs-mini-score">${Number(this.scoresById[p.id]) || 0} نقطة</span>
                                </div>
                                <button type="button" class="btn btn-danger-outline btn-xxs" data-bs-kick="${escapeHtml(p.id)}">🚫 طرد</button>
                              </div>
                            `
                              )
                              .join("")
                      }
                    </div>
                  </div>
                </div>
              `
          }
        </div>
      `;

      const customPanelHtml = this.customPanelOpen
        ? `
          <div class="bs-custom-panel">
            <div class="bs-sec-head">
              <h4>✨ إدارة الفئات الخاصة (بحد أدنى 8 كلمات لكل فئة)</h4>
              <button type="button" id="bs-btn-close-custom" class="btn btn-ghost btn-xxs">✕ إغلاق</button>
            </div>
            <div class="bs-custom-form-row">
              <input type="text" id="bs-custom-icon" class="text-input bs-icon-input" maxlength="6" value="${escapeHtml(editingCat ? editingCat.icon : "✨")}" placeholder="✨" aria-label="أيقونة الفئة" />
              <input type="text" id="bs-custom-name" class="text-input" maxlength="40" value="${escapeHtml(editingCat ? editingCat.name : "")}" placeholder="اسم الفئة الخاصة (مثال: شلّة الجامعة)" />
            </div>
            <textarea id="bs-custom-words" class="text-input bs-words-textarea" rows="5" placeholder="اكتب كل كلمة في سطر منفصل (8 كلمات على الأقل)...">${escapeHtml(editingCat ? editingCat.words.join("\n") : "")}</textarea>
            ${this.customFeedback ? `<div class="bs-custom-feedback">${escapeHtml(this.customFeedback)}</div>` : ""}
            <div class="bs-custom-actions">
              <button type="button" id="bs-btn-save-custom" class="btn btn-primary btn-xs">${editingCat ? "💾 حفظ التعديلات" : "➕ حفظ الفئة الخاصة"}</button>
              ${editingCat ? `<button type="button" id="bs-btn-cancel-edit-custom" class="btn btn-ghost btn-xs">إلغاء التعديل</button>` : ""}
            </div>
            ${
              customCats.length > 0
                ? `<div class="bs-custom-list">
                    ${customCats
                      .map(
                        (c) => `
                      <div class="bs-custom-item">
                        <span>${escapeHtml(c.icon)} <strong>${escapeHtml(c.name)}</strong> (${c.words.length} كلمة)</span>
                        <div class="bs-custom-item-btns">
                          <button type="button" class="btn btn-secondary btn-xxs" data-bs-edit-custom="${escapeHtml(c.id)}">✏️ تعديل</button>
                          <button type="button" class="btn btn-danger-outline btn-xxs" data-bs-del-custom="${escapeHtml(c.id)}">🗑️ حذف</button>
                        </div>
                      </div>
                    `
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>
        `
        : "";

      const canStart = activePlayers.length >= MIN_PLAYERS && (this.playMode === "local" || this.wireless.active);

      return `
        <div class="bs-setup-wrap">
          <!-- التبديل بين الوضع المحلي والوضع اللاسلكي -->
          <div class="bs-mode-switch" role="tablist" aria-label="وضع لعب برا السالفة">
            <button type="button" class="bs-mode-tab${this.playMode === "local" ? " active" : ""}" data-bs-mode="local">
              📱 جهاز واحد (أوفلاين)
            </button>
            <button type="button" class="bs-mode-tab${this.playMode === "wireless" ? " active" : ""}" data-bs-mode="wireless">
              📡 لاسلكي بهواتف اللاعبين (Firebase)
            </button>
          </div>

          ${this.playMode === "local" ? localPlayersHtml : wirelessLobbyHtml}

          <!-- إعدادات الجولة -->
          <div class="bs-section bs-options-grid">
            <div class="bs-opt-block">
              <span class="bs-opt-label">🕵️ عدد اللي «برا السالفة»:</span>
              <div class="bs-pills-row">
                <button type="button" class="tactical-opt-btn${this.outsiderCount === 1 ? " active" : ""}" data-bs-outsiders="1">1 برا السالفة</button>
                <button type="button" class="tactical-opt-btn${this.outsiderCount === 2 ? " active" : ""}" data-bs-outsiders="2" ${!canHaveTwoOutsiders ? "disabled title='يتطلب 6 لاعبين فأكثر'" : ""}>
                  2 برا السالفة ${!canHaveTwoOutsiders ? "(6+ لاعبين)" : ""}
                </button>
              </div>
            </div>

            <div class="bs-opt-block">
              <span class="bs-opt-label">⏱️ مؤقت النقاش الاختياري:</span>
              <div class="bs-pills-row">
                ${[
                  { v: 0, l: "معطّل" },
                  { v: 60, l: "60ث" },
                  { v: 90, l: "90ث" },
                  { v: 120, l: "120ث" },
                  { v: 180, l: "180ث" }
                ]
                  .map(
                    (o) =>
                      `<button type="button" class="tactical-opt-btn${this.discussionSeconds === o.v ? " active" : ""}" data-bs-timer="${o.v}">${o.l}</button>`
                  )
                  .join("")}
              </div>
            </div>
          </div>

          <!-- اختيار الفئة + إدارة الفئات الخاصة وتصفير السجل -->
          <div class="bs-section">
            <div class="bs-sec-head">
              <h3>🎯 اختر الفئة (12 فئة مدمجة + فئاتك الخاصة)</h3>
              <div class="bs-cat-tools">
                <button type="button" id="bs-btn-toggle-custom" class="btn btn-gold-outline btn-xxs">✨ فئات خاصة</button>
                <button type="button" id="bs-btn-reset-cat-hist" class="btn btn-ghost btn-xxs" title="تصفير سجل الفئة المختارة أو الكل">
                  🔄 ${this.selectedCategoryId === "random" ? "تصفير سجل الكل" : "تصفير سجل الفئة"}
                </button>
              </div>
            </div>
            ${customPanelHtml}
            <div class="bs-categories-grid">${catsHtml}</div>
          </div>

          <div class="bs-footer-cta">
            <button type="button" id="bs-btn-start-round" class="btn btn-primary btn-lg" ${!canStart ? "disabled" : ""}>
              🚀 ابدأ الجولة ${this.roundNumber > 0 ? `#${this.roundNumber + 1}` : "الآن"} (${activePlayers.length} لاعبين)
            </button>
            ${
              !canStart
                ? `<span class="bs-hint">${
                    this.playMode === "wireless" && !this.wireless.active
                      ? "افتح الغرفة اللاسلكية أولاً وانتظر انضمام 3 لاعبين على الأقل."
                      : "أضف 3 لاعبين على الأقل للبدء."
                  }</span>`
                : ""
            }
          </div>
        </div>
      `;
    }

    _bindSetupEvents() {
      this.bodyEl.querySelectorAll("[data-bs-mode]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.playMode = btn.dataset.bsMode === "wireless" ? "wireless" : "local";
          this._render();
          this._syncTV();
        });
      });

      const addInp = document.getElementById("bs-new-player-input");
      const addBtn = document.getElementById("bs-btn-add-player");
      const doAdd = () => {
        if (!addInp) return;
        const val = addInp.value.trim().slice(0, 24);
        if (!val) return;
        if (this.localNames.length >= MAX_PLAYERS) return;
        this.localNames.push(val);
        saveLocalNames(this.localNames);
        this._render();
        const nextInp = document.getElementById("bs-new-player-input");
        if (nextInp) nextInp.focus();
      };
      if (addBtn) addBtn.addEventListener("click", doAdd);
      if (addInp) {
        addInp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            doAdd();
          }
        });
      }

      this.bodyEl.querySelectorAll("[data-bs-del-player]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.bsDelPlayer);
          if (this.localNames.length <= MIN_PLAYERS) return;
          this.localNames.splice(idx, 1);
          saveLocalNames(this.localNames);
          this._render();
        });
      });

      const createBtn = document.getElementById("bs-btn-create-room");
      if (createBtn) createBtn.addEventListener("click", () => this.createWirelessRoom());
      const closeRoomBtn = document.getElementById("bs-btn-close-room");
      if (closeRoomBtn) closeRoomBtn.addEventListener("click", () => this.closeWirelessRoom());
      const lockBtn = document.getElementById("bs-btn-toggle-lock");
      if (lockBtn) lockBtn.addEventListener("click", () => this.toggleWirelessLock());
      const tvQrBtn = document.getElementById("bs-btn-toggle-tv-qr");
      if (tvQrBtn) {
        tvQrBtn.addEventListener("click", () => {
          this.showQrOnTv = !this.showQrOnTv;
          this._syncTV();
          this._render();
        });
      }
      const copyUrlBtn = document.getElementById("bs-btn-copy-url");
      if (copyUrlBtn) {
        copyUrlBtn.addEventListener("click", () => {
          if (this.wireless.playerUrl) {
            navigator.clipboard?.writeText(this.wireless.playerUrl).then(() => {
              this._toast("📋 تم نسخ رابط انضمام اللاعبين", "success");
            });
          }
        });
      }
      this.bodyEl.querySelectorAll("[data-bs-kick]").forEach((btn) => {
        btn.addEventListener("click", () => this.kickWirelessPlayer(btn.dataset.bsKick));
      });

      this.bodyEl.querySelectorAll("[data-bs-outsiders]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const n = Number(btn.dataset.bsOutsiders);
          if (n === 2 && this._getActivePlayersList().length < 6) return;
          this.outsiderCount = n === 2 ? 2 : 1;
          this._render();
        });
      });

      this.bodyEl.querySelectorAll("[data-bs-timer]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.discussionSeconds = Number(btn.dataset.bsTimer) || 0;
          this._render();
        });
      });

      this.bodyEl.querySelectorAll("[data-bs-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.selectedCategoryId = btn.dataset.bsCat || "random";
          this._render();
        });
      });

      const toggleCustomBtn = document.getElementById("bs-btn-toggle-custom");
      if (toggleCustomBtn) {
        toggleCustomBtn.addEventListener("click", () => {
          this.customPanelOpen = !this.customPanelOpen;
          this.customFeedback = "";
          this._render();
        });
      }
      const closeCustomBtn = document.getElementById("bs-btn-close-custom");
      if (closeCustomBtn) {
        closeCustomBtn.addEventListener("click", () => {
          this.customPanelOpen = false;
          this.editingCustomId = "";
          this.customFeedback = "";
          this._render();
        });
      }
      const saveCustomBtn = document.getElementById("bs-btn-save-custom");
      if (saveCustomBtn) {
        saveCustomBtn.addEventListener("click", () => {
          const bank = window.SeenJeemBaraSalfaBank;
          if (!bank) return;
          const res = bank.upsertCustomCategory({
            id: this.editingCustomId,
            icon: document.getElementById("bs-custom-icon")?.value || "✨",
            name: document.getElementById("bs-custom-name")?.value || "",
            words: document.getElementById("bs-custom-words")?.value || ""
          });
          if (!res.ok) {
            this.customFeedback = `⚠️ ${res.error}`;
            this._render();
            return;
          }
          this.editingCustomId = "";
          this.selectedCategoryId = res.category.id;
          this.customFeedback = `✅ تم حفظ الفئة «${res.category.name}» (${res.category.words.length} كلمة)!`;
          this._toast(`✨ تم حفظ الفئة «${res.category.name}»`, "success");
          this._render();
        });
      }
      const cancelEditBtn = document.getElementById("bs-btn-cancel-edit-custom");
      if (cancelEditBtn) {
        cancelEditBtn.addEventListener("click", () => {
          this.editingCustomId = "";
          this.customFeedback = "";
          this._render();
        });
      }
      this.bodyEl.querySelectorAll("[data-bs-edit-custom]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.editingCustomId = btn.dataset.bsEditCustom || "";
          this.customFeedback = "";
          this._render();
        });
      });
      this.bodyEl.querySelectorAll("[data-bs-del-custom]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.bsDelCustom;
          if (id && window.SeenJeemBaraSalfaBank) {
            window.SeenJeemBaraSalfaBank.deleteCustomCategory(id);
            if (this.selectedCategoryId === id) this.selectedCategoryId = "random";
            if (this.editingCustomId === id) this.editingCustomId = "";
            this._toast("🗑️ تم حذف الفئة الخاصة", "info");
            this._render();
          }
        });
      });

      const resetHistBtn = document.getElementById("bs-btn-reset-cat-hist");
      if (resetHistBtn) {
        resetHistBtn.addEventListener("click", () => {
          const bank = window.SeenJeemBaraSalfaBank;
          if (!bank) return;
          if (this.selectedCategoryId === "random") {
            bank.resetAllHistory();
            this._toast("🔄 تم تصفير سجل الكلمات لجميع الفئات", "info");
          } else {
            bank.resetCategoryHistory(this.selectedCategoryId);
            this._toast("🔄 تم تصفير سجل الكلمات لهذه الفئة", "info");
          }
          this._render();
        });
      }

      const startBtn = document.getElementById("bs-btn-start-round");
      if (startBtn) startBtn.addEventListener("click", () => this.startRound());
    }

    _renderRoleRevealHtml() {
      const r = this.round;
      if (this.playMode === "wireless") {
        const readySet = new Set(r.readyIds || []);
        const readyCount = readySet.size;
        const allReady = readyCount >= this.players.length;
        return `
          <div class="bs-stage-card">
            <div class="bs-stage-badge">${escapeHtml(r.category.icon)} الفئة: ${escapeHtml(r.category.name)} • الجولة #${this.roundNumber}</div>
            <h2 class="bs-stage-title">📲 تم إرسال الأدوار السرية لهواتف اللاعبين!</h2>
            <p class="bs-stage-sub">اطلب من كل لاعب فتح هاتفه وقراءة دوره سراً ثم الضغط على «جاهز ✅».</p>
            <div class="bs-progress-big">${readyCount} / ${this.players.length} جاهزين</div>
            <div class="bs-status-chips">
              ${this.players
                .map(
                  (p) =>
                    `<span class="bs-status-chip${readySet.has(p.id) ? " is-done" : ""}">${readySet.has(p.id) ? "✅" : "⏳"} ${escapeHtml(p.name)}</span>`
                )
                .join("")}
            </div>
            <div class="bs-stage-actions">
              <button type="button" id="bs-btn-start-questions" class="btn ${allReady ? "btn-primary" : "btn-amber"} btn-lg">
                ${allReady ? "🎤 الجميع جاهز — ابدأ الأسئلة ←" : "🎤 الانتقال للأسئلة الآن ←"}
              </button>
            </div>
          </div>
        `;
      }

      // الوضع المحلي (Hold-to-Reveal)
      const player = this.players[r.revealIdx];
      const isOutsider = r.outsiderIds.includes(player.id);
      return `
        <div class="bs-stage-card">
          <div class="bs-stage-badge">🔐 كشف الأدوار السرية (${r.revealIdx + 1} / ${this.players.length}) • ${escapeHtml(r.category.icon)} ${escapeHtml(r.category.name)}</div>
          <h2 class="bs-stage-title">مرّر الجهاز إلى: <span class="brand-highlight">${escapeHtml(player.name)}</span></h2>
          <p class="bs-stage-sub">تأكد أن لا أحد ينظر إلى الشاشة، ثم اضغط مع الاستمرار على الزر أدناه لمعرفة دورك.</p>

          <div id="bs-local-secret-card" class="bs-secret-reveal-box${isOutsider ? " is-outsider" : " is-insider"}">
            <div class="bs-secret-curtain">
              <span>🔒 الدور مخفي — اضغط مطوّلاً بالأسفل للكشف</span>
            </div>
            <div class="bs-secret-content">
              <div class="bs-secret-cat">${escapeHtml(r.category.icon)} الفئة: ${escapeHtml(r.category.name)}</div>
              ${
                isOutsider
                  ? `<div class="bs-outsider-alert">🕵️ أنت برا السالفة!</div>
                     <p class="bs-outsider-tip">حاول تفهم الموضوع من أسئلة الآخرين بدون ما تنكشف!</p>`
                  : `<div class="bs-insider-label">أنت داخل السالفة — الكلمة السرية هي:</div>
                     <div class="bs-secret-word">${escapeHtml(r.secretWord)}</div>`
              }
            </div>
          </div>

          <button type="button" id="bs-btn-hold-reveal" class="btn btn-amber btn-lg bs-hold-btn">
            👁️ اضغط مطوّلاً لكشف دورك (Hold-to-Reveal)
          </button>

          <div class="bs-stage-actions">
            <button type="button" id="bs-btn-next-reveal" class="btn btn-primary btn-lg" ${!r.peekedCurrent ? "disabled" : ""}>
              ${r.revealIdx + 1 >= this.players.length ? "✅ أخفيت دوري — ابدأ جولة الأسئلة ←" : "✅ أخفيت دوري — اللاعب التالي ←"}
            </button>
          </div>
        </div>
      `;
    }

    _bindRoleRevealEvents() {
      const startQ = document.getElementById("bs-btn-start-questions");
      if (startQ) startQ.addEventListener("click", () => this.enterQuestionsPhase());

      const holdBtn = document.getElementById("bs-btn-hold-reveal");
      if (holdBtn) {
        const startHold = (e) => {
          if (e.type === "mousedown" && e.button !== 0) return;
          if (e.cancelable) e.preventDefault();
          this._setHoldReveal(true);
        };
        const stopHold = () => this._setHoldReveal(false);
        holdBtn.addEventListener("pointerdown", startHold);
        holdBtn.addEventListener("pointerup", stopHold);
        holdBtn.addEventListener("pointerleave", stopHold);
        holdBtn.addEventListener("pointercancel", stopHold);
        holdBtn.addEventListener("mousedown", startHold);
        holdBtn.addEventListener("mouseup", stopHold);
        holdBtn.addEventListener("touchstart", startHold, { passive: false });
        holdBtn.addEventListener("touchend", stopHold);
        holdBtn.addEventListener("contextmenu", (e) => e.preventDefault());
      }

      const nextBtn = document.getElementById("bs-btn-next-reveal");
      if (nextBtn) nextBtn.addEventListener("click", () => this.advanceLocalRoleReveal());
    }

    _renderQuestionsHtml() {
      const r = this.round;
      const pair = r.pairs[r.pairIndex];
      const isLast = r.pairIndex + 1 >= r.pairs.length;
      return `
        <div class="bs-stage-card">
          <div class="bs-stage-badge">${escapeHtml(r.category.icon)} ${escapeHtml(r.category.name)} • جولة الأسئلة #${r.questionCycle} (${r.pairIndex + 1} / ${r.pairs.length})</div>
          <h2 class="bs-stage-title">🎤 وقت الأسئلة الذكية</h2>

          <div class="bs-pair-hero">
            <div class="bs-pair-player is-asker">
              <span class="bs-pair-role">السائل</span>
              <strong>${escapeHtml(pair.askerName)}</strong>
            </div>
            <div class="bs-pair-arrow" aria-hidden="true">⬅️ يسأل ⬅️</div>
            <div class="bs-pair-player is-target">
              <span class="bs-pair-role">المُجاب</span>
              <strong>${escapeHtml(pair.targetName)}</strong>
            </div>
          </div>

          <p class="bs-stage-sub">اسأل سؤالاً ذكياً يكشف اللي «برا السالفة» بدون ما تعطي الكلمة مباشرة!</p>

          <div class="bs-stage-actions">
            <button type="button" id="bs-btn-prev-q" class="btn btn-secondary btn-sm" ${r.pairIndex === 0 ? "disabled" : ""}>→ السؤال السابق</button>
            <button type="button" id="bs-btn-next-q" class="btn btn-primary btn-lg">
              ${isLast ? "💬 الانتقال للنقاش والاتهام ←" : "السؤال التالي ←"}
            </button>
          </div>
          <div class="bs-stage-sub-actions">
            <button type="button" id="bs-btn-extra-q-cycle" class="btn btn-gold-outline btn-xs">🔄 جولة أسئلة إضافية</button>
            <button type="button" id="bs-btn-skip-disc" class="btn btn-ghost btn-xs">⏭️ تخطي إلى النقاش</button>
          </div>
        </div>
      `;
    }

    _bindQuestionsEvents() {
      const prev = document.getElementById("bs-btn-prev-q");
      if (prev) prev.addEventListener("click", () => this.stepQuestionPair(-1));
      const next = document.getElementById("bs-btn-next-q");
      if (next) next.addEventListener("click", () => this.stepQuestionPair(1));
      const extra = document.getElementById("bs-btn-extra-q-cycle");
      if (extra) extra.addEventListener("click", () => this.startSecondQuestionCycle());
      const skip = document.getElementById("bs-btn-skip-disc");
      if (skip) skip.addEventListener("click", () => this.enterDiscussionPhase());
    }

    _renderDiscussionHtml() {
      const r = this.round;
      const isUnlimited = this.discussionSeconds === 0;
      return `
        <div class="bs-stage-card">
          <div class="bs-stage-badge">${escapeHtml(r.category.icon)} الفئة: ${escapeHtml(r.category.name)} • ${r.outsiderIds.length === 2 ? "2 برا السالفة" : "1 برا السالفة"}</div>
          <h2 class="bs-stage-title">💬 جولة النقاش والاتهام</h2>
          <p class="bs-stage-sub">تناقشوا بحرية واتفقوا على المشتبه به قبل فتح التصويت السري!</p>

          <div class="bs-disc-timer-box">
            <div id="bs-disc-timer-num" class="bs-disc-timer-num${!isUnlimited && this.timerRemaining <= 10 ? " danger" : ""}">
              ${isUnlimited ? "∞" : formatTime(this.timerRemaining)}
            </div>
            ${
              !isUnlimited
                ? `<div class="bs-timer-btns">
                    <button type="button" id="bs-btn-disc-toggle" class="btn btn-secondary btn-xs">${this.timerRunning ? "⏸️ إيقاف مؤقت" : "▶️ استئناف"}</button>
                    <button type="button" id="bs-btn-disc-reset" class="btn btn-ghost btn-xs">🔄 إعادة المؤقت</button>
                  </div>`
                : `<span class="bs-hint">نقاش مفتوح بدون مؤقت</span>`
            }
          </div>

          <div class="bs-stage-actions">
            <button type="button" id="bs-btn-go-voting" class="btn btn-amber btn-lg">🗳️ الانتقال للتصويت السري ←</button>
          </div>
        </div>
      `;
    }

    _bindDiscussionEvents() {
      const tgl = document.getElementById("bs-btn-disc-toggle");
      if (tgl) tgl.addEventListener("click", () => this.toggleDiscussionTimer());
      const rst = document.getElementById("bs-btn-disc-reset");
      if (rst) rst.addEventListener("click", () => this.resetDiscussionTimer());
      const goVote = document.getElementById("bs-btn-go-voting");
      if (goVote) goVote.addEventListener("click", () => this.enterVotingPhase());
    }

    _renderVotingHtml() {
      const r = this.round;
      if (this.playMode === "wireless") {
        const votedSet = new Set(Object.keys(r.votes || {}));
        const allVoted = votedSet.size >= this.players.length;
        return `
          <div class="bs-stage-card">
            <div class="bs-stage-badge">🗳️ التصويت السري عبر الهواتف</div>
            <h2 class="bs-stage-title">صوّتوا الآن على المشتبه به!</h2>
            <p class="bs-stage-sub">الاختيارات سرية تماماً ولن تظهر إلا بعد إغلاق التصويت.</p>
            <div class="bs-progress-big">${votedSet.size} / ${this.players.length} صوّتوا</div>
            <div class="bs-status-chips">
              ${this.players
                .map(
                  (p) =>
                    `<span class="bs-status-chip${votedSet.has(p.id) ? " is-done" : ""}">${votedSet.has(p.id) ? "✅" : "⏳"} ${escapeHtml(p.name)}</span>`
                )
                .join("")}
            </div>
            <div class="bs-stage-actions">
              <button type="button" id="bs-btn-close-voting" class="btn ${allVoted ? "btn-primary" : "btn-amber"} btn-lg">
                🥁 إغلاق التصويت وكشف النتائج ←
              </button>
            </div>
          </div>
        `;
      }

      const voter = this.players[r.voteIdx];
      const candidates = this.players.filter((p) => p.id !== voter.id);
      return `
        <div class="bs-stage-card">
          <div class="bs-stage-badge">🗳️ التصويت السري (${r.voteIdx + 1} / ${this.players.length})</div>
          <h2 class="bs-stage-title">دور التصويت: <span class="brand-highlight">${escapeHtml(voter.name)}</span></h2>
          ${
            !r.voterReadyToPick
              ? `
                <p class="bs-stage-sub">مرّر الجهاز إلى <strong>${escapeHtml(voter.name)}</strong> ليختار سراً من يعتقد أنه «برا السالفة».</p>
                <div class="bs-stage-actions">
                  <button type="button" id="bs-btn-show-vote-list" class="btn btn-primary btn-lg">🗳️ أنا ${escapeHtml(voter.name)} — اعرض الأسماء للتصويت</button>
                </div>
              `
              : `
                <p class="bs-stage-sub">اختر الشخص الذي تشك أنه «برا السالفة» (ممنوع التصويت لنفسك):</p>
                <div class="bs-vote-grid">
                  ${candidates
                    .map(
                      (c) => `
                    <button type="button" class="btn btn-secondary bs-vote-btn" data-bs-vote-target="${escapeHtml(c.id)}">
                      🕵️ ${escapeHtml(c.name)}
                    </button>
                  `
                    )
                    .join("")}
                </div>
              `
          }
        </div>
      `;
    }

    _bindVotingEvents() {
      const closeV = document.getElementById("bs-btn-close-voting");
      if (closeV) closeV.addEventListener("click", () => this.enterOutsiderRevealPhase());

      const showList = document.getElementById("bs-btn-show-vote-list");
      if (showList) {
        showList.addEventListener("click", () => {
          if (this.round) {
            this.round.voterReadyToPick = true;
            this._render();
          }
        });
      }

      this.bodyEl.querySelectorAll("[data-bs-vote-target]").forEach((btn) => {
        btn.addEventListener("click", () => this.recordLocalVote(btn.dataset.bsVoteTarget));
      });
    }

    _renderOutsiderRevealHtml() {
      const r = this.round;
      const outsiderNames = r.outsiderIds.map((id) => this._findPlayerName(id));
      const topNames = (r.topVotedIds || []).map((id) => `${this._findPlayerName(id)} (${r.voteCounts[id]} صوت)`);
      return `
        <div class="bs-stage-card">
          <div class="bs-stage-badge">🥁 نتائج التصويت وكشف الحقيقة</div>
          <div class="bs-outsider-reveal-banner">
            <div class="bs-reveal-eyebrow">${outsiderNames.length > 1 ? "🕵️ اللي «برا السالفة» هم:" : "🕵️ اللي «برا السالفة» الحقيقي هو:"}</div>
            <div class="bs-reveal-names">${escapeHtml(outsiderNames.join("  و  "))}</div>
          </div>

          ${
            topNames.length > 0
              ? `<div class="bs-top-voted-pill">🎯 الأكثر حصولاً على الأصوات: <strong>${escapeHtml(topNames.join(" • "))}</strong></div>`
              : ""
          }

          <div class="bs-votes-table">
            ${(r.voteBreakdown || [])
              .map((v) => {
                const isHit = v.targetId && r.outsiderIds.includes(v.targetId);
                return `
                  <div class="bs-vote-row${isHit ? " is-hit" : ""}">
                    <strong>${escapeHtml(v.voterName)}</strong>
                    <span class="bs-vote-arrow">⬅️ صوّت على ⬅️</span>
                    <span class="bs-vote-target">${escapeHtml(v.targetName)} ${isHit ? "✅" : ""}</span>
                  </div>
                `;
              })
              .join("")}
          </div>

          <div class="bs-stage-actions">
            <button type="button" id="bs-btn-go-guess" class="btn btn-amber btn-lg">
              🎲 الفرصة الأخيرة لتخمين الكلمة (8 خيارات) ←
            </button>
          </div>
        </div>
      `;
    }

    _bindOutsiderRevealEvents() {
      const btn = document.getElementById("bs-btn-go-guess");
      if (btn) btn.addEventListener("click", () => this.enterOutsiderGuessPhase());
    }

    _renderOutsiderGuessHtml() {
      const r = this.round;
      if (this.playMode === "wireless") {
        const waitingNames = r.outsiderIds
          .filter((oid) => !r.outsiderGuesses[oid])
          .map((oid) => this._findPlayerName(oid));
        return `
          <div class="bs-stage-card">
            <div class="bs-stage-badge">🎯 الفرصة الأخيرة لتخمين الكلمة • ${escapeHtml(r.category.icon)} ${escapeHtml(r.category.name)}</div>
            <h2 class="bs-stage-title">⏳ بانتظار تخمين: ${escapeHtml(waitingNames.join(" و ") || "الجميع خمّن!")}</h2>
            <p class="bs-stage-sub">ظهرت الخيارات الـ 8 على هاتف اللي «برا السالفة» لاختيار الكلمة السرية (+100 نقطة عند الصواب).</p>
            <div class="bs-choices-grid is-readonly">
              ${r.guessChoices.map((w) => `<div class="bs-choice-pill">${escapeHtml(w)}</div>`).join("")}
            </div>
            <div class="bs-stage-actions">
              <button type="button" id="bs-btn-force-results" class="btn btn-primary btn-sm">🏆 إظهار نتائج الجولة الآن</button>
            </div>
          </div>
        `;
      }

      const currentOid = r.outsiderIds[r.guessOutsiderIdx];
      const currentName = this._findPlayerName(currentOid);
      return `
        <div class="bs-stage-card">
          <div class="bs-stage-badge">🎯 الفرصة الأخيرة (${r.guessOutsiderIdx + 1} / ${r.outsiderIds.length}) • ${escapeHtml(r.category.icon)} ${escapeHtml(r.category.name)}</div>
          <h2 class="bs-stage-title">يا <span class="brand-highlight">${escapeHtml(currentName)}</span> — شو كانت الكلمة السرية؟</h2>
          <p class="bs-stage-sub">اختر كلمة واحدة من بين الـ 8 خيارات أدناه لتربح +100 نقطة:</p>
          <div class="bs-choices-grid">
            ${r.guessChoices
              .map(
                (w) => `
              <button type="button" class="btn btn-secondary bs-choice-btn" data-bs-guess-word="${escapeHtml(w)}">
                ${escapeHtml(w)}
              </button>
            `
              )
              .join("")}
          </div>
        </div>
      `;
    }

    _bindOutsiderGuessEvents() {
      const forceBtn = document.getElementById("bs-btn-force-results");
      if (forceBtn) forceBtn.addEventListener("click", () => this.finalizeRoundResults());
      this.bodyEl.querySelectorAll("[data-bs-guess-word]").forEach((btn) => {
        btn.addEventListener("click", () => this.recordLocalOutsiderGuess(btn.dataset.bsGuessWord));
      });
    }

    _renderResultsHtml() {
      const r = this.round;
      const standings = this._getStandingsList();
      return `
        <div class="bs-stage-card">
          <div class="bs-stage-badge">🏆 نتائج الجولة #${this.roundNumber} • ${escapeHtml(r.category.icon)} ${escapeHtml(r.category.name)}</div>

          <div class="bs-secret-reveal-final">
            <span>الكلمة السرية كانت:</span>
            <strong>${escapeHtml(r.secretWord)}</strong>
          </div>

          <div class="bs-results-columns">
            <div class="bs-res-box">
              <h3>📊 نقاط هذه الجولة</h3>
              <div class="bs-res-list">
                ${(r.roundScores || [])
                  .map(
                    (s) => `
                  <div class="bs-res-row${s.delta > 0 ? " is-win" : ""}">
                    <div>
                      <strong>${escapeHtml(s.name)}</strong> ${s.isOutsider ? `<span class="bs-role-tag">🕵️ برا السالفة</span>` : ""}
                      <div class="bs-res-reason">${escapeHtml(s.reason)}</div>
                    </div>
                    <strong class="bs-res-delta">${s.delta > 0 ? `+${s.delta}` : "0"}</strong>
                  </div>
                `
                  )
                  .join("")}
              </div>
            </div>

            <div class="bs-res-box">
              <h3>🥇 الترتيب التراكمي للجلسة</h3>
              <div class="bs-res-list">
                ${standings
                  .map(
                    (p, idx) => `
                  <div class="bs-res-row${idx === 0 ? " is-leader" : ""}">
                    <div>
                      <strong>${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`} ${escapeHtml(p.name)}</strong>
                    </div>
                    <strong class="bs-res-total">${p.score} نقطة</strong>
                  </div>
                `
                  )
                  .join("")}
              </div>
            </div>
          </div>

          <div class="bs-stage-actions">
            <button type="button" id="bs-btn-next-round" class="btn btn-primary btn-lg">🔄 جولة جديدة (نفس اللاعبين)</button>
            <button type="button" id="bs-btn-change-cat" class="btn btn-gold-outline btn-sm">🎯 تغيير الفئة</button>
            <button type="button" id="bs-btn-finish-game" class="btn btn-danger-outline btn-sm">🏠 إنهاء اللعبة والعودة للرئيسية</button>
          </div>
        </div>
      `;
    }

    _bindResultsEvents() {
      const nextBtn = document.getElementById("bs-btn-next-round");
      if (nextBtn) nextBtn.addEventListener("click", () => this.startRound());
      const changeCatBtn = document.getElementById("bs-btn-change-cat");
      if (changeCatBtn) changeCatBtn.addEventListener("click", () => this.returnToCategorySelect());
      const finishBtn = document.getElementById("bs-btn-finish-game");
      if (finishBtn) {
        finishBtn.addEventListener("click", async () => {
          if (this.wireless.active) await this.closeWirelessRoom();
          this.roundNumber = 0;
          this.scoresById = {};
          this.phase = "setup";
          this.round = null;
          this.close();
        });
      }
    }
  }

  window.SeenJeemBaraSalfa = new BaraSalfaController();
})();
