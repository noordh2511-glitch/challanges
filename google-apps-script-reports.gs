/**
 * =========================================================================
 * سكربت استقبال بلاغات الأسئلة تلقائياً لـ «سين جيم» (Seen Jeem Bank)
 * =========================================================================
 * طريقة التفعيل داخل ملف Google Sheets الخاص ببنك الأسئلة:
 * 1) افتح ملف الشيت ← الإضافات (Extensions) ← Apps Script.
 * 2) الصق هذا الكود بالكامل داخل ملف Code.gs واضغط حفظ (Ctrl+S).
 * 3) (اختياري ومستحسن): عيّن قيمة نصية سرية في REPORT_SECRET أدناه ثم أدخل نفس القيمة داخل التطبيق.
 * 4) اضغط «نشر (Deploy)» ← «نشر جديد (New deployment)» ← اختر «تطبيق ويب (Web app)»:
 *    - Execute as: Me (أنا)
 *    - Who has access: Anyone (أي شخص)
 * 5) انسخ رابط Web App (ينتهي بـ /exec) والصقه داخل «سين جيم» ← إدارة البنك ← إرسال البلاغات التلقائي إلى Google Sheets.
 */

// رمز أمان اختياري لمنع الإرسال العشوائي (اتركه فارغاً "" لتعطيل التحقق)
var REPORT_SECRET = "";
var REPORTS_SHEET_NAME = "Flagged_Reports";

var HEADERS = [
  "التاريخ",
  "المعرّف",
  "الفئة",
  "النقاط",
  "النوع",
  "نص السؤال",
  "الإجابة",
  "سبب البلاغ",
  "ملاحظة المقدّم",
  "الحالة",
  "reportId"
];

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getOrCreateReportsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REPORTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(REPORTS_SHEET_NAME);
    sheet.setRightToLeft(true);
    sheet.appendRow(HEADERS);
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange
      .setFontWeight("bold")
      .setBackground("#0f172a")
      .setFontColor("#ffffff")
      .setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 155); // التاريخ
    sheet.setColumnWidth(2, 120); // المعرّف
    sheet.setColumnWidth(3, 140); // الفئة
    sheet.setColumnWidth(6, 300); // نص السؤال
    sheet.setColumnWidth(7, 200); // الإجابة
    sheet.setColumnWidth(8, 150); // سبب البلاغ
    sheet.setColumnWidth(9, 240); // ملاحظة المقدّم
    sheet.setColumnWidth(10, 120); // الحالة
  }
  return sheet;
}

function isDuplicateReportId(sheet, reportId) {
  if (!reportId) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  var ids = sheet.getRange(2, HEADERS.length, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(reportId).trim()) {
      return true;
    }
  }
  return false;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "Empty request body" });
    }

    var data = JSON.parse(e.postData.contents);

    // التحقق من رمز الأمان السري إذا كان مُعرَّفاً
    if (REPORT_SECRET && String(data.secret || "") !== String(REPORT_SECRET)) {
      return jsonResponse({ ok: false, error: "Invalid REPORT_SECRET" });
    }

    var sheet = getOrCreateReportsSheet();
    var reportId = String(data.reportId || "").trim();

    if (reportId && isDuplicateReportId(sheet, reportId)) {
      return jsonResponse({ ok: true, status: "duplicate", reportId: reportId });
    }

    var ts = data.reportedAt ? new Date(Number(data.reportedAt)) : new Date();
    var formattedDate = Utilities.formatDate(
      ts,
      Session.getScriptTimeZone() || "Asia/Amman",
      "yyyy-MM-dd HH:mm"
    );

    var row = [
      formattedDate,
      String(data.questionId || ""),
      String(data.categoryName || data.categoryId || ""),
      Number(data.points) || 200,
      String(data.visualType || "normal"),
      String(data.questionText || ""),
      String(data.answerText || ""),
      String(data.reasonLabel || data.reason || ""),
      String(data.note || ""),
      data.isTest ? "صف تجريبي" : "قيد المراجعة",
      reportId
    ];

    sheet.appendRow(row);
    return jsonResponse({ ok: true, status: "saved", reportId: reportId });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: (err && err.message) ? err.message : String(err)
    });
  }
}

function doGet() {
  return jsonResponse({
    ok: true,
    service: "Seen Jeem Flagged Reports Webhook",
    sheet: REPORTS_SHEET_NAME
  });
}
