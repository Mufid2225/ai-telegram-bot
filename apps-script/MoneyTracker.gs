/**
 * Google Apps Script Web App untuk MoneyTracker Bot Bridge.
 *
 * Cara pasang di Google Sheets MoneyTracker:
 * 1. Buka spreadsheet MoneyTracker -> menu Ekstensi -> Apps Script.
 * 2. Hapus isi default, tempel seluruh kode ini, lalu simpan (Ctrl+S).
 * 3. Isi SHEET_API_SECRET di bawah (atau lewat Project Settings -> Script Properties: SHEET_API_SECRET)
 *    dengan nilai acak yang sama persis dengan SHEET_API_SECRET di .env.local bot.
 * 4. (Opsional untuk Google Calendar) Pilih fungsi `authorizeCalendar` di toolbar atas editor Apps Script,
 *    klik Run, lalu klik Review permissions -> Allow.
 * 5. Klik Deploy -> New deployment (atau Manage deployments -> Edit -> New version jika update) -> Type: Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Salin Web app URL (/exec) ke SHEET_WEBHOOK_URL di .env.local bot.
 */

var FALLBACK_API_SECRET = "GANTI_DENGAN_SECRET_YANG_SAMA_DENGAN_ENV";

/**
 * Jalankan fungsi ini 1x dari editor Apps Script (tombol Run) untuk mengaktifkan izin Google Sheets + Google Calendar.
 */
function authorizeCalendar() {
  var cal = CalendarApp.getDefaultCalendar();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("Otorisasi aktif -> Sheet: " + ss.getName() + " | Calendar: " + cal.getName());
}

var MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getExpectedSecret() {
  var prop = PropertiesService.getScriptProperties().getProperty("SHEET_API_SECRET");
  return (prop && prop.trim()) ? prop.trim() : FALLBACK_API_SECRET;
}

function doGet() {
  return jsonResponse({ ok: true, service: "MoneyTracker Apps Script" });
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    var body = JSON.parse(raw);
    var expectedSecret = getExpectedSecret();
    if (!expectedSecret || expectedSecret === "GANTI_DENGAN_SECRET_YANG_SAMA_DENGAN_ENV") {
      return jsonResponse({ ok: false, error: "SHEET_API_SECRET belum diatur di Apps Script." });
    }
    if (!body || body.secret !== expectedSecret) {
      return jsonResponse({ ok: false, error: "Unauthorized: secret tidak cocok." });
    }

    var action = String(body.action || "");
    var data;

    if (action.indexOf("calendar_") === 0) {
      data = handleCalendarAction(action, body);
      return jsonResponse({ ok: true, data: data });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action.indexOf("targets_") === 0) {
      data = handleTargetAction(ss, action, body);
      return jsonResponse({ ok: true, data: data });
    }

    switch (action) {
      case "get_context":
        data = handleGetContext(ss);
        break;
      case "get_summary":
        data = handleGetSummary(ss, body);
        break;
      case "list_expenses":
        data = handleListExpenses(ss, body);
        break;
      case "add_expenses":
        data = handleAddExpenses(ss, body);
        break;
      case "update_expense":
        data = handleUpdateExpense(ss, body);
        break;
      case "delete_expense":
        data = handleDeleteExpense(ss, body);
        break;
      case "upsert_income":
        data = handleUpsertIncome(ss, body);
        break;
      case "get_income_overview":
        data = handleGetIncomeOverview(ss, body);
        break;
      case "update_allocations":
        data = handleUpdateAllocations(ss, body);
        break;
      case "get_usage":
        data = handleGetUsage(ss, body);
        break;
      default:
        return jsonResponse({ ok: false, error: "Action tidak dikenal: " + action });
    }

    return jsonResponse({ ok: true, data: data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function getDatabaseOptions(ss) {
  var dbSheet = ss.getSheetByName("Database");
  if (!dbSheet) throw new Error("Tab 'Database' tidak ditemukan.");
  var lastRow = Math.max(dbSheet.getLastRow(), 2);
  var values = dbSheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues();
  var banks = [];
  var categories = [];
  for (var i = 0; i < values.length; i++) {
    var bank = String(values[i][0] || "").trim();
    var cat = String(values[i][1] || "").trim();
    if (bank && banks.indexOf(bank) === -1) banks.push(bank);
    if (cat && categories.indexOf(cat) === -1) categories.push(cat);
  }
  return { banks: banks, categories: categories };
}

function getDashboardPeriod(ss) {
  var dash = ss.getSheetByName("Dashboard");
  if (!dash) return { year: new Date().getFullYear(), month: MONTHS_ID[new Date().getMonth()] };
  var yearVal = Number(dash.getRange("J3").getDisplayValue()) || new Date().getFullYear();
  var monthVal = String(dash.getRange("J4").getDisplayValue() || "").trim() || MONTHS_ID[new Date().getMonth()];
  return { year: yearVal, month: monthVal };
}

function parseNumber(val) {
  if (typeof val === "number") return isFinite(val) ? val : 0;
  var raw = String(val || "").trim();
  if (!raw) return 0;
  // Format Indonesia: 300.000,00 -> 300000.00
  if (/^-?[\d.]+,\d+$/.test(raw)) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else {
    raw = raw.replace(/[^\d.-]/g, "");
  }
  var n = Number(raw);
  return isFinite(n) ? n : 0;
}

function parseDateValue(rawVal, displayVal, tz) {
  if (Object.prototype.toString.call(rawVal) === "[object Date]" && !isNaN(rawVal.getTime())) {
    return {
      iso: Utilities.formatDate(rawVal, tz, "yyyy-MM-dd"),
      year: Number(Utilities.formatDate(rawVal, tz, "yyyy")),
      monthIndex: Number(Utilities.formatDate(rawVal, tz, "M")) - 1,
    };
  }
  var text = String(displayVal || rawVal || "").trim();
  if (!text) return null;
  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return {
      iso: Utilities.formatDate(parsed, tz, "yyyy-MM-dd"),
      year: parsed.getFullYear(),
      monthIndex: parsed.getMonth(),
    };
  }
  return { iso: text, year: null, monthIndex: -1 };
}

function isoToLocalDate(isoStr) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoStr || "").trim());
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function readIncomeSheetData(ss) {
  var sheet = ss.getSheetByName("Income");
  if (!sheet) throw new Error("Tab 'Income' tidak ditemukan.");
  var lastRow = Math.max(sheet.getLastRow(), 25);
  var lastCol = Math.max(sheet.getLastColumn(), 14);
  var raw = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var disp = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();

  var incomeHeaderRow = -1;
  var incomeTotalRow = -1;
  var allocHeaderRow = -1;
  var allocTotalRow = -1;

  for (var r = 0; r < raw.length; r++) {
    var colA = String(disp[r][0] || "").trim().toLowerCase();
    if (colA === "income" && incomeHeaderRow === -1) incomeHeaderRow = r + 1;
    else if (colA === "total" && incomeHeaderRow !== -1 && incomeTotalRow === -1) incomeTotalRow = r + 1;
    else if (colA === "alokasi" && allocHeaderRow === -1) allocHeaderRow = r + 1;
    else if (colA === "total" && allocHeaderRow !== -1 && allocTotalRow === -1) allocTotalRow = r + 1;
  }

  return {
    sheet: sheet,
    raw: raw,
    disp: disp,
    incomeHeaderRow: incomeHeaderRow,
    incomeTotalRow: incomeTotalRow,
    allocHeaderRow: allocHeaderRow,
    allocTotalRow: allocTotalRow,
  };
}

function findMonthCol(dispRow, monthName) {
  var target = String(monthName || "").trim().toLowerCase();
  for (var c = 0; c < dispRow.length; c++) {
    if (String(dispRow[c] || "").trim().toLowerCase() === target) return c + 1;
  }
  return -1;
}

function handleGetContext(ss) {
  var opts = getDatabaseOptions(ss);
  var incomeData = readIncomeSheetData(ss);
  var incomeSources = [];
  if (incomeData.incomeHeaderRow !== -1 && incomeData.incomeTotalRow !== -1) {
    for (var r = incomeData.incomeHeaderRow + 1; r < incomeData.incomeTotalRow; r++) {
      var name = String(incomeData.disp[r - 1][0] || "").trim();
      if (name) incomeSources.push(name);
    }
  }
  return {
    banks: opts.banks,
    categories: opts.categories,
    incomeSources: incomeSources,
    activeDashboardPeriod: getDashboardPeriod(ss),
  };
}

function readAllExpenses(ss) {
  var sheet = ss.getSheetByName("Expenses");
  if (!sheet) throw new Error("Tab 'Expenses' tidak ditemukan.");
  var tz = ss.getSpreadsheetTimeZone();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var raw = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var disp = sheet.getRange(2, 1, lastRow - 1, 8).getDisplayValues();
  var list = [];

  for (var i = 0; i < raw.length; i++) {
    var row = raw[i];
    var dRow = disp[i];
    var uraian = String(dRow[4] || "").trim();
    var nilai = parseNumber(row[7]);
    var parsedDate = parseDateValue(row[1], dRow[1], tz);

    if (!uraian && !nilai && !parsedDate) continue;

    var monthLabel = String(dRow[2] || "").trim();
    if (!monthLabel && parsedDate && parsedDate.monthIndex >= 0) {
      monthLabel = MONTHS_ID[parsedDate.monthIndex];
    }

    list.push({
      rowNumber: i + 2,
      checked: row[0] === true || String(dRow[0]).toLowerCase() === "true",
      date: parsedDate ? parsedDate.iso : "",
      year: parsedDate ? parsedDate.year : null,
      month: monthLabel,
      transaksi: String(dRow[3] || "").trim(),
      uraian: uraian,
      kategori: String(dRow[5] || "").trim(),
      bank: String(dRow[6] || "").trim(),
      nilai: nilai,
    });
  }
  return list;
}

function handleGetSummary(ss, params) {
  var active = getDashboardPeriod(ss);
  var month = String(params.month || active.month || MONTHS_ID[new Date().getMonth()]).trim();
  var year = Number(params.year) || active.year || new Date().getFullYear();

  var opts = getDatabaseOptions(ss);
  var incomeData = readIncomeSheetData(ss);
  var monthCol = incomeData.incomeHeaderRow !== -1
    ? findMonthCol(incomeData.disp[incomeData.incomeHeaderRow - 1], month)
    : -1;

  var incomeItems = [];
  var totalIncome = 0;
  if (monthCol !== -1 && incomeData.incomeHeaderRow !== -1 && incomeData.incomeTotalRow !== -1) {
    for (var r = incomeData.incomeHeaderRow + 1; r < incomeData.incomeTotalRow; r++) {
      var sourceName = String(incomeData.disp[r - 1][0] || "").trim();
      var amt = parseNumber(incomeData.raw[r - 1][monthCol - 1]);
      if (sourceName) {
        incomeItems.push({ source: sourceName, amount: amt });
        totalIncome += amt;
      }
    }
  }

  var allocMap = {};
  var allocOrder = [];
  var totalAlokasi = 0;
  if (incomeData.allocHeaderRow !== -1 && incomeData.allocTotalRow !== -1) {
    var allocMonthCol = findMonthCol(incomeData.disp[incomeData.allocHeaderRow - 1], month);
    for (var r2 = incomeData.allocHeaderRow + 1; r2 < incomeData.allocTotalRow; r2++) {
      var catName = String(incomeData.disp[r2 - 1][0] || "").trim();
      if (!catName) continue;
      var pct = parseNumber(incomeData.raw[r2 - 1][1]);
      var allocAmt = allocMonthCol !== -1 ? parseNumber(incomeData.raw[r2 - 1][allocMonthCol - 1]) : 0;
      allocMap[catName.toLowerCase()] = { kategori: catName, percent: pct, alokasi: allocAmt, realisasi: 0 };
      allocOrder.push(catName.toLowerCase());
      totalAlokasi += allocAmt;
    }
  }

  for (var c = 0; c < opts.categories.length; c++) {
    var key = opts.categories[c].toLowerCase();
    if (!allocMap[key]) {
      allocMap[key] = { kategori: opts.categories[c], percent: 0, alokasi: 0, realisasi: 0 };
      allocOrder.push(key);
    }
  }

  var allExpenses = readAllExpenses(ss);
  var totalRealisasi = 0;
  var monthLower = month.toLowerCase();

  for (var i = 0; i < allExpenses.length; i++) {
    var ex = allExpenses[i];
    if (!ex.checked) continue;
    if (String(ex.month || "").toLowerCase() !== monthLower) continue;
    if (ex.year && Number(ex.year) !== year) continue;

    totalRealisasi += ex.nilai;
    var catKey = String(ex.kategori || "").toLowerCase();
    if (!allocMap[catKey]) {
      allocMap[catKey] = { kategori: ex.kategori || "Lainnya", percent: 0, alokasi: 0, realisasi: 0 };
      allocOrder.push(catKey);
    }
    allocMap[catKey].realisasi += ex.nilai;
  }

  var categories = [];
  for (var k = 0; k < allocOrder.length; k++) {
    var entry = allocMap[allocOrder[k]];
    var progress = entry.alokasi > 0 ? (entry.realisasi / entry.alokasi) * 100 : (entry.realisasi > 0 ? 100 : 0);
    categories.push({
      kategori: entry.kategori,
      percent: entry.percent,
      alokasi: entry.alokasi,
      realisasi: entry.realisasi,
      remaining: entry.alokasi - entry.realisasi,
      progressPercent: Number(progress.toFixed(2)),
      overbudget: entry.alokasi > 0 ? entry.realisasi > entry.alokasi : entry.realisasi > 0,
    });
  }

  var base = totalAlokasi || totalIncome;
  var percentUsed = base > 0 ? Number(((totalRealisasi / base) * 100).toFixed(2)) : 0;

  return {
    month: month,
    year: year,
    totalIncome: totalIncome,
    totalAlokasi: totalAlokasi,
    totalRealisasi: totalRealisasi,
    saldo: totalIncome - totalRealisasi,
    percentUsed: percentUsed,
    incomeItems: incomeItems,
    categories: categories,
    banks: opts.banks,
  };
}

function handleListExpenses(ss, params) {
  var all = readAllExpenses(ss);
  var monthFilter = params.month ? String(params.month).trim().toLowerCase() : "";
  var yearFilter = params.year ? Number(params.year) : 0;
  var catFilter = params.category ? String(params.category).trim().toLowerCase() : "";
  var bankFilter = params.bank ? String(params.bank).trim().toLowerCase() : "";
  var searchFilter = params.search ? String(params.search).trim().toLowerCase() : "";
  var limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);

  var filtered = [];
  for (var i = all.length - 1; i >= 0; i--) {
    var ex = all[i];
    if (monthFilter && String(ex.month || "").toLowerCase() !== monthFilter) continue;
    if (yearFilter && ex.year && Number(ex.year) !== yearFilter) continue;
    if (catFilter && String(ex.kategori || "").toLowerCase() !== catFilter) continue;
    if (bankFilter && String(ex.bank || "").toLowerCase() !== bankFilter) continue;
    if (searchFilter && String(ex.uraian || "").toLowerCase().indexOf(searchFilter) === -1) continue;
    filtered.push(ex);
    if (filtered.length >= limit) break;
  }
  return filtered;
}

function findNextExpenseRow(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  if (lastRow < 2) return 2;
  var vals = sheet.getRange(2, 2, lastRow - 1, 7).getDisplayValues();
  // Cari baris pertama yang Tanggal, Uraian, dan Nilai kosong (termasuk baris template yang baru punya checkbox)
  for (var i = 0; i < vals.length; i++) {
    var dateBlank = !String(vals[i][0] || "").trim();
    var uraianBlank = !String(vals[i][3] || "").trim();
    var nilaiBlank = !String(vals[i][6] || "").trim();
    if (dateBlank && uraianBlank && nilaiBlank) {
      return i + 2;
    }
  }
  return lastRow + 1;
}

function ensureExpenseRowTemplate(sheet, rowNumber) {
  if (rowNumber <= 2) return;
  var prevRow = rowNumber - 1;
  var cekRule = sheet.getRange(rowNumber, 1).getDataValidation();
  if (!cekRule) {
    sheet.getRange(prevRow, 1, 1, 8).copyTo(sheet.getRange(rowNumber, 1, 1, 8), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    sheet.getRange(prevRow, 1, 1, 8).copyTo(sheet.getRange(rowNumber, 1, 1, 8), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  var cFormula = sheet.getRange(rowNumber, 3).getFormula();
  var prevCFormula = sheet.getRange(prevRow, 3).getFormula();
  if (!cFormula && prevCFormula && prevCFormula.toUpperCase().indexOf("ARRAYFORMULA") === -1) {
    sheet.getRange(prevRow, 3).copyTo(sheet.getRange(rowNumber, 3), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
  }
}

function handleAddExpenses(ss, params) {
  var items = params.items || [];
  if (!items.length) throw new Error("Daftar item pengeluaran kosong.");

  var opts = getDatabaseOptions(ss);
  var sheet = ss.getSheetByName("Expenses");
  if (!sheet) throw new Error("Tab 'Expenses' tidak ditemukan.");

  var addedRows = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var validCat = opts.categories.filter(function (c) { return c.toLowerCase() === String(item.kategori || "").toLowerCase(); })[0];
    var validBank = opts.banks.filter(function (b) { return b.toLowerCase() === String(item.bank || "").toLowerCase(); })[0];
    if (!validCat) throw new Error("Kategori tidak valid di Database: " + item.kategori);
    if (!validBank) throw new Error("Bank tidak valid di Database: " + item.bank);

    var rowNum = findNextExpenseRow(sheet);
    ensureExpenseRowTemplate(sheet, rowNum);

    var dateObj = isoToLocalDate(item.date);
    sheet.getRange(rowNum, 1).setValue(item.cek !== false);
    sheet.getRange(rowNum, 2).setValue(dateObj);
    sheet.getRange(rowNum, 4).setValue(item.transaksi || (validBank.toLowerCase() === "cash" ? "Cash" : "Transfer"));
    sheet.getRange(rowNum, 5).setValue(String(item.uraian || "").trim());
    sheet.getRange(rowNum, 6).setValue(validCat);
    sheet.getRange(rowNum, 7).setValue(validBank);
    sheet.getRange(rowNum, 8).setValue(Number(item.nilai));

    SpreadsheetApp.flush();
    // Isi nama bulan manual hanya jika kolom C tidak memakai formula / ARRAYFORMULA
    var monthDisp = String(sheet.getRange(rowNum, 3).getDisplayValue() || "").trim();
    if (!monthDisp) {
      sheet.getRange(rowNum, 3).setValue(MONTHS_ID[dateObj.getMonth()]);
    }
    addedRows.push(rowNum);
  }

  return { addedRows: addedRows };
}

function assertExpectedExpenseRow(sheet, rowNumber, expected) {
  var tz = sheet.getParent().getSpreadsheetTimeZone();
  var vals = sheet.getRange(rowNumber, 1, 1, 8).getValues()[0];
  var disp = sheet.getRange(rowNumber, 1, 1, 8).getDisplayValues()[0];
  var currentUraian = String(disp[4] || "").trim();
  var currentNilai = parseNumber(vals[7]);
  var parsedDate = parseDateValue(vals[1], disp[1], tz);

  if (!currentUraian && !currentNilai && !parsedDate) {
    throw new Error("Baris #" + rowNumber + " kosong.");
  }
  if (expected && expected.uraian && currentUraian.toLowerCase() !== String(expected.uraian).trim().toLowerCase()) {
    throw new Error("Data baris #" + rowNumber + " sudah berubah (uraian sekarang: " + currentUraian + ").");
  }
  if (expected && expected.nilai !== undefined && Math.round(currentNilai) !== Math.round(Number(expected.nilai))) {
    throw new Error("Data baris #" + rowNumber + " sudah berubah (nilai sekarang: " + currentNilai + ").");
  }
}

function handleUpdateExpense(ss, params) {
  var rowNumber = Number(params.rowNumber);
  if (!rowNumber || rowNumber < 2) throw new Error("rowNumber tidak valid.");
  var sheet = ss.getSheetByName("Expenses");
  if (!sheet) throw new Error("Tab 'Expenses' tidak ditemukan.");

  assertExpectedExpenseRow(sheet, rowNumber, params.expected);
  var patch = params.patch || {};
  var opts = getDatabaseOptions(ss);

  if (patch.date) {
    var dateObj = isoToLocalDate(patch.date);
    sheet.getRange(rowNumber, 2).setValue(dateObj);
    if (!sheet.getRange(rowNumber, 3).getFormula()) {
      sheet.getRange(rowNumber, 3).setValue(MONTHS_ID[dateObj.getMonth()]);
    }
  }
  if (patch.transaksi) sheet.getRange(rowNumber, 4).setValue(patch.transaksi);
  if (patch.uraian) sheet.getRange(rowNumber, 5).setValue(String(patch.uraian).trim());
  if (patch.kategori) {
    var validCat = opts.categories.filter(function (c) { return c.toLowerCase() === String(patch.kategori).toLowerCase(); })[0];
    if (!validCat) throw new Error("Kategori tidak valid: " + patch.kategori);
    sheet.getRange(rowNumber, 6).setValue(validCat);
  }
  if (patch.bank) {
    var validBank = opts.banks.filter(function (b) { return b.toLowerCase() === String(patch.bank).toLowerCase(); })[0];
    if (!validBank) throw new Error("Bank tidak valid: " + patch.bank);
    sheet.getRange(rowNumber, 7).setValue(validBank);
  }
  if (patch.nilai !== undefined) sheet.getRange(rowNumber, 8).setValue(Number(patch.nilai));

  return { rowNumber: rowNumber, updated: true };
}

function handleDeleteExpense(ss, params) {
  var rowNumber = Number(params.rowNumber);
  if (!rowNumber || rowNumber < 2) throw new Error("rowNumber tidak valid.");
  var sheet = ss.getSheetByName("Expenses");
  if (!sheet) throw new Error("Tab 'Expenses' tidak ditemukan.");

  assertExpectedExpenseRow(sheet, rowNumber, params.expected);

  // Kosongkan kolom data tanpa menghapus struktur checkbox/dropdown/formula baris
  sheet.getRange(rowNumber, 1).setValue(false);
  sheet.getRange(rowNumber, 2).clearContent();
  if (!sheet.getRange(rowNumber, 3).getFormula()) {
    sheet.getRange(rowNumber, 3).clearContent();
  }
  sheet.getRange(rowNumber, 4, 1, 5).clearContent();

  return { rowNumber: rowNumber, deleted: true };
}

function handleUpsertIncome(ss, params) {
  var source = String(params.source || "").trim();
  var month = String(params.month || "").trim();
  var amount = Number(params.amount);
  var mode = params.mode === "add" ? "add" : "set";
  if (!source) throw new Error("Sumber income wajib diisi.");
  if (!isFinite(amount) || amount <= 0) throw new Error("Nominal income harus lebih dari 0.");

  var data = readIncomeSheetData(ss);
  if (data.incomeHeaderRow === -1 || data.incomeTotalRow === -1) {
    throw new Error("Struktur tabel Income (header 'Income' / 'Total') tidak ditemukan.");
  }
  var monthCol = findMonthCol(data.disp[data.incomeHeaderRow - 1], month);
  if (monthCol === -1) throw new Error("Kolom bulan '" + month + "' tidak ditemukan di tab Income.");

  var targetRow = -1;
  var firstEmptyRow = -1;
  for (var r = data.incomeHeaderRow + 1; r < data.incomeTotalRow; r++) {
    var cellName = String(data.disp[r - 1][0] || "").trim();
    if (cellName.toLowerCase() === source.toLowerCase()) {
      targetRow = r;
      break;
    }
    if (!cellName && firstEmptyRow === -1) {
      firstEmptyRow = r;
    }
  }

  if (targetRow === -1) {
    if (firstEmptyRow !== -1) {
      targetRow = firstEmptyRow;
    } else {
      data.sheet.insertRowBefore(data.incomeTotalRow);
      targetRow = data.incomeTotalRow;
      data.sheet.getRange(targetRow - 1, 1, 1, 14).copyTo(data.sheet.getRange(targetRow, 1, 1, 14), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }
    data.sheet.getRange(targetRow, 1).setValue(source);
  }

  var existingAmt = parseNumber(data.sheet.getRange(targetRow, monthCol).getValue());
  var finalAmt = mode === "add" ? existingAmt + amount : amount;
  data.sheet.getRange(targetRow, monthCol).setValue(finalAmt);

  return { source: source, month: month, amount: finalAmt, rowNumber: targetRow };
}

function readAllocationPercentRow(sheet, rowNum, rawVal, dispVal) {
  var cellFmt = String(sheet.getRange(rowNum, 2).getNumberFormat() || "");
  var isPctFmt = cellFmt.indexOf("%") !== -1 || String(dispVal || "").indexOf("%") !== -1;
  var pct;
  if (isPctFmt && typeof rawVal === "number") {
    pct = Number((rawVal * 100).toFixed(2));
  } else {
    pct = Number(parseNumber(rawVal).toFixed(2));
  }
  return { percent: pct, isPercentFormatted: isPctFmt };
}

function readAllocationsList(ss, incomeData, month) {
  if (incomeData.allocHeaderRow === -1 || incomeData.allocTotalRow === -1) {
    return { allocations: [], totalPercent: 0 };
  }
  var allocMonthCol = findMonthCol(incomeData.disp[incomeData.allocHeaderRow - 1], month);
  var allocations = [];
  var totalPercent = 0;
  for (var r = incomeData.allocHeaderRow + 1; r < incomeData.allocTotalRow; r++) {
    var kat = String(incomeData.disp[r - 1][0] || "").trim();
    if (!kat) continue;
    var pctInfo = readAllocationPercentRow(incomeData.sheet, r, incomeData.raw[r - 1][1], incomeData.disp[r - 1][1]);
    var monthlyAmt = allocMonthCol !== -1 ? parseNumber(incomeData.raw[r - 1][allocMonthCol - 1]) : 0;
    allocations.push({
      rowNumber: r,
      kategori: kat,
      percent: pctInfo.percent,
      isPercentFormatted: pctInfo.isPercentFormatted,
      monthlyAmount: monthlyAmt,
    });
    totalPercent += pctInfo.percent;
  }
  return { allocations: allocations, totalPercent: Number(totalPercent.toFixed(2)) };
}

function handleGetIncomeOverview(ss, params) {
  var active = getDashboardPeriod(ss);
  var month = String((params && params.month) || active.month || MONTHS_ID[new Date().getMonth()]).trim();
  var year = Number(params && params.year) || active.year || new Date().getFullYear();

  var incomeData = readIncomeSheetData(ss);
  var incomeSources = [];
  var totalIncome = 0;
  if (incomeData.incomeHeaderRow !== -1 && incomeData.incomeTotalRow !== -1) {
    var monthCol = findMonthCol(incomeData.disp[incomeData.incomeHeaderRow - 1], month);
    for (var r = incomeData.incomeHeaderRow + 1; r < incomeData.incomeTotalRow; r++) {
      var sourceName = String(incomeData.disp[r - 1][0] || "").trim();
      if (!sourceName) continue;
      var amt = monthCol !== -1 ? parseNumber(incomeData.raw[r - 1][monthCol - 1]) : 0;
      incomeSources.push({ rowNumber: r, source: sourceName, amount: amt });
      totalIncome += amt;
    }
  }

  var allocResult = readAllocationsList(ss, incomeData, month);
  return {
    month: month,
    year: year,
    incomeSources: incomeSources,
    totalIncome: totalIncome,
    allocations: allocResult.allocations,
    totalPercent: allocResult.totalPercent,
  };
}

function handleUpdateAllocations(ss, params) {
  var updates = (params && params.updates) || [];
  if (!updates.length) throw new Error("Daftar perubahan alokasi kosong.");

  var data = readIncomeSheetData(ss);
  if (data.allocHeaderRow === -1 || data.allocTotalRow === -1) {
    throw new Error("Struktur tabel Alokasi (header 'Alokasi' / 'Total') tidak ditemukan di tab Income.");
  }

  var active = getDashboardPeriod(ss);
  var current = readAllocationsList(ss, data, active.month).allocations;
  var byKey = {};
  for (var i = 0; i < current.length; i++) {
    byKey[current[i].kategori.toLowerCase()] = current[i];
  }

  var applied = [];
  for (var j = 0; j < updates.length; j++) {
    var upd = updates[j];
    var katName = String(upd.kategori || "").trim();
    var pct = Number(upd.percent);
    if (!katName) throw new Error("Nama kategori alokasi wajib diisi.");
    if (!isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error("Persentase alokasi untuk '" + katName + "' harus antara 0 sampai 100.");
    }
    var match = byKey[katName.toLowerCase()];
    if (!match) {
      throw new Error("Kategori '" + katName + "' tidak ditemukan di tabel Alokasi.");
    }
    if (upd.expectedPercent !== undefined && Math.abs(match.percent - Number(upd.expectedPercent)) > 0.05) {
      throw new Error("Persentase '" + match.kategori + "' sudah berubah (sekarang: " + match.percent + "%). Silakan cek ulang.");
    }
    var cell = data.sheet.getRange(match.rowNumber, 2);
    if (cell.getFormula()) {
      throw new Error("Sel persentase '" + match.kategori + "' berisi formula dan tidak boleh ditimpa.");
    }
    var writeVal = match.isPercentFormatted ? Number((pct / 100).toFixed(4)) : Number(pct.toFixed(2));
    cell.setValue(writeVal);
    applied.push({
      rowNumber: match.rowNumber,
      kategori: match.kategori,
      oldPercent: match.percent,
      newPercent: Number(pct.toFixed(2)),
    });
  }

  SpreadsheetApp.flush();
  var refreshed = readAllocationsList(ss, readIncomeSheetData(ss), active.month);
  return { updated: applied, totalPercent: refreshed.totalPercent };
}

function handleGetUsage(ss, params) {
  var sheet = ss.getSheetByName("Usage");
  if (!sheet) throw new Error("Tab 'Usage' tidak ditemukan.");

  var maxRows = Math.min(Math.max(Number(params && params.maxRows) || 60, 1), 120);
  var maxCols = Math.min(Math.max(Number(params && params.maxCols) || 16, 1), 24);
  var totalRows = sheet.getLastRow();
  var totalCols = sheet.getLastColumn();
  if (totalRows < 1 || totalCols < 1) {
    return { sheetName: "Usage", rows: [], truncatedRows: false, truncatedCols: false };
  }

  var readRows = Math.min(totalRows, maxRows);
  var readCols = Math.min(totalCols, maxCols);
  var raw = sheet.getRange(1, 1, readRows, readCols).getValues();
  var disp = sheet.getRange(1, 1, readRows, readCols).getDisplayValues();

  var headerRow = -1;
  var totalRow = -1;
  var titleText = "";
  for (var r = 0; r < disp.length; r++) {
    var colA = String(disp[r][0] || "").trim();
    var colALower = colA.toLowerCase();
    if (headerRow === -1) {
      if (colALower === "realisasi" || findMonthCol(disp[r], "Januari") !== -1) {
        headerRow = r;
      } else if (!titleText) {
        for (var c0 = 0; c0 < disp[r].length; c0++) {
          var v0 = String(disp[r][c0] || "").trim();
          if (v0) { titleText = v0; break; }
        }
      }
    } else if (colALower === "total" && totalRow === -1) {
      totalRow = r;
      break;
    }
  }

  if (headerRow !== -1) {
    var monthCols = [];
    for (var m = 0; m < MONTHS_ID.length; m++) {
      var mCol = findMonthCol(disp[headerRow], MONTHS_ID[m]);
      if (mCol !== -1) monthCols.push({ month: MONTHS_ID[m], col: mCol });
    }
    if (monthCols.length) {
      var active = getDashboardPeriod(ss);
      var requestedMonth = String((params && params.month) || active.month || MONTHS_ID[new Date().getMonth()]).trim();
      var selected = monthCols[0];
      for (var s = 0; s < monthCols.length; s++) {
        if (monthCols[s].month.toLowerCase() === requestedMonth.toLowerCase()) {
          selected = monthCols[s];
          break;
        }
      }

      var endRow = totalRow !== -1 ? totalRow : disp.length;
      var items = [];
      var sumMonth = 0;
      for (var r2 = headerRow + 1; r2 < endRow; r2++) {
        var kat = String(disp[r2][0] || "").trim();
        if (!kat) continue;
        var pctInfo = readAllocationPercentRow(sheet, r2 + 1, raw[r2][1], disp[r2][1]);
        var amt = parseNumber(raw[r2][selected.col - 1]);
        sumMonth += amt;
        items.push({ kategori: kat, percent: pctInfo.percent, amount: amt });
      }

      var monthTotal = totalRow !== -1 ? parseNumber(raw[totalRow][selected.col - 1]) : sumMonth;
      var monthlyTotals = [];
      var yearTotal = 0;
      for (var mt = 0; mt < monthCols.length; mt++) {
        var mc = monthCols[mt];
        var mTotal = 0;
        if (totalRow !== -1) {
          mTotal = parseNumber(raw[totalRow][mc.col - 1]);
        } else {
          for (var r3 = headerRow + 1; r3 < endRow; r3++) {
            if (String(disp[r3][0] || "").trim()) mTotal += parseNumber(raw[r3][mc.col - 1]);
          }
        }
        yearTotal += mTotal;
        monthlyTotals.push({ month: mc.month, total: mTotal });
      }

      return {
        sheetName: "Usage",
        structured: true,
        title: titleText || "Penggunaan",
        month: selected.month,
        availableMonths: monthCols.map(function (mc) { return mc.month; }),
        items: items,
        total: monthTotal,
        monthlyTotals: monthlyTotals,
        yearTotal: yearTotal,
      };
    }
  }

  var rows = [];
  for (var rr = 0; rr < disp.length; rr++) {
    var trimmed = [];
    var lastNonEmpty = -1;
    for (var cc = 0; cc < disp[rr].length; cc++) {
      var val = String(disp[rr][cc] || "").trim();
      trimmed.push(val);
      if (val) lastNonEmpty = cc;
    }
    if (lastNonEmpty !== -1) {
      rows.push(trimmed.slice(0, lastNonEmpty + 1));
    }
  }

  return {
    sheetName: "Usage",
    rows: rows,
    truncatedRows: totalRows > readRows,
    truncatedCols: totalCols > readCols,
  };
}

// ============================================================================
// GOOGLE CALENDAR HANDLERS
// ============================================================================

function handleCalendarAction(action, body) {
  switch (action) {
    case "calendar_list_calendars":
      return handleCalendarListCalendars();
    case "calendar_list_events":
      return handleCalendarListEvents(body);
    case "calendar_create_event":
      return handleCalendarCreateEvent(body);
    case "calendar_update_event":
      return handleCalendarUpdateEvent(body);
    case "calendar_delete_event":
      return handleCalendarDeleteEvent(body);
    default:
      throw new Error("Action kalender tidak dikenal: " + action);
  }
}

function resolveCalendar(calendarId, requireWritable) {
  var id = String(calendarId || "").trim();
  var cal = (!id || id === "primary")
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(id);
  if (!cal) {
    throw new Error("Kalender tidak ditemukan: " + id);
  }
  if (requireWritable && !cal.isOwnedByMe() && !cal.isMyPrimaryCalendar()) {
    throw new Error("Kalender '" + cal.getName() + "' bersifat read-only dan tidak boleh diubah.");
  }
  return cal;
}

function serializeCalendarEvent(ev, cal) {
  var tz = cal.getTimeZone() || Session.getScriptTimeZone() || "Asia/Jakarta";
  var isAllDay = ev.isAllDayEvent();
  var startDate = isAllDay ? ev.getAllDayStartDate() : ev.getStartTime();
  var endDate = isAllDay ? ev.getAllDayEndDate() : ev.getEndTime();
  return {
    id: ev.getId(),
    calendarId: cal.isMyPrimaryCalendar() ? "primary" : cal.getId(),
    calendarName: cal.isMyPrimaryCalendar() ? "Kalender Utama" : cal.getName(),
    title: ev.getTitle() || "(Tanpa Judul)",
    startIso: isAllDay
      ? Utilities.formatDate(startDate, tz, "yyyy-MM-dd")
      : Utilities.formatDate(startDate, tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    endIso: isAllDay
      ? Utilities.formatDate(endDate, tz, "yyyy-MM-dd")
      : Utilities.formatDate(endDate, tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    startMs: startDate.getTime(),
    isAllDay: isAllDay,
    location: ev.getLocation() || "",
    description: ev.getDescription() || ""
  };
}

function handleCalendarListCalendars() {
  var all = CalendarApp.getAllCalendars();
  var result = [];
  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    var isPrimary = c.isMyPrimaryCalendar();
    result.push({
      id: isPrimary ? "primary" : c.getId(),
      name: isPrimary ? "Kalender Utama (" + c.getName() + ")" : c.getName(),
      isPrimary: isPrimary,
      isOwnedByMe: Boolean(c.isOwnedByMe() || isPrimary),
      timeZone: c.getTimeZone()
    });
  }
  result.sort(function (a, b) {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.isOwnedByMe !== b.isOwnedByMe) return a.isOwnedByMe ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function handleCalendarListEvents(params) {
  var startDate = new Date(params.startIso);
  var endDate = new Date(params.endIso);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
    throw new Error("Rentang waktu startIso dan endIso tidak valid.");
  }
  if ((endDate.getTime() - startDate.getTime()) > 92 * 86400000) {
    throw new Error("Rentang pembacaan jadwal maksimal 90 hari per permintaan.");
  }

  var cals = [];
  var calId = String(params.calendarId || "").trim();
  if (params.includeAllOwned && (!calId || calId === "primary")) {
    var all = CalendarApp.getAllCalendars();
    for (var i = 0; i < all.length; i++) {
      if (all[i].isOwnedByMe() || all[i].isMyPrimaryCalendar()) cals.push(all[i]);
    }
  } else {
    cals.push(resolveCalendar(calId || "primary", false));
  }

  var q = String(params.query || "").trim().toLowerCase();
  var limit = Math.min(Math.max(Number(params.limit) || 25, 1), 50);
  var items = [];

  for (var cIdx = 0; cIdx < cals.length; cIdx++) {
    var cal = cals[cIdx];
    var events = cal.getEvents(startDate, endDate);
    for (var eIdx = 0; eIdx < events.length; eIdx++) {
      var serialized = serializeCalendarEvent(events[eIdx], cal);
      if (q) {
        var hay = (serialized.title + " " + serialized.location + " " + serialized.description).toLowerCase();
        if (hay.indexOf(q) === -1) continue;
      }
      items.push(serialized);
    }
  }

  items.sort(function (a, b) { return a.startMs - b.startMs; });
  return items.slice(0, limit).map(function (it) {
    delete it.startMs;
    return it;
  });
}

function handleCalendarCreateEvent(params) {
  var title = String(params.title || "").trim();
  if (!title) throw new Error("Judul jadwal wajib diisi.");
  var cal = resolveCalendar(params.calendarId || "primary", true);
  var opts = {
    location: String(params.location || "").trim(),
    description: String(params.description || "").trim()
  };

  var ev;
  if (params.isAllDay) {
    var startDay = isoToLocalDate(params.date);
    if (params.endDate && params.endDate !== params.date) {
      var endDay = isoToLocalDate(params.endDate);
      ev = cal.createAllDayEvent(title, startDay, endDay, opts);
    } else {
      ev = cal.createAllDayEvent(title, startDay, opts);
    }
  } else {
    var start = new Date(params.startIso);
    var end = new Date(params.endIso);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      throw new Error("Jam mulai dan jam selesai tidak valid (jam selesai harus setelah jam mulai).");
    }
    ev = cal.createEvent(title, start, end, opts);
  }

  var out = serializeCalendarEvent(ev, cal);
  delete out.startMs;
  return out;
}

function assertExpectedCalendarEvent(ev, expectedTitle) {
  if (!ev) throw new Error("Jadwal tidak ditemukan di Google Calendar.");
  if (expectedTitle) {
    var actual = String(ev.getTitle() || "").trim().toLowerCase();
    var exp = String(expectedTitle).trim().toLowerCase();
    if (actual !== exp) {
      throw new Error("Jadwal di Google Calendar sudah berubah (judul sekarang: '" + ev.getTitle() + "').");
    }
  }
}

function handleCalendarUpdateEvent(params) {
  var eventId = String(params.eventId || "").trim();
  if (!eventId) throw new Error("eventId wajib diisi.");
  var cal = resolveCalendar(params.calendarId || "primary", true);
  var ev = cal.getEventById(eventId);
  assertExpectedCalendarEvent(ev, params.expectedTitle);

  var patch = params.patch || {};
  if (patch.title !== undefined && String(patch.title).trim()) {
    ev.setTitle(String(patch.title).trim());
  }
  if (patch.location !== undefined) {
    ev.setLocation(String(patch.location));
  }
  if (patch.description !== undefined) {
    ev.setDescription(String(patch.description));
  }
  if (patch.isAllDay && patch.date) {
    var sDay = isoToLocalDate(patch.date);
    if (patch.endDate && patch.endDate !== patch.date) {
      ev.setAllDayDates(sDay, isoToLocalDate(patch.endDate));
    } else {
      ev.setAllDayDate(sDay);
    }
  } else if (patch.startIso && patch.endIso) {
    var newStart = new Date(patch.startIso);
    var newEnd = new Date(patch.endIso);
    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime()) || newEnd <= newStart) {
      throw new Error("Jam mulai/selesai baru tidak valid.");
    }
    ev.setTime(newStart, newEnd);
  }

  var out = serializeCalendarEvent(ev, cal);
  delete out.startMs;
  return out;
}

function handleCalendarDeleteEvent(params) {
  var eventId = String(params.eventId || "").trim();
  if (!eventId) throw new Error("eventId wajib diisi.");
  var cal = resolveCalendar(params.calendarId || "primary", true);
  var ev = cal.getEventById(eventId);
  assertExpectedCalendarEvent(ev, params.expectedTitle);
  var oldTitle = ev.getTitle() || "(Tanpa Judul)";
  ev.deleteEvent();
  return { deleted: true, eventId: eventId, title: oldTitle };
}

// ============================================================================
// SAVINGS TARGETS HANDLERS (Targets & TargetLogs)
// ============================================================================

var TARGET_STATUSES = ["Aktif", "Tercapai", "Ditunda", "Arsip"];

function handleTargetAction(ss, action, body) {
  switch (action) {
    case "targets_list":
      return handleTargetsList(ss, body);
    case "targets_logs":
      return handleTargetsLogs(ss, body);
    case "targets_create":
      return handleTargetsCreate(ss, body);
    case "targets_add_deposit":
      return handleTargetsAddDeposit(ss, body);
    case "targets_update":
      return handleTargetsUpdate(ss, body);
    case "targets_delete_log":
      return handleTargetsDeleteLog(ss, body);
    default:
      throw new Error("Action target tidak dikenal: " + action);
  }
}

function getReferenceHeaderStyle(ss) {
  var fallback = {
    bg: "#1E7E34",
    fg: "#FFFFFF",
    fontFamily: "Arial",
    fontSize: 10,
  };
  var candidates = [
    { name: "Expenses", rows: [1, 2], cols: [1, 2, 5] },
    { name: "Income", rows: [1, 2, 3], cols: [1, 2] },
  ];
  for (var i = 0; i < candidates.length; i++) {
    var sheet = ss.getSheetByName(candidates[i].name);
    if (!sheet) continue;
    for (var r = 0; r < candidates[i].rows.length; r++) {
      for (var c = 0; c < candidates[i].cols.length; c++) {
        var cell = sheet.getRange(candidates[i].rows[r], candidates[i].cols[c]);
        var bg = String(cell.getBackground() || "").toLowerCase();
        if (bg && bg !== "#ffffff" && bg !== "#fff") {
          return {
            bg: bg,
            fg: cell.getFontColor() || fallback.fg,
            fontFamily: cell.getFontFamily() || fallback.fontFamily,
            fontSize: cell.getFontSize() || fallback.fontSize,
          };
        }
      }
    }
  }
  return fallback;
}

function styleTargetHeaderRow(sheet, headers, style, widths) {
  sheet.setFrozenRows(1);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground(style.bg);
  headerRange.setFontColor(style.fg);
  headerRange.setFontFamily(style.fontFamily);
  headerRange.setFontSize(style.fontSize);
  headerRange.setFontWeight("bold");
  headerRange.setVerticalAlignment("middle");
  headerRange.setBorder(true, true, true, true, true, true, "#D9E2DC", SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(1, 28);
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }
}

function ensureTargetSheets(ss) {
  var style = getReferenceHeaderStyle(ss);

  var targetsSheet = ss.getSheetByName("Targets");
  if (!targetsSheet) {
    targetsSheet = ss.insertSheet("Targets");
    styleTargetHeaderRow(
      targetsSheet,
      ["ID", "Nama Target", "Nominal Target", "Terkumpul", "Kurang", "Progress", "Status", "Catatan", "Dibuat"],
      style,
      [95, 220, 145, 145, 145, 95, 110, 240, 110]
    );
    targetsSheet.getRange("C2:E").setNumberFormat('"Rp "#,##0');
    targetsSheet.getRange("F2:F").setNumberFormat("0.0%");
    targetsSheet.getRange("I2:I").setNumberFormat("yyyy-mm-dd");
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(TARGET_STATUSES, true).build();
    targetsSheet.getRange("G2:G").setDataValidation(rule);
  }

  var logsSheet = ss.getSheetByName("TargetLogs");
  if (!logsSheet) {
    logsSheet = ss.insertSheet("TargetLogs");
    styleTargetHeaderRow(
      logsSheet,
      ["Log ID", "Tanggal", "Target ID", "Nama Target", "Nominal", "Keterangan", "Sumber Periode"],
      style,
      [95, 110, 95, 200, 145, 240, 125]
    );
    logsSheet.getRange("B2:B").setNumberFormat("yyyy-mm-dd");
    logsSheet.getRange("E2:E").setNumberFormat('"Rp "#,##0');
  }

  return { targetsSheet: targetsSheet, logsSheet: logsSheet };
}

function styleDataRow(sheet, rowNum, colCount) {
  var rowRange = sheet.getRange(rowNum, 1, 1, colCount);
  rowRange.setBackground(rowNum % 2 === 0 ? "#FFFFFF" : "#F4F9F5");
  rowRange.setBorder(true, true, true, true, true, true, "#D9E2DC", SpreadsheetApp.BorderStyle.SOLID);
  rowRange.setVerticalAlignment("middle");
}

function nextSequentialId(sheet, prefix) {
  var lastRow = sheet.getLastRow();
  var maxNum = 0;
  if (lastRow >= 2) {
    var vals = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    var re = new RegExp("^" + prefix + "-(\\d+)$", "i");
    for (var i = 0; i < vals.length; i++) {
      var m = re.exec(String(vals[i][0] || "").trim());
      if (m) {
        var n = Number(m[1]);
        if (n > maxNum) maxNum = n;
      }
    }
  }
  var next = String(maxNum + 1);
  while (next.length < 3) next = "0" + next;
  return prefix + "-" + next;
}

function readAllTargets(ss) {
  var sheets = ensureTargetSheets(ss);
  var sheet = sheets.targetsSheet;
  var tz = ss.getSpreadsheetTimeZone();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var raw = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var disp = sheet.getRange(2, 1, lastRow - 1, 9).getDisplayValues();
  var list = [];
  for (var i = 0; i < raw.length; i++) {
    var id = String(disp[i][0] || "").trim();
    var name = String(disp[i][1] || "").trim();
    if (!id && !name) continue;
    var targetAmount = parseNumber(raw[i][2]);
    var collectedAmount = parseNumber(raw[i][3]);
    var remainingAmount = Math.max(0, targetAmount - collectedAmount);
    var progressPercent = targetAmount > 0 ? Number(((collectedAmount / targetAmount) * 100).toFixed(1)) : 0;
    var parsedCreated = parseDateValue(raw[i][8], disp[i][8], tz);
    list.push({
      rowNumber: i + 2,
      id: id,
      name: name,
      targetAmount: targetAmount,
      collectedAmount: collectedAmount,
      remainingAmount: remainingAmount,
      progressPercent: progressPercent,
      status: String(disp[i][6] || "Aktif").trim() || "Aktif",
      note: String(disp[i][7] || "").trim(),
      createdAt: parsedCreated ? parsedCreated.iso : "",
    });
  }
  return list;
}

function handleTargetsList(ss, params) {
  var statusFilter = params && params.status ? String(params.status).trim().toLowerCase() : "";
  var includeArchived = Boolean(params && params.includeArchived);
  var all = readAllTargets(ss);
  var targets = [];
  for (var i = 0; i < all.length; i++) {
    var t = all[i];
    var st = String(t.status || "").toLowerCase();
    if (statusFilter) {
      if (st !== statusFilter) continue;
    } else if (!includeArchived && st === "arsip") {
      continue;
    }
    targets.push(t);
  }
  return { targets: targets };
}

function handleTargetsLogs(ss, params) {
  var sheets = ensureTargetSheets(ss);
  var sheet = sheets.logsSheet;
  var tz = ss.getSpreadsheetTimeZone();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { logs: [], totalMatchedAmount: 0 };

  var targetFilter = params && params.targetId ? String(params.targetId).trim().toLowerCase() : "";
  var periodFilter = params && params.sourcePeriod ? String(params.sourcePeriod).trim().toLowerCase() : "";
  var limit = Math.min(Math.max(Number(params && params.limit) || 20, 1), 100);

  var raw = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var disp = sheet.getRange(2, 1, lastRow - 1, 7).getDisplayValues();
  var matched = [];
  var totalMatchedAmount = 0;

  for (var i = raw.length - 1; i >= 0; i--) {
    var logId = String(disp[i][0] || "").trim();
    var targetId = String(disp[i][2] || "").trim();
    if (!logId && !targetId) continue;
    var sourcePeriod = String(disp[i][6] || "").trim();
    if (targetFilter && targetId.toLowerCase() !== targetFilter) continue;
    if (periodFilter && sourcePeriod.toLowerCase() !== periodFilter) continue;

    var amount = parseNumber(raw[i][4]);
    var parsedDate = parseDateValue(raw[i][1], disp[i][1], tz);
    totalMatchedAmount += amount;
    matched.push({
      rowNumber: i + 2,
      logId: logId,
      date: parsedDate ? parsedDate.iso : "",
      targetId: targetId,
      targetName: String(disp[i][3] || "").trim(),
      amount: amount,
      note: String(disp[i][5] || "").trim(),
      sourcePeriod: sourcePeriod,
    });
  }

  return {
    logs: matched.slice(0, limit),
    totalMatchedAmount: totalMatchedAmount,
  };
}

function handleTargetsCreate(ss, params) {
  var name = String((params && params.name) || "").trim();
  var targetAmount = Number(params && params.targetAmount);
  var note = String((params && params.note) || "").trim();
  var status = String((params && params.status) || "Aktif").trim() || "Aktif";
  if (!name) throw new Error("Nama target wajib diisi.");
  if (!isFinite(targetAmount) || targetAmount <= 0) throw new Error("Nominal target harus lebih dari 0.");
  if (TARGET_STATUSES.indexOf(status) === -1) throw new Error("Status target tidak valid: " + status);

  var sheets = ensureTargetSheets(ss);
  var existing = readAllTargets(ss);
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].status.toLowerCase() !== "arsip" && existing[i].name.toLowerCase() === name.toLowerCase()) {
      throw new Error("Target aktif dengan nama '" + name + "' sudah ada (" + existing[i].id + ").");
    }
  }

  var sheet = sheets.targetsSheet;
  var id = nextSequentialId(sheet, "TGT");
  var rowNum = Math.max(sheet.getLastRow() + 1, 2);
  var createdDate = params && params.date ? isoToLocalDate(params.date) : new Date();

  sheet.getRange(rowNum, 1).setValue(id);
  sheet.getRange(rowNum, 2).setValue(name);
  sheet.getRange(rowNum, 3).setValue(Math.round(targetAmount)).setNumberFormat('"Rp "#,##0');
  sheet.getRange(rowNum, 4).setFormula("=SUMIF(TargetLogs!$C:$C, A" + rowNum + ", TargetLogs!$E:$E)").setNumberFormat('"Rp "#,##0');
  sheet.getRange(rowNum, 5).setFormula("=MAX(0, C" + rowNum + "-D" + rowNum + ")").setNumberFormat('"Rp "#,##0');
  sheet.getRange(rowNum, 6).setFormula("=IF(C" + rowNum + ">0, D" + rowNum + "/C" + rowNum + ", 0)").setNumberFormat("0.0%");
  sheet.getRange(rowNum, 7).setValue(status);
  sheet.getRange(rowNum, 8).setValue(note);
  sheet.getRange(rowNum, 9).setValue(createdDate).setNumberFormat("yyyy-mm-dd");
  styleDataRow(sheet, rowNum, 9);
  SpreadsheetApp.flush();

  var updated = readAllTargets(ss);
  for (var j = 0; j < updated.length; j++) {
    if (updated[j].id === id) return updated[j];
  }
  return { id: id, name: name, targetAmount: Math.round(targetAmount), collectedAmount: 0, remainingAmount: Math.round(targetAmount), progressPercent: 0, status: status, note: note, rowNumber: rowNum };
}

function findTargetById(all, targetId) {
  var key = String(targetId || "").trim().toLowerCase();
  for (var i = 0; i < all.length; i++) {
    if (all[i].id.toLowerCase() === key) return all[i];
  }
  return null;
}

function handleTargetsAddDeposit(ss, params) {
  var targetId = String((params && params.targetId) || "").trim();
  var amount = Number(params && params.amount);
  var note = String((params && params.note) || "").trim();
  var sourcePeriod = String((params && params.sourcePeriod) || "").trim();
  if (!targetId) throw new Error("targetId wajib diisi.");
  if (!isFinite(amount) || amount <= 0) throw new Error("Nominal setoran harus lebih dari 0.");

  var sheets = ensureTargetSheets(ss);
  var all = readAllTargets(ss);
  var target = findTargetById(all, targetId);
  if (!target) throw new Error("Target '" + targetId + "' tidak ditemukan.");
  if (target.status.toLowerCase() === "arsip") {
    throw new Error("Target '" + target.name + "' sudah diarsipkan. Aktifkan dulu jika ingin menabung lagi.");
  }

  var logsSheet = sheets.logsSheet;
  var logId = nextSequentialId(logsSheet, "LOG");
  var rowNum = Math.max(logsSheet.getLastRow() + 1, 2);
  var depositDate = params && params.date ? isoToLocalDate(params.date) : new Date();

  logsSheet.getRange(rowNum, 1).setValue(logId);
  logsSheet.getRange(rowNum, 2).setValue(depositDate).setNumberFormat("yyyy-mm-dd");
  logsSheet.getRange(rowNum, 3).setValue(target.id);
  logsSheet.getRange(rowNum, 4).setValue(target.name);
  logsSheet.getRange(rowNum, 5).setValue(Math.round(amount)).setNumberFormat('"Rp "#,##0');
  logsSheet.getRange(rowNum, 6).setValue(note);
  logsSheet.getRange(rowNum, 7).setValue(sourcePeriod);
  styleDataRow(logsSheet, rowNum, 7);
  SpreadsheetApp.flush();

  var refreshed = findTargetById(readAllTargets(ss), target.id) || target;
  if (refreshed.status === "Aktif" && refreshed.collectedAmount >= refreshed.targetAmount) {
    sheets.targetsSheet.getRange(refreshed.rowNumber, 7).setValue("Tercapai");
    SpreadsheetApp.flush();
    refreshed = findTargetById(readAllTargets(ss), target.id) || refreshed;
  }

  var tz = ss.getSpreadsheetTimeZone();
  return {
    log: {
      rowNumber: rowNum,
      logId: logId,
      date: Utilities.formatDate(depositDate, tz, "yyyy-MM-dd"),
      targetId: target.id,
      targetName: target.name,
      amount: Math.round(amount),
      note: note,
      sourcePeriod: sourcePeriod,
    },
    target: refreshed,
  };
}

function handleTargetsUpdate(ss, params) {
  var targetId = String((params && params.targetId) || "").trim();
  var patch = (params && params.patch) || {};
  var expected = (params && params.expected) || {};
  if (!targetId) throw new Error("targetId wajib diisi.");

  var sheets = ensureTargetSheets(ss);
  var all = readAllTargets(ss);
  var target = findTargetById(all, targetId);
  if (!target) throw new Error("Target '" + targetId + "' tidak ditemukan.");

  if (expected.name && target.name.toLowerCase() !== String(expected.name).trim().toLowerCase()) {
    throw new Error("Data target sudah berubah (nama sekarang: " + target.name + ").");
  }
  if (expected.status && target.status.toLowerCase() !== String(expected.status).trim().toLowerCase()) {
    throw new Error("Status target sudah berubah (status sekarang: " + target.status + ").");
  }

  var sheet = sheets.targetsSheet;
  var r = target.rowNumber;
  if (patch.name !== undefined) {
    var nextName = String(patch.name || "").trim();
    if (!nextName) throw new Error("Nama target tidak boleh kosong.");
    sheet.getRange(r, 2).setValue(nextName);
  }
  if (patch.targetAmount !== undefined) {
    var nextAmt = Number(patch.targetAmount);
    if (!isFinite(nextAmt) || nextAmt <= 0) throw new Error("Nominal target harus lebih dari 0.");
    sheet.getRange(r, 3).setValue(Math.round(nextAmt));
  }
  if (patch.status !== undefined) {
    var nextStatus = String(patch.status || "").trim();
    if (TARGET_STATUSES.indexOf(nextStatus) === -1) throw new Error("Status tidak valid: " + nextStatus);
    sheet.getRange(r, 7).setValue(nextStatus);
  }
  if (patch.note !== undefined) {
    sheet.getRange(r, 8).setValue(String(patch.note || "").trim());
  }

  SpreadsheetApp.flush();
  return findTargetById(readAllTargets(ss), target.id) || target;
}

function handleTargetsDeleteLog(ss, params) {
  var logId = String((params && params.logId) || "").trim();
  var expected = (params && params.expected) || {};
  if (!logId) throw new Error("logId wajib diisi.");

  var sheets = ensureTargetSheets(ss);
  var logsSheet = sheets.logsSheet;
  var lastRow = logsSheet.getLastRow();
  if (lastRow < 2) throw new Error("Log setoran tidak ditemukan: " + logId);

  var raw = logsSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var disp = logsSheet.getRange(2, 1, lastRow - 1, 7).getDisplayValues();
  var foundRow = -1;
  var linkedTargetId = "";
  var foundAmount = 0;

  for (var i = 0; i < disp.length; i++) {
    if (String(disp[i][0] || "").trim().toLowerCase() === logId.toLowerCase()) {
      foundRow = i + 2;
      linkedTargetId = String(disp[i][2] || "").trim();
      foundAmount = parseNumber(raw[i][4]);
      break;
    }
  }
  if (foundRow === -1) throw new Error("Log setoran '" + logId + "' tidak ditemukan.");
  if (params && params.rowNumber && Number(params.rowNumber) !== foundRow) {
    throw new Error("Posisi baris log '" + logId + "' berubah (sekarang di baris #" + foundRow + "). Silakan ulangi.");
  }
  if (expected.targetId && linkedTargetId.toLowerCase() !== String(expected.targetId).trim().toLowerCase()) {
    throw new Error("Log '" + logId + "' bukan milik target yang diharapkan.");
  }
  if (expected.amount !== undefined && Math.round(foundAmount) !== Math.round(Number(expected.amount))) {
    throw new Error("Nominal log '" + logId + "' sudah berubah (sekarang: " + foundAmount + ").");
  }

  logsSheet.deleteRow(foundRow);
  SpreadsheetApp.flush();

  var refreshed = linkedTargetId ? findTargetById(readAllTargets(ss), linkedTargetId) : null;
  if (refreshed && refreshed.status === "Tercapai" && refreshed.collectedAmount < refreshed.targetAmount) {
    sheets.targetsSheet.getRange(refreshed.rowNumber, 7).setValue("Aktif");
    SpreadsheetApp.flush();
    refreshed = findTargetById(readAllTargets(ss), linkedTargetId);
  }

  return { deleted: true, logId: logId, target: refreshed };
}
