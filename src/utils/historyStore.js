/**
 * محرك عدم التكرار عبر الجلسات وإدارة ملفات المجموعات (No-Repeat Engine + Profiles)
 * - مخطط تخزين مُرقَّم الإصدار (schemaVersion: 1) في localStorage
 * - يدعم الملف الافتراضي «عام» وإنشاء/تبديل/حذف مجموعات إضافية (مثل: العائلة، الأصدقاء)
 * - يختار الأسئلة غير الملعوبة أولاً، ثم يعيد تدوير الأقدم لعباً (lastPlayedAt الأصغر) عند النفاد
 * - يدعم أخذ لقطة واستعادتها بدقة لصالح نظام التراجع (Undo Stack)
 */
(function () {
  "use strict";

  const STORAGE_KEY = "seen_jeem_history_store_v1";
  const LEGACY_STORAGE_KEY = "seen_jeem_played_question_ids_v1";
  const SCHEMA_VERSION = 1;
  const DEFAULT_PROFILE_ID = "default";
  const DEFAULT_PROFILE_NAME = "عام";
  const MAX_PROFILE_NAME_LENGTH = 28;

  /**
   * @typedef {Object} ProfileRecord
   * @property {string} id
   * @property {string} name
   * @property {boolean} isDefault
   * @property {number} createdAt
   * @property {string[]} playedQuestionIds
   * @property {Record<string, number>} lastPlayedAt
   */

  /**
   * @typedef {Object} HistoryStoreSchema
   * @property {number} schemaVersion
   * @property {string} activeProfileId
   * @property {ProfileRecord[]} profiles
   */

  /**
   * @typedef {Object} QuestionHistorySnapshot
   * @property {string} profileId
   * @property {string} questionId
   * @property {boolean} wasPlayed
   * @property {number | null} lastPlayedAt
   */

  function shuffleCopy(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function normalizeProfileName(name) {
    if (typeof name !== "string") return "";
    return name.trim().replace(/\s+/g, " ");
  }

  function normalizeCompareKey(name) {
    return normalizeProfileName(name)
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .toLowerCase();
  }

  function generateProfileId() {
    return `prof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function createDefaultProfile(legacyIds) {
    const cleanIds = [];
    const seen = new Set();
    const lastPlayedAt = {};
    const baseTimestamp = 1700000000000;

    if (Array.isArray(legacyIds)) {
      legacyIds.forEach((rawId, idx) => {
        if (typeof rawId !== "string") return;
        const id = rawId.trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        cleanIds.push(id);
        // الحفاظ على ترتيب نسبي للأسئلة القديمة عند الترقية من الإصدار السابق
        lastPlayedAt[id] = baseTimestamp + idx;
      });
    }

    return {
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      isDefault: true,
      createdAt: Date.now(),
      playedQuestionIds: cleanIds,
      lastPlayedAt
    };
  }

  function sanitizeProfileRecord(raw, forceDefault = false) {
    if (!raw || typeof raw !== "object") return null;
    const id = forceDefault
      ? DEFAULT_PROFILE_ID
      : typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : "";
    const name = forceDefault
      ? DEFAULT_PROFILE_NAME
      : normalizeProfileName(raw.name).slice(0, MAX_PROFILE_NAME_LENGTH);

    if (!id || !name) return null;

    const seen = new Set();
    const playedQuestionIds = [];
    const lastPlayedAt = {};

    const rawLastPlayed =
      raw.lastPlayedAt && typeof raw.lastPlayedAt === "object" ? raw.lastPlayedAt : {};

    if (Array.isArray(raw.playedQuestionIds)) {
      raw.playedQuestionIds.forEach((qIdRaw) => {
        if (typeof qIdRaw !== "string") return;
        const qId = qIdRaw.trim();
        if (!qId || seen.has(qId)) return;
        seen.add(qId);
        playedQuestionIds.push(qId);
        const ts = Number(rawLastPlayed[qId]);
        lastPlayedAt[qId] = Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : 1;
      });
    }

    // تضمين أي مفاتيح صالحة موجودة في lastPlayedAt حتى لو سقطت من المصفوفة
    Object.keys(rawLastPlayed).forEach((k) => {
      const qId = k.trim();
      const ts = Number(rawLastPlayed[k]);
      if (!qId || !Number.isFinite(ts) || ts <= 0) return;
      if (!seen.has(qId)) {
        seen.add(qId);
        playedQuestionIds.push(qId);
      }
      lastPlayedAt[qId] = Math.floor(ts);
    });

    const createdAt = Number(raw.createdAt);

    return {
      id,
      name,
      isDefault: forceDefault || id === DEFAULT_PROFILE_ID,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : Date.now(),
      playedQuestionIds,
      lastPlayedAt
    };
  }

  class HistoryStore {
    constructor() {
      /** @type {HistoryStoreSchema} */
      this._data = {
        schemaVersion: SCHEMA_VERSION,
        activeProfileId: DEFAULT_PROFILE_ID,
        profiles: []
      };
      /** @type {Map<string, Set<string>>} */
      this._playedSets = new Map();
      this._load();
    }

    _readLegacyPlayedIds() {
      try {
        const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
      } catch (_err) {
        return [];
      }
    }

    _rebuildSetCache() {
      this._playedSets.clear();
      this._data.profiles.forEach((profile) => {
        this._playedSets.set(profile.id, new Set(profile.playedQuestionIds));
      });
    }

    _load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && Array.isArray(parsed.profiles)) {
            const validProfiles = [];
            const seenProfileIds = new Set();
            let hasDefault = false;

            parsed.profiles.forEach((p) => {
              const isDef = p && (p.id === DEFAULT_PROFILE_ID || p.isDefault === true);
              const clean = sanitizeProfileRecord(p, isDef && !hasDefault);
              if (!clean || seenProfileIds.has(clean.id)) return;
              seenProfileIds.add(clean.id);
              if (clean.id === DEFAULT_PROFILE_ID) {
                hasDefault = true;
                validProfiles.unshift(clean);
              } else {
                validProfiles.push(clean);
              }
            });

            if (!hasDefault) {
              validProfiles.unshift(createDefaultProfile(this._readLegacyPlayedIds()));
            }

            const activeId =
              typeof parsed.activeProfileId === "string" && seenProfileIds.has(parsed.activeProfileId)
                ? parsed.activeProfileId
                : DEFAULT_PROFILE_ID;

            this._data = {
              schemaVersion: SCHEMA_VERSION,
              activeProfileId: activeId,
              profiles: validProfiles
            };
            this._rebuildSetCache();
            return;
          }
        }
      } catch (_err) {
        // المتابعة لإنشاء مخزن نظيف
      }

      // ترحيل تلقائي آمن من السجل القديم في حال عدم وجود المخزن الجديد بعد
      const legacyIds = this._readLegacyPlayedIds();
      this._data = {
        schemaVersion: SCHEMA_VERSION,
        activeProfileId: DEFAULT_PROFILE_ID,
        profiles: [createDefaultProfile(legacyIds)]
      };
      this._rebuildSetCache();
      this._save();
    }

    _save() {
      try {
        this._data.schemaVersion = SCHEMA_VERSION;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
      } catch (_err) {
        // تجاهل أخطاء امتلاء التخزين أو الوضع الخاص
      }
    }

    _getProfileInternal(profileId) {
      const targetId = profileId || this._data.activeProfileId || DEFAULT_PROFILE_ID;
      let found = this._data.profiles.find((p) => p.id === targetId);
      if (!found) {
        found = this._data.profiles.find((p) => p.id === DEFAULT_PROFILE_ID);
      }
      if (!found) {
        found = createDefaultProfile([]);
        this._data.profiles.unshift(found);
        this._playedSets.set(found.id, new Set());
      }
      return found;
    }

    getSchemaVersion() {
      return SCHEMA_VERSION;
    }

    getActiveProfileId() {
      return this._getProfileInternal().id;
    }

    getActiveProfile() {
      const p = this._getProfileInternal();
      return {
        id: p.id,
        name: p.name,
        isDefault: Boolean(p.isDefault),
        createdAt: p.createdAt,
        playedCount: p.playedQuestionIds.length
      };
    }

    getProfiles() {
      return this._data.profiles.map((p) => {
        const timestamps = Object.values(p.lastPlayedAt).filter((n) => Number.isFinite(n) && n > 1700000100000);
        const lastActivityAt = timestamps.length > 0 ? Math.max(...timestamps) : null;
        return {
          id: p.id,
          name: p.name,
          isDefault: Boolean(p.isDefault),
          createdAt: p.createdAt,
          playedCount: p.playedQuestionIds.length,
          lastActivityAt
        };
      });
    }

    setActiveProfile(profileId) {
      const target = this._data.profiles.find((p) => p.id === profileId);
      if (!target) return false;
      this._data.activeProfileId = target.id;
      this._save();
      return true;
    }

    createProfile(rawName, activateImmediately = true) {
      const cleanName = normalizeProfileName(rawName).slice(0, MAX_PROFILE_NAME_LENGTH);
      if (!cleanName) {
        return { ok: false, error: "يرجى إدخال اسم صالح للمجموعة." };
      }

      const key = normalizeCompareKey(cleanName);
      const duplicate = this._data.profiles.some((p) => normalizeCompareKey(p.name) === key);
      if (duplicate) {
        return { ok: false, error: `توجد مجموعة بنفس الاسم «${cleanName}» بالفعل.` };
      }

      const newProfile = {
        id: generateProfileId(),
        name: cleanName,
        isDefault: false,
        createdAt: Date.now(),
        playedQuestionIds: [],
        lastPlayedAt: {}
      };

      this._data.profiles.push(newProfile);
      this._playedSets.set(newProfile.id, new Set());
      if (activateImmediately) {
        this._data.activeProfileId = newProfile.id;
      }
      this._save();

      return {
        ok: true,
        profile: {
          id: newProfile.id,
          name: newProfile.name,
          isDefault: false,
          createdAt: newProfile.createdAt,
          playedCount: 0
        }
      };
    }

    deleteProfile(profileId) {
      if (!profileId || profileId === DEFAULT_PROFILE_ID) {
        return { ok: false, error: "لا يمكن حذف الملف الافتراضي «عام»، يمكنك تصفير سجله بدلاً من ذلك." };
      }
      const idx = this._data.profiles.findIndex((p) => p.id === profileId && !p.isDefault);
      if (idx === -1) {
        return { ok: false, error: "المجموعة المطلوب حذفها غير موجودة." };
      }

      const removed = this._data.profiles[idx];
      this._data.profiles.splice(idx, 1);
      this._playedSets.delete(profileId);

      if (this._data.activeProfileId === profileId) {
        this._data.activeProfileId = DEFAULT_PROFILE_ID;
      }
      this._save();
      return { ok: true, deletedName: removed.name, activeProfileId: this._data.activeProfileId };
    }

    isPlayed(questionId, profileId) {
      if (typeof questionId !== "string" || !questionId.trim()) return false;
      const p = this._getProfileInternal(profileId);
      const set = this._playedSets.get(p.id);
      return Boolean(set && set.has(questionId.trim()));
    }

    getLastPlayedAt(questionId, profileId) {
      if (typeof questionId !== "string" || !questionId.trim()) return 0;
      const p = this._getProfileInternal(profileId);
      const ts = Number(p.lastPlayedAt[questionId.trim()]);
      return Number.isFinite(ts) && ts > 0 ? ts : 0;
    }

    /**
     * أخذ لقطة غير قابلة للطفرة لحالة سؤال محدد قبل تعديله (لصالح نظام التراجع Undo)
     * @param {string} questionId
     * @param {string} [profileId]
     * @returns {QuestionHistorySnapshot}
     */
    captureQuestionSnapshot(questionId, profileId) {
      const qId = typeof questionId === "string" ? questionId.trim() : "";
      const p = this._getProfileInternal(profileId);
      const set = this._playedSets.get(p.id);
      const wasPlayed = Boolean(qId && set && set.has(qId));
      const ts = qId && Object.prototype.hasOwnProperty.call(p.lastPlayedAt, qId)
        ? Number(p.lastPlayedAt[qId])
        : null;

      return Object.freeze({
        profileId: p.id,
        questionId: qId,
        wasPlayed,
        lastPlayedAt: Number.isFinite(ts) && ts > 0 ? ts : null
      });
    }

    markQuestionPlayed(questionId, timestamp = Date.now(), profileId) {
      if (typeof questionId !== "string" || !questionId.trim()) return false;
      const qId = questionId.trim();
      const p = this._getProfileInternal(profileId);
      let set = this._playedSets.get(p.id);
      if (!set) {
        set = new Set(p.playedQuestionIds);
        this._playedSets.set(p.id, set);
      }

      if (!set.has(qId)) {
        set.add(qId);
        p.playedQuestionIds.push(qId);
      }
      const safeTs = Number.isFinite(Number(timestamp)) && Number(timestamp) > 0 ? Math.floor(Number(timestamp)) : Date.now();
      p.lastPlayedAt[qId] = safeTs;
      this._save();
      return true;
    }

    /**
     * استعادة حالة سؤال محدد من لقطة التراجع (Undo)
     * @param {QuestionHistorySnapshot | null | undefined} snapshot
     */
    restoreQuestionSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== "object" || !snapshot.questionId) return false;
      const qId = String(snapshot.questionId).trim();
      if (!qId) return false;

      const p = this._getProfileInternal(snapshot.profileId);
      let set = this._playedSets.get(p.id);
      if (!set) {
        set = new Set(p.playedQuestionIds);
        this._playedSets.set(p.id, set);
      }

      if (snapshot.wasPlayed) {
        if (!set.has(qId)) {
          set.add(qId);
          p.playedQuestionIds.push(qId);
        }
        p.lastPlayedAt[qId] =
          Number.isFinite(Number(snapshot.lastPlayedAt)) && Number(snapshot.lastPlayedAt) > 0
            ? Math.floor(Number(snapshot.lastPlayedAt))
            : 1;
      } else {
        if (set.has(qId)) {
          set.delete(qId);
          p.playedQuestionIds = p.playedQuestionIds.filter((id) => id !== qId);
        }
        delete p.lastPlayedAt[qId];
      }

      this._save();
      return true;
    }

    resetProfileHistory(profileId) {
      const p = this._getProfileInternal(profileId);
      const clearedCount = p.playedQuestionIds.length;
      p.playedQuestionIds = [];
      p.lastPlayedAt = {};
      this._playedSets.set(p.id, new Set());
      this._save();
      return { profileId: p.id, profileName: p.name, clearedCount };
    }

    /**
     * اختيار ذكي لأسئلة مستوى نقاط داخل فئة معينة:
     * 1) الأولوية المطلقة للأسئلة غير الموجودة في playedQuestionIds للملف النشط (عشوائياً).
     * 2) عند النفاد: الاستكمال تلقائياً من الأقدم لعباً (lastPlayedAt الأصغر).
     *
     * @param {Array<Object>} tierQuestions
     * @param {number} [count=2]
     * @param {string} [profileId]
     * @returns {{ picked: Array<{ question: Object, recycled: boolean }>, recycledCount: number }}
     */
    selectQuestionsForTier(tierQuestions, count = 2, profileId) {
      const validQuestions = Array.isArray(tierQuestions)
        ? tierQuestions.filter((q) => q && typeof q === "object" && typeof q.id === "string" && q.id.trim())
        : [];
      const p = this._getProfileInternal(profileId);
      const playedSet = this._playedSets.get(p.id) || new Set();

      const unplayed = [];
      const played = [];

      validQuestions.forEach((q) => {
        if (playedSet.has(q.id)) {
          played.push(q);
        } else {
          unplayed.push(q);
        }
      });

      const shuffledUnplayed = shuffleCopy(unplayed);
      const picked = [];
      let recycledCount = 0;

      for (let i = 0; i < shuffledUnplayed.length && picked.length < count; i++) {
        picked.push({ question: shuffledUnplayed[i], recycled: false });
      }

      if (picked.length < count && played.length > 0) {
        // ترتيب تصاعدي حسب lastPlayedAt (الأقدم لعباً أولاً) مع كسر تعادل عشوائي
        const decoratedPlayed = shuffleCopy(played).map((q, randomRank) => ({
          question: q,
          ts: Number(p.lastPlayedAt[q.id]) || 0,
          randomRank
        }));

        decoratedPlayed.sort((a, b) => {
          if (a.ts !== b.ts) return a.ts - b.ts;
          return a.randomRank - b.randomRank;
        });

        const needed = count - picked.length;
        for (let i = 0; i < decoratedPlayed.length && i < needed; i++) {
          picked.push({ question: decoratedPlayed[i].question, recycled: true });
          recycledCount++;
        }
      }

      return { picked, recycledCount };
    }

    getCategoryNewCount(category, profileId) {
      if (!category || !Array.isArray(category.questions)) return 0;
      const p = this._getProfileInternal(profileId);
      const playedSet = this._playedSets.get(p.id) || new Set();
      let newCount = 0;
      for (let i = 0; i < category.questions.length; i++) {
        const q = category.questions[i];
        if (q && !playedSet.has(q.id)) {
          newCount++;
        }
      }
      return newCount;
    }

    getBankStatsForProfile(allCategories, profileId) {
      const p = this._getProfileInternal(profileId);
      const playedSet = this._playedSets.get(p.id) || new Set();
      const cats = Array.isArray(allCategories) ? allCategories : [];

      let totalQuestions = 0;
      let unplayedQuestions = 0;
      let completedCategories = 0;

      cats.forEach((cat) => {
        if (!cat || !Array.isArray(cat.questions)) return;
        const catTotal = cat.questions.length;
        totalQuestions += catTotal;
        let catUnplayed = 0;
        cat.questions.forEach((q) => {
          if (q && !playedSet.has(q.id)) {
            catUnplayed++;
          }
        });
        unplayedQuestions += catUnplayed;
        if (catTotal > 0 && catUnplayed === 0) {
          completedCategories++;
        }
      });

      const playedInBank = Math.max(0, totalQuestions - unplayedQuestions);
      const realTimestamps = Object.values(p.lastPlayedAt).filter(
        (ts) => Number.isFinite(ts) && ts > 1700000100000
      );
      const lastPlayedAt = realTimestamps.length > 0 ? Math.max(...realTimestamps) : null;

      return {
        profileId: p.id,
        profileName: p.name,
        isDefault: Boolean(p.isDefault),
        totalCategories: cats.length,
        completedCategories,
        total: totalQuestions,
        unplayed: unplayedQuestions,
        played: playedInBank,
        recordedIdsCount: p.playedQuestionIds.length,
        lastPlayedAt
      };
    }
  }

  window.SeenJeemHistoryStore = new HistoryStore();
})();
