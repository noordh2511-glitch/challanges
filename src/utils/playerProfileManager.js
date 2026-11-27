/**
 * مدير بروفايل اللاعبين الموحّد (Player Profile Manager — Pack 16)
 * - يدعم اللاعب الزائر محلياً واللاعب المسجّل بحساب Google عبر /users/{uid}/profile
 * - بيانات قابلة للتعديل: الاسم المعروض، اللقب، الصورة الرمزية (صورة Google أو 16 أفاتاراً)،
 *   لون الإطار المفضّل، وتفضيلات الثيم والصوت.
 * - لوحة إحصائيات شاملة وأوسمة (Badges) تُفتح تلقائياً عبر جميع الألعاب.
 * - تعبئة تلقائية للاسم والأفاتار عند دخول غرف اللعب بالهواتف.
 */
(function () {
  "use strict";

  const PROFILE_STORAGE_KEY = "seen-jeem-profile-v1";

  const AVATAR_PRESETS = Object.freeze([
    "🎯", "🦁", "🦊", "🐺",
    "🦅", "🐉", "👑", "🎭",
    "🕵️", "🧙", "🚀", "⚡",
    "🎵", "🏆", "🌟", "🦉"
  ]);

  const COLOR_PRESETS = Object.freeze([
    "#22d3ee",
    "#fbbf24",
    "#34d399",
    "#e879f9",
    "#fb7185",
    "#60a5fa",
    "#f97316",
    "#a78bfa"
  ]);

  const TITLE_PRESETS = Object.freeze([
    "اللاعب الذكي",
    "المحقق",
    "ملك السهرة",
    "قناص النقاط",
    "سيد التمويه",
    "بطل المسابقات",
    "نجم الجولة",
    "عاشق التحدي"
  ]);

  function normalizeArabicKey(str) {
    if (typeof str !== "string") return "";
    return str
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .toLowerCase();
  }

  function createDefaultProfile() {
    return {
      displayName: "لاعب جديد",
      title: "اللاعب الذكي",
      avatarType: "emoji", // "emoji" | "google"
      avatarEmoji: "🎯",
      avatarPhotoUrl: "",
      accentColor: "#22d3ee",
      preferredTheme: "dark-glass",
      soundEnabled: true,
      updatedAt: 0
    };
  }

  function sanitizeProfile(raw, fallback = createDefaultProfile()) {
    const src = raw && typeof raw === "object" ? raw : {};
    const validThemes = new Set(["dark-glass", "royal-gold", "high-contrast"]);
    const displayName =
      typeof src.displayName === "string" && src.displayName.trim()
        ? src.displayName.trim().slice(0, 26)
        : fallback.displayName;
    const title =
      typeof src.title === "string" ? src.title.trim().slice(0, 26) : fallback.title;
    const rawEmoji =
      typeof src.avatarEmoji === "string" && src.avatarEmoji.trim()
        ? src.avatarEmoji
        : typeof src.avatar === "string" && src.avatar.trim()
          ? src.avatar
          : "";
    const avatarEmoji = rawEmoji ? rawEmoji.trim().slice(0, 8) : fallback.avatarEmoji;
    const avatarPhotoUrl =
      typeof src.avatarPhotoUrl === "string" && /^https:\/\//i.test(src.avatarPhotoUrl.trim())
        ? src.avatarPhotoUrl.trim()
        : fallback.avatarPhotoUrl;
    const wantsGoogle =
      src.avatarType === "google" || (src.avatarType === undefined && src.useGooglePhoto === true);
    const avatarType = wantsGoogle && avatarPhotoUrl ? "google" : "emoji";
    const accentColor =
      typeof src.accentColor === "string" && /^#[0-9a-f]{3,8}$/i.test(src.accentColor.trim())
        ? src.accentColor.trim()
        : fallback.accentColor;
    const preferredTheme = validThemes.has(src.preferredTheme)
      ? src.preferredTheme
      : fallback.preferredTheme;
    const soundEnabled =
      src.soundEnabled !== undefined ? Boolean(src.soundEnabled) : fallback.soundEnabled;
    const updatedAt = Number.isFinite(Number(src.updatedAt)) ? Number(src.updatedAt) : Date.now();

    return {
      displayName,
      title,
      avatarType,
      avatarEmoji,
      avatarPhotoUrl,
      accentColor,
      preferredTheme,
      soundEnabled,
      updatedAt
    };
  }

  class PlayerProfileManager {
    constructor() {
      this._profile = this._loadLocal();
      this._listeners = new Set();
    }

    _loadLocal() {
      try {
        const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (!raw) return createDefaultProfile();
        return sanitizeProfile(JSON.parse(raw));
      } catch (_err) {
        return createDefaultProfile();
      }
    }

    _saveLocal() {
      try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(this._profile));
      } catch (_err) {}
    }

    onChange(cb) {
      if (typeof cb === "function") this._listeners.add(cb);
      return () => this._listeners.delete(cb);
    }

    _emit() {
      const snap = this.getProfile();
      this._listeners.forEach((cb) => {
        try {
          cb(snap);
        } catch (_err) {}
      });
    }

    getProfile() {
      return { ...this._profile };
    }

    /**
     * تحديث بيانات البروفايل محلياً وجدولة حفظها في حساب اللاعب إن كان مسجّلاً
     */
    updateProfile(patch = {}, { syncRemote = true } = {}) {
      const next = sanitizeProfile(
        {
          ...this._profile,
          ...patch,
          updatedAt: Date.now()
        },
        this._profile
      );
      this._profile = next;
      this._saveLocal();
      this._emit();

      if (syncRemote && window.SeenJeemCloudSync && typeof window.SeenJeemCloudSync.saveUserProfile === "function") {
        window.SeenJeemCloudSync.saveUserProfile(next).catch(() => {});
      }
      return this.getProfile();
    }

    /**
     * تطبيق البروفايل القادم من حساب Google (مع دمج لطيف يحفظ الأحدث)
     */
    mergeRemoteProfile(remoteProfile, googleUser = null) {
      const local = this._profile;
      const gName =
        googleUser && typeof googleUser.displayName === "string" && googleUser.displayName.trim()
          ? googleUser.displayName.trim().slice(0, 26)
          : "";
      const gPhoto =
        googleUser && typeof googleUser.photoURL === "string" && /^https:\/\//i.test(googleUser.photoURL.trim())
          ? googleUser.photoURL.trim()
          : "";

      if (remoteProfile && typeof remoteProfile === "object") {
        const remTs = Number(remoteProfile.updatedAt) || 0;
        const locTs = Number(local.updatedAt) || 0;
        const base = remTs >= locTs ? remoteProfile : local;
        this._profile = sanitizeProfile(
          {
            ...base,
            avatarPhotoUrl: base.avatarPhotoUrl || gPhoto
          },
          local
        );
      } else {
        // أول تسجيل دخول بحساب Google: نعبّئ الاسم وصورة Google افتراضياً إذا كان البروفايل لا يزال افتراضياً
        const isStillDefault = !local.updatedAt || local.displayName === "لاعب جديد";
        this._profile = sanitizeProfile(
          {
            ...local,
            displayName: isStillDefault && gName ? gName : local.displayName,
            avatarPhotoUrl: gPhoto || local.avatarPhotoUrl,
            avatarType: isStillDefault && gPhoto ? "google" : local.avatarType,
            updatedAt: local.updatedAt || Date.now()
          },
          local
        );
      }

      this._saveLocal();
      this._emit();
      return this.getProfile();
    }

    /**
     * هوية التعبئة التلقائية للغرف والألعاب (تُستخدم في ?mode=bara-player و ?mode=mafia-player و ?mode=player)
     */
    getRoomIdentity() {
      const p = this._profile;
      const cleanName =
        p.displayName && p.displayName !== "لاعب جديد" ? p.displayName : "";
      return {
        name: cleanName,
        avatar: p.avatarEmoji || "🎯",
        photoUrl: p.avatarType === "google" ? p.avatarPhotoUrl : "",
        color: p.accentColor || "#22d3ee",
        title: p.title || ""
      };
    }

    /**
     * حساب إحصائيات اللاعب الموحّدة ومستواه والأوسمة عبر جميع الألعاب
     */
    computePlayerStats() {
      const profileId =
        window.SeenJeemHistoryStore && typeof window.SeenJeemHistoryStore.getActiveProfile === "function"
          ? window.SeenJeemHistoryStore.getActiveProfile().id
          : "default";
      const archive = window.SeenJeemArchiveStore;
      const myKey = normalizeArabicKey(this._profile.displayName);

      // 1) إحصائيات سين جيم
      const sjMatches = archive && typeof archive.getForProfile === "function" ? archive.getForProfile(profileId, "all") : [];
      const sjHof = archive && typeof archive.computeHallOfFame === "function" ? archive.computeHallOfFame(profileId) : null;
      const sjTotal = sjMatches.length;
      let sjWins = 0;
      let sjTopScore = (sjHof && sjHof.records && sjHof.records.highestScore && sjHof.records.highestScore.score) || 0;
      sjMatches.forEach((m) => {
        if (!m.isDraw && Array.isArray(m.winnerNames)) {
          if (myKey && m.winnerNames.some((w) => normalizeArabicKey(w) === myKey)) sjWins += 1;
        }
      });

      // 2) إحصائيات برا السالفة
      const baraHof =
        archive && typeof archive.computeBaraSalfaHallOfFame === "function"
          ? archive.computeBaraSalfaHallOfFame(profileId)
          : { totalRounds: 0, leaderboard: [] };
      const myBaraRow = (baraHof.leaderboard || []).find((r) => r.key === myKey) || null;
      const baraRounds = myBaraRow ? myBaraRow.rounds : baraHof.totalRounds;
      const baraDetectRate = myBaraRow
        ? myBaraRow.detectionRate
        : baraHof.records && baraHof.records.topDetective
          ? baraHof.records.topDetective.rate
          : 0;
      const baraGuessRate = myBaraRow
        ? myBaraRow.guessRate
        : baraHof.records && baraHof.records.topInfiltrator
          ? baraHof.records.topInfiltrator.rate
          : 0;
      const baraCorrectVotes = myBaraRow ? myBaraRow.correctVotes : 0;
      const baraCorrectGuesses = myBaraRow ? myBaraRow.correctGuesses : 0;

      // 3) إحصائيات المافيا
      const mafiaHof =
        archive && typeof archive.computeMafiaHallOfFame === "function"
          ? archive.computeMafiaHallOfFame(profileId)
          : { totalSessions: 0, summary: {}, leaderboard: [] };
      const myMafiaRow = (mafiaHof.leaderboard || []).find((r) => r.key === myKey) || null;
      const mafiaSessions = myMafiaRow ? myMafiaRow.sessions : mafiaHof.totalSessions;
      const mafiaWins = myMafiaRow
        ? myMafiaRow.totalWins
        : (mafiaHof.summary ? (mafiaHof.summary.mafiaWins || 0) + (mafiaHof.summary.citizenWins || 0) : 0);
      const mafiaWinRate = myMafiaRow
        ? myMafiaRow.winRate
        : mafiaSessions > 0
          ? Math.round((mafiaWins / mafiaSessions) * 100)
          : 0;

      // 4) إحصائيات تحدي الصوت
      let audioClipsPlayed = 0;
      try {
        const rawAudioHist = localStorage.getItem("audio-challenge-history-v1");
        if (rawAudioHist) {
          const arr = JSON.parse(rawAudioHist);
          if (Array.isArray(arr)) audioClipsPlayed = arr.length;
        }
      } catch (_err) {}

      // 5) إحصائيات تحدي الكل
      const qrHof =
        archive && typeof archive.computeQuizRaceHallOfFame === "function"
          ? archive.computeQuizRaceHallOfFame(profileId)
          : { totalRaces: 0, leaderboard: [] };
      const myQrRow = (qrHof.leaderboard || []).find((r) => r.key === myKey) || null;
      const qrRaces = myQrRow ? myQrRow.races : qrHof.totalRaces;
      const qrWins = myQrRow ? myQrRow.wins : 0;
      const qrTopScore = myQrRow ? myQrRow.bestScore : (qrHof.records && qrHof.records.highestScore ? qrHof.records.highestScore.score : 0);

      const totalSessions =
        sjTotal +
        baraHof.totalRounds +
        mafiaHof.totalSessions +
        qrHof.totalRaces +
        (audioClipsPlayed > 0 ? Math.ceil(audioClipsPlayed / 5) : 0);
      const totalWins = sjWins + (myMafiaRow ? myMafiaRow.totalWins : 0) + baraCorrectVotes + qrWins;

      // حساب المستوى (يتصاعد كل 3 جلسات)
      const level = Math.max(1, Math.floor(totalSessions / 3) + 1);
      const progressIntoLevel = totalSessions % 3;
      const progressPct = Math.round((progressIntoLevel / 3) * 100);
      const levelNames = [
        "مبتدئ السهرات",
        "لاعب نشيط",
        "منافس قوي",
        "خبير التحديات",
        "نجم المجالس",
        "أسطورة سين جيم"
      ];
      const levelTitle = levelNames[Math.min(levelNames.length - 1, level - 1)];

      // الأوسمة (Badges)
      const badges = [
        {
          id: "strong-start",
          icon: "🎯",
          name: "بداية قوية",
          desc: "أكمل أول جلسة لعب",
          unlocked: totalSessions >= 1
        },
        {
          id: "hawk-eye",
          icon: "🔍",
          name: "عين الصقر",
          desc: "اكشف المتسلّل في برا السالفة أو المافيا",
          unlocked:
            baraCorrectVotes >= 1 ||
            baraDetectRate >= 50 ||
            (mafiaHof.summary && (mafiaHof.summary.detectiveHits || 0) >= 1)
        },
        {
          id: "master-disguise",
          icon: "🎭",
          name: "سيد التمويه",
          desc: "خمّن الكلمة كمتسلّل أو فُز كأحد أفراد المافيا",
          unlocked:
            baraCorrectGuesses >= 1 ||
            (myMafiaRow && myMafiaRow.mafiaWins >= 1) ||
            (mafiaHof.summary && (mafiaHof.summary.mafiaWins || 0) >= 1)
        },
        {
          id: "night-champion",
          icon: "🏆",
          name: "بطل السهرات",
          desc: "حقّق 3 انتصارات أو أكثر",
          unlocked: totalWins >= 3 || sjTotal >= 3
        },
        {
          id: "golden-ear",
          icon: "🎵",
          name: "أذن موسيقية",
          desc: "خض تحدي 5 مقاطع صوتية",
          unlocked: audioClipsPlayed >= 5
        },
        {
          id: "veteran",
          icon: "⭐",
          name: "لاعب مخضرم",
          desc: "أكمل 10 جلسات لعب",
          unlocked: totalSessions >= 10
        }
      ];

      return {
        totalSessions,
        totalWins,
        level,
        levelTitle,
        progressPct,
        nextLevelRemaining: 3 - progressIntoLevel,
        games: {
          seenJeem: { matches: sjTotal, wins: sjWins, topScore: sjTopScore },
          baraSalfa: { rounds: baraRounds, detectRate: baraDetectRate, guessRate: baraGuessRate },
          mafia: { sessions: mafiaSessions, winRate: mafiaWinRate },
          audioChallenge: { clipsPlayed: audioClipsPlayed },
          quizRace: { races: qrRaces, wins: qrWins, topScore: qrTopScore }
        },
        badges
      };
    }
  }

  window.SeenJeemProfile = new PlayerProfileManager();
  window.SeenJeemProfileUtils = {
    PROFILE_STORAGE_KEY,
    AVATAR_PRESETS,
    COLOR_PRESETS,
    TITLE_PRESETS,
    createDefaultProfile,
    sanitizeProfile
  };
})();
