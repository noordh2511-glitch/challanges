/**
 * واجهة هاتف اللاعب للعبة «برا السالفة» (?mode=bara-player&room=CODE)
 * - موبايل-أولاً RTL بأزرار >= 48px بدون تمرير أفقي
 * - حفظ الاسم والغرفة في sessionStorage لتجاوز إعادة الإدخال عند F5
 * - قراءة الدور السري من privateRoles/{uid} فقط (الكلمة null للي برا السالفة)
 * - بطاقة Hold-to-Reveal / إظهار وإخفاء الدور السري + زر تذكير سري أثناء الأسئلة والنقاش
 * - عدّاد نقاش محلي من endAtMs + serverTimeOffset، تصويت سري (مستبعداً النفس)، تخمين من 8 خيارات، وعرض النتائج
 */
(function () {
  "use strict";

  const NAME_KEY = "bara_salfa_player_name_v1";
  const JOINED_ROOM_KEY = "bara_salfa_joined_room_v1";

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

  class BaraPlayerMobileController {
    constructor() {
      this.root = null;
      this.roomCode = "";
      this.playerName = this._loadSession(NAME_KEY);
      this.joined = false;
      this.preApproved = false;
      this.connected = false;
      this.kicked = false;
      this.meta = null;
      this.publicState = null;
      this.privateRole = null;
      this.playersMap = {};
      this.errorMessage = "";

      this.roleVisible = false;
      this.reminderOpen = false;
      this.readySentRound = 0;
      this.votedRound = 0;
      this.votedTargetName = "";
      this.guessedRound = 0;
      this.guessedWord = "";
      this._timerLoop = null;
    }

    init() {
      this.root = document.getElementById("bara-player-root");
      if (!this.root) return;

      document.title = "سين جيم | برا السالفة — هاتف اللاعب";
      document.body.classList.add("player-mobile-mode");
      document
        .querySelectorAll("body > .screen, body > .modal-overlay, #tv-display-root, #remote-host-root, #player-view-root")
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
        this._connectToRoom(this.roomCode, Boolean(this.playerName && this._loadSession(JOINED_ROOM_KEY) === this.roomCode));
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

    _safeVibrate(pattern) {
      try {
        if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
          navigator.vibrate(pattern);
        }
      } catch (_e) {}
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
      const sync = window.SeenJeemBaraSalfaSync;
      const utils = window.SeenJeemBaraSalfaSyncUtils;
      const offset = sync && typeof sync.getServerTimeOffsetMs === "function" ? sync.getServerTimeOffsetMs() : 0;
      const secs =
        utils && typeof utils.computeRemainingSeconds === "function"
          ? utils.computeRemainingSeconds(timerObj, 0, offset)
          : 0;
      return secs === null ? "∞" : formatTime(secs);
    }

    _syncTimerLoop() {
      const t = this.publicState && this.publicState.phase === "discussion" ? this.publicState.timer : null;
      const running = Boolean(t && t.status === "running" && Number.isFinite(t.endAtMs));
      if (!running) {
        this._stopTimerLoop();
        return;
      }
      if (this._timerLoop) return;
      this._timerLoop = setInterval(() => {
        const curT = this.publicState && this.publicState.phase === "discussion" ? this.publicState.timer : null;
        if (!curT || curT.status !== "running") {
          this._stopTimerLoop();
          return;
        }
        const el = document.getElementById("bp-live-timer");
        if (el) el.textContent = this._formatLiveTimer(curT);
      }, 250);
    }

    _handleKicked() {
      this._stopTimerLoop();
      this.kicked = true;
      this.joined = false;
      this.connected = false;
      this.publicState = null;
      this.privateRole = null;
      this._saveSession(JOINED_ROOM_KEY, "");
      this._render();
    }

    async _connectToRoom(code, autoJoin = false) {
      const clean = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (clean.length < 4) {
        this.errorMessage = "يرجى إدخال رمز غرفة صحيح من 6 أحرف/أرقام.";
        this._render();
        return;
      }
      const sync = window.SeenJeemBaraSalfaSync;
      if (!sync || !sync.isConfigured()) {
        this.errorMessage = "إعدادات Firebase غير مُهيّأة في هذا المتصفح.";
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
          onKicked: () => this._handleKicked(),
          onMeta: (m) => {
            this.meta = m;
            this._render();
          },
          onPlayers: (map) => {
            this.playersMap = map && typeof map === "object" ? map : {};
            const myUid = sync.getUid();
            if (myUid && this.playersMap[myUid]) {
              this.joined = true;
            }
            if (!this.joined || (this.publicState && this.publicState.phase === "setup")) {
              this._render();
            }
          },
          onPublicState: (pub) => {
            const prevRound = this.publicState ? this.publicState.roundNumber : 0;
            this.publicState = pub;
            if (pub && pub.roundNumber !== prevRound) {
              this.roleVisible = false;
              this.reminderOpen = false;
            }
            this._render();
            this._syncTimerLoop();
          },
          onPrivateRole: (role) => {
            this.privateRole = role;
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

      const sync = window.SeenJeemBaraSalfaSync;
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
      if (!res.ok) {
        this.errorMessage = res.error || "تعذّر الانضمام للغرفة.";
        this._render();
        return;
      }

      this.joined = true;
      this.errorMessage = "";
      this._saveSession(JOINED_ROOM_KEY, this.roomCode);
      this._safeVibrate(30);
      this._render();
    }

    async _sendReady() {
      const pub = this.publicState;
      const sync = window.SeenJeemBaraSalfaSync;
      if (!pub || !sync || this.kicked) return;
      const res = await sync.submitAction({ readyRound: pub.roundNumber });
      if (res.ok) {
        this.readySentRound = pub.roundNumber;
        this.roleVisible = false;
        this._safeVibrate(35);
        this._render();
      }
    }

    async _sendVote(targetUid, targetName) {
      const pub = this.publicState;
      const sync = window.SeenJeemBaraSalfaSync;
      if (!pub || !sync || this.kicked || !targetUid || targetUid === sync.getUid()) return;
      const res = await sync.submitAction({ voteRound: pub.roundNumber, voteTargetUid: targetUid });
      if (res.ok) {
        this.votedRound = pub.roundNumber;
        this.votedTargetName = targetName;
        this._safeVibrate(40);
        this._render();
      }
    }

    async _sendGuess(word) {
      const pub = this.publicState;
      const sync = window.SeenJeemBaraSalfaSync;
      if (!pub || !sync || this.kicked || !word) return;
      const res = await sync.submitAction({ guessRound: pub.roundNumber, guessWord: word });
      if (res.ok) {
        this.guessedRound = pub.roundNumber;
        this.guessedWord = word;
        this._safeVibrate(45);
        this._render();
      }
    }

    _renderRoleCardContent(role) {
      if (!role) return `<p class="pl-sub-note">بانتظار توزيع الأدوار من جهاز المقدّم...</p>`;
      if (role.isOutsider) {
        return `
          <div class="bp-role-cat">${escapeHtml(role.categoryIcon || "🕵️")} الفئة: ${escapeHtml(role.categoryName || "")}</div>
          <div class="bp-role-outsider">🕵️ أنت برا السالفة!</div>
          <p class="pl-sub-note">حاول تفهم الموضوع من الأسئلة بدون ما ينتبه أحد!</p>
        `;
      }
      return `
        <div class="bp-role-cat">${escapeHtml(role.categoryIcon || "🎯")} الفئة: ${escapeHtml(role.categoryName || "")}</div>
        <div class="bp-role-insider-lbl">أنت داخل السالفة — الكلمة هي:</div>
        <div class="bp-role-word">${escapeHtml(role.secretWord || "")}</div>
      `;
    }

    _wrapChrome(bodyHtml) {
      return `
        <div class="pl-shell">
          <header class="pl-topbar">
            <div class="pl-topbar-team">
              <span class="brand-dot"></span>
              <strong class="pl-team-title">🕵️ ${escapeHtml(this.playerName || "برا السالفة")}</strong>
              <span class="pl-team-score">${escapeHtml(this.roomCode)}</span>
            </div>
            <div class="pl-topbar-right">
              <span class="rh-conn-pill ${this.connected ? "is-online" : "is-reconnecting"}">
                ${this.connected ? "🟢 متصل" : "🟡 يعيد الاتصال"}
              </span>
            </div>
          </header>
          <main class="pl-main">${bodyHtml}</main>
        </div>
      `;
    }

    _render() {
      if (!this.root) return;

      if (this.kicked) {
        this.root.innerHTML = `
          <div class="pl-shell pl-join-shell">
            <header class="pl-join-hero">
              <div class="brand-badge"><span class="brand-dot"></span> لعبة برا السالفة</div>
              <h1 class="pl-brand-title"><span class="brand-highlight">برا</span> السالفة</h1>
            </header>
            <section class="pl-card pl-kicked-card">
              <div class="pl-kicked-icon">🚫</div>
              <h2 class="pl-kicked-title">تم إخراجك من الغرفة بواسطة المقدّم</h2>
              <p class="pl-sub-note">تم فصل الاتصال بهذه الغرفة. يمكنك التواصل مع المقدّم للانضمام مجدداً في غرفة جديدة.</p>
            </section>
          </div>
        `;
        return;
      }

      const isLocked = Boolean((this.meta && this.meta.joinLocked) || (this.publicState && this.publicState.joinLocked));
      const blockedByLock = Boolean(isLocked && !this.joined && !this.preApproved);

      // 1) شاشة الانضمام
      if (!this.joined) {
        this.root.innerHTML = `
          <div class="pl-shell pl-join-shell">
            <header class="pl-join-hero">
              <div class="brand-badge"><span class="brand-dot"></span> لعبة برا السالفة اللاسلكية</div>
              <h1 class="pl-brand-title"><span class="brand-highlight">برا</span> السالفة</h1>
            </header>

            <section class="pl-card">
              <label for="bp-room-input" class="pl-label">رمز الغرفة (6 أحرف/أرقام):</label>
              <input
                type="text"
                id="bp-room-input"
                class="pl-room-input"
                maxlength="6"
                value="${escapeHtml(this.roomCode)}"
                placeholder="مثال: K7M4P9"
                autocomplete="off"
                autocapitalize="characters"
              />
              <label for="bp-name-input" class="pl-label">اسمك في اللعبة:</label>
              <input
                type="text"
                id="bp-name-input"
                class="pl-room-input pl-label-input"
                maxlength="24"
                value="${escapeHtml(this.playerName)}"
                placeholder="اكتب اسمك هنا..."
                autocomplete="off"
              />
              ${blockedByLock ? `<div class="pl-locked-banner">🔒 الغرفة مقفلة حالياً من قِبل المقدّم</div>` : ""}
              ${this.errorMessage ? `<p class="pl-error-note">⚠️ ${escapeHtml(this.errorMessage)}</p>` : ""}
              <button type="button" id="bp-btn-join" class="btn btn-primary pl-touch-btn pl-full-btn" ${blockedByLock ? "disabled" : ""}>
                🕵️ انضم للعبة الآن
              </button>
            </section>
          </div>
        `;

        const joinBtn = document.getElementById("bp-btn-join");
        const roomInp = document.getElementById("bp-room-input");
        const nameInp = document.getElementById("bp-name-input");
        const submitJoin = () => {
          const code = (roomInp ? roomInp.value : this.roomCode).trim().toUpperCase();
          const name = (nameInp ? nameInp.value : this.playerName).trim();
          this.roomCode = code;
          this.playerName = name;
          this._saveSession(NAME_KEY, name);
          const sync = window.SeenJeemBaraSalfaSync;
          if (!sync || !sync.isActive() || sync.roomCode !== code) {
            this._connectToRoom(code, true);
          } else {
            this._joinWithName(name);
          }
        };
        if (joinBtn) joinBtn.addEventListener("click", submitJoin);
        if (nameInp) {
          nameInp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") submitJoin();
          });
        }
        return;
      }

      const pub = this.publicState || { phase: "setup", roundNumber: 0, playersRoster: [] };
      const sync = window.SeenJeemBaraSalfaSync;
      const myUid = sync ? sync.getUid() : "";
      const role = this.privateRole && Number(this.privateRole.roundNumber) === Number(pub.roundNumber) ? this.privateRole : null;
      const playersList = Object.values(this.playersMap || {}).filter((p) => p && p.name);

      // 2) شاشة اللوبي
      if (pub.phase === "setup") {
        const body = `
          <section class="pl-card bp-center-card">
            <div class="bp-big-icon">🕵️</div>
            <h2 class="pl-section-title">أهلاً يا ${escapeHtml(this.playerName)}!</h2>
            <p class="pl-sub-note">أنت متصل الآن بالغرفة <strong>${escapeHtml(this.roomCode)}</strong> — بانتظار بدء الجولة من جهاز المقدّم...</p>
            <div class="bs-status-chips">
              ${playersList.map((p) => `<span class="bs-status-chip is-done">📱 ${escapeHtml(p.name)}</span>`).join("")}
            </div>
          </section>
        `;
        this.root.innerHTML = this._wrapChrome(body);
        return;
      }

      // 3) شاشة كشف الدور السري
      if (pub.phase === "role_reveal") {
        const isReady = this.readySentRound === pub.roundNumber;
        const body = `
          <section class="pl-card bp-center-card">
            <div class="final-eyebrow">🔐 دورك السري — الجولة #${pub.roundNumber}</div>
            <div id="bp-secret-box" class="bs-secret-reveal-box${this.roleVisible ? " is-revealed" : ""}${role && role.isOutsider ? " is-outsider" : " is-insider"}">
              <div class="bs-secret-curtain">🔒 اضغط الزر بالأسفل لإظهار دورك سراً</div>
              <div class="bs-secret-content">${this._renderRoleCardContent(role)}</div>
            </div>
            <button type="button" id="bp-btn-toggle-role" class="btn btn-amber pl-touch-btn pl-full-btn">
              ${this.roleVisible ? "🙈 إخفاء دوري السري" : "👁️ إظهار دوري السري"}
            </button>
            <button type="button" id="bp-btn-ready" class="btn btn-primary pl-touch-btn pl-full-btn" ${isReady ? "disabled" : ""}>
              ${isReady ? "✅ تم تأكيد الجاهزية — بانتظار البقية" : "✅ فهمت دوري — جاهز"}
            </button>
          </section>
        `;
        this.root.innerHTML = this._wrapChrome(body);
        document.getElementById("bp-btn-toggle-role")?.addEventListener("click", () => {
          this.roleVisible = !this.roleVisible;
          this._render();
        });
        document.getElementById("bp-btn-ready")?.addEventListener("click", () => this._sendReady());
        return;
      }

      // 4) الأسئلة والنقاش مع تذكير سري بضغط مطوّل
      if (pub.phase === "questions" || pub.phase === "discussion") {
        const pair = pub.currentPair;
        const timerTxt = pub.phase === "discussion" && pub.timer ? this._formatLiveTimer(pub.timer) : "";
        const body = `
          <section class="pl-card bp-center-card">
            <div class="final-eyebrow">${escapeHtml(pub.categoryIcon || "🕵️")} الفئة: ${escapeHtml(pub.categoryName || "")}</div>
            ${
              pub.phase === "questions" && pair
                ? `
                  <h2 class="pl-section-title">🎤 جولة الأسئلة (${(pub.pairIndex || 0) + 1} / ${pub.totalPairs || 1})</h2>
                  <div class="bp-pair-box">
                    <strong>${escapeHtml(pair.askerName)}</strong>
                    <span>⬅️ يسأل ⬅️</span>
                    <strong>${escapeHtml(pair.targetName)}</strong>
                  </div>
                `
                : `
                  <h2 class="pl-section-title">💬 وقت النقاش والاتهام</h2>
                  ${timerTxt ? `<div id="bp-live-timer" class="bp-live-timer">${escapeHtml(timerTxt)}</div>` : ""}
                  <p class="pl-sub-note">ناقشوا إجابات الجميع واكتشفوا اللي برا السالفة!</p>
                `
            }
            <div id="bp-reminder-box" class="bs-secret-reveal-box bp-mini-secret${this.reminderOpen ? " is-revealed" : ""}${role && role.isOutsider ? " is-outsider" : " is-insider"}">
              <div class="bs-secret-curtain">🔒 اضغط مطوّلاً على زر التذكير بالأسفل</div>
              <div class="bs-secret-content">${this._renderRoleCardContent(role)}</div>
            </div>
            <button type="button" id="bp-btn-hold-reminder" class="btn btn-secondary pl-touch-btn pl-full-btn">
              👁️ تذكير بدوري السري (ضغط مطوّل)
            </button>
          </section>
        `;
        this.root.innerHTML = this._wrapChrome(body);
        const holdBtn = document.getElementById("bp-btn-hold-reminder");
        const box = document.getElementById("bp-reminder-box");
        if (holdBtn && box) {
          const onStart = (e) => {
            if (e.cancelable) e.preventDefault();
            this.reminderOpen = true;
            box.classList.add("is-revealed");
          };
          const onEnd = () => {
            this.reminderOpen = false;
            box.classList.remove("is-revealed");
          };
          holdBtn.addEventListener("pointerdown", onStart);
          holdBtn.addEventListener("pointerup", onEnd);
          holdBtn.addEventListener("pointerleave", onEnd);
          holdBtn.addEventListener("pointercancel", onEnd);
          holdBtn.addEventListener("touchstart", onStart, { passive: false });
          holdBtn.addEventListener("touchend", onEnd);
        }
        return;
      }

      // 5) التصويت السري
      if (pub.phase === "voting") {
        const alreadyVoted = this.votedRound === pub.roundNumber;
        const candidates = (pub.playersRoster || []).filter((p) => p.id !== myUid);
        const body = alreadyVoted
          ? `
            <section class="pl-card bp-center-card">
              <div class="bp-big-icon">✅</div>
              <h2 class="pl-section-title">تم تسجيل صوتك سراً!</h2>
              <p class="pl-sub-note">اخترت: <strong>${escapeHtml(this.votedTargetName)}</strong> — بانتظار انتهاء تصويت بقية اللاعبين...</p>
            </section>
          `
          : `
            <section class="pl-card">
              <div class="final-eyebrow">🗳️ التصويت السري</div>
              <h2 class="pl-section-title">مين اللي «برا السالفة» برأيك؟</h2>
              <div class="bp-vote-list">
                ${candidates
                  .map(
                    (c) => `
                  <button type="button" class="btn btn-secondary pl-touch-btn pl-full-btn" data-bp-vote="${escapeHtml(c.id)}" data-bp-name="${escapeHtml(c.name)}">
                    🕵️ ${escapeHtml(c.name)}
                  </button>
                `
                  )
                  .join("")}
              </div>
            </section>
          `;
        this.root.innerHTML = this._wrapChrome(body);
        this.root.querySelectorAll("[data-bp-vote]").forEach((btn) => {
          btn.addEventListener("click", () => this._sendVote(btn.dataset.bpVote, btn.dataset.bpName));
        });
        return;
      }

      // 6) كشف التصويت واللي برا السالفة
      if (pub.phase === "outsider_reveal") {
        const rd = pub.revealData || {};
        const body = `
          <section class="pl-card bp-center-card">
            <div class="final-eyebrow">🥁 كشف الحقيقة</div>
            <h2 class="pl-section-title">اللي «برا السالفة»:</h2>
            <div class="bp-reveal-names">${escapeHtml((rd.outsiderNames || []).join(" و ") || "—")}</div>
            <p class="pl-sub-note">استعدوا للفرصة الأخيرة لتخمين الكلمة السرية!</p>
          </section>
        `;
        this.root.innerHTML = this._wrapChrome(body);
        return;
      }

      // 7) تخمين الكلمة السرية (8 خيارات للي برا السالفة فقط!)
      if (pub.phase === "outsider_guess") {
        const rd = pub.revealData || {};
        const amOutsider = Boolean(role && role.isOutsider) || (Array.isArray(rd.outsiderIds) && rd.outsiderIds.includes(myUid));
        const alreadyGuessed = this.guessedRound === pub.roundNumber;
        let body = "";
        if (!amOutsider) {
          body = `
            <section class="pl-card bp-center-card">
              <div class="bp-big-icon">⏳</div>
              <h2 class="pl-section-title">بانتظار تخمين ${escapeHtml((rd.outsiderNames || []).join(" و "))}...</h2>
              <p class="pl-sub-note">هل سينجح في كسب +100 نقطة من الخيارات الـ 8؟</p>
            </section>
          `;
        } else if (alreadyGuessed) {
          body = `
            <section class="pl-card bp-center-card">
              <div class="bp-big-icon">🎯</div>
              <h2 class="pl-section-title">تم إرسال تخمينك!</h2>
              <p class="pl-sub-note">اخترت: <strong>${escapeHtml(this.guessedWord)}</strong> — تابع النتيجة على الشاشة!</p>
            </section>
          `;
        } else {
          const choices = Array.isArray(pub.guessChoices) ? pub.guessChoices : [];
          body = `
            <section class="pl-card">
              <div class="final-eyebrow">🎯 فرصتك الأخيرة (+100 نقطة)</div>
              <h2 class="pl-section-title">شو كانت الكلمة السرية؟</h2>
              <div class="bp-choices-grid">
                ${choices
                  .map(
                    (w) => `
                  <button type="button" class="btn btn-amber pl-touch-btn" data-bp-guess="${escapeHtml(w)}">
                    ${escapeHtml(w)}
                  </button>
                `
                  )
                  .join("")}
              </div>
            </section>
          `;
        }
        this.root.innerHTML = this._wrapChrome(body);
        this.root.querySelectorAll("[data-bp-guess]").forEach((btn) => {
          btn.addEventListener("click", () => this._sendGuess(btn.dataset.bpGuess));
        });
        return;
      }

      // 8) نتائج الجولة والترتيب التراكمي
      const rd = pub.revealData || {};
      const myRound = (rd.roundScores || []).find((s) => s.id === myUid);
      const standings = rd.standings || [];
      const body = `
        <section class="pl-card bp-center-card">
          <div class="final-eyebrow">🏆 نتائج الجولة #${pub.roundNumber}</div>
          <div class="bs-secret-reveal-final">
            <span>الكلمة السرية:</span>
            <strong>${escapeHtml(rd.secretWord || "—")}</strong>
          </div>
          ${
            myRound
              ? `<div class="bp-my-delta${myRound.delta > 0 ? " is-win" : ""}">
                  نقاطك هذه الجولة: <strong>${myRound.delta > 0 ? `+${myRound.delta}` : "0"}</strong>
                  <div class="pl-sub-note">${escapeHtml(myRound.reason || "")}</div>
                </div>`
              : ""
          }
          <div class="bs-res-list" style="width:100%">
            ${standings
              .map(
                (p, idx) => `
              <div class="bs-res-row${p.id === myUid ? " is-leader" : ""}">
                <strong>${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`} ${escapeHtml(p.name)}</strong>
                <strong>${p.score} نقطة</strong>
              </div>
            `
              )
              .join("")}
          </div>
        </section>
      `;
      this.root.innerHTML = this._wrapChrome(body);
    }
  }

  window.SeenJeemBaraPlayerView = new BaraPlayerMobileController();
})();
