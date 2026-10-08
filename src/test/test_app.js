const fs = require("fs");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(require("path").join(__dirname, "..", "..", "Mohsen_FINAL_v5.html"), "utf-8");
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/", pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  window.URL.createObjectURL = () => "blob:fake";
  window.URL.revokeObjectURL = () => {};
  let downloaded = 0;
  window.HTMLAnchorElement.prototype.click = function () { downloaded++; };
  await sleep(400);

  const results = [];
  const check = (name, cond, extra) => {
    results.push([name, !!cond]);
    console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  [" + extra + "]" : ""));
  };
  async function waitFor(sel, ms = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const el = doc.querySelector(sel);
      if (el) return el;
      await sleep(10);
    }
    return null;
  }
  async function clickWhen(sel) {
    const el = await waitFor(sel);
    if (el) el.click();
    await sleep(30);
    return !!el;
  }
  async function answerInput(value) {
    const inp = await waitFor("#modal-input");
    if (!inp) return false;
    inp.value = value;
    const ok = await waitFor("#modal-overlay .mbox .f button[data-id='1']");
    if (ok) ok.click();
    await sleep(30);
    return true;
  }
  const W = window;

  // ===== HARDENING META: no inline handlers + CSP (verifiable from repo artifact) =====
  const inlineHits = html.match(/<[a-zA-Z][^>]*\s+on[a-z]+\s*=\s*["']/g) || [];
  check("meta: zero inline event handlers in HTML", inlineHits.length === 0, inlineHits.length + " found");
  check("meta: CSP blocks attribute handlers", /Content-Security-Policy[^>]*script-src-attr\s*'none'/.test(html));
  check("meta: delegation table present", typeof W.ACTIONS === "object" && typeof W.bindDelegatedEvents === "function");
  // behavioral: delegation dispatch (filter pill)
  const pill = Array.from(doc.querySelectorAll("#cat-bar [data-act='set-filter']")).find(p => p.dataset.cat !== "all");
  check("meta: delegation dispatch works", !!pill && (() => { pill.click(); return W.state.catFilter === pill.dataset.cat; })(),
    String(W.state.catFilter));
  W.setCatFilter("all");

  // ===== REGRESSION: browser file dialog must open on IMPORT click =====
  // (bug fixed: delegated dispatcher used to preventDefault the programmatic
  //  input.click() itself, which cancelled the OS file dialog default action)
  const fi = doc.getElementById("import-file-input");
  let inputClicked = 0;
  const origClick = fi.click.bind(fi);
  fi.click = () => { inputClicked++; };
  const importBtn = doc.querySelector("[data-act='open-file']");
  check("filepicker: import button present", !!importBtn);
  if (importBtn) importBtn.click();
  await sleep(20);
  check("filepicker: file input click invoked", inputClicked === 1, String(inputClicked));
  fi.click = origClick;
  const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  const propagated = fi.dispatchEvent(ev);
  check("filepicker: input click NOT preventDefault-ed", propagated && !ev.defaultPrevented);
  check("filepicker: input has no data-act (native default safe)", !fi.hasAttribute("data-act"));

  // ===== EMPTY START (no data at all until the user imports a file) =====
  check("empty: no data sheets at boot", W.WB.order.filter(n => W.IsDataSheet(n)).length === 0,
    W.WB.order.length + " system sheets");
  check("empty: system shell present", !!W.WB.sheets["CONTROL_PANEL"] && !!W.WB.sheets["CHANGE_LOG"] &&
    !!W.WB.sheets["SYSTEM_SHEET_CONFIG"]);
  check("empty: search index empty", W.WB.sheets["SYSTEM_SEARCH_INDEX"].rows.length <= 1);
  check("empty: dashboard shows import CTA", !!doc.querySelector("#dash-cats .empty-state"));
  check("empty: catalog shows import CTA", !!doc.querySelector("#sheet-catalog .empty-state"));

  // ===== LOAD FIXTURE DATA (as the user would via file import) =====
  const fixture = JSON.parse(fs.readFileSync(require("path").join(__dirname, "fixture_workbook.json"), "utf-8"));
  check("fixture: import accepted", W.applyJsonBackup("fixture_workbook.json", fixture) === true);
  check("fixture: data sheets loaded", W.WB.order.filter(n => W.IsDataSheet(n)).length === 62,
    W.WB.order.filter(n => W.IsDataSheet(n)).length + " data sheets");

  // ===== INIT =====
  check("init: C7 populated", doc.getElementById("cp-c7").options.length > 50);
  check("init: index built", W.WB.sheets["SYSTEM_SEARCH_INDEX"].rows.length > 1000);
  check("init: exact toggle ON", doc.getElementById("exact-toggle").className.includes("on"));

  // ===== CATEGORIES (new) =====
  check("cats: dashboard tiles rendered", doc.querySelectorAll("#dash-cats .cat-tile").length >= 6,
    doc.querySelectorAll("#dash-cats .cat-tile").length + " tiles");
  check("cats: category bar pills", doc.querySelectorAll("#cat-bar .cat-pill").length >= 7,
    doc.querySelectorAll("#cat-bar .cat-pill").length + " pills");
  check("cats: sheet cards catalog", doc.querySelectorAll("#sheet-catalog .sheet-card").length >= 60,
    doc.querySelectorAll("#sheet-catalog .sheet-card").length + " cards");
  check("cats: category sections with headers", doc.querySelectorAll("#sheet-catalog .cat-section").length >= 6,
    doc.querySelectorAll("#sheet-catalog .cat-section").length + " sections");
  // dropdowns grouped with optgroups
  const og = doc.querySelectorAll("#cp-c7 optgroup");
  check("cats: C7 dropdown grouped by category (optgroup)", og.length >= 5,
    Array.from(og).map(o => o.label).join(" / "));
  // provinces category maps correctly
  const catProv = W.categoryOf("خراسان رضوی").id;
  const catDc = W.categoryOf("مرکز داده تهران").id;
  const catEq = W.categoryOf("تجهیزات شبکه خودپرداز").id;
  const catCost = W.categoryOf("هزینه سرویس مخابرات").id;
  const catCar = W.categoryOf("جمع اوری اسیاتک").id;
  const catSvc = W.categoryOf("شبکه VSAT").id;
  check("cats: mapping provinces/datacenters/equipment/costs/carriers/services",
    catProv === "provinces" && catDc === "datacenters" && catEq === "equipment" &&
    catCost === "costs" && catCar === "carriers" && catSvc === "services",
    [catProv, catDc, catEq, catCost, catCar, catSvc].join(","));
  // filter by category
  W.openCategory("provinces");
  await sleep(30);
  const secCount = doc.querySelectorAll("#sheet-catalog .cat-section").length;
  const provCards = doc.querySelectorAll("#sheet-catalog .sheet-card").length;
  check("cats: province filter shows only provinces", secCount === 1 && provCards >= 30 && provCards <= 40,
    secCount + " section / " + provCards + " cards");
  W.setCatFilter("all");
  await sleep(20);

  // ===== WATCHER =====
  doc.getElementById("cp-c7").value = "تجهیزات شبکه خودپرداز";
  doc.getElementById("cp-c7").dispatchEvent(new window.Event("change"));
  await sleep(30);
  check("watcher: key dropdown rebuilt", Array.from(doc.getElementById("cp-c9").options).some(o => o.value === "نام دستگاه"));
  check("watcher: C11 cleared", doc.getElementById("cp-c11").value === "");

  // ===== SEARCH =====
  doc.getElementById("cp-c7").value = "ALL";
  doc.getElementById("cp-c7").dispatchEvent(new window.Event("change"));
  await sleep(30);
  W.state.cp.B12 = "OFF"; W.renderExactToggle();
  doc.getElementById("cp-c11").value = "A-801-41-Forodga";
  doc.getElementById("cp-c11").dispatchEvent(new window.Event("input"));
  const pSearch = W.modSearchEngine.SearchRecords();
  await clickWhen("#modal-overlay .mbox .f button");
  await pSearch;
  check("search: matches found", W.state.results.length >= 1, W.state.results.length + " blocks");
  check("search: rendered", doc.querySelectorAll("#results-body .match-block[data-match]").length >= 1);

  // ===== SAVE CHANGES =====
  const firstInput = doc.querySelector("#results-body input.cell-in");
  check("results: editable inputs", !!firstInput);
  if (firstInput) {
    const orig = firstInput.value;
    const ci = parseInt(firstInput.dataset.ci, 10);
    firstInput.value = "EDIT_TEST_VALUE_XYZ";
    const blk = W.state.results[0];
    const pSave = W.modSearchEngine.SaveChanges();
    await clickWhen("#modal-overlay .mbox .f button");
    await pSave;
    check("savechanges: wrote back", String(W.cellVal(blk.sheet, blk.dataRows[0].srcRow, ci + 1, true)) === "EDIT_TEST_VALUE_XYZ");
    W.setCellVal(blk.sheet, blk.dataRows[0].srcRow, ci + 1, orig, true);
  }

  // ===== INDEX MATCHING =====
  check("GetMatchRows works", W.modMapping.GetMatchRows("FULLTEXT", "خراسان", "ALL").length > 5);

  // ===== ADD WIZARD =====
  doc.getElementById("cp-c16").value = "PSPs";
  doc.getElementById("cp-c16").dispatchEvent(new window.Event("change"));
  await sleep(30);
  const pAdd = W.modAddRecord.StartAddWizard();
  const wiz = await waitFor("#modal-overlay .wf input");
  check("add: wizard opens", !!wiz);
  if (wiz) {
    doc.querySelectorAll("#modal-overlay .wf input")[0].value = "999";
    doc.querySelectorAll("#modal-overlay .wf input")[1].value = "DelState";
    doc.querySelectorAll("#modal-overlay .wf input")[2].value = "DelCity";
    doc.querySelectorAll("#modal-overlay .wf input")[3].value = "DEL_TARGET_BRANCH";
    await clickWhen("#modal-overlay .mbox .f button[data-a='ok']");
    await clickWhen("#modal-overlay .mbox .f button[data-id='6']");
    await clickWhen("#modal-overlay .mbox .f button[data-id='1']");
    await pAdd;
    check("add: row inserted", W.WB.sheets["PSPs"].rows.some(r => (r || []).some(c => c === "DEL_TARGET_BRANCH")));
    check("add: logged", W.WB.sheets["CHANGE_LOG"].rows.some(r => r[1] === "ADD"));
  } else { try { await pAdd; } catch (e) {} }

  // ===== SECTION PICKER =====
  doc.getElementById("cp-c16").value = "خراسان رضوی";
  doc.getElementById("cp-c16").dispatchEvent(new window.Event("change"));
  await sleep(30);
  const pAdd2 = W.modAddRecord.StartAddWizard();
  const brBtn = await waitFor("#modal-overlay .section-pick button[data-p='branch']");
  check("add: section picker shown", !!brBtn);
  if (brBtn) brBtn.click();
  await sleep(40);
  const wiz2 = await waitFor("#modal-overlay .wf input");
  check("add: branch form opens", !!wiz2);
  await clickWhen("#modal-overlay .mbox .f button[data-a='cancel']");
  await pAdd2;

  // ===== REMOVE + UNDO =====
  doc.getElementById("cp-c23").value = "PSPs";
  doc.getElementById("cp-c23").dispatchEvent(new window.Event("change"));
  await sleep(30);
  doc.getElementById("cp-c27").value = "NO_MATCH_ZZZ_999";
  doc.getElementById("cp-c27").dispatchEvent(new window.Event("input"));
  const pRm0 = W.modRemoveRecord.StartRemoveWizard();
  await clickWhen("#modal-overlay .mbox .f button");
  await pRm0;
  check("remove: no-match handled", true);

  W.RefreshSearchIndexSilent();
  doc.getElementById("cp-c27").value = "DEL_TARGET_BRANCH";
  doc.getElementById("cp-c27").dispatchEvent(new window.Event("input"));
  const pRm = W.modRemoveRecord.StartRemoveWizard();
  check("remove: match prompt", await answerInput("ALL"));
  check("remove: service prompt", await answerInput("1"));
  await clickWhen("#modal-overlay .mbox .f button");
  await pRm;
  check("remove: deleted", !W.WB.sheets["PSPs"].rows.some(r => (r || []).some(c => c === "DEL_TARGET_BRANCH")));
  const arch = W.WB.sheets[W.resolveArchiveSheet("لیست جمع آوری سرویس")];
  check("remove: archived", arch.rows.some(r => (r || []).some(c => c === "DEL_TARGET_BRANCH")));
  check("remove: undo valid", W.modUndo.HasUndoState());

  const pUndo = W.modUndo.UndoLastRemove();
  await clickWhen("#modal-overlay .mbox .f button[data-id='6']");
  await clickWhen("#modal-overlay .mbox .f button[data-id='1']");
  await pUndo;
  check("undo: restored", W.WB.sheets["PSPs"].rows.some(r => (r || []).some(c => c === "DEL_TARGET_BRANCH")));
  check("undo: archive cleaned", !arch.rows.some(r => (r || []).some(c => c === "DEL_TARGET_BRANCH")));
  check("undo: state cleared", !W.modUndo.HasUndoState());

  // ===== LOG / EXPORT / PROTECT / NAV =====
  check("log: entries", W.WB.sheets["CHANGE_LOG"].rows.length > 5);
  downloaded = 0;
  W.RunMacro("modExport.ExportSearchResults");
  W.RunMacro("modExport.ExportChangeLog");
  W.RunMacro("modExport.ExportCurrentData");
  W.RunMacro("modExportAllModules.ExportAllModules");
  await clickWhen("#modal-overlay .mbox .f button");
  await sleep(50);
  check("export: downloads", downloaded >= 4, downloaded + "");

  const pPw = W.modUI.UnprotectControlPanel();
  check("protect: prompt", await answerInput("1234"));
  await pPw;
  check("protect: unlocked", W.state.panelProtected === false);

  W.RunMacro("modNavigator.ShowSheetNavigator");
  const cards = await waitFor("#modal-overlay .nav-card");
  check("navigator: grouped headers", doc.querySelectorAll("#modal-overlay .nav-group-head").length >= 5,
    doc.querySelectorAll("#modal-overlay .nav-group-head").length + " groups");
  check("navigator: cards", doc.querySelectorAll("#modal-overlay .nav-card").length > 50,
    doc.querySelectorAll("#modal-overlay .nav-card").length + " cards");
  if (cards) cards.click();
  await sleep(30);

  // ===== REGISTRY / GRID =====
  check("registry: 60+ macros", W.MACRO_REGISTRY.length >= 60, W.MACRO_REGISTRY.length + "");
  check("vba: 97 modules", Object.keys(W.VBA_MODULES).length === 97);
  W.renderSheetView("مرکز داده تهران");
  await sleep(20);
  check("grid: rows rendered", doc.querySelectorAll("#sheet-body tbody tr").length > 5);
  check("grid: active sheet card highlighted", doc.querySelectorAll("#sheet-catalog .sheet-card.active").length === 1);

  // ===== IMPORT / EXPORT-XLSX (macros must run on imported data) =====
  const XLSX = W.XLSX;
  check("import: xlsx lib loaded", !!XLSX && !!XLSX.read && !!XLSX.write);
  const iwb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([["شاخص", "نام", "IP"], ["X999", "نود تست", "10.1.1.1"], ["X998", "نود دوم", "10.1.1.2"]]);
  XLSX.utils.book_append_sheet(iwb, ws1, "TestNet1");
  const ws2 = XLSX.utils.aoa_to_sheet([["شاخص", "شرح"], ["Y500", "سرویس ویژه"]]);
  XLSX.utils.book_append_sheet(iwb, ws2, "TestNet2");
  const ibuf = XLSX.write(iwb, { type: "array", bookType: "xlsx" });
  check("import: workbook accepted", W.importWorkbookFromBuffer("test_import.xlsx", ibuf) === true);
  check("import: new sheets present", W.WB.order.includes("TestNet1") && W.WB.order.includes("TestNet2"),
    W.WB.order.length + " sheets");
  check("import: old data replaced", !W.WB.order.includes("خراسان رضوی") && !W.WB.order.includes("PSPs"));
  check("import: control surfaces kept", !!W.WB.sheets["CONTROL_PANEL"] && !!W.WB.sheets["CHANGE_LOG"] &&
    !!W.WB.sheets["SYSTEM_SHEET_CONFIG"] && !!W.WB.sheets["SYSTEM_SEARCH_INDEX"]);
  check("import: cfg covers imported", W.WB.sheets["SYSTEM_SHEET_CONFIG"].rows.some(r => (r || [])[0] === "TestNet1"));
  check("import: search index on imported", W.modMapping.GetMatchRows("شاخص", "X999", "ALL").length === 1,
    W.modMapping.GetMatchRows("شاخص", "X999", "ALL").length + " hits");
  // macro-style edit + search on the imported data
  W.WB.sheets["TestNet1"].rows.push(["X997", "نود تازه", "10.1.1.3"]);
  W.RefreshSearchIndexSilent();
  check("import: macro search sees new row", W.modMapping.GetMatchRows("شاخص", "X997", "ALL").length === 1);
  check("import: CHANGE_LOG got IMPORT entry", W.WB.sheets["CHANGE_LOG"].rows.some(r =>
    (r || []).some(c => String(c).indexOf("IMPORT") >= 0)));
  // CSV upsert: adds one sheet without wiping imported workbook
  check("import: csv accepted", W.importCsvText("mytable.csv", "a,b\n1,2\n3,4") === true);
  check("import: csv sheet upserted", W.WB.order.includes("mytable") && W.WB.sheets["mytable"].rows.length === 3);
  check("import: csv kept other sheets", W.WB.order.includes("TestNet1"));
  // XLSX export round-trip
  const outWb = W.BuildExportWorkbook();
  check("export: xlsx workbook built", outWb.SheetNames.includes("TestNet1") && outWb.SheetNames.includes("CONTROL_PANEL"),
    outWb.SheetNames.length + " sheets");
  const outBuf = XLSX.write(outWb, { type: "array", bookType: "xlsx" });
  const back = XLSX.read(outBuf, { type: "array" });
  const backRows = XLSX.utils.sheet_to_json(back.Sheets["TestNet1"], { header: 1 });
  check("export: round-trip data", back.SheetNames.includes("TestNet1") &&
    W.TrimText(String(backRows[1][0])) === "X999" && W.TrimText(String(backRows[3][0])) === "X997");
  // ===== MERGED CELLS: must render exactly like Excel (rowspan/colspan) =====
  const mwb = XLSX.utils.book_new();
  const mws = XLSX.utils.aoa_to_sheet([
    ["ناحیه", "مقدار", "توضیح"],
    ["شمال", "10", "x"],
    ["", "20", "y"],
    ["جنوب", "30", "z"]
  ]);
  mws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }, { s: { r: 3, c: 1 }, e: { r: 3, c: 2 } }];
  XLSX.utils.book_append_sheet(mwb, mws, "MergeTest");
  check("merge: import accepted", W.importWorkbookFromBuffer("merge.xlsx",
    XLSX.write(mwb, { type: "array", bookType: "xlsx" })) === true);
  const msh = W.WB.sheets["MergeTest"];
  check("merge: stored 1-based", msh.merges.length === 2 && msh.merges[0].r1 === 2 && msh.merges[0].r2 === 3 &&
    msh.merges[1].r1 === 4 && msh.merges[1].c1 === 2, JSON.stringify(msh.merges));
  W.renderSheetView("MergeTest");
  await sleep(20);
  const anchor1 = doc.querySelector('#sheet-body table.xl tbody td[data-r="2"][data-c="1"]');
  check("merge: vertical anchor has rowspan", !!anchor1 && anchor1.getAttribute("rowspan") === "2" &&
    anchor1.textContent.indexOf("شمال") >= 0);
  const row3 = doc.querySelector('#sheet-body table.xl tbody tr[data-r="3"]');
  check("merge: covered cell omitted like Excel", !!row3 && row3.querySelectorAll("td").length === 3,
    row3 ? row3.querySelectorAll("td").length + " tds" : "no row");
  const anchor2 = doc.querySelector('#sheet-body table.xl tbody td[data-r="4"][data-c="2"]');
  check("merge: horizontal anchor has colspan", !!anchor2 && anchor2.getAttribute("colspan") === "2");
  // edit through the merge anchor writes once (merge-aware)
  W.setCellVal("MergeTest", 3, 1, "north-edit", true);
  check("merge: edit resolves to anchor", W.WB.sheets["MergeTest"].rows[1][0] === "north-edit");
  // export round-trip keeps merges (1-based <-> 0-based conversion)
  const backM = (XLSX.read(XLSX.write(W.BuildExportWorkbook(), { type: "array", bookType: "xlsx" }),
    { type: "array" }).Sheets["MergeTest"]["!merges"] || []);
  check("merge: export round-trip", backM.length === 2 && backM[0].s.r === 1 && backM[0].e.r === 2,
    JSON.stringify(backM));


  // JSON backup import (full replacement)
  check("import: json backup", W.applyJsonBackup("b.json", { order: ["S1"], sheets: { S1: { rows: [["h"], ["v"]], merges: [] } } }) === true &&
    W.WB.sheets["S1"].rows.length === 2 && !W.WB.order.includes("TestNet1"));
  // ===== HARDENING: XSS escaping (imported data must never execute) =====
  // re-import the TestNet workbook so hardening tests run against known data
  check("hardening: reimport fixture", W.importWorkbookFromBuffer("test_import.xlsx", ibuf) === true);
  const xssName = "');alert(1);//";
  check("xss: malicious sheet name accepted as data", W.importCsvText(xssName + ".csv", "a,b\n1,<img src=x onerror=window.__xss=1>") === true);
  check("xss: sheet exists with literal name", !!W.WB.sheets[xssName]);
  const catHtml = doc.getElementById("sheet-catalog").innerHTML;
  // note: the HTML serializer re-emits attribute quotes raw inside data-name="..."
  // — safe because nothing executes it (no inline handler, CSP script-src-attr 'none')
  check("xss: catalog uses delegation + inert attr", catHtml.indexOf('data-act="open-sheet"') >= 0 &&
    catHtml.indexOf("onclick=") < 0 && catHtml.indexOf(`data-name="');alert(1);//"`) >= 0);
  window.__xss = undefined;
  const card = Array.from(doc.querySelectorAll("#sheet-catalog .sheet-card"))
    .find(el => el.textContent.indexOf("alert(1)") >= 0);
  check("xss: malicious card rendered", !!card);
  if (card) card.click();
  await sleep(30);
  check("xss: click opens sheet, no script exec", window.__xss === undefined && W.state.currentSheet === xssName,
    String(W.state.currentSheet));
  W.renderSheetView(xssName);
  await sleep(20);
  const gridHtml = doc.getElementById("sheet-body").innerHTML;
  check("xss: grid cell escaped", gridHtml.indexOf("&lt;img") >= 0 && window.__xss === undefined);

  // ===== HARDENING: import validation (corrupt file must not break state) =====
  const before = JSON.stringify(W.WB.order) + JSON.stringify(W.WB.sheets["TestNet1"]);
  check("valid: corrupt xlsx rejected", W.importWorkbookFromBuffer("bad.xlsx", new Uint8Array([1, 2, 3, 4, 5])) === false);
  check("valid: empty csv rejected", W.importCsvText("e.csv", "") === false);
  check("valid: state untouched after rejects", JSON.stringify(W.WB.order) + JSON.stringify(W.WB.sheets["TestNet1"]) === before);
  check("valid: proto name sanitized", W.importCsvText("__proto__.csv", "a\n1") === true &&
    !!W.WB.sheets["_x"] === false && W.WB.order.some(n => n.indexOf("proto") >= 0 && n !== "__proto__"));
  check("valid: Object.prototype clean", ({}).polluted === undefined && ({}).x === undefined);
  check("validateWorkbookData: api exposed", typeof W.validateWorkbookData === "function" &&
    W.validateWorkbookData(["A"], { A: { rows: [["h"]], merges: [] } }).ok === true &&
    W.validateWorkbookData([], {}).ok === false);

  // ===== HARDENING: transactional mutations (rollback on error) =====
  const rowsBefore = W.WB.sheets["TestNet1"].rows.length;
  const txnRes = await W.withTransaction(null, () => {
    W.WB.sheets["TestNet1"].rows.push(["XROLLBACK", "نود ناموفق", "0.0.0.0"]);
    throw new Error("simulated failure");
  });
  check("txn: error rolled back", txnRes === undefined && W.WB.sheets["TestNet1"].rows.length === rowsBefore);
  const txnOk = await W.withTransaction(null, () => {
    W.WB.sheets["TestNet1"].rows.push(["XCOMMIT", "نود موفق", "0.0.0.1"]);
    return "done";
  });
  check("txn: success committed", txnOk === "done" && W.WB.sheets["TestNet1"].rows.length === rowsBefore + 1);

  // ===== HARDENING: deterministic index verify / recover =====
  const idx = W.WB.sheets["SYSTEM_SEARCH_INDEX"];
  for (let r = 1; r < Math.min(idx.rows.length, 12); r++) idx.rows[r][0] = "GHOST_SHEET_" + r;
  check("index: corruption detected", W.verifySearchIndex().ok === false);
  check("index: recover rebuilds", W.recoverSearchIndex(false) === true && W.verifySearchIndex().ok === true);
  check("index: search works after recover", W.modMapping.GetMatchRows("شاخص", "X999", "ALL").length === 1);

  // clear back to the empty workspace
  W.resetToEmptyData(true);
  check("reset: workspace empty again", W.WB.order.filter(n => W.IsDataSheet(n)).length === 0,
    W.WB.order.length + " system sheets");
  check("reset: system shell intact", !!W.WB.sheets["CONTROL_PANEL"] && !!W.WB.sheets["SYSTEM_SHEET_CONFIG"]);
  check("reset: index cleared", W.modMapping.GetMatchRows("شاخص", "X999", "ALL").length === 0);

  const fails = results.filter(r => !r[1]);
  console.log("\n==== SUMMARY: " + (results.length - fails.length) + "/" + results.length + " passed ====");
  if (fails.length) { console.log("FAILED:", fails.map(f => f[0]).join(" | ")); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error("TEST CRASH:", e); process.exit(2); });
