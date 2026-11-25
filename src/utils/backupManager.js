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
    AUDIO_ROUTE: "seen_jeem_dual_audio_route_v1"
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
    const customCategories = safeReadJSON(KEYS.CUSTOM_CATS, []);
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
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      exportedAtISO: new Date().toISOString(),
      summary: {
        profilesCount: profileCount,
        playedRecordsCount: totalPlayed,
        flaggedCount: Array.isArray(flaggedItems) ? flaggedItems.length : 0,
        customCategoriesCount: Array.isArray(customCategories) ? customCategories.length : 0
      },
      data: {
        historyStore: historyData,
        flaggedQuestions: Array.isArray(flaggedItems) ? flaggedItems : [],
        customCategories: Array.isArray(customCategories) ? customCategories : [],
        matchSettings,
        preferences: {
          audio,
          wakeLockEnabled,
          audioRoute
        }
      }
    };
  }

  function validateBackupObject(raw) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "الملف لا يحتوي على كائن JSON صالح." };
    }
    if (raw.format !== BACKUP_FORMAT || !raw.data || typeof raw.data !== "object") {
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

    return {
      ok: true,
      parsed: raw,
      preview: {
        exportedAt: Number(raw.exportedAt) || null,
        profilesCount: profiles.length,
        playedRecordsCount: playedTotal,
        flaggedCount: flagged.length,
        customCategoriesCount: customCats.length,
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

    // 3) الفئات المخصّصة المستوردة
    if (Array.isArray(d.customCategories)) {
      if (isReplace) {
        safeWriteJSON(KEYS.CUSTOM_CATS, d.customCategories);
      } else {
        const curCats = safeReadJSON(KEYS.CUSTOM_CATS, []);
        safeWriteJSON(KEYS.CUSTOM_CATS, mergeCustomCategories(curCats, d.customCategories));
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
