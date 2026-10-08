# innerHTML Audit — FINAL CLASSIFICATION

**Status: COMPLETE.** All 31 catalogued `innerHTML` sites in the app sources have been
converted to DOM APIs or eliminated. `innerHTML`/`insertAdjacentHTML`/`outerHTML`/`document.write`
now appear **nowhere** in `src/{core,ui,macros,data,storage}.js` — the only remaining
occurrences in the deliverable are inside the minified third-party vendor bundle
(`src/vendor/xlsx.full.min.js`), which is out of scope (see *Exceptions* below).

A regression guard keeps it that way: the jsdom suite asserts the absence of
HTML-family sinks in every app source file on every run
(`dom-api: zero innerHTML-family calls in app sources`,
`dom-api: no HTML-string modal path (opts.html/trustedHtml gone)`).

## How the conversion was done (commit history)

| # | Commit | Scope |
|---|--------|-------|
| 1 | `6b373ac` | Shared DOM builder utilities (`el`/`txt`/`sEl`/`button`/`frag`/`clear`/`textBlock`); modal rendering (`ModalBox`, `Toast`, `SectionPicker`, `WizardAddForm`, add-form) → nodes; new `opts.contentNode` |
| 2 | `0de6ae3` | Sheet grid (`renderSheetView`) → table nodes with exact merge semantics (rowspan/colspan, boundary clamping, covered-cell omission, `data-r`/`data-c` contracts) |
| 3 | `1e6802c` | Search results (`renderResultsView`) → match-block nodes (`data-match`, `data-srcrow`, `input.cell-in[data-ri][data-ci]` + `.value`) |
| 4 | `789c6a6` | Change log (`renderLogView`) + sheet navigator (cards keep `data-act="nav-sheet"` + `data-name`); icon geometry → `CAT_ICON_SHAPES` data + `catSvgNode`; **`opts.trustedHtml` removed entirely** |
| 5 | `77b01a9` | Low-risk batch: KPI cards, donut+legend, bars, feed, empty states (`emptyStateNode`), dashboard tiles, category pills, sheet catalog, macro catalog |
| 6 | this commit | Dead `escapeHtml`/`escapeHtmlAttr` removed; DoD guards added to tests; this document |

## `opts.html` — resolved (not merely renamed)

The modal API's `opts.html` string channel is **gone**. `ModalBox` now accepts only
`opts.text` (plain text, newline-aware) and `opts.contentNode` (a pre-built DOM node).
A transitional `opts.trustedHtml` existed for exactly one commit (`6b373ac`→`789c6a6`)
while the navigator was converted; it was then deleted rather than documented as an
exception — no HTML-string modal path remains.

## Semantic parity contracts preserved (all verified green after every commit)

- **Event delegation**: `ACTIONS` dispatch via `data-act` — `nav-sheet`, `open-sheet`,
  `set-filter`, `open-category`, `open-file`, `show-more-rows`, `run-macro-index`,
  `show-vba`, `download-module` all keep identical attribute names/values.
- **Dataset values**: `data-name`, `data-cat`, `data-mod`, `data-match`, `data-srcrow`,
  `data-ri`, `data-ci`, `data-r`, `data-c` unchanged (SaveChanges/blur-edit read them).
- **Row/col mapping + merged cells**: engine 1-based coords, anchor renders
  `rowspan=min(r2,limit)`/`colspan=min(c2,maxC)`, covered cells omitted — Excel-identical.
- **Undo sync**: every write path still goes through `setCellVal`/transaction layer;
  rendering change touches no data flow.
- **Structural CSS contracts**: `.mbox .t .c .f`, `#modal-input`, `.x` close,
  `.match-block/.block-table/.cell-in`, `table.xl`, `.logtable/.act-badge`,
  `.nav-card/.nav-group-head`, `.cat-pill/.cat-tile/.sheet-card`, `.kpi`, `.li/.sw/.vv`,
  `.feed-item`, `.empty-state` — identical class hooks.

## Exceptions (justified)

| Location | Why it stays |
|----------|--------------|
| `src/vendor/xlsx.full.min.js` (SheetJS, minified) | Third-party library, vendored as-is. Its internal `innerHTML` use is in its own HTML/CSV serialization helpers; user data reaching it is written as cell values via the SheetJS API, never as HTML page content. We do not modify vendor bundles. |

No other exceptions remain. App-owned rendering is 100% DOM-API based.

## Rendering convention (for future code)

```js
el(tag, attrs, ...children)   // HTML elements; attrs: text/class/style{}/value/data-*/on*
sEl(tag, attrs, ...children)  // SVG elements (same attrs)
button(label, attrs)          // <button> with text label
frag(...children)             // DocumentFragment
clear(node)                   // empty a container
textBlock(str)                // plain multi-line text -> nodes with <br>
catSvgNode(cat, cls)          // category icon SVG from CAT_ICON_SHAPES data
```

Data strings only ever land in `textContent`, `setAttribute`, `.value` or `.style` —
never in HTML parsing. Do not reintroduce `innerHTML` in app sources (the test suite
enforces this).

## Original site inventory (historical — for traceability)

All 31 sites from the first audit are closed. Breakdown by class:

| Class | Count | Disposition |
|-------|-------|-------------|
| Sheet grid renderer (`renderSheetView`) | 2 | converted (`0de6ae3`) |
| Search results renderer (`renderResultsView`) | 2 | converted (`1e6802c`) |
| Change log renderer (`renderLogView`) | 2 | converted (`789c6a6`) |
| Modals (`ModalBox`, `Toast`, `SectionPicker`, `WizardAddForm`, add-form, form builder) | 7 | converted (`6b373ac`) |
| Navigator + category UI (cards, pills, tiles, catalog) | 8 | converted (`789c6a6` + `77b01a9`) |
| Dashboard (KPI, donut, legend, bars, feed) | 5 | converted (`77b01a9`) |
| Macro catalog + empty states + clear-only sites (`sel.innerHTML=""`) | 5 | converted (`77b01a9`) |
| `opts.html` string channel | 1 | replaced by `opts.contentNode`; transitional `trustedHtml` deleted (`789c6a6`) |
