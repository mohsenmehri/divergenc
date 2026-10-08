/* ================================================================
   LAYER: CORE — workbook model, invariants, helpers, modals,
   transactions, validation, search-index verify/recover.
   ================================================================ */
/* ================================================================
   DATA MANAGER v28 — Web port of Mohsen_FINAL_v5.xlsm
   Core: state, storage, helpers, dialogs, renderers
   ================================================================ */
"use strict";

/* ---------- modConstants ---------- */
const SHEET_PASSWORD = "12346";
const CONTROL_PANEL_PASSWORD = "1234";
const CP_SHEET = "CONTROL_PANEL";
const IDX_SHEET = "SYSTEM_SEARCH_INDEX";
const CFG_SHEET = "SYSTEM_SHEET_CONFIG";
const DD_SHEET = "SYSTEM_DATA_DICTIONARY";
const LOG_SHEET = "CHANGE_LOG";
const RESULTS_SHEET = "SEARCH_RESULTS";
const SYSTEM_KEYS_SHEET = "SYSTEM_KEYS";
const UNDO_BUFFER_SHEET = "SYSTEM_UNDO_BUFFER";
const NAV_SHEET_NAME = "SYSTEM_NAVIGATOR";
const MAX_DATA_COLS = 100;
const SEARCH_OUTPUT_FIRST_ROW = 4;
const OUTPUT_CLEAR_LAST_ROW = 2000;
const CELL_SEARCH_SHEET = "C7", CELL_SEARCH_KEY = "C9", CELL_SEARCH_VALUE = "C11";
const CELL_ADD_SHEET = "C16", CELL_REMOVE_SHEET = "C23", CELL_REMOVE_KEY = "C25";
const CELL_REMOVE_VALUE = "C27", CELL_NAV_SHEET = "C41", CELL_EXACT_TOGGLE = "B12";

const ARCHIVE_MAIN = "لیست جمع آوری سرویس";
const ARCHIVE_MABIN = "جمع آوری مبین نت";
const ARCHIVE_ASIATAK = "جمع آوری آسیاتک";

function SystemSheetNames() {
  return [CP_SHEET, RESULTS_SHEET, LOG_SHEET, SYSTEM_KEYS_SHEET, CFG_SHEET,
          DD_SHEET, IDX_SHEET, UNDO_BUFFER_SHEET, NAV_SHEET_NAME];
}
function IsSystemSheet(name) { return SystemSheetNames().indexOf(name) >= 0; }
function IsDataSheet(name) { return !IsSystemSheet(name); }
function SheetExists(name) { return !!(WB.sheets[name]); }

/* Provincial sheet list (modAddRecord.IsProvincialSheet) */
const PROVINCIAL_SHEETS = ["خراسان رضوی","خراسان شمالی","خراسان جنوبی","سیستان وبلوچستان","گلستان",
  "استان تهران","استان البرز","استان اردبیل","استان آذرغربی","استان آذرشرقی","خوزستان","فارس","قم",
  "کردستان","لرستان","همدان","مرکزی","کرمانشاه","قزوین","استان ایلام","استان اصفهان","استان بوشهر",
  "چهارمحال وبختیاری","سمنان","زنجان","کهکلویه","یزد","گیلان","مازندران","هرمزگان","کرمان"];

/* ================================================================
   Workbook state
   ================================================================ */
const WB = {
  order: [],            // sheet names in workbook order
  sheets: {},           // name -> { rows: [[v,...],...]  (0-based => Excel row r = rows[r-1]), merges: [{r1,c1,r2,c2}] }
};
/* ================================================================
   SOURCE OF TRUTH / INVARIANTS (state management contract)
   ---------------------------------------------------------------
   - WB (order + sheets) is the SINGLE source of truth for business
     data. UI views only RENDER from WB; imports replace it atomically;
     saveState serializes it; export and undo read/copy it.
   - state holds ONLY UI/session flags (selection, cp widgets, undo
     pointer, locks). It never caches business values that could
     diverge from WB.
   - Every mutation of WB must go through withTransaction(...) which
     snapshots, rolls back on error, and commits saveState once.
   - SYSTEM_SEARCH_INDEX is DERIVED data: always rebuilt from WB +
     SYSTEM_SHEET_CONFIG (deterministic), never trusted from storage.
   ================================================================ */
const state = {
  errors: [],           // session error ring (observable error handling)
  cp: {
    C7: "", C9: "FULLTEXT", C11: "", B12: "OFF",
    C16: "", C23: "", C25: "FULLTEXT", C27: "", C41: ""
  },
  results: [],          // result blocks: {matchIdx, sheet, srcRow, srcRowTo, dataRows:[{srcRow, cells:[]}], title, mode:'search'|'remove'}
  resultsMode: "search",
  undo: null,           // {valid, blockCount, svcStr, ts, blocks:[{sheet,from,to,lastCol,arc1Name,arc1From,arc1Count,arc2Name,arc2From,arc2Count,data:[[...]]}]}
  currentSheet: null,
  panelProtected: true,
  lockedSheets: {},     // sheetName -> true (protected)
  user: "Web User",
  showSystem: false,
  pageLimit: 300,
  catFilter: "all",
};

function ensureSheet(name, createIfMissing) {
  if (!WB.sheets[name] && createIfMissing) {
    WB.sheets[name] = { rows: [], merges: [] };
    if (WB.order.indexOf(name) < 0) WB.order.push(name);
  }
  return WB.sheets[name] || null;
}

/* ================================================================
   Helpers (modHelpers / modUnicode)
   ================================================================ */
function TrimText(s) { return (s === null || s === undefined) ? "" : String(s).trim(); }
function NormalizeText(s) { return TrimText(s).toLowerCase(); }
function LastUsedRow(sheetName, col) {
  const sh = WB.sheets[sheetName]; if (!sh) return 0;
  const c = (col || 1) - 1;
  for (let r = sh.rows.length - 1; r >= 0; r--) {
    const row = sh.rows[r] || [];
    if (row[c] !== undefined && row[c] !== null && String(row[c]).trim() !== "") return r + 1;
  }
  return sh.rows.length ? 1 : 0;
}
function LastUsedCol(sheetName, rowNum) {
  const sh = WB.sheets[sheetName]; if (!sh) return 0;
  const row = sh.rows[(rowNum || 1) - 1] || [];
  for (let c = row.length - 1; c >= 0; c--) {
    if (row[c] !== undefined && row[c] !== null && String(row[c]).trim() !== "") return c + 1;
  }
  return 1;
}
function FindHeaderRow(sheetName) { return 1; }  // FIX v2: always row 1

function cellVal(sheetName, r, c, mergeAware) {
  const sh = WB.sheets[sheetName]; if (!sh) return null;
  let row = sh.rows[r - 1];
  let v = row ? row[c - 1] : null;
  if ((v === undefined || v === null || v === "") && mergeAware && sh.merges && sh.merges.length) {
    const m = findMerge(sh, r, c);
    if (m && (m.r1 !== r || m.c1 !== c)) {
      const arow = sh.rows[m.r1 - 1];
      v = arow ? arow[m.c1 - 1] : null;
    }
  }
  return v === undefined ? null : v;
}
function setCellVal(sheetName, r, c, v, mergeAware) {
  const sh = ensureSheet(sheetName); if (!sh) return;
  while (sh.rows.length < r) sh.rows.push([]);
  let row = sh.rows[r - 1];
  let tc = c, tr = r;
  if (mergeAware && sh.merges && sh.merges.length) {
    const m = findMerge(sh, r, c);
    if (m) { tr = m.r1; tc = m.c1; while (sh.rows.length < tr) sh.rows.push([]); row = sh.rows[tr - 1]; }
  }
  while (row.length < tc) row.push(null);
  row[tc - 1] = v;
}
function findMerge(sh, r, c) {
  for (const m of sh.merges) {
    if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
  }
  return null;
}
function shiftMerges(sh, atRow, count) {
  // count>0 insert (rows shift down), count<0 delete
  const out = [];
  for (const m of sh.merges) {
    let { r1, r2, c1, c2 } = m;
    if (count > 0) {
      if (r1 >= atRow) r1 += count;
      if (r2 >= atRow) r2 += count;
    } else if (count < 0) {
      const delFrom = atRow, delTo = atRow - count - 1;
      if (r1 > delTo) r1 += count;
      else if (r1 >= delFrom) r1 = delFrom;
      if (r2 > delTo) r2 += count;
      else if (r2 >= delFrom) r2 = delFrom;
    }
    if (r2 >= r1) out.push({ r1, r2, c1, c2 });
  }
  sh.merges = out;
}
function insertRowAt(sheetName, excelRow) {
  const sh = ensureSheet(sheetName);
  sh.rows.splice(excelRow - 1, 0, []);
  shiftMerges(sh, excelRow, 1);
}
function deleteRows(sheetName, fromRow, toRow) {
  const sh = ensureSheet(sheetName);
  const n = toRow - fromRow + 1;
  sh.rows.splice(fromRow - 1, n);
  shiftMerges(sh, fromRow, -n);
}
function rowIsEmpty(sh, excelRow) {
  const row = sh.rows[excelRow - 1] || [];
  for (const v of row) if (v !== null && v !== undefined && String(v).trim() !== "") return false;
  return true;
}

/* ---------- modal dialogs (modUnicode.ShowMsg / ShowInput) ---------- */
const vbOKOnly = 0, vbYesNoCancel = 3, vbYesNo = 4, vbCritical = 16, vbExclamation = 48, vbInformation = 64, vbQuestion = 32;
/* ================================================================
   DOM BUILDER UTILITIES — el / txt / sEl / button / frag / clear.
   All renderers build DOM nodes through these; data strings only ever
   land in textContent / setAttribute / .value — never HTML parsing.
   ================================================================ */
function txt(s) { return document.createTextNode(s === null || s === undefined ? "" : String(s)); }
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") node.textContent = String(v);
    else if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "value" && "value" in node) node.value = String(v);
    else if (k === "checked" && "checked" in node) node.checked = !!v;
    else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const ch of children.flat(4)) {
    if (ch === null || ch === undefined || ch === false) continue;
    node.appendChild(ch instanceof Node ? ch : txt(ch));
  }
  return node;
}
function sEl(tag, attrs, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") node.textContent = String(v);
    else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const ch of children.flat(4)) {
    if (ch === null || ch === undefined || ch === false) continue;
    node.appendChild(ch instanceof Node ? ch : txt(ch));
  }
  return node;
}
function button(label, attrs, ...children) { return el("button", attrs, txt(String(label)), ...children); }
function frag(...children) {
  const f = document.createDocumentFragment();
  for (const ch of children.flat(4)) {
    if (ch === null || ch === undefined || ch === false) continue;
    f.appendChild(ch instanceof Node ? ch : txt(ch));
  }
  return f;
}
function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
/* multi-line plain text -> nodes with <br> (same rendering as before) */
function textBlock(s) {
  const parts = String(s === null || s === undefined ? "" : s).split("\n");
  const kids = [];
  parts.forEach((part, i) => { if (i) kids.push(el("br")); kids.push(txt(part)); });
  return frag(...kids);
}

const IDOK = 1, IDCANCEL = 2, IDYES = 6, IDNO = 7;

function ModalBox(opts) {
  return new Promise(resolve => {
    const ov = document.getElementById("modal-overlay");
    const cls = opts.cls || "info";
    const box = el("div", { class: "mbox " + cls });
    const head = el("div", { class: "t" },
      el("span", { text: opts.title || "Data Manager" }),
      el("span", { class: "x", "data-id": "0", text: "✕" }));
    const content = el("div", { class: "c" });
    if (opts.text) content.appendChild(textBlock(opts.text));
    if (opts.contentNode) content.appendChild(opts.contentNode);
    const fbar = el("div", { class: "f" });
    (opts.buttons || [{ id: IDOK, label: "تأیید", cls: "ok" }]).forEach(b => {
      fbar.appendChild(el("button", { "data-id": b.id, class: b.cls, text: b.label }));
    });
    box.appendChild(head); box.appendChild(content); box.appendChild(fbar);
    clear(ov);
    ov.appendChild(box);
    ov.classList.add("show");
    let inpEl = null;
    const done = id => {
      ModalBox.lastValue = inpEl ? inpEl.value : undefined;
      ov.classList.remove("show"); clear(ov); resolve(id);
    };
    box.querySelectorAll("button[data-id], .x").forEach(elm => {
      elm.addEventListener("click", () => {
        const id = parseInt(elm.getAttribute("data-id"), 10);
        if (id === 0 && opts.buttons && opts.buttons.length > 1) return done(IDCANCEL);
        done(id);
      });
    });
    if (opts.input !== undefined && opts.input !== null) {
      const inp = el("input", { class: "m-in", value: opts.input, id: "modal-input" });
      content.appendChild(inp);
      inpEl = inp;
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter") { box.querySelector(".f button[data-id='1'], .f button[data-id='6']").click(); }
      });
    }
  });
}
function ShowMsg(text, nType = 0, title = "Data Manager") {
  let cls = "info", buttons = [{ id: IDOK, label: "تأیید", cls: "ok" }];
  if (nType & vbYesNo || nType & vbYesNoCancel) {
    cls = "q";
    buttons = [{ id: IDYES, label: "بله", cls: "yes" }, { id: IDNO, label: "خیر", cls: "no" }];
    if (nType & vbYesNoCancel) buttons.push({ id: IDCANCEL, label: "لغو", cls: "cancel" });
  }
  if (nType & vbCritical) cls = "err";
  else if (nType & vbExclamation) cls = "warn";
  else if (nType & vbQuestion) cls = "q";
  return ModalBox({ text, title, cls, buttons });
}
function ConfirmBox(title, text, onYes, onNo) {
  ShowMsg(text, vbYesNo | vbQuestion, title).then(r => {
    if (r === IDYES) onYes && onYes(); else onNo && onNo();
  });
}
async function ShowInput(prompt, title = "Data Manager", def = "") {
  ModalBox.lastValue = undefined;
  const r = await ModalBox({ text: prompt, title, cls: "q", input: def,
    buttons: [{ id: IDOK, label: "تأیید", cls: "ok" }, { id: IDCANCEL, label: "انصراف", cls: "cancel" }] });
  if (r !== IDOK) return null;
  return ModalBox.lastValue !== undefined ? ModalBox.lastValue : null;
}
function Toast(msg, kind = "") {
  const box = document.getElementById("toasts");
  const t = el("div", { class: "toast " + kind });
  t.appendChild(textBlock(msg));
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = ".4s"; setTimeout(() => t.remove(), 450); }, 4200);
}
function tsStamp() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function nowLogStamp() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}
function DownloadFile(name, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: (mime || "text/plain") + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* ================================================================
   modChangeLog / modErrorLog
   ================================================================ */
function WriteChangeLog(actionName, sheetName, recordId, statusText, notes) {
  try {
    const sh = ensureSheet(LOG_SHEET, true);
    // header row if empty
    if (sh.rows.length === 0) sh.rows.push(["Date/Time", "Action", "Sheet", "Record ID", "User", "Status", "Notes"]);
    sh.rows.push([nowLogStamp(), actionName, sheetName, recordId, state.user, statusText, notes || ""]);
    return true;
  } catch (e) {
    console.warn("WriteChangeLog failed:", e);
    return false;
  }
}
function LogAction(actionName, sheetName, recordId) { WriteChangeLog(actionName, sheetName, recordId, "SUCCESS", ""); }
function GetLogRowCount() {
  const sh = WB.sheets[LOG_SHEET];
  return sh ? Math.max(0, sh.rows.length - 1) : 0;
}
function LogError(sModule, sProc, nErrNum, sErrDesc, sContext) {
  // observable error handling: ring buffer + change log + console
  try {
    state.errors.push({ t: nowLogStamp(), module: sModule, proc: sProc,
      num: nErrNum, desc: String(sErrDesc), ctx: sContext || "" });
    if (state.errors.length > 50) state.errors.shift();
  } catch (e) { /* keep logging best-effort */ }
  console.error("[" + sModule + "." + sProc + "]", nErrNum, sErrDesc, sContext || "");
  WriteChangeLog("ERROR", sModule + "." + sProc, sContext || "-", nErrNum + ": " + sErrDesc, "");
}
function HandleError(sModule, sProc, nErrNum, sErrDesc, bSilent) {
  LogError(sModule, sProc, nErrNum, sErrDesc);
  if (!bSilent) {
    ShowMsg("خطا در " + sModule + "." + sProc + ":\nشماره: " + nErrNum + "\nشرح: " + sErrDesc, vbCritical, "خطا");
  }
}

/* ================================================================
   TRANSACTION LAYER — every WB mutation is atomic: snapshot -> run ->
   single saveState on success, full rollback + observable error on
   failure. Undo / change log / save can never diverge from WB.
   ================================================================ */
function snapshotWorkbook() {
  return {
    order: WB.order.slice(),
    sheets: JSON.parse(JSON.stringify(WB.sheets)),
    undo: state.undo ? JSON.parse(JSON.stringify(state.undo)) : state.undo
  };
}
function restoreWorkbook(snap) {
  WB.order = snap.order.slice();
  WB.sheets = snap.sheets;
  state.undo = snap.undo;
}
function withTransactionSync(meta, fn) {
  if (typeof meta === "function") { fn = meta; meta = null; }
  const snap = snapshotWorkbook();
  try {
    const result = fn();
    saveState();
    if (typeof updateStatLine === "function") updateStatLine();
    return result;
  } catch (e) {
    try { restoreWorkbook(snap); } catch (e2) { LogError("Transaction", "restoreWorkbook", 500, e2 && e2.message ? e2.message : String(e2)); }
    LogError("Transaction", (meta && meta.action) || "withTransactionSync", e && e.number ? e.number : 500,
      e && e.message ? e.message : String(e), (meta && meta.sheet) || "");
    Toast("عملیات ناموفق بود و تغییرات به حالت قبل برگردانده شد.\n" + (e && e.message ? e.message : e), "err");
    return undefined;
  }
}
async function withTransaction(meta, fn) {
  if (typeof meta === "function") { fn = meta; meta = null; }
  const snap = snapshotWorkbook();
  try {
    const result = await fn();
    saveState();
    if (typeof updateStatLine === "function") updateStatLine();
    return result;
  } catch (e) {
    try { restoreWorkbook(snap); } catch (e2) { LogError("Transaction", "restoreWorkbook", 500, e2 && e2.message ? e2.message : String(e2)); }
    LogError("Transaction", (meta && meta.action) || "withTransaction", e && e.number ? e.number : 500,
      e && e.message ? e.message : String(e), (meta && meta.sheet) || "");
    Toast("عملیات ناموفق بود و تغییرات به حالت قبل برگردانده شد.\n" + (e && e.message ? e.message : e), "err");
    return undefined;
  }
}

/* ================================================================
   IMPORT / SCHEMA VALIDATION — corrupt or partial files must never
   break application state. Also blocks prototype-pollution keys.
   ================================================================ */
const FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"];
function sanitizeSheetName(name) {
  let n = TrimText(String(name === null || name === undefined ? "" : name))
    .replace(/[\u0000-\u001f]/g, "");
  if (!n) return "";
  if (FORBIDDEN_KEYS.indexOf(n.toLowerCase()) >= 0) n = "_" + n;
  if (n.length > 31) n = n.slice(0, 31);
  return n;
}
function normalizeCellValue(v) {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "string") return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  if (t === "number") return isFinite(v) ? v : String(v);
  if (t === "boolean") return v;
  return String(v); // objects/functions/dates -> plain string, never raw
}
function normalizeSheetData(sh) {
  const rowsIn = (sh && Array.isArray(sh.rows)) ? sh.rows : [];
  const rows = [];
  for (const r of rowsIn) {
    if (!Array.isArray(r)) { rows.push([]); continue; }
    const row = r.map(normalizeCellValue);
    if (row.length > MAX_DATA_COLS * 2) row.length = MAX_DATA_COLS * 2;
    rows.push(row);
  }
  // merges are stored 1-based (same as findMerge/cellVal): r1..r2, c1..c2
  const merges = [];
  for (const m of ((sh && sh.merges) || [])) {
    if (!m || typeof m !== "object") continue;
    const r1 = Math.max(1, Math.floor(m.r1) || 1), c1 = Math.max(1, Math.floor(m.c1) || 1);
    const r2 = Math.max(r1, Math.floor(m.r2) || r1), c2 = Math.max(c1, Math.floor(m.c2) || c1);
    if (r1 > rows.length || r2 > rows.length) continue; // out-of-range merge -> dropped
    merges.push({ r1, c1, r2, c2 });
  }
  return { rows, merges };
}
function validateWorkbookData(order, sheets) {
  const errors = [], warnings = [];
  if (!Array.isArray(order) || !sheets || typeof sheets !== "object") {
    return { ok: false, errors: ["ساختار فایل نامعتبر است (order/sheets)"], warnings };
  }
  if (!order.length) errors.push("هیچ شیتی در فایل یافت نشد");
  if (order.length > 500) errors.push("تعداد شیت‌ها بیش از حد مجاز است (حداکثر ۵۰۰)");
  const seen = Object.create(null);
  let totalRows = 0, counted = 0;
  for (const rawName of order) {
    const name = sanitizeSheetName(rawName);
    if (!name) { warnings.push("نام شیت خالی نادیده گرفته شد"); continue; }
    const key = NormalizeText(name);
    if (seen[key]) { warnings.push("شیت تکراری نادیده گرفته شد: " + name); continue; }
    seen[key] = true;
    counted++;
    const sh = sheets[rawName];
    if (!sh || !Array.isArray(sh.rows)) { errors.push("داده شیت خراب است: " + name); continue; }
    totalRows += sh.rows.length;
    if (sh.rows.length > 100000) errors.push("شیت بسیار بزرگ است (بیش از ۱۰۰هزار ردیف): " + name);
  }
  if (totalRows > 400000) errors.push("حجم کل داده بیش از حد مجاز است (بیش از ۴۰۰هزار ردیف)");
  return { ok: errors.length === 0, errors, warnings, sheetCount: counted, totalRows };
}

/* ================================================================
   SEARCH INDEX — deterministic derived data: verify + recover
   ================================================================ */
function verifySearchIndex() {
  const idx = WB.sheets[IDX_SHEET];
  const problems = [];
  if (!idx) return { ok: false, problems: ["ایندکس جستجو وجود ندارد"] };
  if (!idx.rows || idx.rows.length <= 1) return { ok: false, problems: ["ایندکس جستجو خالی است"] };
  let bad = 0;
  const lim = Math.min(idx.rows.length, 5000);
  for (let r = 1; r < lim; r++) {
    const row = idx.rows[r] || [];
    const sheetName = TrimText(String(row[0] === undefined ? "" : row[0]));
    const srcRow = Number(row[1]);
    const src = WB.sheets[sheetName];
    if (!sheetName || !src) { bad++; continue; }
    if (!(srcRow >= 1 && srcRow <= src.rows.length)) bad++;
    if (bad > 25) break;
  }
  if (bad) problems.push(bad + "+ ردیف ایندکس به داده نامعتبر اشاره می‌کند");
  return { ok: problems.length === 0, problems };
}
function recoverSearchIndex(showMsg) {
  const before = verifySearchIndex();
  let count = 0;
  try { count = modMapping.RefreshSearchIndex(false); }
  catch (e) {
    LogError("Index", "recoverSearchIndex", 500, e && e.message ? e.message : String(e));
    if (showMsg) ShowMsg("بازیابی ایندکس ناموفق بود:\n" + (e && e.message ? e.message : e), vbCritical, "Search Index");
    return false;
  }
  const after = verifySearchIndex();
  if (!after.ok) {
    LogError("Index", "recoverSearchIndex", 501, "ایندکس پس از بازسازی هنوز نامعتبر است", after.problems.join(" | "));
    if (showMsg) ShowMsg("ایندکس پس از بازسازی هنوز نامعتبر است:\n" + after.problems.join("\n"), vbCritical, "Search Index");
    return false;
  }
  if (showMsg) ShowMsg("ایندکس جستجو با موفقیت بازسازی شد (" + count + " رکورد).\n" +
    (before.ok ? "" : "مشکلات قبلی: " + before.problems.join("، ")), vbInformation, "Search Index");
  return true;
}

/* ================================================================
   Rendering: views
   ================================================================ */
const VIEW_TITLES = {
  panel: ["داشبورد عملیات شبکه", "Network Operations Dashboard"],
  results: ["نتایج جستجو", "Search Results"],
  sheet: ["مرور شیت‌های شبکه", "Network Sheets Browser"],
  log: ["تاریخچه تغییرات", "Change Log"],
  macros: ["ماکروهای سیستم", "System Macros"]
};
function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const el = document.getElementById("view-" + name);
  if (el) el.classList.add("active");
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  const t = VIEW_TITLES[name] || VIEW_TITLES.panel;
  const tt = document.getElementById("top-title"), ts = document.getElementById("top-sub");
  if (tt) tt.textContent = t[0];
  if (ts) ts.textContent = t[1];
  if (name === "log") renderLogView();
  if (name === "sheet" && state.currentSheet) renderSheetView(state.currentSheet);
  if (name === "macros") renderMacrosView();
  if (name === "panel" && typeof renderDashboard === "function") renderDashboard();
  updateStatLine();
  const sb = document.getElementById("sidebar");
  if (sb) sb.classList.remove("open");
}
function GoToControlPanel() { switchView("panel"); }

function updateStatLine() {
  const dataSheets = WB.order.filter(n => IsDataSheet(n)).length;
  const idxCount = (WB.sheets[IDX_SHEET] ? Math.max(0, WB.sheets[IDX_SHEET].rows.length - 1) : 0);
  const el = document.getElementById("stat-line");
  if (el) el.textContent = dataSheets + " شیت • " + idxCount.toLocaleString("fa-IR") + " رکورد ایندکس • " + state.user;
  const st = id => document.getElementById(id);
  if (st("st-index")) {
    st("st-index").textContent = idxCount.toLocaleString("fa-IR");
    st("st-undo").textContent = (state.undo && state.undo.valid) ? ("آماده (" + state.undo.blockCount + " بلوک)") : "ندارد";
    st("st-lock").textContent = state.panelProtected ? "فعال (قفل)" : "غیرفعال";
  }
  if (st("st-user")) st("st-user").textContent = state.user;
  if (st("st-user2")) st("st-user2").textContent = state.user;
  if (st("nav-results-count")) st("nav-results-count").textContent = String(state.results.length);
  if (st("nav-log-count")) st("nav-log-count").textContent = String(GetLogRowCount());
  if (typeof renderDashboard === "function") renderDashboard();
}

/* ---------- sheet grid ---------- */
function colLetter(c) {
  let s = "";
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}
function renderSheetChips() {
  if (typeof renderSheetCatalog === "function") renderSheetCatalog();
}
function renderSheetView(name) {
  state.currentSheet = name;
  const sh = WB.sheets[name];
  const body = document.getElementById("sheet-body");
  document.getElementById("sheet-title").textContent = name;
  clear(body);
  if (!sh) { body.appendChild(el("div", { class: "empty-state", text: "\u0634\u06cc\u062a \u06cc\u0627\u0641\u062a \u0646\u0634\u062f." })); return; }
  const lastCol = Math.max(1, ...sh.rows.map(r => r.length), 1);
  const locked = !!state.lockedSheets[name];
  let lastRow = sh.rows.length;
  while (lastRow > 0 && rowIsEmpty(sh, lastRow)) lastRow--;

  const limit = Math.min(lastRow + 5, state.pageLimit);
  // merge map (1-based coords, same convention as findMerge/cellVal):
  // anchor (r1,c1) renders with rowspan/colspan; covered cells are omitted
  const mergeMap = new Map();
  (sh.merges || []).forEach(m => {
    if (!m) return;
    for (let rr = m.r1; rr <= m.r2; rr++)
      for (let cc = m.c1; cc <= m.c2; cc++)
        mergeMap.set(rr + "," + cc, m);
  });
  const maxC = Math.min(lastCol, MAX_DATA_COLS);
  const table = el("table", { class: "xl" });
  const thead = el("thead");
  const htr = el("tr", {}, el("th", { class: "rn", text: "#" }));
  for (let c = 1; c <= maxC; c++) htr.appendChild(el("th", { text: colLetter(c) }));
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (let r = 1; r <= limit; r++) {
    const tr = el("tr", { "data-r": r }, el("td", { class: "rn", text: String(r) }));
    for (let c = 1; c <= maxC; c++) {
      const m = mergeMap.get(r + "," + c);
      if (m && (m.r1 !== r || m.c1 !== c)) continue; // covered by merge anchor
      const v = cellVal(name, r, c, true);
      const editable = !locked && !IsSystemSheet(name);
      const tdAttrs = { "data-c": c, "data-r": r, text: (v === null || v === undefined ? "" : v) };
      if (m) {
        const rs = Math.min(m.r2, limit) - m.r1 + 1;
        const cs = Math.min(m.c2, maxC) - m.c1 + 1;
        if (rs > 1) tdAttrs.rowspan = rs;
        if (cs > 1) tdAttrs.colspan = cs;
      }
      const td = el("td", tdAttrs);
      if (editable) td.setAttribute("contenteditable", "true");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(el("div", { class: "grid-wrap" }, table));
  if (lastRow + 5 > limit) {
    body.appendChild(el("div", { style: { textAlign: "center", padding: "10px" } },
      el("button", {
        class: "mini-btn gray", "data-act": "show-more-rows", "data-name": name,
        text: "\u0646\u0645\u0627\u06cc\u0634 \u0631\u062f\u06cc\u0641\u200c\u0647\u0627\u06cc \u0628\u06cc\u0634\u062a\u0631 (\u062a\u0627 " + Math.min(lastRow + 5, state.pageLimit + 500) + ")"
      })));
  }

  // cell editing → write back
  if (!locked && !IsSystemSheet(name)) {
    body.querySelectorAll("td[contenteditable]").forEach(td => {
      td.addEventListener("blur", () => {
        const r = parseInt(td.parentElement.dataset.r, 10);
        const c = parseInt(td.dataset.c, 10);
        const newVal = td.textContent.trim();
        setCellVal(name, r, c, newVal, true);
        saveState();
        if (name === IDX_SHEET) updateStatLine();
      });
    });
  }
  renderSheetChips();
  updateStatLine();
}
function filterSheetRows() {
  const q = NormalizeText((document.getElementById("sheet-filter").value || ""));
  const rows = document.querySelectorAll("#sheet-body tbody tr");
  rows.forEach(tr => {
    if (!q) { tr.style.display = ""; return; }
    const txt = NormalizeText(tr.textContent);
    tr.style.display = txt.indexOf(q) >= 0 ? "" : "none";
  });
}
function toggleSheetLock() {
  const name = state.currentSheet;
  if (!name) return;
  if (state.lockedSheets[name]) {
    delete state.lockedSheets[name];
    Toast("قفل شیت «" + name + "» برداشته شد.", "ok");
  } else {
    state.lockedSheets[name] = true;
    Toast("شیت «" + name + "» قفل شد (رمز: " + SHEET_PASSWORD + " — توجه: قفل‌ها فقط شبیه‌سازی رفتار Excel هستند و امنیت واقعی نیستند).", "warn");
  }
  saveState();
  renderSheetView(name);
}
function exportCurrentSheetCSV() {
  const name = state.currentSheet;
  if (!name) return;
  const csv = sheetToCSV(name);
  DownloadFile(name.replace(/[\\/:*?"<>|]/g, "_") + "_" + tsStamp() + ".csv", "\uFEFF" + csv, "text/csv");
  Toast("خروجی CSV شیت «" + name + "» ذخیره شد.", "ok");
}
function sheetToCSV(name) {
  const sh = WB.sheets[name];
  if (!sh) return "";
  const lines = [];
  sh.rows.forEach(row => {
    const cells = row.map(v => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    });
    lines.push(cells.join(","));
  });
  return lines.join("\r\n");
}

/* ---------- change log view ---------- */
function renderLogView() {
  const sh = WB.sheets[LOG_SHEET];
  const body = document.getElementById("log-body");
  clear(body);
  if (!sh || sh.rows.length <= 1) {
    body.appendChild(el("div", { class: "empty-state", text: "\u0644\u0627\u06af\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647 \u0627\u0633\u062a." }));
    return;
  }
  const table = el("table", { class: "logtable" });
  const htr = el("tr");
  const header = sh.rows[0] || [];
  header.forEach(h => htr.appendChild(el("th", { text: (h === null || h === undefined ? "" : h) })));
  table.appendChild(el("thead", {}, htr));
  const tbody = el("tbody");
  for (let r = sh.rows.length - 1; r >= 1; r--) {
    const row = sh.rows[r] || [];
    const isErr = (row[1] === "ERROR" || row[5] === "ARCHIVE_FAIL");
    const tr = el("tr", { class: isErr ? "err" : "" });
    for (let c = 0; c < 7; c++) {
      const v = row[c] === undefined ? "" : row[c];
      if (c === 1) {
        const cls = ["ADD", "REMOVE", "UNDO", "EDIT", "ERROR", "ARCHIVE_FAIL"].includes(String(v)) ? "act-" + v : "act-default";
        tr.appendChild(el("td", {}, el("span", { class: "act-badge " + cls, text: v })));
      } else if (c === 0) {
        tr.appendChild(el("td", { class: "mono", style: { fontSize: "9.5px" }, text: v }));
      } else {
        tr.appendChild(el("td", { text: v }));
      }
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);
}
function clearLog() {
  ConfirmBox("پاک‌سازی لاگ", "همه ردیف‌های CHANGE_LOG پاک شوند؟", () => {
    const sh = ensureSheet(LOG_SHEET, true);
    const header = sh.rows[0] || ["Date/Time", "Action", "Sheet", "Record ID", "User", "Status", "Notes"];
    sh.rows = [header];
    saveState(); renderLogView();
    Toast("لاگ پاک شد.", "ok");
  });
}

/* ---------- results rendering (WriteMatchBlock look) ---------- */
function renderResultsView() {
  const body = document.getElementById("results-body");
  clear(body);
  if (!state.results.length) {
    body.appendChild(el("div", { class: "empty-state", text: "\u0647\u0646\u0648\u0632 \u0646\u062a\u06cc\u062c\u0647\u200c\u0627\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647 \u0627\u0633\u062a \u2014 \u0627\u0632 \u06a9\u0646\u062a\u0631\u0644 \u067e\u0646\u0644 \u062c\u0633\u062a\u062c\u0648 \u0627\u0646\u062c\u0627\u0645 \u062f\u0647\u06cc\u062f." }));
    return;
  }
  const fragRoot = document.createDocumentFragment();
  if (state.resultsMode === "remove") {
    fragRoot.appendChild(el("div", { class: "match-block" },
      el("div", {
        class: "match-title", style: { background: "#c00000" },
        text: "REMOVE  -  \u062c\u0633\u062a\u062c\u0648: " + (state.removeSearchValue || "")
      }),
      el("div", {
        style: { background: "#eaeaea", fontStyle: "italic", padding: "6px 10px", fontSize: "11px" },
        text: "\u0642\u0631\u0645\u0632 = Match  |  \u0633\u0641\u06cc\u062f = \u062f\u0627\u062f\u0647"
      })));
  }
  state.results.forEach(blk => {
    const block = el("div", {
      class: "match-block " + (state.resultsMode === "remove" ? "remove" : ""),
      "data-match": blk.matchIdx
    });
    block.appendChild(el("div", {
      class: "match-title",
      text: "Match " + blk.matchIdx + "  |  Sheet: " + blk.sheet + "  |  Row: " + blk.srcRow +
        (blk.srcRowTo > blk.srcRow ? "  |  Rows: " + blk.srcRow + "-" + blk.srcRowTo : "")
    }));
    const table = el("table", { class: "block-table" });
    const htr = el("tr");
    blk.headers.forEach(h => htr.appendChild(el("th", { text: (h === null ? "" : h) })));
    table.appendChild(el("thead", {}, htr));
    const tbody = el("tbody");
    blk.dataRows.forEach((dr, ri) => {
      const tr = el("tr", { "data-srcrow": dr.srcRow });
      dr.cells.forEach((v, ci) => {
        const cellValTxt = (v === null || v === undefined ? "" : v);
        const inner = state.resultsMode === "search"
          ? el("input", { class: "cell-in", "data-ri": ri, "data-ci": ci, value: cellValTxt })
          : el("div", { class: "cell-in", style: { background: "#fff" }, text: v === null ? "" : v });
        tr.appendChild(el("td", {}, inner));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(table);
    block.appendChild(el("div", { class: "block-sep" }));
    fragRoot.appendChild(block);
  });
  body.appendChild(fragRoot);
}
function encJs(s) {
  return encodeURIComponent(String(s === null || s === undefined ? "" : s)).replace(/'/g, "%27");
}
