/**
 * واجهة «هاتف الفريق — جرس السرعة والرهان السري» (Player Mobile UI — ?mode=player)
 * - خفيفة جداً ومصممة لهواتف الفرق بـ RTL بدون تمرير أفقي
 * - شاشة انضمام تقرأ ?room=CODE تلقائياً أو تتيح إدخال رمز من 6 خانات + اختيار الفريق وحفظه بـ sessionStorage
 * - جرس سرعة بـ 4 حالات بصرية واهتزازية عبر serverTimestamp()
 * - تحوّل تلقائي لنموذج الرهان السري وإرسال الإجابة القصيرة عند دخول جولة الرهان النهائي
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

  class PlayerMobileController {
    constructor() {
      this.root = null;
      this.roomCode = "";
      this.connected = false;
      this.publicState = null;
      this.selectedTeamIdx = null;
      this.errorMessage = "";
      this.lastBuzzSentRoundId = "";
      this.lastWinnerVibratedRoundId = "";
      this.wagerAmount = 0;
      this.wagerSentRoundKey = "";
      this.answerSentRoundKey = "";
    }

    init() {
      this.root = document.getElementById("player-view-root");
      if (!this.root) return;

      document.title = "سين جيم | جرس الفريق";
      document.body.classList.add("player-mobile-mode");
      document
        .querySelectorAll("body > .screen, body > .modal-overlay, #tv-display-root, #remote-host-root")
        .forEach((el) => {
          el.hidden = true;
          el.classList.remove("active", "open");
        });

      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");

      const utils = window.SeenJeemRealtimeUtils;
      const params = utils ? utils.getUrlParams() : { room: "" };
      this.roomCode = params.room || "";

      if (this.roomCode) {
        const savedTeam = this._loadSavedTeamIdx(this.roomCode);
        if (savedTeam !== null) this.selectedTeamIdx = savedTeam;
      }

      this._render();
      if (this.roomCode) {
        this._connectToRoom(this.roomCode);
      }
    }

    _teamStorageKey(code) {
      return `seen_jeem_player_team_${code}`;
    }

    _loadSavedTeamIdx(code) {
      try {
        const raw = sessionStorage.getItem(this._teamStorageKey(code));
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 && n < 4 ? n : null;
      } catch (_e) {
        return null;
      }
    }

    _saveTeamIdx(code, idx) {
      try {
        sessionStorage.setItem(this._teamStorageKey(code), String(idx));
      } catch (_e) {}
    }

    _clearSavedTeamIdx(code) {
      try {
        sessionStorage.removeItem(this._teamStorageKey(code));
      } catch (_e) {}
    }

    async _connectToRoom(code) {
      const clean = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      this.roomCode = clean;
      const rt = window.SeenJeemRealtimeSync;

      if (!rt || !rt.isConfigured()) {
        this.errorMessage = "الاتصال اللاسلكي (Firebase) غير مُهيّأ في هذا المتصفح. تأكد من تفعيل الغرفة عبر إعدادات Firebase.";
        this._render();
        return;
      }

      this.errorMessage = "";
      this._render();

      try {
        await rt.connectAsPlayer({
          roomCode: clean,
          onPublicState: (pub) => {
            this.publicState = pub;
            if (this.selectedTeamIdx !== null && pub && Array.isArray(pub.teams)) {
              if (!pub.teams[this.selectedTeamIdx]) {
                this.selectedTeamIdx = null;
              } else {
                rt.registerPlayerPresence(this.selectedTeamIdx, pub.teams[this.selectedTeamIdx].name);
              }
            }
            this._triggerWinnerVibrationIfNeeded(pub);
            this._render();
          },
          onConnectionState: (isConn) => {
            this.connected = isConn;
            this._render();
          },
          onError: (err) => {
            this.errorMessage = (err && err.message) || "تعذّر الانضمام للغرفة — تأكد من صحة الرمز.";
            this._render();
          }
        });
      } catch (err) {
        this.errorMessage = (err && err.message) || "تعذّر الاتصال بالغرفة.";
        this._render();
      }
    }

    _getBuzzerState(pub) {
      return (pub && (pub.buzzer || (pub.wireless && pub.wireless.buzzer))) || { state: "locked", roundId: "" };
    }

    _triggerWinnerVibrationIfNeeded(pub) {
      const bz = this._getBuzzerState(pub);
      if (!bz || bz.state !== "buzzed" || !bz.roundId) return;
      if (bz.roundId === this.lastWinnerVibratedRoundId) return;
      if (Number(bz.winnerTeamIdx) === this.selectedTeamIdx) {
        this.lastWinnerVibratedRoundId = bz.roundId;
        if (navigator.vibrate) {
          try { navigator.vibrate([80, 40, 120]); } catch (_e) {}
        }
      }
    }

    _selectTeam(idx) {
      this.selectedTeamIdx = idx;
      if (this.roomCode) this._saveTeamIdx(this.roomCode, idx);
      const teams = (this.publicState && this.publicState.teams) || [];
      const team = teams[idx];
      if (window.SeenJeemRealtimeSync && team) {
        window.SeenJeemRealtimeSync.registerPlayerPresence(idx, team.name);
      }
      if (navigator.vibrate) {
        try { navigator.vibrate(30); } catch (_e) {}
      }
      this._render();
    }

    async _pressBuzzer() {
      const pub = this.publicState;
      const bz = this._getBuzzerState(pub);
      if (!bz || bz.state !== "open" || !bz.roundId || this.selectedTeamIdx === null) return;
      if (this.lastBuzzSentRoundId === bz.roundId) return;

      this.lastBuzzSentRoundId = bz.roundId;
      if (navigator.vibrate) {
        try { navigator.vibrate(50); } catch (_e) {}
      }

      const team = (pub.teams && pub.teams[this.selectedTeamIdx]) || { name: `الفريق ${this.selectedTeamIdx + 1}` };
      await window.SeenJeemRealtimeSync.sendPlayerBuzz(bz.roundId, this.selectedTeamIdx, team.name);
      this._render();
    }

    async _submitSecretWager(maxWager) {
      const fv = this.publicState && this.publicState.finalRoundView;
      if (!fv || this.selectedTeamIdx === null) return;
      const roundId = `r${fv.roundNumber || 1}`;
      const amount = Math.min(maxWager, Math.max(0, Math.round(Number(this.wagerAmount) || 0)));
      const res = await window.SeenJeemRealtimeSync.sendSecretWager(roundId, this.selectedTeamIdx, {
        amount,
        answerText: "",
        locked: true
      });
      if (res.ok) {
        this.wagerSentRoundKey = `${roundId}:${amount}`;
        if (navigator.vibrate) {
          try { navigator.vibrate(45); } catch (_e) {}
        }
        this._render();
      }
    }

    async _submitFinalAnswer(answerText) {
      const fv = this.publicState && this.publicState.finalRoundView;
      if (!fv || this.selectedTeamIdx === null) return;
      const roundId = `r${fv.roundNumber || 1}`;
      const res = await window.SeenJeemRealtimeSync.sendSecretWager(roundId, this.selectedTeamIdx, {
        amount: Math.max(0, Math.round(Number(this.wagerAmount) || 0)),
        answerText: String(answerText || "").trim(),
        locked: true
      });
      if (res.ok) {
        this.answerSentRoundKey = roundId;
        if (navigator.vibrate) {
          try { navigator.vibrate(45); } catch (_e) {}
        }
        this._render();
      }
    }

    _render() {
      if (!this.root) return;

      const pub = this.publicState;
      const teams = (pub && Array.isArray(pub.teams) && pub.teams) || [];

      // 1) شاشة الانضمام للغرفة (إدخال الرمز أو اختيار الفريق)
      if (!this.roomCode || !pub || this.selectedTeamIdx === null || !teams[this.selectedTeamIdx]) {
        const defaultTeams =
          teams.length >= 2
            ? teams
            : [
                { name: "الفريق الأول", score: 0 },
                { name: "الفريق الثاني", score: 0 }
              ];

        this.root.innerHTML = `
          <div class="pl-shell pl-join-shell">
            <header class="pl-join-hero">
              <div class="brand-badge"><span class="brand-dot"></span> جرس الفرق والرهان السري</div>
              <h1 class="pl-brand-title"><span class="brand-highlight">سين</span> جيم</h1>
            </header>

            <section class="pl-card">
              <label for="pl-room-input" class="pl-label">رمز الغرفة (6 أحرف/أرقام من شاشة التلفزيون):</label>
              <div class="pl-room-row">
                <input
                  type="text"
                  id="pl-room-input"
                  class="pl-room-input"
                  maxlength="6"
                  value="${escapeHtml(this.roomCode)}"
                  placeholder="مثال: K7M4P9"
                  autocomplete="off"
                  autocapitalize="characters"
                />
                <button type="button" id="pl-btn-join" class="btn btn-primary pl-touch-btn">انضمام</button>
              </div>
              ${this.errorMessage ? `<p class="pl-error-note">⚠️ ${escapeHtml(this.errorMessage)}</p>` : ""}
            </section>

            <section class="pl-card">
              <h2 class="pl-section-title">👥 اختر فريقك</h2>
              <p class="pl-sub-note">${
                pub
                  ? "اضغط على بطاقة فريقك للدخول إلى الجرس المباشر:"
                  : "بعد الاتصال بالغرفة ستظهر فرق المباراة الحالية هنا لاختيار فريقك."
              }</p>
              <div class="pl-team-grid">
                ${defaultTeams
                  .map(
                    (t, idx) => `
                  <button
                    type="button"
                    class="pl-team-pick-card team-${idx + 1}"
                    data-pick-team="${idx}"
                    ${!pub ? "disabled" : ""}
                  >
                    <span class="team-badge-dot team-${idx + 1}-dot"></span>
                    <strong class="pl-team-pick-name">${escapeHtml(t.name)}</strong>
                    <span class="pl-team-pick-score">${Number(t.score) || 0} نقطة</span>
                  </button>
                `
                  )
                  .join("")}
              </div>
            </section>
          </div>
        `;

        const joinBtn = document.getElementById("pl-btn-join");
        const roomInp = document.getElementById("pl-room-input");
        if (joinBtn && roomInp) {
          joinBtn.addEventListener("click", () => this._connectToRoom(roomInp.value));
          roomInp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._connectToRoom(roomInp.value);
          });
        }
        this.root.querySelectorAll("[data-pick-team]").forEach((btn) => {
          btn.addEventListener("click", () => this._selectTeam(Number(btn.dataset.pickTeam)));
        });
        return;
      }

      const team = teams[this.selectedTeamIdx];
      const teamNum = this.selectedTeamIdx + 1;
      const fv = pub.screen === "final" ? pub.finalRoundView : null;
      const participant =
        fv && Array.isArray(fv.participants)
          ? fv.participants.find((p) => Number(p.teamIdx) === this.selectedTeamIdx)
          : null;

      // 2) وضع الرهان السري التلقائي أثناء الجولة النهائية
      if (fv && participant) {
        const roundId = `r${fv.roundNumber || 1}`;
        const maxWager = Math.max(400, Number(team.score) || 0);
        if (this.wagerAmount > maxWager) this.wagerAmount = maxWager;

        let finalBody = "";
        if (fv.phase === "wager") {
          const isSent = this.wagerSentRoundKey.startsWith(`${roundId}:`);
          finalBody = `
            <section class="pl-card pl-wager-card">
              <div class="final-eyebrow">⚔️ جولة الرهان النهائي السري</div>
              <h2 class="pl-wager-title">حدّد مبلغ رهانك سراً</h2>
              <p class="pl-sub-note">الفئة: <strong>${escapeHtml((fv.category && fv.category.name) || "")}</strong> • الحد الأقصى: <strong>${maxWager}</strong></p>

              <div class="pl-wager-big-val" id="pl-wager-val">${this.wagerAmount}</div>
              <input type="range" id="pl-wager-range" class="pl-wager-range" min="0" max="${maxWager}" step="50" value="${this.wagerAmount}" />

              <div class="pl-preset-row">
                <button type="button" class="wager-preset-chip" data-pl-pct="0">0</button>
                <button type="button" class="wager-preset-chip" data-pl-pct="0.25">25%</button>
                <button type="button" class="wager-preset-chip" data-pl-pct="0.5">50%</button>
                <button type="button" class="wager-preset-chip is-allin" data-pl-pct="1">الكل (${maxWager})</button>
              </div>

              <button type="button" id="pl-btn-send-wager" class="btn btn-amber pl-touch-btn pl-full-btn">
                ${isSent ? "✅ تم إرسال الرهان (اضغط لتعديله)" : "🔒 تثبيت الرهان السري"}
              </button>
            </section>
          `;
        } else if (fv.phase === "question") {
          const sentAns = this.answerSentRoundKey === roundId;
          finalBody = `
            <section class="pl-card pl-wager-card">
              <div class="final-eyebrow">⚔️ سؤال الحسم الختامي</div>
              <p class="pl-final-q">${escapeHtml(fv.questionText || "")}</p>
              <label for="pl-final-answer-input" class="pl-label">أرسل إجابتك القصيرة سراً للمقدّم (اختياري):</label>
              <input type="text" id="pl-final-answer-input" class="pl-room-input pl-answer-input" maxlength="140" placeholder="اكتب إجابة فريقك هنا..." />
              <button type="button" id="pl-btn-send-answer" class="btn btn-primary pl-touch-btn pl-full-btn">
                ${sentAns ? "✅ تم إرسال الإجابة السرية" : "📤 إرسال الإجابة للمقدّم"}
              </button>
            </section>
          `;
        } else {
          finalBody = `
            <section class="pl-card pl-wager-card">
              <div class="final-eyebrow">🏆 نتائج جولة الحسم</div>
              <h2 class="pl-wager-title">تابع كشف النتائج على شاشة التلفزيون!</h2>
            </section>
          `;
        }

        this.root.innerHTML = this._wrapPlayerChrome(team, teamNum, finalBody);
        this._bindChromeEvents();

        const range = document.getElementById("pl-wager-range");
        const valEl = document.getElementById("pl-wager-val");
        if (range) {
          range.addEventListener("input", () => {
            this.wagerAmount = Number(range.value) || 0;
            if (valEl) valEl.textContent = String(this.wagerAmount);
          });
        }
        this.root.querySelectorAll("[data-pl-pct]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const pct = Number(btn.dataset.plPct) || 0;
            this.wagerAmount = Math.round((maxWager * pct) / 50) * 50;
            if (pct === 1) this.wagerAmount = maxWager;
            if (range) range.value = String(this.wagerAmount);
            if (valEl) valEl.textContent = String(this.wagerAmount);
          });
        });
        const sendWagerBtn = document.getElementById("pl-btn-send-wager");
        if (sendWagerBtn) sendWagerBtn.addEventListener("click", () => this._submitSecretWager(maxWager));

        const sendAnsBtn = document.getElementById("pl-btn-send-answer");
        const ansInp = document.getElementById("pl-final-answer-input");
        if (sendAnsBtn && ansInp) {
          sendAnsBtn.addEventListener("click", () => this._submitFinalAnswer(ansInp.value));
        }
        return;
      }

      // 3) وضع جرس السرعة (4 حالات بصرية واهتزازية)
      const bz = this._getBuzzerState(pub);
      let stateClass = "state-locked";
      let icon = "⏳";
      let mainText = "بانتظار فتح الجرس";
      let subText = "سيضيء الزر فور فتح المقدّم للجرس";
      let disabled = true;

      if (bz.state === "open") {
        const alreadySent = this.lastBuzzSentRoundId === bz.roundId;
        if (alreadySent) {
          stateClass = "state-locked";
          icon = "⚡";
          mainText = "تم تسجيل ضغطتك!";
          subText = "جاري مقارنة التوقيت بالميلي ثانية...";
          disabled = true;
        } else {
          stateClass = `state-open team-${teamNum}`;
          icon = "🔔";
          mainText = "اضغط الآن!";
          subText = "كن الأسرع للحصول على فرصة الإجابة";
          disabled = false;
        }
      } else if (bz.state === "buzzed") {
        if (Number(bz.winnerTeamIdx) === this.selectedTeamIdx) {
          stateClass = "state-winner";
          icon = "🏆";
          mainText = "فريقك الأسرع!";
          subText =
            bz.runnerUpDeltaMs !== null && bz.runnerUpDeltaMs !== undefined
              ? `تقدّمت على أقرب منافس بـ +${bz.runnerUpDeltaMs}ms`
              : "أجب الآن بصوت عالٍ!";
          disabled = true;
        } else {
          stateClass = "state-lost";
          icon = "⚡";
          const deltaTxt =
            bz.runnerUpDeltaMs !== null && bz.runnerUpDeltaMs !== undefined
              ? ` بـ +${bz.runnerUpDeltaMs}ms`
              : "";
          mainText = `سبقك ${bz.winnerTeamName || "فريق آخر"}`;
          subText = `تم قفل الجرس${deltaTxt}`;
          disabled = true;
        }
      }

      const buzzerBody = `
        <div class="pl-buzzer-arena">
          <button
            type="button"
            id="pl-buzzer-btn"
            class="pl-buzzer-btn ${stateClass}"
            ${disabled ? "disabled" : ""}
            aria-label="${escapeHtml(mainText)}"
          >
            <span class="pl-buzzer-icon" aria-hidden="true">${icon}</span>
            <span class="pl-buzzer-label">${escapeHtml(mainText)}</span>
            <span class="pl-buzzer-sub">${escapeHtml(subText)}</span>
          </button>
        </div>
      `;

      this.root.innerHTML = this._wrapPlayerChrome(team, teamNum, buzzerBody);
      this._bindChromeEvents();

      const bzBtn = document.getElementById("pl-buzzer-btn");
      if (bzBtn) {
        bzBtn.addEventListener("pointerdown", (e) => {
          if (bzBtn.disabled) return;
          if (e.cancelable) e.preventDefault();
          this._pressBuzzer();
        });
      }
    }

    _wrapPlayerChrome(team, teamNum, bodyHtml) {
      return `
        <div class="pl-shell pl-team-theme-${teamNum}">
          <header class="pl-topbar">
            <div class="pl-topbar-team">
              <span class="team-badge-dot team-${teamNum}-dot"></span>
              <strong class="pl-team-title">${escapeHtml(team.name)}</strong>
              <span class="pl-team-score">${Number(team.score) || 0} نقطة</span>
            </div>
            <div class="pl-topbar-right">
              <span class="rh-conn-pill ${this.connected ? "is-online" : "is-reconnecting"}">
                ${this.connected ? "🟢 متصل" : "🟡 يعيد الاتصال"}
              </span>
              <button type="button" id="pl-btn-change-team" class="btn btn-ghost btn-xxs" title="تغيير الفريق">
                تبديل
              </button>
            </div>
          </header>
          <main class="pl-main">${bodyHtml}</main>
        </div>
      `;
    }

    _bindChromeEvents() {
      const changeBtn = document.getElementById("pl-btn-change-team");
      if (changeBtn) {
        changeBtn.addEventListener("click", () => {
          this.selectedTeamIdx = null;
          if (this.roomCode) this._clearSavedTeamIdx(this.roomCode);
          this._render();
        });
      }
    }
  }

  window.SeenJeemPlayerView = new PlayerMobileController();
})();
