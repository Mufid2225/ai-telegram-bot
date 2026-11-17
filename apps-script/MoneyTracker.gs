/**
 * Google Apps Script Web App untuk MoneyTracker Bot Bridge.
 *
 * Cara pasang di Google Sheets MoneyTracker:
 * 1. Buka spreadsheet MoneyTracker -> menu Ekstensi -> Apps Script.
 * 2. Hapus isi default, tempel seluruh kode ini, lalu simpan (Ctrl+S).
 * 3. Isi SHEET_API_SECRET di bawah (atau lewat Project Settings -> Script Properties: SHEET_API_SECRET)
 *    dengan nilai acak yang sama persis dengan SHEET_API_SECRET di .env.local bot.
 * 4. Klik Deploy -> New deployment -> pilih Type: Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Salin Web app URL (/exec) ke SHEET_WEBHOOK_URL di .env.local bot.
 */

var FALLBACK_API_SECRET = "GANTI_DENGAN_SECRET_YANG_SAMA_DENGAN_ENV";

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

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = body.action;
    var data;

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
