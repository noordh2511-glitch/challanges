/**
 * واجهة هاتف اللاعب التفاعلية للألعاب السريعة (Quick Game Player View — Pack 17)
 * - تتعرّف تلقائياً على المسارات الثلاثة:
 *   1) ?mode=blitz-player&room=CODE  -> ⚡ البرق السريع
 *   2) ?mode=mgk-player&room=CODE    -> 🎭 من غير كلام
 *   3) ?mode=audio-player&room=CODE  -> 🎵 تحدي الصوت
 * - تعبئة تلقائية للاسم والأفاتار من playerProfileManager.js + حفظ الجلسة في sessionStorage
 * - منع تسريب كامل: يقرأ الأسرار من privateActor/{uid} أو privateJudge/{uid} فقط عند التخويل
 * - تصميم موبايل-أولاً RTL بدون تمرير أفقي وأزرار بارتفاع >= 48px، وخالٍ تماماً من أي مصطلح تقني
 */
(function () {
  "use strict";

  const GAME_THEMES = {
    blitz: {
      gameType: "blitz",
      icon: "⚡",
      title: "البرق السريع",
      subtitle: "سباق الإجابات السريعة وجرس السرعة",
      accentClass: "qg-theme-blitz"
    },
    mgk: {
      gameType: "mgk",
      icon: "🎭",
      title: "من غير كلام",
      subtitle: "التمثيل الصامت السريع عبر هاتفك",
      accentClass: "qg-theme-mgk"
    },
    audio: {
      gameType: "audio",
      icon: "🎵",
      title: "تحدي الصوت",
      subtitle: "استمع للمقطع واضغط الجرس قبل الجميع",
      accentClass: "qg-theme-audio"
    }
  };

  const AVATAR_CHOICES = ["🎯", "🦁", "🦊", "🐺", "🦅", "🐉", "👑", "🎭", "🕵️", "🧙", "🚀", "⚡", "🎵", "🏆", "🌟", "🦉"];

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMmSs(sec) {
    const clean = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(clean / 60);
    const s = clean % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function modeToGameType(mode) {
    if (mode === "mgk-player") return "mgk";
    if (mode === "audio-player") return "audio";
    return "blitz";
  }

  class QuickGamePlayerViewController {
    constructor() {
      this.gameType = "blitz";
      this.theme = GAME_THEMES.blitz;
      this.root = null;
      this.roomCode = "";
      this.playerName = "";
      this.playerAvatar = "🎯";
      this.selectedTeamId = "";
      this.joined = false;
      this.connected = false;
      this.kicked = false;
      this.roomMissing = false;
      this.errorMessage = "";
      this.statusNotice = "";
      this.meta = null;
      this.publicState = null;
      this.playersMap = {};
      this.privateActor = null;
      this.privateJudge = null;
      this.holdRevealing = false;
      this._timerInterval = null;
      this._buzzLockLocal = false;
      this._lastBuzzRoundId = "";
    }

    _sessionKey() {
      return `seen_jeem_quick_player_${this.gameType}_v1`;
    }

    _loadSavedSession() {
      try {
        const raw = sessionStorage.getItem(this._sessionKey());
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (_err) {
        return null;
      }
    }

    _saveSession() {
      try {
        sessionStorage.setItem(
          this._sessionKey(),
          JSON.stringify({
            roomCode: this.roomCode,
            name: this.playerName,
            avatar: this.playerAvatar,
            teamId: this.selectedTeamId
          })
        );
      } catch (_err) {}
    }

    init(urlMode = "blitz-player") {
      this.gameType = modeToGameType(urlMode);
      this.theme = GAME_THEMES[this.gameType] || GAME_THEMES.blitz;

      document.body.classList.add("quick-player-mode", this.theme.accentClass);
      const setupScreen = document.getElementById("setup-screen");
      const gameScreen = document.getElementById("game-screen");
      if (setupScreen) {
        setupScreen.classList.remove("active");
        setupScreen.hidden = true;
      }
      if (gameScreen) {
        gameScreen.classList.remove("active");
        gameScreen.hidden = true;
      }

      // قراءة رمز الغرفة من الرابط + استعادة الجلسة + تعبئة تلقائية من بروفايل اللاعب
      const params =
        window.SeenJeemRealtimeUtils && typeof window.SeenJeemRealtimeUtils.getUrlParams === "function"
          ? window.SeenJeemRealtimeUtils.getUrlParams()
          : { room: "" };
      const saved = this._loadSavedSession();
      this.roomCode = (params.room || (saved && saved.roomCode) || "").trim().toUpperCase();

      const profileId =
        window.SeenJeemProfile && typeof window.SeenJeemProfile.getRoomIdentity === "function"
          ? window.SeenJeemProfile.getRoomIdentity()
          : { name: "", avatar: "🎯" };
      this.playerName = (saved && saved.name) || profileId.name || "";
      this.playerAvatar = (saved && saved.avatar) || profileId.avatar || "🎯";
      this.selectedTeamId = (saved && saved.teamId) || "";

      this.root = document.createElement("div");
      this.root.id = "quick-player-root";
      this.root.className = `qg-player-shell ${this.theme.accentClass}`;
      document.body.appendChild(this.root);

      this.root.addEventListener("click", (e) => this._handleClick(e));
      this.root.addEventListener("input", (e) => this._handleInput(e));
      this._bindHoldRevealEvents();

      this._render();

      if (this.roomCode && this.roomCode.length >= 4) {
        this._connectToRoom(this.roomCode, Boolean(saved && saved.roomCode === this.roomCode && this.playerName));
      }

      this._startTimerLoop();
    }

    _bindHoldRevealEvents() {
      const startHold = (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("#qg-btn-hold-actor-word") : null;
        if (!btn) return;
        if (e.cancelable) e.preventDefault();
        this._setHoldReveal(true);
      };
      const endHold = () => {
        if (this.holdRevealing) this._setHoldReveal(false);
      };
      this.root.addEventListener("pointerdown", startHold);
      window.addEventListener("pointerup", endHold);
      window.addEventListener("pointercancel", endHold);
      window.addEventListener("blur", endHold);
    }

    _setHoldReveal(active) {
      this.holdRevealing = Boolean(active);
      const decoy = this.root && this.root.querySelector("#qg-actor-decoy");
      const secret = this.root && this.root.querySelector("#qg-actor-secret");
      const btn = this.root && this.root.querySelector("#qg-btn-hold-actor-word");
      if (decoy) decoy.hidden = this.holdRevealing;
      if (secret) secret.hidden = !this.holdRevealing;
      if (btn) btn.classList.toggle("is-holding", this.holdRevealing);
    }

    _startTimerLoop() {
      if (this._timerInterval) clearInterval(this._timerInterval);
      this._timerInterval = setInterval(() => {
        if (!this.joined || !this.publicState || !this.publicState.timer) return;
        const el = this.root && this.root.querySelector("#qg-live-timer");
        if (!el) return;
        const sync = window.SeenJeemQuickGamesSync;
        const utils = window.SeenJeemQuickGamesSyncUtils;
        if (!utils) return;
        const offset = sync ? sync.getServerTimeOffsetMs() : 0;
        const rem = utils.computeRemainingSeconds(this.publicState.timer, offset);
        el.textContent = formatMmSs(rem);
        el.classList.toggle("is-danger", rem > 0 && rem <= 10);
      }, 300);
    }

    async _connectToRoom(code, autoJoin = false) {
      const sync = window.SeenJeemQuickGamesSync;
      if (!sync) {
        this.errorMessage = "تعذّر تهيئة غرفة اللعب على هذا الجهاز.";
        this._render();
        return;
      }

      const cleanCode = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (cleanCode.length < 4) {
        this.errorMessage = "يرجى إدخال رمز الغرفة المكوّن من 6 خانات.";
        this._render();
        return;
      }

      this.roomCode = cleanCode;
      this.errorMessage = "";
      this.roomMissing = false;
      this.kicked = false;
      this.statusNotice = "⏳ جاري الاتصال بغرفة اللعب...";
      this._render();

      try {
        await sync.connectAsPlayer({
          gameType: this.gameType,
          roomCode: cleanCode,
          onMeta: (m) => {
            this.meta = m || null;
            this._render();
          },
          onPublicState: (pub) => {
            this.publicState = pub || null;
            if (pub && pub.buzzerState && pub.buzzerState.roundId !== this._lastBuzzRoundId) {
              this._buzzLockLocal = false;
              this._lastBuzzRoundId = pub.buzzerState.roundId || "";
            }
            // تحديد فريق افتراضي إن وُجدت فرق ولم يختر اللاعب فريقاً بعد
            if (!this.selectedTeamId && pub && Array.isArray(pub.teams) && pub.teams.length > 0 && !pub.freePlay) {
              this.selectedTeamId = pub.teams[0].id;
            }
            this._render();
          },
          onPlayers: (map) => {
            this.playersMap = map && typeof map === "object" ? map : {};
            this._render();
          },
          onPrivateActor: (payload) => {
            this.privateActor = payload || null;
            this.holdRevealing = false;
            this._render();
          },
          onPrivateJudge: (payload) => {
            this.privateJudge = payload || null;
            this._render();
          },
          onKicked: () => {
            this.kicked = true;
            this.joined = false;
            this._render();
          },
          onConnectionState: (isConn) => {
            this.connected = isConn;
            this._render();
          },
          onRoomMissing: () => {
            this.roomMissing = true;
            this.joined = false;
            this._render();
          }
        });

        this.statusNotice = "";
        if (autoJoin && this.playerName) {
          await this._submitJoin();
        } else {
          this._render();
        }
      } catch (err) {
        this.statusNotice = "";
        this.errorMessage = (err && err.message) || "تعذّر الاتصال بالغرفة حالياً.";
        this._render();
      }
    }

    async _submitJoin() {
      const sync = window.SeenJeemQuickGamesSync;
      if (!sync) return;

      const codeInp = this.root && this.root.querySelector("#qg-room-input");
      const nameInp = this.root && this.root.querySelector("#qg-name-input");
      if (codeInp && codeInp.value.trim()) {
        this.roomCode = codeInp.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      }
      if (nameInp) {
        this.playerName = nameInp.value.trim().slice(0, 26);
      }

      if (!this.roomCode || this.roomCode.length < 4) {
        this.errorMessage = "يرجى إدخال رمز الغرفة الظاهر على الشاشة الرئيسية.";
        this._render();
        return;
      }
      if (!this.playerName) {
        this.errorMessage = "يرجى كتابة اسمك قبل الانضمام.";
        this._render();
        return;
      }

      if (!sync.isActive() || sync.roomCode !== this.roomCode) {
        await this._connectToRoom(this.roomCode, false);
        if (this.errorMessage || this.roomMissing || this.kicked) return;
      }

      const res = await sync.registerPlayer({
        name: this.playerName,
        avatar: this.playerAvatar,
        teamId: this.selectedTeamId
      });
      if (!res.ok) {
        this.errorMessage = res.error || "تعذّر الانضمام إلى الغرفة.";
        this._render();
        return;
      }

      // تحديث البروفايل المحلي بالاسم والأفاتار المختارَين
      if (window.SeenJeemProfile && typeof window.SeenJeemProfile.updateProfile === "function") {
        window.SeenJeemProfile.updateProfile(
          { displayName: this.playerName, avatarEmoji: this.playerAvatar },
          { syncRemote: false }
        );
      }

      this.joined = true;
      this.errorMessage = "";
      this._saveSession();
      this._render();
    }

    _isJudge() {
      const uid = window.SeenJeemQuickGamesSync ? window.SeenJeemQuickGamesSync.getUid() : "";
      return Boolean(uid && this.meta && this.meta.judgeUid === uid);
    }

    _isActiveActor() {
      const uid = window.SeenJeemQuickGamesSync ? window.SeenJeemQuickGamesSync.getUid() : "";
      return Boolean(uid && this.meta && this.meta.activeActorUid === uid);
    }

    async _handleClick(e) {
      const btn = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!btn) return;
      const act = btn.dataset.qgAct;
      if (!act) return;

      const sync = window.SeenJeemQuickGamesSync;
      if (act === "pick-avatar") {
        this.playerAvatar = btn.dataset.val || "🎯";
        this._render();
        return;
      }
      if (act === "pick-team") {
        this.selectedTeamId = btn.dataset.val || "";
        this._render();
        return;
      }
      if (act === "connect-code") {
        const inp = this.root && this.root.querySelector("#qg-room-input");
        const val = inp ? inp.value.trim() : this.roomCode;
        await this._connectToRoom(val, false);
        return;
      }
      if (act === "join-room") {
        await this._submitJoin();
        return;
      }
      if (act === "buzz") {
        if (!sync || this._buzzLockLocal) return;
        const pub = this.publicState || {};
        const bz = pub.buzzerState || {};
        if (bz.status !== "open") return;
        this._buzzLockLocal = true;
        if (navigator.vibrate) {
          try {
            navigator.vibrate(60);
          } catch (_e) {}
        }
        await sync.pressBuzz({
          name: this.playerName,
          avatar: this.playerAvatar,
          teamId: this.selectedTeamId,
          roundId: bz.roundId || pub.roundId || ""
        });
        this._render();
        return;
      }
      if (act === "cmd") {
        if (!sync) return;
        const cmdType = btn.dataset.cmd || "";
        const payload = {};
        if (btn.dataset.level !== undefined) payload.level = Number(btn.dataset.level);
        if (btn.dataset.teamIdx !== undefined) payload.teamIdx = Number(btn.dataset.teamIdx);
        if (cmdType === "CLAIM_NEXT_ACTOR") {
          payload.name = this.playerName;
          payload.avatar = this.playerAvatar;
          payload.teamId = this.selectedTeamId;
        }
        await sync.sendCommand(cmdType, payload);
        if (cmdType === "CLAIM_NEXT_ACTOR") {
          this.statusNotice = "✅ تم تسجيلك كممثّل للدور القادم!";
          this._render();
          setTimeout(() => {
            this.statusNotice = "";
            this._render();
          }, 2600);
        }
      }
    }

    _handleInput(e) {
      const t = e.target;
      if (!t) return;
      if (t.id === "qg-name-input") {
        this.playerName = t.value;
      } else if (t.id === "qg-room-input") {
        this.roomCode = t.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
        t.value = this.roomCode;
      }
    }

    _renderHeaderHtml() {
      const isJudge = this._isJudge();
      const isActor = this._isActiveActor();
      const roleTag = isJudge
        ? `<span class="qg-role-pill is-judge">👑 حكم</span>`
        : isActor
          ? `<span class="qg-role-pill is-actor">🎭 الممثّل</span>`
          : "";
      const connDot = this.joined
        ? this.connected
          ? `<span class="qg-conn-pill is-online">🟢 متصل</span>`
          : `<span class="qg-conn-pill is-offline">🟡 يعيد الاتصال</span>`
        : "";
      return `
        <header class="qg-header">
          <div class="qg-brand">
            <span class="qg-brand-ico" aria-hidden="true">${this.theme.icon}</span>
            <div>
              <h1 class="qg-brand-title">${escapeHtml(this.theme.title)}</h1>
              <div class="qg-brand-sub">${this.roomCode ? `غرفة ${escapeHtml(this.roomCode)}` : escapeHtml(this.theme.subtitle)}</div>
            </div>
          </div>
          <div class="qg-header-pills">
            ${roleTag}
            ${connDot}
          </div>
        </header>
      `;
    }

    _renderJoinHtml() {
      const pub = this.publicState || {};
      const teams = Array.isArray(pub.teams) ? pub.teams : [];
      const showTeams = teams.length > 0 && !pub.freePlay;

      return `
        <div class="qg-card qg-join-card">
          <div class="qg-join-hero">
            <div class="qg-join-avatar-preview">${escapeHtml(this.playerAvatar)}</div>
            <h2>انضم إلى ${escapeHtml(this.theme.title)}</h2>
            <p>${escapeHtml(this.theme.subtitle)}</p>
          </div>

          ${this.errorMessage ? `<div class="qg-alert is-error">⚠️ ${escapeHtml(this.errorMessage)}</div>` : ""}
          ${this.statusNotice ? `<div class="qg-alert is-info">${escapeHtml(this.statusNotice)}</div>` : ""}

          <div class="qg-field">
            <label for="qg-room-input" class="qg-label">رمز الغرفة (6 خانات):</label>
            <div class="qg-code-row">
              <input type="text" id="qg-room-input" class="qg-input qg-code-input" maxlength="6" dir="ltr" value="${escapeHtml(this.roomCode)}" placeholder="ABC234" autocomplete="off" />
              <button type="button" class="btn btn-secondary qg-btn" data-qg-act="connect-code">تحقّق</button>
            </div>
          </div>

          <div class="qg-field">
            <label for="qg-name-input" class="qg-label">اسمك في اللعبة:</label>
            <input type="text" id="qg-name-input" class="qg-input" maxlength="26" value="${escapeHtml(this.playerName)}" placeholder="اكتب اسمك هنا..." autocomplete="off" />
          </div>

          <div class="qg-field">
            <span class="qg-label">اختر صورتك الرمزية:</span>
            <div class="qg-avatars-grid">
              ${AVATAR_CHOICES.map(
                (ico) =>
                  `<button type="button" class="qg-avatar-opt${this.playerAvatar === ico ? " active" : ""}" data-qg-act="pick-avatar" data-val="${escapeHtml(ico)}">${escapeHtml(ico)}</button>`
              ).join("")}
            </div>
          </div>

          ${
            showTeams
              ? `
                <div class="qg-field">
                  <span class="qg-label">اختر فريقك:</span>
                  <div class="qg-teams-pick-grid">
                    ${teams
                      .map(
                        (t) => `
                      <button type="button" class="qg-team-pick-btn${this.selectedTeamId === t.id ? " active" : ""}" data-qg-act="pick-team" data-val="${escapeHtml(t.id)}" style="${t.color ? `--team-c:${escapeHtml(t.color)}` : ""}">
                        ${escapeHtml(t.name)}
                      </button>
                    `
                      )
                      .join("")}
                  </div>
                </div>
              `
              : ""
          }

          <button type="button" id="qg-btn-join" class="btn btn-primary qg-btn-lg" data-qg-act="join-room">
            🚀 دخول غرفة اللعب
          </button>
        </div>
      `;
    }

    _renderScoreboardHtml(pub) {
      const teams = Array.isArray(pub && pub.teams) ? pub.teams : [];
      if (teams.length === 0 || pub.freePlay) return "";
      return `
        <div class="qg-scoreboard">
          ${teams
            .map(
              (t, idx) => `
            <div class="qg-score-pill${pub.activeTeamIdx === idx && this.gameType !== "audio" ? " is-active" : ""}" style="${t.color ? `border-color:${escapeHtml(t.color)}` : ""}">
              <span class="qg-score-name">${escapeHtml(t.name)}</span>
              <strong class="qg-score-val">${Number(t.score) || 0}</strong>
            </div>
          `
            )
            .join("")}
        </div>
      `;
    }

    _renderWaitingLobbyHtml(pub) {
      const players = Object.values(this.playersMap || {}).filter((p) => p && p.name);
      return `
        <div class="qg-card qg-wait-card">
          <div class="qg-wait-icon">${this.theme.icon}</div>
          <h2>أهلاً بك يا ${escapeHtml(this.playerAvatar)} ${escapeHtml(this.playerName)}!</h2>
          <p>أنت الآن داخل غرفة <strong>${escapeHtml(this.theme.title)}</strong>. بانتظار بدء الجولة من الشاشة الرئيسية...</p>
          ${this._renderScoreboardHtml(pub)}
          <div class="qg-roster-box">
            <div class="qg-roster-title">👥 المنضمّون الآن (${players.length}):</div>
            <div class="qg-roster-chips">
              ${players
                .map((p) => `<span class="qg-roster-chip">${escapeHtml(p.avatar || "🎯")} ${escapeHtml(p.name)}</span>`)
                .join("")}
            </div>
          </div>
          ${
            this.gameType === "mgk"
              ? `<button type="button" class="btn btn-gold-outline qg-btn-lg" data-qg-act="cmd" data-cmd="CLAIM_NEXT_ACTOR">🎭 أنا الممثّل في الدور الأول</button>`
              : ""
          }
          ${this.statusNotice ? `<div class="qg-alert is-info">${escapeHtml(this.statusNotice)}</div>` : ""}
        </div>
      `;
    }

    /* ---------------------------------------------------------
       1) واجهة الهاتف — ⚡ البرق السريع (blitz-player)
       --------------------------------------------------------- */
    _renderBlitzBodyHtml(pub) {
      if (!pub || pub.phase === "setup") return this._renderWaitingLobbyHtml(pub);
      const isJudge = this._isJudge();
      const sync = window.SeenJeemQuickGamesSync;
      const utils = window.SeenJeemQuickGamesSyncUtils;
      const rem = utils && pub.timer ? utils.computeRemainingSeconds(pub.timer, sync ? sync.getServerTimeOffsetMs() : 0) : 0;
      const bz = pub.buzzerState || { status: "locked" };
      const myUid = sync ? sync.getUid() : "";
      const isMyBuzz = bz.status === "buzzed" && bz.winnerUid === myUid;

      let judgeSection = "";
      if (isJudge) {
        const priv = this.privateJudge || {};
        judgeSection = `
          <div class="qg-judge-panel">
            <div class="qg-judge-head">👑 لوحة الحكم السرية (تظهر على هاتفك فقط)</div>
            ${
              pub.phase === "playing" && priv.answer
                ? `<div class="qg-secret-answer-box">
                    <span class="qg-secret-label">✅ الإجابة الصحيحة:</span>
                    <strong class="qg-secret-answer-val">${escapeHtml(priv.answer)}</strong>
                  </div>`
                : ""
            }
            <div class="qg-judge-actions-grid">
              ${
                pub.phase === "ready"
                  ? `<button type="button" class="btn btn-amber qg-btn-lg" data-qg-act="cmd" data-cmd="BEGIN_TURN">🚀 ابدأ المؤقت الآن</button>`
                  : pub.phase === "playing"
                    ? `
                      <button type="button" class="btn btn-steal-win qg-btn" data-qg-act="cmd" data-cmd="JUDGE_CORRECT">✅ صحيح (+100)</button>
                      <button type="button" class="btn btn-danger-outline qg-btn" data-qg-act="cmd" data-cmd="JUDGE_WRONG">❌ خطأ</button>
                      <button type="button" class="btn btn-secondary qg-btn" data-qg-act="cmd" data-cmd="JUDGE_SKIP">⏭️ تخطي</button>
                      <button type="button" class="btn btn-gold-outline qg-btn" data-qg-act="cmd" data-cmd="REVEAL_ANSWER">👁️ كشف الإجابة</button>
                      <button type="button" class="btn btn-secondary qg-btn" data-qg-act="cmd" data-cmd="TOGGLE_TIMER">⏯️ إيقاف / استئناف</button>
                    `
                    : pub.phase === "turn-summary"
                      ? `<button type="button" class="btn btn-primary qg-btn-lg" data-qg-act="cmd" data-cmd="NEXT_TURN">⬅️ الدور التالي</button>`
                      : ""
              }
            </div>
          </div>
        `;
      }

      if (pub.phase === "finished") {
        return `
          <div class="qg-card qg-finish-card">
            <div class="qg-finish-trophy">🏆</div>
            <h2>${escapeHtml(pub.winnerTitle || "نهاية جولة البرق السريعة!")}</h2>
            ${this._renderScoreboardHtml(pub)}
          </div>
        `;
      }

      if (pub.phase === "turn-summary") {
        return `
          <div class="qg-card">
            <div class="qg-meta-row">
              <span class="qg-pill">⏰ انتهى دور ${escapeHtml(pub.activeTeamName)}</span>
            </div>
            ${this._renderScoreboardHtml(pub)}
            ${
              Array.isArray(pub.pastItems) && pub.pastItems.length > 0
                ? `<div class="qg-past-list">
                    ${pub.pastItems
                      .map(
                        (it) => `
                      <div class="qg-past-item">
                        <div class="qg-past-q">${escapeHtml(it.label)}</div>
                        <div class="qg-past-a">✅ ${escapeHtml(it.answer)}</div>
                      </div>
                    `
                      )
                      .join("")}
                  </div>`
                : ""
            }
            ${judgeSection}
          </div>
        `;
      }

      return `
        <div class="qg-card">
          <div class="qg-meta-row">
            <span class="qg-pill">⚡ الجولة ${Number(pub.roundNumber) || 1} / ${Number(pub.totalRounds) || 1}</span>
            <span class="qg-pill is-team">دور: ${escapeHtml(pub.activeTeamName || "الجميع")}</span>
            ${pub.streak >= 2 ? `<span class="qg-pill is-streak">🔥 سلسلة ×${pub.streak}</span>` : ""}
          </div>

          <div class="qg-timer-box">
            <div id="qg-live-timer" class="qg-timer-val${rem > 0 && rem <= 10 ? " is-danger" : ""}">${formatMmSs(rem)}</div>
          </div>

          ${this._renderScoreboardHtml(pub)}

          ${
            pub.phase === "ready"
              ? `<div class="qg-ready-banner">استعد! دور <strong>${escapeHtml(pub.activeTeamName)}</strong> على وشك الانطلاق...</div>`
              : `
                <div class="qg-question-card">
                  ${pub.category ? `<div class="qg-cat-tag">${escapeHtml(pub.categoryIcon || "⚡")} ${escapeHtml(pub.category)}</div>` : ""}
                  <p class="qg-question-text">${escapeHtml(pub.questionText || "استعد للسؤال...")}</p>
                  ${
                    pub.revealedAnswer
                      ? `<div class="qg-revealed-box">✅ الإجابة الصحيحة: <strong>${escapeHtml(pub.revealedAnswer)}</strong></div>`
                      : ""
                  }
                </div>

                ${
                  bz.status === "buzzed" && bz.winnerName
                    ? `<div class="qg-buzz-result${isMyBuzz ? " is-mine" : ""}">
                        🔔 الأسرع بالجرس: <strong>${escapeHtml(bz.winnerAvatar || "🎯")} ${escapeHtml(bz.winnerName)}</strong>
                        ${bz.winnerTeamName ? `<span>(${escapeHtml(bz.winnerTeamName)})</span>` : ""}
                      </div>`
                    : !isJudge
                      ? `<button type="button" class="qg-buzzer-btn${bz.status !== "open" || this._buzzLockLocal ? " is-locked" : ""}" data-qg-act="buzz" ${bz.status !== "open" || this._buzzLockLocal ? "disabled" : ""}>
                          <span class="qg-buzzer-ico">🔔</span>
                          <span>${bz.status === "open" ? "جرس السرعة!" : "الجرس مقفل مؤقتاً"}</span>
                        </button>`
                      : ""
                }
              `
          }

          ${judgeSection}
        </div>
      `;
    }

    /* ---------------------------------------------------------
       2) واجهة الهاتف — 🎭 من غير كلام (mgk-player)
       --------------------------------------------------------- */
    _renderMgkBodyHtml(pub) {
      if (!pub || pub.phase === "setup") return this._renderWaitingLobbyHtml(pub);
      const isActor = this._isActiveActor();
      const sync = window.SeenJeemQuickGamesSync;
      const utils = window.SeenJeemQuickGamesSyncUtils;
      const rem = utils && pub.timer ? utils.computeRemainingSeconds(pub.timer, sync ? sync.getServerTimeOffsetMs() : 0) : 0;

      if (pub.phase === "finished") {
        return `
          <div class="qg-card qg-finish-card">
            <div class="qg-finish-trophy">🏆</div>
            <h2>${escapeHtml(pub.winnerTitle || "نهاية تحدي من غير كلام!")}</h2>
            ${this._renderScoreboardHtml(pub)}
          </div>
        `;
      }

      if (pub.phase === "turn-summary") {
        return `
          <div class="qg-card">
            <div class="qg-meta-row">
              <span class="qg-pill">⏰ انتهى دور ${escapeHtml(pub.activeTeamName)}</span>
            </div>
            ${this._renderScoreboardHtml(pub)}
            ${
              Array.isArray(pub.pastItems) && pub.pastItems.length > 0
                ? `<div class="qg-past-list">
                    <div class="qg-section-sub">📋 كلمات الدور المنتهي:</div>
                    ${pub.pastItems
                      .map(
                        (it) => `
                      <div class="qg-past-item">
                        <span>🎭 ${escapeHtml(it.answer)}</span>
                        <span class="qg-past-tag">${it.outcome === "guessed" ? "✅ +100" : "⏭️ تبديل"}</span>
                      </div>
                    `
                      )
                      .join("")}
                  </div>`
                : ""
            }
            <div class="qg-action-stack">
              ${isActor ? `<button type="button" class="btn btn-primary qg-btn-lg" data-qg-act="cmd" data-cmd="NEXT_TURN">⬅️ الدور التالي</button>` : ""}
              <button type="button" class="btn btn-gold-outline qg-btn-lg" data-qg-act="cmd" data-cmd="CLAIM_NEXT_ACTOR">🎭 أنا الممثّل في الدور القادم</button>
            </div>
            ${this.statusNotice ? `<div class="qg-alert is-info">${escapeHtml(this.statusNotice)}</div>` : ""}
          </div>
        `;
      }

      const priv = this.privateActor || {};
      const canSkip = pub.skipsRemaining === null || pub.skipsRemaining === undefined || pub.skipsRemaining > 0;

      return `
        <div class="qg-card">
          <div class="qg-meta-row">
            <span class="qg-pill">🎭 الجولة ${Number(pub.roundNumber) || 1} / ${Number(pub.totalRounds) || 1}</span>
            <span class="qg-pill is-team">فريق: ${escapeHtml(pub.activeTeamName)}</span>
          </div>

          <div class="qg-actor-banner">
            <span>الممثّل الآن:</span>
            <strong>${escapeHtml(pub.activeActorAvatar || "🎭")} ${escapeHtml(pub.activeActorName || pub.activeTeamName)}</strong>
          </div>

          <div class="qg-timer-box">
            <div id="qg-live-timer" class="qg-timer-val${rem > 0 && rem <= 10 ? " is-danger" : ""}">${formatMmSs(rem)}</div>
          </div>

          ${this._renderScoreboardHtml(pub)}

          ${
            pub.phase === "ready"
              ? `
                <div class="qg-ready-banner">
                  ${
                    isActor
                      ? "🎬 أنت الممثّل في هذا الدور! اضغط للبدء وستظهر الكلمة السرية على هاتفك فقط."
                      : `🎬 استعد للتخمين! الممثّل القادم: ${escapeHtml(pub.activeActorName || pub.activeTeamName)}`
                  }
                </div>
                <div class="qg-action-stack">
                  ${
                    isActor
                      ? `<button type="button" class="btn btn-amber qg-btn-lg" data-qg-act="cmd" data-cmd="BEGIN_TURN">▶️ ابدأ المؤقت</button>`
                      : `<button type="button" class="btn btn-gold-outline qg-btn-lg" data-qg-act="cmd" data-cmd="CLAIM_NEXT_ACTOR">🎭 أنا الممثّل في الدور القادم</button>`
                  }
                </div>
              `
              : isActor
                ? `
                  <!-- بطاقة الكلمة السرية للممثّل فقط بآلية الضغط المطوّل -->
                  <div class="qg-actor-secret-stage select-none">
                    <div class="qg-cat-tag">${escapeHtml(priv.category || pub.category || "من غير كلام")} ${priv.wordCount ? `• ${escapeHtml(priv.wordCount)}` : ""} • ${Number(priv.points) || 100} نقطة</div>
                    <div id="qg-actor-decoy" class="qg-actor-decoy"${this.holdRevealing ? " hidden" : ""}>
                      <div class="qg-decoy-ico">🙈</div>
                      <strong>الكلمة مخفية لحمايتها من التلصّص</strong>
                      <span>اضغط مطوّلاً على الزر بالأسفل لرؤية الكلمة السرية</span>
                    </div>
                    <div id="qg-actor-secret" class="qg-actor-secret"${this.holdRevealing ? "" : " hidden"}>
                      <span class="qg-secret-label">🤫 للممثّل فقط!</span>
                      <div class="qg-secret-word-val">${escapeHtml(priv.word || "جاري تحميل الكلمة...")}</div>
                      ${priv.explanation ? `<div class="qg-secret-hint">🎬 ${escapeHtml(priv.explanation)}</div>` : ""}
                      ${priv.hints ? `<div class="qg-secret-hint">💡 ${escapeHtml(priv.hints)}</div>` : ""}
                    </div>
                    <button type="button" id="qg-btn-hold-actor-word" class="btn btn-amber qg-btn-lg qg-hold-btn${this.holdRevealing ? " is-holding" : ""}">
                      👆 اضغط مع الاستمرار لكشف الكلمة
                    </button>
                  </div>

                  <div class="qg-actor-controls-grid">
                    <button type="button" class="btn btn-steal-win qg-btn" data-qg-act="cmd" data-cmd="MGK_GUESSED">✅ جابوها! (+100)</button>
                    <button type="button" class="btn btn-secondary qg-btn" data-qg-act="cmd" data-cmd="MGK_SKIP" ${!canSkip ? "disabled" : ""}>
                      🔄 تبديل الكلمة${pub.skipsRemaining !== null && pub.skipsRemaining !== undefined ? ` (${pub.skipsRemaining})` : ""}
                    </button>
                    <button type="button" class="btn btn-ghost qg-btn" data-qg-act="cmd" data-cmd="TOGGLE_TIMER">⏯️ إيقاف / استئناف</button>
                  </div>
                `
                : `
                  <!-- شاشة المخمّنين والمتفرّجين (صفر تسريب للكلمة السرية!) -->
                  <div class="qg-guesser-card">
                    <div class="qg-cat-tag">${escapeHtml(pub.category || "من غير كلام")}</div>
                    ${pub.wordCountLabel ? `<div class="qg-word-count-big">${escapeHtml(pub.wordCountLabel)}</div>` : ""}
                    ${pub.hintText ? `<div class="qg-alert is-info">💡 تلميح: ${escapeHtml(pub.hintText)}</div>` : ""}
                    <p class="qg-guesser-note">شاهد الممثّل وخمّن الكلمة بصوت عالٍ قبل انتهاء الوقت!</p>
                  </div>

                  ${
                    Array.isArray(pub.pastItems) && pub.pastItems.length > 0
                      ? `<div class="qg-past-list">
                          <div class="qg-section-sub">📋 الكلمات السابقة في هذا الدور:</div>
                          ${pub.pastItems
                            .map(
                              (it) => `
                            <div class="qg-past-item">
                              <span>${escapeHtml(it.answer)}</span>
                              <span class="qg-past-tag">${it.outcome === "guessed" ? "✅" : "⏭️"}</span>
                            </div>
                          `
                            )
                            .join("")}
                        </div>`
                      : ""
                  }

                  <button type="button" class="btn btn-gold-outline qg-btn-lg" data-qg-act="cmd" data-cmd="CLAIM_NEXT_ACTOR">
                    🎭 أنا الممثّل في الدور القادم
                  </button>
                `
          }
          ${this.statusNotice ? `<div class="qg-alert is-info">${escapeHtml(this.statusNotice)}</div>` : ""}
        </div>
      `;
    }

    /* ---------------------------------------------------------
       3) واجهة الهاتف — 🎵 تحدي الصوت (audio-player)
       --------------------------------------------------------- */
    _renderAudioBodyHtml(pub) {
      if (!pub || pub.phase === "setup") return this._renderWaitingLobbyHtml(pub);
      const isJudge = this._isJudge();
      const sync = window.SeenJeemQuickGamesSync;
      const myUid = sync ? sync.getUid() : "";
      const bz = pub.buzzerState || { status: "locked" };
      const isMyBuzz = bz.status === "buzzed" && bz.winnerUid === myUid;
      const ap = pub.audioPlayback || { playing: false, mode: "progressive", stageLevel: 0, stageLabel: "", currentPoints: 100 };

      if (pub.phase === "summary" || pub.phase === "finished") {
        return `
          <div class="qg-card qg-finish-card">
            <div class="qg-finish-trophy">🎵🏆</div>
            <h2>${escapeHtml(pub.winnerTitle || "انتهت جولة تحدي الصوت!")}</h2>
            ${this._renderScoreboardHtml(pub)}
          </div>
        `;
      }

      let judgeSection = "";
      if (isJudge) {
        const priv = this.privateJudge || {};
        judgeSection = `
          <div class="qg-judge-panel">
            <div class="qg-judge-head">👑 لوحة تحكم الحكم السرية (تظهر على هاتفك فقط)</div>
            ${
              priv.answer
                ? `<div class="qg-secret-answer-box">
                    <span class="qg-secret-label">✅ الإجابة الصحيحة:</span>
                    <strong class="qg-secret-answer-val">${escapeHtml(priv.answer)}</strong>
                    ${priv.explanation ? `<small>${escapeHtml(priv.explanation)}</small>` : ""}
                  </div>`
                : ""
            }
            <div class="qg-judge-actions-grid">
              <button type="button" class="btn btn-primary qg-btn" data-qg-act="cmd" data-cmd="AUDIO_PLAY">▶️ تشغيل</button>
              <button type="button" class="btn btn-amber qg-btn" data-qg-act="cmd" data-cmd="AUDIO_PAUSE">⏸️ إيقاف</button>
              <button type="button" class="btn btn-secondary qg-btn" data-qg-act="cmd" data-cmd="AUDIO_REPLAY">🔁 إعادة</button>
              ${
                ap.mode === "progressive"
                  ? `
                    <button type="button" class="btn ${ap.stageLevel === 0 ? "btn-amber" : "btn-secondary"} qg-btn" data-qg-act="cmd" data-cmd="AUDIO_STAGE" data-level="0">3ث (+300)</button>
                    <button type="button" class="btn ${ap.stageLevel === 1 ? "btn-amber" : "btn-secondary"} qg-btn" data-qg-act="cmd" data-cmd="AUDIO_STAGE" data-level="1">7ث (+200)</button>
                    <button type="button" class="btn ${ap.stageLevel === 2 ? "btn-amber" : "btn-secondary"} qg-btn" data-qg-act="cmd" data-cmd="AUDIO_STAGE" data-level="2">كامل (+100)</button>
                  `
                  : ""
              }
              <button type="button" class="btn btn-steal-win qg-btn" data-qg-act="cmd" data-cmd="AUDIO_CORRECT">✅ إجابة صحيحة</button>
              <button type="button" class="btn btn-danger-outline qg-btn" data-qg-act="cmd" data-cmd="AUDIO_WRONG_CONTINUE">❌ خطأ ومتابعة</button>
              <button type="button" class="btn btn-gold-outline qg-btn" data-qg-act="cmd" data-cmd="AUDIO_REVEAL">👁️ كشف الإجابة</button>
              <button type="button" class="btn btn-primary qg-btn" data-qg-act="cmd" data-cmd="AUDIO_NEXT">⬅️ المقطع التالي</button>
            </div>
          </div>
        `;
      }

      return `
        <div class="qg-card">
          <div class="qg-meta-row">
            <span class="qg-pill">🎵 الجولة ${Number(pub.roundNumber) || 1} / ${Number(pub.totalRounds) || 1}</span>
            <span class="qg-pill">${escapeHtml(pub.categoryIcon || "🎵")} ${escapeHtml(pub.category || "تحدي الصوت")}</span>
          </div>

          <div class="qg-audio-status-box${ap.playing ? " is-playing" : ""}">
            <div class="qg-audio-status-text">${ap.playing ? "🔊 المقطع يعمل الآن..." : "⏸️ متوقف مؤقتاً"}</div>
            ${
              ap.mode === "progressive"
                ? `<div class="qg-prog-pills">
                    <span class="qg-prog-pill${ap.stageLevel === 0 ? " active" : ""}">3 ثوانٍ = 300 نقطة</span>
                    <span class="qg-prog-pill${ap.stageLevel === 1 ? " active" : ""}">7 ثوانٍ = 200 نقطة</span>
                    <span class="qg-prog-pill${ap.stageLevel === 2 ? " active" : ""}">كامل = 100 نقطة</span>
                  </div>`
                : `<div class="qg-prog-pills"><span class="qg-prog-pill active">قيمة الجولة: +${Number(ap.currentPoints) || 100} نقطة</span></div>`
            }
          </div>

          ${this._renderScoreboardHtml(pub)}

          ${
            pub.phase === "revealed" && pub.revealedAnswer
              ? `
                <div class="qg-revealed-box is-big">
                  <div class="qg-secret-label">✅ الإجابة الصحيحة</div>
                  <div class="qg-revealed-answer-val">${escapeHtml(pub.revealedAnswer)}</div>
                  ${pub.revealedExplanation ? `<p class="qg-revealed-exp">${escapeHtml(pub.revealedExplanation)}</p>` : ""}
                  ${pub.revealedAnswerImage ? `<img src="${escapeHtml(pub.revealedAnswerImage)}" class="qg-revealed-img" alt="صورة الإجابة" />` : ""}
                  ${pub.roundAwardedTeamName ? `<div class="qg-award-tag">🏆 +${pub.roundAwardedPoints} نقطة لـ ${escapeHtml(pub.roundAwardedTeamName)}</div>` : ""}
                </div>
              `
              : bz.status === "buzzed" && bz.winnerName
                ? `
                  <div class="qg-buzz-result${isMyBuzz ? " is-mine" : ""}">
                    🔔 الأسرع بالجرس: <strong>${escapeHtml(bz.winnerAvatar || "🎯")} ${escapeHtml(bz.winnerName)}</strong>
                    ${bz.winnerTeamName ? `<span>(${escapeHtml(bz.winnerTeamName)})</span>` : ""}
                    <small>تم إيقاف الصوت تلقائياً لسماع الإجابة</small>
                  </div>
                `
                : !isJudge
                  ? `
                    <button type="button" class="qg-buzzer-btn is-audio${bz.status !== "open" || this._buzzLockLocal ? " is-locked" : ""}" data-qg-act="buzz" ${bz.status !== "open" || this._buzzLockLocal ? "disabled" : ""}>
                      <span class="qg-buzzer-ico">🔔</span>
                      <span>${bz.status === "open" ? "أعرف الإجابة!" : "انتظر تشغيل المقطع..."}</span>
                    </button>
                  `
                  : ""
          }

          ${judgeSection}
        </div>
      `;
    }

    _render() {
      if (!this.root) return;
      let mainHtml = "";
      if (this.kicked) {
        mainHtml = `
          <div class="qg-card qg-wait-card">
            <div class="qg-wait-icon">🚫</div>
            <h2>تم استبعاد جهازك من الغرفة</h2>
            <p>أغلق هذه الصفحة أو اطلب من منظّم الجلسة السماح لك بالانضمام مجدداً.</p>
          </div>
        `;
      } else if (this.roomMissing) {
        mainHtml = `
          <div class="qg-card qg-wait-card">
            <div class="qg-wait-icon">🏁</div>
            <h2>انتهت غرفة اللعب</h2>
            <p>تم إغلاق الغرفة من الشاشة الرئيسية. يمكنك مسح رمز جديد للانضمام لجلسة أخرى.</p>
          </div>
        `;
      } else if (!this.joined) {
        mainHtml = this._renderJoinHtml();
      } else if (this.gameType === "mgk") {
        mainHtml = this._renderMgkBodyHtml(this.publicState);
      } else if (this.gameType === "audio") {
        mainHtml = this._renderAudioBodyHtml(this.publicState);
      } else {
        mainHtml = this._renderBlitzBodyHtml(this.publicState);
      }

      this.root.innerHTML = `${this._renderHeaderHtml()}<main class="qg-main">${mainHtml}</main>`;
    }
  }

  window.SeenJeemQuickGamePlayerView = new QuickGamePlayerViewController();
})();
