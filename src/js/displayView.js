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
      this.mediaMemoryCache = new Map();
      this._pendingMediaKeys = new Set();
      this.dom = {};
    }

    init() {
      this.root = document.getElementById("tv-display-root");
      if (!this.root) return;

      document.title = "سين جيم | شاشة العرض التلفزيوني (TV)";
      document.body.classList.add("display-tv-mode");

      // إخفاء شاشات المقدّم والنوافذ الإدارية تماماً في وضع العرض
      [
        "setup-screen",
        "game-screen",
        "question-modal",
        "final-round-modal",
        "winner-modal",
        "result-card-modal",
        "bank-manager-modal",
        "blitz-modal",
        "charades-solo-modal",
        "hall-of-fame-modal",
        "wireless-room-modal",
        "bara-salfa-modal",
        "remote-host-root",
        "player-view-root",
        "bara-player-root",
        "confirm-modal",
        "resume-match-modal",
        "image-lightbox",
        "referee-popover",
        "soundboard-popover",
        "intermission-popover",
        "display-prefs-popover",
        "audio-mixer-popover"
      ].forEach(
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

      // تطبيق الثيم ومقياس شاشة التلفزيون المحفوظين فور الإقلاع
      if (window.SeenJeemMatchStore) {
        this._applyDisplayPrefs({
          theme: window.SeenJeemMatchStore.loadTheme(),
          tvScale: window.SeenJeemMatchStore.loadTvScale()
        });
      }

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

        <!-- شاشة لوحة اللعب التلفزيونية (تتكيف تلقائياً لـ 2 أو 3 أو 4 فرق) -->
        <section id="tv-screen-board" class="tv-screen tv-board-screen" hidden>
          <header class="tv-scoreboard-bar tv-scoreboard-adaptive">
            <div class="tv-scoreboard-center tv-scoreboard-top-brand">
              <div class="tv-center-brand"><span>سين</span> جيم</div>
              <div id="tv-remaining-pill" class="tv-remaining-pill">متبقي 36 / 36</div>
            </div>
            <div id="tv-scoreboard-teams-grid" class="tv-scoreboard-teams-grid" data-team-count="2"></div>
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

            <div id="tv-q-dd-banner" class="tv-q-dd-banner" hidden>
              <span>🌟</span>
              <strong id="tv-q-dd-title">مربع ذهبي مخفي!</strong>
              <span id="tv-q-dd-wager-pill" class="tv-q-dd-wager-pill" hidden></span>
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
              <!-- شاشة رهان المربع الذهبي للجمهور (Anti-Spoiler: بدون السؤال أو الصورة قبل التثبيت) -->
              <div id="tv-dd-wager-stage" class="tv-dd-wager-stage" hidden>
                <div class="tv-dd-star-badge" aria-hidden="true">🌟</div>
                <h2 class="tv-dd-stage-title">مربع ذهبي مخفي!</h2>
                <p id="tv-dd-stage-team" class="tv-dd-stage-team">دور: الفريق الأول</p>
                <div id="tv-dd-stage-bounds" class="tv-dd-stage-bounds">بانتظار تحديد مبلغ الرهان من جهاز المقدّم...</div>
              </div>

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

        <!-- شاشة جولة الرهان النهائي وكسر التعادل للجمهور (Anti-Spoiler - Phase 4 Pack 5) -->
        <section id="tv-screen-final" class="tv-screen tv-final-screen" hidden>
          <div class="tv-final-shell">
            <header class="tv-final-header">
              <div id="tv-final-eyebrow" class="tv-final-eyebrow">⚔️ جولة الحسم الختامية</div>
              <h1 id="tv-final-title" class="tv-final-title">جولة الرهان النهائي</h1>
              <div id="tv-final-cat-pill" class="tv-final-cat-pill">
                <span id="tv-final-cat-icon">🏆</span>
                <span id="tv-final-cat-name">الفئة</span>
              </div>
            </header>

            <div id="tv-final-timer-wrap" class="tv-q-timer-wrap tv-final-timer-wrap" hidden>
              <div class="tv-q-timer-row">
                <div id="tv-final-timer-display" class="tv-q-timer-display">01:00</div>
                <span id="tv-final-timer-label" class="tv-q-timer-label">مؤقت سؤال الحسم</span>
              </div>
              <div class="tv-q-timer-track">
                <div id="tv-final-timer-progress" class="tv-q-timer-progress"></div>
              </div>
            </div>

            <div id="tv-final-question-card" class="tv-final-question-card" hidden>
              <div id="tv-final-question-text" class="tv-final-question-text"></div>
            </div>

            <div id="tv-final-answer-card" class="tv-q-answer-card tv-final-answer-card" hidden>
              <div class="tv-answer-label">✅ الإجابة الصحيحة</div>
              <div id="tv-final-answer-text" class="tv-answer-text"></div>
              <div id="tv-final-answer-exp" class="tv-answer-exp" hidden></div>
            </div>

            <div id="tv-final-participants-grid" class="tv-final-participants-grid"></div>
            <div id="tv-final-tie-banner" class="tv-final-tie-banner" hidden>
              ⚔️ ما زال التعادل قائماً — بانتظار سؤال كسر تعادل إضافي!
            </div>
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

        <!-- شاشة طور جولة البرق السريعة للجمهور (Anti-Spoiler: السؤال + المؤقت + النقاط + السلسلة فقط!) -->
        <section id="tv-screen-blitz" class="tv-screen tv-side-mode-screen tv-blitz-screen" hidden>
          <div id="tv-blitz-shell" class="tv-side-shell">
            <header class="tv-side-header">
              <div class="tv-side-team-meta">
                <span class="tv-side-mode-tag">⚡ جولة البرق السريعة</span>
                <h2 id="tv-blitz-team-name" class="tv-side-team-name">اللاعب الأول</h2>
                <span id="tv-blitz-round-pill" class="tv-remaining-pill">الجولة 1</span>
              </div>
              <div class="tv-side-score-cluster">
                <span id="tv-blitz-streak" class="tv-blitz-streak" hidden>🔥 سلسلة ×0</span>
                <div id="tv-blitz-score" class="tv-side-score-val">0</div>
              </div>
            </header>

            <div class="tv-side-timer-hero">
              <div id="tv-blitz-timer" class="tv-side-giant-timer">01:00</div>
              <div class="tv-q-timer-track tv-side-timer-track">
                <div id="tv-blitz-progress" class="tv-q-timer-progress"></div>
              </div>
            </div>

            <main id="tv-blitz-stage" class="tv-side-stage">
              <div id="tv-blitz-ready-box" class="tv-side-ready-box" hidden>
                <div class="tv-side-ready-icon">⚡</div>
                <h3 id="tv-blitz-ready-title" class="tv-side-ready-title">استعد للجولة!</h3>
                <p id="tv-blitz-ready-sub" class="tv-side-ready-sub">أجب بأقصى سرعة قبل نفاد الوقت</p>
                <div id="tv-blitz-standings" class="tv-side-standings"></div>
              </div>

              <div id="tv-blitz-play-box" class="tv-side-play-box" hidden>
                <span id="tv-blitz-cat" class="tv-q-cat-pill">⚡ فئة</span>
                <p id="tv-blitz-q-text" class="tv-blitz-q-text"></p>
              </div>

              <div id="tv-blitz-summary-box" class="tv-side-summary-box" hidden>
                <h3 class="tv-side-summary-heading">⏰ انتهى الوقت! ملخص الدور</h3>
                <div id="tv-blitz-summary-list" class="tv-side-summary-list"></div>
              </div>
            </main>
          </div>
        </section>

        <!-- شاشة طور «من غير كلام» المستقل للجمهور (Anti-Spoiler: التصنيف + عدد الكلمات + المؤقت + التلميح عند الطلب فقط!) -->
        <section id="tv-screen-charades-solo" class="tv-screen tv-side-mode-screen tv-csolo-screen" hidden>
          <div id="tv-csolo-shell" class="tv-side-shell">
            <header class="tv-side-header">
              <div class="tv-side-team-meta">
                <span class="tv-side-mode-tag">🎭 من غير كلام</span>
                <h2 id="tv-csolo-team-name" class="tv-side-team-name">الفريق الأول</h2>
                <span id="tv-csolo-round-pill" class="tv-remaining-pill">الجولة 1</span>
              </div>
              <div class="tv-side-score-cluster">
                <div id="tv-csolo-score" class="tv-side-score-val">0</div>
              </div>
            </header>

            <div class="tv-side-timer-hero">
              <div id="tv-csolo-timer" class="tv-side-giant-timer">01:30</div>
              <div class="tv-q-timer-track tv-side-timer-track">
                <div id="tv-csolo-progress" class="tv-q-timer-progress"></div>
              </div>
            </div>

            <main id="tv-csolo-stage" class="tv-side-stage">
              <div id="tv-csolo-ready-box" class="tv-side-ready-box" hidden>
                <div class="tv-side-ready-icon">🎭</div>
                <h3 id="tv-csolo-ready-title" class="tv-side-ready-title">استعد للتمثيل الصامت!</h3>
                <p id="tv-csolo-ready-sub" class="tv-side-ready-sub">الفريق المخمّن يراقب الشاشة والممثّل يمثّل بدون كلام</p>
                <div id="tv-csolo-standings" class="tv-side-standings"></div>
              </div>

              <div id="tv-csolo-play-box" class="tv-side-play-box" hidden>
                <div id="tv-csolo-eyebrow" class="tv-charades-eyebrow">🎭 من غير كلام</div>
                <h2 id="tv-csolo-topic" class="tv-charades-topic">التصنيف الفرعي</h2>
                <div id="tv-csolo-words" class="tv-charades-words-pill">🔢 عدد الكلمات</div>
                <div id="tv-csolo-hint" class="tv-q-hint" hidden></div>
              </div>

              <div id="tv-csolo-summary-box" class="tv-side-summary-box" hidden>
                <h3 class="tv-side-summary-heading">⏰ انتهى دور التمثيل! الكلمات في هذا الدور</h3>
                <div id="tv-csolo-summary-list" class="tv-side-summary-list"></div>
              </div>
            </main>
          </div>
        </section>

        <!-- شاشة لعبة «برا السالفة» على التلفزيون (محلي + لاسلكي — بدون أي تسريب!) -->
        <section id="tv-screen-bara-salfa" class="tv-screen tv-side-mode-screen tv-bara-screen" hidden>
          <div id="tv-bara-stage" class="tv-bara-stage"></div>
        </section>

        <!-- طبقة شاشة الاستراحة التلفزيونية الكاملة (Intermission Overlay — بدون أي تسريب للسؤال) -->
        <section id="tv-intermission-overlay" class="tv-intermission-overlay" hidden aria-live="polite">
          <div class="tv-intermission-card">
            <div class="tv-intermission-badge">☕ استراحة تلفزيونية</div>
            <h1 id="tv-intermission-title" class="tv-intermission-title">استراحة قصيرة — نعود بعد قليل</h1>
            <div id="tv-intermission-timer" class="tv-intermission-timer" hidden>05:00</div>
            <div class="tv-intermission-standings-wrap">
              <div class="tv-intermission-standings-label">🏆 الترتيب والنقاط الحالية</div>
              <div id="tv-intermission-standings" class="tv-intermission-standings"></div>
            </div>
          </div>
        </section>

        <!-- شريط فائز جرس السرعة اللاسلكي على التلفزيون (Phase 4 Pack 9) -->
        <div id="tv-buzzer-banner" class="tv-buzzer-banner" hidden aria-live="assertive">
          <span class="tv-buzzer-icon" aria-hidden="true">🔔</span>
          <span id="tv-buzzer-text">الأسرع: الفريق الأول</span>
          <span id="tv-buzzer-delta" class="tv-buzzer-delta" hidden>+0ms</span>
        </div>

        <!-- بطاقة QR الفرق الاختيارية على التلفزيون (محلية 100% بدون أي تسريب لـ hostToken) -->
        <aside id="tv-player-qr-card" class="tv-player-qr-card" hidden aria-label="انضمام الفرق عبر الهاتف">
          <div class="tv-qr-head">📱 جرس الفرق السريع</div>
          <div id="tv-player-qr-svg" class="tv-player-qr-svg"></div>
          <div class="tv-qr-code-pill">الرمز: <strong id="tv-player-qr-code">------</strong></div>
        </aside>

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
        scoreboardTeamsGrid: $("tv-scoreboard-teams-grid"),
        remainingPill: $("tv-remaining-pill"),
        boardGrid: $("tv-board-grid"),

        finalScreen: $("tv-screen-final"),
        finalEyebrow: $("tv-final-eyebrow"),
        finalTitle: $("tv-final-title"),
        finalCatIcon: $("tv-final-cat-icon"),
        finalCatName: $("tv-final-cat-name"),
        finalTimerWrap: $("tv-final-timer-wrap"),
        finalTimerDisplay: $("tv-final-timer-display"),
        finalTimerLabel: $("tv-final-timer-label"),
        finalTimerProgress: $("tv-final-timer-progress"),
        finalQuestionCard: $("tv-final-question-card"),
        finalQuestionText: $("tv-final-question-text"),
        finalAnswerCard: $("tv-final-answer-card"),
        finalAnswerText: $("tv-final-answer-text"),
        finalAnswerExp: $("tv-final-answer-exp"),
        finalParticipantsGrid: $("tv-final-participants-grid"),
        finalTieBanner: $("tv-final-tie-banner"),

        questionScreen: $("tv-screen-question"),
        qCatIcon: $("tv-q-cat-icon"),
        qCatName: $("tv-q-cat-name"),
        qPointsPill: $("tv-q-points-pill"),
        qTypePill: $("tv-q-type-pill"),
        qTurnBadge: $("tv-q-turn-badge"),
        qStealBanner: $("tv-q-steal-banner"),
        qStealText: $("tv-q-steal-text"),
        qStealPts: $("tv-q-steal-pts"),
        qDdBanner: $("tv-q-dd-banner"),
        qDdTitle: $("tv-q-dd-title"),
        qDdWagerPill: $("tv-q-dd-wager-pill"),
        ddWagerStage: $("tv-dd-wager-stage"),
        ddStageTeam: $("tv-dd-stage-team"),
        ddStageBounds: $("tv-dd-stage-bounds"),
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

        blitzScreen: $("tv-screen-blitz"),
        blitzTeamName: $("tv-blitz-team-name"),
        blitzRoundPill: $("tv-blitz-round-pill"),
        blitzStreak: $("tv-blitz-streak"),
        blitzScore: $("tv-blitz-score"),
        blitzTimer: $("tv-blitz-timer"),
        blitzProgress: $("tv-blitz-progress"),
        blitzStage: $("tv-blitz-stage"),
        blitzReadyBox: $("tv-blitz-ready-box"),
        blitzReadyTitle: $("tv-blitz-ready-title"),
        blitzReadySub: $("tv-blitz-ready-sub"),
        blitzStandings: $("tv-blitz-standings"),
        blitzPlayBox: $("tv-blitz-play-box"),
        blitzCat: $("tv-blitz-cat"),
        blitzQText: $("tv-blitz-q-text"),
        blitzSummaryBox: $("tv-blitz-summary-box"),
        blitzSummaryList: $("tv-blitz-summary-list"),

        csoloScreen: $("tv-screen-charades-solo"),
        baraScreen: $("tv-screen-bara-salfa"),
        baraStage: $("tv-bara-stage"),
        csoloTeamName: $("tv-csolo-team-name"),
        csoloRoundPill: $("tv-csolo-round-pill"),
        csoloScore: $("tv-csolo-score"),
        csoloTimer: $("tv-csolo-timer"),
        csoloProgress: $("tv-csolo-progress"),
        csoloStage: $("tv-csolo-stage"),
        csoloReadyBox: $("tv-csolo-ready-box"),
        csoloReadyTitle: $("tv-csolo-ready-title"),
        csoloReadySub: $("tv-csolo-ready-sub"),
        csoloStandings: $("tv-csolo-standings"),
        csoloPlayBox: $("tv-csolo-play-box"),
        csoloEyebrow: $("tv-csolo-eyebrow"),
        csoloTopic: $("tv-csolo-topic"),
        csoloWords: $("tv-csolo-words"),
        csoloHint: $("tv-csolo-hint"),
        csoloSummaryBox: $("tv-csolo-summary-box"),
        csoloSummaryList: $("tv-csolo-summary-list"),

        intermissionOverlay: $("tv-intermission-overlay"),
        intermissionTitle: $("tv-intermission-title"),
        intermissionTimer: $("tv-intermission-timer"),
        intermissionStandings: $("tv-intermission-standings"),

        buzzerBanner: $("tv-buzzer-banner"),
        buzzerText: $("tv-buzzer-text"),
        buzzerDelta: $("tv-buzzer-delta"),
        playerQrCard: $("tv-player-qr-card"),
        playerQrSvg: $("tv-player-qr-svg"),
        playerQrCode: $("tv-player-qr-code"),

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
      } else if (msg.type === "SYNC_AUDIO_SETTINGS" && msg.payload) {
        if (window.SeenJeemAudio && typeof window.SeenJeemAudio.applySyncedSettings === "function") {
          window.SeenJeemAudio.applySyncedSettings(msg.payload);
        }
      } else if (msg.type === "SYNC_DISPLAY_PREFS" && msg.payload) {
        this._applyDisplayPrefs(msg.payload);
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
      if (this.dom.finalScreen) this.dom.finalScreen.hidden = screenName !== "final";
      this.dom.winnerScreen.hidden = screenName !== "winner";
      if (this.dom.blitzScreen) this.dom.blitzScreen.hidden = screenName !== "blitz";
      if (this.dom.csoloScreen) this.dom.csoloScreen.hidden = screenName !== "charades-solo";
      if (this.dom.baraScreen) this.dom.baraScreen.hidden = screenName !== "bara-salfa";
    }

    _applyDisplayPrefs(prefs) {
      if (!prefs || typeof prefs !== "object") return;
      const validThemes = new Set(["dark-glass", "royal-gold", "high-contrast"]);
      if (typeof prefs.theme === "string" && validThemes.has(prefs.theme)) {
        document.documentElement.dataset.theme = prefs.theme;
      }
      if (prefs.tvScale !== undefined) {
        const num = Number(prefs.tvScale);
        if (Number.isFinite(num)) {
          const clamped = Math.min(130, Math.max(90, Math.round(num / 5) * 5));
          const ratio = clamped / 100;
          document.documentElement.style.setProperty("--tv-scale", String(ratio));
          document.documentElement.style.fontSize = `${(16 * ratio).toFixed(2)}px`;
        }
      }
    }

    _renderIntermissionOverlay(snap) {
      if (!this.dom.intermissionOverlay) return;
      const im = snap && snap.intermission;
      const isActive = Boolean(im && im.active);
      this.dom.intermissionOverlay.hidden = !isActive;
      if (!isActive) return;

      this.dom.intermissionTitle.textContent =
        im.message || "استراحة قصيرة — نعود بعد قليل";

      if (im.totalSeconds > 0) {
        this.dom.intermissionTimer.hidden = false;
        this.dom.intermissionTimer.textContent = formatTime(im.remainingSeconds);
        this.dom.intermissionTimer.classList.toggle("is-ended", im.remainingSeconds === 0);
      } else {
        this.dom.intermissionTimer.hidden = true;
      }

      const teams = Array.isArray(snap.teams) ? snap.teams : [];
      const ranked = teams
        .map((t, origIdx) => ({
          origIdx,
          name: t.name || `الفريق ${origIdx + 1}`,
          score: Number(t.score) || 0
        }))
        .sort((a, b) => b.score - a.score);

      this.dom.intermissionStandings.dataset.teamCount = String(ranked.length);
      this.dom.intermissionStandings.innerHTML = ranked
        .map(
          (team, rankIdx) => `
          <div class="tv-intermission-team team-${team.origIdx + 1}-card">
            <span class="tv-intermission-rank">#${rankIdx + 1}</span>
            <span class="team-badge-dot team-${team.origIdx + 1}-dot"></span>
            <span class="tv-intermission-team-name">${escapeHtml(team.name)}</span>
            <strong class="tv-intermission-team-score">${team.score}</strong>
          </div>
        `
        )
        .join("");
    }

    _renderWirelessOverlays(snap) {
      const wl = snap && snap.wireless;

      // 1) بطاقة QR الفرق الاختيارية على التلفزيون
      if (this.dom.playerQrCard) {
        const showQr = Boolean(wl && wl.active && wl.showQrOnTv && wl.playerUrl && wl.roomCode);
        this.dom.playerQrCard.hidden = !showQr;
        if (showQr) {
          if (this.dom.playerQrCode) this.dom.playerQrCode.textContent = wl.roomCode;
          if (this.dom.playerQrSvg && this._lastRenderedQrUrl !== wl.playerUrl && window.SeenJeemQR) {
            this._lastRenderedQrUrl = wl.playerUrl;
            try {
              this.dom.playerQrSvg.innerHTML = window.SeenJeemQR.toSVG(wl.playerUrl, {
                size: 156,
                margin: 2,
                ariaLabel: `رمز QR لانضمام الفرق للغرفة ${wl.roomCode}`
              });
            } catch (_err) {}
          }
        }
      }

      // 2) شريط فائز جرس السرعة
      if (this.dom.buzzerBanner) {
        const bz = wl && wl.buzzer;
        const hasWinner = Boolean(wl && wl.active && bz && bz.state === "buzzed" && bz.winnerTeamName);
        this.dom.buzzerBanner.hidden = !hasWinner;
        if (hasWinner) {
          const teamNum = Number.isInteger(bz.winnerTeamIdx) ? bz.winnerTeamIdx + 1 : 1;
          this.dom.buzzerBanner.className = `tv-buzzer-banner team-${teamNum}`;
          if (this.dom.buzzerText) {
            this.dom.buzzerText.textContent = `الأسرع بالجرس: ${bz.winnerTeamName}!`;
          }
          if (this.dom.buzzerDelta) {
            if (bz.runnerUpDeltaMs !== null && bz.runnerUpDeltaMs !== undefined) {
              this.dom.buzzerDelta.textContent = `+${bz.runnerUpDeltaMs}ms`;
              this.dom.buzzerDelta.hidden = false;
            } else {
              this.dom.buzzerDelta.hidden = true;
            }
          }
        }
      }
    }

    _resolveIsolatedQuestionMediaIfNeeded(snap) {
      const qv = snap && snap.questionView;
      if (!qv || !qv.hasMedia || !qv.mediaKey) return;
      const needsQ = Boolean(qv.mediaFields && qv.mediaFields.questionImage && !qv.questionImage);
      const needsA = Boolean(qv.answerRevealed && qv.mediaFields && qv.mediaFields.answerImage && !qv.answerImage);
      const needsM = Boolean(qv.mediaFields && qv.mediaFields.images && (!Array.isArray(qv.images) || qv.images.some((x) => !x)));
      if (!needsQ && !needsA && !needsM) return;

      const cached = this.mediaMemoryCache.get(qv.mediaKey);
      if (cached) {
        if (needsQ && cached.questionImage) qv.questionImage = cached.questionImage;
        if (needsA && cached.answerImage) qv.answerImage = cached.answerImage;
        if (needsM && Array.isArray(cached.images)) qv.images = cached.images.slice();
        return;
      }

      const rt = window.SeenJeemRealtimeSync;
      if (!rt || typeof rt.fetchMedia !== "function" || this._pendingMediaKeys.has(qv.mediaKey)) return;
      const key = qv.mediaKey;
      this._pendingMediaKeys.add(key);
      rt.fetchMedia(key)
        .then((payload) => {
          this._pendingMediaKeys.delete(key);
          if (!payload) return;
          this.mediaMemoryCache.set(key, payload);
          if (this.snapshot && this.snapshot.screen === "question" && this.snapshot.questionView && this.snapshot.questionView.mediaKey === key) {
            const curQv = this.snapshot.questionView;
            if (!curQv.questionImage && payload.questionImage) curQv.questionImage = payload.questionImage;
            if (curQv.answerRevealed && !curQv.answerImage && payload.answerImage) curQv.answerImage = payload.answerImage;
            if (Array.isArray(payload.images) && (!Array.isArray(curQv.images) || curQv.images.some((x) => !x))) {
              curQv.images = payload.images.slice();
            }
            this.lastQuestionRenderKey = "";
            this._renderQuestion(this.snapshot);
          }
        })
        .catch(() => {
          this._pendingMediaKeys.delete(key);
        });
    }

    applySnapshot(snap) {
      if (!snap || typeof snap !== "object") return;
      this.snapshot = snap;

      if (snap.displayPrefs) {
        this._applyDisplayPrefs(snap.displayPrefs);
      }

      if (
        snap.audioSettings &&
        window.SeenJeemAudio &&
        typeof window.SeenJeemAudio.applySyncedSettings === "function"
      ) {
        window.SeenJeemAudio.applySyncedSettings(snap.audioSettings);
      }

      this._renderIntermissionOverlay(snap);
      this._renderWirelessOverlays(snap);

      if (snap.screen === "setup") {
        this.lastQuestionRenderKey = "";
        this._renderStandby(snap.setupInfo);
      } else if (snap.screen === "board") {
        this.lastQuestionRenderKey = "";
        this._renderBoard(snap);
      } else if (snap.screen === "question" && snap.questionView) {
        this._resolveIsolatedQuestionMediaIfNeeded(snap);
        this._renderQuestion(snap);
      } else if (snap.screen === "final" && snap.finalRoundView) {
        this.lastQuestionRenderKey = "";
        this._renderFinalRound(snap);
      } else if (snap.screen === "winner" && snap.winnerView) {
        this.lastQuestionRenderKey = "";
        this._renderWinner(snap);
      } else if (snap.screen === "blitz" && snap.blitzView) {
        this.lastQuestionRenderKey = "";
        this._renderBlitz(snap);
      } else if (snap.screen === "charades-solo" && snap.charadesSoloView) {
        this.lastQuestionRenderKey = "";
        this._renderCharadesSolo(snap);
      } else if (snap.screen === "bara-salfa" && snap.baraSalfaView) {
        this.lastQuestionRenderKey = "";
        this._renderBaraSalfa(snap);
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

      const teamNames =
        info && Array.isArray(info.teamNames) && info.teamNames.length >= 2
          ? info.teamNames
          : info && info.team1Name && info.team2Name
            ? [info.team1Name, info.team2Name]
            : [];

      if (teamNames.length >= 2) {
        this.dom.standbyTeams.hidden = false;
        this.dom.standbyTeams.innerHTML = teamNames
          .map(
            (name, idx) =>
              `<div class="tv-standby-team team-${idx + 1}">${escapeHtml(name)}</div>${
                idx < teamNames.length - 1 ? `<div class="tv-standby-vs">VS</div>` : ""
              }`
          )
          .join("");
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

      const teams =
        Array.isArray(snap.teams) && snap.teams.length >= 2
          ? snap.teams
          : [
              { name: "الفريق الأول", score: 0, powerups: { doubleLeft: 0, swapLeft: 0 } },
              { name: "الفريق الثاني", score: 0, powerups: { doubleLeft: 0, swapLeft: 0 } }
            ];

      if (this.dom.scoreboardTeamsGrid) {
        this.dom.scoreboardTeamsGrid.dataset.teamCount = String(teams.length);
        this.dom.scoreboardTeamsGrid.innerHTML = "";

        teams.forEach((team, idx) => {
          const isTurn = snap.activeTurn === idx;
          const prevScore = this.lastRenderedScores[idx];
          const didScoreChange = prevScore !== undefined && prevScore !== team.score;
          this.lastRenderedScores[idx] = team.score;

          const card = document.createElement("div");
          card.className = `tv-team-card team-${idx + 1}-card${isTurn ? " active-turn" : ""}`;
          card.innerHTML = `
            <div class="tv-team-top">
              <div class="tv-team-id">
                <span class="team-badge-dot team-${idx + 1}-dot"></span>
                <h2 class="tv-team-name">${escapeHtml(team.name)}</h2>
              </div>
              <span class="tv-turn-pill">الدور الآن</span>
            </div>
            <div class="tv-team-bottom">
              <div class="tv-team-score${didScoreChange ? " score-pop" : ""}">${team.score}</div>
              <div class="tv-powerups-row"></div>
            </div>
          `;
          const powerupsRow = card.querySelector(".tv-powerups-row");
          this._renderTVTeamPowerups(powerupsRow, team, isTurn, snap.doubleArmed);
          this.dom.scoreboardTeamsGrid.appendChild(card);
        });
      }

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
                slot.played && Number.isInteger(slot.winnerTeam) && slot.winnerTeam >= 0 && slot.winnerTeam < 4
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
      if (qv.isDailyDouble && qv.dailyDoublePhase === "wager") {
        this.dom.qPointsPill.classList.add("doubled");
        this.dom.qPointsPill.textContent = `🌟 مربع ذهبي (${qv.basePoints})`;
      } else if (qv.isDailyDouble) {
        this.dom.qPointsPill.classList.add("doubled");
        this.dom.qPointsPill.textContent = `🌟 رهان: ${qv.dailyDoubleWager} نقطة`;
      } else if (qv.phase === "steal-active") {
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
        this.dom.qTurnBadge.classList.add(`steal-turn-${qv.stealingTeamIdx}`);
        this.dom.qTurnBadge.textContent = `🔥 سرقة: ${stealingTeam.name}`;
        this.dom.qStealBanner.hidden = false;
        this.dom.qStealBanner.className = `tv-q-steal-banner steal-team-${qv.stealingTeamIdx}`;
        this.dom.qStealText.textContent = `فرصة سرقة لـ ${stealingTeam.name}`;
        this.dom.qStealPts.textContent = `+${qv.stealPoints} نقطة`;
      } else {
        this.dom.qTurnBadge.classList.add(`team-${(qv.activeTeamAtOpen || 0) + 1}-turn`);
        this.dom.qTurnBadge.textContent = `دور: ${ownerTeam.name}`;
        this.dom.qStealBanner.hidden = true;
      }

      // شريط المربع الذهبي المخفي (Hidden Daily Double)
      const isDdWager = Boolean(qv.isDailyDouble && qv.dailyDoublePhase === "wager");
      if (this.dom.qDdBanner) {
        this.dom.qDdBanner.hidden = !qv.isDailyDouble;
        if (qv.isDailyDouble) {
          this.dom.qDdTitle.textContent = isDdWager
            ? "🌟 مربع ذهبي مخفي! — بانتظار تثبيت الرهان"
            : `🌟 مربع ذهبي مخفي! — رهان ${ownerTeam.name}`;
          if (!isDdWager && qv.dailyDoubleWager > 0) {
            this.dom.qDdWagerPill.textContent = `±${qv.dailyDoubleWager} نقطة`;
            this.dom.qDdWagerPill.hidden = false;
          } else {
            this.dom.qDdWagerPill.hidden = true;
          }
        }
      }

      if (isDdWager) {
        this.dom.qTimerWrap.hidden = true;
        this.dom.qBanners.hidden = true;
        this.dom.charadesStage.hidden = true;
        this.dom.memoryReady.hidden = true;
        this.dom.memoryBar.hidden = true;
        this.dom.qText.textContent = "";
        this.dom.qText.hidden = true;
        this.dom.qSingleMedia.hidden = true;
        this.dom.spotDiffWrap.hidden = true;
        this.dom.multiImages.hidden = true;
        this.dom.qHint.hidden = true;
        this.dom.qAnswerCard.hidden = true;
        if (this.dom.ddWagerStage) {
          this.dom.ddWagerStage.hidden = false;
          this.dom.ddStageTeam.textContent = `خاص بالفريق: ${ownerTeam.name} • الفئة: ${qv.categoryName || ""}`;
          this.dom.ddStageBounds.textContent = `الرهان المتاح: من 100 حتى ${qv.dailyDoubleMaxWager || qv.basePoints * 2} نقطة (صح +رهان / خطأ -رهان)`;
        }
        return;
      }

      if (this.dom.ddWagerStage) {
        this.dom.ddWagerStage.hidden = true;
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

      const isDanger = !isUnlimited && qv.timerRemaining <= 10 && qv.timerMode !== "waiting-memory";
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

    _renderFinalRound(snap) {
      this._showOnlyScreen("final");
      const fv = snap.finalRoundView;
      if (!fv) return;

      const isTieBreaker = fv.triggerReason === "tie-breaker" || fv.triggerReason === "manual";
      this.dom.finalEyebrow.textContent = isTieBreaker
        ? `⚔️ كسر التعادل — الجولة ${fv.roundNumber}`
        : "⚔️ سؤال الحسم الختامي";
      this.dom.finalTitle.textContent =
        fv.phase === "wager"
          ? "تثبيت الرهانات السرية"
          : fv.phase === "question"
            ? "سؤال الرهان النهائي"
            : "كشف الإجابة والنتائج!";

      this.dom.finalCatIcon.textContent = (fv.category && fv.category.icon) || "🏆";
      this.dom.finalCatName.textContent = (fv.category && fv.category.name) || "";

      // المرحلة 2: المؤقت + نص السؤال فقط (بدون إجابة وبدون مبالغ رهان)
      const showQuestion = (fv.phase === "question" || fv.phase === "reveal") && Boolean(fv.questionText);
      this.dom.finalQuestionCard.hidden = !showQuestion;
      if (showQuestion) {
        this.dom.finalQuestionText.textContent = fv.questionText;
      } else {
        this.dom.finalQuestionText.textContent = "";
      }

      const showTimer = fv.phase === "question";
      this.dom.finalTimerWrap.hidden = !showTimer;
      if (showTimer) {
        const pct = fv.timerMax > 0 ? Math.min(100, (fv.timerRemaining / fv.timerMax) * 100) : 0;
        const isDanger = fv.timerRemaining <= 10;
        this.dom.finalTimerDisplay.textContent = formatTime(fv.timerRemaining);
        this.dom.finalTimerProgress.style.width = `${pct}%`;
        this.dom.finalTimerDisplay.classList.toggle("danger", isDanger);
        this.dom.finalTimerProgress.classList.toggle("danger", isDanger);
        this.dom.finalTimerLabel.textContent =
          fv.timerRemaining === 0
            ? "⏰ انتهى وقت الحسم!"
            : fv.timerRunning
              ? "مؤقت سؤال الحسم جارٍ"
              : "المؤقت متوقف";
      }

      // المرحلة 3 فقط: كشف الإجابة والشرح
      const showAnswer = fv.phase === "reveal" && Boolean(fv.answerText);
      this.dom.finalAnswerCard.hidden = !showAnswer;
      if (showAnswer) {
        this.dom.finalAnswerText.textContent = fv.answerText;
        if (fv.explanationText) {
          this.dom.finalAnswerExp.textContent = `📌 التوضيح: ${fv.explanationText}`;
          this.dom.finalAnswerExp.hidden = false;
        } else {
          this.dom.finalAnswerExp.textContent = "";
          this.dom.finalAnswerExp.hidden = true;
        }
      } else {
        this.dom.finalAnswerText.textContent = "";
        this.dom.finalAnswerExp.textContent = "";
        this.dom.finalAnswerExp.hidden = true;
      }

      // بطاقات الفرق المشاركة (بدون مبالغ رهان حتى مرحلة reveal)
      const participants = Array.isArray(fv.participants) ? fv.participants : [];
      this.dom.finalParticipantsGrid.dataset.teamCount = String(participants.length);
      this.dom.finalParticipantsGrid.innerHTML = participants
        .map((p) => {
          const teamNum = (Number(p.teamIdx) || 0) + 1;
          if (fv.phase === "reveal") {
            const deltaText =
              p.effectiveDelta > 0
                ? `+${p.effectiveDelta}`
                : p.effectiveDelta < 0
                  ? `${p.effectiveDelta}`
                  : "0";
            return `
              <div class="tv-final-team-card team-${teamNum}-card ${p.correct ? "is-correct" : "is-wrong"}">
                <div class="tv-final-team-head">
                  <span class="team-badge-dot team-${teamNum}-dot"></span>
                  <strong>${escapeHtml(p.name)}</strong>
                  <span class="tv-final-verdict-badge ${p.correct ? "ok" : "bad"}">
                    ${p.correct ? "✅ إجابة صحيحة" : "❌ إجابة خاطئة"}
                  </span>
                </div>
                <div class="tv-final-wager-reveal">الرهان: <strong>${p.wager}</strong> نقطة</div>
                <div class="tv-final-delta ${p.correct ? "pos" : "neg"}">${deltaText}</div>
                <div class="tv-final-score-shift">${p.prevScore} ← <strong>${p.nextScore}</strong></div>
              </div>
            `;
          }
          return `
            <div class="tv-final-team-card team-${teamNum}-card ${p.locked ? "is-locked" : "is-waiting"}">
              <div class="tv-final-team-head">
                <span class="team-badge-dot team-${teamNum}-dot"></span>
                <strong>${escapeHtml(p.name)}</strong>
              </div>
              <div class="tv-final-cur-score">الرصيد الحالي: <strong>${p.score}</strong></div>
              <div class="tv-final-lock-pill ${p.locked ? "locked" : "waiting"}">
                ${p.locked ? "✅ تم تثبيت الرهان" : "⏳ بانتظار الرهان"}
              </div>
            </div>
          `;
        })
        .join("");

      this.dom.finalTieBanner.hidden = !(fv.phase === "reveal" && fv.stillTiedAfterReveal);
    }

    _renderWinner(snap) {
      this._showOnlyScreen("winner");
      const wv = snap.winnerView;
      const teams = Array.isArray(wv.teams) ? wv.teams : [];
      const leaderIndices = Array.isArray(wv.leaderIndices)
        ? wv.leaderIndices
        : Number.isInteger(wv.winnerIdx)
          ? [wv.winnerIdx]
          : [];
      const isDraw = leaderIndices.length !== 1;
      const winnerIdx = !isDraw ? leaderIndices[0] : null;

      this.dom.winnerCard.className = `tv-winner-card ${
        winnerIdx !== null ? `winner-team-${winnerIdx + 1}` : "winner-draw"
      }`;
      this.dom.winnerTrophy.textContent = isDraw ? "🤝" : "🏆";
      this.dom.winnerEyebrow.textContent = wv.eyebrow || "نهاية الجولة";
      this.dom.winnerTitle.textContent = wv.title || "نهاية المباراة";

      this.dom.winnerScores.dataset.teamCount = String(teams.length);
      this.dom.winnerScores.innerHTML = teams
        .map((t, idx) => {
          const isLeader = leaderIndices.includes(idx);
          const crownLabel = isDraw ? "🤝 متعادل في الصدارة" : "👑 الفائز";
          return `
            <div class="tv-winner-team-box team-${idx + 1}-box${isLeader ? " is-winner" : ""}">
              ${isLeader ? `<div class="winner-crown">${crownLabel}</div>` : ""}
              <div class="tv-winner-team-name">${escapeHtml(t.name)}</div>
              <div class="tv-winner-team-score">${t.score}</div>
              <div class="winner-score-unit">نقطة</div>
            </div>
          `;
        })
        .join("");

      const an = wv.analytics;
      if (an && an.totalQuestions > 0) {
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
          <div class="tv-analytics-compare" data-team-count="${an.teamStats.length}">
            ${an.teamStats
              .map(
                (ts, idx) => `
              <div class="tv-compare-col team-${idx + 1}">
                <div class="tv-compare-title">${escapeHtml(ts.name)}</div>
                <div class="tv-compare-metrics">
                  <span>✅ ${ts.correct} صحيحة (${ts.accuracy}%)</span>
                  <span>🔥 ${ts.stealsWon} سرقة</span>
                  <span>⚡ ${ts.doubleWins} مضاعفة</span>
                  <span>💡 ${ts.hintsUsed} تلميح</span>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        `;
      } else {
        this.dom.winnerAnalytics.innerHTML = "";
      }
    }

    _renderBlitz(snap) {
      this._showOnlyScreen("blitz");
      const bv = snap.blitzView;
      if (!bv) return;

      this.dom.blitzTeamName.textContent = bv.activeTeamName || "اللاعب";
      this.dom.blitzRoundPill.textContent = `الجولة ${bv.currentRoundForTeam || 1} / ${bv.roundsPerTeam || 1}`;
      this.dom.blitzScore.textContent = String(bv.activeTeamScore || 0);

      const streak = Number(bv.currentStreak) || 0;
      if (streak >= 2) {
        this.dom.blitzStreak.textContent = `🔥 سلسلة ×${streak}`;
        this.dom.blitzStreak.hidden = false;
      } else {
        this.dom.blitzStreak.hidden = true;
      }

      const maxT = Math.max(1, Number(bv.timerMax) || 60);
      const remT = Math.max(0, Number(bv.timerRemaining) || 0);
      const pct = Math.min(100, (remT / maxT) * 100);
      const isDanger = bv.phase === "playing" && remT > 0 && remT <= 10;
      this.dom.blitzTimer.textContent = formatTime(remT);
      this.dom.blitzTimer.classList.toggle("danger", isDanger);
      this.dom.blitzProgress.style.width = `${pct}%`;
      this.dom.blitzProgress.classList.toggle("danger", isDanger);

      // وميض ناعم أخضر / أحمر عند آخر إجابة دون أي تسريب
      if (this.dom.blitzStage) {
        this.dom.blitzStage.classList.remove("flash-correct", "flash-wrong");
        if (bv.lastFeedback && bv.lastFeedback.ts && bv.lastFeedback.ts !== this._lastBlitzFeedbackTs) {
          this._lastBlitzFeedbackTs = bv.lastFeedback.ts;
          if (bv.lastFeedback.type === "correct") {
            void this.dom.blitzStage.offsetWidth;
            this.dom.blitzStage.classList.add("flash-correct");
          } else if (bv.lastFeedback.type === "wrong") {
            void this.dom.blitzStage.offsetWidth;
            this.dom.blitzStage.classList.add("flash-wrong");
          }
        }
      }

      this.dom.blitzReadyBox.hidden = bv.phase !== "ready";
      this.dom.blitzPlayBox.hidden = bv.phase !== "playing";
      this.dom.blitzSummaryBox.hidden = bv.phase !== "turn-summary";

      if (bv.phase === "ready") {
        this.dom.blitzReadyTitle.textContent = `استعد: ${bv.activeTeamName || ""}`;
        this.dom.blitzReadySub.textContent = `أمامك ${bv.durationSeconds || 60} ثانية للإجابة على أكبر عدد ممكن من الأسئلة (+100 لكل صح)`;
        this.dom.blitzStandings.innerHTML = (bv.teams || [])
          .map(
            (t, idx) =>
              `<div class="tv-side-standing-pill team-${idx + 1}-card"><span>${escapeHtml(t.name)}</span><strong>${t.score}</strong></div>`
          )
          .join("");
      } else if (bv.phase === "playing") {
        this.dom.blitzCat.textContent = `${bv.categoryIcon || "⚡"} ${bv.categoryName || "سؤال سريع"}`;
        this.dom.blitzQText.textContent = bv.questionText || "";
      } else if (bv.phase === "turn-summary") {
        this.dom.blitzSummaryList.innerHTML = (bv.turnSummary || [])
          .slice(-8)
          .map((item) => {
            const badge =
              item.outcome === "correct"
                ? `<span class="tv-sum-badge ok">✅ +100</span>`
                : item.outcome === "wrong"
                  ? `<span class="tv-sum-badge bad">❌ خطأ</span>`
                  : `<span class="tv-sum-badge skip">⏭️ تخطي</span>`;
            return `
              <div class="tv-side-summary-item">
                <div class="tv-side-summary-q">${escapeHtml(item.question)}</div>
                <div class="tv-side-summary-meta">
                  <span class="tv-side-summary-ans">الإجابة: <strong>${escapeHtml(item.answer)}</strong></span>
                  ${badge}
                </div>
              </div>
            `;
          })
          .join("");
      }
    }

    _renderCharadesSolo(snap) {
      this._showOnlyScreen("charades-solo");
      const cv = snap.charadesSoloView;
      if (!cv) return;

      this.dom.csoloTeamName.textContent = cv.activeTeamName || "الفريق";
      this.dom.csoloRoundPill.textContent = `الجولة ${cv.currentRoundForTeam || 1} / ${cv.roundsPerTeam || 3}`;
      this.dom.csoloScore.textContent = String(cv.activeTeamScore || 0);

      const maxT = Math.max(1, Number(cv.timerMax) || 90);
      const remT = Math.max(0, Number(cv.timerRemaining) || 0);
      const pct = Math.min(100, (remT / maxT) * 100);
      const isDanger = cv.phase === "playing" && remT > 0 && remT <= 10;
      this.dom.csoloTimer.textContent = formatTime(remT);
      this.dom.csoloTimer.classList.toggle("danger", isDanger);
      this.dom.csoloProgress.style.width = `${pct}%`;
      this.dom.csoloProgress.classList.toggle("danger", isDanger);

      if (this.dom.csoloStage && cv.lastFeedback && cv.lastFeedback.ts && cv.lastFeedback.ts !== this._lastCsoloFeedbackTs) {
        this._lastCsoloFeedbackTs = cv.lastFeedback.ts;
        this.dom.csoloStage.classList.remove("flash-correct");
        if (cv.lastFeedback.type === "guessed") {
          void this.dom.csoloStage.offsetWidth;
          this.dom.csoloStage.classList.add("flash-correct");
        }
      }

      this.dom.csoloReadyBox.hidden = cv.phase !== "ready";
      this.dom.csoloPlayBox.hidden = cv.phase !== "playing";
      this.dom.csoloSummaryBox.hidden = cv.phase !== "turn-summary";

      if (cv.phase === "ready") {
        this.dom.csoloReadyTitle.textContent = `دور التمثيل: ${cv.activeTeamName || ""}`;
        this.dom.csoloReadySub.textContent = `مدة الدور ${cv.durationSeconds || 90} ثانية — يظهر هنا التصنيف وعدد الكلمات فقط!`;
        this.dom.csoloStandings.innerHTML = (cv.teams || [])
          .map(
            (t, idx) =>
              `<div class="tv-side-standing-pill team-${idx + 1}-card"><span>${escapeHtml(t.name)}</span><strong>${t.score}</strong></div>`
          )
          .join("");
      } else if (cv.phase === "playing") {
        const hdr = cv.header || { eyebrow: "🎭 من غير كلام", topic: cv.categoryName || "", wordCount: "" };
        this.dom.csoloEyebrow.textContent = hdr.eyebrow || "🎭 من غير كلام";
        this.dom.csoloTopic.textContent = hdr.topic || cv.categoryName || "";
        this.dom.csoloWords.textContent = `🔢 عدد الكلمات: ${hdr.wordCount || ""}`;
        if (cv.hintText) {
          this.dom.csoloHint.textContent = `💡 تلميح للجمهور: ${cv.hintText}`;
          this.dom.csoloHint.hidden = false;
        } else {
          this.dom.csoloHint.textContent = "";
          this.dom.csoloHint.hidden = true;
        }
      } else if (cv.phase === "turn-summary") {
        this.dom.csoloSummaryList.innerHTML = (cv.turnSummary || [])
          .slice(-8)
          .map((item) => {
            const badge =
              item.outcome === "guessed"
                ? `<span class="tv-sum-badge ok">✅ +100</span>`
                : `<span class="tv-sum-badge skip">⏭️ تخطي</span>`;
            return `
              <div class="tv-side-summary-item">
                <div class="tv-side-summary-q">${escapeHtml(item.answer || item.word || "")}</div>
                <div class="tv-side-summary-meta">
                  <span class="tv-side-summary-ans">${escapeHtml(item.topic || item.categoryName || "")}</span>
                  ${badge}
                </div>
              </div>
            `;
          })
          .join("");
      }
    }

    _renderBaraSalfa(snap) {
      this._showOnlyScreen("bara-salfa");
      const bs = snap.baraSalfaView;
      if (!bs || !this.dom.baraStage) return;

      const roster = Array.isArray(bs.playersRoster) ? bs.playersRoster : [];
      const catBadge = bs.categoryName
        ? `<div class="tv-q-cat-pill"><span>${escapeHtml(bs.categoryIcon || "🕵️")}</span><span>${escapeHtml(bs.categoryName)}</span></div>`
        : "";

      let html = "";
      if (bs.phase === "setup") {
        const showQr = Boolean(bs.playMode === "wireless" && bs.roomCode && bs.playerUrl && bs.showQrOnTv && window.SeenJeemQR);
        const qrSvg = showQr
          ? window.SeenJeemQR.toSVG(bs.playerUrl, { size: 220, margin: 3, ariaLabel: `QR غرفة برا السالفة ${bs.roomCode}` })
          : "";
        html = `
          <div class="tv-bara-card">
            <div class="tv-side-mode-tag">🕵️ لعبة برا السالفة</div>
            <h1 class="tv-bara-title">${bs.playMode === "wireless" && bs.roomCode ? "انضم بهاتفك للغرفة الآن!" : "استعدوا لجولة «برا السالفة»!"}</h1>
            ${
              bs.playMode === "wireless" && bs.roomCode
                ? `
                  <div class="tv-bara-lobby-grid">
                    ${showQr ? `<div class="tv-bara-qr-box">${qrSvg}</div>` : ""}
                    <div class="tv-bara-code-box">
                      <span>رمز الغرفة</span>
                      <strong>${escapeHtml(bs.roomCode)}</strong>
                      <small>${bs.joinLocked ? "🔒 الانضمام مقفل" : "امسح QR أو أدخل الرمز"}</small>
                    </div>
                  </div>
                `
                : `<p class="tv-bara-sub">جاري اختيار الفئة وتجهيز اللاعبين على جهاز المقدّم...</p>`
            }
            ${
              roster.length > 0
                ? `<div class="tv-bara-chips">${roster.map((p) => `<span class="tv-bara-chip">👤 ${escapeHtml(p.name)}</span>`).join("")}</div>`
                : ""
            }
          </div>
        `;
      } else if (bs.phase === "role_reveal") {
        const readySet = new Set(bs.readyIds || []);
        html = `
          <div class="tv-bara-card">
            <div class="tv-side-mode-tag">🔐 توزيع الأدوار السرية — الجولة #${bs.roundNumber || 1}</div>
            ${catBadge}
            ${
              bs.playMode === "wireless"
                ? `
                  <h1 class="tv-bara-title">اقرأ دورك السري على هاتفك!</h1>
                  <div class="tv-bara-progress">${readySet.size} / ${roster.length} جاهزين</div>
                  <div class="tv-bara-chips">
                    ${roster.map((p) => `<span class="tv-bara-chip${readySet.has(p.id) ? " is-done" : ""}">${readySet.has(p.id) ? "✅" : "⏳"} ${escapeHtml(p.name)}</span>`).join("")}
                  </div>
                `
                : `
                  <h1 class="tv-bara-title">مرّر الجهاز إلى: <span class="brand-highlight">${escapeHtml(bs.localRevealPlayerName || "اللاعب")}</span></h1>
                  <p class="tv-bara-sub">اللاعب ${(bs.localRevealIndex || 0) + 1} من ${roster.length} — الكلمة سرية تماماً ولا تظهر هنا!</p>
                `
            }
          </div>
        `;
      } else if (bs.phase === "questions" && bs.currentPair) {
        html = `
          <div class="tv-bara-card">
            <div class="tv-side-mode-tag">🎤 جولة الأسئلة #${bs.questionCycle || 1} (${(bs.pairIndex || 0) + 1} / ${bs.totalPairs || 1})</div>
            ${catBadge}
            <div class="tv-bara-pair-hero">
              <div class="tv-bara-pair-box is-asker"><span>السائل</span><strong>${escapeHtml(bs.currentPair.askerName)}</strong></div>
              <div class="tv-bara-pair-arrow">⬅️ يسأل ⬅️</div>
              <div class="tv-bara-pair-box is-target"><span>المُجاب</span><strong>${escapeHtml(bs.currentPair.targetName)}</strong></div>
            </div>
          </div>
        `;
      } else if (bs.phase === "discussion") {
        const isUnl = !bs.discussionTotalSeconds;
        const rem = Math.max(0, Number(bs.discussionRemainingSeconds) || 0);
        html = `
          <div class="tv-bara-card">
            <div class="tv-side-mode-tag">💬 وقت النقاش والاتهام</div>
            ${catBadge}
            <h1 class="tv-bara-title">مين اللي «برا السالفة» برأيكم؟</h1>
            <div class="tv-bara-giant-timer${!isUnl && rem <= 10 ? " danger" : ""}">${isUnl ? "∞" : formatTime(rem)}</div>
          </div>
        `;
      } else if (bs.phase === "voting") {
        const votedSet = new Set(bs.votedIds || []);
        html = `
          <div class="tv-bara-card">
            <div class="tv-side-mode-tag">🗳️ التصويت السري جارٍ الآن</div>
            ${catBadge}
            ${
              bs.playMode === "wireless"
                ? `
                  <h1 class="tv-bara-title">صوّتوا سراً من هواتفكم!</h1>
                  <div class="tv-bara-progress">${votedSet.size} / ${roster.length} صوّتوا</div>
                  <div class="tv-bara-chips">
                    ${roster.map((p) => `<span class="tv-bara-chip${votedSet.has(p.id) ? " is-done" : ""}">${votedSet.has(p.id) ? "✅" : "⏳"} ${escapeHtml(p.name)}</span>`).join("")}
                  </div>
                `
                : `
                  <h1 class="tv-bara-title">دور التصويت السري: <span class="brand-highlight">${escapeHtml(bs.localVoterName || "")}</span></h1>
                  <p class="tv-bara-sub">المصوّت ${(bs.localVoterIndex || 0) + 1} من ${roster.length}</p>
                `
            }
          </div>
        `;
      } else if (bs.phase === "outsider_reveal" && bs.revealData) {
        const rd = bs.revealData;
        const outSet = new Set(rd.outsiderIds || []);
        html = `
          <div class="tv-bara-card">
            <div class="tv-side-mode-tag">🥁 كشف التصويت وهوية المخادع</div>
            <div class="tv-bara-outsider-hero">
              <span>${(rd.outsiderNames || []).length > 1 ? "🕵️ اللي «برا السالفة» هم:" : "🕵️ اللي «برا السالفة» هو:"}</span>
              <strong>${escapeHtml((rd.outsiderNames || []).join("  و  "))}</strong>
            </div>
            <div class="tv-bara-votes-grid">
              ${(rd.voteBreakdown || [])
                .map(
                  (v) => `
                <div class="tv-bara-vote-item${v.targetId && outSet.has(v.targetId) ? " is-hit" : ""}">
                  <strong>${escapeHtml(v.voterName)}</strong> ⬅️ ${escapeHtml(v.targetName)} ${v.targetId && outSet.has(v.targetId) ? "✅" : ""}
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        `;
      } else if (bs.phase === "outsider_guess" && bs.revealData) {
        const rd = bs.revealData;
        const choices = Array.isArray(bs.guessChoices) ? bs.guessChoices : [];
        html = `
          <div class="tv-bara-card">
            <div class="tv-side-mode-tag">🎯 الفرصة الأخيرة لتخمين الكلمة السرية</div>
            ${catBadge}
            <h1 class="tv-bara-title">⏳ بانتظار تخمين: ${escapeHtml((rd.outsiderNames || []).join(" و "))}</h1>
            <div class="tv-bara-choices-grid">
              ${choices.map((w) => `<div class="tv-bara-choice-pill">${escapeHtml(w)}</div>`).join("")}
            </div>
          </div>
        `;
      } else if (bs.phase === "round_results" && bs.revealData) {
        const rd = bs.revealData;
        const standings = rd.standings || [];
        if (this._lastBaraConfettiRound !== bs.roundNumber) {
          this._lastBaraConfettiRound = bs.roundNumber;
          this._triggerConfetti("victory", "default");
        }
        html = `
          <div class="tv-bara-card">
            <div class="tv-side-mode-tag">🏆 نتائج الجولة #${bs.roundNumber || 1}</div>
            <div class="tv-bara-word-reveal">
              <span>الكلمة السرية كانت:</span>
              <strong>${escapeHtml(rd.secretWord || "")}</strong>
            </div>
            <div class="tv-bara-standings">
              ${standings
                .map(
                  (p, idx) => `
                <div class="tv-bara-standing-row${idx === 0 ? " is-first" : ""}">
                  <span>${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`} ${escapeHtml(p.name)}</span>
                  <strong>${p.score} نقطة</strong>
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        `;
      }

      this.dom.baraStage.innerHTML = html;
    }
  }

  window.SeenJeemDisplayView = new TVDisplayController();
})();
