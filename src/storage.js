/* ================================================================
   LAYER: STORAGE — persistence only. localStorage save/load with
   layered quota fallbacks, JSON backup/restore, reset.
   Reads/writes ONLY WB + state (the documented source of truth).
   ================================================================ */
/* ================================================================
   Persistence (localStorage) + backup
   ================================================================ */
const LS_KEY = "Mohsen_FINAL_v5_state_v2";
function saveState() {
  // SYSTEM_SEARCH_INDEX is rebuilt on load (RefreshSearchIndex) — never persisted
  const sheetsLite = {};
  for (const n of Object.keys(WB.sheets)) {
    sheetsLite[n] = (n === IDX_SHEET) ? { rows: [], merges: WB.sheets[n].merges || [] } : WB.sheets[n];
  }
  const base = {
    v: 2, order: WB.order, sheets: sheetsLite, cp: state.cp,
    undo: state.undo, panelProtected: state.panelProtected,
    lockedSheets: state.lockedSheets, user: state.user, showSystem: state.showSystem,
    savedAt: Date.now()
  };
  const attempts = [
    base,
    // fallback 1: drop merge maps
    (() => { const s2 = {}; for (const n of Object.keys(sheetsLite)) s2[n] = { rows: sheetsLite[n].rows, merges: [] };
             return Object.assign({}, base, { sheets: s2 }); })(),
    // fallback 2: also trim the change log to the last 200 rows
    (() => { const s2 = {}; for (const n of Object.keys(sheetsLite)) s2[n] = { rows: (n === LOG_SHEET && sheetsLite[n].rows.length > 201)
              ? [sheetsLite[n].rows[0]].concat(sheetsLite[n].rows.slice(-200)) : sheetsLite[n].rows, merges: [] };
             return Object.assign({}, base, { sheets: s2, undo: null }); })(),
  ];
  for (const payload of attempts) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
      state.savedAt = payload.savedAt;
      saveUIState();
      updateSaveIndicator();
      return true;
    } catch (e) { /* try a smaller payload */ }
  }
  console.warn("saveState: localStorage quota exceeded — session is in-memory only");
  if (!saveState._warned) {
    saveState._warned = true;
    LogError("Storage", "saveState", 28, "فضای ذخیره‌سازی مرورگر تمام شد — تغییرات فقط در حافظه جلسه می‌ماند", LS_KEY);
    Toast("هشدار: ذخیره‌سازی مرورگر پر شد — داده‌ها فقط در همین نشست باقی می‌مانند.", "warn");
  }
  return false;
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    if (!p || p.v !== 2 || !p.sheets) return false;
    WB.order = p.order; WB.sheets = p.sheets;
    Object.assign(state.cp, p.cp || {});
    state.undo = p.undo || null;
    state.panelProtected = p.panelProtected !== false;
    state.lockedSheets = p.lockedSheets || {};
    state.user = p.user || "Web User";
    state.showSystem = !!p.showSystem;
    state.savedAt = p.savedAt || 0;
    return true;
  } catch (e) { return false; }
}
/* ---------- lightweight UI-state persistence (last sheet / filter / save time) ---------- */
const LS_KEY_UI = LS_KEY + "_ui";
function saveUIState() {
  try {
    // never clobber a remembered sheet with "" (boot/switchView runs with no
    // sheet open); keep the last remembered sheet unless a new one is set
    const prev = loadUIState();
    const sheet = state.currentSheet || (prev && prev.sheet) || "";
    localStorage.setItem(LS_KEY_UI, JSON.stringify({
      v: 1, sheet: sheet, catFilter: state.catFilter || "all", savedAt: state.savedAt || 0
    }));
  } catch (e) { /* ui extras are best-effort */ }
}
function loadUIState() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_KEY_UI) || "null");
    return (p && p.v === 1) ? p : null;
  } catch (e) { return null; }
}
function updateSaveIndicator() {
  const elm = document.getElementById("save-indicator");
  if (!elm) return;
  if (state.savedAt) {
    const t = new Date(state.savedAt);
    const hh = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
    elm.textContent = "\u0630\u062e\u06cc\u0631\u0647\u200c\u0634\u062f\u0647 " + hh;
    elm.title = "\u062f\u0627\u062f\u0647\u200c\u0647\u0627 \u062f\u0631 \u0627\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f\u0647\u200c\u0627\u0646\u062f \u2014 \u0639\u062f\u0645 \u0646\u06cc\u0627\u0632 \u0628\u0647 \u0627\u067e\u0644\u0648\u062f \u062f\u0648\u0628\u0627\u0631\u0647";
  } else {
    elm.textContent = "\u0630\u062e\u06cc\u0631\u0647\u200c\u0646\u0634\u062f\u0647";
  }
}
/* explicit Save button: persist everything now, verify the read-back,
   and tell the user exactly what happened. */
function saveNow() {
  const ok = saveState();
  if (!ok) {
    Toast("\u0630\u062e\u06cc\u0631\u0647 \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f \u2014 \u0641\u0636\u0627\u06cc \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0631 \u0627\u0633\u062a. \u062f\u0627\u062f\u0647\u200c\u0647\u0627 \u0641\u0642\u0637 \u062f\u0631 \u0647\u0645\u06cc\u0646 \u0646\u0634\u0633\u062a \u0645\u06cc\u200c\u0645\u0627\u0646\u0646\u062f \u2014 \u0627\u0632 \u00ab\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u200c\u06af\u06cc\u0631\u06cc JSON\u00bb \u062e\u0631\u0648\u062c\u06cc \u0628\u06af\u06cc\u0631\u06cc\u062f.", "err");
    return false;
  }
  // read-back verification — the save is only "done" if we can read it again
  let verified = false, sheetCount = 0;
  try {
    const p = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    verified = !!(p && p.v === 2 && p.sheets && p.order && p.order.length === WB.order.length);
    if (verified) sheetCount = p.order.length;
  } catch (e) { verified = false; }
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0") + ":" + String(t.getSeconds()).padStart(2, "0");
  if (verified) {
    Toast("\u0630\u062e\u06cc\u0631\u0647 \u0634\u062f \u2713 \u2014 " + sheetCount + " \u0634\u06cc\u062a \u062f\u0631 \u0627\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u0645\u0627\u0646\u062f\u06af\u0627\u0631 \u0634\u062f \u2014 \u0633\u0627\u0639\u062a " + hh, "ok");
    return true;
  }
  Toast("\u0630\u062e\u06cc\u0631\u0647 \u0627\u0646\u062c\u0627\u0645 \u0634\u062f \u0627\u0645\u0627 \u062a\u0623\u06cc\u06cc\u062f \u0628\u0627\u0632\u062e\u0648\u0627\u0646\u06cc \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f \u2014 \u0628\u0631\u0627\u06cc \u0627\u0637\u0645\u06cc\u0646\u0627\u0646 \u00ab\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u200c\u06af\u06cc\u0631\u06cc JSON\u00bb \u0628\u06af\u06cc\u0631\u06cc\u062f.", "warn");
  return false;
}

function resetAll() {
  ConfirmBox("بازنشانی داده‌ها", "همه تغییرات ذخیره‌شده در این مرورگر پاک می‌شود و داده‌های اولیه فایل Excel بازمی‌گردد. مطمئنید؟",
    () => { localStorage.removeItem(LS_KEY); location.reload(); });
}
function backupAll() {
  const payload = { v: 2, workbook: "Mohsen_FINAL_v5.xlsm", exported: new Date().toISOString(),
    order: WB.order, sheets: WB.sheets, cp: state.cp, undo: state.undo,
    lockedSheets: state.lockedSheets, user: state.user };
  DownloadFile("Mohsen_FINAL_v5_backup_" + tsStamp() + ".json", JSON.stringify(payload), "application/json");
  WriteChangeLog("BACKUP", "-", "-", "SUCCESS", "JSON backup exported");
  Toast("پشتیبان‌گیری انجام شد.", "ok");
}
function restoreAll() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json";
  inp.addEventListener("change", () => {
    const f = inp.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.addEventListener("load", () => {
      try {
        const p = JSON.parse(rd.result);
        if (!p.sheets) throw new Error("bad file");
        WB.order = p.order; WB.sheets = p.sheets;
        Object.assign(state.cp, p.cp || {});
        state.undo = p.undo || null;
        state.lockedSheets = p.lockedSheets || {};
        saveState();
        WriteChangeLog("RESTORE", "-", "-", "SUCCESS", "JSON backup restored: " + f.name);
        Toast("بازیابی با موفقیت انجام شد.", "ok");
        initUIFromState();
      } catch (e) { ShowMsg("فایل پشتیبان معتبر نیست.\n" + e.message, vbCritical, "Restore"); }
    });
    rd.readAsText(f);
  });
  inp.click();
}

