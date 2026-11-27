/**
 * واجهة هاتف اللاعب للعبة «المافيا» (?mode=mafia-player&room=CODE) — Pack 14
 * - موبايل-أولاً RTL بأزرار >= 48px بدون تمرير أفقي
 * - حفظ الاسم والغرفة في sessionStorage لتجنّب فقدان الجلسة عند تحديث الصفحة
 * - بطاقة الدور السري بآلية الضغط المطوّل (Hold-to-Reveal) + زر «👁️ تذكير بدوري» طوال الجلسة
 * - التمويه الذكي الليلي: كل لاعب حي يتفاعل مع قائمة اللاعبين بغض النظر عن دوره
 * - وضع المتفرج للمُقصَين + شريط «👑 تحكم الجلسة» للاعب الأول (VIP)
 */
(function () {
  "use strict";

  const NAME_KEY = "mafia_player_name_v1";
  const JOINED_ROOM_KEY = "mafia_joined_room_v1";

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

  class MafiaPlayerMobileController {
    constructor() {
      this.root = null;
      this.roomCode = "";
      this.playerName =
        this._loadSession(NAME_KEY) ||
        (window.SeenJeemProfile && window.SeenJeemProfile.getRoomIdentity().name) ||
        "";
      this.joined = false;
      this.preApproved = false;
      this.connected = false;
      this.kicked = false;
      this.meta = null;
      this.publicState = null;
      this.privateRole = null;
      this.privateIntel = null;
      this.playersMap = {};
      this.errorMessage = "";

      this.holdingRole = false;
      this.readySentGameId = "";
      this.nightSentRound = 0;
      this.nightPickedTargetName = "";
      this.voteSentRound = 0;
      this.votePickedLabel = "";
      this.rulesGuideOpen = false;
      this.mayorConfirmOpen = false;
      this.mayorRevealSending = false;
      this._timerLoop = null;
    }

    init() {
      this.root = document.getElementById("mafia-player-root");
      if (!this.root) return;

      document.title = "سين جيم | المافيا — هاتف اللاعب";
      document.body.classList.add("player-mobile-mode");
      document
        .querySelectorAll(
          "body > .screen, body > .modal-overlay, #tv-display-root, #remote-host-root, #player-view-root, #bara-player-root"
        )
        .forEach((el) => {
          el.hidden = true;
          el.classList.remove("active", "open");
        });

      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");

      const rtUtils = window.SeenJeemRealtimeUtils;
      const params = rtUtils ? rtUtils.getUrlParams() : { room: "" };
      this.roomCode = params.room || this._loadSession(JOINED_ROOM_KEY) || "";

      this._render();
      if (this.roomCode) {
        this._connectToRoom(
          this.roomCode,
          Boolean(this.playerName && this._loadSession(JOINED_ROOM_KEY) === this.roomCode)
        );
      }
    }

    _loadSession(key) {
      try {
        return (sessionStorage.getItem(key) || "").trim();
      } catch (_e) {
        return "";
      }
    }

    _saveSession(key, val) {
      try {
        if (val) sessionStorage.setItem(key, String(val));
        else sessionStorage.removeItem(key);
      } catch (_e) {}
    }

    _getMyUid() {
      return window.SeenJeemMafiaSync ? window.SeenJeemMafiaSync.getUid() : "";
    }

    _getMeInRoster() {
      const uid = this._getMyUid();
      const list = (this.publicState && Array.isArray(this.publicState.playersRoster) && this.publicState.playersRoster) || [];
      return list.find((p) => p.uid === uid) || null;
    }

    _isVip() {
      const uid = this._getMyUid();
      if (!uid) return false;
      const vipEnabled =
        this.meta && typeof this.meta.vipEnabled === "boolean"
          ? this.meta.vipEnabled
          : this.publicState
            ? this.publicState.vipEnabled !== false
            : true;
      const vipUid = (this.meta && this.meta.vipUid) || (this.publicState && this.publicState.vipUid) || "";
      return Boolean(vipEnabled && vipUid && vipUid === uid);
    }

    _stopTimerLoop() {
      if (this._timerLoop) {
        clearInterval(this._timerLoop);
        this._timerLoop = null;
      }
    }

    _formatLiveTimer(timerObj) {
      if (!timerObj) return "";
      if (timerObj.status === "unlimited") return "∞";
      const sync = window.SeenJeemMafiaSync;
      const utils = window.SeenJeemMafiaSyncUtils;
      const offset = sync && typeof sync.getServerTimeOffsetMs === "function" ? sync.getServerTimeOffsetMs() : 0;
      const secs =
        utils && typeof utils.computeRemainingSeconds === "function"
          ? utils.computeRemainingSeconds(timerObj, 0, offset)
          : 0;
      return secs === null ? "∞" : formatTime(secs);
    }

    _syncTimerLoop() {
      const t = this.publicState ? this.publicState.timer : null;
      const running = Boolean(t && t.status === "running" && Number.isFinite(t.endAtMs));
      if (!running) {
        this._stopTimerLoop();
        return;
      }
      if (this._timerLoop) return;
      this._timerLoop = setInterval(() => {
        const curT = this.publicState ? this.publicState.timer : null;
        if (!curT || curT.status !== "running") {
          this._stopTimerLoop();
          return;
        }
        const el = document.getElementById("mp-live-timer");
        if (el) el.textContent = this._formatLiveTimer(curT);
      }, 250);
    }

    async _connectToRoom(code, autoJoin = false) {
      const clean = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (clean.length < 4) {
        this.errorMessage = "يرجى إدخال رمز غرفة صحيح من 6 أحرف/أرقام.";
        this._render();
        return;
      }
      const sync = window.SeenJeemMafiaSync;
      if (!sync || !sync.isConfigured()) {
        this.errorMessage = "تعذّر الاتصال بغرفة اللعب حالياً — تأكد من الإنترنت وحاول مجدداً.";
        this._render();
        return;
      }

      this.kicked = false;
      this.roomCode = clean;
      this.errorMessage = "";
      this._render();

      try {
        await sync.connectAsPlayer({
          roomCode: clean,
          onKicked: () => {
            this._stopTimerLoop();
            this.kicked = true;
            this.joined = false;
            this.connected = false;
            this.publicState = null;
            this.privateRole = null;
            this.privateIntel = null;
            this._saveSession(JOINED_ROOM_KEY, "");
            this._render();
          },
          onMeta: (m) => {
            this.meta = m;
            this._render();
          },
          onPlayers: (map) => {
            this.playersMap = map && typeof map === "object" ? map : {};
            const myUid = this._getMyUid();
            if (myUid && this.playersMap[myUid]) this.joined = true;
            if (!this.joined || (this.publicState && this.publicState.phase === "setup")) {
              this._render();
            }
          },
          onPublicState: (pub) => {
            const prevGameId = this.publicState ? this.publicState.gameId : "";
            const prevRound = this.publicState ? this.publicState.roundNumber : 0;
            this.publicState = pub;
            if (pub && pub.gameId !== prevGameId) {
              this.holdingRole = false;
              this.readySentGameId = "";
              this.nightSentRound = 0;
              this.voteSentRound = 0;
            }
            if (pub && pub.roundNumber !== prevRound) {
              this.nightPickedTargetName = "";
              this.votePickedLabel = "";
            }
            this._render();
            this._syncTimerLoop();
          },
          onPrivateRole: (role) => {
            this.privateRole = role;
            this._render();
          },
          onPrivateIntel: (intel) => {
            this.privateIntel = intel;
            this._render();
          },
          onConnectionState: (isConn) => {
            this.connected = isConn;
            if (!this.kicked) this._render();
          },
          onError: (err) => {
            this.errorMessage = (err && err.message) || "تعذّر الاتصال بالغرفة.";
            this._render();
          }
        });

        this.preApproved = await sync.isPlayerPreApproved();
        if (autoJoin && this.playerName) {
          await this._joinWithName(this.playerName);
        } else {
          this._render();
        }
      } catch (err) {
        this.errorMessage = (err && err.message) || "تعذّر الانضمام للغرفة.";
        this._render();
      }
    }

    async _joinWithName(rawName) {
      if (this.kicked) return;
      const cleanName = String(rawName || "").trim().slice(0, 24);
      if (!cleanName) {
        this.errorMessage = "يرجى كتابة اسمك أولاً.";
        this._render();
        return;
      }
      this.playerName = cleanName;
      this._saveSession(NAME_KEY, cleanName);

      const sync = window.SeenJeemMafiaSync;
      if (!sync || !sync.isActive()) {
        await this._connectToRoom(this.roomCode, true);
        return;
      }

      const isLocked = Boolean((this.meta && this.meta.joinLocked) || (this.publicState && this.publicState.joinLocked));
      if (isLocked && !this.joined && !this.preApproved) {
        this.errorMessage = "🔒 الغرفة مقفلة حالياً من قِبل المقدّم";
        this._render();
        return;
      }

      const res = await sync.registerPlayer(cleanName);
      if (res.ok) {
        this.joined = true;
        this.errorMessage = "";
        this._saveSession(JOINED_ROOM_KEY, this.roomCode);
      } else {
        this.errorMessage = res.error || "تعذّر الانضمام.";
      }
      this._render();
    }

    _render() {
      if (!this.root) return;
      const phase = (this.publicState && this.publicState.phase) || "setup";
      const isNight = this.joined && phase === "night";
      this.root.classList.toggle("is-mafia-night", isNight);

      let mainHtml = "";
      if (this.kicked) {
        mainHtml = `
          <div class="mp-card mp-center">
            <div class="mp-big-emoji">🚫</div>
            <h2>تم إخراجك من الغرفة</h2>
            <p class="mp-muted">قام المقدّم بإزالة جهازك من غرفة المافيا الحالية.</p>
          </div>
        `;
      } else if (!this.joined) {
        mainHtml = this._renderJoinHtml();
      } else {
        mainHtml = this._renderGamePhaseHtml(phase);
      }

      const showReminder =
        this.joined && this.privateRole && phase !== "setup" && phase !== "role_reveal" && phase !== "game_over";
      const vipBar = this.joined && this._isVip() ? this._renderVipBarHtml(phase) : "";

      this.root.innerHTML = `
        <div class="mp-shell">
          <header class="mp-topbar">
            <div class="mp-brand">🎭 <span>المافيا</span></div>
            <div class="mp-meta-pills">
              ${
                this.joined
                  ? `<button type="button" id="mp-btn-rules-guide" class="btn btn-ghost btn-xxs mp-guide-btn">📖 القواعد</button>`
                  : ""
              }
              ${this.roomCode ? `<span class="mp-code-pill">${escapeHtml(this.roomCode)}</span>` : ""}
              <span class="mp-conn-dot ${this.connected ? "is-on" : ""}">${this.connected ? "🟢 متصل" : "⚪ اتصال..."}</span>
            </div>
          </header>

          ${this.errorMessage ? `<div class="mp-error-banner">${escapeHtml(this.errorMessage)}</div>` : ""}
          ${this.joined && this.rulesGuideOpen ? this._renderRulesGuideHtml() : ""}

          ${
            showReminder
              ? `
                <div class="mp-reminder-strip">
                  <button type="button" id="mp-btn-role-reminder" class="btn btn-secondary mp-hold-btn">
                    👁️ اضغط مطوّلاً لتذكيرك بدورك السري
                  </button>
                  <div id="mp-role-reminder-drawer" class="mp-secret-drawer" hidden>
                    ${this._renderSecretRoleInnerHtml()}
                  </div>
                </div>
              `
              : ""
          }

          <main class="mp-main">${mainHtml}</main>
          ${vipBar}
        </div>
      `;

      this._bindRenderedEvents();
    }

    _renderRulesGuideHtml() {
      const pub = this.publicState || {};
      const rules = pub.rulesSummary || {};
      const rosterCount = Array.isArray(pub.playersRoster) ? pub.playersRoster.length : 6;
      const activeRoles =
        window.SeenJeemMafiaEngine && typeof window.SeenJeemMafiaEngine.getActiveRolesForGuide === "function"
          ? window.SeenJeemMafiaEngine.getActiveRolesForGuide(rules, rosterCount)
          : [
              { icon: "🕵️", label: "مافيا", team: "mafia", description: "يتفق أفراد المافيا ليلاً على إقصاء لاعب واحد." },
              { icon: "🩺", label: "الطبيب", team: "citizens", description: "يحمي لاعباً واحداً كل ليلة من هجوم المافيا." },
              { icon: "🔍", label: "المحقق", team: "citizens", description: "يفحص لاعباً كل ليلة وتصله النتيجة سراً عند الفجر." },
              { icon: "🏘️", label: "مواطن", team: "citizens", description: "يكتشف المافيا في النقاش ويصوّت لإقصائهم." }
            ];
      return `
        <section class="mp-card mp-rules-guide-card">
          <div class="mp-rules-guide-head">
            <strong>📖 شرح الأدوار والقواعد (الجلسة الحالية)</strong>
            <button type="button" id="mp-btn-close-rules" class="btn btn-ghost btn-xxs">✕ إغلاق</button>
          </div>
          <div class="mp-rules-roles-list">
            ${activeRoles
              .map(
                (r) => `
              <div class="mp-rules-role-row team-${escapeHtml(r.team || "citizens")}">
                <span class="mp-rules-role-name">${escapeHtml(r.icon)} <strong>${escapeHtml(r.label)}</strong></span>
                <span class="mp-rules-role-desc">${escapeHtml(r.description)}</span>
              </div>
            `
              )
              .join("")}
          </div>
          <div class="mp-rules-summary-box">
            <div>🌙 <strong>الليل:</strong> يختار الجميع من هواتفهم معاً للحفاظ على السرية التامة.</div>
            <div>☀️ <strong>النهار:</strong> نقاش حر ثم تصويت سري لإقصاء المشتبه به.</div>
            <div>🏆 <strong>الفوز:</strong> يفوز المواطنون بإقصاء كل المافيا، وتفوز المافيا عند التساوي في العدد.</div>
          </div>
        </section>
      `;
    }

    _renderJoinHtml() {
      const playersCount = Object.keys(this.playersMap || {}).length;
      return `
        <form id="mp-join-form" class="mp-card mp-join-card">
          <div class="mp-big-emoji">🎭</div>
          <h2>انضم لغرفة المافيا</h2>
          <p class="mp-muted">أدخل رمز الغرفة واسمك لتستلم دورك السري على هاتفك.</p>
          <label class="mp-label" for="mp-room-input">رمز الغرفة (6 أحرف/أرقام)</label>
          <input id="mp-room-input" type="text" class="text-input mp-input" maxlength="6" value="${escapeHtml(this.roomCode)}" placeholder="مثال: K7M4P2" autocomplete="off" />
          <label class="mp-label" for="mp-name-input">اسمك في الجلسة</label>
          <input id="mp-name-input" type="text" class="text-input mp-input" maxlength="24" value="${escapeHtml(this.playerName)}" placeholder="اكتب اسمك..." autocomplete="off" />
          <button type="submit" class="btn btn-primary mp-big-btn">🎭 دخول الغرفة</button>
          ${playersCount > 0 ? `<div class="mp-muted mp-small-note">👥 يوجد حالياً ${playersCount} لاعب في اللوبي</div>` : ""}
        </form>
      `;
    }

    _renderSecretRoleInnerHtml() {
      const r = this.privateRole;
      if (!r) return `<div class="mp-muted">بانتظار توزيع الأدوار...</div>`;
      const teammates = Array.isArray(r.teammates) ? r.teammates : [];
      return `
        <div class="mp-role-reveal-box team-${escapeHtml(r.team || "citizens")}">
          <div class="mp-role-icon">${escapeHtml(r.roleIcon || "🎭")}</div>
          <div class="mp-role-title">${escapeHtml(r.roleLabel || "مواطن")}</div>
          <p class="mp-role-desc">${escapeHtml(r.roleDescription || "")}</p>
          ${
            r.role === "mafia"
              ? `<div class="mp-teammates-box">
                  ${teammates.length > 0 ? `🕵️ شركاؤك في المافيا: <strong>${teammates.map((t) => escapeHtml(t.name)).join("، ")}</strong>` : "🕵️ أنت المافيا الوحيد في هذه الجولة!"}
                </div>`
              : ""
          }
        </div>
      `;
    }

    _renderGamePhaseHtml(phase) {
      const pub = this.publicState || {};
      const me = this._getMeInRoster();
      const myUid = this._getMyUid();
      const isAlive = !me || me.alive !== false;

      if (phase === "setup") {
        const roster = Array.isArray(pub.playersRoster) ? pub.playersRoster : [];
        return `
          <div class="mp-card mp-center">
            <div class="mp-big-emoji">🎭</div>
            <h2>أهلاً يا ${escapeHtml(this.playerName)}!</h2>
            <p class="mp-muted">أنت في لوبي المافيا — بانتظار بدء الجلسة (${roster.length} لاعب متصل).</p>
            <div class="mp-chips-wrap">
              ${roster.map((p) => `<span class="mp-chip${p.uid === myUid ? " is-me" : ""}">👤 ${escapeHtml(p.name)}</span>`).join("")}
            </div>
          </div>
        `;
      }

      if (phase === "role_reveal") {
        const isReady = this.readySentGameId === pub.gameId;
        return `
          <div class="mp-card mp-center">
            <div class="mp-phase-tag">🔐 دورك السري</div>
            <h2>اكشف دورك بسرية تامة!</h2>
            <p class="mp-muted">تأكد ألّا ينظر أحد لشاشة هاتفك، ثم اضغط مع الاستمرار على البطاقة.</p>

            <button type="button" id="mp-hold-role-card" class="mp-hold-role-card">
              <div id="mp-role-masked" class="mp-role-masked">
                <span class="mp-lock-icon">👆🔒</span>
                <strong>اضغط مع الاستمرار لكشف دورك السري</strong>
                <small>سيختفي الدور فور رفع إصبعك</small>
              </div>
              <div id="mp-role-unmasked" class="mp-role-unmasked" hidden>
                ${this._renderSecretRoleInnerHtml()}
              </div>
            </button>

            <button type="button" id="mp-btn-ready" class="btn btn-primary mp-big-btn" ${isReady ? "disabled" : ""}>
              ${isReady ? "✅ تم تأكيد جاهزيتك — بانتظار البقية..." : "✅ فهمت دوري — أنا جاهز"}
            </button>
          </div>
        `;
      }

      if (phase === "game_over" && pub.gameOverData) {
        const go = pub.gameOverData;
        return `
          <div class="mp-card mp-center">
            <div class="mp-big-emoji">${go.winnerFaction === "mafia" ? "🕵️🏆" : go.winnerFaction === "jester" ? "🃏🏆" : "🏘️🏆"}</div>
            <h2>${escapeHtml(go.title || "انتهت الجلسة!")}</h2>
            <p class="mp-muted">${escapeHtml(go.subtitle || "")}</p>
            <div class="mp-reveal-list">
              ${(go.players || [])
                .map(
                  (p) => `
                <div class="mp-reveal-row team-${escapeHtml(p.team)}">
                  <span>${escapeHtml(p.roleIcon)} <strong>${escapeHtml(p.name)}</strong></span>
                  <span>${escapeHtml(p.roleLabel)} • ${p.alive ? "🟢 نجا" : "💀 أُقصي"}</span>
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        `;
      }

      // وضع المتفرج للمُقصَين طوال الليل والنهار والتصويت
      if (!isAlive) {
        return `
          <div class="mp-card mp-center mp-spectator-card">
            <div class="mp-big-emoji">👻</div>
            <h2>وضع المتفرج</h2>
            <p class="mp-muted">لقد تم إقصاؤك من هذه الجلسة — التزم الصمت واستمتع بالمشاهدة حتى كشف جميع الأدوار في النهاية!</p>
            <div class="mp-phase-tag">المرحلة الحالية: ${this._phaseArabicName(phase)}</div>
          </div>
        `;
      }

      if (phase === "night") {
        return this._renderNightActionHtml(pub, myUid);
      }

      if (phase === "dawn_report" && pub.dawnSummary) {
        const ds = pub.dawnSummary;
        const detLog = this._renderDetectiveIntelHtml();
        return `
          <div class="mp-card mp-center">
            <div class="mp-big-emoji">${ds.saved ? "🩺✨" : ds.bodyguardSacrificed ? "🛡️" : ds.eliminated ? "💀" : "☀️"}</div>
            <h2>${escapeHtml(ds.headline || "")}</h2>
            <p class="mp-muted">${escapeHtml(ds.subtitle || "")}</p>
            ${detLog}
          </div>
        `;
      }

      if (phase === "day_discussion") {
        const detLog = this._renderDetectiveIntelHtml();
        const mayorBox = this._renderMayorActionHtml(pub, myUid);
        const mayorBanner = pub.mayorAnnouncement
          ? `<div class="mp-mayor-banner">${escapeHtml(pub.mayorAnnouncement.message || "")}</div>`
          : "";
        return `
          <div class="mp-card mp-center">
            <div class="mp-phase-tag">💬 نقاش النهار — اليوم ${pub.roundNumber || 1}</div>
            ${mayorBanner}
            <h2>تناقشوا لكشف المافيا!</h2>
            <div id="mp-live-timer" class="mp-timer-big">${this._formatLiveTimer(pub.timer)}</div>
            ${mayorBox}
            ${detLog}
          </div>
        `;
      }

      if (phase === "day_voting") {
        const alreadyVoted = this.voteSentRound === pub.roundNumber;
        const targets = (pub.playersRoster || []).filter((p) => p.alive && p.uid !== myUid);
        const mayorBox = this._renderMayorActionHtml(pub, myUid);
        const mayorBanner = pub.mayorAnnouncement
          ? `<div class="mp-mayor-banner">${escapeHtml(pub.mayorAnnouncement.message || "")}</div>`
          : "";
        const isRevealedMayor = pub.revealedMayorUid === myUid;
        return `
          <div class="mp-card">
            <div class="mp-phase-tag">🗳️ التصويت النهاري السري — اليوم ${pub.roundNumber || 1}${isRevealedMayor ? " • 🎖️ صوتك ×2" : ""}</div>
            ${mayorBanner}
            <div id="mp-live-timer" class="mp-timer-big">${this._formatLiveTimer(pub.timer)}</div>
            ${mayorBox}
            ${
              alreadyVoted
                ? `<div class="mp-done-box">✅ تم تسجيل تصويتك السري (${escapeHtml(this.votePickedLabel)})${isRevealedMayor ? " بقوة ×2" : ""} — بانتظار بقية الأحياء...</div>`
                : `
                  <p class="mp-muted">اختر من تريد إقصاءه اليوم أو تخطّ التصويت:</p>
                  <div class="mp-targets-grid">
                    ${targets
                      .map(
                        (t) => `
                      <button type="button" class="btn btn-secondary mp-target-btn" data-mp-vote="${escapeHtml(t.uid)}" data-mp-label="${escapeHtml(t.name)}">
                        🎯 ${t.isRevealedMayor ? "🎖️ " : ""}${escapeHtml(t.name)}
                      </button>
                    `
                      )
                      .join("")}
                    <button type="button" class="btn btn-gold-outline mp-target-btn mp-skip-btn" data-mp-vote="SKIP" data-mp-label="تخطي التصويت">
                      ⏭️ تخطي التصويت (لا إقصاء)
                    </button>
                  </div>
                `
            }
          </div>
        `;
      }

      if (phase === "vote_result" && pub.voteResult) {
        const vr = pub.voteResult;
        return `
          <div class="mp-card mp-center">
            <div class="mp-phase-tag">📊 نتيجة التصويت</div>
            <h2>${escapeHtml(vr.headline || "")}</h2>
            <p class="mp-muted">${escapeHtml(vr.subtitle || "")}</p>
            <div class="mp-reveal-list">
              ${(vr.tally || []).map((t) => `<div class="mp-reveal-row"><strong>${escapeHtml(t.name)}</strong><span>${t.votes} صوت</span></div>`).join("")}
              <div class="mp-reveal-row"><strong>⏭️ تخطي</strong><span>${vr.skipVotes || 0} صوت</span></div>
            </div>
            ${
              Array.isArray(vr.voteBreakdown) && vr.voteBreakdown.length > 0
                ? `<div class="mp-reveal-list">
                    ${vr.voteBreakdown
                      .map(
                        (v) =>
                          `<div class="mp-reveal-row"><span>${v.isMayor ? "🎖️ " : ""}${escapeHtml(v.voterName)}${v.weight === 2 ? ` <strong class="mafia-x2-badge">×2</strong>` : ""}</span><span>⬅️ ${escapeHtml(v.targetName)}</span></div>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>
        `;
      }

      return `<div class="mp-card mp-center"><p class="mp-muted">بانتظار تحديث الجلسة...</p></div>`;
    }

    _renderMayorActionHtml(pub, myUid) {
      if (!this.privateRole || this.privateRole.role !== "mayor") return "";
      if (pub.revealedMayorUid === myUid) {
        return `<div class="mp-intel-banner is-mayor">🎖️ تم إعلان صفتك كعمدة — صوتك يُحسب بصوتين (×2) بقية الجلسة!</div>`;
      }
      if (pub.revealedMayorUid) return "";
      if (this.mayorConfirmOpen) {
        return `
          <div class="mp-mayor-confirm-box">
            <strong>🎖️ تأكيد إعلان صفتك كعمدة؟</strong>
            <p class="mp-muted">ستُكشف صفتك علناً للجميع وتصبح شارة 🎖️ بجانب اسمك، ويُحسب صوتك بصوتين (×2) طوال الجلسة.</p>
            <div class="mp-mayor-confirm-btns">
              <button type="button" id="mp-btn-mayor-confirm" class="btn btn-amber" ${this.mayorRevealSending ? "disabled" : ""}>✅ نعم، أعلن صفتي كعمدة</button>
              <button type="button" id="mp-btn-mayor-cancel" class="btn btn-ghost">إلغاء</button>
            </div>
          </div>
        `;
      }
      return `
        <div class="mp-mayor-action-wrap">
          <button type="button" id="mp-btn-mayor-ask" class="btn btn-amber mp-big-btn">🎖️ إعلان صفتي كعمدة (صوت ×2)</button>
        </div>
      `;
    }

    _renderNightActionHtml(pub, myUid) {
      const role = (this.privateRole && this.privateRole.role) || "citizen";
      const round = Number(pub.roundNumber) || 1;
      const alive = (pub.playersRoster || []).filter((p) => p.alive);
      const alreadySent = this.nightSentRound === round;
      const intel = this.privateIntel || {};

      let title = "🔒 تأكيد نومك (التمويه الذكي)";
      let subtitle = "حدّد من تشك به الليلة لتأكيد نومك (لا يؤثر على النتيجة — للتمويه فقط):";
      let actionType = "decoy";
      let targets = alive.filter((p) => p.uid !== myUid);
      let disabledUids = new Set();
      let extraBanner = "";

      if (role === "mafia") {
        title = "🕵️ اختر هدف المافيا الليلة";
        subtitle = "اختر أحد الأحياء لإقصائه هذه الليلة:";
        actionType = "kill";
        const mateUids = new Set(((this.privateRole && this.privateRole.teammates) || []).map((m) => m.uid));
        targets = alive.filter((p) => p.uid !== myUid && !mateUids.has(p.uid));
        const partnerPicks = intel.mafiaPicks && typeof intel.mafiaPicks === "object" ? Object.values(intel.mafiaPicks) : [];
        if (partnerPicks.length > 0) {
          extraBanner = `<div class="mp-intel-banner is-mafia">🤝 اختيارات المافيا الآن: ${partnerPicks
            .map((pk) => `<strong>${escapeHtml(pk.mafiaName)}</strong> ⬅️ ${escapeHtml(pk.targetName)}`)
            .join(" • ")}</div>`;
        }
      } else if (role === "doctor") {
        title = "🩺 اختر لاعباً لحمايته الليلة";
        subtitle = "اللاعب الذي تختاره سينجو إذا استهدفته المافيا:";
        actionType = "protect";
        targets = alive;
        if (pub.rulesSummary && pub.rulesSummary.noConsecutiveProtect && intel.lastProtectedUid) {
          disabledUids.add(intel.lastProtectedUid);
          extraBanner = `<div class="mp-intel-banner">ℹ️ لا يمكنك حماية نفس الشخص الذي حميته الليلة السابقة.</div>`;
        }
      } else if (role === "bodyguard") {
        title = "🛡️ اختر لاعباً لحراسته الليلة";
        subtitle = "إن استهدفته المافيا سينجو اللاعب وتُقصى أنت بدلاً عنه (لا يمكنك حراسة نفسك):";
        actionType = "guard";
        targets = alive.filter((p) => p.uid !== myUid);
        if (pub.rulesSummary && pub.rulesSummary.noConsecutiveProtect && intel.lastGuardedUid) {
          disabledUids.add(intel.lastGuardedUid);
          extraBanner = `<div class="mp-intel-banner">ℹ️ لا يمكنك حراسة نفس الشخص مرتين متتاليتين.</div>`;
        }
      } else if (role === "detective") {
        title = "🔍 اختر لاعباً لفحصه الليلة";
        subtitle = "ستصلك نتيجته سراً على هاتفك مع بزوغ الفجر:";
        actionType = "investigate";
        const checkedSet = new Set((Array.isArray(intel.investigations) ? intel.investigations : []).map((i) => i.targetUid));
        targets = alive.filter((p) => p.uid !== myUid);
        checkedSet.forEach((uid) => disabledUids.add(uid));
        extraBanner = this._renderDetectiveIntelHtml();
      }

      return `
        <div class="mp-card mp-night-card">
          <div class="mp-phase-tag is-night">🌙 الليلة رقم ${round}</div>
          <div id="mp-live-timer" class="mp-timer-big">${this._formatLiveTimer(pub.timer)}</div>
          <h2>${title}</h2>
          <p class="mp-muted">${subtitle}</p>
          ${extraBanner}
          ${
            alreadySent
              ? `<div class="mp-done-box">✅ تم إرسال قرارك الليلي سراً (${escapeHtml(this.nightPickedTargetName)}) — بانتظار بقية الأحياء...</div>`
              : `
                <div class="mp-targets-grid">
                  ${targets
                    .map((t) => {
                      const isDis = disabledUids.has(t.uid);
                      return `
                        <button type="button" class="btn btn-secondary mp-target-btn" data-mp-night-type="${actionType}" data-mp-night-target="${escapeHtml(t.uid)}" data-mp-label="${escapeHtml(t.name)}" ${isDis ? "disabled" : ""}>
                          ${role === "doctor" && t.uid === myUid ? "🩺 حماية نفسي" : `${t.isRevealedMayor ? "🎖️" : "👤"} ${escapeHtml(t.name)}`}
                          ${isDis ? " (غير متاح)" : ""}
                        </button>
                      `;
                    })
                    .join("")}
                </div>
              `
          }
        </div>
      `;
    }

    _renderDetectiveIntelHtml() {
      if (!this.privateRole || this.privateRole.role !== "detective") return "";
      const list = (this.privateIntel && Array.isArray(this.privateIntel.investigations) && this.privateIntel.investigations) || [];
      if (list.length === 0) return "";
      return `
        <div class="mp-intel-log">
          <strong>🔍 سجل فحوصاتك السرية:</strong>
          ${list
            .map(
              (item) => `
            <div class="mp-intel-row ${item.isMafia ? "is-mafia-hit" : "is-clean"}">
              <span>الليلة ${item.roundNumber}: <strong>${escapeHtml(item.targetName)}</strong></span>
              <span>${item.isMafia ? "🕵️ من المافيا!" : "✅ بريء / ليس مافيا"}</span>
            </div>
          `
            )
            .join("")}
        </div>
      `;
    }

    _renderVipBarHtml(phase) {
      const pub = this.publicState || {};
      const count = Array.isArray(pub.playersRoster) ? pub.playersRoster.length : 0;
      let btnHtml = "";
      if (phase === "setup") {
        btnHtml = `<button type="button" class="btn btn-primary mp-vip-btn" data-mp-vip="START_GAME" ${count < 4 ? "disabled" : ""}>👑 بدء الجلسة (${count} لاعب)</button>`;
      } else if (phase === "role_reveal") {
        btnHtml = `<button type="button" class="btn btn-primary mp-vip-btn" data-mp-vip="START_NIGHT">🌙 بدء الليلة الأولى</button>`;
      } else if (phase === "night") {
        btnHtml = `<button type="button" class="btn btn-secondary mp-vip-btn" data-mp-vip="END_NIGHT_EARLY">☀️ إنهاء الليل مبكراً</button>`;
      } else if (phase === "dawn_report") {
        btnHtml = `<button type="button" class="btn btn-primary mp-vip-btn" data-mp-vip="START_DISCUSSION">💬 بدء النقاش النهاري</button>`;
      } else if (phase === "day_discussion") {
        btnHtml = `<button type="button" class="btn btn-primary mp-vip-btn" data-mp-vip="START_VOTING">🗳️ فتح التصويت السري</button>`;
      } else if (phase === "day_voting") {
        btnHtml = `<button type="button" class="btn btn-secondary mp-vip-btn" data-mp-vip="END_VOTING_EARLY">📊 إغلاق التصويت الآن</button>`;
      } else if (phase === "vote_result") {
        btnHtml = `<button type="button" class="btn btn-primary mp-vip-btn" data-mp-vip="NEXT_NIGHT">🌙 بدء الليلة التالية</button>`;
      } else if (phase === "game_over") {
        btnHtml = `<button type="button" class="btn btn-primary mp-vip-btn" data-mp-vip="NEW_ROUND">🔄 جولة جديدة</button>`;
      }
      if (!btnHtml) return "";
      return `<footer class="mp-vip-bar"><span class="mp-vip-label">👑 تحكم الجلسة (VIP)</span>${btnHtml}</footer>`;
    }

    _phaseArabicName(phase) {
      const map = {
        setup: "اللوبي",
        role_reveal: "توزيع الأدوار",
        night: "الليل",
        dawn_report: "تقرير الفجر",
        day_discussion: "نقاش النهار",
        day_voting: "التصويت النهاري",
        vote_result: "نتائج التصويت",
        game_over: "نهاية الجلسة"
      };
      return map[phase] || phase;
    }

    _bindHoldToggle(triggerEl, onShow, onHide) {
      if (!triggerEl) return;
      const start = (e) => {
        if (e.cancelable) e.preventDefault();
        onShow();
      };
      const end = () => onHide();
      triggerEl.addEventListener("pointerdown", start);
      triggerEl.addEventListener("pointerup", end);
      triggerEl.addEventListener("pointerleave", end);
      triggerEl.addEventListener("pointercancel", end);
      triggerEl.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    _bindRenderedEvents() {
      const joinForm = document.getElementById("mp-join-form");
      if (joinForm) {
        joinForm.addEventListener("submit", (e) => {
          e.preventDefault();
          const rInput = document.getElementById("mp-room-input");
          const nInput = document.getElementById("mp-name-input");
          const nextRoom = rInput ? rInput.value.trim().toUpperCase() : "";
          const nextName = nInput ? nInput.value.trim() : "";
          if (nextRoom && nextRoom !== this.roomCode) {
            this.roomCode = nextRoom;
            this.playerName = nextName;
            this._saveSession(NAME_KEY, nextName);
            this._connectToRoom(nextRoom, true);
          } else {
            this._joinWithName(nextName);
          }
        });
      }

      // Hold-to-Reveal على بطاقة الدور السري
      const holdCard = document.getElementById("mp-hold-role-card");
      const masked = document.getElementById("mp-role-masked");
      const unmasked = document.getElementById("mp-role-unmasked");
      if (holdCard && masked && unmasked) {
        this._bindHoldToggle(
          holdCard,
          () => {
            masked.hidden = true;
            unmasked.hidden = false;
            holdCard.classList.add("is-holding");
          },
          () => {
            masked.hidden = false;
            unmasked.hidden = true;
            holdCard.classList.remove("is-holding");
          }
        );
      }

      // Hold-to-Reveal لزر تذكير الدور طوال الجلسة
      const remBtn = document.getElementById("mp-btn-role-reminder");
      const remDrawer = document.getElementById("mp-role-reminder-drawer");
      if (remBtn && remDrawer) {
        this._bindHoldToggle(
          remBtn,
          () => {
            remDrawer.hidden = false;
          },
          () => {
            remDrawer.hidden = true;
          }
        );
      }

      const btnReady = document.getElementById("mp-btn-ready");
      if (btnReady) {
        btnReady.addEventListener("click", async () => {
          if (!this.publicState || !window.SeenJeemMafiaSync) return;
          btnReady.disabled = true;
          const res = await window.SeenJeemMafiaSync.submitNightAction({
            roundNumber: 0,
            actionType: "ready",
            targetUid: null,
            gameId: this.publicState.gameId
          });
          if (res.ok) {
            this.readySentGameId = this.publicState.gameId;
          }
          this._render();
        });
      }

      this.root.querySelectorAll("[data-mp-night-target]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!this.publicState || !window.SeenJeemMafiaSync) return;
          const targetUid = btn.dataset.mpNightTarget;
          const actionType = btn.dataset.mpNightType || "decoy";
          const label = btn.dataset.mpLabel || "لاعب";
          const roundNumber = Number(this.publicState.roundNumber) || 1;
          btn.disabled = true;
          const res = await window.SeenJeemMafiaSync.submitNightAction({
            roundNumber,
            actionType,
            targetUid,
            gameId: this.publicState.gameId
          });
          if (res.ok) {
            this.nightSentRound = roundNumber;
            this.nightPickedTargetName = label;
          } else {
            this.errorMessage = res.error || "تعذّر إرسال قرارك.";
          }
          this._render();
        });
      });

      this.root.querySelectorAll("[data-mp-vote]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!this.publicState || !window.SeenJeemMafiaSync) return;
          const targetUid = btn.dataset.mpVote || "SKIP";
          const label = btn.dataset.mpLabel || "تخطي";
          const roundNumber = Number(this.publicState.roundNumber) || 1;
          btn.disabled = true;
          const res = await window.SeenJeemMafiaSync.submitDayVote({ roundNumber, targetUid });
          if (res.ok) {
            this.voteSentRound = roundNumber;
            this.votePickedLabel = label;
          } else {
            this.errorMessage = res.error || "تعذّر إرسال تصويتك.";
          }
          this._render();
        });
      });

      this.root.querySelectorAll("[data-mp-vip]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!window.SeenJeemMafiaSync) return;
          const cmd = btn.dataset.mpVip;
          btn.disabled = true;
          await window.SeenJeemMafiaSync.sendVipCommand(cmd, {});
          setTimeout(() => {
            if (btn) btn.disabled = false;
          }, 800);
        });
      });

      const rulesBtn = document.getElementById("mp-btn-rules-guide");
      if (rulesBtn) {
        rulesBtn.addEventListener("click", () => {
          this.rulesGuideOpen = !this.rulesGuideOpen;
          this._render();
        });
      }
      const closeRulesBtn = document.getElementById("mp-btn-close-rules");
      if (closeRulesBtn) {
        closeRulesBtn.addEventListener("click", () => {
          this.rulesGuideOpen = false;
          this._render();
        });
      }

      const mayorAskBtn = document.getElementById("mp-btn-mayor-ask");
      if (mayorAskBtn) {
        mayorAskBtn.addEventListener("click", () => {
          this.mayorConfirmOpen = true;
          this._render();
        });
      }
      const mayorCancelBtn = document.getElementById("mp-btn-mayor-cancel");
      if (mayorCancelBtn) {
        mayorCancelBtn.addEventListener("click", () => {
          this.mayorConfirmOpen = false;
          this._render();
        });
      }
      const mayorConfirmBtn = document.getElementById("mp-btn-mayor-confirm");
      if (mayorConfirmBtn) {
        mayorConfirmBtn.addEventListener("click", async () => {
          if (!this.publicState || !window.SeenJeemMafiaSync || this.mayorRevealSending) return;
          this.mayorRevealSending = true;
          this._render();
          const res = await window.SeenJeemMafiaSync.submitMayorReveal({
            gameId: this.publicState.gameId,
            roundNumber: this.publicState.roundNumber || 1
          });
          this.mayorRevealSending = false;
          this.mayorConfirmOpen = false;
          if (!res.ok) {
            this.errorMessage = res.error || "تعذّر إعلان صفتك كعمدة.";
          }
          this._render();
        });
      }
    }
  }

  window.SeenJeemMafiaPlayerView = new MafiaPlayerMobileController();
})();
