/**
 * صانع الفئات الخاصة البصري والصوتي (Custom Pack Builder — Pack 12)
 * - يدعم إنشاء وتعديل فئات خاصة مع جميع أنواع الأسئلة:
 *   normal | blur | zoom | memory | differences (أوجد الفروقات) | audio (تحدي صوتي) | multi-image
 * - يدعم حقل answerImage اختياري لكل أنواع الأسئلة (رفع مضغوط عبر compressImageFile أو رابط + معاينة + حذف)
 * - يدعم رفع ملفات صوتية (≤ 2MB DataURL) أو لصق رابط مباشر مع audioStart/audioEnd وزر «▶️ اختبار المقطع»
 * - يدعم تصدير/استيراد الفئات المنفردة (JSON) والاندماج الكامل مع IndexedDB و backupManager.js
 */
(function () {
  "use strict";

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function makeQuestionDraft() {
    return {
      id: `cq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      points: 200,
      visualType: "normal",
      question: "",
      answer: "",
      hint: "",
      explanation: "",
      questionImage: "",
      answerImage: "",
      differencesCount: 5,
      blurLevel: 18,
      zoomLevel: 3.8,
      zoomOrigin: "center",
      memorySeconds: 10,
      audioUrl: "",
      audioStart: "",
      audioEnd: ""
    };
  }

  function makePackDraft() {
    return {
      id: `custom_${Date.now().toString(36)}`,
      name: "",
      icon: "✨",
      color: "#06b6d4",
      description: "",
      group: "general",
      questions: []
    };
  }

  class CustomPackBuilder {
    constructor() {
      this.modalEl = null;
      this.bodyEl = null;
      this.isOpenFlag = false;
      this.view = "list"; // "list" | "editor"
      this.packs = [];
      this.draftPack = makePackDraft();
      this.draftQ = makeQuestionDraft();
      this.editingQuestionIdx = -1;
      this.previewPlayer = null;
      this.previewPlaying = false;
      this.feedback = { type: "", text: "" };
    }

    init() {
      this.modalEl = document.getElementById("custom-pack-builder-modal");
      this.bodyEl = document.getElementById("custom-pack-builder-body");
      document.getElementById("btn-close-custom-pack-builder")?.addEventListener("click", () => this.close());
      if (this.modalEl) {
        this.modalEl.addEventListener("click", (e) => {
          if (e.target === this.modalEl) this.close();
        });
      }
    }

    _toast(msg, kind = "info") {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.showToast === "function") {
        window.SeenJeemHostBridge.showToast(msg, kind);
      }
    }

    _stopPreviewAudio() {
      if (this.previewPlayer) {
        try {
          this.previewPlayer.stop();
        } catch (_err) {}
      }
      this.previewPlaying = false;
    }

    async open(editPackId = null) {
      if (!this.modalEl) this.init();
      if (!this.modalEl) return;
      const store = window.SeenJeemCustomPacksStore;
      this.packs = store ? await store.getAll() : [];
      this.feedback = { type: "", text: "" };
      if (editPackId) {
        const found = this.packs.find((p) => p.id === editPackId);
        if (found) {
          this.draftPack = JSON.parse(JSON.stringify(found));
          this.draftQ = makeQuestionDraft();
          this.editingQuestionIdx = -1;
          this.view = "editor";
        } else {
          this.view = "list";
        }
      } else {
        this.view = "list";
      }
      this.isOpenFlag = true;
      this.modalEl.classList.add("open");
      this.modalEl.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      this._render();
    }

    close() {
      this._stopPreviewAudio();
      this.isOpenFlag = false;
      if (this.modalEl) {
        this.modalEl.classList.remove("open");
        this.modalEl.setAttribute("aria-hidden", "true");
      }
      const anyOpen = document.querySelector(".modal-overlay.open");
      if (!anyOpen) document.body.style.overflow = "";
    }

    _notifyAppPacksChanged() {
      if (window.SeenJeemHostBridge && typeof window.SeenJeemHostBridge.refreshCustomPacks === "function") {
        window.SeenJeemHostBridge.refreshCustomPacks();
      }
    }

    _setFeedback(type, text) {
      this.feedback = { type, text };
      const box = this.bodyEl && this.bodyEl.querySelector("#cpb-feedback-box");
      if (box) {
        box.hidden = !text;
        box.className = `bank-feedback-box ${type ? `is-${type}` : ""}`;
        box.textContent = text;
      }
    }

    _render() {
      if (!this.bodyEl) return;
      if (this.view === "list") {
        this._renderListView();
      } else {
        this._renderEditorView();
      }
    }

    _renderListView() {
      const packsHtml =
        this.packs.length === 0
          ? `<div class="empty-inline-note">لا توجد فئات خاصة منشأة بعد. اضغط «➕ إنشاء فئة جديدة» لبناء أسئلة نصية، فروقات، أو تحديات صوتية!</div>`
          : this.packs
              .map(
                (p) => `
              <article class="cpb-pack-card" style="border-right:4px solid ${escapeHtml(p.color || "#06b6d4")}">
                <div class="cpb-pack-info">
                  <div class="cpb-pack-title">${escapeHtml(p.icon || "✨")} <strong>${escapeHtml(p.name)}</strong></div>
                  <div class="cpb-pack-meta">
                    <span>${(p.questions || []).length} سؤال</span>
                    <span>•</span>
                    <span>معرّف: <code>${escapeHtml(p.id)}</code></span>
                  </div>
                </div>
                <div class="cpb-pack-actions">
                  <button type="button" class="btn btn-secondary btn-xs" data-cpb-edit="${escapeHtml(p.id)}">✏️ تعديل</button>
                  <button type="button" class="btn btn-gold-outline btn-xs" data-cpb-export="${escapeHtml(p.id)}">⬇️ تصدير الفئة</button>
                  <button type="button" class="btn btn-danger-outline btn-xs" data-cpb-del="${escapeHtml(p.id)}">🗑️</button>
                </div>
              </article>
            `
              )
              .join("");

      this.bodyEl.innerHTML = `
        <div class="cpb-toolbar">
          <button type="button" id="cpb-btn-new-pack" class="btn btn-primary btn-sm">➕ إنشاء فئة خاصة جديدة</button>
          <label for="cpb-import-file" class="btn btn-secondary btn-sm cpb-file-label">⬆️ استيراد فئة خاصة</label>
          <input type="file" id="cpb-import-file" accept=".json,application/json" hidden />
        </div>
        <div id="cpb-feedback-box" class="bank-feedback-box ${this.feedback.type ? `is-${this.feedback.type}` : ""}" ${this.feedback.text ? "" : "hidden"}>${escapeHtml(this.feedback.text)}</div>
        <div class="cpb-packs-list">${packsHtml}</div>
      `;

      this.bodyEl.querySelector("#cpb-btn-new-pack")?.addEventListener("click", () => {
        this.draftPack = makePackDraft();
        this.draftQ = makeQuestionDraft();
        this.editingQuestionIdx = -1;
        this.feedback = { type: "", text: "" };
        this.view = "editor";
        this._render();
      });

      this.bodyEl.querySelector("#cpb-import-file")?.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const list = Array.isArray(parsed)
            ? parsed
            : parsed && parsed.pack
              ? [parsed.pack]
              : parsed && parsed.id
                ? [parsed]
                : [];
          const store = window.SeenJeemCustomPacksStore;
          const res = store ? await store.importPacks(list, "merge") : { ok: false, error: "المخزن غير متاح" };
          if (res.ok) {
            this.packs = await store.getAll();
            this._notifyAppPacksChanged();
            this._render();
            this._setFeedback("success", `✅ تم استيراد ${res.importedCount} فئة خاصة بنجاح!`);
            this._toast(`✅ تم استيراد الفئة الخاصة بنجاح`, "success");
          } else {
            this._setFeedback("error", `❌ ${res.error || "تعذّر استيراد الملف."}`);
          }
        } catch (_err) {
          this._setFeedback("error", "❌ الملف المختار غير صالح.");
        }
        e.target.value = "";
      });

      this.bodyEl.querySelectorAll("[data-cpb-edit]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const found = this.packs.find((p) => p.id === btn.dataset.cpbEdit);
          if (!found) return;
          this.draftPack = JSON.parse(JSON.stringify(found));
          this.draftQ = makeQuestionDraft();
          this.editingQuestionIdx = -1;
          this.feedback = { type: "", text: "" };
          this.view = "editor";
          this._render();
        });
      });

      this.bodyEl.querySelectorAll("[data-cpb-export]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const store = window.SeenJeemCustomPacksStore;
          if (store && store.downloadPackJson(btn.dataset.cpbExport)) {
            this._toast("⬇️ تم تنزيل ملف الفئة الخاصة", "success");
          }
        });
      });

      this.bodyEl.querySelectorAll("[data-cpb-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const store = window.SeenJeemCustomPacksStore;
          if (!store) return;
          await store.deletePack(btn.dataset.cpbDel);
          this.packs = await store.getAll();
          this._notifyAppPacksChanged();
          this._render();
          this._toast("🗑️ تم حذف الفئة الخاصة", "info");
        });
      });
    }

    _syncPackMetaFromInputs() {
      const nameEl = this.bodyEl && this.bodyEl.querySelector("#cpb-pack-name");
      const iconEl = this.bodyEl && this.bodyEl.querySelector("#cpb-pack-icon");
      const colorEl = this.bodyEl && this.bodyEl.querySelector("#cpb-pack-color");
      const descEl = this.bodyEl && this.bodyEl.querySelector("#cpb-pack-desc");
      if (nameEl) this.draftPack.name = nameEl.value.trim();
      if (iconEl) this.draftPack.icon = iconEl.value.trim() || "✨";
      if (colorEl) this.draftPack.color = colorEl.value || "#06b6d4";
      if (descEl) this.draftPack.description = descEl.value.trim();
    }

    _syncQuestionDraftFromInputs() {
      const q = this.draftQ;
      const g = (sel) => this.bodyEl && this.bodyEl.querySelector(sel);
      if (g("#cpb-q-points")) q.points = Number(g("#cpb-q-points").value) || 200;
      if (g("#cpb-q-vtype")) q.visualType = g("#cpb-q-vtype").value || "normal";
      if (g("#cpb-q-text")) q.question = g("#cpb-q-text").value;
      if (g("#cpb-q-answer")) q.answer = g("#cpb-q-answer").value;
      if (g("#cpb-q-hint")) q.hint = g("#cpb-q-hint").value;
      if (g("#cpb-q-exp")) q.explanation = g("#cpb-q-exp").value;
      if (g("#cpb-q-img-url")) q.questionImage = g("#cpb-q-img-url").value.trim();
      if (g("#cpb-a-img-url")) q.answerImage = g("#cpb-a-img-url").value.trim();
      if (g("#cpb-q-diff-count")) q.differencesCount = Math.min(20, Math.max(1, Number(g("#cpb-q-diff-count").value) || 5));
      if (g("#cpb-q-audio-url")) q.audioUrl = g("#cpb-q-audio-url").value.trim();
      if (g("#cpb-q-audio-start")) q.audioStart = g("#cpb-q-audio-start").value.trim();
      if (g("#cpb-q-audio-end")) q.audioEnd = g("#cpb-q-audio-end").value.trim();
    }

    _renderEditorView() {
      const p = this.draftPack;
      const q = this.draftQ;
      const vt = q.visualType || "normal";
      const isDiff = vt === "differences";
      const isAudio = vt === "audio";

      const vtLabels = {
        normal: "📝 نصي / صورة عادية",
        differences: "🔍 أوجد الفروقات (differences)",
        audio: "🎵 تحدي صوتي (audio)",
        blur: "🌫️ صورة مغبّشة (blur)",
        zoom: "🔎 صورة مُقرّبة (zoom)",
        memory: "🧠 اختبار ذاكرة (memory)"
      };

      const questionsListHtml =
        p.questions.length === 0
          ? `<div class="empty-inline-note">أضف أسئلة للفئة أدناه (يُفضّل 6 أسئلة على الأقل: 2×200، 2×400، 2×600 للّوح الكامل).</div>`
          : p.questions
              .map(
                (item, idx) => `
              <div class="cpb-q-row${idx === this.editingQuestionIdx ? " is-editing" : ""}">
                <div class="cpb-q-row-info">
                  <span class="q-points-pill pts-${item.points}">${item.points}</span>
                  <span class="cpb-q-type-tag">${escapeHtml(vtLabels[item.visualType] || item.visualType || "normal")}</span>
                  <strong class="cpb-q-row-text">${escapeHtml(item.question)}</strong>
                  ${item.answerImage ? `<span class="cpb-mini-badge">🖼️ صورة إجابة</span>` : ""}
                  ${item.visualType === "differences" && item.differencesCount ? `<span class="cpb-mini-badge">🔍 ${item.differencesCount} فروقات</span>` : ""}
                  ${item.visualType === "audio" && item.audioUrl ? `<span class="cpb-mini-badge">🎵 مقطع صوتي</span>` : ""}
                </div>
                <div class="cpb-q-row-actions">
                  <button type="button" class="btn btn-ghost btn-xxs" data-cpb-q-edit="${idx}">✏️</button>
                  <button type="button" class="btn btn-danger-outline btn-xxs" data-cpb-q-del="${idx}">✕</button>
                </div>
              </div>
            `
              )
              .join("");

      this.bodyEl.innerHTML = `
        <div class="cpb-editor-top">
          <button type="button" id="cpb-btn-back" class="btn btn-ghost btn-xs">↩️ العودة لقائمة الفئات</button>
          <div class="cpb-editor-top-actions">
            <button type="button" id="cpb-btn-save-pack" class="btn btn-primary btn-sm">💾 حفظ الفئة في البنك</button>
          </div>
        </div>

        <div id="cpb-feedback-box" class="bank-feedback-box ${this.feedback.type ? `is-${this.feedback.type}` : ""}" ${this.feedback.text ? "" : "hidden"}>${escapeHtml(this.feedback.text)}</div>

        <section class="cpb-section">
          <h3 class="cpb-section-title">1️⃣ بيانات الفئة</h3>
          <div class="cpb-meta-grid">
            <div>
              <label for="cpb-pack-name" class="input-label">اسم الفئة *</label>
              <input type="text" id="cpb-pack-name" class="text-input" value="${escapeHtml(p.name)}" placeholder="مثال: تحديات صوتية وفروقات" maxlength="40" />
            </div>
            <div>
              <label for="cpb-pack-icon" class="input-label">الأيقونة</label>
              <input type="text" id="cpb-pack-icon" class="text-input" value="${escapeHtml(p.icon || "✨")}" maxlength="6" />
            </div>
            <div>
              <label for="cpb-pack-color" class="input-label">اللون</label>
              <input type="color" id="cpb-pack-color" class="cpb-color-input" value="${escapeHtml(p.color || "#06b6d4")}" />
            </div>
            <div class="cpb-span-full">
              <label for="cpb-pack-desc" class="input-label">وصف مختصر (اختياري)</label>
              <input type="text" id="cpb-pack-desc" class="text-input" value="${escapeHtml(p.description || "")}" placeholder="وصف قصير للفئة..." maxlength="100" />
            </div>
          </div>
        </section>

        <section class="cpb-section">
          <h3 class="cpb-section-title">${this.editingQuestionIdx >= 0 ? "✏️ تعديل السؤال المحدد" : "2️⃣ إضافة سؤال جديد"}</h3>
          <div class="cpb-q-form-grid">
            <div>
              <label for="cpb-q-vtype" class="input-label">نوع السؤال</label>
              <select id="cpb-q-vtype" class="text-input">
                <option value="normal"${vt === "normal" ? " selected" : ""}>📝 نصي / صورة عادية (normal)</option>
                <option value="differences"${vt === "differences" ? " selected" : ""}>🔍 أوجد الفروقات (differences)</option>
                <option value="audio"${vt === "audio" ? " selected" : ""}>🎵 تحدي صوتي (audio)</option>
                <option value="blur"${vt === "blur" ? " selected" : ""}>🌫️ صورة مغبّشة (blur)</option>
                <option value="zoom"${vt === "zoom" ? " selected" : ""}>🔎 صورة مُقرّبة (zoom)</option>
                <option value="memory"${vt === "memory" ? " selected" : ""}>🧠 اختبار ذاكرة (memory)</option>
              </select>
            </div>
            <div>
              <label for="cpb-q-points" class="input-label">النقاط</label>
              <select id="cpb-q-points" class="text-input">
                <option value="200"${Number(q.points) === 200 ? " selected" : ""}>200 نقطة</option>
                <option value="400"${Number(q.points) === 400 ? " selected" : ""}>400 نقطة</option>
                <option value="600"${Number(q.points) === 600 ? " selected" : ""}>600 نقطة</option>
              </select>
            </div>
            <div class="cpb-span-full">
              <label for="cpb-q-text" class="input-label">نص السؤال *</label>
              <input type="text" id="cpb-q-text" class="text-input" value="${escapeHtml(q.question)}" placeholder="اكتب السؤال هنا..." maxlength="240" />
            </div>
            <div>
              <label for="cpb-q-answer" class="input-label">الإجابة الصحيحة *</label>
              <input type="text" id="cpb-q-answer" class="text-input" value="${escapeHtml(q.answer)}" placeholder="الإجابة الصحيحة..." maxlength="180" />
            </div>
            <div>
              <label for="cpb-q-hint" class="input-label">تلميح اختياري</label>
              <input type="text" id="cpb-q-hint" class="text-input" value="${escapeHtml(q.hint || "")}" placeholder="تلميح يظهر عند الطلب..." maxlength="180" />
            </div>
            <div class="cpb-span-full">
              <label for="cpb-q-exp" class="input-label">توضيح إضافي بعد الكشف (اختياري)</label>
              <input type="text" id="cpb-q-exp" class="text-input" value="${escapeHtml(q.explanation || "")}" placeholder="معلومة إضافية أو شرح أماكن الفروقات..." maxlength="240" />
            </div>

            ${
              isDiff
                ? `
              <div class="cpb-special-box cpb-span-full">
                <div class="cpb-special-head">
                  <strong>🔍 إعدادات جولة «أوجد الفروقات»</strong>
                  <span>💡 نصيحة: ارفع صورة اللغز في «صورة السؤال» وصورة الحل المعلّمة بالدوائر في «صورة الإجابة».</span>
                </div>
                <div class="cpb-diff-input-row">
                  <label for="cpb-q-diff-count" class="input-label">عدد الفروقات المطلوب إيجادها (1–20):</label>
                  <input type="number" id="cpb-q-diff-count" class="text-input cpb-num-input" min="1" max="20" value="${Number(q.differencesCount) || 5}" />
                </div>
              </div>
            `
                : ""
            }

            ${
              isAudio
                ? `
              <div class="cpb-special-box cpb-span-full">
                <div class="cpb-special-head">
                  <strong>🎵 إعدادات التحدي الصوتي (MP3 / OGG / M4A / WAV)</strong>
                  <span>الحد الأقصى للملف المرفوع من الجهاز: 2MB (أو الصق رابطاً مباشراً).</span>
                </div>
                <div class="cpb-media-input-row">
                  <input type="text" id="cpb-q-audio-url" class="text-input" dir="ltr" value="${escapeHtml(q.audioUrl || "")}" placeholder="https://example.com/clip.mp3 أو ارفع ملفاً صوتياً..." />
                  <label for="cpb-q-audio-file" class="btn btn-secondary btn-xs cpb-file-label">📁 رفع صوت (≤2MB)</label>
                  <input type="file" id="cpb-q-audio-file" accept="audio/*,.mp3,.wav,.ogg,.m4a" hidden />
                  ${q.audioUrl ? `<button type="button" id="cpb-btn-clear-audio" class="btn btn-danger-outline btn-xxs">✕ حذف</button>` : ""}
                </div>
                <div class="cpb-audio-trim-row">
                  <div>
                    <label for="cpb-q-audio-start" class="input-label">بداية المقطع بالثواني (audioStart)</label>
                    <input type="number" id="cpb-q-audio-start" class="text-input" min="0" step="0.5" value="${escapeHtml(String(q.audioStart !== undefined ? q.audioStart : ""))}" placeholder="0" />
                  </div>
                  <div>
                    <label for="cpb-q-audio-end" class="input-label">نهاية المقطع بالثواني (audioEnd)</label>
                    <input type="number" id="cpb-q-audio-end" class="text-input" min="0" step="0.5" value="${escapeHtml(String(q.audioEnd !== undefined ? q.audioEnd : ""))}" placeholder="15" />
                  </div>
                  <div class="cpb-audio-test-wrap">
                    <button type="button" id="cpb-btn-test-audio" class="btn btn-amber btn-xs" ${q.audioUrl ? "" : "disabled"}>
                      ${this.previewPlaying ? "⏹️ إيقاف المعاينة" : "▶️ اختبار المقطع"}
                    </button>
                  </div>
                </div>
              </div>
            `
                : ""
            }

            ${
              !isAudio
                ? `
              <div class="cpb-media-box cpb-span-full">
                <label for="cpb-q-img-url" class="input-label">🖼️ صورة السؤال (اختياري — رابط أو رفع من الجهاز):</label>
                <div class="cpb-media-input-row">
                  <input type="text" id="cpb-q-img-url" class="text-input" dir="ltr" value="${escapeHtml(q.questionImage || "")}" placeholder="https://... أو ارفع صورة مضغوطة..." />
                  <label for="cpb-q-img-file" class="btn btn-secondary btn-xs cpb-file-label">📁 رفع صورة</label>
                  <input type="file" id="cpb-q-img-file" accept="image/*" hidden />
                  ${q.questionImage ? `<button type="button" id="cpb-btn-clear-qimg" class="btn btn-danger-outline btn-xxs">✕ حذف</button>` : ""}
                </div>
                ${q.questionImage ? `<div class="cpb-img-preview"><img src="${escapeHtml(q.questionImage)}" alt="معاينة صورة السؤال" loading="lazy" decoding="async" onerror="this.hidden=true;if(this.nextElementSibling)this.nextElementSibling.hidden=false;" /><span class="img-fallback-inline" hidden>تعذّر تحميل الصورة حالياً</span></div>` : ""}
              </div>
            `
                : ""
            }

            <!-- حقل صورة الإجابة (answerImage) متاح اختيارياً لكل أنواع الأسئلة -->
            <div class="cpb-media-box cpb-span-full is-answer-media">
              <label for="cpb-a-img-url" class="input-label">✅ صورة الإجابة (اختياري وتظهر عند الكشف فقط):</label>
              <div class="cpb-media-input-row">
                <input type="text" id="cpb-a-img-url" class="text-input" dir="ltr" value="${escapeHtml(q.answerImage || "")}" placeholder="رابط صورة الإجابة أو الحل المعلّم..." />
                <label for="cpb-a-img-file" class="btn btn-gold-outline btn-xs cpb-file-label">📁 رفع صورة إجابة</label>
                <input type="file" id="cpb-a-img-file" accept="image/*" hidden />
                ${q.answerImage ? `<button type="button" id="cpb-btn-clear-aimg" class="btn btn-danger-outline btn-xxs">✕ حذف</button>` : ""}
              </div>
              ${q.answerImage ? `<div class="cpb-img-preview"><img src="${escapeHtml(q.answerImage)}" alt="معاينة صورة الإجابة" loading="lazy" decoding="async" onerror="this.hidden=true;if(this.nextElementSibling)this.nextElementSibling.hidden=false;" /><span class="img-fallback-inline" hidden>تعذّر تحميل الصورة حالياً</span></div>` : ""}
            </div>
          </div>

          <div class="cpb-q-form-actions">
            <button type="button" id="cpb-btn-commit-q" class="btn btn-steal-win btn-sm">
              ${this.editingQuestionIdx >= 0 ? "✔️ حفظ تعديل السؤال" : "➕ إضافة السؤال للفئة"}
            </button>
            ${
              this.editingQuestionIdx >= 0
                ? `<button type="button" id="cpb-btn-cancel-q-edit" class="btn btn-ghost btn-xs">إلغاء التعديل</button>`
                : ""
            }
          </div>
        </section>

        <section class="cpb-section">
          <h3 class="cpb-section-title">3️⃣ أسئلة الفئة (${p.questions.length})</h3>
          <div class="cpb-questions-list">${questionsListHtml}</div>
        </section>
      `;

      this._bindEditorEvents();
    }

    _bindEditorEvents() {
      const utils = window.SeenJeemCustomPacksUtils;

      this.bodyEl.querySelector("#cpb-btn-back")?.addEventListener("click", () => {
        this._stopPreviewAudio();
        this.view = "list";
        this._render();
      });

      this.bodyEl.querySelector("#cpb-q-vtype")?.addEventListener("change", () => {
        this._stopPreviewAudio();
        this._syncPackMetaFromInputs();
        this._syncQuestionDraftFromInputs();
        this._render();
      });

      this.bodyEl.querySelector("#cpb-q-img-file")?.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file || !utils) return;
        this._syncPackMetaFromInputs();
        this._syncQuestionDraftFromInputs();
        try {
          this.draftQ.questionImage = await utils.compressImageFile(file);
          this._render();
          this._setFeedback("success", "✅ تم ضغط وإرفاق صورة السؤال بنجاح.");
        } catch (err) {
          this._setFeedback("error", `❌ ${(err && err.message) || "تعذّر رفع الصورة."}`);
        }
      });

      this.bodyEl.querySelector("#cpb-a-img-file")?.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file || !utils) return;
        this._syncPackMetaFromInputs();
        this._syncQuestionDraftFromInputs();
        try {
          this.draftQ.answerImage = await utils.compressImageFile(file);
          this._render();
          this._setFeedback("success", "✅ تم ضغط وإرفاق صورة الإجابة بنجاح.");
        } catch (err) {
          this._setFeedback("error", `❌ ${(err && err.message) || "تعذّر رفع صورة الإجابة."}`);
        }
      });

      this.bodyEl.querySelector("#cpb-q-audio-file")?.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file || !utils) return;
        this._syncPackMetaFromInputs();
        this._syncQuestionDraftFromInputs();
        try {
          this.draftQ.audioUrl = await utils.readAudioFileAsDataUrl(file);
          this._render();
          this._setFeedback("success", `✅ تم إرفاق المقطع الصوتي (${(file.size / 1024).toFixed(0)}KB) بنجاح!`);
        } catch (err) {
          this._setFeedback("error", `❌ ${(err && err.message) || "تعذّر رفع الملف الصوتي."}`);
        }
      });

      this.bodyEl.querySelector("#cpb-btn-clear-qimg")?.addEventListener("click", () => {
        this._syncPackMetaFromInputs();
        this._syncQuestionDraftFromInputs();
        this.draftQ.questionImage = "";
        this._render();
      });

      this.bodyEl.querySelector("#cpb-btn-clear-aimg")?.addEventListener("click", () => {
        this._syncPackMetaFromInputs();
        this._syncQuestionDraftFromInputs();
        this.draftQ.answerImage = "";
        this._render();
      });

      this.bodyEl.querySelector("#cpb-btn-clear-audio")?.addEventListener("click", () => {
        this._stopPreviewAudio();
        this._syncPackMetaFromInputs();
        this._syncQuestionDraftFromInputs();
        this.draftQ.audioUrl = "";
        this._render();
      });

      this.bodyEl.querySelector("#cpb-q-audio-url")?.addEventListener("input", () => {
        const val = this.bodyEl.querySelector("#cpb-q-audio-url").value.trim();
        this.draftQ.audioUrl = val;
        const btn = this.bodyEl.querySelector("#cpb-btn-test-audio");
        if (btn) btn.disabled = !val;
      });

      this.bodyEl.querySelector("#cpb-btn-test-audio")?.addEventListener("click", async () => {
        this._syncQuestionDraftFromInputs();
        const acUtils = window.SeenJeemAudioChallengeUtils;
        if (!acUtils || !this.draftQ.audioUrl) return;
        if (this.previewPlaying) {
          this._stopPreviewAudio();
          const btn = this.bodyEl.querySelector("#cpb-btn-test-audio");
          if (btn) btn.textContent = "▶️ اختبار المقطع";
          return;
        }
        if (!this.previewPlayer) {
          this.previewPlayer = new acUtils.AudioChallengePlayer();
          this.previewPlayer.onChange((st) => {
            this.previewPlaying = st.playing;
            const btn = this.bodyEl && this.bodyEl.querySelector("#cpb-btn-test-audio");
            if (btn) btn.textContent = st.playing ? "⏹️ إيقاف المعاينة" : "▶️ اختبار المقطع";
          });
        }
        this.previewPlayer.load(this.draftQ.audioUrl, {
          start: this.draftQ.audioStart !== "" ? Number(this.draftQ.audioStart) : 0,
          end: this.draftQ.audioEnd !== "" ? Number(this.draftQ.audioEnd) : null,
          questionId: "preview"
        });
        const res = await this.previewPlayer.play();
        if (!res.ok) {
          this._setFeedback("warning", "⚠️ تعذّر تشغيل المعاينة — تأكد من صلاحية رابط/ملف الصوت.");
        }
      });

      this.bodyEl.querySelector("#cpb-btn-commit-q")?.addEventListener("click", () => {
        this._stopPreviewAudio();
        this._syncPackMetaFromInputs();
        this._syncQuestionDraftFromInputs();
        const q = this.draftQ;
        if (!q.question.trim() || !q.answer.trim()) {
          this._setFeedback("warning", "⚠️ يرجى إدخال نص السؤال والإجابة الصحيحة أولاً.");
          return;
        }
        if (q.visualType === "audio" && !q.audioUrl) {
          this._setFeedback("warning", "⚠️ يرجى لصق رابط صوتي أو رفع ملف صوتي لسؤال التحدي الصوتي.");
          return;
        }
        const entry = {
          id: q.id || `cq_${Date.now().toString(36)}`,
          categoryId: this.draftPack.id,
          points: Number(q.points) || 200,
          visualType: q.visualType || "normal",
          question: q.question.trim(),
          answer: q.answer.trim(),
          ...(q.hint.trim() ? { hint: q.hint.trim() } : {}),
          ...(q.explanation.trim() ? { explanation: q.explanation.trim() } : {}),
          ...(q.questionImage && q.visualType !== "audio" ? { questionImage: q.questionImage } : {}),
          ...(q.answerImage ? { answerImage: q.answerImage } : {}),
          ...(q.visualType === "differences" ? { differencesCount: Number(q.differencesCount) || 5 } : {}),
          ...(q.visualType === "audio"
            ? {
                audioUrl: q.audioUrl,
                ...(q.audioStart !== "" && Number.isFinite(Number(q.audioStart)) ? { audioStart: Number(q.audioStart) } : {}),
                ...(q.audioEnd !== "" && Number.isFinite(Number(q.audioEnd)) ? { audioEnd: Number(q.audioEnd) } : {})
              }
            : {})
        };

        if (this.editingQuestionIdx >= 0) {
          this.draftPack.questions[this.editingQuestionIdx] = entry;
          this.editingQuestionIdx = -1;
          this._setFeedback("success", "✔️ تم حفظ تعديل السؤال.");
        } else {
          this.draftPack.questions.push(entry);
          this._setFeedback("success", `✅ تمت إضافة السؤال (${this.draftPack.questions.length} سؤال في الفئة).`);
        }
        this.draftQ = makeQuestionDraft();
        this._render();
      });

      this.bodyEl.querySelector("#cpb-btn-cancel-q-edit")?.addEventListener("click", () => {
        this._stopPreviewAudio();
        this.editingQuestionIdx = -1;
        this.draftQ = makeQuestionDraft();
        this._render();
      });

      this.bodyEl.querySelectorAll("[data-cpb-q-edit]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this._stopPreviewAudio();
          const idx = Number(btn.dataset.cpbQEdit);
          const item = this.draftPack.questions[idx];
          if (!item) return;
          this.editingQuestionIdx = idx;
          this.draftQ = {
            ...makeQuestionDraft(),
            ...JSON.parse(JSON.stringify(item)),
            audioStart: item.audioStart !== undefined ? String(item.audioStart) : "",
            audioEnd: item.audioEnd !== undefined ? String(item.audioEnd) : ""
          };
          this._render();
        });
      });

      this.bodyEl.querySelectorAll("[data-cpb-q-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.cpbQDel);
          this.draftPack.questions.splice(idx, 1);
          if (this.editingQuestionIdx === idx) {
            this.editingQuestionIdx = -1;
            this.draftQ = makeQuestionDraft();
          }
          this._render();
        });
      });

      this.bodyEl.querySelector("#cpb-btn-save-pack")?.addEventListener("click", async () => {
        this._stopPreviewAudio();
        this._syncPackMetaFromInputs();
        if (!this.draftPack.name.trim()) {
          this._setFeedback("warning", "⚠️ يرجى كتابة اسم الفئة أولاً.");
          return;
        }
        if (this.draftPack.questions.length === 0) {
          this._setFeedback("warning", "⚠️ أضف سؤالاً واحداً على الأقل قبل حفظ الفئة.");
          return;
        }
        const store = window.SeenJeemCustomPacksStore;
        if (!store) return;
        const res = await store.savePack(this.draftPack);
        if (res.ok) {
          this.packs = await store.getAll();
          this._notifyAppPacksChanged();
          this.view = "list";
          this._render();
          this._setFeedback("success", `✅ تم حفظ الفئة «${res.pack.name}» (${res.pack.questions.length} سؤال) في البنك بنجاح!`);
          this._toast(`✅ تم حفظ الفئة الخاصة «${res.pack.name}»!`, "success");
        } else {
          this._setFeedback("error", `❌ ${res.error || "تعذّر حفظ الفئة."}`);
        }
      });
    }
  }

  window.SeenJeemCustomPackBuilder = new CustomPackBuilder();
})();
