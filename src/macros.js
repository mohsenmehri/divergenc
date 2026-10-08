/* ================================================================
   LAYER: MACROS — faithful JavaScript ports of the VBA modules.
   ================================================================ */
/* ================================================================
   MACRO PORTS — faithful JavaScript implementations of the VBA
   modules of Mohsen_FINAL_v5.xlsm (modMapping, modSearchEngine,
   modAddRecord, modRemoveRecord, modUndo, modUI, modNavigator,
   modExport, modExportAllModules, modValidation, ...)
   ================================================================ */

/* ================================================================
   modMapping — RefreshSearchIndex / GetMatchRows
   ================================================================ */
const modMapping = {
  RefreshSearchIndex(bShowMsg = true) {
    const idx = ensureSheet(IDX_SHEET, true);
    idx.rows = [["Sheet", "SourceRow", "INDEX", "FILE_NO_SHORT", "FILE_NO", "BRANCH_CODE", "NAME", "IP", "FULLTEXT", "DISPLAY"]];
    const cfg = WB.sheets[CFG_SHEET];
    if (!cfg) { if (bShowMsg) ShowMsg("SYSTEM_SHEET_CONFIG یافت نشد.", vbExclamation, "RefreshSearchIndex"); return 0; }
    let count = 0;
    for (let cr = 1; cr < cfg.rows.length; cr++) {
      const sheetName = TrimText((cfg.rows[cr] || [])[0]);
      if (!sheetName) continue;
      const src = WB.sheets[sheetName];
      if (!src) continue;
      const hRow = 1, dataStart = 2;
      let lastCol = Math.max(1, ...src.rows.map(r => r.length), 1);
      if (lastCol > MAX_DATA_COLS) lastCol = MAX_DATA_COLS;

      // header map (normalized header text -> col)
      const headerMap = {};
      const headers = [];
      for (let c = 1; c <= lastCol; c++) {
        const h = TrimText(cellVal(sheetName, hRow, c, true));
        headers.push(h);
        const nh = NormalizeText(h);
        if (h && !(nh in headerMap)) headerMap[nh] = c;
      }
      const mapCol = name => headerMap[NormalizeText(name)] || 0;
      const matchCols = patterns => {
        const res = [];
        Object.keys(headerMap).forEach(key => {
          for (const p of patterns) {
            if (key.indexOf(NormalizeText(p)) >= 0) { res.push(headerMap[key]); break; }
          }
        });
        return res;
      };
      const shaCol = mapCol("شاخص");
      const parvandehCol = mapCol("ش پرونده");
      let numCol = mapCol("شماره پرونده");
      if (!numCol) numCol = mapCol("شماره پرونده /شماره کارکن");
      const codeCol = mapCol("کد شعبه");
      const nameCols = matchCols(["نام", "شعبه", "محل", "نقطه", "دستگاه", "شهر"]);
      const ipCols = matchCols(["ip"]);

      const joinVals = (r, cols) => {
        let s = "";
        for (const c of cols) {
          const v = TrimText(String(cellVal(sheetName, r, c, true) ?? ""));
          if (v) { if (s) s += " | "; s += v.replace(/\n/g, " / "); }
          if (s.length > 250) break;
        }
        return s;
      };
      const buildFullText = r => {
        let s = "";
        for (let c = 1; c <= lastCol; c++) {
          const h = TrimText(String(cellVal(sheetName, hRow, c, true) ?? ""));
          const v = TrimText(String(cellVal(sheetName, r, c, true) ?? ""));
          if (h && v) {
            if (s) s += " | ";
            s += h + ": " + v.replace(/\n/g, " / ");
          }
        }
        return s;
      };

      for (let r = dataStart; r <= src.rows.length; r++) {
        if (rowIsEmpty(src, r)) continue;
        const fullText = buildFullText(r);
        if (!fullText) continue;
        const nameValue = joinVals(r, nameCols);
        const ipValue = joinVals(r, ipCols);
        const rowDisplay = "[" + sheetName + "] row " + r + " -> " + fullText;
        idx.rows.push([
          sheetName, r,
          shaCol ? cellVal(sheetName, r, shaCol, true) : null,
          parvandehCol ? cellVal(sheetName, r, parvandehCol, true) : null,
          numCol ? cellVal(sheetName, r, numCol, true) : null,
          codeCol ? cellVal(sheetName, r, codeCol, true) : null,
          nameValue, ipValue, fullText, rowDisplay
        ]);
        count++;
      }
    }
    if (bShowMsg) ShowMsg("SYSTEM_SEARCH_INDEX با موفقیت بازسازی شد. (" + count + " رکورد ایندکس شد)", vbInformation, "RefreshSearchIndex");
    updateStatLine();
    return count;
  },

  GetMatchRows(searchKey, searchValue, sheetFilter = "ALL") {
    const result = [];
    const idx = WB.sheets[IDX_SHEET];
    if (!idx) return result;
    const selectedValue = NormalizeText(searchValue);
    for (let r = 1; r < idx.rows.length; r++) {
      const sheetName = TrimText(String((idx.rows[r] || [])[0] ?? ""));
      if (!sheetName) continue;
      if (NormalizeText(sheetFilter) !== "all") {
        if (sheetName !== NormalizeText(sheetFilter) && NormalizeText(sheetName) !== NormalizeText(sheetFilter)) continue;
      }
      const candidate = this.MatchCandidate(idx.rows[r], searchKey);
      if (NormalizeText(candidate).indexOf(selectedValue) >= 0) result.push(r + 1); // Excel row
    }
    return result;
  },

  MatchCandidate(idxRow, searchKey) {
    const g = i => TrimText(String(idxRow[i] ?? ""));
    switch (TrimText(searchKey).toUpperCase()) {
      case "SHEET": return g(0);
      case "شاخص": return g(2);
      case "ش پرونده": return g(3);
      case "شماره پرونده": return g(4);
      case "کد شعبه": return g(5);
      case "NAME": return g(6);
      case "IP": return g(7);
      default: return g(8); // FULLTEXT
    }
  }
};
function RefreshSearchIndexSilent() {
  modMapping.RefreshSearchIndex(false);
}

/* ================================================================
   modSearchEngine — SearchRecords / SaveChanges / results
   ================================================================ */
const modSearchEngine = {
  async SearchRecords() {
    const sheetFilter = TrimText(state.cp.C7) || "ALL";
    const searchKey = TrimText(state.cp.C9) || "FULLTEXT";
    const searchValue = TrimText(state.cp.C11);
    if (!searchValue) {
      await ShowMsg("لطفاً یک مقدار جستجو وارد کنید.", vbExclamation, "Search");
      return;
    }
    const bExact = NormalizeText(state.cp.B12) === "on";
    const normSearch = NormalizeText(searchValue);
    state.results = [];
    state.resultsMode = "search";
    let matchCount = 0;
    const included = {};

    const writeBlock = (sheetName, srcRow, headers, minMergeSize) => {
      const maxDataRow = minMergeSize > 0 ? srcRow + minMergeSize - 1 : srcRow;
      const dataRowCount = maxDataRow - srcRow + 1;
      for (let dr = 0; dr < dataRowCount; dr++) included[(sheetName + "|" + (srcRow + dr))] = true;
      const blk = {
        matchIdx: ++matchCount, sheet: sheetName, srcRow, srcRowTo: maxDataRow,
        headers: headers.map(h => h ?? ""),
        dataRows: []
      };
      for (let dr = 0; dr < dataRowCount; dr++) {
        const absRow = srcRow + dr;
        const cells = [];
        for (let c = 1; c <= headers.length; c++) {
          const v = cellVal(sheetName, absRow, c, true);
          cells.push(v === null || v === undefined ? "" : String(v));
        }
        blk.dataRows.push({ srcRow: absRow, cells });
      }
      state.results.push(blk);
    };
    const minMergeOf = (sheetName, srcRow, lastCol) => {
      const sh = WB.sheets[sheetName];
      if (!sh || !sh.merges) return 0;
      let minMerge = 0;
      for (const m of sh.merges) {
        if (m.r1 === srcRow && (m.r2 - m.r1 + 1) >= 2) {
          const size = m.r2 - m.r1 + 1;
          if (minMerge === 0 || size < minMerge) minMerge = size;
        }
      }
      return minMerge;
    };
    const scanSheet = (sheetName) => {
      const src = WB.sheets[sheetName];
      if (!src) return;
      const hRow = 1;
      let lastCol = Math.max(1, ...src.rows.map(r => r.length), 1);
      if (lastCol > MAX_DATA_COLS) lastCol = MAX_DATA_COLS;
      const headers = [];
      for (let c = 1; c <= lastCol; c++) headers.push(cellVal(sheetName, hRow, c, true));

      if (searchKey === "FULLTEXT") {
        for (let r = 1; r <= src.rows.length; r++) {
          if (r === hRow) continue;
          if (included[sheetName + "|" + r]) continue;
          let isMatch = false;
          if (bExact) {
            for (let c = 1; c <= lastCol; c++) {
              const cv = cellVal(sheetName, r, c, true);
              if (cv !== null && cv !== undefined && NormalizeText(String(cv)) === normSearch) { isMatch = true; break; }
            }
          } else {
            let rowText = "";
            for (let c = 1; c <= lastCol; c++) {
              const cv = cellVal(sheetName, r, c, true);
              if (cv !== null && cv !== undefined) rowText += " " + String(cv);
            }
            if (rowText && NormalizeText(rowText).indexOf(normSearch) >= 0) isMatch = true;
          }
          if (isMatch) writeBlock(sheetName, r, headers, minMergeOf(sheetName, r, lastCol));
        }
      } else {
        // search by column header
        let searchCol = 0;
        for (let c = 1; c <= lastCol; c++) {
          if (NormalizeText(TrimText(String(headers[c - 1] ?? ""))) === NormalizeText(searchKey)) { searchCol = c; break; }
        }
        if (!searchCol) return;
        for (let r = hRow + 1; r <= src.rows.length; r++) {
          if (included[sheetName + "|" + r]) continue;
          const cellValue = cellVal(sheetName, r, searchCol, true);
          if (cellValue === null || cellValue === undefined) continue;
          const normCell = NormalizeText(String(cellValue));
          const isMatch = bExact ? normCell === normSearch : normCell.indexOf(normSearch) >= 0;
          if (isMatch) writeBlock(sheetName, r, headers, minMergeOf(sheetName, r, lastCol));
        }
      }
    };

    const targets = [];
    if (NormalizeText(sheetFilter) === "all") {
      WB.order.forEach(n => { if (IsDataSheet(n)) targets.push(n); });
    } else {
      if (WB.sheets[sheetFilter]) targets.push(sheetFilter);
    }
    targets.forEach(scanSheet);

    renderResultsView();
    switchView("results");
    if (matchCount === 0) {
      await ShowMsg("رکوردی یافت نشد.\nSheet : " + sheetFilter + "\nKey   : " + searchKey + "\nValue : " + searchValue,
        vbInformation, "Search");
    } else {
      await ShowMsg(matchCount + " رکورد یافت شد.", vbInformation, "Search");
    }
  },

  async SaveChanges() {
    if (!state.results.length || state.resultsMode !== "search") {
      await ShowMsg("نتیجه جستجویی وجود ندارد. ابتدا جستجو کنید.", vbExclamation, "Save Changes");
      return;
    }
    let savedCount = 0, changedCount = 0;
    document.querySelectorAll("#results-body .match-block[data-match]").forEach(blockEl => {
      const matchIdx = parseInt(blockEl.dataset.match, 10);
      const blk = state.results.find(b => b.matchIdx === matchIdx);
      if (!blk) return;
      savedCount++;
      blockEl.querySelectorAll("tbody tr").forEach((tr, ri) => {
        const dr = blk.dataRows[ri];
        if (!dr) return;
        tr.querySelectorAll("input.cell-in").forEach(inp => {
          const ci = parseInt(inp.dataset.ci, 10);
          const editedVal = inp.value;
          const origVal = dr.cells[ci] === null || dr.cells[ci] === undefined ? "" : String(dr.cells[ci]);
          if (String(editedVal) !== origVal) {
            setCellVal(blk.sheet, dr.srcRow, ci + 1, editedVal, true);
            dr.cells[ci] = editedVal;
            inp.parentElement.classList.add("saved");
            changedCount++;
          }
        });
      });
    });
    if (savedCount === 0) {
      await ShowMsg("بلوک نتیجه‌ای یافت نشد. ابتدا جستجو کنید.", vbExclamation, "Save Changes");
    } else if (changedCount === 0) {
      await ShowMsg("تغییری در " + savedCount + " نتیجه شناسایی نشد.", vbInformation, "Save Changes");
    } else {
      RefreshSearchIndexSilent();
      saveState();
      WriteChangeLog("EDIT", state.results.map(b => b.sheet).join(","), "-", "SUCCESS", changedCount + " cell(s) saved from SEARCH_RESULTS");
      await ShowMsg(changedCount + " سلول در شیت‌های مبدأ ذخیره شد.\nسلول‌های تغییریافته زرد نشانه‌گذاری شدند.", vbInformation, "Save Changes");
    }
    updateStatLine();
  },

  OpenSearchResults() {
    switchView("results");
  },

  ClearSearchResults() {
    state.results = [];
    state.resultsMode = "search";
    renderResultsView();
  },

  RefreshSearchIndexCore() {
    modMapping.RefreshSearchIndex(true);
    saveState();
  }
};

/* ================================================================
   modAddRecord — StartAddWizard
   ================================================================ */
const modAddRecord = {
  IsProvincialSheet(name) { return PROVINCIAL_SHEETS.indexOf(name) >= 0; },

  FindAtmRow(sheetName) {
    const sh = WB.sheets[sheetName]; if (!sh) return 0;
    for (let r = 2; r <= Math.min(sh.rows.length, 5000); r++) {
      for (let cl = 1; cl <= 5; cl++) {
        const v = String(cellVal(sheetName, r, cl, true) ?? "");
        if (v.indexOf("شبکه خودپرداز") >= 0) return r;
      }
    }
    return 0;
  },

  FindAtmSumRow(sheetName, startRow) {
    const sh = WB.sheets[sheetName]; if (!sh) return 0;
    for (let r = startRow + 2; r <= startRow + 2000 && r <= sh.rows.length; r++) {
      for (let cl = 1; cl <= 5; cl++) {
        const v = String(cellVal(sheetName, r, cl, true) ?? "");
        if (v.indexOf("جمع") >= 0) return r;
      }
      let isEmpty = true;
      for (let cl = 1; cl <= 5; cl++) {
        if (TrimText(String(cellVal(sheetName, r, cl, true) ?? "")) !== "") { isEmpty = false; break; }
      }
      if (isEmpty) break;
    }
    return 0;
  },

  async StartAddWizard() {
    const sheetName = TrimText(state.cp.C16);
    if (!sheetName) {
      await ShowMsg("لطفاً یک شیت هدف از فهرست کشویی (C16) انتخاب کنید.", vbExclamation, "Add Record");
      return;
    }
    const target = WB.sheets[sheetName];
    if (!target) {
      await ShowMsg("شیت پیدا نشد: " + sheetName, vbExclamation, "Add Record");
      return;
    }
    if (IsSystemSheet(sheetName)) {
      await ShowMsg("شیت " + sheetName + " سیستمی است — انتخاب مجاز نیست.", vbExclamation, "Add Record");
      return;
    }

    // ---- Provincial sheet: Branch or ATM? (frmSectionPicker) ----
    let sectionType = "", atmSepRow = 0;
    if (this.IsProvincialSheet(sheetName)) {
      atmSepRow = this.FindAtmRow(sheetName);
      if (atmSepRow === 0) {
        await ShowMsg("خطا: ردیف جداسازی خودپرداز در شیت '" + sheetName + "' یافت نشد.", vbExclamation, "Add Record");
        return;
      }
      sectionType = await this.SectionPicker(sheetName);
      if (sectionType === "cancel" || !sectionType) return;
    }
    await this._runAddForm(sheetName, sectionType, atmSepRow);
  },

  // section picker with working buttons
  async SectionPicker(sheetName) {
    return new Promise(resolve => {
      const ov = document.getElementById("modal-overlay");
      const box = document.createElement("div");
      box.className = "mbox q";
      box.appendChild(el("div", { class: "t" },
        el("span", { text: "\u0627\u0646\u062a\u062e\u0627\u0628 \u0628\u062e\u0634" }),
        el("span", { class: "x", text: "\u2715" })));
      box.appendChild(el("div", { class: "c" },
        txt("\u0634\u06cc\u062a: " + TrimText(sheetName)), el("br"),
        txt("--------------------------------"), el("br"),
        el("b", { text: "\u0628\u0644\u0647" }), txt(" \u00a0=\u00a0 \u0634\u0639\u0628\u0647 \u00a0(Branch)"), el("br"),
        el("b", { text: "\u062e\u06cc\u0631" }), txt(" \u00a0=\u00a0 ATM"), el("br"),
        el("b", { text: "\u0644\u063a\u0648" }), txt(" \u00a0=\u00a0 \u0627\u0646\u0635\u0631\u0627\u0641"),
        el("div", { class: "section-pick" },
          el("button", { class: "br", "data-p": "branch", text: "\u0634\u0639\u0628\u0647" }),
          el("button", { class: "atm", "data-p": "atm", text: "\u062e\u0648\u062f\u067e\u0631\u062f\u0627\u0632" }),
          el("button", { class: "cn", "data-p": "cancel", text: "\u0627\u0646\u0635\u0631\u0627\u0641" }))));
      clear(ov); ov.appendChild(box); ov.classList.add("show");
      clear(ov); ov.appendChild(box); ov.classList.add("show");
      const done = v => { ov.classList.remove("show"); clear(ov); resolve(v); };
      box.querySelectorAll("[data-p]").forEach(b => b.onclick = () => done(b.dataset.p));
      box.querySelector(".x").onclick = () => done("cancel");
    });
  },

  async _runAddForm(sheetName, sectionType, atmSepRow) {
    const target = WB.sheets[sheetName];
    // ---- Header row ----
    let hRow;
    if (sectionType === "atm") hRow = atmSepRow + 1;
    else if (sectionType === "branch") hRow = 1;
    else hRow = FindHeaderRow(sheetName);

    let lastCol = Math.max(1, ...target.rows.map(r => r.length), 1);
    if (lastCol < 1 || lastCol > 100) {
      await ShowMsg("ستون‌ها در شیت قابل شناسایی نیستند: " + sheetName, vbExclamation, "Add Record");
      return;
    }
    const headers = [], headerCols = [];
    for (let c = 1; c <= lastCol; c++) {
      const hv = TrimText(String(cellVal(sheetName, hRow, c, true) ?? ""));
      if (hv) { headers.push(hv); headerCols.push(c); }
    }
    if (!headers.length) {
      await ShowMsg("ستونی در شیت یافت نشد: " + sheetName, vbExclamation, "Add Record");
      return;
    }

    // ---- TARGET ROW DETECTION ----
    let newRow;
    const mergeBotOf = (rowIdx) => {
      let bot = rowIdx;
      for (let cc = 1; cc <= 2; cc++) {
        const m = findMerge(target, rowIdx, cc);
        if (m && m.r2 > bot) bot = m.r2;
      }
      return bot;
    };
    if (sectionType === "branch") {
      let lastBranch = hRow;
      for (let rr = atmSepRow - 1; rr >= hRow + 1; rr--) {
        const v1 = cellVal(sheetName, rr, 1, false), v2 = cellVal(sheetName, rr, 2, false);
        if ((v1 !== null && v1 !== undefined && String(v1).trim() !== "") ||
            (v2 !== null && v2 !== undefined && String(v2).trim() !== "")) {
          lastBranch = rr; break;
        }
      }
      lastBranch = mergeBotOf(lastBranch);
      newRow = lastBranch + 1;
    } else if (sectionType === "atm") {
      const atmSumRow = this.FindAtmSumRow(sheetName, atmSepRow);
      if (atmSumRow > 0) {
        newRow = atmSumRow;
      } else {
        let lastAtm = hRow;
        for (let ra = target.rows.length; ra >= hRow + 1; ra--) {
          const v1 = cellVal(sheetName, ra, 1, false), v2 = cellVal(sheetName, ra, 2, false);
          if ((v1 !== null && v1 !== undefined && String(v1).trim() !== "") ||
              (v2 !== null && v2 !== undefined && String(v2).trim() !== "")) {
            lastAtm = ra; break;
          }
        }
        lastAtm = mergeBotOf(lastAtm);
        newRow = lastAtm + 1;
      }
    } else {
      // v21 FIX: scan ALL header columns
      let scanLast = hRow;
      for (let sc = 1; sc <= lastCol; sc++) {
        const sr = LastUsedRow(sheetName, sc);
        if (sr > scanLast) scanLast = sr;
      }
      let isSumRow = false;
      for (let sl = 1; sl <= lastCol; sl++) {
        const sv = String(cellVal(sheetName, scanLast, sl, true) ?? "");
        if (sv.indexOf("جمع") >= 0 || sv.indexOf("مجموع") >= 0) { isSumRow = true; break; }
      }
      newRow = isSumRow ? scanLast : scanLast + 1;
    }

    // ---- Field defaults from previous row (CFieldInput defaults) ----
    const defaults = headers.map((h, i) => {
      const prevRowIdx = newRow - 1;
      let ok = false;
      if (sectionType === "atm") ok = (prevRowIdx > hRow) && (prevRowIdx !== atmSepRow);
      else if (sectionType === "branch") ok = (prevRowIdx > hRow) && (prevRowIdx !== atmSepRow);
      else ok = (prevRowIdx > hRow);
      if (!ok) return "";
      return TrimText(String(cellVal(sheetName, prevRowIdx, headerCols[i], true) ?? ""));
    });

    const formNode = el("div", {},
      el("div", { class: "hint", style: { marginBottom: "8px" } },
        txt("\u0634\u06cc\u062a: "), el("b", { text: sheetName }),
        sectionType ? frag(txt(" \u2014 \u0628\u062e\u0634: "), el("b", { text: sectionType === "branch" ? "\u0634\u0639\u0628\u0647" : "\u062e\u0648\u062f\u067e\u0631\u062f\u0627\u0632" })) : frag(),
        txt(" \u2014 \u0631\u062f\u06cc\u0641 \u0645\u0642\u0635\u062f: "), el("b", { class: "rtl-num", text: String(newRow) }), el("br"),
        txt("\u0641\u06cc\u0644\u062f\u0647\u0627\u06cc \u062e\u0627\u0644\u06cc \u0646\u0627\u062f\u06cc\u062f\u0647 \u06af\u0631\u0641\u062a\u0647 \u0645\u06cc\u200c\u0634\u0648\u0646\u062f (Skip \u2014 \u0645\u0639\u0627\u062f\u0644 NO \u062f\u0631 \u0641\u0631\u0645 VBA). \u0628\u0631\u0627\u06cc \u0644\u063a\u0648 \u06a9\u0644 \u0639\u0645\u0644\u06cc\u0627\u062a\u060c \u0627\u0646\u0635\u0631\u0627\u0641 \u0628\u0632\u0646\u06cc\u062f.")),
      el("div", { class: "wizard-fields" },
        headers.map((h, i) => el("div", { class: "wf" },
          el("label", { text: h }),
          el("input", { "data-i": i, value: defaults[i] || "", placeholder: "(\u062e\u0627\u0644\u06cc = Skip)" })))));

    const values = await this.WizardAddForm(formNode);
    if (values === null) return; // cancelled
    await this._saveAdd(sheetName, sectionType, atmSepRow, headers, headerCols, newRow, values);
  },

  // promise modal for the add-wizard — captures input values on OK
  WizardAddForm(contentNode) {
    return new Promise(resolve => {
      const ov = document.getElementById("modal-overlay");
      const box = el("div", { class: "mbox info" });
      box.appendChild(el("div", { class: "t" },
        el("span", { text: "Add Record \u2014 \u0648\u06cc\u0632\u0627\u0631\u062f \u0648\u0631\u0648\u062f \u0631\u06a9\u0648\u0631\u062f" }),
        el("span", { class: "x", text: "\u2715" })));
      box.appendChild(el("div", { class: "c" }, contentNode));
      box.appendChild(el("div", { class: "f" },
        el("button", { class: "ok", "data-a": "ok", text: "\u0627\u062f\u0627\u0645\u0647 \u2190 \u067e\u06cc\u0634\u200c\u0646\u0645\u0627\u06cc\u0634" }),
        el("button", { class: "cancel", "data-a": "cancel", text: "\u0627\u0646\u0635\u0631\u0627\u0641" })));
      clear(ov); ov.appendChild(box); ov.classList.add("show");
      const done = v => { ov.classList.remove("show"); clear(ov); resolve(v); };
      box.querySelector("[data-a='cancel']").onclick = () => done(null);
      box.querySelector(".x").onclick = () => done(null);
      box.querySelector("[data-a='ok']").onclick = () => {
        const vals = [];
        box.querySelectorAll("input[data-i]").forEach(inp => {
          vals[parseInt(inp.dataset.i, 10)] = TrimText(inp.value);
        });
        done(vals);
      };
    });
  },

  async _saveAdd(sheetName, sectionType, atmSepRow, headers, headerCols, newRow, values) {
    // preview & confirm
    let hasValue = false;
    let preview = "Sheet: " + sheetName;
    if (sectionType) preview += " [" + (sectionType === "branch" ? "شعبه" : "خودپرداز") + "]";
    preview += "\n" + "-".repeat(40) + "\n";
    headers.forEach((h, i) => {
      if (values[i]) { preview += h + ": " + values[i] + "\n"; hasValue = true; }
    });
    if (!hasValue) {
      await ShowMsg("هیچ مقداری وارد نشد.", vbExclamation, "Add Record");
      return;
    }
    preview += "\nآیا ذخیره شود؟";
    const yn = await ShowMsg(preview, vbYesNo | vbQuestion, "CONFIRM ADD");
    if (yn !== IDYES) return;

    // save
    if (insertRowAtSafe(sheetName, newRow)) { /* inserted */ }
    values.forEach((v, i) => {
      if (v) setCellVal(sheetName, newRow, headerCols[i], v, false);
    });
    WriteChangeLog("ADD", sheetName, String(newRow), "SUCCESS",
      "Added row " + newRow + " [" + (sectionType || "default") + "] to: " + sheetName);
    RefreshSearchIndexSilent();
    saveState();
    await ShowMsg("رکورد با موفقیت ذخیره شد!\nشیت : " + sheetName + "\nردیف : " + newRow,
      vbInformation, "Add Record - Done");
    renderSheetView(sheetName);
  }
};
function insertRowAtSafe(sheetName, excelRow) {
  insertRowAt(sheetName, excelRow);
  return true;
}

/* ================================================================
   modRemoveRecord — StartRemoveWizard
   ================================================================ */
const modRemoveRecord = {
  async StartRemoveWizard() {
    if (!WB.sheets[IDX_SHEET]) {
      await ShowMsg("شیت ایندکس یافت نشد. ابتدا REFRESH INDEX را اجرا کنید.", vbExclamation, "Error");
      return;
    }
    let sheetFilter = TrimText(state.cp.C23) || "ALL";
    const searchKey = TrimText(state.cp.C25) || "FULLTEXT";
    const searchValue = TrimText(state.cp.C27);
    if (!searchValue) {
      await ShowMsg("مقدار جستجو (C27) را وارد کنید.", vbExclamation, "Remove");
      return;
    }
    const matches = modMapping.GetMatchRows(searchKey, searchValue, sheetFilter);
    if (matches.length === 0) {
      await ShowMsg("نتیجه‌ای برای '" + searchValue + "' یافت نشد.\nREFRESH INDEX بزنید.", vbInformation, "Remove");
      return;
    }

    // build remove results (BuildRemoveResultsV2)
    state.results = [];
    state.resultsMode = "remove";
    state.removeSearchValue = searchValue;
    const matchInfo = [];
    matches.forEach((idxRowExcel, i) => {
      const idxRow = idxRowExcel - 1;
      const idx = WB.sheets[IDX_SHEET].rows[idxRow] || [];
      const srcSheetName = TrimText(String(idx[0] ?? ""));
      const srcRowNum = parseInt(idx[1], 10);
      const src = WB.sheets[srcSheetName];
      if (!src || !srcRowNum) return;
      const hRow = 1;
      let lastCol = Math.max(1, ...src.rows.map(r => r.length), 1);
      if (lastCol < 1) lastCol = 1;
      if (lastCol > 50) lastCol = 50;
      // merge expansion
      let minMerge = 0;
      if (src.merges) {
        for (const m of src.merges) {
          if (m.r1 === srcRowNum && (m.r2 - m.r1 + 1) >= 2) {
            const size = m.r2 - m.r1 + 1;
            if (minMerge === 0 || size < minMerge) minMerge = size;
          }
        }
      }
      const maxDataRow = minMerge > 0 ? srcRowNum + minMerge - 1 : srcRowNum;
      const dataRowCount = maxDataRow - srcRowNum + 1;
      matchInfo[i + 1] = { sheet: srcSheetName, from: srcRowNum, to: maxDataRow };
      const headers = [];
      for (let c = 1; c <= lastCol; c++) headers.push(cellVal(srcSheetName, hRow, c, true) ?? "");
      const blk = { matchIdx: i + 1, sheet: srcSheetName, srcRow: srcRowNum, srcRowTo: maxDataRow, headers, dataRows: [] };
      for (let dr = 0; dr < dataRowCount; dr++) {
        const cells = [];
        for (let c = 1; c <= lastCol; c++) {
          const v = cellVal(srcSheetName, srcRowNum + dr, c, true);
          cells.push(v === null || v === undefined ? "" : String(v));
        }
        blk.dataRows.push({ srcRow: srcRowNum + dr, cells });
      }
      state.results.push(blk);
    });
    renderResultsView();
    switchView("results");

    // select matches
    const selStr = await ShowInput(
      matches.length + " مورد برای '" + searchValue + "' یافت شد.\n\n" +
      "شماره Match را وارد کنید (1-" + matches.length + ")\n" +
      "یا ALL برای حذف همه:\n\n[کلید جستجو: " + searchKey + "]",
      "Remove - انتخاب Match", "ALL");
    if (selStr === null || TrimText(selStr) === "") return;
    const deleteAll = TrimText(selStr).toUpperCase() === "ALL";
    const selNums = [];
    if (!deleteAll) {
      const parts = selStr.split(",");
      for (const p of parts) {
        const pTrim = TrimText(p);
        if (/^\d+$/.test(pTrim)) {
          const n = parseInt(pTrim, 10);
          if (n >= 1 && n <= matches.length) selNums.push(n);
        }
      }
      if (!selNums.length) {
        await ShowMsg("عدد نامعتبر است.", vbExclamation, "Remove");
        return;
      }
    }

    // service type
    let svcStr = "";
    do {
      svcStr = await ShowInput(
        "1 = مخابرات\n2 = مبین نت\n3 = آسیاتک",
        "نوع سرویس", "1");
      if (svcStr === null || TrimText(svcStr) === "") return;
      svcStr = TrimText(svcStr);
    } while (svcStr !== "1" && svcStr !== "2" && svcStr !== "3");
    const svcName = svcStr === "1" ? "مخابرات" : svcStr === "2" ? "مبین نت" : "آسیاتک";

    // collect deletions
    const dels = [];
    for (let mi = 1; mi <= matchInfo.length - 1; mi++) {
      const include = deleteAll || selNums.indexOf(mi) >= 0;
      if (include && matchInfo[mi]) dels.push(matchInfo[mi]);
    }
    // sort bottom-up per sheet
    dels.sort((a, b) => (a.sheet === b.sheet) ? (b.from - a.from) : (a.sheet < b.sheet ? -1 : 1));

    // undo session
    modUndo.InitUndoSession(svcStr);
    let deletedRows = 0;
    let archiveErrors = "";
    const arc2Name = svcStr === "2" ? ARCHIVE_MABIN : svcStr === "3" ? ARCHIVE_ASIATAK : "";

    for (const d of dels) {
      const dSheet = d.sheet, dFrom = d.from, dTo = d.to;
      const dWS = WB.sheets[dSheet];
      if (!dWS) continue;
      const hR = 1;
      const lastC = Math.max(1, ...dWS.rows.map(r => r.length), 1);
      const rowCount = dTo - dFrom + 1;

      // snapshot BEFORE delete
      const snap = [];
      for (let r = dFrom; r <= dTo; r++) {
        const cells = [];
        for (let c = 1; c <= lastC; c++) {
          const v = cellVal(dSheet, r, c, true);
          cells.push(v === undefined ? null : v);
        }
        snap.push(cells);
      }

      // archive
      let archiveOK = true, errMsg = "";
      const arc1 = resolveArchiveSheet(ARCHIVE_MAIN);
      const arc2 = arc2Name ? resolveArchiveSheet(arc2Name) : null;
      if (svcStr === "2" && !arc2) { archiveOK = false; errMsg = "Archive sheet not found: " + ARCHIVE_MABIN; }
      if (svcStr === "3" && !arc2) { archiveOK = false; errMsg = "Archive sheet not found: " + ARCHIVE_ASIATAK; }
      const arc1StartRow = arc1 ? LastUsedRow(arc1, 1) + 1 : 0;
      const arc2StartRow = arc2 ? LastUsedRow(arc2, 1) + 1 : 0;

      if (archiveOK) {
        for (let dr = dTo; dr >= dFrom; dr--) {
          if (!this.CopyRowToArchive(dSheet, dr, lastC, arc1, ref => errMsg = ref)) archiveOK = false;
          if (arc2 && !this.CopyRowToArchive(dSheet, dr, lastC, arc2, ref => errMsg = ref)) archiveOK = false;
        }
      }

      if (!archiveOK) {
        WriteChangeLog("ARCHIVE_FAIL", dSheet, searchValue, "ARCHIVE_FAIL", "Delete aborted - " + errMsg);
        archiveErrors += dSheet + " (rows " + dFrom + "-" + dTo + "): " + errMsg + "\n";
      } else {
        deleteRows(dSheet, dFrom, dTo);
        deletedRows += rowCount;
        modUndo.AppendUndoBlockFromSnapshot(snap, dFrom, dTo, lastC, dSheet,
          arc1 ? arc1 : "", arc1 ? arc1StartRow : 0, arc1 ? rowCount : 0,
          arc2 ? arc2 : "", arc2 ? arc2StartRow : 0, arc2 ? rowCount : 0);
        WriteChangeLog("REMOVE", dSheet, searchValue, "SUCCESS",
          "Rows " + dFrom + "-" + dTo + " deleted; " + svcName);
      }
    }

    RefreshSearchIndexSilent();
    if (deletedRows > 0) modUndo.FinalizeUndoSession();
    else modUndo.ClearUndoState();
    saveState();

    if (archiveErrors) {
      await ShowMsg("خطاها:\n" + archiveErrors + "\nردیف‌ها فقط پس از آرشیو موفق حذف شدند.",
        vbExclamation, "Archive Error");
    }
    if (deletedRows > 0) {
      await ShowMsg(deletedRows + " ردیف حذف و آرشیو شد.\nنوع سرویس: " + svcName + "\n\n" +
        "برای بازگرداندن از دکمه UNDO (کنار REMOVE RECORD) استفاده کنید.",
        vbInformation, "Done");
    }
    updateStatLine();
  },

  CopyRowToArchive(srcSheetName, srcRow, lastC, archiveName, setErr) {
    const arcWS = WB.sheets[archiveName];
    if (!arcWS) {
      if (setErr) setErr("Archive sheet not found: " + archiveName);
      return false;
    }
    const arcRow = LastUsedRow(archiveName, 1) + 1;
    for (let c = 1; c <= lastC; c++) {
      const v = cellVal(srcSheetName, srcRow, c, true);
      setCellVal(archiveName, arcRow, c, v === undefined ? null : v, false);
    }
    return true;
  }
};
function resolveArchiveSheet(archiveName) {
  if (WB.sheets[archiveName]) return archiveName;
  // fuzzy fallback: normalized containment
  const norm = s => s.replace(/آ/g, "ا").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/ئ/g, "ی")
    .replace(/[\u0640\s\d]/g, "").replace(/‌/g, "");
  const want = norm(archiveName);
  for (const n of WB.order) {
    if (IsSystemSheet(n)) continue;
    const nn = norm(n);
    if (nn.indexOf(want) >= 0 || want.indexOf(nn) >= 0) return n;
  }
  // partial keyword fallback
  const want2 = norm(archiveName);
  for (const n of WB.order) {
    if (IsSystemSheet(n)) continue;
    const nn = norm(n);
    if (want2.indexOf("جمع") === 0) {
      if (nn.indexOf("جمع") >= 0) {
        if (want2.indexOf("مبین") >= 0 && nn.indexOf("مبین") >= 0) return n;
        if (want2.indexOf("اسیاتک") >= 0 && nn.indexOf("اسیاتک") >= 0) return n;
        if (want2.indexOf("سرویس") >= 0 && nn.indexOf("سرویس") >= 0) return n;
      }
    }
  }
  return null;
}

/* ================================================================
   modUndo — InitUndoSession / AppendUndoBlockFromSnapshot / UndoLastRemove
   ================================================================ */
const modUndo = {
  HasUndoState() { return !!(state.undo && state.undo.valid); },
  ClearUndoState() { state.undo = null; saveState(); },
  InitUndoSession(svcStr) {
    state.undo = { valid: false, blockCount: 0, svcStr, ts: Date.now(), blocks: [] };
    saveState();
  },
  AppendUndoBlockFromSnapshot(snapData, fromRow, toRow, lastCol, srcWSName,
                              arc1Name, arc1FromRow, arc1RowCount,
                              arc2Name, arc2FromRow, arc2RowCount) {
    if (!state.undo) return;
    state.undo.blockCount++;
    state.undo.blocks.push({
      sheet: srcWSName, from: fromRow, to: toRow, lastCol,
      arc1Name: arc1Name || "", arc1From: arc1FromRow || 0, arc1Count: arc1RowCount || 0,
      arc2Name: arc2Name || "", arc2From: arc2FromRow || 0, arc2Count: arc2RowCount || 0,
      data: snapData
    });
  },
  AppendUndoBlock(srcWSName, fromRow, toRow, lastCol, arc1Name, arc1FromRow, arc1RowCount,
                  arc2Name, arc2FromRow, arc2RowCount) {
    const snap = [];
    for (let r = fromRow; r <= toRow; r++) {
      const cells = [];
      for (let c = 1; c <= lastCol; c++) {
        const v = cellVal(srcWSName, r, c, true);
        cells.push(v === undefined ? null : v);
      }
      snap.push(cells);
    }
    this.AppendUndoBlockFromSnapshot(snap, fromRow, toRow, lastCol, srcWSName,
      arc1Name, arc1FromRow, arc1RowCount, arc2Name, arc2FromRow, arc2RowCount);
  },
  FinalizeUndoSession() {
    if (state.undo && state.undo.blockCount > 0) state.undo.valid = true;
    saveState();
    updateStatLine();
  },
  SaveUndoBlock(srcWSName, fromRow, toRow, lastCol, svcStr, arc1Name, arc1FromRow, arc1RowCount, arc2Name, arc2FromRow, arc2RowCount) {
    this.InitUndoSession(svcStr);
    this.AppendUndoBlock(srcWSName, fromRow, toRow, lastCol, arc1Name, arc1FromRow, arc1RowCount, arc2Name, arc2FromRow, arc2RowCount);
    this.FinalizeUndoSession();
  },

  async UndoLastRemove() {
    if (!this.HasUndoState()) {
      await ShowMsg("هیچ عملیات حذفی برای بازگشت وجود ندارد.", vbExclamation, "Undo");
      return;
    }
    const u = state.undo;
    const blockCount = u.blockCount;
    if (blockCount <= 0) {
      await ShowMsg("Undo buffer خالی است.", vbExclamation, "Undo");
      return;
    }
    let totalRows = 0;
    u.blocks.forEach(b => totalRows += (b.to - b.from + 1));
    const yn = await ShowMsg(
      "بازگردانی " + totalRows + " ردیف از " + blockCount + " بلوک\nآیا انجام شود؟",
      vbYesNo | vbQuestion, "Undo Remove");
    if (yn !== IDYES) return;

    for (let bi = u.blocks.length - 1; bi >= 0; bi--) {
      const b = u.blocks[bi];
      const srcWS = WB.sheets[b.sheet];
      if (!srcWS) {
        await ShowMsg("شیت یافت نشد: " + b.sheet, vbExclamation, "Undo Error");
        return;
      }
      const rowCount = b.to - b.from + 1;
      // insert blank rows
      for (let r = 1; r <= rowCount; r++) insertRowAt(b.sheet, b.from + r - 1);
      // write data back
      for (let r = 0; r < rowCount; r++) {
        const dataRow = b.data[r] || [];
        for (let c = 1; c <= b.lastCol; c++) {
          setCellVal(b.sheet, b.from + r, c, dataRow[c - 1] === undefined ? null : dataRow[c - 1], false);
        }
      }
      // delete archive rows
      if (b.arc1From > 0 && b.arc1Count > 0) this.DeleteArchiveRows(b.arc1Name, b.arc1From, b.arc1Count);
      if (b.arc2Name && b.arc2From > 0 && b.arc2Count > 0) this.DeleteArchiveRows(b.arc2Name, b.arc2From, b.arc2Count);
    }
    this.ClearUndoState();
    RefreshSearchIndexSilent();
    saveState();
    WriteChangeLog("UNDO", "-", "-", "SUCCESS", totalRows + " row(s) restored from " + blockCount + " block(s)");
    await ShowMsg(totalRows + " ردیف با موفقیت بازگردانی شد!", vbInformation, "Undo - Done");
    updateStatLine();
    renderSheetView(state.currentSheet || WB.order[0]);
  },

  DeleteArchiveRows(archiveName, arcFrom, arcCount) {
    if (!archiveName || !arcFrom || !arcCount) return;
    const arcWS = WB.sheets[archiveName];
    if (!arcWS) return;
    deleteRows(archiveName, arcFrom, arcFrom + arcCount - 1);
  }
};
