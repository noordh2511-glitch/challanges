/**
 * واجهة «ريموت المقدّم» على الهاتف (Mobile-First Remote Host UI — ?mode=remote)
 * - مصممة للاستخدام السريع بيد واحدة (RTL، أزرار >= 48px، بدون تمرير أفقي)
 * - تعرض الإجابة والتلميح والشرح ومواقع المربعات الذهبية والرهانات السرية من hostPrivate/{hostToken} فقط
 * - ترسل جميع الأوامر إلى الجهاز الرئيسي (Master) عبر طابور hostCommands/{hostToken}
 */
(function () {
  "use strict";

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

  class RemoteHostController {
    constructor() {
      this.root = null;
      this.roomCode = "";
      this.hostToken = "";
      this.connected = false;
      this.activeTab = "control"; // "control" | "tools"
      this.publicState = null;
      this.hostPrivate = null;
      this.errorMessage = "";
      this.wagerDraft = "";
    }

    init() {
      this.root = document.getElementById("remote-host-root");
      if (!this.root) return;

      document.title = "سين جيم | ريموت المقدّم";
      document.body.classList.add("remote-host-mode");
      this._hideHostShell();

      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");

      const utils = window.SeenJeemRealtimeUtils;
      const params = utils ? utils.getUrlParams() : { room: "", token: "" };
      this.roomCode = params.room || "";
      this.hostToken = params.token || "";

      this._renderShell();
      this._bindShellEvents();
      this._attemptConnect();
    }

    _hideHostShell() {
      document.querySelectorAll("body > .screen, body > .modal-overlay, #tv-display-root, #player-view-root").forEach((el) => {
        el.hidden = true;
        el.classList.remove("active", "open");
      });
    }

    async _attemptConnect() {
      const rt = window.SeenJeemRealtimeSync;
      if (!this.roomCode || !this.hostToken) {
        this.errorMessage = "الرابط ينقصه رمز الغرفة أو توكن المقدّم. امسح رمز QR من نافذة «📡 الغرفة اللاسلكية» على شاشة الجهاز الرئيسي.";
        this._renderBody();
        return;
      }
      if (!rt || !rt.isConfigured()) {
        this.errorMessage = "إعدادات Firebase غير مُهيّأة على هذا المتصفح. أدخل إعدادات مشروعك في ملف firebaseConfig.js أو من الجهاز الرئيسي ثم أعد المحاولة.";
        this._renderBody();
        return;
      }

      this.errorMessage = "";
      this._updateConnPill("connecting");
      try {
        await rt.connectAsRemoteHost({
          roomCode: this.roomCode,
          hostToken: this.hostToken,
          onPublicState: (pub) => {
            this.publicState = pub;
            this._renderTopScores();
            this._renderBody();
          },
          onHostPrivate: (priv) => {
            this.hostPrivate = priv;
            this._renderBody();
          },
          onConnectionState: (isConn) => {
            this.connected = isConn;
            this._updateConnPill(isConn ? "online" : "reconnecting");
          },
          onError: (err) => {
            this.errorMessage = (err && err.message) || "تعذّرت قراءة بيانات الغرفة — تحقّق من صلاحية التوكن أو أن الغرفة ما زالت مفتوحة.";
            this._renderBody();
          }
        });
      } catch (err) {
        this.errorMessage = (err && err.message) || "تعذّر الاتصال بالغرفة اللاسلكية.";
        this._updateConnPill("offline");
        this._renderBody();
      }
    }

    async _sendCmd(type, payload = {}) {
      const rt = window.SeenJeemRealtimeSync;
      if (!rt || !this.connected) {
        this._toast("غير متصل بالجهاز الرئيسي حالياً");
        return;
      }
      if (navigator.vibrate) {
        try { navigator.vibrate(20); } catch (_e) {}
      }
      const res = await rt.sendHostCommand(type, payload);
      if (!res.ok) {
        this._toast(res.error || "تعذّر إرسال الأمر");
      }
    }

    _toast(msg) {
      const el = document.getElementById("rh-toast");
      if (!el) return;
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        el.hidden = true;
      }, 2400);
    }

    _renderShell() {
      this.root.innerHTML = `
        <div class="rh-shell">
          <header class="rh-topbar">
            <div class="rh-topbar-row">
              <div class="rh-brand">
                <span class="rh-room-badge" id="rh-room-code">${escapeHtml(this.roomCode || "------")}</span>
                <span class="rh-conn-pill is-offline" id="rh-conn-pill">⚪ غير متصل</span>
              </div>
              <button type="button" id="rh-btn-undo" class="btn btn-secondary rh-undo-btn" aria-label="تراجع">
                ↶ تراجع
              </button>
            </div>
            <div class="rh-scores-strip" id="rh-scores-strip">
              <span class="rh-scores-placeholder">بانتظار مزامنة لوحة النقاط...</span>
            </div>
          </header>

          <nav class="rh-tabs" role="tablist" aria-label="تبويبات ريموت المقدّم">
            <button type="button" class="rh-tab-btn active" data-rh-tab="control" role="tab" aria-selected="true">
              🎮 التحكم الحالي
            </button>
            <button type="button" class="rh-tab-btn" data-rh-tab="tools" role="tab" aria-selected="false">
              🎛️ أدوات المقدّم
            </button>
          </nav>

          <main class="rh-main" id="rh-main-body"></main>
          <div id="rh-toast" class="rh-toast" hidden aria-live="polite"></div>
        </div>
      `;
      this._renderBody();
    }

    _bindShellEvents() {
      const undoBtn = document.getElementById("rh-btn-undo");
      if (undoBtn) {
        undoBtn.addEventListener("click", () => this._sendCmd("UNDO"));
      }
      this.root.querySelectorAll("[data-rh-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.activeTab = btn.dataset.rhTab === "tools" ? "tools" : "control";
          this.root.querySelectorAll("[data-rh-tab]").forEach((b) => {
            const act = b.dataset.rhTab === this.activeTab;
            b.classList.toggle("active", act);
            b.setAttribute("aria-selected", String(act));
          });
          this._renderBody();
        });
      });
    }

    _updateConnPill(status) {
      const pill = document.getElementById("rh-conn-pill");
      if (!pill) return;
      pill.className = "rh-conn-pill";
      if (status === "online") {
        pill.classList.add("is-online");
        pill.textContent = "🟢 متصل";
      } else if (status === "reconnecting" || status === "connecting") {
        pill.classList.add("is-reconnecting");
        pill.textContent = "🟡 يعيد الاتصال";
      } else {
        pill.classList.add("is-offline");
        pill.textContent = "⚪ غير متصل";
      }
    }

    _renderTopScores() {
      const strip = document.getElementById("rh-scores-strip");
      if (!strip) return;
      const teams = (this.publicState && Array.isArray(this.publicState.teams) && this.publicState.teams) || [];
      const activeTurn = Number(this.publicState && this.publicState.activeTurn) || 0;
      if (teams.length === 0) {
        strip.innerHTML = `<span class="rh-scores-placeholder">بانتظار بدء الجولة على الشاشة الرئيسية...</span>`;
        return;
      }
      strip.innerHTML = teams
        .map(
          (t, idx) => `
          <div class="rh-score-chip team-${idx + 1}${idx === activeTurn ? " is-turn" : ""}">
            <span class="team-badge-dot team-${idx + 1}-dot"></span>
            <span class="rh-score-name">${escapeHtml(t.name)}</span>
            <strong class="rh-score-val">${Number(t.score) || 0}</strong>
          </div>
        `
        )
        .join("");
    }

    _renderBuzzerBar() {
      const bz =
        (this.publicState && (this.publicState.buzzer || (this.publicState.wireless && this.publicState.wireless.buzzer))) || {
          state: "locked"
        };
      const statusHtml =
        bz.state === "buzzed"
          ? `<div class="rh-buzzer-winner">🏆 الأسرع: <strong>${escapeHtml(bz.winnerTeamName || "")}</strong>${
              bz.runnerUpDeltaMs !== null && bz.runnerUpDeltaMs !== undefined
                ? ` <span class="rh-delta-badge">+${bz.runnerUpDeltaMs}ms</span>`
                : ""
            }</div>`
          : bz.state === "open"
            ? `<div class="rh-buzzer-open-note">🔔 الجرس مفتوح الآن للفرق!</div>`
            : `<div class="rh-buzzer-locked-note">🔒 الجرس مقفل</div>`;

      return `
        <section class="rh-card rh-buzzer-card">
          <div class="rh-card-head">
            <span>🔔 جرس السرعة</span>
            ${statusHtml}
          </div>
          <div class="rh-btn-row rh-cols-3">
            <button type="button" class="btn btn-steal-win rh-touch-btn" data-rh-cmd="BUZZER_OPEN">🔔 فتح الجرس</button>
            <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="BUZZER_LOCK">🔒 إقفال</button>
            <button type="button" class="btn btn-gold-outline rh-touch-btn" data-rh-cmd="BUZZER_RESET">🔄 تصفير</button>
          </div>
        </section>
      `;
    }

    _renderBody() {
      const main = document.getElementById("rh-main-body");
      if (!main) return;

      if (this.activeTab === "tools") {
        main.innerHTML = this._renderToolsTab();
        this._bindDynamicButtons(main);
        return;
      }

      if (this.errorMessage && !this.publicState) {
        main.innerHTML = `
          <section class="rh-card rh-alert-card">
            <div class="rh-alert-icon">📡</div>
            <h2 class="rh-alert-title">ريموت المقدّم اللاسلكي</h2>
            <p class="rh-alert-desc">${escapeHtml(this.errorMessage)}</p>
            <button type="button" id="rh-btn-retry" class="btn btn-primary rh-touch-btn">🔄 إعادة المحاولة</button>
          </section>
          ${this._renderBuzzerBar()}
        `;
        const retry = document.getElementById("rh-btn-retry");
        if (retry) retry.addEventListener("click", () => this._attemptConnect());
        this._bindDynamicButtons(main);
        return;
      }

      const pub = this.publicState;
      const priv = this.hostPrivate || {};
      if (!pub) {
        main.innerHTML = `
          <section class="rh-card rh-alert-card">
            <div class="rh-alert-icon">⏳</div>
            <h2 class="rh-alert-title">جاري المزامنة مع الشاشة الرئيسية...</h2>
            <p class="rh-alert-desc">رمز الغرفة: <strong>${escapeHtml(this.roomCode || "—")}</strong></p>
          </section>
        `;
        return;
      }

      let stageHtml = "";
      if (pub.screen === "board") {
        stageHtml = this._renderBoardControl(pub, priv);
      } else if (pub.screen === "question" && pub.questionView) {
        stageHtml = this._renderQuestionControl(pub, priv);
      } else if (pub.screen === "blitz" && pub.blitzView) {
        stageHtml = this._renderBlitzControl(pub, priv);
      } else if (pub.screen === "charades-solo" && pub.charadesSoloView) {
        stageHtml = this._renderCharadesSoloControl(pub, priv);
      } else if (pub.screen === "final" && pub.finalRoundView) {
        stageHtml = this._renderFinalControl(pub, priv);
      } else if (pub.screen === "winner") {
        stageHtml = `
          <section class="rh-card rh-alert-card">
            <div class="rh-alert-icon">🏆</div>
            <h2 class="rh-alert-title">${escapeHtml((pub.winnerView && pub.winnerView.title) || "نهاية المباراة!")}</h2>
            <p class="rh-alert-desc">يمكنك تشغيل تصفيق أو افتتاحية من تبويب «أدوات المقدّم».</p>
          </section>
        `;
      } else {
        stageHtml = `
          <section class="rh-card rh-alert-card">
            <div class="rh-alert-icon">🎯</div>
            <h2 class="rh-alert-title">شاشة الإعداد مفتوحة</h2>
            <p class="rh-alert-desc">اختر الفئات وابدأ الجولة من الجهاز الرئيسي لتظهر لوحة التحكم هنا فوراً.</p>
          </section>
        `;
      }

      main.innerHTML = `${this._renderBuzzerBar()}${stageHtml}`;
      this._bindDynamicButtons(main);
    }

    _renderBoardControl(pub, priv) {
      const teams = pub.teams || [];
      const activeTeam = teams[pub.activeTurn] || teams[0] || { name: "الفريق", powerups: { doubleLeft: 0 } };
      const doubleLeft = Number(activeTeam.powerups && activeTeam.powerups.doubleLeft) || 0;
      const ddSet = new Set(Array.isArray(priv.dailyDoubleKeys) ? priv.dailyDoubleKeys : []);
      const board = Array.isArray(pub.board) ? pub.board : [];

      const catsHtml = board
        .map((bc, catIdx) => {
          const buildBtn = (colKey, slot, slotIdx) => {
            if (!slot) return "";
            const key = `${catIdx}:${colKey}:${slotIdx}`;
            const isDd = ddSet.has(key);
            return `
              <button
                type="button"
                class="rh-cell-btn pts-${slot.points}${slot.played ? " is-played" : ""}${isDd && !slot.played ? " is-secret-dd" : ""}"
                data-open-cell="${catIdx}:${colKey}:${slotIdx}"
                ${slot.played || !slot.hasQuestion ? "disabled" : ""}
              >
                ${slot.points}${isDd && !slot.played ? " 🌟" : ""}
              </button>
            `;
          };
          const rows = Math.max((bc.rightColumn || []).length, (bc.leftColumn || []).length);
          let grid = "";
          for (let i = 0; i < rows; i++) {
            grid += buildBtn("rightColumn", bc.rightColumn && bc.rightColumn[i], i);
            grid += buildBtn("leftColumn", bc.leftColumn && bc.leftColumn[i], i);
          }
          return `
            <div class="rh-board-cat">
              <div class="rh-board-cat-title">${escapeHtml(bc.category.icon || "🎯")} ${escapeHtml(bc.category.name)}</div>
              <div class="rh-board-tiles">${grid}</div>
            </div>
          `;
        })
        .join("");

      return `
        <section class="rh-card">
          <div class="rh-card-head">
            <span>🎯 لوحة اللعب (دور: ${escapeHtml(activeTeam.name)})</span>
            <button
              type="button"
              class="btn ${pub.doubleArmed ? "btn-amber" : "btn-gold-outline"} rh-mini-btn"
              data-rh-cmd="TOGGLE_DOUBLE_ARM"
              ${doubleLeft <= 0 && !pub.doubleArmed ? "disabled" : ""}
            >
              ⚡ 2x ${pub.doubleArmed ? "(مفعّلة)" : `(${doubleLeft})`}
            </button>
          </div>
          <div class="rh-board-grid">${catsHtml}</div>
        </section>
      `;
    }

    _renderQuestionControl(pub, priv) {
      const qv = pub.questionView;
      const teams = pub.teams || [];
      const inDdWager = Boolean(qv.isDailyDouble && qv.dailyDoublePhase === "wager");
      const qText = priv.questionText || qv.questionText || (qv.isCharades ? "🎭 سؤال من غير كلام" : "");

      const secretCard = inDdWager
        ? `
          <div class="rh-secret-box is-dd">
            <div class="rh-secret-label">🌟 مربع ذهبي مخفي — مرحلة تحديد الرهان</div>
            <div class="rh-dd-wager-row">
              <input type="number" id="rh-dd-wager-input" class="rh-input" min="100" max="${qv.dailyDoubleMaxWager || 800}" step="50" value="${escapeHtml(this.wagerDraft || String(qv.dailyDoubleWager || qv.basePoints || 400))}" />
              <button type="button" id="rh-btn-dd-lock" class="btn btn-amber rh-touch-btn">🔒 تثبيت الرهان</button>
            </div>
          </div>
        `
        : `
          <div class="rh-secret-box">
            <div class="rh-secret-label">🔒 سري للمقدّم فقط (مخفي عن التلفزيون واللاعبين)</div>
            <div class="rh-secret-answer">✅ ${escapeHtml(priv.answerText || "—")}</div>
            ${priv.hintText ? `<div class="rh-secret-meta">💡 التلميح: ${escapeHtml(priv.hintText)}</div>` : ""}
            ${priv.explanationText ? `<div class="rh-secret-meta">${qv.isCharades ? "🎬 فكرة التمثيل" : "📌 الشرح"}: ${escapeHtml(priv.explanationText)}</div>` : ""}
          </div>
        `;

      let actionsHtml = "";
      if (inDdWager) {
        actionsHtml = "";
      } else if (qv.revealed && qv.isDailyDouble) {
        actionsHtml = `
          <div class="rh-btn-row rh-cols-2">
            <button type="button" class="btn btn-steal-win rh-touch-btn" data-rh-cmd="AWARD_TEAM" data-payload='{"dailyDoubleSuccess":true}'>✅ صح (+${qv.dailyDoubleWager})</button>
            <button type="button" class="btn btn-danger-outline rh-touch-btn" data-rh-cmd="AWARD_TEAM" data-payload='{"dailyDoubleSuccess":false}'>❌ خطأ (-${qv.dailyDoubleWager})</button>
          </div>
        `;
      } else if (qv.revealed) {
        actionsHtml = `
          <div class="rh-btn-row rh-cols-2">
            ${teams
              .map(
                (t, idx) =>
                  `<button type="button" class="btn btn-award-team${idx + 1} rh-touch-btn" data-rh-cmd="AWARD_TEAM" data-payload='{"teamIdx":${idx}}'>✅ ${escapeHtml(t.name)}</button>`
              )
              .join("")}
            <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="AWARD_TEAM" data-payload='{"teamIdx":null}'>لا أحد (0)</button>
          </div>
        `;
      } else if (qv.phase === "steal-offer") {
        actionsHtml = `
          <div class="rh-btn-row rh-cols-2">
            <button type="button" class="btn btn-amber rh-touch-btn" data-rh-cmd="OPEN_STEAL">🔥 فتح السرقة (+${qv.stealPoints})</button>
            <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="STEAL_RESULT" data-payload='{"skip":true}'>👁️ إغلاق دون نقاط</button>
          </div>
        `;
      } else if (qv.phase === "steal-active") {
        actionsHtml = `
          <div class="rh-btn-row rh-cols-2">
            <button type="button" class="btn btn-steal-win rh-touch-btn" data-rh-cmd="STEAL_RESULT" data-payload='{"success":true}'>✅ نجحت السرقة (+${qv.stealPoints})</button>
            <button type="button" class="btn btn-danger-outline rh-touch-btn" data-rh-cmd="STEAL_RESULT" data-payload='{"success":false}'>❌ فشلت السرقة</button>
          </div>
        `;
      } else {
        actionsHtml = `
          <div class="rh-btn-row rh-cols-2">
            <button type="button" class="btn btn-primary rh-touch-btn" data-rh-cmd="REVEAL_ANSWER">👁️ إظهار الإجابة</button>
            <button type="button" class="btn btn-danger-outline rh-touch-btn" data-rh-cmd="WRONG_ANSWER">❌ خطأ / سرقة</button>
          </div>
          <div class="rh-btn-row rh-cols-2">
            <button type="button" class="btn btn-gold-outline rh-touch-btn" data-rh-cmd="REVEAL_HINT" ${!priv.hintText || qv.hintRevealed ? "disabled" : ""}>💡 إظهار التلميح</button>
            <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="SWAP_QUESTION">🔄 تبديل السؤال</button>
          </div>
        `;
      }

      return `
        <section class="rh-card">
          <div class="rh-card-head">
            <span>${escapeHtml(qv.categoryIcon || "🎯")} ${escapeHtml(qv.categoryName)} (${qv.basePoints})</span>
            <span class="rh-timer-pill">${qv.timerMode === "unlimited" ? "∞" : formatTime(qv.timerRemaining)}</span>
          </div>
          ${!inDdWager ? `<p class="rh-question-text">${escapeHtml(qText)}</p>` : ""}
          ${secretCard}
          ${actionsHtml}
          ${
            !inDdWager
              ? `<div class="rh-btn-row rh-cols-2 rh-timer-controls">
                  <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="TOGGLE_TIMER">${qv.timerRunning ? "⏸️ إيقاف المؤقت" : "▶️ تشغيل المؤقت"}</button>
                  <button type="button" class="btn btn-ghost rh-touch-btn" data-rh-cmd="RESET_TIMER">🔄 إعادة المؤقت</button>
                </div>`
              : ""
          }
        </section>
      `;
    }

    _renderBlitzControl(pub, priv) {
      const bv = pub.blitzView;
      return `
        <section class="rh-card">
          <div class="rh-card-head">
            <span>⚡ جولة البرق — ${escapeHtml(bv.activeTeamName)}</span>
            <span class="rh-timer-pill">${formatTime(bv.timerRemaining)}</span>
          </div>
          ${
            bv.phase === "playing"
              ? `
                <p class="rh-question-text">${escapeHtml(bv.questionText || "")}</p>
                <div class="rh-secret-box">
                  <div class="rh-secret-label">🔒 الإجابة (للمقدّم فقط)</div>
                  <div class="rh-secret-answer">✅ ${escapeHtml(priv.blitzAnswer || "—")}</div>
                </div>
                <div class="rh-btn-row rh-cols-3">
                  <button type="button" class="btn btn-steal-win rh-touch-btn" data-rh-cmd="BLITZ_ACTION" data-payload='{"action":"correct"}'>✅ صح</button>
                  <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="BLITZ_ACTION" data-payload='{"action":"skip"}'>⏭️ تخطي</button>
                  <button type="button" class="btn btn-danger-outline rh-touch-btn" data-rh-cmd="BLITZ_ACTION" data-payload='{"action":"wrong"}'>❌ خطأ</button>
                </div>
                <button type="button" class="btn btn-ghost rh-touch-btn" data-rh-cmd="BLITZ_ACTION" data-payload='{"action":"pause"}'>${bv.timerRunning ? "⏸️ إيقاف مؤقت" : "▶️ استئناف"}</button>
              `
              : `<button type="button" class="btn btn-amber rh-touch-btn" data-rh-cmd="BLITZ_ACTION" data-payload='{"action":"${bv.phase === "ready" ? "begin" : "next"}"}'>${bv.phase === "ready" ? "🚀 ابدأ الدور" : "الدور التالي ←"}</button>`
          }
        </section>
      `;
    }

    _renderCharadesSoloControl(pub, priv) {
      const cv = pub.charadesSoloView;
      return `
        <section class="rh-card">
          <div class="rh-card-head">
            <span>🎭 من غير كلام — ${escapeHtml(cv.activeTeamName)}</span>
            <span class="rh-timer-pill">${formatTime(cv.timerRemaining)}</span>
          </div>
          ${
            cv.phase === "playing"
              ? `
                <div class="rh-secret-box">
                  <div class="rh-secret-label">🔒 الكلمة السرية (للمقدّم والممثّل فقط)</div>
                  <div class="rh-secret-answer">🎭 ${escapeHtml(priv.csoloWord || "—")}</div>
                  ${priv.csoloExp ? `<div class="rh-secret-meta">🎬 فكرة التمثيل: ${escapeHtml(priv.csoloExp)}</div>` : ""}
                </div>
                <div class="rh-btn-row rh-cols-3">
                  <button type="button" class="btn btn-steal-win rh-touch-btn" data-rh-cmd="CHARADES_ACTION" data-payload='{"action":"guessed"}'>✅ خُمّنت</button>
                  <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="CHARADES_ACTION" data-payload='{"action":"skip"}'>⏭️ تخطي</button>
                  <button type="button" class="btn btn-gold-outline rh-touch-btn" data-rh-cmd="CHARADES_ACTION" data-payload='{"action":"hint"}'>💡 تلميح</button>
                </div>
              `
              : `<button type="button" class="btn btn-amber rh-touch-btn" data-rh-cmd="CHARADES_ACTION" data-payload='{"action":"${cv.phase === "ready" ? "begin" : "next"}"}'>${cv.phase === "ready" ? "🎬 ابدأ الدور" : "الدور التالي ←"}</button>`
          }
        </section>
      `;
    }

    _renderFinalControl(pub, priv) {
      const fv = pub.finalRoundView;
      const received = priv.receivedWagers || {};
      const participants = Array.isArray(fv.participants) ? fv.participants : [];

      const cards = participants
        .map((p) => {
          const w = received[`team-${p.teamIdx}`] || {};
          return `
            <div class="rh-final-row">
              <div>
                <strong>${escapeHtml(p.name)}</strong>
                <div class="rh-secret-meta">الرهان الوارد: <strong>${w.amount !== undefined ? w.amount : "—"}</strong> ${p.locked ? "🔒" : "⏳"}</div>
                ${w.answerText ? `<div class="rh-secret-meta">📝 الإجابة الواردة: <strong>${escapeHtml(w.answerText)}</strong></div>` : ""}
              </div>
              ${
                fv.phase === "question"
                  ? `<div class="rh-btn-row rh-cols-2">
                      <button type="button" class="btn btn-steal-win rh-mini-btn" data-rh-cmd="FINAL_ROUND_ACTION" data-payload='{"action":"judge","teamIdx":${p.teamIdx},"correct":true}'>✅ صح</button>
                      <button type="button" class="btn btn-danger-outline rh-mini-btn" data-rh-cmd="FINAL_ROUND_ACTION" data-payload='{"action":"judge","teamIdx":${p.teamIdx},"correct":false}'>❌ خطأ</button>
                    </div>`
                  : ""
              }
            </div>
          `;
        })
        .join("");

      return `
        <section class="rh-card">
          <div class="rh-card-head">
            <span>⚔️ جولة الرهان النهائي (${escapeHtml(fv.phase)})</span>
            <span class="rh-timer-pill">${formatTime(fv.timerRemaining)}</span>
          </div>
          ${priv.finalAnswer ? `<div class="rh-secret-box"><div class="rh-secret-label">🔒 إجابة سؤال الحسم</div><div class="rh-secret-answer">✅ ${escapeHtml(priv.finalAnswer)}</div></div>` : ""}
          <div class="rh-final-list">${cards}</div>
          ${
            fv.phase === "wager"
              ? `<button type="button" class="btn btn-amber rh-touch-btn" data-rh-cmd="FINAL_ROUND_ACTION" data-payload='{"action":"start-question"}'>🔒 إغلاق الرهانات وعرض السؤال</button>`
              : fv.phase === "question"
                ? `<button type="button" class="btn btn-primary rh-touch-btn" data-rh-cmd="FINAL_ROUND_ACTION" data-payload='{"action":"reveal"}'>🏆 كشف الإجابة والنتائج</button>`
                : ""
          }
        </section>
      `;
    }

    _renderToolsTab() {
      const teams = (this.publicState && Array.isArray(this.publicState.teams) && this.publicState.teams) || [];
      const intermissionOn = Boolean(this.publicState && this.publicState.intermission && this.publicState.intermission.active);

      return `
        <section class="rh-card">
          <div class="rh-card-head"><span>🎛️ لوحة المؤثرات الصوتية (على التلفزيون)</span></div>
          <div class="rh-btn-row rh-cols-2">
            <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="PLAY_SFX" data-payload='{"sfx":"drumroll"}'>🥁 قرع طبول</button>
            <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="PLAY_SFX" data-payload='{"sfx":"applause"}'>👏 تصفيق</button>
            <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="PLAY_SFX" data-payload='{"sfx":"sad_trombone"}'>🎺 خطأ درامي</button>
            <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="PLAY_SFX" data-payload='{"sfx":"attention_chime"}'>🔔 تنبيه هدوء</button>
            <button type="button" class="btn btn-gold-outline rh-touch-btn rh-span-2" data-rh-cmd="PLAY_SFX" data-payload='{"sfx":"fanfare"}'>🎉 افتتاحية حماسية</button>
          </div>
        </section>

        <section class="rh-card">
          <div class="rh-card-head"><span>☕ شاشة الاستراحة التلفزيونية</span></div>
          <button type="button" class="btn ${intermissionOn ? "btn-primary" : "btn-amber"} rh-touch-btn" data-rh-cmd="TOGGLE_INTERMISSION">
            ${intermissionOn ? "▶️ استئناف اللعب وإغلاق الاستراحة" : "☕ تفعيل شاشة الاستراحة الآن"}
          </button>
        </section>

        <section class="rh-card">
          <div class="rh-card-head"><span>⚖️ التحكم التحكيمي السريع</span></div>
          ${
            teams.length === 0
              ? `<p class="rh-alert-desc">ستظهر أزرار تحكيم الفرق فور بدء الجولة.</p>`
              : teams
                  .map(
                    (t, idx) => `
                  <div class="rh-ref-team">
                    <div class="rh-ref-team-name">
                      <span class="team-badge-dot team-${idx + 1}-dot"></span>
                      <strong>${escapeHtml(t.name)}</strong>
                      <span>(${Number(t.score) || 0})</span>
                    </div>
                    <div class="rh-btn-row rh-cols-3">
                      <button type="button" class="btn btn-steal-win rh-touch-btn" data-rh-cmd="REFEREE_ACTION" data-payload='{"teamIdx":${idx},"delta":100}'>+100</button>
                      <button type="button" class="btn btn-danger-outline rh-touch-btn" data-rh-cmd="REFEREE_ACTION" data-payload='{"teamIdx":${idx},"delta":-100}'>-100</button>
                      <button type="button" class="btn btn-secondary rh-touch-btn" data-rh-cmd="REFEREE_ACTION" data-payload='{"teamIdx":${idx},"setTurn":true}'>🎯 الدور</button>
                    </div>
                  </div>
                `
                  )
                  .join("")
          }
        </section>
      `;
    }

    _bindDynamicButtons(container) {
      container.querySelectorAll("[data-rh-cmd]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const cmd = btn.dataset.rhCmd;
          let payload = {};
          if (btn.dataset.payload) {
            try { payload = JSON.parse(btn.dataset.payload); } catch (_e) {}
          }
          this._sendCmd(cmd, payload);
        });
      });

      container.querySelectorAll("[data-open-cell]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [catIdx, colKey, slotIdx] = btn.dataset.openCell.split(":");
          this._sendCmd("OPEN_CELL", {
            catIdx: Number(catIdx),
            colKey,
            slotIdx: Number(slotIdx)
          });
        });
      });

      const ddInput = document.getElementById("rh-dd-wager-input");
      const ddLock = document.getElementById("rh-btn-dd-lock");
      if (ddInput) {
        ddInput.addEventListener("input", () => {
          this.wagerDraft = ddInput.value;
        });
      }
      if (ddLock) {
        ddLock.addEventListener("click", () => {
          const val = Number(ddInput ? ddInput.value : 400);
          this._sendCmd("SET_DAILY_DOUBLE_WAGER", { wager: val });
        });
      }
    }
  }

  window.SeenJeemRemoteHostView = new RemoteHostController();
})();
