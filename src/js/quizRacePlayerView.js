/**
 * واجهة هاتف اللاعب لطور «🏁 تحدي الكل» (?mode=quiz-race-player&room=CODE)
 * - موبايل-أولاً RTL بدون أي تمرير أفقي، وأزرار الخيارات الأربعة بارتفاع >= 64px بألوان وأشكال واضحة (▲ ◆ ● ■)
 * - تعبئة تلقائية للاسم والرمز التعبيري من بروفايل اللاعب مع استعادة الجلسة عبر sessionStorage
 * - تعرض حالة التثبيت الفوري ثم نتيجة كل سؤال (أخضر/أحمر + النقاط + الترتيب + السلسلة) فور الكشف
 */
(function () {
  "use strict";

  const NAME_KEY = "quiz_race_player_name_v1";
  const JOINED_ROOM_KEY = "quiz_race_joined_room_v1";

  const OPTION_STYLES = [
    { key: "red", shape: "▲", label: "أ" },
    { key: "blue", shape: "◆", label: "ب" },
    { key: "amber", shape: "●", label: "ج" },
    { key: "green", shape: "■", label: "د" }
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

  class QuizRacePlayerController {
    constructor() {
      this.root = null;
      this.roomCode = "";
      this.playerName =
        this._loadSession(NAME_KEY) ||
        (window.SeenJeemProfile && window.SeenJeemProfile.getRoomIdentity().name) ||
        "";
      this.playerAvatar =
        (window.SeenJeemProfile && window.SeenJeemProfile.getRoomIdentity().avatar) || "⚡";
      this.joined = false;
      this.connected = false;
      this.kicked = false;
      this.meta = null;
      this.publicState = null;
      this.playerResult = null;
      this.playersMap = {};
      this.errorMessage = "";

      this.answeredQuestionKey = "";
      this.pickedOptionIndex = null;
      this.pickedOptionText = "";
      this.submitting = false;
      this._timerLoop = null;
    }

    init() {
      this.root = document.getElementById("quiz-race-player-root");
      if (!this.root) return;

      document.title = "سين جيم | تحدي الكل — هاتف اللاعب";
      document.body.classList.add("player-mobile-mode");
      document
        .querySelectorAll(
          "body > .screen, body > .modal-overlay, #tv-display-root, #remote-host-root, #player-view-root, #bara-player-root, #mafia-player-root, #quick-player-root"
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

    _safeVibrate(ms) {
      try {
        if (navigator && typeof navigator.vibrate === "function") navigator.vibrate(ms);
      } catch (_e) {}
    }

    _getMyUid() {
      return window.SeenJeemQuizRaceSync ? window.SeenJeemQuizRaceSync.getUid() : "";
    }

    _stopTimerLoop() {
      if (this._timerLoop) {
        clearInterval(this._timerLoop);
        this._timerLoop = null;
      }
    }

    _getRemainingSecs() {
      const pub = this.publicState;
      const t = pub && pub.timer;
      if (!t || t.status !== "running") return 0;
      const sync = window.SeenJeemQuizRaceSync;
      const utils = window.SeenJeemQuizRaceSyncUtils;
      const offset = sync ? sync.getServerTimeOffsetMs() : 0;
      const remMs = utils ? utils.computeRemainingMs(t, offset) : 0;
      return Math.max(0, Math.ceil(remMs / 1000));
    }

    _syncTimerLoop() {
      const t = this.publicState && this.publicState.timer;
      if (!t || t.status !== "running") {
        this._stopTimerLoop();
        return;
      }
      if (this._timerLoop) return;
      this._timerLoop = setInterval(() => {
        const curT = this.publicState && this.publicState.timer;
        if (!curT || curT.status !== "running") {
          this._stopTimerLoop();
          return;
        }
        const el = document.getElementById("qrp-live-timer");
        if (el) {
          const secs = this._getRemainingSecs();
          el.textContent = `${secs}ث`;
          el.classList.toggle("is-urgent", secs <= 5 && secs > 0);
        }
      }, 200);
    }

    async _connectToRoom(code, autoJoin = false) {
      const clean = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (clean.length < 4) {
        this.errorMessage = "يرجى إدخال رمز غرفة صحيح (6 أحرف/أرقام).";
        this._render();
        return;
      }
      const sync = window.SeenJeemQuizRaceSync;
      if (!sync || !sync.isConfigured()) {
        this.errorMessage = "تعذّر الاتصال بغرفة اللعب حالياً — تأكد من الاتصال بالإنترنت.";
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
            this.playerResult = null;
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
            const prevKey = this._currentQuestionKey(this.publicState);
            this.publicState = pub;
            const nextKey = this._currentQuestionKey(pub);
            if (nextKey !== prevKey) {
              this.pickedOptionIndex = null;
              this.pickedOptionText = "";
              this.submitting = false;
            }
            this._render();
            this._syncTimerLoop();
          },
          onPlayerResult: (res) => {
            this.playerResult = res;
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

    _currentQuestionKey(pub) {
      if (!pub) return "";
      return `${pub.raceId || ""}:${pub.questionIndex ?? -1}`;
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

      const sync = window.SeenJeemQuizRaceSync;
      if (!sync || !sync.isActive()) {
        await this._connectToRoom(this.roomCode, true);
        return;
      }

      const isLocked = Boolean((this.meta && this.meta.joinLocked) || (this.publicState && this.publicState.joinLocked));
      if (isLocked && !this.joined) {
        this.errorMessage = "🔒 الغرفة مقفلة حالياً من قِبل المقدّم";
        this._render();
        return;
      }

      const res = await sync.registerPlayer(cleanName, this.playerAvatar);
      if (res.ok) {
        this.joined = true;
        this.errorMessage = "";
        this._saveSession(JOINED_ROOM_KEY, this.roomCode);
        this._safeVibrate(30);
      } else {
        this.errorMessage = res.error || "تعذّر الانضمام للغرفة.";
      }
      this._render();
    }

    async _submitChoice(optionIndex, optionText) {
      const pub = this.publicState;
      const sync = window.SeenJeemQuizRaceSync;
      if (!pub || !sync || pub.phase !== "question" || this.submitting) return;
      const qKey = this._currentQuestionKey(pub);
      if (this.answeredQuestionKey === qKey) return;

      this.submitting = true;
      this._render();
      const res = await sync.submitAnswer({
        questionIndex: pub.questionIndex || 0,
        optionIndex,
        raceId: pub.raceId || ""
      });
      this.submitting = false;
      if (res.ok) {
        this.answeredQuestionKey = qKey;
        this.pickedOptionIndex = optionIndex;
        this.pickedOptionText = optionText || "";
        this._safeVibrate(40);
      } else {
        this.errorMessage = res.error || "تعذّر إرسال إجابتك.";
      }
      this._render();
    }

    _render() {
      if (!this.root) return;
      const phase = (this.publicState && this.publicState.phase) || "setup";

      let bodyHtml = "";
      if (this.kicked) {
        bodyHtml = `
          <div class="qrp-card qrp-center">
            <div class="qrp-big-emoji">🚫</div>
            <h2>تم إخراجك من الغرفة</h2>
            <p class="qrp-muted">قام المقدّم بإزالة جهازك من غرفة «تحدي الكل» الحالية.</p>
          </div>
        `;
      } else if (!this.joined) {
        bodyHtml = this._renderJoinHtml();
      } else {
        bodyHtml = this._renderPhaseHtml(phase);
      }

      this.root.innerHTML = `
        <div class="qrp-shell">
          <header class="qrp-topbar">
            <div class="qrp-brand">🏁 <span>تحدي الكل</span></div>
            <div class="qrp-meta-pills">
              ${this.roomCode ? `<span class="qrp-code-pill">${escapeHtml(this.roomCode)}</span>` : ""}
              <span class="qrp-conn-dot ${this.connected ? "is-on" : ""}">${this.connected ? "🟢 متصل" : "⚪ اتصال..."}</span>
            </div>
          </header>
          ${this.errorMessage ? `<div class="qrp-error-banner">⚠️ ${escapeHtml(this.errorMessage)}</div>` : ""}
          <main class="qrp-main">${bodyHtml}</main>
        </div>
      `;

      this._bindEvents();
    }

    _renderJoinHtml() {
      const playersCount = Object.keys(this.playersMap || {}).length;
      const isLocked = Boolean((this.meta && this.meta.joinLocked) || (this.publicState && this.publicState.joinLocked));
      return `
        <form id="qrp-join-form" class="qrp-card qrp-join-card">
          <div class="qrp-big-emoji">🏁</div>
          <h2>انضم لسباق «تحدي الكل»</h2>
          <p class="qrp-muted">أدخل رمز الغرفة واسمك لتتسابق بالإجابات السريعة مباشرة من هاتفك!</p>
          <label class="qrp-label" for="qrp-room-input">رمز الغرفة (6 أحرف/أرقام)</label>
          <input id="qrp-room-input" type="text" class="text-input qrp-input" maxlength="6" value="${escapeHtml(this.roomCode)}" placeholder="مثال: K7M4P9" autocomplete="off" autocapitalize="characters" />
          <label class="qrp-label" for="qrp-name-input">اسمك في السباق</label>
          <input id="qrp-name-input" type="text" class="text-input qrp-input" maxlength="24" value="${escapeHtml(this.playerName)}" placeholder="اكتب اسمك..." autocomplete="off" />
          ${isLocked ? `<div class="qrp-locked-banner">🔒 الغرفة مقفلة حالياً من قِبل المقدّم</div>` : ""}
          <button type="submit" class="btn btn-primary qrp-big-btn" ${isLocked ? "disabled" : ""}>🚀 دخول السباق الآن</button>
          ${playersCount > 0 ? `<div class="qrp-muted qrp-small-note">👥 يوجد حالياً ${playersCount} متسابق في اللوبي</div>` : ""}
        </form>
      `;
    }

    _renderPhaseHtml(phase) {
      const pub = this.publicState || {};
      const myUid = this._getMyUid();
      const roster = Array.isArray(pub.playersRoster) ? pub.playersRoster : [];
      const me = roster.find((p) => p.uid === myUid);

      if (phase === "setup") {
        return `
          <div class="qrp-card qrp-center">
            <div class="qrp-big-emoji">${escapeHtml(this.playerAvatar || "🏁")}</div>
            <h2>أهلاً يا ${escapeHtml(this.playerName)}!</h2>
            <p class="qrp-muted">أنت جاهز على خط الانطلاق — بانتظار بدء السباق من الشاشة الرئيسية (${roster.length} متسابق).</p>
            <div class="qrp-chips-wrap">
              ${roster.map((p) => `<span class="qrp-chip${p.uid === myUid ? " is-me" : ""}">${escapeHtml(p.avatar || "👤")} ${escapeHtml(p.name)}</span>`).join("")}
            </div>
          </div>
        `;
      }

      if (phase === "question") {
        const q = pub.currentQuestion || {};
        const qKey = this._currentQuestionKey(pub);
        const alreadyAnswered = this.answeredQuestionKey === qKey;
        const countdownNum = Number(pub.countdownNumber) || 0;

        if (countdownNum > 0) {
          return `
            <div class="qrp-card qrp-center qrp-countdown-card">
              <div class="qrp-phase-tag">السؤال ${(pub.questionIndex || 0) + 1} من ${pub.totalQuestions || 1}</div>
              <h2>استعد للسؤال!</h2>
              <div class="qrp-countdown-num">${countdownNum}</div>
              <p class="qrp-muted">ضع أصابعك جاهزة للاختيار السريع...</p>
            </div>
          `;
        }

        if (alreadyAnswered) {
          const pickedStyle = OPTION_STYLES[this.pickedOptionIndex] || OPTION_STYLES[0];
          return `
            <div class="qrp-card qrp-center qrp-locked-card">
              <div class="qrp-big-emoji">✅</div>
              <h2>تم تثبيت إجابتك!</h2>
              <div class="qrp-picked-pill is-${pickedStyle.key}">${pickedStyle.shape} ${escapeHtml(this.pickedOptionText)}</div>
              <p class="qrp-muted">بانتظار انتهاء المؤقت وكشف النتيجة على الشاشة الرئيسية...</p>
            </div>
          `;
        }

        const options = Array.isArray(q.options) ? q.options : [];
        return `
          <div class="qrp-card qrp-question-card">
            <div class="qrp-q-head">
              <span class="qrp-phase-tag">السؤال ${(pub.questionIndex || 0) + 1} / ${pub.totalQuestions || 1}</span>
              <span id="qrp-live-timer" class="qrp-timer-pill">${this._getRemainingSecs()}ث</span>
            </div>
            <p class="qrp-q-prompt">${escapeHtml(q.prompt || "اختر الإجابة الصحيحة بأسرع وقت!")}</p>
            <div class="qrp-options-grid">
              ${options
                .map((optText, idx) => {
                  const st = OPTION_STYLES[idx] || OPTION_STYLES[0];
                  return `
                    <button type="button" class="qrp-opt-btn is-${st.key}" data-qrp-opt="${idx}" data-qrp-text="${escapeHtml(optText)}" ${this.submitting ? "disabled" : ""}>
                      <span class="qrp-opt-shape" aria-hidden="true">${st.shape}</span>
                      <span class="qrp-opt-text">${escapeHtml(optText)}</span>
                    </button>
                  `;
                })
                .join("")}
            </div>
          </div>
        `;
      }

      if (phase === "reveal" || phase === "leaderboard") {
        const res =
          this.playerResult && Number(this.playerResult.questionIndex) === Number(pub.questionIndex)
            ? this.playerResult
            : null;
        const isCorrect = Boolean(res && res.isCorrect);
        const earned = res ? Number(res.earnedPoints) || 0 : 0;
        const streak = res ? Number(res.streak) || 0 : 0;
        const total = res ? Number(res.totalScore) || 0 : me ? Number(me.score) || 0 : 0;
        const rank = res ? Number(res.rank) || 0 : 0;
        const correctText = (res && res.correctOptionText) || (pub.revealData && pub.revealData.correctOptionText) || "";

        return `
          <div class="qrp-card qrp-center qrp-result-card ${isCorrect ? "is-correct" : "is-wrong"}">
            <div class="qrp-big-emoji">${isCorrect ? "🎉✅" : res && res.timedOut ? "⏰" : "❌"}</div>
            <h2>${isCorrect ? "إجابة صحيحة!" : res && res.timedOut ? "انتهى الوقت!" : "إجابة خاطئة"}</h2>
            ${
              isCorrect
                ? `<div class="qrp-points-earned">+${earned} نقطة</div>`
                : `<div class="qrp-points-earned is-zero">0 نقطة</div>`
            }
            ${
              correctText && !isCorrect
                ? `<div class="qrp-correct-hint">الإجابة الصحيحة: <strong>${escapeHtml(correctText)}</strong></div>`
                : ""
            }
            <div class="qrp-stats-row">
              <div class="qrp-stat-pill"><span>رصيدك</span><strong>${total}</strong></div>
              ${rank > 0 ? `<div class="qrp-stat-pill"><span>ترتيبك</span><strong>#${rank}</strong></div>` : ""}
              ${streak >= 2 ? `<div class="qrp-stat-pill is-streak"><span>السلسلة</span><strong>🔥 ${streak}</strong></div>` : ""}
            </div>
            <p class="qrp-muted">${phase === "leaderboard" ? "انظر للوحة الصدارة — السؤال التالي قادم!" : "انظر للشاشة الرئيسية لمتابعة الترتيب!"}</p>
          </div>
        `;
      }

      if (phase === "game_over") {
        const standings = Array.isArray(pub.finalStandings) ? pub.finalStandings : roster;
        const myIdx = standings.findIndex((p) => p.uid === myUid);
        const myEntry = myIdx >= 0 ? standings[myIdx] : me;
        const rank = myIdx >= 0 ? myIdx + 1 : 0;
        const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "🏁";
        return `
          <div class="qrp-card qrp-center qrp-gameover-card">
            <div class="qrp-big-emoji">${medal}</div>
            <h2>${rank === 1 ? "أنت بطل السباق!" : rank > 0 ? `المركز #${rank}` : "انتهى السباق!"}</h2>
            ${
              myEntry
                ? `
                  <div class="qrp-points-earned">${Number(myEntry.score) || 0} نقطة</div>
                  <p class="qrp-muted">دقة إجاباتك: <strong>${Number(myEntry.accuracy) || 0}%</strong> (${Number(myEntry.correctCount) || 0} صحيحة)</p>
                `
                : ""
            }
            <div class="qrp-mini-standings">
              ${standings
                .slice(0, 5)
                .map(
                  (p, i) => `
                <div class="qrp-mini-row${p.uid === myUid ? " is-me" : ""}">
                  <span>${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`} ${escapeHtml(p.name)}</span>
                  <strong>${Number(p.score) || 0}</strong>
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        `;
      }

      return `<div class="qrp-card qrp-center"><p class="qrp-muted">بانتظار تحديث السباق...</p></div>`;
    }

    _bindEvents() {
      const form = document.getElementById("qrp-join-form");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const rInp = document.getElementById("qrp-room-input");
          const nInp = document.getElementById("qrp-name-input");
          const nextRoom = rInp ? rInp.value.trim().toUpperCase() : "";
          const nextName = nInp ? nInp.value.trim() : "";
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

      this.root.querySelectorAll("[data-qrp-opt]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.qrpOpt);
          const text = btn.dataset.qrpText || "";
          if (Number.isFinite(idx)) this._submitChoice(idx, text);
        });
      });
    }
  }

  window.SeenJeemQuizRacePlayerView = new QuizRacePlayerController();
})();
