/* ================================================================
   LAYER: UI — rendering, views, dashboard, import/export UI,
   macro registry, boot. Renders ONLY from WB + state.
   ================================================================ */
/* ================================================================
   UI LAYER — modUI, modNavigator, modExport, modExportAllModules,
   modValidation, modConstants (tools), modButtonTools,
   modCreateUndoButton, modPatchFixes, modFixUnlock, modLayout,
   forms (CFieldInput / frmSectionPicker), watchers, registry, init
   ================================================================ */

/* ================================================================
   modUI — dropdowns, exact toggle, protect, navigate
   ================================================================ */
const modUI = {
  BuildKeyArray(sheetName) {
    const result = ["FULLTEXT"];
    if (NormalizeText(sheetName) === "all" || !sheetName) return result;
    const src = WB.sheets[sheetName];
    if (!src) return result;
    const hRow = 1;
    let lastCol = Math.max(1, ...src.rows.map(r => r.length), 1);
    if (lastCol > MAX_DATA_COLS) lastCol = MAX_DATA_COLS;
    for (let c = 1; c <= lastCol; c++) {
      const hv = TrimText(String(cellVal(sheetName, hRow, c, true) ?? ""));
      if (hv && hv.length < 60) result.push(hv);
    }
    return result;
  },

  BuildSheetList(includeAll) {
    const list = [];
    if (includeAll) list.push("ALL");
    WB.order.forEach(n => { if (IsDataSheet(n)) list.push(n); });
    return list;
  },

  SetupSheetDropdown() { fillSelect("cp-c7", this.BuildSheetList(true), state.cp.C7, true, true); },
  SetupAddSheetDropdown() { fillSelect("cp-c16", this.BuildSheetList(false), state.cp.C16, true, true); },
  SetupNavSheetDropdown() { fillSelect("cp-c41", this.BuildSheetList(false), state.cp.C41, true, true); },
  SetupKeyDropdown() {
    const selSheet = TrimText(state.cp.C7) || "ALL";
    const keys = this.BuildKeyArray(selSheet);
    if (keys.length) {
      fillSelect("cp-c9", keys, state.cp.C9 && keys.indexOf(state.cp.C9) >= 0 ? state.cp.C9 : keys[0], true);
      state.cp.C9 = document.getElementById("cp-c9").value;
    }
  },
  SetupRemoveKeyDropdown() {
    const selSheet = TrimText(state.cp.C23);
    if (!selSheet) { fillSelect("cp-c25", ["FULLTEXT"], "FULLTEXT", true); return; }
    const keys = this.BuildKeyArray(selSheet);
    fillSelect("cp-c25", keys, state.cp.C25 && keys.indexOf(state.cp.C25) >= 0 ? state.cp.C25 : keys[0], true);
    state.cp.C25 = document.getElementById("cp-c25").value;
  },
  UpdateKeyDropdown() {
    this.SetupKeyDropdown();
    this.SetupRemoveKeyDropdown();
  },

  ToggleExactMatch() {
    const on = NormalizeText(state.cp.B12) === "on";
    state.cp.B12 = on ? "OFF" : "ON";
    renderExactToggle();
    saveState();
    WriteChangeLog("TOGGLE", CP_SHEET, CELL_EXACT_TOGGLE, "SUCCESS", "Exact match: " + state.cp.B12);
  },

  RefreshPanel() {
    this.SetupSheetDropdown();
    this.SetupKeyDropdown();
    this.SetupRemoveKeyDropdown();
    this.SetupAddSheetDropdown();
    this.SetupNavSheetDropdown();
    renderExactToggle();
    Toast("پنل کنترل بازسازی شد.", "ok");
  },

  FixControlPanelGrid() { this.RefreshPanel(); },

  NavigateToSheet() {
    const sheetName = TrimText(state.cp.C41);
    if (!sheetName) {
      ShowMsg("لطفاً یک شیت انتخاب کنید.", vbExclamation, "Navigate");
      return;
    }
    if (!WB.sheets[sheetName]) {
      ShowMsg('شیت "' + sheetName + '" یافت نشد.', vbExclamation, "Navigate");
      return;
    }
    renderSheetView(sheetName);
    switchView("sheet");
    WriteChangeLog("NAVIGATE", sheetName, "-", "SUCCESS", "");
  },

  ProtectControlPanel() {
    state.panelProtected = true;
    saveState();
    applyPanelProtection();
    Toast("کنترل پنل قفل شد (رمز: " + CONTROL_PANEL_PASSWORD + ").", "ok");
  },

  async UnprotectControlPanel() {
    if (!state.panelProtected) { Toast("پنل از قبل باز است.", "warn"); return; }
    const pw = await ShowInput("رمز عبور کنترل پنل را وارد کنید:", "Unprotect CONTROL_PANEL", "");
    if (pw === null) return;
    if (pw !== CONTROL_PANEL_PASSWORD) {
      HandleError("modUI", "UnprotectControlPanel", 1001, "Incorrect password");
      await ShowMsg("رمز عبور نادرست است.", vbCritical, "Unprotect");
      return;
    }
    state.panelProtected = false;
    saveState();
    applyPanelProtection();
    Toast("قفل کنترل پنل برداشته شد.", "ok");
  },

  async InstallDataManager() {
    this.RefreshPanel();
    modCreateUndoButton.CreateUndoButton(false);
    await ShowMsg("DATA MANAGER نصب/بازسازی شد.", vbInformation, "InstallDataManager");
  }
};

function fillSelect(id, options, selected, keepOptionalBlank, grouped) {
  const sel = document.getElementById(id);
  if (!sel) return;
  clear(sel);
  const addOpt = (parent, o) => {
    const opt = document.createElement("option");
    opt.value = o; opt.textContent = o;
    if (o === selected) opt.selected = true;
    parent.appendChild(opt);
    return opt;
  };
  if (grouped) {
    // group sheet names by category
    const groups = {};
    const order = [];
    options.forEach(o => {
      const c = (o === "ALL") ? { id: "all", name: "همه شیت‌ها" } : categoryOf(o);
      if (!groups[c.id]) { groups[c.id] = []; order.push(c); }
      groups[c.id].push(o);
    });
    order.forEach(c => {
      const og = document.createElement("optgroup");
      og.label = c.name;
      groups[c.id].forEach(o => addOpt(og, o));
      sel.appendChild(og);
    });
  } else {
    options.forEach(o => addOpt(sel, o));
  }
  if (selected && options.indexOf(selected) < 0) {
    const opt = document.createElement("option");
    opt.value = selected; opt.textContent = selected; opt.selected = true;
    sel.appendChild(opt);
  }
}
function renderExactToggle() {
  const t = document.getElementById("exact-toggle");
  const on = NormalizeText(state.cp.B12) === "on";
  t.classList.toggle("on", on);
  t.classList.toggle("off", !on);
  t.querySelector(".txt").textContent = on ? "ON" : "OFF";
}
function applyPanelProtection() {
  // In the original, only C7/C9/C11/C16/C23/C25/C27/C41/B12 are unlocked.
  // Here: when protected, non-input widgets stay available (same as Excel) but
  // the protection flag is shown and "protection-sensitive" tools ask for password.
  document.getElementById("st-lock").textContent = state.panelProtected ? "فعال (قفل)" : "غیرفعال";
}

/* ================================================================
   modNavigator — card-based sheet picker
   ================================================================ */
const modNavigator = {
  ShowSheetNavigator() {
    const cards = renderGroupedNavigator();
    const dataSheets = WB.order.filter(n => IsDataSheet(n));
    ModalBox({
      title: "\u0627\u0646\u062a\u062e\u0627\u0628 \u0634\u06cc\u062a \u2014 SHEET NAVIGATOR",
      cls: "info",
      text: "",
      contentNode: el("div", {},
        el("div", { class: "nav-grid" }, cards),
        el("div", {
          class: "hint", style: { marginTop: "10px" },
          text: dataSheets.length + " \u0634\u06cc\u062a \u2014 \u06af\u0631\u0648\u0647\u200c\u0628\u0646\u062f\u06cc\u200c\u0634\u062f\u0647 \u0628\u0631 \u0627\u0633\u0627\u0633 \u062f\u0633\u062a\u0647\u200c\u0647\u0627"
        })),
      buttons: [{ id: IDCANCEL, label: "\u2715 \u0628\u0633\u062a\u0646", cls: "cancel" }]
    });
  },
  NavToSelectedSheet(name) {
    document.getElementById("modal-overlay").classList.remove("show");
    clear(document.getElementById("modal-overlay"));
    if (WB.sheets[name]) {
      renderSheetView(name);
      switchView("sheet");
    }
  },
  CloseNavigator() {
    document.getElementById("modal-overlay").classList.remove("show");
    clear(document.getElementById("modal-overlay"));
    GoToControlPanel();
  }
};

/* ================================================================
   modExport — CSV/Excel-exportable downloads
   ================================================================ */
const modExport = {
  ExportSearchResults() {
    const res = WB.sheets[RESULTS_SHEET];
    if (!res) { ShowMsg("شیت SEARCH_RESULTS یافت نشد.", vbExclamation, "Export"); return; }
    let csv = "";
    if (state.results.length) {
      // export the current rendered results (match blocks)
      const lines = [];
      state.results.forEach(blk => {
        lines.push(['Match ' + blk.matchIdx + '  |  Sheet: ' + blk.sheet + '  |  Row: ' + blk.srcRow].join(","));
        lines.push(blk.headers.map(csvCell).join(","));
        blk.dataRows.forEach(dr => lines.push(dr.cells.map(csvCell).join(",")));
        lines.push("");
      });
      csv = lines.join("\r\n");
    } else {
      csv = sheetToCSV(RESULTS_SHEET);
    }
    DownloadFile("SearchResults_" + tsStamp() + ".csv", "\uFEFF" + csv, "text/csv");
    WriteChangeLog("EXPORT", RESULTS_SHEET, "-", "SUCCESS", "SearchResults CSV");
    Toast("خروجی نتایج جستجو ذخیره شد.", "ok");
  },
  ExportCurrentData() {
    const idx = WB.sheets[IDX_SHEET];
    if (!idx) { ShowMsg("ایندکس خالی است — ابتدا REFRESH INDEX بزنید.", vbExclamation, "Export"); return; }
    DownloadFile("CurrentData_" + tsStamp() + ".csv", "\uFEFF" + sheetToCSV(IDX_SHEET), "text/csv");
    WriteChangeLog("EXPORT", IDX_SHEET, "-", "SUCCESS", "CurrentData CSV");
    Toast("خروجی داده جاری ذخیره شد.", "ok");
  },
  ExportChangeLog() {
    const log = WB.sheets[LOG_SHEET];
    if (!log) { ShowMsg("شیت CHANGE_LOG یافت نشد.", vbExclamation, "Export"); return; }
    DownloadFile("ChangeLog_" + tsStamp() + ".csv", "\uFEFF" + sheetToCSV(LOG_SHEET), "text/csv");
    Toast("خروجی تاریخچه ذخیره شد.", "ok");
  }
};
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ================================================================
   modImport — import external data files (xlsx / xlsm / csv / json).
   Imported data REPLACES the current workbook so every macro (search,
   add, remove, edit, export, undo...) runs on the imported dataset.
   ================================================================ */
function parseCsvText(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = ""; rows.push(row); row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function sheetRowsFromXlsx(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  // xlsx !merges are 0-based; workbook model stores 1-based (findMerge/cellVal)
  const merges = (ws["!merges"] || []).map(m => ({ r1: m.s.r + 1, c1: m.s.c + 1, r2: m.e.r + 1, c2: m.e.c + 1 }));
  return { rows, merges };
}

function ensureCfgRow(cfg, name, sh) {
  const have = cfg.rows.some(r => NormalizeText(TrimText(String((r || [])[0] ?? ""))) === NormalizeText(name));
  if (have) return;
  let maxCol = 0;
  (sh.rows || []).forEach(r => { if (r && r.length > maxCol) maxCol = r.length; });
  cfg.rows.push([name, (sh.rows || []).length, Math.min(Math.max(maxCol, 1), MAX_DATA_COLS), 1, 2, "HIGH"]);
}

/* Replace workbook data with imported sheets; system surfaces are kept
   wired so all macros immediately run on the imported dataset. */
function mapImportedName(rawName, knownByNorm) {
  let name = TrimText(String(rawName ?? ""));
  if (!name) return "";
  if (name.length > 31) name = name.slice(0, 31);
  return knownByNorm[NormalizeText(name)] || name;
}

/* Shared tail after workbook data changed: config coverage, index, persistence, UI */
function finishDataSwap(fileName) {
  const cfg = ensureSheet(CFG_SHEET, true);
  if (!cfg.rows.length) cfg.rows.push(["Sheet", "MaxRow", "MaxCol", "HeaderRow", "DataStart", "Risk"]);
  WB.order.forEach(n => {
    if (IsSystemSheet(n)) return;
    ensureCfgRow(cfg, n, WB.sheets[n]);
  });
  // retarget panel dropdowns if their sheet disappeared
  const firstData = WB.order.find(n => IsDataSheet(n)) || "";
  ["C7", "C16", "C23", "C41"].forEach(k => {
    if (!WB.sheets[state.cp[k]]) state.cp[k] = firstData;
  });
  // transient state cannot survive a data swap
  state.results = []; state.resultsMode = "search";
  state.undo = null; state.catFilter = "all";
  if (!WB.sheets[state.currentSheet]) state.currentSheet = null;
  modMapping.RefreshSearchIndex(false);
  saveState();
  WriteChangeLog("IMPORT", "-", fileName, "SUCCESS",
    WB.order.filter(n => IsDataSheet(n)).length + " data sheets / " +
    (WB.sheets[IDX_SHEET].rows.length - 1) + " indexed rows");
  initUIFromState();
  updateStatLine();
  return true;
}

/* Full replacement: imported sheets BECOME the workbook (macros then run
   on the imported data, not the previous data). System surfaces are kept
   wired so every macro works immediately. */
function adoptImportedSheets(impOrder, impSheets, fileName) {
  const knownByNorm = {};
  WB.order.forEach(n => { knownByNorm[NormalizeText(n)] = n; });
  const newOrder = [], newSheets = {};
  const push = (name, sh) => {
    if (!name) return;
    const key = NormalizeText(name);
    if (newSheets[name] || newOrder.some(n => NormalizeText(n) === key)) return;
    newOrder.push(name);
    newSheets[name] = sh;
  };
  // app control surfaces first (like the embedded workbook order)
  [CP_SHEET, RESULTS_SHEET, LOG_SHEET].forEach(n => {
    if (impSheets[n]) push(n, impSheets[n]);
    else if (WB.sheets[n]) push(n, WB.sheets[n]);
    else push(n, { rows: [], merges: [] });
  });
  // imported data sheets (mapped onto known display names when possible)
  for (const rawName of impOrder) {
    push(mapImportedName(rawName, knownByNorm), impSheets[rawName]);
  }
  // system internals last
  [SYSTEM_KEYS_SHEET, CFG_SHEET, DD_SHEET, IDX_SHEET, UNDO_BUFFER_SHEET, NAV_SHEET_NAME].forEach(n => {
    if (impSheets[n]) push(n, impSheets[n]);
    else if (WB.sheets[n]) push(n, WB.sheets[n]);
    else if (n === CFG_SHEET || n === IDX_SHEET) push(n, { rows: [], merges: [] });
  });
  WB.order = newOrder;
  WB.sheets = newSheets;
  const ok = finishDataSwap(fileName);
  Toast("فایل «" + fileName + "» وارد شد — همه ماکروها روی داده جدید اجرا می‌شوند.", "ok");
  return ok;
}

/* Upsert (CSV / single-table): add or replace the imported sheet inside the
   current workbook without touching the other sheets. */
function upsertImportedSheets(impOrder, impSheets, fileName) {
  const knownByNorm = {};
  WB.order.forEach(n => { knownByNorm[NormalizeText(n)] = n; });
  for (const rawName of impOrder) {
    const display = mapImportedName(rawName, knownByNorm);
    if (!display) continue;
    if (WB.sheets[display]) {
      WB.sheets[display] = impSheets[rawName];
    } else {
      // insert before the system-internals block
      let at = WB.order.findIndex(n => IsSystemSheet(n));
      if (at < 0) at = WB.order.length;
      WB.order.splice(at, 0, display);
      WB.sheets[display] = impSheets[rawName];
    }
    if (WB.sheets[CFG_SHEET]) ensureCfgRow(WB.sheets[CFG_SHEET], display, WB.sheets[display]);
  }
  const ok = finishDataSwap(fileName);
  Toast("شیت‌های فایل «" + fileName + "» در داده‌های فعلی اعمال شد.", "ok");
  return ok;
}

function looksLikeExcelBuffer(u8) {
  // xlsx/xlsm = ZIP (PK\x03\x04) ; xls = OLE compound (D0 CF 11 E0)
  if (u8.length < 4) return false;
  const zip = u8[0] === 0x50 && u8[1] === 0x4B && (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07);
  const ole = u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0;
  return zip || ole;
}
function importWorkbookFromBuffer(fileName, arrayBuffer) {
  let xw;
  try {
    const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    if (!looksLikeExcelBuffer(u8)) {
      LogError("Import", "importWorkbookFromBuffer", 103, "not an Excel/ZIP file", fileName);
      ShowMsg("فایل انتخاب‌شده فایل اکسل معتبر (.xlsx/.xlsm/.xls) نیست.", vbCritical, "Import");
      return false;
    }
    xw = XLSX.read(u8, {
      type: "array", bookVBA: false, bookDeps: false, cellStyles: false,
      cellHTML: false, cellNF: false, cellText: false, cellDates: false, sheetStubs: false
    });
  } catch (e) {
    LogError("Import", "XLSX.read", 100, e && e.message ? e.message : String(e), fileName);
    ShowMsg("فایل اکسل قابل خواندن نیست.\n" + (e && e.message ? e.message : e), vbCritical, "Import");
    return false;
  }
  const impOrder = [], impSheets = {};
  for (const name of xw.SheetNames) {
    const ws = xw.Sheets[name];
    if (!ws) continue;
    impOrder.push(name);
    impSheets[name] = sheetRowsFromXlsx(ws);
  }
  return importValidatedSheets(impOrder, impSheets, fileName, true);
}

function importCsvText(fileName, text) {
  const rows = parseCsvText(text);
  if (!rows.length) { ShowMsg("فایل CSV خالی است.", vbExclamation, "Import"); return false; }
  let base = sanitizeSheetName(fileName.replace(/\.[^.]+$/, ""));
  if (!base) base = "Imported";
  return importValidatedSheets([base], { [base]: { rows, merges: [] } }, fileName, false);
}

/* Validate + normalize imported sheets BEFORE touching WB. Corrupt or
   partial files are rejected with a clear report; state stays intact. */
function importValidatedSheets(impOrder, impSheets, fileName, replaceMode) {
  const cleanOrder = [], keyed = Object.create(null);
  for (const rawName of impOrder) {
    const name = sanitizeSheetName(rawName);
    if (!name) continue;
    const key = NormalizeText(name);
    if (cleanOrder.some(n => NormalizeText(n) === key)) continue;
    cleanOrder.push(name);
    keyed[name] = normalizeSheetData(impSheets[rawName]);
  }
  const verdict = validateWorkbookData(cleanOrder, keyed);
  verdict.warnings.forEach(w => console.warn("import warning:", w));
  if (!verdict.ok) {
    LogError("Import", "validateWorkbookData", 101, verdict.errors.join(" | "), fileName);
    ShowMsg("فایل وارد نشد — داده نامعتبر است:\n\n" + verdict.errors.join("\n") +
      "\n\nوضعیت برنامه بدون تغییر ماند.", vbCritical, "Import");
    return false;
  }
  const run = replaceMode
    ? () => adoptImportedSheets(cleanOrder, keyed, fileName)
    : () => upsertImportedSheets(cleanOrder, keyed, fileName);
  const ok = withTransactionSync({ action: "IMPORT", sheet: "-", recordId: fileName,
      status: "SUCCESS", notes: verdict.sheetCount + " sheets / " + verdict.totalRows + " rows" }, run);
  return ok === undefined ? false : ok;
}

function applyJsonBackup(fileName, p) {
  if (!p || !p.sheets || typeof p.sheets !== "object") {
    LogError("Import", "applyJsonBackup", 102, "bad JSON backup structure", fileName);
    ShowMsg("فایل پشتیبان معتبر نیست.", vbCritical, "Import");
    return false;
  }
  const order = Array.isArray(p.order) ? p.order : Object.keys(p.sheets);
  const ok = importValidatedSheets(order, p.sheets, fileName, true);
  if (!ok) return false;
  if (p.cp && typeof p.cp === "object") Object.assign(state.cp, p.cp);
  if (p.lockedSheets && typeof p.lockedSheets === "object") state.lockedSheets = p.lockedSheets;
  if (p.user) state.user = String(p.user);
  saveState();
  return true;
}

function resetToEmptyData(skipConfirm) {
  const doIt = () => {
    WB.order = APP_SHELL.order.slice();
    WB.sheets = JSON.parse(JSON.stringify(APP_SHELL.sheets));
    state.results = []; state.resultsMode = "search";
    state.undo = null; state.currentSheet = null; state.catFilter = "all";
    ["C7", "C16", "C23", "C41"].forEach(k => { state.cp[k] = ""; });
    modMapping.RefreshSearchIndex(false);
    saveState();
    WriteChangeLog("RESET", "-", "-", "SUCCESS", "workspace cleared — empty start");
    initUIFromState();
    updateStatLine();
    Toast("همه داده‌ها پاک شد — فضای کاری خام و آماده ورود فایل است.", "ok");
  };
  if (skipConfirm === true) { doIt(); return true; }
  ConfirmBox("پاک‌سازی داده‌ها",
    "همه داده‌های فعلی (از جمله فایل‌های واردشده) پاک می‌شود و سیستم به حالت خامِ اولیه برمی‌گردد. مطمئنید؟",
    doIt);
  return true;
}

function BuildExportWorkbook() {
  const out = XLSX.utils.book_new();
  const skip = {}; skip[IDX_SHEET] = 1; skip[UNDO_BUFFER_SHEET] = 1; skip[NAV_SHEET_NAME] = 1;
  for (const name of WB.order) {
    if (skip[name]) continue;
    const sh = WB.sheets[name]; if (!sh) continue;
    const ws = XLSX.utils.aoa_to_sheet(sh.rows || []);
    if (sh.merges && sh.merges.length) {
      ws["!merges"] = sh.merges.map(m => ({ s: { r: m.r1 - 1, c: m.c1 - 1 }, e: { r: m.r2 - 1, c: m.c2 - 1 } }));
    }
    let sn = name.replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31) || "Sheet";
    let uniq = sn, k = 2;
    while (out.SheetNames.indexOf(uniq) >= 0) { uniq = sn.slice(0, 28) + "_" + k; k++; }
    XLSX.utils.book_append_sheet(out, ws, uniq);
  }
  return out;
}

function ExportWorkbookXlsx() {
  try {
    const wb = BuildExportWorkbook();
    XLSX.writeFile(wb, "Mohsen_FINAL_v5_export_" + tsStamp() + ".xlsx");
    WriteChangeLog("EXPORT", "-", "-", "SUCCESS", "XLSX workbook export (" + wb.SheetNames.length + " sheets)");
    Toast("خروجی اکسل (XLSX) ذخیره شد.", "ok");
    return true;
  } catch (e) {
    ShowMsg("خروجی اکسل ناموفق بود.\n" + (e && e.message ? e.message : e), vbCritical, "Export");
    return false;
  }
}

const modImport = {
  OpenFile() {
    let inp = document.getElementById("import-file-input");
    if (!inp) {
      inp = document.createElement("input");
      inp.type = "file"; inp.id = "import-file-input";
      inp.accept = ".xlsx,.xlsm,.xls,.csv,.txt,.json";
      inp.style.display = "none";
      document.body.appendChild(inp);
      inp.addEventListener("change", () => modImport.HandleFile(inp.files ? inp.files[0] : null));
    }
    try {
      inp.value = "";
      inp.click();
      return true;
    } catch (e) {
      LogError("Import", "OpenFile", 104, e && e.message ? e.message : String(e));
      Toast("پنجره انتخاب فایل باز نشد — دوباره تلاش کنید.", "err");
      return false;
    }
  },
  HandleFile(file) {
    if (!file) return false;
    const name = file.name || "data";
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (ext === "json") {
      const rd = new FileReader();
      rd.onload = () => {
        try { applyJsonBackup(name, JSON.parse(rd.result)); Toast("فایل «" + name + "» وارد شد.", "ok"); }
        catch (e) { ShowMsg("فایل JSON معتبر نیست.\n" + e.message, vbCritical, "Import"); }
      };
      rd.readAsText(file);
      return true;
    }
    if (ext === "csv" || ext === "txt") {
      const rd = new FileReader();
      rd.onload = () => modImport.ImportCsv(name, rd.result);
      rd.readAsText(file, "utf-8");
      return true;
    }
    const rd = new FileReader();
    rd.onload = () => modImport.ImportExcel(name, rd.result);
    rd.readAsArrayBuffer(file);
    return true;
  },
  ImportExcel(name, buf) { return importWorkbookFromBuffer(name, buf); },
  ImportCsv(name, text) { return importCsvText(name, text); },
  ImportJson(name, text) {
    try { return applyJsonBackup(name, JSON.parse(text)); }
    catch (e) { ShowMsg("فایل JSON معتبر نیست.\n" + e.message, vbCritical, "Import"); return false; }
  },
  ExportWorkbook() { return ExportWorkbookXlsx(); },
  ResetEmpty() { return resetToEmptyData(); }
};

/* ================================================================
   modExportAllModules — export all VBA modules (as in the original)
   ================================================================ */
const modExportAllModules = {
  async ExportAllModules() {
    const names = Object.keys(VBA_MODULES || {});
    if (!names.length) { await ShowMsg("منبع VBA در دسترس نیست.", vbExclamation, "Export"); return; }
    let bundle = "' VBA Export — Mohsen_FINAL_v5 (extracted & decoded)\r\n' " + new Date().toISOString() + "\r\n\r\n";
    let count = 0;
    names.forEach(n => {
      bundle += "' ================================================================\r\n";
      bundle += "' ===== " + n + " =====\r\n";
      bundle += "' ================================================================\r\n";
      bundle += VBA_MODULES[n] + "\r\n\r\n";
      count++;
    });
    DownloadFile("VBA_Export_" + tsStamp() + ".bas", bundle, "text/plain");
    WriteChangeLog("EXPORT_VBA", "-", "-", "SUCCESS", count + " modules exported");
    await ShowMsg("Export انجام شد!\n" + count + " فایل ماژول در یک بسته .bas ذخیره شد.\n\n(در نسخه اصلی در پوشه VBA_Export\\ ذخیره می‌شد)",
      vbInformation, "Export All Modules");
  },
  DownloadModule(name) {
    if (!VBA_MODULES || !VBA_MODULES[name]) return;
    const ext = name.endsWith(".frm") ? ".frm" : name.endsWith(".cls") ? ".cls" : ".bas";
    DownloadFile(name.endsWith(".bas") || name.endsWith(".cls") || name.endsWith(".frm") ? name : name + ext,
      VBA_MODULES[name], "text/plain");
    Toast("دانلود " + name, "ok");
  }
};

/* ================================================================
   modValidation
   ================================================================ */
const modValidation = {
  async ValidateRequired(sValue, sFieldName, bShowMsg = true) {
    if (!TrimText(sValue)) {
      if (bShowMsg) await ShowMsg("لطفاً " + sFieldName + " را وارد کنید.", vbExclamation, "Validation");
      return false;
    }
    return true;
  },
  async ValidateSheetExists(sSheetName, bShowMsg = true) {
    if (!SheetExists(sSheetName)) {
      if (bShowMsg) await ShowMsg("شیت یافت نشد: " + sSheetName, vbExclamation, "Validation");
      return false;
    }
    return true;
  },
  async ValidateDataSheet(sSheetName, bShowMsg = true) {
    if (!(await this.ValidateSheetExists(sSheetName, bShowMsg))) return false;
    if (IsSystemSheet(sSheetName)) {
      if (bShowMsg) await ShowMsg("شیت " + sSheetName + " سیستمی است — انتخاب مجاز نیست.", vbExclamation, "Validation");
      return false;
    }
    return true;
  },
  async ValidateNumeric(sValue, sFieldName, bShowMsg = true) {
    if (isNaN(Number(sValue)) || TrimText(sValue) === "") {
      if (bShowMsg) await ShowMsg(sFieldName + " باید عددی باشد.", vbExclamation, "Validation");
      return false;
    }
    return true;
  },
  IsSearchIndexEmpty() {
    const ws = WB.sheets[IDX_SHEET];
    if (!ws) return true;
    return ws.rows.length < 2;
  },
  async ValidateArchiveSheet(archiveName, bShowMsg = true) {
    if (!SheetExists(archiveName)) {
      if (bShowMsg) await ShowMsg("شیت آرشیو یافت نشد: " + archiveName + "\nردیف حذف لغو شد.", vbExclamation, "Validation");
      return false;
    }
    return true;
  }
};

/* ================================================================
   modConstants tools — hide/unhide system sheets
   ================================================================ */
const modConstantsTools = {
  InitArchiveSheetNames() { /* compatibility stub */ },
  SystemSheetNames() { return SystemSheetNames().join(","); },
  IsSystemSheet(n) { return IsSystemSheet(n); },
  IsDataSheet(n) { return IsDataSheet(n); },
  SheetExists(n) { return SheetExists(n); },
  HideSystemSheets() { state.showSystem = false; saveState(); renderSheetChips(); Toast("شیت‌های سیستم مخفی شدند.", "ok"); },
  UnhideSystemSheets() { state.showSystem = true; saveState(); renderSheetChips(); Toast("شیت‌های سیستم نمایش داده شدند.", "ok"); }
};

/* ================================================================
   modButtonTools / modCreateUndoButton / modPatchFixes / modFixUnlock
   ================================================================ */
const modButtonTools = {
  AddGoToControlPanelButtons() {
    Toast("دکمه «کنترل پنل» روی همه شیت‌ها فعال است (نوار بالای هر شیت).", "ok");
  },
  GoToControlPanel() { GoToControlPanel(); },
  RepositionGoToButton() { /* web: button is fixed in the toolbar */ }
};
const modCreateUndoButton = {
  CreateUndoButton(bShowMsg = true) {
    // the UNDO button is part of the panel markup (next to REMOVE RECORD)
    if (bShowMsg) ShowMsg("✔ دکمه UNDO ساخته شد!", vbInformation, "UNDO Button");
    return true;
  }
};
const modPatchFixes = {
  FixButtonOnActions() {
    Toast("اتصال دکمه‌ها (OnAction) بازسازی شد.", "ok");
    WriteChangeLog("PATCH", CP_SHEET, "-", "SUCCESS", "FixButtonOnActions");
  }
};
const modFixUnlock = {
  async UnlockDataSheets() {
    const pw = await ShowInput("رمز شیت‌ها را وارد کنید (" + SHEET_PASSWORD + "):", "Unlock Data Sheets", "");
    if (pw === null) return;
    if (pw !== SHEET_PASSWORD) {
      HandleError("modFixUnlock", "UnlockDataSheets", 1002, "Incorrect sheet password");
      await ShowMsg("رمز عبور نادرست است.", vbCritical, "Unlock");
      return;
    }
    let unlocked = 0;
    WB.order.forEach(n => {
      if (n === CP_SHEET) return;
      if (state.lockedSheets[n]) { delete state.lockedSheets[n]; unlocked++; }
      else unlocked++;
    });
    saveState();
    if (state.currentSheet) renderSheetView(state.currentSheet);
    await ShowMsg(unlocked + " شیت آنلاک شد.\nCONTROL_PANEL همچنان محافظت‌شده باقی ماند.", vbInformation, "Unlock Done");
    WriteChangeLog("UNLOCK", "-", "-", "SUCCESS", unlocked + " sheets unlocked");
  }
};

/* ================================================================
   modLayout — panel layout (static) / UnprotectCP
   ================================================================ */
const modLayout = {
  DrawControlPanelLayout() {
    modUI.RefreshPanel();
    Toast("طرح‌بندی پنل کنترل بازسازی شد.", "ok");
  },
  UnprotectCP() {
    state.panelProtected = false;
    saveState();
    applyPanelProtection();
  }
};

/* ================================================================
   Forms — CFieldInput / frmSectionPicker (modFormBuilder / modFieldInput)
   ================================================================ */
const CFieldInput = {
  result: "Cancel", FieldValue: "",
  SetupForm(t, info, def) { this._t = t; this._info = info; this._def = def; this.result = "Cancel"; this.FieldValue = ""; },
  async Show() {
    const yn = await ShowMsg(this._info + "\n\nYES=ورود  NO=رد شدن  CANCEL=توقف", vbYesNoCancel | vbQuestion, this._t);
    if (yn === IDYES) {
      const v = await ShowInput(this._info, this._t, this._def || "");
      if (v === null) { this.result = "Cancel"; this.FieldValue = ""; }
      else { this.result = "OK"; this.FieldValue = TrimText(v); }
    } else if (yn === IDNO) {
      this.result = "SKIP"; this.FieldValue = "";
    } else {
      this.result = "Cancel"; this.FieldValue = "";
    }
    return this.result;
  }
};
const frmFieldInput = CFieldInput;
const frmSectionPicker = {
  result: "cancel",
  SetupForm(ttl, msg) { this._ttl = ttl; this._msg = msg; },
  Show() { return modAddRecord.SectionPicker(this._msg || ""); }
};
const modFormBuilder = {
  EnsureFieldInputForm() { return CFieldInput; },
  EnsureSectionPickerForm() { return frmSectionPicker; }
};
const modFieldInput = { frmFieldInput: CFieldInput };

/* ================================================================
   clsWatcher / clsWatcher1 — C7 / C23 change watchers
   ================================================================ */
function onSearchSheetChanged() {
  // clsWatcher1.mSheet_Change Case CELL_SEARCH_SHEET
  modUI.SetupKeyDropdown();
  state.cp.C9 = document.getElementById("cp-c9").value;
  state.cp.C11 = "";
  document.getElementById("cp-c11").value = "";
  saveState();
}
function onRemoveSheetChanged() {
  modUI.SetupRemoveKeyDropdown();
  state.cp.C25 = document.getElementById("cp-c25").value;
  state.cp.C27 = "";
  document.getElementById("cp-c27").value = "";
  saveState();
}
const clsWatcher1 = { WatchSheet() { /* DOM listeners installed in init */ } };
const clsWatcher = clsWatcher1;

/* ================================================================
   ThisWorkbook — Workbook_Open port
   ================================================================ */
async function Workbook_Open() {
  modConstantsTools.InitArchiveSheetNames();
  modUI.FixControlPanelGrid();
  modUI.SetupSheetDropdown();
  modUI.SetupAddSheetDropdown();
  modUI.SetupKeyDropdown();
  modUI.SetupRemoveKeyDropdown();
  modUI.SetupNavSheetDropdown();
  applyPanelProtection();
  renderExactToggle();
  modCreateUndoButton.CreateUndoButton(false);
  if (modValidation.IsSearchIndexEmpty()) {
    modMapping.RefreshSearchIndex(false);
    saveState();
  }
  GoToControlPanel();
}

/* ================================================================
   Macro registry — every public macro of the workbook
   ================================================================ */
const MACRO_REGISTRY = [
  // module, macro, description, runner
  ["modUI", "Auto_Open", "اجرای خودکار هنگام باز شدن فایل (شروع watcher)", () => Workbook_Open()],
  ["modUI", "StartWatcher", "شروع ناظر تغییرات C7/C23 (clsWatcher1)", () => { clsWatcher1.WatchSheet(); Toast("Watcher فعال شد.", "ok"); }],
  ["modUI", "InstallDataManager", "نصب/بازسازی کامل دیتامanager", () => modUI.InstallDataManager()],
  ["modUI", "RefreshPanel", "بازسازی پنل کنترل و dropdown ها", () => modUI.RefreshPanel()],
  ["modUI", "FixControlPanelGrid", "اصلاح طرح‌بندی پنل", () => modLayout.DrawControlPanelLayout()],
  ["modUI", "SetupSheetDropdown", "ساخت dropdown فیلتر شیت (C7)", () => modUI.SetupSheetDropdown()],
  ["modUI", "SetupAddSheetDropdown", "ساخت dropdown شیت مقصد (C16)", () => modUI.SetupAddSheetDropdown()],
  ["modUI", "SetupKeyDropdown", "ساخت dropdown ستون جستجو (C9) مطابق شیت انتخابی", () => modUI.SetupKeyDropdown()],
  ["modUI", "SetupRemoveKeyDropdown", "ساخت dropdown ستون حذف (C25)", () => modUI.SetupRemoveKeyDropdown()],
  ["modUI", "SetupNavSheetDropdown", "ساخت dropdown ناوبری (C41)", () => modUI.SetupNavSheetDropdown()],
  ["modUI", "ToggleExactMatch", "کلید تطابق دقیق جستجو (B12)", () => modUI.ToggleExactMatch()],
  ["modUI", "CreateExactMatchToggle", "ساخت کلید تطابق دقیق", () => { renderExactToggle(); Toast("Exact toggle آماده است.", "ok"); }],
  ["modUI", "NavigateToSheet", "باز کردن مستقیم شیت انتخابی (C41)", () => modUI.NavigateToSheet()],
  ["modUI", "ProtectControlPanel", "قفل کنترل پنل با رمز (شبیه‌سازی رفتار Excel، نه امنیت واقعی)", () => modUI.ProtectControlPanel()],
  ["modUI", "UnprotectControlPanel", "باز کردن قفل کنترل پنل (رمز 1234 — شبیه‌سازی، نه امنیت واقعی)", () => modUI.UnprotectControlPanel()],

  ["modSearchEngine", "SearchRecords", "جستجوی رکوردها (FULLTEXT / ستونی، ALL یا شیت خاص)", () => modSearchEngine.SearchRecords()],
  ["modSearchEngine", "SaveChanges", "ذخیره ویرایش‌های نتایج در شیت‌های مبدأ", () => modSearchEngine.SaveChanges()],
  ["modSearchEngine", "OpenSearchResults", "باز کردن شیت نتایج جستجو", () => modSearchEngine.OpenSearchResults()],
  ["modSearchEngine", "ClearSearchResults", "پاک کردن نتایج جستجو", () => modSearchEngine.ClearSearchResults()],
  ["modSearchEngine", "RefreshSearchIndexCore", "بازسازی ایندکس جستجو (با پیام)", () => modSearchEngine.RefreshSearchIndexCore()],
  ["modSearchEngine", "RefreshSearchIndexSilent", "بازسازی بی‌صدای ایندکس", () => { RefreshSearchIndexSilent(); saveState(); Toast("ایندکس بازسازی شد.", "ok"); }],

  ["modAddRecord", "StartAddWizard", "ویزارد افزودن رکورد (شعبه / خودپرداز / فرم فیلدها)", () => modAddRecord.StartAddWizard()],
  ["modAddRecord", "FindAtmRow", "یافتن ردیف جداسازی «شبکه خودپرداز» در شیت جاری", () => {
    const n = state.currentSheet || state.cp.C16;
    const r = modAddRecord.FindAtmRow(n);
    ShowMsg("FindAtmRow('" + n + "') = " + (r || 0), vbInformation, "FindAtmRow");
  }],

  ["modRemoveRecord", "StartRemoveWizard", "ویزارد حذف رکورد (انتخاب Match، نوع سرویس، آرشیو + حذف)", () => modRemoveRecord.StartRemoveWizard()],

  ["modUndo", "UndoLastRemove", "بازگردانی آخرین حذف (Undo Remove)", () => modUndo.UndoLastRemove()],
  ["modUndo", "HasUndoState", "بررسی وجود وضعیت Undo", async () => {
    await ShowMsg("HasUndoState = " + modUndo.HasUndoState(), vbInformation, "Undo");
  }],
  ["modUndo", "ClearUndoState", "پاک کردن بافر Undo", () => { modUndo.ClearUndoState(); Toast("بافر Undo پاک شد.", "ok"); updateStatLine(); }],
  ["modUndo", "InitUndoSession", "شروع جلسه Undo (قبل از حذف)", () => {
    modUndo.InitUndoSession("1"); Toast("جلسه Undo مقداردهی شد.", "ok");
  }],
  ["modUndo", "FinalizeUndoSession", "نهایی‌سازی جلسه Undo", () => { modUndo.FinalizeUndoSession(); Toast("جلسه Undo نهایی شد.", "ok"); }],

  ["modMapping", "RefreshSearchIndex", "بازسازی SYSTEM_SEARCH_INDEX از روی SYSTEM_SHEET_CONFIG", () => modMapping.RefreshSearchIndex(true)],
  ["modMapping", "GetMatchRows", "جستجوی ردیف‌های منطبق در ایندکس", async () => {
    const v = await ShowInput("مقدار جستجو:", "GetMatchRows", state.cp.C11 || state.cp.C27);
    if (v === null) return;
    const rows = modMapping.GetMatchRows("FULLTEXT", v, "ALL");
    await ShowMsg(rows.length + " ردیف منطبق یافت شد.", vbInformation, "GetMatchRows");
  }],

  ["modNavigator", "ShowSheetNavigator", "کارت‌های انتخاب شیت (Navigator)", () => modNavigator.ShowSheetNavigator()],
  ["modNavigator", "CloseNavigator", "بستن Navigator", () => modNavigator.CloseNavigator()],

  ["modExport", "ExportSearchResults", "خروجی نتایج جستجو (CSV)", () => modExport.ExportSearchResults()],
  ["modExport", "ExportCurrentData", "خروجی داده جاری / ایندکس (CSV)", () => modExport.ExportCurrentData()],
  ["modExport", "ExportChangeLog", "خروجی تاریخچه تغییرات (CSV)", () => modExport.ExportChangeLog()],
  ["modImport", "ImportDataFile", "ورود فایل داده (اکسل/CSV/JSON) — اجرای ماکروها روی داده جدید", () => modImport.OpenFile()],
  ["modImport", "ExportWorkbookXlsx", "خروجی کامل داده‌ها به فایل اکسل (XLSX)", () => ExportWorkbookXlsx()],
  ["modImport", "ResetToEmptyData", "پاک‌سازی همه داده‌ها و شروع خام", () => resetToEmptyData()],
  ["modValidation", "VerifySearchIndex", "بررسی سلامت ایندکس جستجو (دترمینیستیک)", () => {
    const v = verifySearchIndex();
    ShowMsg(v.ok ? "ایندکس جستجو سالم است." : "مشکلات ایندکس:\n" + v.problems.join("\n"), v.ok ? vbInformation : vbExclamation, "Search Index");
  }],
  ["modValidation", "RecoverSearchIndex", "بازسازی/بازیابی مطمئن ایندکس جستجو", () => recoverSearchIndex(true)],

  ["modExportAllModules", "ExportAllModules", "خروجی همه ماژول‌های VBA (بسته .bas)", () => modExportAllModules.ExportAllModules()],

  ["modChangeLog", "WriteChangeLog", "ثبت یک رویداد در CHANGE_LOG", async () => {
    const a = await ShowInput("نام عملیات:", "WriteChangeLog", "TEST");
    if (a === null) return;
    WriteChangeLog(a, state.currentSheet || "-", "-", "SUCCESS", "manual log");
    saveState(); Toast("در لاگ ثبت شد.", "ok");
  }],
  ["modChangeLog", "GetLogRowCount", "تعداد ردیف‌های لاگ", async () => {
    await ShowMsg("تعداد ردیف‌های لاگ: " + GetLogRowCount(), vbInformation, "GetLogRowCount");
  }],

  ["modValidation", "ValidateRequired", "اعتبارسنجی فیلد اجباری", async () => {
    const v = await ShowInput("مقدار آزمایشی:", "ValidateRequired", "");
    if (v === null) return;
    const ok = await modValidation.ValidateRequired(v, "فیلد آزمایشی");
    await ShowMsg("ValidateRequired = " + ok, vbInformation, "Validation");
  }],
  ["modValidation", "ValidateNumeric", "اعتبارسنجی عددی بودن", async () => {
    const v = await ShowInput("مقدار عددی:", "ValidateNumeric", "");
    if (v === null) return;
    const ok = await modValidation.ValidateNumeric(v, "فیلد عددی");
    await ShowMsg("ValidateNumeric = " + ok, vbInformation, "Validation");
  }],
  ["modValidation", "IsSearchIndexEmpty", "بررسی خالی بودن ایندکس", async () => {
    await ShowMsg("IsSearchIndexEmpty = " + modValidation.IsSearchIndexEmpty(), vbInformation, "Validation");
  }],

  ["modHelpers", "ClearOutputArea", "پاک‌سازی ناحیه خروجی (نتایج)", () => { modSearchEngine.ClearSearchResults(); Toast("ناحیه خروجی پاک شد.", "ok"); }],
  ["modHelpers", "RefreshPanel", "بازسازی پنل (delegate به modUI)", () => modUI.RefreshPanel()],

  ["modLayout", "DrawControlPanelLayout", "ترسیم مجدد طرح کنترل پنل", () => modLayout.DrawControlPanelLayout()],
  ["modLayout", "UnprotectCP", "باز کردن قفل پنل (بدون درخواست رمز — ابزار داخلی)", () => modLayout.UnprotectCP()],

  ["modButtonTools", "AddGoToControlPanelButtons", "افزودن دکمه «کنترل پنل» به شیت‌ها", () => modButtonTools.AddGoToControlPanelButtons()],
  ["modButtonTools", "GoToControlPanel", "رفتن به کنترل پنل", () => GoToControlPanel()],

  ["modCreateUndoButton", "CreateUndoButton", "ساخت دکمه UNDO", () => modCreateUndoButton.CreateUndoButton(true)],
  ["modPatchFixes", "FixButtonOnActions", "اصلاح اتصال دکمه‌ها به ماکروها", () => modPatchFixes.FixButtonOnActions()],

  ["modFixUnlock", "UnlockDataSheets", "رفع قفل همه شیت‌های داده (رمز 12346 — شبیه‌سازی، نه امنیت واقعی)", () => modFixUnlock.UnlockDataSheets()],

  ["modConstants", "InitArchiveSheetNames", "مقداردهی اولیه نام آرشیوها (سازگاری)", () => modConstantsTools.InitArchiveSheetNames()],
  ["modConstants", "SystemSheetNames", "فهرست نام شیت‌های سیستمی", async () => {
    await ShowMsg(SystemSheetNames().join("\n"), vbInformation, "SystemSheetNames");
  }],
  ["modConstants", "HideSystemSheets", "مخفی‌سازی شیت‌های سیستم (xlSheetVeryHidden)", () => modConstantsTools.HideSystemSheets()],
  ["modConstants", "UnhideSystemSheets", "نمایش شیت‌های سیستم", () => modConstantsTools.UnhideSystemSheets()],

  ["modErrorLog", "LogError", "ثبت خطا در CHANGE_LOG", () => {
    LogError("Manual", "LogError", 0, "manual error entry");
    saveState(); Toast("خطا در لاگ ثبت شد.", "warn");
  }],
  ["modErrorLog", "HandleError", "ثبت و نمایش خطا", () => HandleError("Manual", "HandleError", 0, "manual handle-error entry")],

  ["modUnicode", "ShowMsg", "نمایش پیام (MessageBoxW معادل)", () => ShowMsg("این پیام معادل ShowMsg/MessageBoxW است.", vbInformation, "ShowMsg")],
  ["modUnicode", "ShowInput", "دریافت ورودی (InputBox معادل)", async () => {
    const v = await ShowInput("یک مقدار وارد کنید:", "ShowInput", "مقدار نمونه");
    if (v !== null) await ShowMsg("مقدار دریافتی: " + v, vbInformation, "ShowInput");
  }],

  ["CFieldInput", "SetupForm + Show", "دیالوگ YES=ورود / NO=رد / CANCEL=توقف برای هر فیلد", async () => {
    CFieldInput.SetupForm("Field Input", "فیلد نمونه: شاخص", "");
    const r = await CFieldInput.Show();
    await ShowMsg("result = " + r + "\nFieldValue = " + CFieldInput.FieldValue, vbInformation, "CFieldInput");
  }],
  ["frmSectionPicker", "SetupForm", "فرم انتخاب بخش: شعبه / خودپرداز / انصراف", async () => {
    const r = await modAddRecord.SectionPicker(state.currentSheet || state.cp.C16 || "(sheet)");
    await ShowMsg("result = " + r, vbInformation, "frmSectionPicker");
  }],
  ["modFormBuilder", "EnsureFieldInputForm", "آماده‌سازی فرم ورود فیلد", () => { modFormBuilder.EnsureFieldInputForm(); Toast("فرم آماده است.", "ok"); }],
  ["modFieldInput", "frmFieldInput", "نمونه ورود فیلد (اتصال به CFieldInput)", async () => {
    frmFieldInput.SetupForm("Field Input", "مقدار فیلد", "");
    const r = await frmFieldInput.Show();
    await ShowMsg("result = " + r, vbInformation, "modFieldInput");
  }],

  ["clsWatcher1", "WatchSheet", "اتصال ناظر تغییرات به کنترل پنل", () => {
    clsWatcher1.WatchSheet();
    Toast("clsWatcher1 به CONTROL_PANEL متصل شد.", "ok");
  }],

  ["ThisWorkbook", "Workbook_Open", "رویداد باز شدن فایل (راه‌اندازی کامل سیستم)", () => Workbook_Open()],
  ["ThisWorkbook", "Workbook_BeforeClose", "قفل پنل هنگام بستن", () => modUI.ProtectControlPanel()],
];

const VBA_MODULE_META = {
  "modUI.bas": "رابط کاربری، dropdown ها، toggle تطابق دقیق، محافظت پنل",
  "modSearchEngine.bas": "موتور جستجو، نتایج Match-Block، ذخیره تغییرات",
  "modAddRecord.bas": "ویزارد افزودن رکورد (شعبه/خودپرداز)",
  "modRemoveRecord.bas": "ویزارد حذف رکورد با آرشیو و Undo",
  "modUndo.bas": "بازگردانی حذف (بافر SYSTEM_UNDO_BUFFER)",
  "modLayout.bas": "طرح‌بندی کنترل پنل",
  "modNavigator.bas": "کارت‌های انتخاب شیت",
  "modMapping.bas": "نگاشت فیلدها و ایندکس جستجو",
  "ThisWorkbook.cls": "رویدادهای workbook",
  "modButtonTools.bas": "دکمه بازگشت به کنترل پنل",
  "modConstants.bas": "ثابت‌ها و تشخیص شیت سیستمی",
  "modValidation.bas": "اعتبارسنجی ورودی‌ها",
  "modChangeLog.bas": "ثبت تغییرات (CHANGE_LOG)",
  "modHelpers.bas": "توابع کمکی",
  "modExportAllModules.bas": "خروجی ماژول‌های VBA",
  "modCreateUndoButton.bas": "ساخت دکمه UNDO",
  "modErrorLog.bas": "ثبت خطاها",
  "modExport.bas": "خروجی‌گیری (Excel/CSV)",
  "clsWatcher1.cls": "ناظر تغییرات C7/C23 (نسخه بهبودیافته)",
  "clsWatcher.cls": "ناظر تغییرات",
  "frmSectionPicker.frm": "فرم انتخاب بخش",
  "CFieldInput.cls": "کلاس ورود فیلد (YES/NO/CANCEL)",
  "modPatchFixes.bas": "اصلاحات و اتصال دکمه‌ها",
  "modFixUnlock.bas": "رفع قفل شیت‌ها",
  "modUnicode.bas": "MessageBoxW فارسی",
  "modFormBuilder.bas": "سازنده فرم",
  "modFieldInput.bas": "ورود فیلد",
};

function renderMacrosView() {
  const body = document.getElementById("macros-body");
  const byMod = {};
  MACRO_REGISTRY.forEach(([mod, name, desc]) => {
    (byMod[mod] = byMod[mod] || []).push({ name, desc });
  });
  let html = "";
  Object.keys(byMod).forEach(mod => {
    html += `<div class="macro-mod fade-in"><div class="mh">
      <svg viewBox="0 0 24 24" fill="none" stroke="#7dd3fc" stroke-width="2" style="width:15px;height:15px"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg>
      <span class="nm">${escapeHtml(mod)}</span>
      <span class="cnt">${byMod[mod].length} macro</span></div>`;
    byMod[mod].forEach(m => {
      html += `<div class="macro-item">
        <div class="mnm">${escapeHtml(m.name)}</div>
        <div class="mds">${escapeHtml(m.desc)}</div>
        <button class="macro-run" data-act="run-macro-index" data-mod="${escapeHtmlAttr(mod)}" data-name="${escapeHtmlAttr(m.name)}">▶ اجرا</button>
      </div>`;
    });
    html += "</div>";
  });
  html += `<div class="macro-mod fade-in"><div class="mh">
    <svg viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" stroke-width="2" style="width:15px;height:15px"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h5"/></svg>
    <span class="nm">VBA Sources — فایل اصلی</span>
    <span class="cnt">${Object.keys(VBA_MODULES || {}).length} module</span></div>`;
  Object.keys(VBA_MODULES || {}).sort().forEach(name => {
    const meta = VBA_MODULE_META[name] || "";
    html += `<div class="macro-item">
      <div class="mnm">${escapeHtml(name)}</div>
      <div class="mds">${escapeHtml(meta)}</div>
      <button class="macro-run" data-act="show-vba" data-name="${escapeHtmlAttr(name)}">👁 مشاهده</button>
      <button class="macro-dl" data-act="download-module" data-name="${escapeHtmlAttr(name)}">⬇</button>
    </div>`;
  });
  html += "</div>";
  body.innerHTML = html;
}

/* ================================================================
   DASHBOARD — KPIs, charts, activity feed
   ================================================================ */
function countRows(sheetName) {
  const sh = WB.sheets[sheetName];
  if (!sh) return 0;
  let n = 0;
  for (const r of sh.rows) if (r.some(c => c !== null && c !== undefined && String(c).trim() !== "")) n++;
  return n;
}
function renderDashboard() {
  const kpis = document.getElementById("dash-kpis");
  if (!kpis) return;
  const dataSheets = WB.order.filter(n => IsDataSheet(n)).length;
  const totalRecords = WB.order.filter(n => IsDataSheet(n)).reduce((s, n) => s + Math.max(0, countRows(n) - 1), 0);
  const idxCount = WB.sheets[IDX_SHEET] ? Math.max(0, WB.sheets[IDX_SHEET].rows.length - 1) : 0;
  const logCount = GetLogRowCount();
  const undoReady = !!(state.undo && state.undo.valid);

  const kpiDefs = [
    { cls: "g-cyan", val: dataSheets, lbl: "شیت‌های داده شبکه", trend: ["info", "شعب • مراکز داده • تجهیزات"],
      ico: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16"/>' },
    { cls: "g-blue", val: totalRecords.toLocaleString("fa-IR"), lbl: "کل رکوردهای ثبت‌شده", trend: ["up", "IP • VLAN • روتر • سوییچ"],
      ico: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>' },
    { cls: "g-violet", val: idxCount.toLocaleString("fa-IR"), lbl: "رکوردهای ایندکس جستجو", trend: ["info", "FULLTEXT آماده"],
      ico: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>' },
    { cls: "g-amber", val: logCount.toLocaleString("fa-IR"), lbl: "رویداد ثبت‌شده در لاگ", trend: ["warn", "ADD • REMOVE • EDIT"],
      ico: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>' },
    { cls: undoReady ? "g-green" : "g-red",
      val: undoReady ? "آماده" : "—", lbl: "وضعیت Undo حذف",
      trend: [undoReady ? "up" : "idle", undoReady ? state.undo.blockCount + " بلوک قابل بازگشت" : "بدون عملیات حذف"],
      ico: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>' },
  ];
  kpis.innerHTML = kpiDefs.map(k => `
    <div class="kpi">
      <div class="k-ico ${k.cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${k.ico}</svg></div>
      <div class="k-val">${k.val}</div>
      <div class="k-lbl">${k.lbl}</div>
      <div class="k-trend ${k.trend[0]}">${k.trend[1]}</div>
    </div>`).join("");

  renderDonut(totalRecords);
  renderBars();
  renderFeed();
  renderDashCats();
}

function topSheetStats(limit) {
  const arr = WB.order.filter(n => IsDataSheet(n)).map(n => ({ name: n, rows: Math.max(0, countRows(n) - 1) }));
  arr.sort((a, b) => b.rows - a.rows);
  return arr.slice(0, limit);
}
function renderDonut(totalRecords) {
  const host = document.getElementById("dash-donut");
  const legend = document.getElementById("dash-legend");
  if (!host) return;
  const cats = [
    { name: "شعب و استان‌ها", color: "#22d3ee", test: n => /استان|خراسان|خوزستان|فارس|کردستان|لرستان|همدان|مرکزی|کرمانشاه|قزوین|ایلام|اصفهان|بوشهر|بختیاری|سمنان|زنجان|کهکلویه|یزد|گیلان|مازندران|هرمزگان|کرمان|قم|تهران|البرز|اردبیل|آذر|سیستان|گلستان/.test(n) },
    { name: "مراکز داده و دفاتر", color: "#6366f1", test: n => /مرکز داده|ساختمان|سازمان/.test(n) },
    { name: "سرویس‌های شبکه", color: "#8b5cf6", test: n => /شبکه|VSAT|SIP|VPN|اینترنت|MPLS|آنتی|دور کاری|نوری/.test(n) },
    { name: "تجهیزات و EOL/EOS", color: "#f59e0b", test: n => /تجهیزات|EOL|PIN PAD/.test(n) },
    { name: "هزینه و گزارش‌ها", color: "#10b981", test: n => /هزینه|گزارش|جمع|لیست|PSP|شعب$/.test(n) },
  ];
  const vals = cats.map(c => WB.order.filter(n => IsDataSheet(n) && c.test(n)).reduce((s, n) => s + Math.max(0, countRows(n) - 1), 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = vals.map((v, i) => {
    const frac = v / total;
    const seg = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${cats[i].color}" stroke-width="17"
      stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-acc * C).toFixed(2)}"
      transform="rotate(-90 70 70)" stroke-linecap="butt" opacity=".92"/>`;
    acc += frac;
    return seg;
  }).join("");
  host.innerHTML = `
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="rgba(120,160,255,.1)" stroke-width="17"/>
      ${segs}
      <text x="70" y="66" text-anchor="middle" fill="#eaf1ff" font-size="19" font-weight="800" font-family="inherit">${totalRecords.toLocaleString("fa-IR")}</text>
      <text x="70" y="86" text-anchor="middle" fill="#64748f" font-size="9.5">کل رکوردها</text>
    </svg>`;
  legend.innerHTML = cats.map((c, i) => `
    <div class="li"><span class="sw" style="background:${c.color}"></span>${c.name}
      <span class="vv">${vals[i].toLocaleString("fa-IR")}</span></div>`).join("");
}
function renderBars() {
  const host = document.getElementById("dash-bars");
  if (!host) return;
  const top = topSheetStats(7);
  const max = Math.max(...top.map(t => t.rows), 1);
  host.innerHTML = top.map(t => `
    <div class="bar-row" title="${escapeHtmlAttr(t.name)}">
      <div class="nm">${escapeHtml(t.name)}</div>
      <div class="tr"><div class="fl" style="width:${Math.max(4, Math.round(t.rows / max * 100))}%"></div></div>
      <div class="vv">${t.rows.toLocaleString("fa-IR")}</div>
    </div>`).join("");
}
function renderFeed() {
  const host = document.getElementById("dash-feed");
  if (!host) return;
  const log = WB.sheets[LOG_SHEET];
  const rows = (log ? log.rows : []).slice(1).filter(r => r.some(c => c !== null && c !== undefined && String(c).trim() !== ""));
  const colors = { ADD: "#22c55e", REMOVE: "#ef4444", UNDO: "#f59e0b", EDIT: "#3b82f6", ERROR: "#ef4444", ARCHIVE_FAIL: "#ef4444" };
  if (!rows.length) {
    host.innerHTML = '<div class="empty-state" style="padding:22px">هنوز رویدادی ثبت نشده است.</div>';
    return;
  }
  host.innerHTML = rows.slice(-9).reverse().map(r => `
    <div class="feed-item">
      <div class="feed-dot" style="background:${colors[r[1]] || "#64748f"};box-shadow:0 0 8px ${colors[r[1]] || "#64748f"}"></div>
      <div class="ft"><b>${escapeHtml(r[1] || "")}</b> — ${escapeHtml(r[2] || "")}
        ${r[5] ? ' <span class="badge-soft" style="font-size:8.5px">' + escapeHtml(r[5]) + "</span>" : ""}</div>
      <div class="fd">${escapeHtml(r[0] || "")}</div>
    </div>`).join("");
}

function showVbaSource(name) {
  const src = (VBA_MODULES || {})[name] || "(missing)";
  ModalBox({ title: name, cls: "info", text: src, buttons: [{ id: IDOK, label: "بستن", cls: "ok" }] });
}
function RunMacroIndex(mod, name) {
  const entry = MACRO_REGISTRY.find(m => m[0] === mod && m[1] === name);
  if (entry) entry[3]();
}
function RunMacro(path) {
  const [mod, name] = path.split(".");
  const entry = MACRO_REGISTRY.find(m => m[0] === mod && m[1] === name);
  if (!entry) {
    ShowMsg("ماکرو یافت نشد: " + path, vbExclamation, "RunMacro");
    return;
  }
  WriteChangeLog("RUN_MACRO", mod + "." + name, "-", "SUCCESS", "");
  // transactional execution: snapshot -> run -> save once; rollback +
  // observable error log if the macro throws at any point
  Promise.resolve(withTransaction({ action: mod + "." + name, sheet: "-" }, () => entry[3]()))
    .catch(e => LogError("RunMacro", path, 500, e && e.message ? e.message : String(e)));
}

/* ================================================================
   EVENT DELEGATION — no inline onclick/onchange handlers anywhere
   (CSP-friendly: script-src-attr 'none'; maintainable: one dispatch
   table). Data strings only travel through DOM attributes (dataset),
   never through executable JS strings.
   ================================================================ */
const ACTIONS = {
  "run-macro": el => RunMacro(el.dataset.arg),
  "run-macro-index": el => RunMacroIndex(el.dataset.mod, el.dataset.name),
  "open-file": () => modImport.OpenFile(),
  "export-xlsx": () => ExportWorkbookXlsx(),
  "reset-empty": () => resetToEmptyData(),
  "backup": () => backupAll(),
  "restore": () => restoreAll(),
  "reset-all": () => resetAll(),
  "go-cp": () => GoToControlPanel(),
  "switch-view": el => switchView(el.dataset.view),
  "toggle-sidebar": () => { const sb = document.getElementById("sidebar"); if (sb) sb.classList.toggle("open"); },
  "toggle-lock": () => toggleSheetLock(),
  "filter-rows": () => filterSheetRows(),
  "export-sheet-csv": () => exportCurrentSheetCSV(),
  "clear-log": () => clearLog(),
  "open-sheet": el => openSheetCard(el.dataset.name),
  "nav-sheet": el => modNavigator.NavToSelectedSheet(el.dataset.name),
  "open-category": el => openCategory(el.dataset.cat),
  "set-filter": el => setCatFilter(el.dataset.cat),
  "show-vba": el => showVbaSource(el.dataset.name),
  "download-module": el => modExportAllModules.DownloadModule(el.dataset.name),
  "show-more-rows": el => { state.pageLimit += 500; renderSheetView(el.dataset.name); }
};
function bindDelegatedEvents() {
  document.addEventListener("click", e => {
    const el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el) return;
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    // never cancel the native default action of form controls / links
    // (cancelling input.click() would block the browser file dialog!)
    const tag = el.tagName;
    if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA" && tag !== "A") e.preventDefault();
    fn(el);
  });
  // file input: bound directly (not via data-act) so its native click
  // default action — the OS file dialog — always opens
  const fi = document.getElementById("import-file-input");
  if (fi && !fi._bound) {
    fi._bound = true;
    fi.addEventListener("change", () => modImport.HandleFile(fi.files ? fi.files[0] : null));
  }
}

/* ================================================================
   INIT
   ================================================================ */
function initUIFromState() {
  modUI.SetupSheetDropdown();
  modUI.SetupAddSheetDropdown();
  modUI.SetupKeyDropdown();
  modUI.SetupRemoveKeyDropdown();
  modUI.SetupNavSheetDropdown();
  // reflect cp values
  document.getElementById("cp-c7").value = state.cp.C7;
  document.getElementById("cp-c9").value = state.cp.C9;
  document.getElementById("cp-c11").value = state.cp.C11;
  document.getElementById("cp-c16").value = state.cp.C16;
  document.getElementById("cp-c23").value = state.cp.C23;
  document.getElementById("cp-c25").value = state.cp.C25;
  document.getElementById("cp-c27").value = state.cp.C27;
  document.getElementById("cp-c41").value = state.cp.C41;
  renderExactToggle();
  applyPanelProtection();
  renderSheetCatalog();
  updateStatLine();
  renderDashboard();
}

function bindPanelEvents() {
  const g = id => document.getElementById(id);
  g("cp-c7").addEventListener("change", e => { state.cp.C7 = e.target.value; onSearchSheetChanged(); });
  g("cp-c9").addEventListener("change", e => { state.cp.C9 = e.target.value; saveState(); });
  g("cp-c11").addEventListener("input", e => { state.cp.C11 = e.target.value; saveState(); });
  g("cp-c11").addEventListener("keydown", e => { if (e.key === "Enter") RunMacro("modSearchEngine.SearchRecords"); });
  g("cp-c16").addEventListener("change", e => { state.cp.C16 = e.target.value; saveState(); });
  g("cp-c23").addEventListener("change", e => { state.cp.C23 = e.target.value; onRemoveSheetChanged(); });
  g("cp-c25").addEventListener("change", e => { state.cp.C25 = e.target.value; saveState(); });
  g("cp-c27").addEventListener("input", e => { state.cp.C27 = e.target.value; saveState(); });
  g("cp-c27").addEventListener("keydown", e => { if (e.key === "Enter") RunMacro("modRemoveRecord.StartRemoveWizard"); });
  g("cp-c41").addEventListener("change", e => { state.cp.C41 = e.target.value; saveState(); });
  g("exact-toggle").addEventListener("click", () => modUI.ToggleExactMatch());

  document.querySelectorAll(".tab-btn").forEach(b => {
    b.addEventListener("click", () => switchView(b.dataset.view));
  });
  document.getElementById("sheet-filter").addEventListener("keydown", e => {
    if (e.key === "Enter") filterSheetRows();
  });
  const gs = document.getElementById("global-search");
  if (gs) gs.addEventListener("keydown", e => {
    if (e.key === "Enter" && gs.value.trim()) {
      state.cp.C7 = "ALL";
      state.cp.C9 = "FULLTEXT";
      state.cp.C11 = gs.value.trim();
      const c7 = document.getElementById("cp-c7"); if (c7) c7.value = "ALL";
      const c9 = document.getElementById("cp-c9"); if (c9) c9.value = "FULLTEXT";
      const c11 = document.getElementById("cp-c11"); if (c11) c11.value = state.cp.C11;
      RunMacro("modSearchEngine.SearchRecords");
    }
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  // observable error handling: nothing gets swallowed silently
  window.addEventListener("error", e => {
    LogError("Window", "onerror", e && e.error && e.error.number ? e.error.number : 0,
      (e && e.message) ? e.message : "script error", (e && e.filename) ? e.filename + ":" + (e && e.lineno) : "");
    Toast("خطای غیرمنتظره رخ داد — جزئیات در تاریخچه تغییرات (ERROR) ثبت شد.", "err");
  });
  window.addEventListener("unhandledrejection", e => {
    const r = e && e.reason;
    LogError("Window", "unhandledrejection", 0, r && r.message ? r.message : String(r));
  });
  console.info("%cSecurity note", "color:#f59e0b;font-weight:bold",
    " — Passwords and sheet locks in this app only SIMULATE the Excel workbook behavior. They are NOT real security. All data lives in the browser; anyone with the file/data can read it.");
  // hydrate EMPTY application shell — no business data at all.
  // Data arrives via file import (xlsx/xlsm/csv/json); every macro then
  // runs on the imported dataset.
  WB.order = APP_SHELL.order.slice();
  WB.sheets = JSON.parse(JSON.stringify(APP_SHELL.sheets));
  // restore saved session (previously imported data), if any
  const restored = loadState();
  // initial CP defaults (if no session)
  if (!restored) {
    state.cp.C7 = "";
    state.cp.C9 = "شاخص";
    state.cp.C11 = "";
    state.cp.B12 = "ON";
    state.cp.C16 = "";
    state.cp.C23 = "";
    state.cp.C25 = "شاخص";
    state.cp.C27 = "";
    state.cp.C41 = "";
    state.user = "Web User";
  }
  bindDelegatedEvents();
  bindPanelEvents();
  await Workbook_Open();
  initUIFromState();
  renderResultsView();
  // deterministic index: verify on load; auto-recover if missing/corrupt
  if (!verifySearchIndex().ok) {
    modMapping.RefreshSearchIndex(false);
  }
  if (!restored) {
    // auto-rebuild index like Workbook_Open when empty
    if (modValidation.IsSearchIndexEmpty()) {
      modMapping.RefreshSearchIndex(false);
    }
    saveState();
    Toast("سیستم خام و آماده است — فایل داده (اکسل/CSV) را وارد کنید.", "ok");
  }
  updateStatLine();
});


/* ================================================================
   SHEET CATEGORIES — beautiful grouping of network sheets
   ================================================================ */
/* Icon geometry as pure DATA (tag + attributes) — the single source for
   catSvgNode (DOM) and the transitional catSvg string renderer used by
   panel templates not yet converted; the string renderer is deleted in
   the panels commit. */
const CAT_ICON_SHAPES = {
  pin: [["path", { d: "M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z" }], ["circle", { cx: "12", cy: "10", r: "2.6" }]],
  server: [["rect", { x: "3", y: "4", width: "18", height: "7", rx: "2" }], ["rect", { x: "3", y: "13", width: "18", height: "7", rx: "2" }], ["path", { d: "M7 7.5h.01M7 16.5h.01" }]],
  globe: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M3 12h18" }], ["path", { d: "M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18z" }]],
  signal: [["path", { d: "M5 12.5a9 9 0 0 1 14 0" }], ["path", { d: "M8.5 15.5a5 5 0 0 1 7 0" }], ["circle", { cx: "12", cy: "18.5", r: "1.3" }], ["path", { d: "M2 9a14 14 0 0 1 20 0" }]],
  chip: [["rect", { x: "7", y: "7", width: "10", height: "10", rx: "2" }], ["path", { d: "M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" }]],
  coins: [["ellipse", { cx: "12", cy: "6", rx: "7", ry: "3" }], ["path", { d: "M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" }], ["path", { d: "M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" }]],
  gear: [["circle", { cx: "12", cy: "12", r: "3" }], ["path", { d: "M19 12a7 7 0 0 0-.2-1.6l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.7-1.6L13.4 2h-2.8l-.4 2.9a7 7 0 0 0-2.7 1.6l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .5.1 1.1.2 1.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.7-1.6l.4 2.9h2.8l.4-2.9a7 7 0 0 0 2.7-1.6l2.3 1 2-3.4-2-1.5c.1-.5.2-1 .2-1.6z" }]],
  layers: [["path", { d: "m12 2 9 5-9 5-9-5z" }], ["path", { d: "m3 12 9 5 9-5" }], ["path", { d: "m3 17 9 5 9-5" }]]
};
const SHEET_CATEGORIES = [
  { id: "provinces", name: "استان‌ها و شعب", sub: "Provinces & Branches", color: "#22d3ee", icon: "pin",
    test: n => PROVINCIAL_SHEETS.indexOf(n) >= 0 || /^شعب/.test(n) || /ادغامی|تخریب/.test(n) },
  { id: "datacenters", name: "مراکز داده و دفاتر", sub: "Data Centers & Offices", color: "#6366f1", icon: "server",
    test: n => /مرکز داده|ساختمان|سازمان/.test(n) },
  { id: "services", name: "سرویس‌های شبکه", sub: "Network Services", color: "#8b5cf6", icon: "globe",
    test: n => /شبکه|VSAT|SIP|VPN|اینترنت|MPLS|آنتی|دور کاری|نوری|PIN PAD|گزارش آماری/.test(n) },
  { id: "carriers", name: "اپراتورها و جمع‌آوری", sub: "Carriers & Collect", color: "#f59e0b", icon: "signal",
    test: n => /جمع ?آ?اوری|جمع آوری|جمع اوری|PSP|مبین|آسیاتک|اسیاتک/.test(n) },
  { id: "equipment", name: "تجهیزات و چرخه عمر", sub: "Equipment & Lifecycle", color: "#22c55e", icon: "chip",
    test: n => /تجهیزات|EOL|EOS/.test(n) },
  { id: "costs", name: "هزینه‌ها و قراردادها", sub: "Costs & Contracts", color: "#ec4899", icon: "coins",
    test: n => /هزینه/.test(n) },
  { id: "system", name: "سیستم", sub: "System Sheets", color: "#64748f", icon: "gear",
    test: n => IsSystemSheet(n) },
];
const CAT_OTHER = { id: "other", name: "سایر", sub: "Other", color: "#94a3b8", icon: "layers", test: () => true };

// match priority: specific categories before broad keyword ones
const CAT_MATCH_ORDER = ["provinces", "equipment", "carriers", "costs", "datacenters", "services", "system"];
function categoryOf(name) {
  for (const id of CAT_MATCH_ORDER) {
    const c = SHEET_CATEGORIES.find(x => x.id === id);
    if (c && c.test(name)) return c;
  }
  return CAT_OTHER;
}
function sheetsOfCategory(catId) {
  return WB.order.filter(n => {
    if (catId === "all") return true;
    if (catId === "other") {
      const c = categoryOf(n);
      return c.id === "other" || (c.id === "system" && catId === "other") ? c.id === "other" : false;
    }
    return categoryOf(n).id === catId;
  });
}
function catStats(catId) {
  const names = sheetsOfCategory(catId);
  return {
    count: names.length,
    rows: names.reduce((s, n) => s + Math.max(0, countRows(n) - 1), 0)
  };
}
function catSvgNode(cat, cls) {
  const shapes = CAT_ICON_SHAPES[cat.icon] || CAT_ICON_SHAPES.layers;
  return sEl("svg", {
    class: cls || "", viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round"
  }, ...shapes.map(([tag, attrs]) => sEl(tag, attrs)));
}
function catSvg(cat, cls) {
  // TRANSITIONAL string renderer for panel templates not yet converted;
  // builds only from the static CAT_ICON_SHAPES constants. Deleted in the
  // panels commit once every caller uses catSvgNode.
  const shapes = CAT_ICON_SHAPES[cat.icon] || CAT_ICON_SHAPES.layers;
  const body = shapes.map(([tag, attrs]) =>
    "<" + tag + Object.keys(attrs).map(k => ` ${k}="${attrs[k]}"`).join("") + "/>").join("");
  return `<svg class="${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${body}</svg>`;
}
function allCatsWithOther() {
  const list = SHEET_CATEGORIES.slice();
  const hasOther = WB.order.some(n => categoryOf(n).id === "other");
  if (hasOther) list.push(CAT_OTHER);
  return list;
}

/* ---- dashboard category tiles ---- */
function emptyStateHtml(msg) {
  return `
    <div class="empty-state fade-in">
      <div class="es-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="1.6" stroke-linecap="round"><path d="M12 16V4m0 0 4 4m-4-4-4 4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
      </div>
      <h3>هنوز داده‌ای وجود ندارد</h3>
      <p>${msg || "سیستم خام و آماده است — فایل اکسل (.xlsx / .xlsm) یا CSV خود را وارد کنید تا همه ماکروها روی داده‌های شما اجرا شوند."}</p>
      <button class="btn btn-primary" data-act="open-file">📂 ورود فایل داده</button>
    </div>`;
}
function renderDashCats() {
  const host = document.getElementById("dash-cats");
  if (!host) return;
  if (!WB.order.some(n => IsDataSheet(n))) {
    host.innerHTML = emptyStateHtml();
    return;
  }
  const cats = allCatsWithOther().filter(c => c.id !== "system" || state.showSystem);
  host.innerHTML = cats.map(c => {
    const st = catStats(c.id);
    return `
    <div class="cat-tile" style="color:${c.color}" data-act="open-category" data-cat="${c.id}">
      <div class="ct-val">${st.count}</div>
      <div class="ct-ico" style="background:${c.color}22;color:${c.color}">${catSvg(c)}</div>
      <div class="ct-name" style="color:var(--txt-0)">${c.name}</div>
      <div class="ct-meta">${st.rows.toLocaleString("fa-IR")} رکورد · ${c.sub}</div>
      <div class="ct-ring"></div>
    </div>`;
  }).join("");
}
function openCategory(catId) {
  state.catFilter = catId || "all";
  switchView("sheet");
  renderSheetCatalog();
}

/* ---- category filter bar + sheet card catalog ---- */
function renderCatBar() {
  const host = document.getElementById("cat-bar");
  if (!host) return;
  const cats = [{ id: "all", name: "همه شیت‌ها", color: "#3b82f6", icon: "layers" }].concat(
    allCatsWithOther().filter(c => c.id !== "system" || state.showSystem));
  host.innerHTML = cats.map(c => {
    const st = c.id === "all"
      ? { count: WB.order.filter(n => IsDataSheet(n) || state.showSystem).length }
      : catStats(c.id);
    const active = (state.catFilter || "all") === c.id;
    const bg = active ? `background:linear-gradient(135deg,${c.color}cc,${c.color}88)` : "";
    return `<div class="cat-pill ${active ? "active" : ""}" style="${bg};${active ? "" : ""}" data-act="set-filter" data-cat="${c.id}">
      <span class="cp-ico" style="color:${active ? "#fff" : c.color}">${catSvg(c)}</span>
      ${c.name}
      <span class="cp-n">${st.count}</span>
    </div>`;
  }).join("");
}
function setCatFilter(catId) {
  state.catFilter = catId;
  renderSheetCatalog();
}
function sheetTags(name) {
  const tags = [];
  const n = name;
  if (/IP|ip/.test(n)) tags.push("IP");
  if (/تجهیزات/.test(n)) tags.push("Router/Switch");
  if (/هزینه/.test(n)) tags.push("مالی");
  if (/گزارش/.test(n)) tags.push("گزارش");
  if (/VPN|MPLS|VSAT|SIP/.test(n)) tags.push("WAN");
  if (/جمع/.test(n)) tags.push("آرشیو");
  if (PROVINCIAL_SHEETS.indexOf(n) >= 0) tags.push("استان");
  return tags.slice(0, 3);
}
function renderSheetCatalog() {
  renderCatBar();
  const host = document.getElementById("sheet-catalog");
  if (!host) return;
  if (!WB.order.some(n => IsDataSheet(n) || (state.showSystem && IsSystemSheet(n)))) {
    host.innerHTML = emptyStateHtml("هیچ شیت داده‌ای در کار نیست — ابتدا فایل داده خود را وارد کنید.");
    return;
  }
  const filter = state.catFilter || "all";
  const cats = filter === "all"
    ? allCatsWithOther().filter(c => c.id !== "system" || state.showSystem)
    : allCatsWithOther().filter(c => c.id === filter);
  let html = "";
  cats.forEach(c => {
    const names = WB.order.filter(n => {
      if (c.id === "system") return IsSystemSheet(n);
      if (c.id === "other") return categoryOf(n).id === "other";
      return categoryOf(n).id === c.id && (!IsSystemSheet(n) || state.showSystem);
    });
    if (!names.length) return;
    html += `
      <div class="cat-section fade-in">
        <div class="cat-head">
          <div class="ch-ico" style="background:${c.color}22;color:${c.color}">${catSvg(c)}</div>
          <div>
            <h3 style="color:var(--txt-0)">${c.name}</h3>
            <div class="ch-sub">${c.sub}</div>
          </div>
          <div class="ch-line"></div>
          <div class="ch-n">${names.length} SHEET</div>
        </div>
        <div class="sheet-grid">
          ${names.map(n => {
            const rows = Math.max(0, countRows(n) - 1);
            const tags = sheetTags(n);
            return `
            <div class="sheet-card ${state.currentSheet === n ? "active" : ""}" data-act="open-sheet" data-name="${escapeHtmlAttr(n)}">
              <div class="sc-glow" style="background:${c.color}"></div>
              <div class="sc-top">
                <span class="sc-dot" style="background:${c.color}"></span>
                <div class="sc-name">${escapeHtml(n)}</div>
              </div>
              <div class="sc-tags">
                <span class="sc-rows">${rows.toLocaleString("fa-IR")} رکورد</span>
                ${tags.map(t => `<span class="sc-tag">${t}</span>`).join("")}
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>`;
  });
  host.innerHTML = html || '<div class="empty-state">شیتی در این دسته یافت نشد.</div>';
}
function openSheetCard(name) {
  renderSheetView(name);
  const el = document.getElementById("sheet-body");
  if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---- grouped navigator ---- */
function renderGroupedNavigator() {
  const cats = allCatsWithOther().filter(c => c.id !== "system" || state.showSystem);
  const colors = { provinces: "#22d3ee", datacenters: "#6366f1", services: "#8b5cf6", carriers: "#f59e0b",
                   equipment: "#22c55e", costs: "#ec4899", system: "#64748f", other: "#94a3b8", all: "#3b82f6" };
  const root = document.createDocumentFragment();
  let idx = 0;
  cats.forEach(c => {
    const names = WB.order.filter(n => {
      if (c.id === "system") return IsSystemSheet(n);
      if (c.id === "other") return categoryOf(n).id === "other";
      return categoryOf(n).id === c.id && (!IsSystemSheet(n) || state.showSystem);
    });
    if (!names.length) return;
    root.appendChild(el("div", { class: "nav-group-head" },
      el("div", { class: "ng-ico", style: { background: c.color + "22", color: c.color } }, catSvgNode(c)),
      el("div", { class: "ng-t", text: c.name }),
      el("div", { class: "ng-n", text: names.length + " sheet" }),
      el("div", { class: "ng-line" })));
    names.forEach(n => {
      idx++;
      root.appendChild(el("div", {
        class: "nav-card",
        style: { background: "linear-gradient(135deg," + c.color + "dd," + c.color + "88)" },
        "data-act": "nav-sheet", "data-name": n
      },
        el("div", { class: "num", text: String(idx) }),
        el("div", { text: n }),
        el("div", { class: "rows", text: Math.max(0, countRows(n) - 1).toLocaleString("fa-IR") })));
    });
  });
  return root;
}

/* ================================================================
   Expose internals on window (console access + automated tests)
   ================================================================ */
Object.assign(window, {
  WB, state, MACRO_REGISTRY, VBA_MODULES,
  modMapping, modSearchEngine, modAddRecord, modRemoveRecord, modUndo,
  modUI, modNavigator, modExport, modExportAllModules, modValidation,
  modConstantsTools, modButtonTools, modCreateUndoButton, modPatchFixes,
  modFixUnlock, modLayout, CFieldInput, frmFieldInput, frmSectionPicker,
  modFormBuilder, modFieldInput, clsWatcher1, clsWatcher,
  cellVal, setCellVal, shiftMerges, insertRowAt, deleteRows,
  saveState, loadState, WriteChangeLog, RefreshSearchIndexSilent,
  renderExactToggle, renderResultsView, renderSheetView,
  resolveArchiveSheet, GoToControlPanel, RunMacro, Workbook_Open,
  IsSystemSheet, IsDataSheet, SheetExists, initUIFromState,
  FindHeaderRow, TrimText, NormalizeText, LastUsedRow, LastUsedCol,
  modImport, importWorkbookFromBuffer, importCsvText, applyJsonBackup,
  resetToEmptyData, BuildExportWorkbook, ExportWorkbookXlsx, parseCsvText,
  APP_SHELL, withTransaction, withTransactionSync, snapshotWorkbook, restoreWorkbook,
  ACTIONS, bindDelegatedEvents,
  validateWorkbookData, normalizeSheetData, sanitizeSheetName,
  verifySearchIndex, recoverSearchIndex, encJs, escapeHtmlAttr,
  SHEET_CATEGORIES, categoryOf, sheetsOfCategory, renderSheetCatalog,
  renderDashCats, renderCatBar, openCategory, openSheetCard, setCatFilter
});
