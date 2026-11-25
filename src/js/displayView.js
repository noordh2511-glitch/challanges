/**
 * شاشة العرض التلفزيوني للجمهور (TV Audience Display View - ?mode=display)
 * - واجهة عرض نظيفة ومكبّرة للقراءة من مسافة 3-4 أمتار بدون أي أزرار تحكم إدارية
 * - تستقبل اللقطات المنقّاة من الإجابات عبر SeenJeemLiveSync (BroadcastChannel) فقط
 * - تدعم جميع أنواع الأسئلة (normal, blur, zoom, invert, silhouette, memory, spot-diff, multi-image, mgk-*)
 * - تحافظ على حركات الكشف السلسة لصور blur (650ms) و zoom (750ms) دون إعادة إنشاء عنصر الصورة
 * - تعرض شاشة الفائز وإحصائيات المباراة وتُشغّل الصوت وCanvas Confetti بتزامن تام مع المقدّم
 */
(function () {
  "use strict";

  const MASKED_TYPES = new Set(["blur", "zoom", "invert", "silhouette"]);

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(totalSeconds) {
    const clamped = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const mins = Math.floor(clamped / 60);
    const secs = clamped % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function normalizeImgUrl(raw) {
    if (window.SeenJeemImagePreloader && typeof window.SeenJeemImagePreloader.normalizeUrl === "function") {
      return window.SeenJeemImagePreloader.normalizeUrl(raw);
    }
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (/^(https?:|data:|blob:|file:)/i.test(trimmed)) return trimmed;
    return trimmed.replace(/^(\.\/|\/)+/, "");
  }

  class TVDisplayController {
    constructor() {
      /** @type {HTMLElement | null} */
      this.root = null;
      this.snapshot = null;
      this.lastRenderedScores = [0, 0];
      this.lastQuestionRenderKey = "";
      this.lastBoardSignature = "";
      this.fsHideTimer = null;
      this.audioUnlockVisible = false;
      this.disconnectedByHost = false;
      this.dom = {};
    }

    init() {
      this.root = document.getElementById("tv-display-root");
      if (!this.root) return;

      document.title = "سين جيم | شاشة العرض التلفزيوني (TV)";
      document.body.classList.add("display-tv-mode");

      // إخفاء شاشات المقدّم والنوافذ الإدارية تماماً في وضع العرض
      ["setup-screen", "game-screen", "question-modal", "winner-modal", "bank-manager-modal", "confirm-modal", "resume-match-modal", "image-lightbox"].forEach(
        (id) => {
          const el = document.getElementById(id);
          if (el) {
            el.hidden = true;
            el.classList.remove("active", "open");
          }
        }
      );

      this.root.hidden = false;
      this.root.setAttribute("aria-hidden", "false");
      this._buildShellDOM();
      this._bindControls();

      // تفعيل PWA وWake Lock تلقائياً طوال عرض شاشة التلفزيون
      if (window.SeenJeemPWA && typeof window.SeenJeemPWA.init === "function") {
        window.SeenJeemPWA.init();
      }
      if (window.SeenJeemWakeLock && typeof window.SeenJeemWakeLock.syncForContext === "function") {
        window.SeenJeemWakeLock.syncForContext(true);
      }

      const liveSync = window.SeenJeemLiveSync;
      if (liveSync && liveSync.isSupported()) {
        liveSync.connect();

        // استعادة اللقطة المخزنة في sessionStorage فوراً عند التحديث لمنع أي وميض
        const cached = liveSync.getCachedDisplaySnapshot();
        if (cached) {
          this.applySnapshot(cached);
        } else {
          this._renderStandby(null);
        }

        liveSync.onMessage((msg) => this._handleChannelMessage(msg));
        liveSync.requestSyncFromHost();

        window.addEventListener("beforeunload", () => {
          if (window.SeenJeemWakeLock) window.SeenJeemWakeLock.syncForContext(false);
          liveSync.notifyDisplayClosing();
        });
      } else {
        this._renderStandby({
          message: "المتصفح الحالي لا يدعم BroadcastChannel للمزامنة بين الشاشتين."
        });
      }

      this._checkAudioUnlockPrompt();
    }

    _buildShellDOM() {
      this.root.innerHTML = `
        <canvas id="tv-confetti-canvas" class="confetti-canvas tv-confetti-canvas" aria-hidden="true"></canvas>

        <!-- شاشة الترحيب / الانتظار -->
        <section id="tv-screen-standby" class="tv-screen tv-standby-screen">
          <div class="tv-standby-card">
            <div class="tv-live-badge">
              <span class="tv-live-dot"></span>
              <span id="tv-standby-conn-label">شاشة العرض التلفزيوني جاهزة</span>
            </div>
            <h1 class="tv-brand-title"><span class="brand-highlight">سين</span> جيم</h1>
            <p id="tv-standby-subtitle" class="tv-standby-subtitle">
              في انتظار بدء الجولة من جهاز المقدّم...
            </p>
            <div id="tv-standby-teams" class="tv-standby-teams" hidden></div>
            <div id="tv-standby-meta" class="tv-standby-meta" hidden></div>
          </div>
        </section>

        <!-- شاشة لوحة اللعب التلفزيونية -->
        <section id="tv-screen-board" class="tv-screen tv-board-screen" hidden>
          <header class="tv-scoreboard-bar">
            <div id="tv-team-card-0" class="tv-team-card team-1-card">
              <div class="tv-team-top">
                <div class="tv-team-id">
                  <span class="team-badge-dot team-1-dot"></span>
                  <h2 id="tv-team-name-0" class="tv-team-name">الفريق الأول</h2>
                </div>
                <span class="tv-turn-pill">الدور الآن</span>
              </div>
              <div class="tv-team-bottom">
                <div id="tv-team-score-0" class="tv-team-score">0</div>
                <div id="tv-team-powerups-0" class="tv-powerups-row"></div>
              </div>
            </div>

            <div class="tv-scoreboard-center">
              <div class="tv-center-brand"><span>سين</span> جيم</div>
              <div id="tv-remaining-pill" class="tv-remaining-pill">متبقي 36 / 36</div>
            </div>

            <div id="tv-team-card-1" class="tv-team-card team-2-card">
              <div class="tv-team-top">
                <div class="tv-team-id">
                  <span class="team-badge-dot team-2-dot"></span>
                  <h2 id="tv-team-name-1" class="tv-team-name">الفريق الثاني</h2>
                </div>
                <span class="tv-turn-pill">الدور الآن</span>
              </div>
              <div class="tv-team-bottom">
                <div id="tv-team-score-1" class="tv-team-score">0</div>
                <div id="tv-team-powerups-1" class="tv-powerups-row"></div>
              </div>
            </div>
          </header>

          <div class="tv-board-wrap">
            <div id="tv-board-grid" class="tv-board-grid"></div>
          </div>
        </section>

        <!-- شاشة عرض السؤال الحي للجمهور -->
        <section id="tv-screen-question" class="tv-screen tv-question-screen" hidden>
          <div class="tv-question-shell">
            <header class="tv-q-header">
              <div class="tv-q-badges">
                <span class="tv-q-cat-pill">
                  <span id="tv-q-cat-icon">🎯</span>
                  <span id="tv-q-cat-name">الفئة</span>
                </span>
                <span id="tv-q-points-pill" class="tv-q-points-pill pts-200">200 نقطة</span>
                <span id="tv-q-type-pill" class="tv-q-type-pill" hidden></span>
              </div>
              <div id="tv-q-turn-badge" class="tv-q-turn-badge team-1-turn">دور: الفريق الأول</div>
            </header>

            <div id="tv-q-steal-banner" class="tv-q-steal-banner" hidden>
              <span>🔥</span>
              <span id="tv-q-steal-text">فرصة سرقة!</span>
              <span id="tv-q-steal-pts" class="tv-q-steal-pts">+100 نقطة</span>
            </div>

            <div id="tv-q-timer-bar-wrap" class="tv-q-timer-wrap">
              <div class="tv-q-timer-row">
                <div id="tv-q-timer-display" class="tv-q-timer-display">01:00</div>
                <span id="tv-q-timer-label" class="tv-q-timer-label">الوقت الأساسي</span>
              </div>
              <div class="tv-q-timer-track">
                <div id="tv-q-timer-progress" class="tv-q-timer-progress"></div>
              </div>
            </div>

            <div id="tv-q-banners" class="tv-q-banners" hidden></div>

            <main class="tv-q-stage">
              <!-- واجهة «من غير كلام» للجمهور (التصنيف + عدد الكلمات + المؤقت الضخم فقط!) -->
              <div id="tv-charades-stage" class="tv-charades-stage" hidden>
                <div class="tv-charades-eyebrow" id="tv-charades-eyebrow">🎭 من غير كلام</div>
                <h2 class="tv-charades-topic" id="tv-charades-topic">التصنيف الفرعي</h2>
                <div class="tv-charades-words-pill" id="tv-charades-words">🔢 عدد الكلمات: كلمتان</div>
                <div class="tv-charades-giant-timer-wrap" id="tv-charades-timer-wrap">
                  <div id="tv-charades-timer-num" class="tv-charades-timer-num">01:00</div>
                  <div id="tv-charades-timer-status" class="tv-charades-timer-status">جاهز للتمثيل</div>
                  <div class="tv-charades-track">
                    <div id="tv-charades-progress" class="tv-charades-progress"></div>
                  </div>
                </div>
              </div>

              <!-- واجهة الذاكرة البصرية للجمهور -->
              <div id="tv-memory-ready" class="tv-memory-ready" hidden>
                <div class="tv-memory-icon">🧠</div>
                <h2 class="tv-memory-title">استعد لاختبار ذاكرة الصورة!</h2>
                <p class="tv-memory-sub">ركّز جيداً على الشاشة — ستظهر الصورة لثوانٍ معدودة ثم تختفي.</p>
              </div>

              <div id="tv-memory-bar" class="tv-memory-bar" hidden>
                <div class="tv-memory-bar-top">
                  <span class="memory-badge">🧠 ركّز في الصورة!</span>
                  <strong id="tv-memory-secs" class="tv-memory-secs">10</strong>
                  <span>ثوانٍ متبقية</span>
                </div>
                <div class="memory-progress-track">
                  <div id="tv-memory-progress" class="memory-progress-bar"></div>
                </div>
              </div>

              <!-- نص السؤال القياسي -->
              <p id="tv-q-text" class="tv-q-text"></p>

              <!-- الصورة المفردة (يدعم blur / zoom / invert / silhouette / memory / normal) -->
              <div id="tv-q-single-media" class="tv-media-wrap" hidden>
                <div id="tv-visual-stage" class="visual-image-stage tv-visual-stage">
                  <img id="tv-q-img" class="tv-media-img" alt="صورة السؤال" draggable="false" />
                </div>
              </div>

              <!-- عدد الفروقات + الصور المتعددة -->
              <div id="tv-spot-diff-wrap" class="spot-diff-badge-wrap" hidden>
                <span id="tv-spot-diff-badge" class="spot-diff-count-badge"></span>
              </div>
              <div id="tv-multi-images" class="multi-images-wrap tv-multi-images" hidden></div>

              <!-- التلميح (يظهر فقط بعد كشفه من المقدّم) -->
              <div id="tv-q-hint" class="tv-q-hint" hidden></div>

              <!-- بطاقة الإجابة (تظهر فقط بعد كشفها من المقدّم) -->
              <div id="tv-q-answer-card" class="tv-q-answer-card" hidden>
                <div class="tv-answer-label">✅ الإجابة الصحيحة</div>
                <div id="tv-q-answer-text" class="tv-answer-text"></div>
                <div id="tv-q-answer-exp" class="tv-answer-exp" hidden></div>
                <div id="tv-q-answer-img-wrap" class="tv-answer-img-wrap" hidden>
                  <img id="tv-q-answer-img" class="tv-answer-img" alt="صورة الإجابة" />
                </div>
              </div>
            </main>
          </div>
        </section>

        <!-- شاشة الفائز وإحصائيات نهاية المباراة للجمهور -->
        <section id="tv-screen-winner" class="tv-screen tv-winner-screen" hidden>
          <div id="tv-winner-card" class="tv-winner-card">
            <div id="tv-winner-trophy" class="tv-winner-trophy">🏆</div>
            <div id="tv-winner-eyebrow" class="tv-winner-eyebrow">مبروك الفوز!</div>
            <h1 id="tv-winner-title" class="tv-winner-title">الفائز: الفريق الأول</h1>

            <div id="tv-winner-scores" class="tv-winner-scores"></div>
            <div id="tv-winner-analytics" class="tv-winner-analytics"></div>
          </div>
        </section>

        <!-- زر تفعيل الصوت عند الحاجة + زر ملء الشاشة العائم (يختفي تلقائياً عند السكون) -->
        <div id="tv-floating-controls" class="tv-floating-controls">
          <button type="button" id="tv-audio-unlock-btn" class="tv-float-btn tv-audio-unlock-btn" hidden>
            🔊 اضغط لتفعيل صوت التلفزيون
          </button>
          <button type="button" id="tv-fullscreen-btn" class="tv-float-btn" title="ملء الشاشة (Fullscreen)" aria-label="ملء الشاشة">
            ⛶ ملء الشاشة
          </button>
        </div>
      `;

      const $ = (id) => document.getElementById(id);
      this.dom = {
        confettiCanvas: $("tv-confetti-canvas"),
        standbyScreen: $("tv-screen-standby"),
        standbyConnLabel: $("tv-standby-conn-label"),
        standbySubtitle: $("tv-standby-subtitle"),
        standbyTeams: $("tv-standby-teams"),
        standbyMeta: $("tv-standby-meta"),

        boardScreen: $("tv-screen-board"),
        teamCard0: $("tv-team-card-0"),
        teamCard1: $("tv-team-card-1"),
        teamName0: $("tv-team-name-0"),
        teamName1: $("tv-team-name-1"),
        teamScore0: $("tv-team-score-0"),
        teamScore1: $("tv-team-score-1"),
        teamPowerups0: $("tv-team-powerups-0"),
        teamPowerups1: $("tv-team-powerups-1"),
        remainingPill: $("tv-remaining-pill"),
        boardGrid: $("tv-board-grid"),

        questionScreen: $("tv-screen-question"),
        qCatIcon: $("tv-q-cat-icon"),
        qCatName: $("tv-q-cat-name"),
        qPointsPill: $("tv-q-points-pill"),
        qTypePill: $("tv-q-type-pill"),
        qTurnBadge: $("tv-q-turn-badge"),
        qStealBanner: $("tv-q-steal-banner"),
        qStealText: $("tv-q-steal-text"),
        qStealPts: $("tv-q-steal-pts"),
        qTimerWrap: $("tv-q-timer-bar-wrap"),
        qTimerDisplay: $("tv-q-timer-display"),
        qTimerLabel: $("tv-q-timer-label"),
        qTimerProgress: $("tv-q-timer-progress"),
        qBanners: $("tv-q-banners"),

        charadesStage: $("tv-charades-stage"),
        charadesEyebrow: $("tv-charades-eyebrow"),
        charadesTopic: $("tv-charades-topic"),
        charadesWords: $("tv-charades-words"),
        charadesTimerWrap: $("tv-charades-timer-wrap"),
        charadesTimerNum: $("tv-charades-timer-num"),
        charadesTimerStatus: $("tv-charades-timer-status"),
        charadesProgress: $("tv-charades-progress"),

        memoryReady: $("tv-memory-ready"),
        memoryBar: $("tv-memory-bar"),
        memorySecs: $("tv-memory-secs"),
        memoryProgress: $("tv-memory-progress"),

        qText: $("tv-q-text"),
        qSingleMedia: $("tv-q-single-media"),
        visualStage: $("tv-visual-stage"),
        qImg: $("tv-q-img"),
        spotDiffWrap: $("tv-spot-diff-wrap"),
        spotDiffBadge: $("tv-spot-diff-badge"),
        multiImages: $("tv-multi-images"),
        qHint: $("tv-q-hint"),

        qAnswerCard: $("tv-q-answer-card"),
        qAnswerText: $("tv-q-answer-text"),
        qAnswerExp: $("tv-q-answer-exp"),
        qAnswerImgWrap: $("tv-q-answer-img-wrap"),
        qAnswerImg: $("tv-q-answer-img"),

        winnerScreen: $("tv-screen-winner"),
        winnerCard: $("tv-winner-card"),
        winnerTrophy: $("tv-winner-trophy"),
        winnerEyebrow: $("tv-winner-eyebrow"),
        winnerTitle: $("tv-winner-title"),
        winnerScores: $("tv-winner-scores"),
        winnerAnalytics: $("tv-winner-analytics"),

        floatingControls: $("tv-floating-controls"),
        audioUnlockBtn: $("tv-audio-unlock-btn"),
        fullscreenBtn: $("tv-fullscreen-btn")
      };
    }

    _bindControls() {
      const revealFloating = () => {
        if (!this.dom.floatingControls) return;
        this.dom.floatingControls.classList.remove("is-idle");
        clearTimeout(this.fsHideTimer);
        this.fsHideTimer = setTimeout(() => {
          if (this.dom.floatingControls && !this.audioUnlockVisible) {
            this.dom.floatingControls.classList.add("is-idle");
          }
        }, 2800);
      };

      document.addEventListener("mousemove", revealFloating, { passive: true });
      document.addEventListener("pointerdown", () => {
        revealFloating();
        this._unlockAudioIfNeeded();
      });
      revealFloating();

      if (this.dom.fullscreenBtn) {
        this.dom.fullscreenBtn.addEventListener("click", () => {
          this._unlockAudioIfNeeded();
          this._toggleFullscreen();
        });
      }

      if (this.dom.audioUnlockBtn) {
        this.dom.audioUnlockBtn.addEventListener("click", () => {
          this._unlockAudioIfNeeded(true);
        });
      }

      const syncFsLabel = () => {
        if (!this.dom.fullscreenBtn) return;
        const isFull = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
        this.dom.fullscreenBtn.textContent = isFull ? "🗗 خروج من ملء الشاشة" : "⛶ ملء الشاشة";
      };
      document.addEventListener("fullscreenchange", syncFsLabel);
      document.addEventListener("webkitfullscreenchange", syncFsLabel);
    }

    _checkAudioUnlockPrompt() {
      if (!window.SeenJeemAudio || window.SeenJeemAudio.isMuted()) return;
      const ctx = window.SeenJeemAudio.ctx;
      if (ctx && ctx.state === "suspended" && this.dom.audioUnlockBtn) {
        this.audioUnlockVisible = true;
        this.dom.audioUnlockBtn.hidden = false;
      }
    }

    _unlockAudioIfNeeded(playPing = false) {
      if (!window.SeenJeemAudio) return;
      const ctx = window.SeenJeemAudio.ensureContext();
      if (ctx && ctx.state === "running") {
        this.audioUnlockVisible = false;
        if (this.dom.audioUnlockBtn) this.dom.audioUnlockBtn.hidden = true;
        if (playPing) window.SeenJeemAudio.playTick(false);
      } else if (ctx && ctx.state === "suspended") {
        const res = ctx.resume();
        if (res && typeof res.then === "function") {
          res.then(() => {
            this.audioUnlockVisible = false;
            if (this.dom.audioUnlockBtn) this.dom.audioUnlockBtn.hidden = true;
            if (playPing) window.SeenJeemAudio.playTick(false);
          }).catch(() => {});
        }
      }
    }

    _toggleFullscreen() {
      try {
        const isFull = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
        if (isFull) {
          const exitFn = document.exitFullscreen || document.webkitExitFullscreen;
          if (exitFn) exitFn.call(document);
        } else {
          const el = document.documentElement;
          const reqFn = el.requestFullscreen || el.webkitRequestFullscreen;
          if (reqFn) reqFn.call(el);
        }
      } catch (_err) {
        // تجاهل
      }
    }

    _handleChannelMessage(msg) {
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "STATE_SYNC" && msg.payload) {
        this.disconnectedByHost = false;
        this.applySnapshot(msg.payload);
      } else if (msg.type === "PLAY_SFX" && msg.payload) {
        const { method, args } = msg.payload;
        if (window.SeenJeemAudio && typeof window.SeenJeemAudio[method] === "function") {
          window.SeenJeemAudio[method](...(Array.isArray(args) ? args : []));
          this._checkAudioUnlockPrompt();
        }
      } else if (msg.type === "TRIGGER_CONFETTI" && msg.payload) {
        if (window.SeenJeemConfetti && this.dom.confettiCanvas) {
          const theme = msg.payload.theme || "default";
          if (msg.payload.kind === "steal") {
            window.SeenJeemConfetti.startLightBurst(this.dom.confettiCanvas, theme);
          } else {
            window.SeenJeemConfetti.start(this.dom.confettiCanvas, theme);
          }
        }
      } else if (msg.type === "CLOSE_DISPLAY") {
        this.disconnectedByHost = true;
        if (window.SeenJeemConfetti) window.SeenJeemConfetti.stop();
        if (window.SeenJeemLiveSync) window.SeenJeemLiveSync.clearCachedDisplaySnapshot();
        this._renderStandby({
          message: "تم فصل شاشة العرض من جهاز المقدّم — يمكنك إغلاق هذه النافذة أو إعادة الاتصال من شاشة المقدّم."
        });
        try {
          window.close();
        } catch (_err) {
          // تجاهل في حال حظر الإغلاق
        }
      }
    }

    _showOnlyScreen(screenName) {
      this.dom.standbyScreen.hidden = screenName !== "setup";
      this.dom.boardScreen.hidden = screenName !== "board";
      this.dom.questionScreen.hidden = screenName !== "question";
      this.dom.winnerScreen.hidden = screenName !== "winner";
    }

    applySnapshot(snap) {
      if (!snap || typeof snap !== "object") return;
      this.snapshot = snap;

      if (snap.screen !== "winner" && window.SeenJeemConfetti && snap.screen !== "board") {
        // إيقاف احتفالات الفائز عند العودة للوحة أو الإعداد
      }

      if (snap.screen === "setup") {
        this.lastQuestionRenderKey = "";
        this._renderStandby(snap.setupInfo);
      } else if (snap.screen === "board") {
        this.lastQuestionRenderKey = "";
        this._renderBoard(snap);
      } else if (snap.screen === "question" && snap.questionView) {
        this._renderQuestion(snap);
      } else if (snap.screen === "winner" && snap.winnerView) {
        this.lastQuestionRenderKey = "";
        this._renderWinner(snap);
      } else {
        this._renderStandby(snap.setupInfo);
      }
    }

    _renderStandby(info) {
      this._showOnlyScreen("setup");
      if (this.dom.standbyConnLabel) {
        this.dom.standbyConnLabel.textContent = this.disconnectedByHost
          ? "شاشة العرض غير متصلة"
          : "🟢 متصلة بجهاز المقدّم — شاشة الجمهور";
      }
      if (info && info.message) {
        this.dom.standbySubtitle.textContent = info.message;
        this.dom.standbyTeams.hidden = true;
        this.dom.standbyMeta.hidden = true;
        return;
      }

      this.dom.standbySubtitle.textContent =
        "يتم الآن إعداد الجولة على جهاز المقدّم — استعدوا للتحدي!";

      if (info && info.team1Name && info.team2Name) {
        this.dom.standbyTeams.hidden = false;
        this.dom.standbyTeams.innerHTML = `
          <div class="tv-standby-team team-1">${escapeHtml(info.team1Name)}</div>
          <div class="tv-standby-vs">VS</div>
          <div class="tv-standby-team team-2">${escapeHtml(info.team2Name)}</div>
        `;
      } else {
        this.dom.standbyTeams.hidden = true;
      }

      if (info && typeof info.selectedCount === "number") {
        this.dom.standbyMeta.hidden = false;
        this.dom.standbyMeta.textContent = `الفئات المختارة: ${info.selectedCount} / 6`;
      } else {
        this.dom.standbyMeta.hidden = true;
      }
    }

    _renderBoard(snap) {
      this._showOnlyScreen("board");

      const teams = Array.isArray(snap.teams) ? snap.teams : [];
      const t0 = teams[0] || { name: "الفريق الأول", score: 0, powerups: { doubleLeft: 0, swapLeft: 0 } };
      const t1 = teams[1] || { name: "الفريق الثاني", score: 0, powerups: { doubleLeft: 0, swapLeft: 0 } };

      this.dom.teamName0.textContent = t0.name;
      this.dom.teamName1.textContent = t1.name;
      this.dom.teamScore0.textContent = String(t0.score);
      this.dom.teamScore1.textContent = String(t1.score);

      if (t0.score !== this.lastRenderedScores[0]) {
        this.dom.teamScore0.classList.remove("score-pop");
        void this.dom.teamScore0.offsetWidth;
        this.dom.teamScore0.classList.add("score-pop");
        this.lastRenderedScores[0] = t0.score;
      }
      if (t1.score !== this.lastRenderedScores[1]) {
        this.dom.teamScore1.classList.remove("score-pop");
        void this.dom.teamScore1.offsetWidth;
        this.dom.teamScore1.classList.add("score-pop");
        this.lastRenderedScores[1] = t1.score;
      }

      this.dom.teamCard0.classList.toggle("active-turn", snap.activeTurn === 0);
      this.dom.teamCard1.classList.toggle("active-turn", snap.activeTurn === 1);

      this._renderTVTeamPowerups(this.dom.teamPowerups0, t0, snap.activeTurn === 0, snap.doubleArmed);
      this._renderTVTeamPowerups(this.dom.teamPowerups1, t1, snap.activeTurn === 1, snap.doubleArmed);

      this.dom.remainingPill.textContent = `متبقي ${snap.remainingPlayable} / ${snap.totalSlots}`;

      const boardSig = JSON.stringify(snap.board || []);
      if (boardSig !== this.lastBoardSignature) {
        this.lastBoardSignature = boardSig;
        this.dom.boardGrid.innerHTML = "";
        (snap.board || []).forEach((bc) => {
          const card = document.createElement("article");
          card.className = "tv-board-cat-card";
          card.style.setProperty("--cat-color", bc.category.color || "#06b6d4");

          const rows = Math.max(bc.rightColumn.length, bc.leftColumn.length);
          let tilesHtml = "";
          for (let i = 0; i < rows; i++) {
            [bc.rightColumn[i], bc.leftColumn[i]].forEach((slot) => {
              if (!slot) return;
              const winCls =
                slot.played && (slot.winnerTeam === 0 || slot.winnerTeam === 1)
                  ? ` won-team-${slot.winnerTeam}`
                  : "";
              const cls = `tv-point-tile pts-${slot.points}${slot.played ? " played" : ""}${winCls}`;
              tilesHtml += `<div class="${cls}">${slot.points}</div>`;
            });
          }

          card.innerHTML = `
            <div class="tv-board-cat-header">
              <div class="tv-board-cat-icon">${escapeHtml(bc.category.icon || "🎯")}</div>
              <h3 class="tv-board-cat-title">${escapeHtml(bc.category.name)}</h3>
              <span class="tv-board-cat-progress">${bc.remainingInCat} / 6</span>
            </div>
            <div class="tv-board-tiles-grid">${tilesHtml}</div>
          `;
          this.dom.boardGrid.appendChild(card);
        });
      }
    }

    _renderTVTeamPowerups(container, team, isActive, doubleArmed) {
      const doubleLeft = Number(team.powerups && team.powerups.doubleLeft) || 0;
      const swapLeft = Number(team.powerups && team.powerups.swapLeft) || 0;
      const chips = [];

      if (isActive && doubleArmed && doubleLeft > 0) {
        chips.push(`<span class="tv-powerup-chip is-armed">⚡ مضاعفة 2x نشطة للسؤال القادم!</span>`);
      } else {
        chips.push(
          `<span class="tv-powerup-chip${doubleLeft <= 0 ? " is-depleted" : ""}">⚡ 2x (${doubleLeft})</span>`
        );
      }
      chips.push(
        `<span class="tv-powerup-chip${swapLeft <= 0 ? " is-depleted" : ""}">🔄 تبديل (${swapLeft})</span>`
      );
      container.innerHTML = chips.join("");
    }

    _renderQuestion(snap) {
      this._showOnlyScreen("question");
      const qv = snap.questionView;
      const teams = Array.isArray(snap.teams) ? snap.teams : [];
      const ownerTeam = teams[qv.activeTeamAtOpen] || { name: "الفريق الأول" };
      const stealingTeam = teams[qv.stealingTeamIdx] || teams[1] || { name: "الفريق الثاني" };

      this.dom.qCatIcon.textContent = qv.categoryIcon || "🎯";
      this.dom.qCatName.textContent = qv.categoryName || "";

      // شارة النقاط الحية
      this.dom.qPointsPill.className = "tv-q-points-pill";
      this.dom.qPointsPill.classList.add(
        qv.basePoints >= 600 ? "pts-600" : qv.basePoints >= 400 ? "pts-400" : "pts-200"
      );

      const hasDiscount = qv.hintRevealed && qv.hintPenaltyPct > 0;
      if (qv.phase === "steal-active") {
        this.dom.qPointsPill.classList.add("steal-pill");
        this.dom.qPointsPill.innerHTML = `<span>🔥 سرقة: +${qv.stealPoints} نقطة</span>`;
      } else if (qv.doubleActive && hasDiscount) {
        this.dom.qPointsPill.classList.add("doubled", "discounted");
        this.dom.qPointsPill.innerHTML = `<span class="pts-strike">${qv.basePoints}</span><span>→</span><span class="pts-strike">${qv.discountedBasePoints}</span><span>→</span><strong>${qv.effectivePoints} نقطة ⚡2x</strong>`;
      } else if (qv.doubleActive) {
        this.dom.qPointsPill.classList.add("doubled");
        this.dom.qPointsPill.innerHTML = `<span class="pts-strike">${qv.basePoints}</span><span>→</span><strong>${qv.effectivePoints} نقطة ⚡2x</strong>`;
      } else if (hasDiscount) {
        this.dom.qPointsPill.classList.add("discounted");
        this.dom.qPointsPill.innerHTML = `<span class="pts-strike">${qv.basePoints}</span><strong>${qv.effectivePoints} نقطة</strong>`;
      } else {
        this.dom.qPointsPill.textContent = `${qv.basePoints} نقطة`;
      }

      // شارة نوع السؤال
      const visualLabels = {
        blur: "🌫️ صورة مغبّشة",
        zoom: "🔎 صورة مُقرّبة",
        invert: "🎨 ألوان معكوسة",
        silhouette: "👤 تحدي الظل",
        memory: "🧠 اختبار الذاكرة",
        "spot-diff": "👀 أوجد الفروقات",
        "multi-image": "🔗 اربط الصور"
      };
      if (qv.isCharades) {
        this.dom.qTypePill.textContent = "🎭 من غير كلام";
        this.dom.qTypePill.hidden = false;
      } else if (visualLabels[qv.visualType]) {
        this.dom.qTypePill.textContent = visualLabels[qv.visualType];
        this.dom.qTypePill.hidden = false;
      } else {
        this.dom.qTypePill.hidden = true;
      }

      // شارة الدور وشريط السرقة
      this.dom.qTurnBadge.className = "tv-q-turn-badge";
      if (qv.phase === "steal-active") {
        this.dom.qTurnBadge.classList.add(qv.stealingTeamIdx === 0 ? "steal-turn-0" : "steal-turn-1");
        this.dom.qTurnBadge.textContent = `🔥 سرقة: ${stealingTeam.name}`;
        this.dom.qStealBanner.hidden = false;
        this.dom.qStealBanner.className = `tv-q-steal-banner ${
          qv.stealingTeamIdx === 0 ? "steal-team-0" : "steal-team-1"
        }`;
        this.dom.qStealText.textContent = `فرصة سرقة لـ ${stealingTeam.name}`;
        this.dom.qStealPts.textContent = `+${qv.stealPoints} نقطة`;
      } else {
        this.dom.qTurnBadge.classList.add(qv.activeTeamAtOpen === 0 ? "team-1-turn" : "team-2-turn");
        this.dom.qTurnBadge.textContent = `دور: ${ownerTeam.name}`;
        this.dom.qStealBanner.hidden = true;
      }

      // شرائط التنبيه (2x / تلميح)
      const banners = [];
      if (qv.doubleActive) {
        banners.push(
          qv.phase === "steal-active"
            ? `<div class="active-lifeline-banner banner-double">⚡ مضاعفة 2x كانت لصاحب الدور فقط (لا تنتقل في السرقة)</div>`
            : `<div class="active-lifeline-banner banner-double">⚡ مضاعفة 2x نشطة (${qv.effectivePoints} نقطة)</div>`
        );
      }
      if (qv.hintRevealed) {
        banners.push(
          `<div class="active-lifeline-banner banner-hint-discount">💡 تلميح مفعّل${
            qv.hintPenaltyPct > 0 ? ` (خصم ${qv.hintPenaltyPct}%)` : ""
          }</div>`
        );
      }
      if (banners.length > 0) {
        this.dom.qBanners.innerHTML = banners.join("");
        this.dom.qBanners.hidden = false;
      } else {
        this.dom.qBanners.innerHTML = "";
        this.dom.qBanners.hidden = true;
      }

      // تحديث المؤقت
      const inSteal = qv.phase === "steal-active";
      const isUnlimited = qv.timerMode === "unlimited" && !inSteal && !qv.isCharades;
      const pct = isUnlimited
        ? 100
        : qv.timerMax > 0
          ? Math.min(100, (qv.timerRemaining / qv.timerMax) * 100)
          : 0;
      this.dom.qTimerWrap.hidden = qv.isCharades && !inSteal;
      this.dom.qTimerDisplay.textContent = isUnlimited ? "∞" : formatTime(qv.timerRemaining);
      this.dom.qTimerProgress.style.width = `${pct}%`;

      const isDanger = !isUnlimited && qv.timerRemaining <= 5 && qv.timerMode !== "waiting-memory";
      const isWarning = !isUnlimited && !isDanger && !inSteal && qv.timerRemaining <= 15 && qv.timerMode !== "waiting-memory";
      this.dom.qTimerDisplay.classList.toggle("danger", isDanger);
      this.dom.qTimerDisplay.classList.toggle("warning", isWarning);
      this.dom.qTimerDisplay.classList.toggle("steal", inSteal && !isDanger);
      this.dom.qTimerProgress.classList.toggle("danger", isDanger);
      this.dom.qTimerProgress.classList.toggle("warning", isWarning);
      this.dom.qTimerProgress.classList.toggle("steal", inSteal && !isDanger);

      if (qv.timerMode === "waiting-memory") {
        this.dom.qTimerLabel.textContent = "🧠 بانتظار عرض الصورة";
      } else if (isUnlimited) {
        this.dom.qTimerLabel.textContent = "∞ بدون مؤقت";
      } else if (qv.timerRemaining === 0 || qv.timerMode === "ended") {
        this.dom.qTimerLabel.textContent = "⏰ انتهى الوقت!";
      } else if (inSteal) {
        this.dom.qTimerLabel.textContent = `🔥 مؤقت السرقة (${stealingTeam.name})`;
      } else {
        this.dom.qTimerLabel.textContent = qv.timerRunning ? "الوقت الأساسي" : "المؤقت متوقف";
      }

      // عرض المحتوى حسب النوع (بدون إعادة إنشاء عنصر الصورة لضمان سلاسة حركات blur/zoom!)
      const renderKey = `${qv.categoryId}|${qv.visualType}|${qv.isCharades}|${qv.questionText || ""}|${
        qv.questionImage || ""
      }|${(qv.images || []).join(",")}|${qv.charadesHeader ? qv.charadesHeader.topic : ""}`;
      const isNewQuestionStage = renderKey !== this.lastQuestionRenderKey;
      this.lastQuestionRenderKey = renderKey;

      if (qv.isCharades) {
        this.dom.charadesStage.hidden = false;
        this.dom.memoryReady.hidden = true;
        this.dom.memoryBar.hidden = true;
        this.dom.qText.hidden = true;
        this.dom.qSingleMedia.hidden = true;
        this.dom.spotDiffWrap.hidden = true;
        this.dom.multiImages.hidden = true;

        const hdr = qv.charadesHeader || { eyebrow: "🎭 من غير كلام", topic: qv.categoryName, wordCount: "" };
        this.dom.charadesEyebrow.textContent = hdr.eyebrow || "🎭 من غير كلام";
        this.dom.charadesTopic.textContent = hdr.topic || qv.categoryName;
        this.dom.charadesWords.textContent = `🔢 عدد الكلمات: ${hdr.wordCount || ""}`;

        this.dom.charadesTimerWrap.hidden = inSteal || qv.answerRevealed;
        this.dom.charadesTimerNum.textContent = formatTime(qv.timerRemaining);
        this.dom.charadesProgress.style.width = `${pct}%`;

        const cDanger = qv.timerRemaining > 0 && qv.timerRemaining <= 10 && qv.charadesTimerStarted;
        const cEnded = qv.timerRemaining === 0 && qv.charadesTimerStarted;
        this.dom.charadesTimerWrap.classList.toggle("is-danger", cDanger);
        this.dom.charadesTimerNum.classList.toggle("is-danger", cDanger);
        this.dom.charadesTimerNum.classList.toggle("is-ended", cEnded);
        this.dom.charadesProgress.classList.toggle("is-danger", cDanger || cEnded);

        if (cEnded) {
          this.dom.charadesTimerStatus.textContent = "🔔 انتهى وقت التمثيل!";
        } else if (cDanger) {
          this.dom.charadesTimerStatus.textContent = "🔥 آخر الثواني!";
        } else if (qv.timerRunning) {
          this.dom.charadesTimerStatus.textContent = "🎭 التمثيل جارٍ الآن...";
        } else if (qv.charadesTimerStarted) {
          this.dom.charadesTimerStatus.textContent = "⏸️ متوقف مؤقتاً";
        } else {
          this.dom.charadesTimerStatus.textContent = "استعدوا للتخمين — الممثّل يقرأ الكلمة سراً";
        }
      } else {
        this.dom.charadesStage.hidden = true;
        const isMemory = qv.visualType === "memory";

        this.dom.memoryReady.hidden = !(isMemory && qv.memoryPhase === "ready");
        this.dom.memoryBar.hidden = !(isMemory && qv.memoryPhase === "viewing");

        if (isMemory && qv.memoryPhase === "viewing") {
          this.dom.memorySecs.textContent = String(qv.memoryRemaining);
          const mPct = qv.memoryTotal > 0 ? (qv.memoryRemaining / qv.memoryTotal) * 100 : 0;
          this.dom.memoryProgress.style.width = `${mPct}%`;
        }

        if (qv.questionText) {
          this.dom.qText.textContent = qv.questionText;
          this.dom.qText.hidden = false;
        } else {
          this.dom.qText.textContent = "";
          this.dom.qText.hidden = true;
        }

        // الصور المتعددة (spot-diff / multi-image)
        if ((qv.visualType === "spot-diff" || qv.visualType === "multi-image") && Array.isArray(qv.images) && qv.images.length > 0) {
          this.dom.qSingleMedia.hidden = true;
          if (qv.visualType === "spot-diff" && qv.differencesCount) {
            this.dom.spotDiffBadge.textContent = `🔍 المطلوب إيجاد ${qv.differencesCount} فروقات`;
            this.dom.spotDiffWrap.hidden = false;
          } else {
            this.dom.spotDiffWrap.hidden = true;
          }
          if (isNewQuestionStage) {
            this._renderTVMultiImages(qv.visualType, qv.images, qv.showPlus);
          }
          this.dom.multiImages.hidden = false;
        } else {
          this.dom.spotDiffWrap.hidden = true;
          this.dom.multiImages.hidden = true;

          // الصورة المفردة مع حركات blur و zoom السلسة
          const cleanImg = normalizeImgUrl(qv.questionImage);
          if (cleanImg) {
            this.dom.qSingleMedia.hidden = false;
            if (isNewQuestionStage) {
              this.dom.visualStage.className = "visual-image-stage tv-visual-stage no-visual-transition";
              this.dom.visualStage.style.removeProperty("--blur-amount");
              this.dom.visualStage.style.removeProperty("--blur-half");
              this.dom.visualStage.style.removeProperty("--zoom-amount");
              this.dom.visualStage.style.removeProperty("--zoom-half");
              this.dom.qImg.style.transformOrigin = qv.zoomOrigin || "center";

              if (qv.visualType === "blur") {
                this.dom.visualStage.style.setProperty("--blur-amount", `${qv.blurLevel}px`);
                this.dom.visualStage.style.setProperty("--blur-half", `${qv.halfBlur}px`);
                this.dom.visualStage.classList.add("visual-mode-blur");
              } else if (qv.visualType === "zoom") {
                this.dom.visualStage.style.setProperty("--zoom-amount", String(qv.zoomLevel));
                this.dom.visualStage.style.setProperty("--zoom-half", String(qv.halfZoom));
                this.dom.visualStage.classList.add("visual-mode-zoom");
              } else if (qv.visualType === "invert") {
                this.dom.visualStage.classList.add("visual-mode-invert");
              } else if (qv.visualType === "silhouette") {
                this.dom.visualStage.classList.add("visual-mode-silhouette");
              }

              this.dom.qImg.src = cleanImg;
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  this.dom.visualStage.classList.remove("no-visual-transition");
                });
              });
            }

            if (MASKED_TYPES.has(qv.visualType)) {
              this.dom.visualStage.classList.toggle("blur-reduced", qv.visualType === "blur" && qv.blurReduced);
              this.dom.visualStage.classList.toggle("zoom-reduced", qv.visualType === "zoom" && qv.zoomReduced);
              this.dom.visualStage.classList.toggle("visual-revealed", Boolean(qv.answerRevealed));
            }
          } else {
            this.dom.qSingleMedia.hidden = true;
            this.dom.qImg.removeAttribute("src");
          }
        }
      }

      // التلميح للجمهور (فقط بعد تفعيل كشف التلميح من المقدّم)
      if (qv.hintRevealed && qv.hintText) {
        this.dom.qHint.textContent = `💡 التلميح: ${qv.hintText}`;
        this.dom.qHint.hidden = false;
      } else {
        this.dom.qHint.textContent = "";
        this.dom.qHint.hidden = true;
      }

      // بطاقة الإجابة للجمهور (فقط بعد كشفها صراحةً من المقدّم!)
      if (qv.answerRevealed && qv.answerText) {
        this.dom.qAnswerText.textContent = qv.answerText;
        if (qv.explanationText) {
          const prefix = qv.isCharades ? "🎬 فكرة التمثيل" : "📌 التوضيح";
          this.dom.qAnswerExp.textContent = `${prefix}: ${qv.explanationText}`;
          this.dom.qAnswerExp.hidden = false;
        } else {
          this.dom.qAnswerExp.textContent = "";
          this.dom.qAnswerExp.hidden = true;
        }
        const cleanAnsImg = normalizeImgUrl(qv.answerImage);
        if (cleanAnsImg) {
          this.dom.qAnswerImg.src = cleanAnsImg;
          this.dom.qAnswerImgWrap.hidden = false;
        } else {
          this.dom.qAnswerImg.removeAttribute("src");
          this.dom.qAnswerImgWrap.hidden = true;
        }
        this.dom.qAnswerCard.hidden = false;
      } else {
        this.dom.qAnswerCard.hidden = true;
        this.dom.qAnswerText.textContent = "";
        this.dom.qAnswerExp.textContent = "";
        this.dom.qAnswerExp.hidden = true;
        this.dom.qAnswerImgWrap.hidden = true;
      }
    }

    _renderTVMultiImages(visualType, images, showPlus) {
      const cleanImgs = images.map(normalizeImgUrl).filter(Boolean).slice(0, visualType === "spot-diff" ? 2 : 4);
      const count = cleanImgs.length;
      const usePlus = visualType === "multi-image" && Boolean(showPlus) && (count === 2 || count === 3);

      let layoutClass = "layout-multi-2";
      if (visualType === "spot-diff") layoutClass = "layout-spot-diff";
      else if (count === 2) layoutClass = usePlus ? "layout-multi-2-plus" : "layout-multi-2";
      else if (count === 3) layoutClass = usePlus ? "layout-multi-3-plus" : "layout-multi-3";
      else if (count >= 4) layoutClass = "layout-multi-4";

      this.dom.multiImages.className = `multi-images-wrap tv-multi-images ${layoutClass}`;
      this.dom.multiImages.innerHTML = "";

      const spotLabels = ["الصورة أ", "الصورة ب"];
      cleanImgs.forEach((src, idx) => {
        const card = document.createElement("div");
        card.className = "tv-multi-img-card";
        const cap = visualType === "spot-diff" ? spotLabels[idx] || `صورة ${idx + 1}` : `صورة ${idx + 1}`;
        card.innerHTML = `
          <span class="multi-img-label">${cap}</span>
          <img class="tv-multi-img-el" src="${escapeHtml(src)}" alt="${cap}" />
        `;
        this.dom.multiImages.appendChild(card);
        if (usePlus && idx < cleanImgs.length - 1) {
          const plus = document.createElement("div");
          plus.className = "multi-plus-separator";
          plus.textContent = "+";
          this.dom.multiImages.appendChild(plus);
        }
      });
    }

    _renderWinner(snap) {
      this._showOnlyScreen("winner");
      const wv = snap.winnerView;
      const t0 = wv.teams[0] || { name: "الفريق الأول", score: 0 };
      const t1 = wv.teams[1] || { name: "الفريق الثاني", score: 0 };

      this.dom.winnerCard.className = `tv-winner-card ${
        wv.winnerIdx === 0 ? "winner-team-1" : wv.winnerIdx === 1 ? "winner-team-2" : "winner-draw"
      }`;
      this.dom.winnerTrophy.textContent = wv.winnerIdx === null ? "🤝" : "🏆";
      this.dom.winnerEyebrow.textContent = wv.eyebrow || "نهاية الجولة";
      this.dom.winnerTitle.textContent = wv.title || "نهاية المباراة";

      this.dom.winnerScores.innerHTML = `
        <div class="tv-winner-team-box team-1-box${wv.winnerIdx === 0 ? " is-winner" : ""}">
          ${wv.winnerIdx === 0 ? `<div class="winner-crown">👑 الفائز</div>` : ""}
          <div class="tv-winner-team-name">${escapeHtml(t0.name)}</div>
          <div class="tv-winner-team-score">${t0.score}</div>
          <div class="winner-score-unit">نقطة</div>
        </div>
        <div class="tv-winner-team-box team-2-box${wv.winnerIdx === 1 ? " is-winner" : ""}">
          ${wv.winnerIdx === 1 ? `<div class="winner-crown">👑 الفائز</div>` : ""}
          <div class="tv-winner-team-name">${escapeHtml(t1.name)}</div>
          <div class="tv-winner-team-score">${t1.score}</div>
          <div class="winner-score-unit">نقطة</div>
        </div>
      `;

      const an = wv.analytics;
      if (an && an.totalQuestions > 0) {
        const ts0 = an.teamStats[0];
        const ts1 = an.teamStats[1];
        this.dom.winnerAnalytics.innerHTML = `
          <div class="tv-analytics-kpis">
            <div class="tv-kpi-card">
              <div class="tv-kpi-val">${an.totalQuestions}</div>
              <div class="tv-kpi-lbl">سؤال محسوم</div>
            </div>
            <div class="tv-kpi-card">
              <div class="tv-kpi-val">${an.overallAccuracy}%</div>
              <div class="tv-kpi-lbl">دقة الإجابات</div>
            </div>
            <div class="tv-kpi-card">
              <div class="tv-kpi-val">🔥 ${an.totalSteals}</div>
              <div class="tv-kpi-lbl">سرقات ناجحة</div>
            </div>
            <div class="tv-kpi-card">
              <div class="tv-kpi-val">⚡ ${an.totalDoubleWins}</div>
              <div class="tv-kpi-lbl">مضاعفات 2x ناجحة</div>
            </div>
          </div>
          <div class="tv-analytics-compare">
            <div class="tv-compare-col team-1">
              <div class="tv-compare-title">${escapeHtml(t0.name)}</div>
              <div class="tv-compare-metrics">
                <span>✅ ${ts0.correct} صحيحة (${ts0.accuracy}%)</span>
                <span>🔥 ${ts0.stealsWon} سرقة</span>
                <span>⚡ ${ts0.doubleWins} مضاعفة</span>
                <span>💡 ${ts0.hintsUsed} تلميح</span>
              </div>
            </div>
            <div class="tv-compare-col team-2">
              <div class="tv-compare-title">${escapeHtml(t1.name)}</div>
              <div class="tv-compare-metrics">
                <span>✅ ${ts1.correct} صحيحة (${ts1.accuracy}%)</span>
                <span>🔥 ${ts1.stealsWon} سرقة</span>
                <span>⚡ ${ts1.doubleWins} مضاعفة</span>
                <span>💡 ${ts1.hintsUsed} تلميح</span>
              </div>
            </div>
          </div>
        `;
      } else {
        this.dom.winnerAnalytics.innerHTML = "";
      }
    }
  }

  window.SeenJeemDisplayView = new TVDisplayController();
})();
