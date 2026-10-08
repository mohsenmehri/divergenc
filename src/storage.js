/* ================================================================
   LAYER: STORAGE — persistence only. localStorage save/load with
   layered quota fallbacks, JSON backup/restore, reset.
   Reads/writes ONLY WB + state (the documented source of truth).
   ================================================================ */
/* ================================================================
   Persistence (localStorage) + backup
   ================================================================ */
const LS_KEY = "Mohsen_FINAL_v5_state_v2";

/* ================================================================
   LZ17 compression for localStorage (self-contained, no deps).
   LZW over UTF-16 units; token bitstream [1 flag bit][16 bits]:
   flag 0 = literal char, 1 = phrase code (0=RST, 1=END, 2..=phrases).
   Literals and codes occupy separate namespaces — collision-free for
   any UTF-16 input. First unit 0xFFFC is the format magic; payloads
   starting with anything else (legacy plain JSON) are read as-is.
   ================================================================ */
const LZ_MAGIC = 0xFFFC;
function packLZ(str) {
  str = String(str === null || str === undefined ? "" : str);
  const units = [LZ_MAGIC];
  let bits = 0, nbits = 0;
  const put = (n, val) => {
    bits = bits * Math.pow(2, n) + val; nbits += n;
    while (nbits >= 16) {
      nbits -= 16;
      units.push(Math.floor(bits / Math.pow(2, nbits)) & 0xFFFF);
      bits = bits % Math.pow(2, nbits);
    }
  };
  let dict = new Map(), next = 2, w = "";
  const emitTok = (flag, v) => put(17, flag * 65536 + v);
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const wc = w + c;
    if (w !== "" && dict.has(wc)) { w = wc; continue; }
    if (w === "") { w = c; continue; }
    if (w.length === 1) emitTok(0, w.charCodeAt(0));
    else emitTok(1, dict.get(w));
    if (next < 65536) { dict.set(wc, next++); }
    else { emitTok(1, 0); dict = new Map(); next = 2; }
    w = c;
  }
  if (w !== "") {
    if (w.length === 1) emitTok(0, w.charCodeAt(0));
    else emitTok(1, dict.get(w));
  }
  emitTok(1, 1); // END
  if (nbits > 0) units.push(Math.floor(bits * Math.pow(2, 16 - nbits)) & 0xFFFF);
  return units.map(u => String.fromCharCode(u)).join("");
}
function unpackLZ(s) {
  if (!s || s.charCodeAt(0) !== LZ_MAGIC) return null;
  let pos = 1, unit = pos < s.length ? s.charCodeAt(pos++) : 0, bitPos = 0;
  const getBit = () => {
    if (bitPos === 16) { unit = pos < s.length ? s.charCodeAt(pos++) : 0; bitPos = 0; }
    return (unit >> (15 - bitPos++)) & 1;
  };
  let dict = [], next = 2, prev = null, out = [];
  const reset = () => { dict = []; next = 2; prev = null; };
  for (;;) {
    const flag = getBit();
    let v = 0;
    for (let b = 0; b < 16; b++) v = v * 2 + getBit();
    if (flag === 0) {
      const entry = String.fromCharCode(v);
      out.push(entry);
      if (prev !== null && next < 65536) dict[next++] = prev + entry[0];
      prev = entry;
    } else {
      if (v === 1) break;
      if (v === 0) { reset(); continue; }
      let entry;
      if (v < next && dict[v] !== undefined) entry = dict[v];
      else if (v === next && prev !== null) entry = prev + prev[0];
      else return null;
      out.push(entry);
      if (prev !== null && next < 65536) dict[next++] = prev + entry[0];
      prev = entry;
    }
  }
  return out.join("");
}
function readStoredState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const txt = raw.charCodeAt(0) === LZ_MAGIC ? unpackLZ(raw) : raw; // legacy plain JSON
    if (txt === null) return null;
    const p = JSON.parse(txt);
    return (p && p.v === 2 && p.sheets) ? p : null;
  } catch (e) { return null; }
}

/* ================================================================
   Deep store (IndexedDB): large-capacity mirror of the same payload.
   localStorage keeps the compacted copy; IndexedDB (where available —
   not on some file:// origins) holds the full object with a much larger
   quota. Writes are async + debounced; saveNow() flushes explicitly.
   ================================================================ */
const DB_NAME = "Mohsen_FINAL_v5_db", DB_STORE = "kv", DB_KEY = "state_v2";
function idbAvailable() {
  try { return typeof indexedDB !== "undefined" && !!indexedDB && typeof indexedDB.open === "function"; }
  catch (e) { return false; }
}
function idbOpen() {
  return new Promise((res, rej) => {
    try {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore(DB_STORE); } catch (e) {} };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error || new Error("idb open failed"));
      rq.onblocked = () => rej(new Error("idb blocked"));
    } catch (e) { rej(e); }
  });
}
async function idbPut(obj) {
  const db = await idbOpen();
  try {
    await new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(obj, DB_KEY);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error || new Error("idb put failed"));
      tx.onabort = () => rej(tx.error || new Error("idb abort"));
    });
    return true;
  } finally { db.close(); }
}
async function idbGet() {
  const db = await idbOpen();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const rq = tx.objectStore(DB_STORE).get(DB_KEY);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error || new Error("idb get failed"));
    });
  } finally { db.close(); }
}
async function idbDelete() {
  if (!idbAvailable()) return true;
  const db = await idbOpen();
  try {
    await new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(DB_KEY);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error || new Error("idb delete failed"));
    });
    return true;
  } finally { db.close(); }
}
let deepTimer = null, deepPending = null;
function scheduleDeepSave(payload) {
  if (!idbAvailable()) return;
  deepPending = payload;
  if (deepTimer) clearTimeout(deepTimer);
  deepTimer = setTimeout(() => {
    deepTimer = null;
    flushDeepSave().catch(() => {});
  }, 600);
}
async function flushDeepSave() {
  if (deepTimer) { clearTimeout(deepTimer); deepTimer = null; }
  if (!deepPending) return true;
  if (!idbAvailable()) return false;
  const payload = deepPending; deepPending = null;
  try { await idbPut(payload); return true; } catch (e) { return false; }
}

function buildStateAttempts() {
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
  return { base: base, attempts: attempts };
}
function saveState() {
  const built = buildStateAttempts();
  let ok = false;
  for (const payload of built.attempts) {
    try {
      localStorage.setItem(LS_KEY, packLZ(JSON.stringify(payload)));
      state.savedAt = payload.savedAt;
      ok = true;
      break;
    } catch (e) { /* try a smaller payload */ }
  }
  scheduleDeepSave(built.base);
  if (ok) {
    saveUIState();
    updateSaveIndicator();
    return true;
  }
  if (!saveState._warned) {
    saveState._warned = true;
    if (idbAvailable()) {
      Toast("\u062d\u0627\u0641\u0638\u0647\u200c\u06cc \u0627\u0635\u0644\u06cc \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0631 \u0627\u0633\u062a \u2014 \u0646\u0633\u062e\u0647\u200c\u06cc \u06a9\u0627\u0645\u0644 \u062f\u0631 \u0630\u062e\u06cc\u0631\u0647\u200c\u06cc \u0639\u0645\u06cc\u0642 (IndexedDB) \u0646\u06af\u0647 \u062f\u0627\u0634\u062a\u0647 \u0645\u06cc\u200c\u0634\u0648\u062f \u2014 \u0628\u0631\u0627\u06cc \u0627\u0637\u0645\u06cc\u0646\u0627\u0646 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646 JSON \u0628\u06af\u06cc\u0631\u06cc\u062f.", "warn");
    } else {
      LogError("Storage", "saveState", 28, "\u0641\u0636\u0627\u06cc \u0630\u062e\u06cc\u0631\u0647\u200c\u0633\u0627\u0632\u06cc \u0645\u0631\u0648\u0631\u06af\u0631 \u062a\u0645\u0627\u0645 \u0634\u062f \u2014 \u062a\u063a\u06cc\u06cc\u0631\u0627\u062a \u0641\u0642\u0637 \u062f\u0631 \u062d\u0627\u0641\u0638\u0647\u200c\u06cc \u062c\u0644\u0633\u0647 \u0645\u06cc\u200c\u0645\u0627\u0646\u062f", LS_KEY);
      Toast("\u0647\u0634\u062f\u0627\u0631: \u0630\u062e\u06cc\u0631\u0647\u200c\u0633\u0627\u0632\u06cc \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0631 \u0634\u062f \u2014 \u062f\u0627\u062f\u0647\u200c\u0647\u0627 \u0641\u0642\u0637 \u062f\u0631 \u0647\u0645\u06cc\u0646 \u0646\u0634\u0633\u062a \u0645\u06cc\u200c\u0645\u0627\u0646\u0646\u062f.", "warn");
    }
  }
  return false;
}
function applyStatePayload(p) {
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
}
function loadState() {
  return applyStatePayload(readStoredState());
}
async function loadDeepState() {
  if (!idbAvailable()) return false;
  try {
    const p = await idbGet();
    if (!p) return false;
    if ((p.savedAt || 0) < (state.savedAt || 0)) return false; // localStorage is newer
    return applyStatePayload(p);
  } catch (e) { return false; }
}

/* lightweight UI-state persistence (last sheet / filter / save time) */
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
async function saveNow() {
  const lsOk = saveState();
  const deepOk = await flushDeepSave();
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0") + ":" + String(t.getSeconds()).padStart(2, "0");
  const sheetCount = WB.order.length;
  if (!lsOk && !deepOk) {
    Toast("\u0630\u062e\u06cc\u0631\u0647 \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f \u2014 \u0641\u0636\u0627\u06cc \u0630\u062e\u06cc\u0631\u0647\u200c\u0633\u0627\u0632\u06cc \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0631 \u0627\u0633\u062a \u0648 \u0630\u062e\u06cc\u0631\u0647\u200c\u06cc \u0639\u0645\u06cc\u0642 \u0645\u0645\u06a9\u0646 \u0646\u0628\u0648\u062f. \u062f\u0627\u062f\u0647\u200c\u0647\u0627 \u0641\u0642\u0637 \u062f\u0631 \u0647\u0645\u06cc\u0646 \u0646\u0634\u0633\u062a \u0645\u06cc\u200c\u0645\u0627\u0646\u0646\u062f.", "err");
    ConfirmBox("\u0630\u062e\u06cc\u0631\u0647 \u0627\u0645\u06a9\u0627\u0646 \u0646\u0628\u0648\u062f", "\u0641\u0636\u0627\u06cc \u0630\u062e\u06cc\u0631\u0647\u200c\u0633\u0627\u0632\u06cc \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0631 \u0627\u0633\u062a. \u0647\u0645\u06cc\u0646 \u0627\u0644\u0627\u0646 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646 JSON \u0628\u06af\u06cc\u0631\u06cc\u0645 \u062a\u0627 \u062f\u0627\u062f\u0647\u200c\u0647\u0627 \u0627\u0632 \u062f\u0633\u062a \u0646\u0631\u0648\u0646\u062f\u061f", () => backupAll());
    return false;
  }
  // read-back verification for the localStorage copy (the deep copy is
  // transaction-acknowledged by IndexedDB itself)
  let verified = !lsOk;
  try {
    const back = readStoredState();
    verified = !!(back && back.order && back.order.length === WB.order.length);
  } catch (e) { verified = !lsOk; }
  if (lsOk && !verified) {
    Toast("\u0630\u062e\u06cc\u0631\u0647 \u0627\u0646\u062c\u0627\u0645 \u0634\u062f \u0627\u0645\u0627 \u062a\u0623\u06cc\u06cc\u062f \u0628\u0627\u0632\u062e\u0648\u0627\u0646\u06cc \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062f \u2014 \u0628\u0631\u0627\u06cc \u0627\u0637\u0645\u06cc\u0646\u0627\u0646 \u00ab\u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u200c\u06af\u06cc\u0631\u06cc JSON\u00bb \u0628\u06af\u06cc\u0631\u06cc\u062f.", "warn");
    return false;
  }
  if (!lsOk && deepOk) {
    // remember the moment even though localStorage refused — deep copy is live
    state.savedAt = Date.now();
    saveUIState();
    updateSaveIndicator();
    Toast("\u0630\u062e\u06cc\u0631\u0647 \u0634\u062f \u2713 \u2014 " + sheetCount + " \u0634\u06cc\u062a \u062f\u0631 \u0630\u062e\u06cc\u0631\u0647\u200c\u06cc \u0639\u0645\u06cc\u0642 \u0645\u0631\u0648\u0631\u06af\u0631 (IndexedDB) \u2014 \u062d\u0627\u0641\u0638\u0647\u200c\u06cc \u0627\u0635\u0644\u06cc \u067e\u0631 \u0628\u0648\u062f \u2014 \u0633\u0627\u0639\u062a " + hh, "ok");
    return true;
  }
  const where = deepOk
    ? "\u062d\u0627\u0641\u0638\u0647\u200c\u06cc \u0645\u0631\u0648\u0631\u06af\u0631 + \u0630\u062e\u06cc\u0631\u0647\u200c\u06cc \u0639\u0645\u06cc\u0642"
    : "\u062d\u0627\u0641\u0638\u0647\u200c\u06cc \u0645\u0631\u0648\u0631\u06af\u0631";
  Toast("\u0630\u062e\u06cc\u0631\u0647 \u0634\u062f \u2713 \u2014 " + sheetCount + " \u0634\u06cc\u062a \u062f\u0631 " + where + " \u0645\u0627\u0646\u062f\u06af\u0627\u0631 \u0634\u062f \u2014 \u0633\u0627\u0639\u062a " + hh, "ok");
  return true;
}

function resetAll() {
  ConfirmBox("\u0628\u0627\u0632\u0646\u0634\u0627\u0646\u06cc \u062f\u0627\u062f\u0647\u200c\u0647\u0627", "\u0647\u0645\u0647 \u062a\u063a\u06cc\u06cc\u0631\u0627\u062a \u0630\u062e\u06cc\u0631\u0647\u200c\u0634\u062f\u0647 \u062f\u0631 \u0627\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0627\u06a9 \u0645\u06cc\u200c\u0634\u0648\u062f \u0648 \u062f\u0627\u062f\u0647\u200c\u0647\u0627\u06cc \u0627\u0648\u0644\u06cc\u0647 \u0641\u0627\u06cc\u0644 Excel \u0628\u0627\u0632\u0645\u06cc\u200c\u06af\u0631\u062f\u062f. \u0645\u0637\u0645\u0626\u0646\u06cc\u062f\u061f",
    async () => {
      try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_KEY_UI); } catch (e) {}
      try { if (typeof idbDelete === "function") await idbDelete(); } catch (e) {}
      location.reload();
    });
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

