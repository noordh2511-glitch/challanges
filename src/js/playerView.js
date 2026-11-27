/**
 * واجهة «هاتف الفريق — جرس السرعة والرهان السري» (Player Mobile UI — ?mode=player)
 * - خفيفة جداً ومصممة لهواتف الفرق بـ RTL بدون تمرير أفقي
 * - معزولة تماماً عن عقدة media/ في Firebase (لا تنزّل أي صور ثقيلة إطلاقاً)
 * - تتبّع الحضور الحي (Presence) بـ deviceId محفوظ في sessionStorage + اسم جهاز اختياري + onDisconnect().remove()
 * - احترام قفل الانضمام للغرفة (joinLocked) وحدّ الأجهزة لكل فريق (maxDevicesPerTeam) مع استمرار الأجهزة المسجّلة مسبقاً عند التحديث
 * - الاستماع الفوري لـ kicked/{deviceId} لفصل الجهاز ومنع الجرس والرهان عند الطرد
 * - عدّاد وقت محلي سلس مبني على الطوابع الزمنية (endAtMs + serverTimeOffset) دون كتابة كل ثانية
 */
(function () {
  "use strict";

  const LABEL_STORAGE_KEY = "seen_jeem_player_label_v1";

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

  class PlayerMobileController {
    constructor() {
      this.root = null;
      this.roomCode = "";
      this.connected = false;
      this.publicState = null;
      this.playersMap = {};
      this.selectedTeamIdx = null;
      this.deviceLabel =
        this._loadSavedLabel() ||
        (window.SeenJeemProfile && window.SeenJeemProfile.getRoomIdentity().name) ||
        "";
      this.preApproved = false;
      this.hasJoinedThisRoom = false;
      this.kicked = false;
      this.errorMessage = "";
      this.lastBuzzSentRoundId = "";
      this.lastWinnerVibratedRoundId = "";
      this.wagerAmount = 0;
      this.wagerSentRoundKey = "";
      this.answerSentRoundKey = "";
      this.allPlayDraft = "";
      this.allPlaySentQId = "";
      this.allPlaySentText = "";
      this._registeredPresenceKey = "";
      this._localTimerInterval = null;
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
        if (code) sessionStorage.removeItem(this._teamStorageKey(code));
      } catch (_e) {}
    }

    _loadSavedLabel() {
      try {
        return (sessionStorage.getItem(LABEL_STORAGE_KEY) || "").trim().slice(0, 24);
      } catch (_e) {
        return "";
      }
    }

    _saveLabel(val) {
      const clean = String(val || "").trim().slice(0, 24);
      this.deviceLabel = clean;
      try {
        if (clean) sessionStorage.setItem(LABEL_STORAGE_KEY, clean);
        else sessionStorage.removeItem(LABEL_STORAGE_KEY);
      } catch (_e) {}
    }

    _getEffectiveDeviceLabel() {
      if (this.deviceLabel && this.deviceLabel.trim()) return this.deviceLabel.trim().slice(0, 24);
      const count = Object.keys(this.playersMap || {}).length;
      const fallback = `جهاز ${count + 1}`;
      this._saveLabel(fallback);
      return fallback;
    }

    _isRoomJoinLocked() {
      return Boolean(this.publicState && this.publicState.wireless && this.publicState.wireless.joinLocked);
    }

    _getMaxDevicesPerTeam() {
      return this.publicState &&
        this.publicState.wireless &&
        Number(this.publicState.wireless.maxDevicesPerTeam) === 1
        ? 1
        : 0;
    }

    _isAlreadyRegisteredInRoom() {
      const rt = window.SeenJeemRealtimeSync;
      const myId = rt ? rt.deviceId : "";
      if (this.hasJoinedThisRoom || this.preApproved) return true;
      if (myId && this.playersMap && this.playersMap[myId]) return true;
      return false;
    }

    _countOtherDevicesOnTeam(teamIdx) {
      const rt = window.SeenJeemRealtimeSync;
      const myId = rt ? rt.deviceId : "";
      return Object.entries(this.playersMap || {}).filter(([devId, info]) => {
        const id = (info && info.deviceId) || devId;
        if (id === myId) return false;
        return info && Number(info.teamIdx) === Number(teamIdx);
      }).length;
    }

    _stopLocalTimerLoop() {
      if (this._localTimerInterval) {
        clearInterval(this._localTimerInterval);
        this._localTimerInterval = null;
      }
    }

    _getActiveTimerDescriptor(pub) {
      if (!pub || typeof pub !== "object") return null;
      if (pub.intermission && pub.intermission.active && pub.intermission.timer) {
        return { timer: pub.intermission.timer, fallback: pub.intermission.remainingSeconds, label: "☕ الاستراحة" };
      }
      if (pub.screen === "question" && pub.questionView) {
        if (pub.questionView.visualType === "memory" && pub.questionView.memoryPhase === "viewing" && pub.questionView.memoryTimer) {
          return { timer: pub.questionView.memoryTimer, fallback: pub.questionView.memoryRemaining, label: "🧠 المعاينة" };
        }
        return { timer: pub.questionView.timer, fallback: pub.questionView.timerRemaining, label: "⏱️ الوقت" };
      }
      if (pub.screen === "final" && pub.finalRoundView && pub.finalRoundView.phase === "question") {
        return { timer: pub.finalRoundView.timer, fallback: pub.finalRoundView.timerRemaining, label: "⚔️ الحسم" };
      }
      if (pub.screen === "blitz" && pub.blitzView && pub.blitzView.phase === "playing") {
        return { timer: pub.blitzView.timer, fallback: pub.blitzView.timerRemaining, label: "⚡ البرق" };
      }
      if (pub.screen === "charades-solo" && pub.charadesSoloView && pub.charadesSoloView.phase === "playing") {
        return { timer: pub.charadesSoloView.timer, fallback: pub.charadesSoloView.timerRemaining, label: "🎭 التمثيل" };
      }
      return null;
    }

    _formatLiveTimerText(info) {
      if (!info) return "";
      const utils = window.SeenJeemRealtimeUtils;
      const rt = window.SeenJeemRealtimeSync;
      const offsetMs = rt && typeof rt.getServerTimeOffsetMs === "function" ? rt.getServerTimeOffsetMs() : 0;
      const secs =
        utils && typeof utils.computeTimerRemainingSeconds === "function"
          ? utils.computeTimerRemainingSeconds(info.timer, info.fallback, offsetMs)
          : Number(info.fallback) || 0;
      if (secs === null) return `${info.label}: ∞`;
      return `${info.label}: ${formatTime(secs)}`;
    }

    _syncLocalTimerLoop() {
      const info = this._getActiveTimerDescriptor(this.publicState);
      const isRunning = Boolean(info && info.timer && info.timer.status === "running" && Number.isFinite(info.timer.endAtMs));
      if (!isRunning) {
        this._stopLocalTimerLoop();
        return;
      }
      if (this._localTimerInterval) return;
      this._localTimerInterval = setInterval(() => {
        const curInfo = this._getActiveTimerDescriptor(this.publicState);
        const el = document.getElementById("pl-live-timer");
        if (!curInfo || !curInfo.timer || curInfo.timer.status !== "running") {
          this._stopLocalTimerLoop();
          return;
        }
        if (el) {
          el.textContent = this._formatLiveTimerText(curInfo);
        }
      }, 250);
    }

    _handleKicked() {
      this._stopLocalTimerLoop();
      this.kicked = true;
      this.connected = false;
      this.hasJoinedThisRoom = false;
      this.preApproved = false;
      this.selectedTeamIdx = null;
      this.publicState = null;
      this.playersMap = {};
      this._registeredPresenceKey = "";
      this._clearSavedTeamIdx(this.roomCode);
      if (navigator.vibrate) {
        try { navigator.vibrate([120, 60, 120]); } catch (_e) {}
      }
      this._render();
    }

    async _connectToRoom(code) {
      const clean = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (!clean) return;
      if (this.kicked && clean === this.roomCode) {
        this._render();
        return;
      }
      this.kicked = false;
      this.roomCode = clean;
      this.preApproved = false;
      this.hasJoinedThisRoom = false;
      this._registeredPresenceKey = "";
      const savedTeam = this._loadSavedTeamIdx(clean);
      if (savedTeam !== null) this.selectedTeamIdx = savedTeam;

      const rt = window.SeenJeemRealtimeSync;
      if (!rt || !rt.isConfigured()) {
        this.errorMessage = "تعذّر الاتصال بغرفة اللعب حالياً — تأكد من الإنترنت وحاول مجدداً.";
        this._render();
        return;
      }

      this.errorMessage = "";
      this._render();

      try {
        await rt.connectAsPlayer({
          roomCode: clean,
          onKicked: () => this._handleKicked(),
          onPlayers: (playersMap) => {
            this.playersMap = playersMap && typeof playersMap === "object" ? playersMap : {};
            if (rt.deviceId && this.playersMap[rt.deviceId]) {
              this.hasJoinedThisRoom = true;
            }
            // إعادة الرسم فقط على شاشة الانضمام لتحديث حالة حد الأجهزة لكل فريق دون مقاطعة الإدخال
            if (this.selectedTeamIdx === null) {
              this._render();
            }
          },
          onPublicState: async (pub) => {
            if (this.kicked) return;
            this.publicState = pub;
            if (!pub) {
              this._stopLocalTimerLoop();
              this._render();
              return;
            }
            if (this.selectedTeamIdx !== null && Array.isArray(pub.teams)) {
              if (!pub.teams[this.selectedTeamIdx]) {
                this.selectedTeamIdx = null;
              } else {
                const label = this._getEffectiveDeviceLabel();
                const regKey = `${this.roomCode}:${this.selectedTeamIdx}:${label}`;
                if (this._registeredPresenceKey !== regKey) {
                  const res = await rt.registerPlayerPresence(
                    this.selectedTeamIdx,
                    pub.teams[this.selectedTeamIdx].name,
                    label
                  );
                  if (res && res.ok) {
                    this._registeredPresenceKey = regKey;
                    this.hasJoinedThisRoom = true;
                    this.errorMessage = "";
                  } else if (res && res.locked) {
                    this.selectedTeamIdx = null;
                    this._clearSavedTeamIdx(this.roomCode);
                    this.errorMessage = "🔒 الغرفة مقفلة حالياً من قِبل المقدّم";
                  }
                }
              }
            }
            this._triggerWinnerVibrationIfNeeded(pub);
            this._render();
            this._syncLocalTimerLoop();
          },
          onConnectionState: (isConn) => {
            this.connected = isConn;
            if (!this.kicked) this._render();
          },
          onError: (err) => {
            this.errorMessage = (err && err.message) || "تعذّر الانضمام للغرفة — تأكد من صحة الرمز.";
            this._render();
          }
        });

        // فحص ما إذا كان هذا الجهاز معتمداً مسبقاً (للاستمرار بسلاسة بعد F5 أثناء قفل الغرفة)
        this.preApproved = await rt.isCurrentDevicePreApproved();
        if (!this.kicked) this._render();
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

    async _selectTeam(idx) {
      if (this.kicked) return;
      const rt = window.SeenJeemRealtimeSync;
      const pub = this.publicState;
      const teams = (pub && pub.teams) || [];
      const team = teams[idx];
      if (!rt || !team) return;

      // فحص قفل الانضمام للأجهزة الجديدة
      if (this._isRoomJoinLocked() && !this._isAlreadyRegisteredInRoom()) {
        this.errorMessage = "🔒 الغرفة مقفلة حالياً من قِبل المقدّم";
        this._render();
        return;
      }

      // فحص حد الأجهزة لكل فريق (1 جهاز لكل فريق)
      if (this._getMaxDevicesPerTeam() === 1 && this._countOtherDevicesOnTeam(idx) >= 1) {
        this.errorMessage = "الفريق مكتمل — جهاز متصل حالياً";
        this._render();
        return;
      }

      const labelInp = document.getElementById("pl-device-label-input");
      if (labelInp && labelInp.value.trim()) {
        this._saveLabel(labelInp.value);
      }
      const label = this._getEffectiveDeviceLabel();

      const res = await rt.registerPlayerPresence(idx, team.name, label);
      if (!res || !res.ok) {
        this.errorMessage = (res && res.error) || "🔒 الغرفة مقفلة حالياً من قِبل المقدّم";
        this._render();
        return;
      }

      this.selectedTeamIdx = idx;
      this.hasJoinedThisRoom = true;
      this.errorMessage = "";
      this._registeredPresenceKey = `${this.roomCode}:${idx}:${label}`;
      if (this.roomCode) this._saveTeamIdx(this.roomCode, idx);
      if (navigator.vibrate) {
        try { navigator.vibrate(30); } catch (_e) {}
      }
      this._render();
      this._syncLocalTimerLoop();
    }

    async _pressBuzzer() {
      if (this.kicked) return;
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
      if (this.kicked) return;
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
      if (this.kicked) return;
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

    async _submitAllPlayAnswer(rawText) {
      if (this.kicked) return;
      const ap = this.publicState && this.publicState.allPlay;
      if (!ap || !ap.active || ap.phase !== "open" || !ap.questionId || this.selectedTeamIdx === null) return;
      const clean = String(rawText || "").trim().slice(0, 140);
      if (!clean) {
        this.errorMessage = "يرجى كتابة إجابة أولاً.";
        this._render();
        return;
      }
      const res = await window.SeenJeemRealtimeSync.sendAllPlayAnswer(ap.questionId, this.selectedTeamIdx, clean);
      if (res && res.ok) {
        this.allPlaySentQId = ap.questionId;
        this.allPlaySentText = clean;
        this.allPlayDraft = clean;
        this.errorMessage = "";
        if (navigator.vibrate) {
          try { navigator.vibrate(45); } catch (_e) {}
        }
        this._render();
      } else {
        this.errorMessage = (res && res.error) || "تعذّر إرسال الإجابة";
        this._render();
      }
    }

    _render() {
      if (!this.root) return;

      // 0) شاشة الطرد الفوري عند إخراج الجهاز من الغرفة
      if (this.kicked) {
        this.root.innerHTML = `
          <div class="pl-shell pl-join-shell">
            <header class="pl-join-hero">
              <div class="brand-badge"><span class="brand-dot"></span> جرس الفرق والرهان السري</div>
              <h1 class="pl-brand-title"><span class="brand-highlight">سين</span> جيم</h1>
            </header>
            <section class="pl-card pl-kicked-card">
              <div class="pl-kicked-icon" aria-hidden="true">🚫</div>
              <h2 class="pl-kicked-title">تم إخراج هذا الجهاز من الغرفة بواسطة المقدّم</h2>
              <p class="pl-sub-note">تم فصل الاتصال ومنع إرسال الجرس أو الرهان لهذه الغرفة. يمكنك التواصل مع المقدّم أو الانضمام إلى غرفة أخرى.</p>
            </section>
          </div>
        `;
        return;
      }

      const pub = this.publicState;
      const teams = (pub && Array.isArray(pub.teams) && pub.teams) || [];
      const joinLocked = this._isRoomJoinLocked();
      const alreadyRegistered = this._isAlreadyRegisteredInRoom();
      const blockedByLock = Boolean(pub && joinLocked && !alreadyRegistered);
      const maxPerTeam = this._getMaxDevicesPerTeam();

      // 1) شاشة الانضمام للغرفة (إدخال الرمز + اسم الجهاز الاختياري + اختيار الفريق)
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
              <label for="pl-device-label-input" class="pl-label">اسم جهازك (اختياري — يظهر للمقدّم فقط):</label>
              <input
                type="text"
                id="pl-device-label-input"
                class="pl-room-input pl-label-input"
                maxlength="24"
                value="${escapeHtml(this.deviceLabel)}"
                placeholder="مثال: هاتف أحمد (أو اتركه للتسمية التلقائية)"
                autocomplete="off"
              />
              ${
                blockedByLock
                  ? `<div class="pl-locked-banner" role="alert">🔒 الغرفة مقفلة حالياً من قِبل المقدّم</div>`
                  : ""
              }
              ${this.errorMessage ? `<p class="pl-error-note">⚠️ ${escapeHtml(this.errorMessage)}</p>` : ""}
            </section>

            <section class="pl-card">
              <h2 class="pl-section-title">👥 اختر فريقك</h2>
              <p class="pl-sub-note">${
                blockedByLock
                  ? "لا يمكن انضمام أجهزة جديدة بينما الغرفة مقفلة."
                  : pub
                    ? "اضغط على بطاقة فريقك للدخول إلى الجرس المباشر:"
                    : "بعد الاتصال بالغرفة ستظهر فرق المباراة الحالية هنا لاختيار فريقك."
              }</p>
              <div class="pl-team-grid">
                ${defaultTeams
                  .map((t, idx) => {
                    const otherCount = pub ? this._countOtherDevicesOnTeam(idx) : 0;
                    const isFull = Boolean(pub && maxPerTeam === 1 && otherCount >= 1);
                    const isDisabled = !pub || blockedByLock || isFull;
                    return `
                      <button
                        type="button"
                        class="pl-team-pick-card team-${idx + 1}${isFull ? " is-team-full" : ""}"
                        data-pick-team="${idx}"
                        ${isDisabled ? "disabled" : ""}
                      >
                        <span class="team-badge-dot team-${idx + 1}-dot"></span>
                        <strong class="pl-team-pick-name">${escapeHtml(t.name)}</strong>
                        <span class="pl-team-pick-score">${Number(t.score) || 0} نقطة</span>
                        ${isFull ? `<span class="pl-team-cap-note">الفريق مكتمل — جهاز متصل حالياً</span>` : ""}
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          </div>
        `;

        const joinBtn = document.getElementById("pl-btn-join");
        const roomInp = document.getElementById("pl-room-input");
        const labelInp = document.getElementById("pl-device-label-input");
        if (labelInp) {
          labelInp.addEventListener("input", () => this._saveLabel(labelInp.value));
        }
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

      // 2.5) وضع «الكل يجاوب» (All-Play) أثناء السؤال
      const ap = pub.screen === "question" && pub.allPlay && pub.allPlay.active ? pub.allPlay : null;
      if (ap && (ap.phase === "open" || ap.phase === "revealed")) {
        if (this.allPlaySentQId && this.allPlaySentQId !== ap.questionId) {
          this.allPlayDraft = "";
          this.allPlaySentQId = "";
          this.allPlaySentText = "";
        }
        const alreadySent = this.allPlaySentQId === ap.questionId;
        const qv = pub.questionView || {};
        const apBody =
          ap.phase === "open"
            ? `
              <section class="pl-card pl-wager-card">
                <div class="final-eyebrow">📝 إجابة جماعية — الكل يجاوب!</div>
                ${qv.questionText ? `<p class="pl-final-q">${escapeHtml(qv.questionText)}</p>` : ""}
                <label for="pl-allplay-input" class="pl-label">اكتب إجابة فريقك (يمكنك التعديل قبل إغلاق الباب):</label>
                <input
                  type="text"
                  id="pl-allplay-input"
                  class="pl-room-input pl-answer-input"
                  maxlength="140"
                  value="${escapeHtml(this.allPlayDraft)}"
                  placeholder="اكتب إجابتك هنا..."
                  autocomplete="off"
                />
                ${this.errorMessage ? `<p class="pl-error-note">⚠️ ${escapeHtml(this.errorMessage)}</p>` : ""}
                <button type="button" id="pl-btn-send-allplay" class="btn ${alreadySent ? "btn-steal-win" : "btn-primary"} pl-touch-btn pl-full-btn">
                  ${alreadySent ? "✅ تم الإرسال — اضغط لتعديل إجابتك" : "📤 إرسال الإجابة"}
                </button>
              </section>
            `
            : `
              <section class="pl-card pl-wager-card">
                <div class="final-eyebrow">🔒 تم إغلاق الإجابات وكشفها</div>
                <h2 class="pl-wager-title">تابع التحكيم على شاشة التلفزيون!</h2>
                ${
                  alreadySent
                    ? `<p class="pl-sub-note">إجابة فريقك المرسلة: <strong>${escapeHtml(this.allPlaySentText)}</strong></p>`
                    : `<p class="pl-sub-note">لم يُرسل فريقك إجابة في هذا السؤال.</p>`
                }
              </section>
            `;

        this.root.innerHTML = this._wrapPlayerChrome(team, teamNum, apBody);
        this._bindChromeEvents();
        const inp = document.getElementById("pl-allplay-input");
        const sendBtn = document.getElementById("pl-btn-send-allplay");
        if (inp) {
          inp.addEventListener("input", () => {
            this.allPlayDraft = inp.value;
          });
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._submitAllPlayAnswer(inp.value);
          });
        }
        if (sendBtn && inp) {
          sendBtn.addEventListener("click", () => this._submitAllPlayAnswer(inp.value));
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
      const timerInfo = this._getActiveTimerDescriptor(this.publicState);
      const timerPill = timerInfo
        ? `<div class="pl-timer-strip"><span id="pl-live-timer" class="pl-timer-pill">${escapeHtml(this._formatLiveTimerText(timerInfo))}</span></div>`
        : "";
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
          ${timerPill}
          <main class="pl-main">${bodyHtml}</main>
        </div>
      `;
    }

    _bindChromeEvents() {
      const changeBtn = document.getElementById("pl-btn-change-team");
      if (changeBtn) {
        changeBtn.addEventListener("click", () => {
          this.selectedTeamIdx = null;
          this._registeredPresenceKey = "";
          if (this.roomCode) this._clearSavedTeamIdx(this.roomCode);
          this._render();
        });
      }
    }
  }

  window.SeenJeemPlayerView = new PlayerMobileController();
})();
