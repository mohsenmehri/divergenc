# LOCAL equipment inventory — attribute-based groups (v3)

## Scope

Offline UI only, embedded into root `FAM.html`. SERVER builds, SSH, real authentication and device/recovery implementations are unchanged. Never enter real RADIUS credentials into this preview.

This replaces the previous fixed nested hierarchy. A node is stored **once**; overlapping group memberships derive from independent attributes, not duplicated records or a single nested path.

## Model

`src/equipment-inventory.js` exposes the pure `FamEquipmentInventory` API. `src/equipment-local-preview.js` owns UI state, persistence, the RAM-only RADIUS gate and simulated Device 360. Sources and CSS are embedded by `scripts/embed_local_access.py`, with the inventory model before its UI consumer.

Persistence key: `fam.equipment.inventory.v3`.

- Catalogs: `types`, `models` (parent `typeId`), `regions`, `siteKinds`, `sites` (parent `siteKindId`).
- Canonical nodes: stable `id`, `name`, private IPv4 `host`, `typeId`, `modelId`, `regionId`, `siteKindId`, `siteId`; migrated nodes may also retain `legacyPath`.
- No authentication fields, commands, network state or simulated credentials are persisted in this schema.
- Add/edit requires every attribute. Nullable references exist only for migrated or intentionally unassigned nodes; they are shown as needing completion.
- A model must belong to the selected type; a site must belong to the selected site kind.
- Duplicate IP is blocked globally on add/edit. Pre-existing legacy duplicates are preserved, not merged or discarded.
- Names and private IPs are validated; catalog IDs and parent references are checked; UI renders user content as text, never raw HTML.

Defaults:

- Types: router / switch.
- Models: router 1841, router 1300, switch 2960 (editable user-requested examples, not device detection).
- Regions: 1–4, editable; users can define a different region for locations outside those areas.
- Site kinds include branch, office building and datacenter, plus legacy area/storage/other defaults.
- Buildings: «ساختمان مرکزی رضوان», «ساختمان 68 شرقی فام», «ساختمان 68 شرقی ملل», «ساختمان 68 شرقی شرکت ها», «ساختمان مرکزی فام», «ساختمان ملاصدرا فام».
- Datacenters: تهران / سمنان. Actual branch sites are user-defined, not guessed.

## UI behavior

Six group views: type, model, region, site kind, buildings and datacenters; plus all nodes. Category cards show total membership. Selecting cards applies intersecting (AND) filters. Global filter reset returns to the entire inventory.

Node creation from a category preselects that category and its parent references, while prompting for every remaining attribute. General creation can also inherit selected filters. Users can define a model or a specific site inline; both catalog and node are validated/saved together.

The catalog dialog provides create/rename/delete. Stable IDs make renames visible everywhere without rewriting nodes. Removal is rejected while a category is referenced by nodes or dependent models/sites. There is no cascading deletion of equipment.

Node edit automatically reclassifies the existing node. **Remove from category** clears only the active category reference and dependent reference where necessary (type→model, site kind→site), retaining the node in needs-completion. **Delete node** requires confirmation and removes it globally. Neither action changes real equipment.

Clicking a node name opens Device 360 and starts its bounded **simulated** check automatically. Simulated recovery still requires explicit device/port confirmation. Real Local/Enable commands, command favorites and free-form execution remain inactive.

## Compact user-managed overview cards

The six initial overview cards are editable display shortcuts, no longer a fixed display-only set. Cards are roughly half their old height (about 105px instead of 205px), with six columns on wide displays, three on medium and two on mobile. Long names are clamped with a full hover title so cards remain compact.

Each card has inline **edit/delete** controls; **add card** is always available even when all cards have been removed. The editor asks for a display name, one of the six existing grouping axes, and optionally one specific category within that axis. For example, a user can create a shortcut directly to region 1, router model 1841 or a named building. These are shortcuts to existing attributes/categories, not new schema dimensions.

Clicking a card opens its target with fresh filters; model/site targets also select their required parent. Deleting/renaming/retargeting a card never changes node or catalog data. Standard grouping tabs remain available even after all cards are deleted.

Preferences use a separate validated localStorage key, `fam.equipment.cards.v1` (`version:1`, maximum 60 cards, stable ID/name/facet/optional category reference). They contain no credentials. An explicitly empty list stays empty after reload; defaults are only used when no preferences exist. Malformed stored preferences are not overwritten; a warning disables editing while keeping inventory accessible. Failed writes leave both preferences and inventory unchanged. A stale target after category deletion is retained and opens the card editor for explicit repair, not a silently different filter.

Pure tests cover schema bounds/types, empty/custom cards and stripping unrelated fields. Browser tests cover compact desktop/mobile sizing, add/edit/confirmed and cancelled deletion, reload persistence, specific-category navigation, unchanged inventory, malformed preference handling and failed writes.

## Direct compact category controls

Actual category cards (types, models, regions, site kinds, buildings and datacenters) are now roughly 80–90px high instead of 160–170px, with four columns on wide screens and two on mobile. Each has direct add-node/edit/delete controls; the header has **add subcategory** and the existing full catalog manager.

Edit opens the catalog form with the actual stable-ID record preloaded. New buildings/datacenters preselect the appropriate site kind; new models inherit a selected type filter. Rename/save continues to validate all parent relationships. Direct deletion uses the same non-cascading `removeCategory` model operation: explicit confirmation, in-use/dependency rejection, visible localized error, no node removal. Storage-error/read-only mode disables these actions.

## Post-login workspace selection

`src/workspace-launcher.js` / `.css` provide a full-screen native modal dialog, shown **after** normal authenticated application bootstrap and before the user enters either workspace. It has two choices: database (`panel`, the existing dashboard) and equipment (`equipment`, the existing equipment page). The chosen view is explicit even if an old sheet/view was restored in the background. No separate application account, network endpoint or new persistent session is introduced.

The choices have hover/focus growth, accent glow, native keyboard focus containment, visible labels, mobile stacking and reduced-motion support. Unavailable choices are disabled according to `Access.viewAllowed`; navigation rechecks permissions and uses the application's existing tab handlers. Escape does not bypass the initial choice; logout remains available even when neither section is authorized. Opening the chooser locks background page scrolling; choosing a section restores it. On mobile, selecting a workspace closes the sidebar so it does not obscure the page.

The database dashboard now has an explicit equipment switch and equipment has an explicit database switch. Both include a return-to-chooser button. Navigation stays within the current FAM account and does not clear the equipment RADIUS closure. Main logout and refresh still clear that RAM-only credential state. SERVER is not rebuilt or modified for this local UI change.

Browser coverage exercises both entry choices, hover/keyboard/escape behavior, mobile/reduced motion, account restrictions, direct category CRUD for all six axes, dependency protection, persistence, and RADIUS retention across direct/chooser round trips. That release passed 60 tests; the subsequent configuration-planner release passed the 74-test complete local suite.

## Group configuration planner (LOCAL dry-run only)

`src/equipment-configuration.js` contains pure planning/validation functions and an isolated UI controller factory. The model is embedded after `FamEquipmentInventory` and before the equipment UI consumer. The equipment page has inventory/configuration/tools tabs and a **configure this selection** shortcut that copies only the five explicit category filters (not the name/IP search or needs-completion toggle).

The command textarea is multiline, monospace and RAM-only. There is deliberately **no executor**, SSH/API call, logging, browser storage, export or real configuration save. This separate draft planner does not expand the constrained Device360 recovery path or the unchanged SERVER implementation. It performs size/control-character checks only, not Cisco syntax, command safety or hardware compatibility validation. Never enter real secrets/configuration.

Targeting supports 1–12 groups. Attributes within a group use AND; groups use OR. Examples: router + region 2, or router/model 1841, or switch/model 2960. Model/site selections preselect their required type/site-kind parents. Empty groups, unknown/removed references, parent conflicts and unknown filter keys fail closed instead of broadening to all equipment.

Planning validates/copies the canonical inventory, unions matching nodes once by stable ID, excludes incomplete nodes with a visible count, and rejects a target whose IP is duplicated anywhere in inventory—even if the conflicting record is outside the selected groups. It never modifies inventory or catalogs. Target previews page by 25; confirmation lists every exact target in a scrollable list and requires an explicit acknowledgment. Empty commands or zero eligible nodes cannot be confirmed.

The confirmation snapshot binds the exact draft, revision, rules, inventory metadata and targets. Confirmation revalidates authorization, text and the live inventory signature; changes require another review. A successful dry-run sets only a RAM-only marker, visibly labeled **simulated / no send** on each node; it is not a successful device deployment. Any draft/rule edit invalidates previous outcomes. Navigation closes outstanding confirmation dialogs without clearing the draft. Main logout, account-bound RADIUS reset and page unload/refresh clear drafts/rules/outcomes together with RAM credentials. In-page inventory/database navigation retains them.

Limits: 12,000 characters, 120 lines, 512 characters per line; terminal and bidi controls are rejected. No command text is included in returned plan/validation summaries, persisted app data, or diagnostics.

Tests: `equipment-configuration-model.test.cjs` covers exact AND/OR scope, deduplication, empty/stale/invalid conditions, incomplete nodes, duplicate IP, immutable snapshots/signatures, draft bounds and absence of I/O/execution adapters. `equipment-configuration.test.cjs` covers the real standalone-file editor, multi-group targeting, pagination, review/cancel/acknowledgment, no inventory mutation or secret persistence/network requests, outcome invalidation, RAM lifecycle, prefilled filters, textarea size and mobile themes. That configuration release passed **74 local regression tests**.

## Equipment tools and dynamic Excel

`src/equipment-tools-model.js` provides pure import planning, standard validation/literal checks explicit switch scenarios and exact per-port recovery review plans. `src/equipment-excel.js` builds/reads XLSX using the bundled SheetJS library; `src/equipment-tools.js` owns the tools UI. The embedding order is inventory → tools model → Excel → controller → equipment consumer. No external assets, ZIP library, network adapter or executor is added.

### Current-catalog form, not a distributed static template

In **equipment → tools → Excel**, use **دریافت فرم ورود از دسته‌های فعلی** after editing categories. Every click reads the live canonical inventory and builds a new workbook:

- `تجهیزات`: empty input table, or all current nodes with IDs for inventory export, independent of UI filters.
- `راهنما`: filling/import/update instructions, limits and generation time.
- `دسته‌ها`: exact current readable names, kinds and parent names for all five catalog dimensions.
- `مثال`: synthetic examples derived only from currently available, compatible catalogs. Deleted defaults are not resurrected; empty catalogs produce no guessed examples.
- Hidden `فهرست‌ها`: generated named ranges, type→model/kind and site-kind→site/pattern mappings, plus current node IDs.
- Hidden `اطلاعات قالب`: versioned canonical snapshot of catalog IDs, names, kinds and parents, sorted independently of UI order.

List dropdowns cover rows 2–4001 with explicit `errorStyle="stop"`, `showErrorMessage="1"` and visible arrows. All seven classification fields use current permitted values; models and type kinds depend on the type, and sites and site patterns depend on the site-kind. Pattern dropdowns contain only the one compatible kind, not a global enum. The eighth rule restricts nonblank node IDs to existing IDs; new rows leave that field blank. Required classification lists have `allowBlank="0"`; ID allows blank. Name and IP remain user-entered and are fully validated on import. Excel paste/delete can bypass workbook validation: importer checks are the actual enforcement boundary, not the dropdowns. They use generated safe named ranges rather than category text as formulas/names. SheetJS CE does not write validations, so the encoder updates the existing worksheet ZIP entry with standard OOXML `dataValidations` using its bundled CFB API. Device rows remain literal values, never formulas. The original worksheet entry is replaced, not duplicated.

Workflow: download the latest form → fill equipment rows → select the XLSX → inspect errors/preview → explicitly confirm. The exact current catalog snapshot is checked before import planning, independently of any legacy caller option. Renames, additions, deletions or changed parents invalidate an older file; receive a fresh form and move only the equipment rows across. Missing/edited metadata is rejected. Node-only changes do not stale the catalog form. This is accidental-staleness/compatibility detection, **not a cryptographic signature or trusted-file boundary**. No authoritative standalone `.xlsx` is included in the release; the familiar template filename is generated afresh in the user's app.

Import is real local metadata CRUD, not a device simulation. Limits: `.xlsx`, 5 MiB, 4000 input rows / 10 columns; formulas in equipment or catalog metadata are rejected, and oversized declared ranges fail closed. All required attributes/private IPv4/parents/kinds are validated. Blank rows are ignored. Unknown categories are always rejected, including when a retired `createCategories` option is supplied. The category-creation checkbox/path is removed: define categories in the app and download a fresh form first. Nodes are committed atomically only after all rows pass. Unknown nonblank node IDs are rejected rather than introducing user-supplied identifiers. Existing nodes require explicit update mode; stable IDs are retained, ambiguous ID/IP targets and duplicate input IPs are rejected. Nodes absent from the file are never deleted. A changed inventory between preview/confirmation requires re-preview. A failed storage write leaves the old canonical inventory and catalogs unchanged. Export carries the same current snapshot for the supported edit→re-import round trip; incomplete exported nodes must be completed before re-import.

### Standards and checklist

A standard has a stable ID, name, router/switch model, optional site-kind/site restriction and 1–50 checklist items (exact trimmed line, substring present or substring absent; not a Cisco parser). Up to 100 definitions / 1000 total items are validated and saved under `fam.equipment.standards.v1`, with known credential/key/token patterns blocked. This is not a general secret detector: only synthetic non-sensitive policy text belongs here. Deleted category references remain visible for explicit repair, not silent retargeting. Corrupt storage is not reset/overwritten; definition editing/check execution is disabled visibly.

Choose a node and provide synthetic observed configuration (≤12,000 characters). Applicable model/location policies produce per-item pass/fail/unknown. Blank text is unknown; no applicable policy is not a passing audit. Reports/Excel contain source, node metadata, standard/check titles, outcome and timestamp, never the raw input. Input edits, node/standard changes invalidate the prior report. Observed text, draft definitions and reports are RAM-only.

### Switch-only Err-disabled scenarios

Only canonical type kind `switch` qualifies; changing the displayed type name cannot admit routers. Filters include type/model/region/site. Individual and whole-current-filter checkboxes accumulate selections across groups; the group checkbox covers every matching page, and the list pages by 25. Selection never silently broadens beyond the explicit checkboxes. Confirmation states the total selected count.

LOCAL results come **only from explicit user-selected demo scenarios**, not from SSH or fabricated successful checks. Missing scenario, auth failure, timeout and connection failure remain unknown. Only explicit clean yields demo-clean; Err-disabled yields explicitly synthetic Gi0/1 and Gi0/2.

The visible four-stage flow is switch selection → port scan → choose failed ports → review/acknowledge recovery. The scan summary shows switch name/IP and its failed ports. A separate per-port list permits individual/all-pending checkbox selection. Recovery keys bind stable node ID **and** exact interface, so Gi0/1 on two switches cannot alias. Unknown/clean results and unreported interfaces cannot be repaired. `errRecoveryPlan` re-derives the explicit simulated results against the current canonical nodes and rejects stale/forged results, duplicate or unknown target keys and ambiguous node IPs. It never emits or executes device commands.

Review opens a native dialog containing every exact switch/IP/interface. Both an unchecked-by-default acknowledgment and explicit confirm button are required. Cancel changes nothing; navigation closes the dialog. Confirmation rechecks authorization, result/selection revision, exact selected keys, complete inventory signature and a freshly derived recovery plan. Only acknowledged targets acquire the RAM-only label **رفع نمایشی شد — وضعیت واقعی نامعلوم**. That is not evidence of a real port going up. The scan's original finding remains a separate historical column. Demo repair does not mutate canonical inventory or save configuration. Selection/scenario/inventory changes invalidate the scan/recovery; rescan resets demo repairs. Filter-only navigation does not silently broaden port targets.

Excel reports contain a row per failed interface (or a summary row for unknown/clean), owning switch/IP/model, scan source/outcome, simulated repair status and timestamp. Selection, scenarios, review plans and reports live only in RAM; main logout/RADIUS reset/refresh clears them with existing credential/draft lifecycle. Neither SERVER nor the existing constrained Device360 recovery executor/backend/SSH path is changed.

## Safe migration / persistence

If v3 is absent, the UI reads `fam.equipment.inventory.v2`, migrates into v3, validates and writes the new key. The original v2 value is not modified or deleted.

Migration preserves node IDs, names, IPs, known locations and the legacy path. Unknown model/region are not guessed. Unknown attributes stay nullable and are flagged for completion. Legacy duplicate IPs are retained; the user must resolve any conflict before resaving an affected node.

Malformed data or a storage exception yields a visible read-only state instead of silently resetting/overwriting an existing inventory. The original storage keys remain available for recovery. Storage is local to the same browser profile/origin and shared by local FAM accounts; this preview is not a server-side authorization boundary.

## Credentials / lifecycle

RADIUS credentials live only in a closure in RAM. They survive in-page navigation (equipment → dashboard → equipment) for the current FAM account. They are cleared by main FAM logout/account change/permission revocation, manual RADIUS change and page unload/refresh. They are never added to localStorage, sessionStorage, IndexedDB, URLs or node data. The preview does not validate real credentials or contact any network endpoint.

## Validation and packaging

Current workflow release: **102/102 full local regression tests passed** (397.27 seconds). The 18 pure Excel/tools tests also passed separately. After the final mobile confirmation-table styling adjustment, all 10 tools browser tests passed again, including visibility of the exact port column on mobile. An independent openpyxl load verified eight Stop list validations, dependent kind mappings, hidden metadata and unique ZIP paths. Desktop Microsoft Excel and live device checks were not run.

- `node --test tests/equipment-inventory.test.cjs`: pure schema, defaults, required fields, parent relationships, IP uniqueness, reclassification, catalog deletion safety, unassignment and migration.
- `node --test tests/equipment-local.test.cjs`: browser add/edit/groups/filter intersections/category-prefill/inline models and sites/catalog CRUD/unassignment/Device360/RADIUS lifecycle/migration/read-only corrupt data/storage failure/mobile themes/no secret persistence/no network.
- `node --test --test-concurrency=1 tests/equipment-excel.test.cjs tests/equipment-tools-model.test.cjs tests/equipment-tools.test.cjs`: dynamic workbook codec/dropdowns, catalog CRUD→fresh download→stale rejection, actual-file fill/import, atomic errors/storage failures, stable-ID export/update, standards/reports, group checkboxes, mobile/lifecycle/no network.
- `npm test`: full local UI/access/config/tools regression suite, including the pure inventory tests.
- `python3 scripts/embed_local_access.py`: embed sources without touching SERVER.
- `python3 scripts/package_custom_access_updates.py`: allowlisted LOCAL/SERVER packages; verify the SERVER artifact remains unchanged.

LOCAL ZIP contains exactly `FAM.html`, `README_FA.txt`, `SHA256SUMS.txt`, `START-FAM.cmd`. No user inventory, real credentials, tokens, databases, private keys, logs or environments are packaged. Root LOCAL ZIP is a mirror of `releases/FAM-Custom-Access-LOCAL-Patch.zip`.
