/**
 * مدير المزامنة السحابية لحساب المقدّم عبر Firebase Google Auth (Pack 13)
 * - اختياري 100%: يعمل التطبيق محلياً وأوفلاين بالكامل دون تسجيل دخول (صفر طلبات شبكة).
 * - يشارك نفس نسخة Firebase App للمقدّم (`seen-jeem-host-<projectId>`) مع realtimeSync و baraSalfaSync
 *   لمنع أي تعارض بين GoogleAuthProvider و signInAnonymously.
 * - يرفع البيانات النصية الخفيفة فقط إلى /users/{uid}/cloudData ولا يرفع أبداً صور أو صوتيات IndexedDB.
 * - محرك دمج ذكي (Smart Cloud Merge) + مزامنة تلقائية بمهلة تجميع 5 ثوانٍ مع Shallow Diffing.
 */
(function () {
  "use strict";

  const FIREBASE_SDK_VER = "10.14.1";
  const SIGNED_IN_HINT_KEY = "seen_jeem_cloud_signed_in_hint_v1";
  const LAST_SYNC_META_KEY = "seen_jeem_cloud_meta_v1";
  const DEBOUNCE_MS = 5000;
  const MAX_ARCHIVE_PER_PROFILE = 50;

  const LOCAL_KEYS = Object.freeze({
    HISTORY: "seen_jeem_history_store_v1",
    ARCHIVE: "seen-jeem-archive-v1",
    BARA_STATS: "bara-salfa-stats-v1",
    BARA_HISTORY: "bara-salfa-history-v1",
    BARA_CUSTOM: "bara-salfa-custom-v1",
    MAFIA_STATS: "mafia-stats-v1",
    QUIZ_RACE_STATS: "quiz-race-stats-v1",
    AUDIO_CHALLENGE_HISTORY: "audio-challenge-history-v1",
    FAVORITE_CATEGORIES: "seen-jeem-favorites-v1",
    FLAGGED: "seen-jeem-flagged-v1",
    TOURNAMENT: "seen-jeem-tournament-v1",
    THEME: "seen_jeem_theme_v1",
    TV_SCALE: "seen_jeem_tv_scale_v1",
    SHEET_REPORT_CFG: "seen_jeem_sheet_report_cfg_v1"
  });

  function sanitizeKey(raw) {
    return (
      String(raw || "default")
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 48) || "default"
    );
  }

  function safeReadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_err) {
      return fallback;
    }
  }

  function safeWriteJSON(key, val) {
    try {
      if (val === null || val === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(val));
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  function stripUndefinedAndHeavyMedia(val) {
    if (val === undefined) return null;
    if (typeof val === "string") {
      // حماية حصة Spark: منع أي DataURL ثقيل للصور أو الصوتيات من دخول الحمولة السحابية
      if (/^data:(image|audio|video)\//i.test(val.trim())) return null;
      return val;
    }
    if (val === null || typeof val !== "object") return val;
    if (Array.isArray(val)) return val.map(stripUndefinedAndHeavyMedia);
    const out = {};
    Object.keys(val).forEach((k) => {
      if (val[k] !== undefined) {
        out[k] = stripUndefinedAndHeavyMedia(val[k]);
      }
    });
    return out;
  }

  function collectLocalCloudData() {
    const historyStore = safeReadJSON(LOCAL_KEYS.HISTORY, null);
    const matchArchive =
      window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.getAll === "function"
        ? window.SeenJeemArchiveStore.getAll()
        : safeReadJSON(LOCAL_KEYS.ARCHIVE, []);
    const baraSalfaStats =
      window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.getAllBaraSalfaRounds === "function"
        ? window.SeenJeemArchiveStore.getAllBaraSalfaRounds()
        : safeReadJSON(LOCAL_KEYS.BARA_STATS, []);
    const mafiaStats =
      window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.getAllMafiaSessions === "function"
        ? window.SeenJeemArchiveStore.getAllMafiaSessions()
        : safeReadJSON(LOCAL_KEYS.MAFIA_STATS, []);
    const quizRaceStats =
      window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.getAllQuizRaceSessions === "function"
        ? window.SeenJeemArchiveStore.getAllQuizRaceSessions()
        : safeReadJSON(LOCAL_KEYS.QUIZ_RACE_STATS, []);
    const baraSalfaHistory = safeReadJSON(LOCAL_KEYS.BARA_HISTORY, {});
    const baraSalfaCustom = safeReadJSON(LOCAL_KEYS.BARA_CUSTOM, []);
    const audioChallengeHistory = safeReadJSON(LOCAL_KEYS.AUDIO_CHALLENGE_HISTORY, []);
    const favoriteCategories =
      window.SeenJeemCategoryBrowser && typeof window.SeenJeemCategoryBrowser.loadFavorites === "function"
        ? window.SeenJeemCategoryBrowser.loadFavorites()
        : safeReadJSON(LOCAL_KEYS.FAVORITE_CATEGORIES, []);
    const flaggedQuestions =
      window.SeenJeemFlaggedStore && typeof window.SeenJeemFlaggedStore.getAll === "function"
        ? window.SeenJeemFlaggedStore.getAll()
        : safeReadJSON(LOCAL_KEYS.FLAGGED, []);
    const activeTournament = safeReadJSON(LOCAL_KEYS.TOURNAMENT, null);
    const sheetReportCfg = safeReadJSON(LOCAL_KEYS.SHEET_REPORT_CFG, { webhookUrl: "", secret: "" });

    const theme = localStorage.getItem(LOCAL_KEYS.THEME) || "dark-glass";
    const tvScale = Number(localStorage.getItem(LOCAL_KEYS.TV_SCALE)) || 100;
    const activeProfileId =
      (historyStore && typeof historyStore.activeProfileId === "string" && historyStore.activeProfileId) ||
      "default";

    // ملحوظة مهمة: لا نضمّن customPacksStore (IndexedDB) هنا مطلقاً حمايةً لحصة Spark!
    return stripUndefinedAndHeavyMedia({
      schemaVersion: 1,
      updatedAt: Date.now(),
      historyStore,
      matchArchive: Array.isArray(matchArchive) ? matchArchive : [],
      baraSalfaStats: Array.isArray(baraSalfaStats) ? baraSalfaStats : [],
      mafiaStats: Array.isArray(mafiaStats) ? mafiaStats : [],
      quizRaceStats: Array.isArray(quizRaceStats) ? quizRaceStats : [],
      audioChallengeHistory: Array.isArray(audioChallengeHistory)
        ? audioChallengeHistory.filter((x) => typeof x === "string" && x.trim())
        : [],
      favoriteCategories: Array.isArray(favoriteCategories)
        ? Array.from(new Set(favoriteCategories.filter((x) => typeof x === "string" && x.trim())))
        : [],
      baraSalfaHistory:
        baraSalfaHistory && typeof baraSalfaHistory === "object" && !Array.isArray(baraSalfaHistory)
          ? baraSalfaHistory
          : {},
      baraSalfaCustom: Array.isArray(baraSalfaCustom) ? baraSalfaCustom : [],
      flaggedQuestions: Array.isArray(flaggedQuestions) ? flaggedQuestions : [],
      activeTournament: activeTournament && typeof activeTournament === "object" ? activeTournament : null,
      preferences: {
        theme,
        tvScale,
        activeProfileId,
        sheetReportWebhookUrl:
          sheetReportCfg && typeof sheetReportCfg.webhookUrl === "string" ? sheetReportCfg.webhookUrl : "",
        sheetReportSecret:
          sheetReportCfg && typeof sheetReportCfg.secret === "string" ? sheetReportCfg.secret : ""
      }
    });
  }

  /* =========================================================
     محرك الدمج الذكي (Smart Cloud Merge) — نقي وقابل للاختبار
     ========================================================= */
  function mergeHistoryStores(localH, cloudH) {
    if (!localH || !Array.isArray(localH.profiles)) return cloudH || null;
    if (!cloudH || !Array.isArray(cloudH.profiles)) return localH;

    const byId = new Map();
    const ingest = (list) => {
      list.forEach((p) => {
        if (!p || !p.id) return;
        const cur = byId.get(p.id);
        const ids = Array.isArray(p.playedQuestionIds) ? p.playedQuestionIds : [];
        const tsMap = p.lastPlayedAt && typeof p.lastPlayedAt === "object" ? p.lastPlayedAt : {};
        if (!cur) {
          byId.set(p.id, {
            ...p,
            playedQuestionIds: Array.from(new Set(ids.filter((x) => typeof x === "string" && x.trim()))),
            lastPlayedAt: { ...tsMap }
          });
          return;
        }
        const idSet = new Set(cur.playedQuestionIds);
        ids.forEach((qId) => {
          if (typeof qId !== "string" || !qId.trim()) return;
          const cleanId = qId.trim();
          if (!idSet.has(cleanId)) {
            idSet.add(cleanId);
            cur.playedQuestionIds.push(cleanId);
          }
          const tA = Number(cur.lastPlayedAt[cleanId]) || 0;
          const tB = Number(tsMap[cleanId]) || 0;
          cur.lastPlayedAt[cleanId] = Math.max(tA, tB, 1);
        });
        Object.keys(tsMap).forEach((qId) => {
          const tA = Number(cur.lastPlayedAt[qId]) || 0;
          const tB = Number(tsMap[qId]) || 0;
          if (tB > tA) cur.lastPlayedAt[qId] = tB;
          if (!idSet.has(qId)) {
            idSet.add(qId);
            cur.playedQuestionIds.push(qId);
          }
        });
      });
    };

    ingest(cloudH.profiles);
    ingest(localH.profiles);

    return {
      schemaVersion: 1,
      activeProfileId: localH.activeProfileId || cloudH.activeProfileId || "default",
      profiles: Array.from(byId.values())
    };
  }

  function mergeMatchArchiveLists(localList, cloudList) {
    const byId = new Map();
    [...(Array.isArray(cloudList) ? cloudList : []), ...(Array.isArray(localList) ? localList : [])].forEach((m) => {
      if (!m || typeof m !== "object" || !m.matchId) return;
      const cur = byId.get(m.matchId);
      if (!cur || (Number(m.playedAt) || 0) >= (Number(cur.playedAt) || 0)) {
        byId.set(m.matchId, m);
      }
    });
    const sorted = Array.from(byId.values()).sort((a, b) => (Number(b.playedAt) || 0) - (Number(a.playedAt) || 0));
    // الاحتفاظ بآخر 50 مباراة لكل ملف مجموعة
    const countPerProfile = new Map();
    return sorted.filter((m) => {
      const pid = m.profileId || "default";
      const c = (countPerProfile.get(pid) || 0) + 1;
      countPerProfile.set(pid, c);
      return c <= MAX_ARCHIVE_PER_PROFILE;
    });
  }

  function mergeBaraStatsLists(localList, cloudList) {
    const byId = new Map();
    [...(Array.isArray(cloudList) ? cloudList : []), ...(Array.isArray(localList) ? localList : [])].forEach((r) => {
      if (!r || typeof r !== "object" || !r.roundId) return;
      if (!byId.has(r.roundId)) byId.set(r.roundId, r);
    });
    return Array.from(byId.values()).sort((a, b) => (Number(b.playedAt) || 0) - (Number(a.playedAt) || 0));
  }

  function mergeMafiaStatsLists(localList, cloudList) {
    const byId = new Map();
    [...(Array.isArray(cloudList) ? cloudList : []), ...(Array.isArray(localList) ? localList : [])].forEach((s) => {
      if (!s || typeof s !== "object" || !s.sessionId) return;
      if (!byId.has(s.sessionId)) byId.set(s.sessionId, s);
    });
    return Array.from(byId.values()).sort((a, b) => (Number(b.playedAt) || 0) - (Number(a.playedAt) || 0));
  }

  function mergeQuizRaceStatsLists(localList, cloudList) {
    const byId = new Map();
    [...(Array.isArray(cloudList) ? cloudList : []), ...(Array.isArray(localList) ? localList : [])].forEach((s) => {
      if (!s || typeof s !== "object" || !s.raceId) return;
      if (!byId.has(s.raceId)) byId.set(s.raceId, s);
    });
    return Array.from(byId.values()).sort((a, b) => (Number(b.playedAt) || 0) - (Number(a.playedAt) || 0));
  }

  function mergeBaraHistory(localHist, cloudHist) {
    const out = {};
    const keys = new Set([
      ...Object.keys(cloudHist && typeof cloudHist === "object" ? cloudHist : {}),
      ...Object.keys(localHist && typeof localHist === "object" ? localHist : {})
    ]);
    keys.forEach((catId) => {
      const a = Array.isArray(cloudHist && cloudHist[catId]) ? cloudHist[catId] : [];
      const b = Array.isArray(localHist && localHist[catId]) ? localHist[catId] : [];
      out[catId] = Array.from(new Set([...a, ...b].filter((w) => typeof w === "string" && w.trim())));
    });
    return out;
  }

  function mergeBaraCustomCategories(localCats, cloudCats) {
    const byId = new Map();
    [...(Array.isArray(cloudCats) ? cloudCats : []), ...(Array.isArray(localCats) ? localCats : [])].forEach((cat) => {
      if (!cat || typeof cat !== "object" || !cat.id) return;
      const cur = byId.get(cat.id);
      if (!cur) {
        byId.set(cat.id, { ...cat, words: Array.isArray(cat.words) ? Array.from(new Set(cat.words)) : [] });
      } else {
        const newer = (Number(cat.updatedAt) || 0) >= (Number(cur.updatedAt) || 0) ? cat : cur;
        const words = Array.from(
          new Set([...(Array.isArray(cur.words) ? cur.words : []), ...(Array.isArray(cat.words) ? cat.words : [])])
        );
        byId.set(cat.id, { ...newer, words });
      }
    });
    return Array.from(byId.values());
  }

  function mergeFlaggedQuestions(localFlags, cloudFlags) {
    const byKey = new Map();
    [...(Array.isArray(cloudFlags) ? cloudFlags : []), ...(Array.isArray(localFlags) ? localFlags : [])].forEach((f) => {
      if (!f || typeof f !== "object" || !f.questionId) return;
      const cur = byKey.get(f.questionId);
      if (!cur) {
        byKey.set(f.questionId, { ...f });
        return;
      }
      const isSentA = cur.sheetSyncStatus === "sent" || cur.reportedToSheet === true;
      const isSentB = f.sheetSyncStatus === "sent" || f.reportedToSheet === true;
      const newer = (Number(f.flaggedAt) || 0) >= (Number(cur.flaggedAt) || 0) ? f : cur;
      const merged = { ...newer };
      if (isSentA || isSentB) {
        merged.sheetSyncStatus = "sent";
        merged.reportedToSheet = true;
      }
      byKey.set(f.questionId, merged);
    });
    return Array.from(byKey.values()).sort((a, b) => (Number(b.flaggedAt) || 0) - (Number(a.flaggedAt) || 0));
  }

  function mergeTournaments(localT, cloudT) {
    if (!localT || typeof localT !== "object") return cloudT || null;
    if (!cloudT || typeof cloudT !== "object") return localT;
    if (localT.id === cloudT.id) {
      const doneCount = (t) => (Array.isArray(t.matches) ? t.matches.filter((m) => m.status === "completed").length : 0);
      return doneCount(localT) >= doneCount(cloudT) ? localT : cloudT;
    }
    return (Number(localT.createdAt) || 0) >= (Number(cloudT.createdAt) || 0) ? localT : cloudT;
  }

  function mergeCloudPayloads(localRaw, cloudRaw) {
    const local = stripUndefinedAndHeavyMedia(localRaw || {});
    const cloud = stripUndefinedAndHeavyMedia(cloudRaw || {});
    const localTs = Number(local.updatedAt) || 0;
    const cloudTs = Number(cloud.updatedAt) || 0;
    const localPrefs = (local.preferences && typeof local.preferences === "object" && local.preferences) || {};
    const cloudPrefs = (cloud.preferences && typeof cloud.preferences === "object" && cloud.preferences) || {};
    const primaryPrefs = localTs >= cloudTs ? localPrefs : cloudPrefs;
    const fallbackPrefs = localTs >= cloudTs ? cloudPrefs : localPrefs;

    return stripUndefinedAndHeavyMedia({
      schemaVersion: 1,
      updatedAt: Date.now(),
      historyStore: mergeHistoryStores(local.historyStore, cloud.historyStore),
      matchArchive: mergeMatchArchiveLists(local.matchArchive, cloud.matchArchive),
      baraSalfaStats: mergeBaraStatsLists(local.baraSalfaStats, cloud.baraSalfaStats),
      mafiaStats: mergeMafiaStatsLists(local.mafiaStats, cloud.mafiaStats),
      quizRaceStats: mergeQuizRaceStatsLists(local.quizRaceStats, cloud.quizRaceStats),
      audioChallengeHistory: Array.from(
        new Set(
          [
            ...(Array.isArray(cloud.audioChallengeHistory) ? cloud.audioChallengeHistory : []),
            ...(Array.isArray(local.audioChallengeHistory) ? local.audioChallengeHistory : [])
          ].filter((x) => typeof x === "string" && x.trim())
        )
      ).slice(-500),
      favoriteCategories: Array.from(
        new Set(
          [
            ...(Array.isArray(cloud.favoriteCategories) ? cloud.favoriteCategories : []),
            ...(Array.isArray(local.favoriteCategories) ? local.favoriteCategories : [])
          ].filter((x) => typeof x === "string" && x.trim())
        )
      ),
      baraSalfaHistory: mergeBaraHistory(local.baraSalfaHistory, cloud.baraSalfaHistory),
      baraSalfaCustom: mergeBaraCustomCategories(local.baraSalfaCustom, cloud.baraSalfaCustom),
      flaggedQuestions: mergeFlaggedQuestions(local.flaggedQuestions, cloud.flaggedQuestions),
      activeTournament: mergeTournaments(local.activeTournament, cloud.activeTournament),
      preferences: {
        theme: primaryPrefs.theme || fallbackPrefs.theme || "dark-glass",
        tvScale: Number(primaryPrefs.tvScale || fallbackPrefs.tvScale) || 100,
        activeProfileId: primaryPrefs.activeProfileId || fallbackPrefs.activeProfileId || "default",
        sheetReportWebhookUrl:
          primaryPrefs.sheetReportWebhookUrl || fallbackPrefs.sheetReportWebhookUrl || "",
        sheetReportSecret:
          primaryPrefs.sheetReportSecret || fallbackPrefs.sheetReportSecret || ""
      }
    });
  }

  function applyCloudPayloadToLocal(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.historyStore && Array.isArray(payload.historyStore.profiles)) {
      safeWriteJSON(LOCAL_KEYS.HISTORY, payload.historyStore);
      if (window.SeenJeemHistoryStore && typeof window.SeenJeemHistoryStore._load === "function") {
        window.SeenJeemHistoryStore._load();
      }
    }
    if (Array.isArray(payload.matchArchive)) {
      if (window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.importArchive === "function") {
        window.SeenJeemArchiveStore.importArchive(payload.matchArchive, "replace");
      } else {
        safeWriteJSON(LOCAL_KEYS.ARCHIVE, payload.matchArchive);
      }
    }
    if (Array.isArray(payload.baraSalfaStats)) {
      if (window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.importBaraSalfaRounds === "function") {
        window.SeenJeemArchiveStore.importBaraSalfaRounds(payload.baraSalfaStats, "replace");
      } else {
        safeWriteJSON(LOCAL_KEYS.BARA_STATS, payload.baraSalfaStats);
      }
    }
    if (Array.isArray(payload.mafiaStats)) {
      if (window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.importMafiaSessions === "function") {
        window.SeenJeemArchiveStore.importMafiaSessions(payload.mafiaStats, "replace");
      } else {
        safeWriteJSON(LOCAL_KEYS.MAFIA_STATS, payload.mafiaStats);
      }
    }
    if (Array.isArray(payload.quizRaceStats)) {
      if (window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.importQuizRaceSessions === "function") {
        window.SeenJeemArchiveStore.importQuizRaceSessions(payload.quizRaceStats, "replace");
      } else {
        safeWriteJSON(LOCAL_KEYS.QUIZ_RACE_STATS, payload.quizRaceStats);
      }
    }
    if (Array.isArray(payload.audioChallengeHistory)) {
      safeWriteJSON(
        LOCAL_KEYS.AUDIO_CHALLENGE_HISTORY,
        payload.audioChallengeHistory.filter((x) => typeof x === "string" && x.trim())
      );
    }
    if (Array.isArray(payload.favoriteCategories)) {
      if (window.SeenJeemCategoryBrowser && typeof window.SeenJeemCategoryBrowser.importFavorites === "function") {
        window.SeenJeemCategoryBrowser.importFavorites(payload.favoriteCategories, "replace");
      } else {
        safeWriteJSON(
          LOCAL_KEYS.FAVORITE_CATEGORIES,
          Array.from(new Set(payload.favoriteCategories.filter((x) => typeof x === "string" && x.trim())))
        );
      }
    }
    if (payload.baraSalfaHistory && typeof payload.baraSalfaHistory === "object") {
      safeWriteJSON(LOCAL_KEYS.BARA_HISTORY, payload.baraSalfaHistory);
    }
    if (Array.isArray(payload.baraSalfaCustom)) {
      safeWriteJSON(LOCAL_KEYS.BARA_CUSTOM, payload.baraSalfaCustom);
    }
    if (Array.isArray(payload.flaggedQuestions)) {
      if (window.SeenJeemFlaggedStore && typeof window.SeenJeemFlaggedStore.importFlags === "function") {
        window.SeenJeemFlaggedStore.importFlags(payload.flaggedQuestions, "replace");
      } else {
        safeWriteJSON(LOCAL_KEYS.FLAGGED, payload.flaggedQuestions);
      }
    }
    if (payload.activeTournament && typeof payload.activeTournament === "object") {
      safeWriteJSON(LOCAL_KEYS.TOURNAMENT, payload.activeTournament);
    }
    if (payload.preferences && typeof payload.preferences === "object") {
      const pr = payload.preferences;
      if (pr.theme) {
        try {
          localStorage.setItem(LOCAL_KEYS.THEME, pr.theme);
        } catch (_err) {}
      }
      if (Number.isFinite(Number(pr.tvScale))) {
        try {
          localStorage.setItem(LOCAL_KEYS.TV_SCALE, String(pr.tvScale));
        } catch (_err) {}
      }
      if (window.SeenJeemSheetReportSync && (pr.sheetReportWebhookUrl || pr.sheetReportSecret)) {
        window.SeenJeemSheetReportSync.saveConfig({
          webhookUrl: pr.sheetReportWebhookUrl || "",
          secret: pr.sheetReportSecret || ""
        });
      }
    }
  }

  function signatureWithoutUpdatedAt(data) {
    if (!data || typeof data !== "object") return "";
    const copy = { ...data };
    delete copy.updatedAt;
    return JSON.stringify(copy);
  }

  class CloudSyncManager {
    constructor() {
      this._sdk = null;
      this._app = null;
      this._auth = null;
      this._db = null;
      this._user = null; // Google user only (never anonymous)
      this._status = "signed-out"; // "signed-out" | "synced" | "syncing" | "pending-offline" | "error"
      this._lastSyncedAt = this._loadLastSyncedAt();
      this._lastError = "";
      this._lastUploadedSig = "";
      this._debounceTimer = null;
      this._pendingOffline = false;
      this._listeners = new Set();
      this._booted = false;
    }

    _loadLastSyncedAt() {
      const m = safeReadJSON(LAST_SYNC_META_KEY, null);
      return m && Number.isFinite(Number(m.lastSyncedAt)) ? Number(m.lastSyncedAt) : null;
    }

    _saveLastSyncedAt(ts) {
      this._lastSyncedAt = ts;
      safeWriteJSON(LAST_SYNC_META_KEY, { lastSyncedAt: ts });
    }

    onChange(cb) {
      if (typeof cb === "function") this._listeners.add(cb);
      return () => this._listeners.delete(cb);
    }

    _emit() {
      const snap = this.getState();
      this._listeners.forEach((cb) => {
        try {
          cb(snap);
        } catch (_err) {}
      });
    }

    getState() {
      return {
        signedIn: Boolean(this._user && !this._user.isAnonymous),
        user: this._user && !this._user.isAnonymous
          ? {
              uid: this._user.uid,
              displayName: this._user.displayName || "المقدّم",
              email: this._user.email || "",
              photoURL: this._user.photoURL || ""
            }
          : null,
        status: this._status,
        lastSyncedAt: this._lastSyncedAt,
        pendingOffline: Boolean(this._pendingOffline),
        error: this._lastError
      };
    }

    isSignedIn() {
      return Boolean(this._user && !this._user.isAnonymous);
    }

    async _loadFirebaseSdk() {
      if (this._sdk) return this._sdk;
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VER}`;
      const [appMod, authMod, dbMod] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-database.js`)
      ]);
      this._sdk = { appMod, authMod, dbMod };
      return this._sdk;
    }

    async _ensureFirebase() {
      const cfg = window.SeenJeemFirebaseConfig ? window.SeenJeemFirebaseConfig.getConfig() : null;
      if (!window.SeenJeemFirebaseConfig || !window.SeenJeemFirebaseConfig.isValidConfig(cfg)) {
        throw new Error("خدمة تسجيل الدخول غير متوفرة حالياً — يمكنك الاستمرار باللعب محلياً.");
      }
      const sdk = await this._loadFirebaseSdk();
      const hostAppName = `seen-jeem-host-${sanitizeKey(cfg.projectId || "default")}`;
      const existing = sdk.appMod.getApps().find((a) => a.name === hostAppName);
      this._app = existing || sdk.appMod.initializeApp(cfg, hostAppName);
      this._auth = sdk.authMod.getAuth(this._app);
      this._db = sdk.dbMod.getDatabase(this._app);
      if (!this._authObserverBound && typeof sdk.authMod.onAuthStateChanged === "function") {
        this._authObserverBound = true;
        sdk.authMod.onAuthStateChanged(this._auth, (fbUser) => {
          const nextUser = fbUser && !fbUser.isAnonymous ? fbUser : null;
          const prevUid = this._user ? this._user.uid : "";
          const nextUid = nextUser ? nextUser.uid : "";
          this._user = nextUser;
          if (!nextUser) {
            this._status = "signed-out";
          } else if (this._status === "signed-out") {
            this._status = "synced";
          }
          if (prevUid !== nextUid) {
            this._emit();
          }
        });
      }
      return { sdk, auth: this._auth, db: this._db };
    }

    async saveUserProfile(profileObj) {
      if (!this.isSignedIn() || !navigator.onLine || !profileObj) return { ok: false };
      try {
        const { sdk, db } = await this._ensureFirebase();
        const clean = stripUndefinedAndHeavyMedia(profileObj);
        await sdk.dbMod.set(sdk.dbMod.ref(db, `users/${this._user.uid}/profile`), clean);
        return { ok: true };
      } catch (_err) {
        return { ok: false };
      }
    }

    async syncUserProfile() {
      if (!this.isSignedIn() || !navigator.onLine || !window.SeenJeemProfile) return { ok: false };
      try {
        const { sdk, db } = await this._ensureFirebase();
        const profRef = sdk.dbMod.ref(db, `users/${this._user.uid}/profile`);
        const snap = await sdk.dbMod.get(profRef);
        const remoteProf = snap && snap.exists() ? snap.val() : null;
        const merged = window.SeenJeemProfile.mergeRemoteProfile(remoteProf, this._user);
        await sdk.dbMod.set(profRef, stripUndefinedAndHeavyMedia(merged));
        return { ok: true, profile: merged };
      } catch (_err) {
        return { ok: false };
      }
    }

    /**
     * تهيئة خفيفة عند الإقلاع: لا تُحمّل Firebase إطلاقاً إلا إذا كان المقدّم مسجّل الدخول مسبقاً ومتصلاً بالإنترنت!
     */
    init() {
      if (this._booted) return;
      this._booted = true;

      window.addEventListener("online", () => {
        if (this.isSignedIn() && this._pendingOffline) {
          this.syncNow({ silent: true }).catch(() => {});
        }
      });

      const hasSignedInHint = localStorage.getItem(SIGNED_IN_HINT_KEY) === "1";
      if (!hasSignedInHint || !navigator.onLine) return;

      this._restoreSessionOnBoot().catch(() => {});
    }

    async _restoreSessionOnBoot() {
      const { sdk, auth } = await this._ensureFirebase();
      try {
        await sdk.authMod.getRedirectResult(auth);
      } catch (_err) {}
      if (typeof auth.authStateReady === "function") {
        await auth.authStateReady();
      }
      if (auth.currentUser && !auth.currentUser.isAnonymous) {
        this._user = auth.currentUser;
        this._status = "synced";
        this._emit();
        await this.syncUserProfile();
        await this._checkRemoteAndAutoSync();
      } else {
        localStorage.removeItem(SIGNED_IN_HINT_KEY);
      }
    }

    async _checkRemoteAndAutoSync() {
      if (!this.isSignedIn() || !navigator.onLine) return;
      try {
        const { sdk, db } = await this._ensureFirebase();
        const snap = await sdk.dbMod.get(sdk.dbMod.ref(db, `users/${this._user.uid}/cloudData`));
        const cloudData = snap && snap.exists() ? snap.val() : null;
        if (cloudData && Number(cloudData.updatedAt) > (Number(this._lastSyncedAt) || 0)) {
          await this.syncNow({ silent: true });
        }
      } catch (_err) {}
    }

    async signInWithGoogle({ useRedirect = false } = {}) {
      if (!navigator.onLine) {
        this._lastError = "لا يوجد اتصال بالإنترنت حالياً — يعمل التطبيق محلياً وأوفلاين.";
        this._status = "pending-offline";
        this._emit();
        return { ok: false, error: this._lastError };
      }

      this._lastError = "";
      this._status = "syncing";
      this._emit();

      try {
        const { sdk, auth } = await this._ensureFirebase();
        const provider = new sdk.authMod.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });

        if (useRedirect) {
          localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
          await sdk.authMod.signInWithRedirect(auth, provider);
          return { ok: true, redirecting: true };
        }

        const result = await sdk.authMod.signInWithPopup(auth, provider);
        this._user = result && result.user ? result.user : auth.currentUser;
        if (!this._user || this._user.isAnonymous) {
          throw new Error("تعذّر إتمام تسجيل الدخول بحساب Google.");
        }
        localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
        this._emit();
        await this.syncUserProfile();
        const syncRes = await this.syncNow({ silent: false });
        return { ok: true, user: this.getState().user, synced: syncRes.ok };
      } catch (err) {
        const code = String((err && err.code) || "");
        let friendly = "تعذّر تسجيل الدخول حالياً، تأكد من الإنترنت وحاول مجدداً.";
        let suggestRedirect = false;

        if (code === "auth/popup-blocked") {
          friendly = "يرجى السماح بالنوافذ المنبثقة لإتمام تسجيل الدخول، أو استخدم خيار تسجيل الدخول المباشر.";
          suggestRedirect = true;
        } else if (code === "auth/unauthorized-domain") {
          friendly = "تعذّر إتمام تسجيل الدخول من هذا الرابط حالياً — يرجى التواصل مع إدارة الموقع.";
        } else if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
          friendly = "تم إلغاء نافذة تسجيل الدخول.";
        } else if (code === "auth/operation-not-allowed") {
          friendly = "تسجيل الدخول بحساب Google غير مفعّل حالياً.";
        }

        this._lastError = friendly;
        this._status = this.isSignedIn() ? "synced" : "signed-out";
        this._emit();
        return { ok: false, code, error: friendly, suggestRedirect };
      }
    }

    async signOut() {
      this._clearDebounce();
      try {
        if (this._auth && this._sdk) {
          await this._sdk.authMod.signOut(this._auth);
        }
      } catch (_err) {}
      this._user = null;
      this._status = "signed-out";
      this._pendingOffline = false;
      this._lastError = "";
      this._lastUploadedSig = "";
      try {
        localStorage.removeItem(SIGNED_IN_HINT_KEY);
      } catch (_err) {}
      this._emit();
      return { ok: true };
    }

    _clearDebounce() {
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }
    }

    /**
     * جدولة مزامنة تلقائية خفيفة بمهلة 5 ثوانٍ مع Shallow Diffing
     */
    scheduleAutoSync() {
      if (!this.isSignedIn()) return;
      if (!navigator.onLine) {
        this._pendingOffline = true;
        this._status = "pending-offline";
        this._emit();
        return;
      }
      this._clearDebounce();
      this._debounceTimer = setTimeout(() => {
        this._debounceTimer = null;
        this.syncNow({ silent: true, skipIfUnchanged: true }).catch(() => {});
      }, DEBOUNCE_MS);
    }

    async syncNow({ silent = false, skipIfUnchanged = false } = {}) {
      if (!this.isSignedIn()) return { ok: false, error: "يرجى تسجيل الدخول بحساب Google أولاً." };
      if (!navigator.onLine) {
        this._pendingOffline = true;
        this._status = "pending-offline";
        this._emit();
        return { ok: false, error: "تغييرات محلية بانتظار الاتصال بالإنترنت." };
      }

      const localData = collectLocalCloudData();
      const localSig = signatureWithoutUpdatedAt(localData);
      if (skipIfUnchanged && localSig === this._lastUploadedSig) {
        return { ok: true, skipped: true };
      }

      this._status = "syncing";
      this._lastError = "";
      this._emit();

      try {
        const { sdk, db } = await this._ensureFirebase();
        const userRef = sdk.dbMod.ref(db, `users/${this._user.uid}/cloudData`);
        const snap = await sdk.dbMod.get(userRef);
        const cloudData = snap && snap.exists() ? snap.val() : null;

        const merged = cloudData ? mergeCloudPayloads(localData, cloudData) : localData;
        const mergedSig = signatureWithoutUpdatedAt(merged);

        applyCloudPayloadToLocal(merged);

        if (!cloudData || mergedSig !== signatureWithoutUpdatedAt(cloudData)) {
          await sdk.dbMod.set(userRef, merged);
        }

        this._lastUploadedSig = mergedSig;
        this._pendingOffline = false;
        this._status = "synced";
        this._saveLastSyncedAt(Date.now());
        this._emit();

        if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.onCloudDataApplied === "function") {
          window.SeenJeemHostBridge.onCloudDataApplied({ silent });
        }
        return { ok: true, merged };
      } catch (err) {
        this._status = "error";
        this._lastError = "تعذّر حفظ بياناتك حالياً، تأكد من الإنترنت وحاول مجدداً.";
        this._emit();
        return { ok: false, error: this._lastError };
      }
    }

    async pushLocalOverride() {
      if (!this.isSignedIn()) return { ok: false, error: "يرجى تسجيل الدخول أولاً." };
      if (!navigator.onLine) return { ok: false, error: "لا يوجد اتصال بالإنترنت." };
      this._status = "syncing";
      this._lastError = "";
      this._emit();
      try {
        const { sdk, db } = await this._ensureFirebase();
        const localData = collectLocalCloudData();
        await sdk.dbMod.set(sdk.dbMod.ref(db, `users/${this._user.uid}/cloudData`), localData);
        this._lastUploadedSig = signatureWithoutUpdatedAt(localData);
        this._pendingOffline = false;
        this._status = "synced";
        this._saveLastSyncedAt(Date.now());
        this._emit();
        return { ok: true };
      } catch (err) {
        this._status = "error";
        this._lastError = (err && err.message) || "تعذّر رفع نسخة الجهاز.";
        this._emit();
        return { ok: false, error: this._lastError };
      }
    }

    async pullCloudOverride() {
      if (!this.isSignedIn()) return { ok: false, error: "يرجى تسجيل الدخول أولاً." };
      if (!navigator.onLine) return { ok: false, error: "لا يوجد اتصال بالإنترنت." };
      this._status = "syncing";
      this._lastError = "";
      this._emit();
      try {
        const { sdk, db } = await this._ensureFirebase();
        const snap = await sdk.dbMod.get(sdk.dbMod.ref(db, `users/${this._user.uid}/cloudData`));
        const cloudData = snap && snap.exists() ? snap.val() : null;
        if (!cloudData) {
          this._status = "synced";
          this._emit();
          return { ok: false, error: "لا توجد نسخة محفوظة في السحابة لهذا الحساب بعد." };
        }
        applyCloudPayloadToLocal(cloudData);
        this._lastUploadedSig = signatureWithoutUpdatedAt(cloudData);
        this._pendingOffline = false;
        this._status = "synced";
        this._saveLastSyncedAt(Date.now());
        this._emit();
        if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.onCloudDataApplied === "function") {
          window.SeenJeemHostBridge.onCloudDataApplied({ silent: false });
        }
        return { ok: true };
      } catch (err) {
        this._status = "error";
        this._lastError = (err && err.message) || "تعذّر استرجاع نسخة السحابة.";
        this._emit();
        return { ok: false, error: this._lastError };
      }
    }
  }

  window.SeenJeemCloudSync = new CloudSyncManager();
  window.SeenJeemCloudSyncUtils = {
    collectLocalCloudData,
    mergeCloudPayloads,
    applyCloudPayloadToLocal,
    stripUndefinedAndHeavyMedia
  };
})();
