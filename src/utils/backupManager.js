/**
 * نظام النسخ الاحتياطي والاستعادة الكاملة لبيانات المستخدم (Full Backup & Restore)
 * يشمل: ملفات المجموعات وسجل الأسئلة الملعوبة، الأسئلة المحدّدة للمراجعة،
 * الفئات المخصّصة المستوردة، الإعدادات التكتيكية والمؤقت، وتفضيلات الصوت وWake Lock.
 */
(function () {
  "use strict";

  const BACKUP_FORMAT = "seen-jeem-backup";
  const BACKUP_VERSION = 1;

  const KEYS = Object.freeze({
    HISTORY: "seen_jeem_history_store_v1",
    FLAGGED: "seen-jeem-flagged-v1",
    CUSTOM_CATS: "seenJeem_customCategories_v1",
    SETTINGS: "seen_jeem_tactical_settings_v1",
    AUDIO_MUTED: "seen_jeem_muted",
    AUDIO_VOLUME: "seen_jeem_volume_v1",
    AUDIO_PREFS: "seen_jeem_audio_prefs_v1",
    WAKELOCK: "seen_jeem_wakelock_enabled_v1",
    AUDIO_ROUTE: "seen_jeem_dual_audio_route_v1",
    THEME: "seen_jeem_theme_v1",
    TV_SCALE: "seen_jeem_tv_scale_v1",
    ARCHIVE: "seen-jeem-archive-v1",
    BARA_CUSTOM: "bara-salfa-custom-v1",
    BARA_HISTORY: "bara-salfa-history-v1",
    BARA_STATS: "bara-salfa-stats-v1",
    MAFIA_STATS: "mafia-stats-v1",
    TOURNAMENT: "seen-jeem-tournament-v1"
  });

  function safeReadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_err) {
      return fallback;
    }
  }

  function safeWriteJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function buildBackupPayload() {
    const historyData = safeReadJSON(KEYS.HISTORY, null);
    const flaggedItems = window.SeenJeemFlaggedStore
      ? window.SeenJeemFlaggedStore.getAll()
      : safeReadJSON(KEYS.FLAGGED, []);
    const customCategories =
      window.SeenJeemCustomPacksStore && typeof window.SeenJeemCustomPacksStore.getAllSync === "function"
        ? window.SeenJeemCustomPacksStore.getAllSync()
        : safeReadJSON(KEYS.CUSTOM_CATS, []);
    const matchArchive = window.SeenJeemArchiveStore
      ? window.SeenJeemArchiveStore.getAll()
      : safeReadJSON(KEYS.ARCHIVE, []);
    const baraSalfaCustom = window.SeenJeemBaraSalfaBank
      ? window.SeenJeemBaraSalfaBank.loadCustomCategories()
      : safeReadJSON(KEYS.BARA_CUSTOM, []);
    const baraSalfaHistory = window.SeenJeemBaraSalfaBank
      ? window.SeenJeemBaraSalfaBank.exportBackupData().history
      : safeReadJSON(KEYS.BARA_HISTORY, {});
    const baraSalfaStats =
      window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.getAllBaraSalfaRounds === "function"
        ? window.SeenJeemArchiveStore.getAllBaraSalfaRounds()
        : safeReadJSON(KEYS.BARA_STATS, []);
    const mafiaStats =
      window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.getAllMafiaSessions === "function"
        ? window.SeenJeemArchiveStore.getAllMafiaSessions()
        : safeReadJSON(KEYS.MAFIA_STATS, []);
    const activeTournament = safeReadJSON(KEYS.TOURNAMENT, null);
    const matchSettings = window.SeenJeemMatchStore
      ? window.SeenJeemMatchStore.loadSavedSettings()
      : safeReadJSON(KEYS.SETTINGS, null);

    const audio = window.SeenJeemAudio
      ? {
          muted: window.SeenJeemAudio.isMuted(),
          volume:
            typeof window.SeenJeemAudio.getVolume === "function"
              ? window.SeenJeemAudio.getVolume()
              : 0.8,
          categories:
            typeof window.SeenJeemAudio.getCategoryPrefs === "function"
              ? window.SeenJeemAudio.getCategoryPrefs()
              : { timerTicks: true, uiEffects: true, celebrations: true }
        }
      : {
          muted: localStorage.getItem(KEYS.AUDIO_MUTED) === "true",
          volume: Number(localStorage.getItem(KEYS.AUDIO_VOLUME)) || 0.8,
          categories: safeReadJSON(KEYS.AUDIO_PREFS, {
            timerTicks: true,
            uiEffects: true,
            celebrations: true
          })
        };

    const wakeLockEnabled = window.SeenJeemWakeLock
      ? window.SeenJeemWakeLock.isEnabled()
      : localStorage.getItem(KEYS.WAKELOCK) !== "false";

    const audioRoute = localStorage.getItem(KEYS.AUDIO_ROUTE) === "host" ? "host" : "display";
    const validThemes = new Set(["dark-glass", "royal-gold", "high-contrast"]);
    const rawTheme = localStorage.getItem(KEYS.THEME);
    const theme = validThemes.has(rawTheme) ? rawTheme : "dark-glass";
    const rawTvScale = Number(localStorage.getItem(KEYS.TV_SCALE));
    const tvScale =
      Number.isFinite(rawTvScale) && rawTvScale >= 90 && rawTvScale <= 130
        ? Math.round(rawTvScale / 5) * 5
        : 100;

    const profileCount =
      historyData && Array.isArray(historyData.profiles) ? historyData.profiles.length : 1;
    const totalPlayed =
      historyData && Array.isArray(historyData.profiles)
        ? historyData.profiles.reduce(
            (sum, p) => sum + (Array.isArray(p.playedQuestionIds) ? p.playedQuestionIds.length : 0),
            0
          )
        : 0;

    return {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_VERSION,
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      exportedAtISO: new Date().toISOString(),
      summary: {
        profilesCount: profileCount,
        playedRecordsCount: totalPlayed,
        flaggedCount: Array.isArray(flaggedItems) ? flaggedItems.length : 0,
        customCategoriesCount: Array.isArray(customCategories) ? customCategories.length : 0,
        archiveMatchesCount: Array.isArray(matchArchive) ? matchArchive.length : 0,
        baraSalfaCustomCount: Array.isArray(baraSalfaCustom) ? baraSalfaCustom.length : 0
      },
      data: {
        historyStore: historyData,
        flaggedQuestions: Array.isArray(flaggedItems) ? flaggedItems : [],
        customCategories: Array.isArray(customCategories) ? customCategories : [],
        matchArchive: Array.isArray(matchArchive) ? matchArchive : [],
        baraSalfaCustom: Array.isArray(baraSalfaCustom) ? baraSalfaCustom : [],
        baraSalfaHistory:
          baraSalfaHistory && typeof baraSalfaHistory === "object" && !Array.isArray(baraSalfaHistory)
            ? baraSalfaHistory
            : {},
        baraSalfaStats: Array.isArray(baraSalfaStats) ? baraSalfaStats : [],
        mafiaStats: Array.isArray(mafiaStats) ? mafiaStats : [],
        activeTournament: activeTournament && typeof activeTournament === "object" ? activeTournament : null,
        matchSettings,
        preferences: {
          audio,
          wakeLockEnabled,
          audioRoute,
          theme,
          tvScale
        }
      }
    };
  }

  function validateBackupObject(raw) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "الملف لا يحتوي على كائن JSON صالح." };
    }
    if (
      raw.format !== BACKUP_FORMAT ||
      !raw.data ||
      typeof raw.data !== "object" ||
      (raw.schemaVersion !== undefined && Number(raw.schemaVersion) !== BACKUP_VERSION)
    ) {
      return {
        ok: false,
        error: "هذا الملف ليس نسخة احتياطية صالحة لتطبيق «سين جيم»."
      };
    }

    const d = raw.data;
    const profiles =
      d.historyStore && Array.isArray(d.historyStore.profiles) ? d.historyStore.profiles : [];
    const playedTotal = profiles.reduce(
      (sum, p) => sum + (p && Array.isArray(p.playedQuestionIds) ? p.playedQuestionIds.length : 0),
      0
    );
    const flagged = Array.isArray(d.flaggedQuestions) ? d.flaggedQuestions : [];
    const customCats = Array.isArray(d.customCategories) ? d.customCategories : [];
    const archiveList = Array.isArray(d.matchArchive) ? d.matchArchive : [];

    return {
      ok: true,
      parsed: raw,
      preview: {
        exportedAt: Number(raw.exportedAt) || null,
        profilesCount: profiles.length,
        playedRecordsCount: playedTotal,
        flaggedCount: flagged.length,
        customCategoriesCount: customCats.length,
        archiveMatchesCount: archiveList.length,
        hasSettings: Boolean(d.matchSettings && typeof d.matchSettings === "object"),
        hasPreferences: Boolean(d.preferences && typeof d.preferences === "object")
      }
    };
  }

  function mergeHistoryPayloads(existing, incoming) {
    if (!existing || !Array.isArray(existing.profiles)) return incoming;
    if (!incoming || !Array.isArray(incoming.profiles)) return existing;

    const byId = new Map();
    existing.profiles.forEach((p) => {
      if (p && p.id) {
        byId.set(p.id, {
          ...p,
          playedQuestionIds: Array.isArray(p.playedQuestionIds) ? p.playedQuestionIds.slice() : [],
          lastPlayedAt: p.lastPlayedAt && typeof p.lastPlayedAt === "object" ? { ...p.lastPlayedAt } : {}
        });
      }
    });

    incoming.profiles.forEach((inc) => {
      if (!inc || !inc.id) return;
      const cur = byId.get(inc.id);
      if (!cur) {
        byId.set(inc.id, {
          ...inc,
          playedQuestionIds: Array.isArray(inc.playedQuestionIds) ? inc.playedQuestionIds.slice() : [],
          lastPlayedAt:
            inc.lastPlayedAt && typeof inc.lastPlayedAt === "object" ? { ...inc.lastPlayedAt } : {}
        });
        return;
      }
      const set = new Set(cur.playedQuestionIds);
      const incIds = Array.isArray(inc.playedQuestionIds) ? inc.playedQuestionIds : [];
      const incTs = inc.lastPlayedAt && typeof inc.lastPlayedAt === "object" ? inc.lastPlayedAt : {};
      incIds.forEach((qId) => {
        if (typeof qId !== "string" || !qId.trim()) return;
        const cleanId = qId.trim();
        if (!set.has(cleanId)) {
          set.add(cleanId);
          cur.playedQuestionIds.push(cleanId);
        }
        const tCur = Number(cur.lastPlayedAt[cleanId]) || 0;
        const tInc = Number(incTs[cleanId]) || 0;
        cur.lastPlayedAt[cleanId] = Math.max(tCur, tInc, 1);
      });
    });

    return {
      schemaVersion: 1,
      activeProfileId: existing.activeProfileId || incoming.activeProfileId || "default",
      profiles: Array.from(byId.values())
    };
  }

  function mergeCustomCategories(existing, incoming) {
    const curList = Array.isArray(existing) ? existing : [];
    const incList = Array.isArray(incoming) ? incoming : [];
    const byId = new Map();

    curList.forEach((cat) => {
      if (cat && cat.id) byId.set(cat.id, cat);
    });
    incList.forEach((cat) => {
      if (!cat || !cat.id) return;
      if (!byId.has(cat.id)) {
        byId.set(cat.id, cat);
      } else {
        const curCat = byId.get(cat.id);
        const curQs = Array.isArray(curCat.questions) ? curCat.questions : [];
        const incQs = Array.isArray(cat.questions) ? cat.questions : [];
        const seenQIds = new Set(curQs.map((q) => q && q.id));
        const mergedQs = [...curQs];
        incQs.forEach((q) => {
          if (q && q.id && !seenQIds.has(q.id)) {
            seenQIds.add(q.id);
            mergedQs.push(q);
          }
        });
        byId.set(cat.id, { ...curCat, questions: mergedQs });
      }
    });

    return Array.from(byId.values());
  }

  /**
   * استعادة نسخة احتياطية بوضع "merge" (دمج آمن) أو "replace" (استبدال كامل)
   */
  function restoreBackupObject(backupObj, mode = "merge") {
    const validation = validateBackupObject(backupObj);
    if (!validation.ok) return validation;

    const d = backupObj.data;
    const isReplace = mode === "replace";

    // 1) سجل المجموعات والأسئلة الملعوبة
    if (d.historyStore && Array.isArray(d.historyStore.profiles)) {
      if (isReplace) {
        safeWriteJSON(KEYS.HISTORY, d.historyStore);
      } else {
        const curHistory = safeReadJSON(KEYS.HISTORY, null);
        safeWriteJSON(KEYS.HISTORY, mergeHistoryPayloads(curHistory, d.historyStore));
      }
      if (window.SeenJeemHistoryStore && typeof window.SeenJeemHistoryStore._load === "function") {
        window.SeenJeemHistoryStore._load();
      }
    }

    // 2) الأسئلة المحدّدة للمراجعة
    if (Array.isArray(d.flaggedQuestions)) {
      if (window.SeenJeemFlaggedStore) {
        window.SeenJeemFlaggedStore.importFlags(d.flaggedQuestions, isReplace ? "replace" : "merge");
      } else {
        safeWriteJSON(KEYS.FLAGGED, d.flaggedQuestions);
      }
    }

    // 3) الفئات المخصّصة المستوردة (مع دعم IndexedDB في customPacksStore)
    if (Array.isArray(d.customCategories)) {
      if (window.SeenJeemCustomPacksStore && typeof window.SeenJeemCustomPacksStore.importPacks === "function") {
        window.SeenJeemCustomPacksStore.importPacks(d.customCategories, isReplace ? "replace" : "merge").catch(() => {});
      } else if (isReplace) {
        safeWriteJSON(KEYS.CUSTOM_CATS, d.customCategories);
      } else {
        const curCats = safeReadJSON(KEYS.CUSTOM_CATS, []);
        safeWriteJSON(KEYS.CUSTOM_CATS, mergeCustomCategories(curCats, d.customCategories));
      }
    }

    // 3.5) أرشيف المباريات وقاعة المشاهير (بتوافق رجعي آمن مع النسخ القديمة)
    if (Array.isArray(d.matchArchive)) {
      if (window.SeenJeemArchiveStore) {
        window.SeenJeemArchiveStore.importRecords(d.matchArchive, isReplace ? "replace" : "merge");
      } else {
        safeWriteJSON(KEYS.ARCHIVE, d.matchArchive);
      }
    }

    // 3.6) بيانات لعبة «برا السالفة» (الفئات الخاصة وسجل عدم التكرار — بتوافق رجعي آمن)
    if (Array.isArray(d.baraSalfaCustom) || (d.baraSalfaHistory && typeof d.baraSalfaHistory === "object")) {
      if (window.SeenJeemBaraSalfaBank && typeof window.SeenJeemBaraSalfaBank.importBackupData === "function") {
        window.SeenJeemBaraSalfaBank.importBackupData(
          {
            customCategories: Array.isArray(d.baraSalfaCustom) ? d.baraSalfaCustom : undefined,
            history:
              d.baraSalfaHistory && typeof d.baraSalfaHistory === "object" && !Array.isArray(d.baraSalfaHistory)
                ? d.baraSalfaHistory
                : undefined
          },
          isReplace ? "replace" : "merge"
        );
      } else {
        if (Array.isArray(d.baraSalfaCustom)) safeWriteJSON(KEYS.BARA_CUSTOM, d.baraSalfaCustom);
        if (d.baraSalfaHistory && typeof d.baraSalfaHistory === "object") {
          safeWriteJSON(KEYS.BARA_HISTORY, d.baraSalfaHistory);
        }
      }
    }

    // 3.7) إحصائيات برا السالفة والمافيا والبطولة النشطة (بتوافق رجعي آمن)
    if (Array.isArray(d.baraSalfaStats)) {
      if (window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.importBaraSalfaRounds === "function") {
        window.SeenJeemArchiveStore.importBaraSalfaRounds(d.baraSalfaStats, isReplace ? "replace" : "merge");
      } else {
        safeWriteJSON(KEYS.BARA_STATS, d.baraSalfaStats);
      }
    }
    if (Array.isArray(d.mafiaStats)) {
      if (window.SeenJeemArchiveStore && typeof window.SeenJeemArchiveStore.importMafiaSessions === "function") {
        window.SeenJeemArchiveStore.importMafiaSessions(d.mafiaStats, isReplace ? "replace" : "merge");
      } else {
        safeWriteJSON(KEYS.MAFIA_STATS, d.mafiaStats);
      }
    }
    if (d.activeTournament && typeof d.activeTournament === "object") {
      if (isReplace || !safeReadJSON(KEYS.TOURNAMENT, null)) {
        safeWriteJSON(KEYS.TOURNAMENT, d.activeTournament);
      }
    }

    // 4) إعدادات المباراة التكتيكية والمؤقت العام
    if (d.matchSettings && typeof d.matchSettings === "object") {
      if (window.SeenJeemMatchStore) {
        window.SeenJeemMatchStore.saveSettings(d.matchSettings);
      } else {
        safeWriteJSON(KEYS.SETTINGS, d.matchSettings);
      }
    }

    // 5) تفضيلات الصوت وWake Lock وتوجيه الصوت
    if (d.preferences && typeof d.preferences === "object") {
      const prefs = d.preferences;
      if (prefs.audio && typeof prefs.audio === "object" && window.SeenJeemAudio) {
        if (prefs.audio.muted !== undefined) {
          window.SeenJeemAudio.setMuted(Boolean(prefs.audio.muted));
        }
        if (
          prefs.audio.volume !== undefined &&
          typeof window.SeenJeemAudio.setVolume === "function"
        ) {
          window.SeenJeemAudio.setVolume(Number(prefs.audio.volume));
        }
        if (
          prefs.audio.categories &&
          typeof window.SeenJeemAudio.setCategoryPrefs === "function"
        ) {
          window.SeenJeemAudio.setCategoryPrefs(prefs.audio.categories);
        }
      }
      if (prefs.wakeLockEnabled !== undefined && window.SeenJeemWakeLock) {
        window.SeenJeemWakeLock.setEnabled(Boolean(prefs.wakeLockEnabled));
      }
      if (prefs.audioRoute && window.SeenJeemLiveSync) {
        window.SeenJeemLiveSync.setAudioRoute(prefs.audioRoute);
      }
      if (typeof prefs.theme === "string") {
        const validThemes = new Set(["dark-glass", "royal-gold", "high-contrast"]);
        if (validThemes.has(prefs.theme)) {
          try {
            localStorage.setItem(KEYS.THEME, prefs.theme);
          } catch (_e) {}
        }
      }
      if (prefs.tvScale !== undefined) {
        const sc = Number(prefs.tvScale);
        if (Number.isFinite(sc) && sc >= 90 && sc <= 130) {
          try {
            localStorage.setItem(KEYS.TV_SCALE, String(Math.round(sc / 5) * 5));
          } catch (_e) {}
        }
      }
    }

    return {
      ok: true,
      mode: isReplace ? "replace" : "merge",
      preview: validation.preview
    };
  }

  function downloadBackupFile() {
    const payload = buildBackupPayload();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `seen-jeem-backup-${dateStr}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { filename, summary: payload.summary };
  }

  window.SeenJeemBackup = {
    buildBackupPayload,
    validateBackupObject,
    restoreBackupObject,
    downloadBackupFile
  };
})();
