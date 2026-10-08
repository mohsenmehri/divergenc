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
    lockedSheets: state.lockedSheets, user: state.user, showSystem: state.showSystem
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
    return true;
  } catch (e) { return false; }
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

