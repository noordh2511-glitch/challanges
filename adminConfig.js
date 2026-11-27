/**
 * إعدادات صلاحيات الإدارة للمالك فقط (Admin Access Config — Pack 16)
 * -------------------------------------------------------------------
 * استبدل 'ADMIN_EMAIL_HERE' أدناه ببريدك الإلكتروني في حساب Google قبل النشر
 * ليظهر لك زر «🛡️ لوحة الإدارة» وأدوات تحديث الأسئلة والبلاغات والنسخ الاحتياطي حصراً.
 * أي مستخدم آخر (زائر أو مسجّل بحساب Google مختلف) لن يرى أي أدوات إدارة إطلاقاً.
 */
const ADMIN_EMAILS = ['noor.dh2511@gmail.com'];

(function () {
  "use strict";

  function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
  }

  function getConfiguredAdminEmails() {
    if (!Array.isArray(ADMIN_EMAILS)) return [];
    return ADMIN_EMAILS.map(normalizeEmail).filter(
      (e) => Boolean(e) && e !== "admin_email_here" && e.includes("@")
    );
  }

  /**
   * التحقق الصارم من صلاحية المالك:
   * تعيد true فقط إذا كان المستخدم مسجّلاً بحساب Google (غير مجهول)
   * وبريده الإلكتروني مطابق لأحد الإيميلات المعتمدة في ADMIN_EMAILS.
   */
  function isAdminUser(user) {
    if (!user || typeof user !== "object") return false;
    if (user.isAnonymous === true) return false;
    if (typeof user.providerId === "string" && user.providerId === "anonymous") return false;
    if (
      Array.isArray(user.providerData) &&
      user.providerData.length > 0 &&
      !user.providerData.some((p) => p && p.providerId === "google.com")
    ) {
      return false;
    }
    const email = normalizeEmail(user.email);
    if (!email) return false;
    const allowed = getConfiguredAdminEmails();
    return allowed.includes(email);
  }

  function isCurrentUserAdmin() {
    const cs = window.SeenJeemCloudSync;
    if (!cs || typeof cs.getState !== "function") return false;
    const st = cs.getState();
    if (!st || !st.signedIn || !st.user) return false;
    return isAdminUser(st.user);
  }

  window.ADMIN_EMAILS = ADMIN_EMAILS;
  window.SeenJeemAdminConfig = {
    ADMIN_EMAILS,
    getConfiguredAdminEmails,
    isAdminUser,
    isCurrentUserAdmin
  };
})();
