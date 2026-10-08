#!/usr/bin/env node
/*
 * Playwright smoke tests — REAL headless Chromium (not jsdom).
 * Proves browser-level behavior of Mohsen_FINAL_v5.html:
 *   - CSP meta is enforced (script-src-attr 'none' really blocks inline handlers)
 *   - zero inline event handlers in the DOM
 *   - the OS file dialog really opens on IMPORT (regression)
 *   - xlsx import renders merged cells like Excel (rowspan/colspan)
 *   - macros run on the imported data
 *   - XSS payloads in imported sheet names/cells stay inert
 *   - EMPTY DATA restores the blank workspace
 *
 * Run:  cd src/e2e && npm install && npm test
 * On machines with Chrome/Edge installed you can skip the bundled
 * Chromium:  CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm test
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(__dirname, "fixtures", "sample.xlsx");

// ---------- tiny check harness ----------
const results = [];
function check(name, cond, extra) {
  results.push([name, !!cond]);
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra !== undefined ? "  [" + extra + "]" : ""));
}

// ---------- static server (repo root) ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".json": "application/json" };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let file = path.join(ROOT, urlPath === "/" ? "Mohsen_FINAL_v5.html" : urlPath);
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(buf);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

// ---------- browser bootstrap ----------
async function launchBrowser() {
  let executablePath = process.env.CHROME_PATH || "";
  let args = ["--no-sandbox", "--disable-dev-shm-usage", "--headless=new"];
  if (!executablePath) {
    // bundled headless Chromium (works on bare Linux containers too)
    process.env.AWS_EXECUTION_ENV = process.env.AWS_EXECUTION_ENV || "AWS_Lambda_nodejs22.x";
    const lambdafs = require("@sparticuz/chromium/build/lambdafs.js").default;
    const chromium = require("@sparticuz/chromium");
    const binDir = path.dirname(require.resolve("@sparticuz/chromium/package.json"));
    for (const lib of ["al2023.tar.br", "al2.tar.br"]) {
      await lambdafs.inflate(path.join(binDir, "bin", lib)).catch(() => {});
    }
    process.env.LD_LIBRARY_PATH = "/tmp/al2023/lib:/tmp/al2/lib:" + (process.env.LD_LIBRARY_PATH || "");
    executablePath = await chromium.executablePath();
    // NOTE: deliberately NOT using chromium.args — --disable-web-security would
    // weaken the very CSP we want to prove here.
    args = ["--no-sandbox", "--disable-dev-shm-usage", "--headless=new", "--hide-scrollbars", "--mute-audio"];
  }
  const { chromium: pw } = require("playwright-core");
  return pw.launch({ executablePath, args, headless: true });
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const base = "http://127.0.0.1:" + port + "/Mohsen_FINAL_v5.html";
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const pageErrors = [], dialogs = [], cspViolations = [];
  page.on("pageerror", e => pageErrors.push(String(e && e.message || e)));
  page.on("dialog", async d => { dialogs.push(d.message()); await d.dismiss().catch(() => {}); });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", e => {
      window.__cspViolations = (window.__cspViolations || []).concat([e.violatedDirective + " " + e.blockedURI]);
    });
  });

  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.waitForSelector("#dash-cats", { timeout: 15000 });

    // ---- 1. empty start + shell ----
    check("load: page title", (await page.title()).indexOf("NetScope") >= 0);
    check("load: empty-state import CTA", await page.isVisible("#dash-cats .empty-state"));
    check("load: no data sheets at boot", await page.evaluate(() => WB.order.filter(n => IsDataSheet(n)).length) === 0);

    // ---- 2. CSP present ----
    const csp = await page.evaluate(() => {
      const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return m ? m.content : "";
    });
    check("csp: meta present with script-src-attr 'none'", csp.indexOf("script-src-attr") >= 0 && csp.indexOf("'none'") >= 0);

    // ---- 3. CSP really enforced in THIS browser ----
    await page.evaluate(() => {
      window.__csp = undefined;
      const d = document.createElement("div");
      d.id = "csp-probe";
      d.setAttribute("onclick", "window.__csp='EXECUTED'");
      d.textContent = "probe";
      document.body.appendChild(d);
    });
    await page.click("#csp-probe");
    const cspExecuted = await page.evaluate(() => window.__csp);
    const violations = await page.evaluate(() => window.__cspViolations || []);
    check("csp: inline attribute handler truly blocked", cspExecuted === undefined, String(cspExecuted));
    check("csp: violation event raised", violations.length >= 1, violations.length + "");
    await page.evaluate(() => { const p = document.getElementById("csp-probe"); if (p) p.remove(); });

    // ---- 4. zero inline handlers in the DOM ----
    const inlineList = await page.evaluate(() => {
      const found = [];
      document.querySelectorAll("*").forEach(el => {
        for (const a of el.attributes) if (/^on[a-z]+$/i.test(a.name)) found.push(el.tagName + "[" + a.name + "]");
      });
      return found;
    });
    check("dom: zero inline event handlers", inlineList.length === 0, inlineList.join(","));

    // ---- 5. the OS file dialog really opens (browser-level regression) ----
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 8000 });
    await page.click("[data-act='open-file']");
    let chooserOpened = true;
    let chooser = null;
    try { chooser = await chooserPromise; } catch (e) { chooserOpened = false; }
    check("filepicker: OS file dialog opens on IMPORT", chooserOpened);

    // ---- 6. xlsx import (via the very same filechooser) ----
    if (chooser) await chooser.setFiles(FIXTURE);
    await page.waitForFunction(() => WB.order.indexOf("SampleNet") >= 0, { timeout: 15000 });
    check("import: sheets loaded", await page.evaluate(() => WB.order.filter(n => IsDataSheet(n)).length) === 2);
    check("import: dashboard CTA replaced by category tiles", !(await page.isVisible("#dash-cats .empty-state")));

    // ---- 7. merged cells render exactly like Excel ----
    await page.evaluate(() => { switchView("sheet"); openSheetCard("SampleNet"); });
    await page.waitForSelector("#sheet-body table.xl", { timeout: 10000 });
    const mergeInfo = await page.evaluate(() => {
      const anchor = document.querySelector('#sheet-body table.xl tbody td[data-r="2"][data-c="1"]');
      const row3 = document.querySelector('#sheet-body table.xl tbody tr[data-r="3"]');
      return {
        rowspan: anchor ? anchor.getAttribute("rowspan") : null,
        anchorText: anchor ? anchor.textContent : "",
        row3tds: row3 ? row3.querySelectorAll("td").length : -1
      };
    });
    check("merge: anchor has rowspan=2 like Excel", mergeInfo.rowspan === "2" && mergeInfo.anchorText.trim() === "1",
      JSON.stringify(mergeInfo));
    // row 3 = rn + 3 visible cells (col A omitted by the merge) on this 4-column sheet
    check("merge: covered cell omitted (rn + 3 cols)", mergeInfo.row3tds === 4, String(mergeInfo.row3tds));
    const row3First = await page.evaluate(() => {
      const tds = document.querySelectorAll('#sheet-body table.xl tbody tr[data-r="3"] td');
      return tds.length > 1 ? tds[1].getAttribute("data-c") : null;
    });
    check("merge: row 3 starts at column B (A covered)", row3First === "2", String(row3First));

    // ---- 8. macros run on the imported data ----
    const hits = await page.evaluate(() => ({
      byKey: modMapping.GetMatchRows("شاخص", "2", "ALL").length,
      byFullText: modMapping.GetMatchRows("FULLTEXT", "تبریز", "ALL").length
    }));
    check("macros: search engine finds imported rows", hits.byKey === 1 && hits.byFullText === 1,
      JSON.stringify(hits));
    const pill = await page.$("#cat-bar [data-act='set-filter']:not([data-cat='all'])");
    if (pill) await pill.click();
    const filtered = await page.evaluate(() => state.catFilter);
    check("ui: category filter delegation works", filtered && filtered !== "all", String(filtered));

    // ---- 9. XSS payloads from imported data stay inert ----
    await page.evaluate(() => { switchView("sheet"); setCatFilter("all"); window.__xss = undefined; });
    const card = await page.$("#sheet-catalog .sheet-card[data-name*=alert]");
    check("xss: malicious sheet card rendered as data", !!card);
    if (card) await card.click();
    await page.waitForTimeout(300);
    const xssState = await page.evaluate(() => ({ cur: state.currentSheet, xss: window.__xss }));
    check("xss: card click opens sheet, nothing executes", xssState.xss === undefined && /alert/.test(String(xssState.cur)),
      JSON.stringify(xssState));
    const gridHasImg = await page.evaluate(() => document.getElementById("sheet-body").innerHTML.indexOf("&lt;img") >= 0);
    check("xss: cell payload rendered escaped in grid", gridHasImg);
    check("xss: no JS dialog ever fired", dialogs.length === 0, dialogs.join(" | "));

    // ---- 9.5 persistence: Save button + REAL reload keeps data and sheet ----
    await page.evaluate(() => { switchView("sheet"); openSheetCard("SampleNet"); });
    await page.waitForSelector("#sheet-body table.xl", { timeout: 5000 });
    await page.click("[data-act='save-now']");
    await page.waitForTimeout(600);
    const saveInfo = await page.evaluate(async () => {
      const p = typeof readStoredState === "function" ? readStoredState() : null;
      const ui = typeof loadUIState === "function" ? loadUIState() : null;
      let deep = null;
      try { deep = typeof idbGet === "function" ? await idbGet() : null; } catch (e) {}
      return {
        saved: !!p && p.order.indexOf("SampleNet") >= 0,
        compressed: (localStorage.getItem("Mohsen_FINAL_v5_state_v2") || "").charCodeAt(0) === 0xFFFC,
        deepSaved: !!deep && Array.isArray(deep.order) && deep.order.indexOf("SampleNet") >= 0,
        indicator: ((document.getElementById("save-indicator") || {}).textContent || ""),
        uiSheet: ui ? ui.sheet : ""
      };
    });
    check("save: Save button persists data + indicator updated",
      saveInfo.saved && saveInfo.compressed && saveInfo.indicator.indexOf("ذخیره‌شده") === 0 && saveInfo.uiSheet === "SampleNet",
      JSON.stringify(saveInfo));
    check("save: deep IndexedDB mirror written", saveInfo.deepSaved === true, String(saveInfo.deepSaved));

    await page.reload({ waitUntil: "load" });
    // boot is async (Workbook_Open + index verify) — wait for the view restore itself
    let restoredView = true;
    try {
      await page.waitForFunction(
        () => state.currentSheet === "SampleNet" &&
              document.querySelectorAll("#sheet-body table.xl tbody tr").length > 0,
        { timeout: 15000 });
    } catch (e) { restoredView = false; }
    const afterReload = await page.evaluate(() => ({
      sheets: WB.order.filter(n => IsDataSheet(n)).length,
      sheet: state.currentSheet,
      view: document.getElementById("view-sheet").classList.contains("active"),
      rows: document.querySelectorAll("#sheet-body table.xl tbody tr").length
    }));
    check("save: reload restores data and lands on the same sheet",
      restoredView && afterReload.sheets === 2 && afterReload.sheet === "SampleNet" && afterReload.view === true && afterReload.rows > 0,
      JSON.stringify(afterReload) + " restoredView=" + restoredView);

    // ---- 10. EMPTY DATA restores blank workspace ----
    await page.evaluate(() => resetToEmptyData());
    await page.waitForSelector("#modal-overlay .mbox", { timeout: 5000 });
    await page.click("#modal-overlay .mbox .f button[data-id='6']");
    await page.waitForFunction(() => WB.order.filter(n => IsDataSheet(n)).length === 0, { timeout: 10000 });
    await page.evaluate(() => switchView("panel"));
    await page.waitForTimeout(200);
    check("reset: workspace empty again", await page.isVisible("#dash-cats .empty-state"));

    // ---- 11. overall page health ----
    check("health: no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
    const finalViolations = await page.evaluate(() => window.__cspViolations || []);
    const unexpected = finalViolations.filter(v => v.indexOf("script-src-attr") < 0);
    check("health: no unexpected CSP violations", unexpected.length === 0, unexpected.join(" | "));
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }

  const fails = results.filter(r => !r[1]);
  console.log("\n==== SMOKE SUMMARY: " + (results.length - fails.length) + "/" + results.length + " passed ====");
  if (fails.length) { console.log("FAILED:", fails.map(f => f[0]).join(" | ")); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error("SMOKE CRASH:", e); process.exit(2); });
