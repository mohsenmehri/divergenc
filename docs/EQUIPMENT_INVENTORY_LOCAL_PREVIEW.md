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

Browser coverage exercises both entry choices, hover/keyboard/escape behavior, mobile/reduced motion, account restrictions, direct category CRUD for all six axes, dependency protection, persistence, and RADIUS retention across direct/chooser round trips. The complete local suite passes 60 tests.

## Safe migration / persistence

If v3 is absent, the UI reads `fam.equipment.inventory.v2`, migrates into v3, validates and writes the new key. The original v2 value is not modified or deleted.

Migration preserves node IDs, names, IPs, known locations and the legacy path. Unknown model/region are not guessed. Unknown attributes stay nullable and are flagged for completion. Legacy duplicate IPs are retained; the user must resolve any conflict before resaving an affected node.

Malformed data or a storage exception yields a visible read-only state instead of silently resetting/overwriting an existing inventory. The original storage keys remain available for recovery. Storage is local to the same browser profile/origin and shared by local FAM accounts; this preview is not a server-side authorization boundary.

## Credentials / lifecycle

RADIUS credentials live only in a closure in RAM. They survive in-page navigation (equipment → dashboard → equipment) for the current FAM account. They are cleared by main FAM logout/account change/permission revocation, manual RADIUS change and page unload/refresh. They are never added to localStorage, sessionStorage, IndexedDB, URLs or node data. The preview does not validate real credentials or contact any network endpoint.

## Validation and packaging

- `node --test tests/equipment-inventory.test.cjs`: pure schema, defaults, required fields, parent relationships, IP uniqueness, reclassification, catalog deletion safety, unassignment and migration.
- `node --test tests/equipment-local.test.cjs`: browser add/edit/groups/filter intersections/category-prefill/inline models and sites/catalog CRUD/unassignment/Device360/RADIUS lifecycle/migration/read-only corrupt data/storage failure/mobile themes/no secret persistence/no network.
- `npm test`: full local UI/access/config regression suite, including the pure inventory tests.
- `python3 scripts/embed_local_access.py`: embed sources without touching SERVER.
- `python3 scripts/package_custom_access_updates.py`: allowlisted LOCAL/SERVER packages; verify the SERVER artifact remains unchanged.

LOCAL ZIP contains exactly `FAM.html`, `README_FA.txt`, `SHA256SUMS.txt`, `START-FAM.cmd`. No user inventory, real credentials, tokens, databases, private keys, logs or environments are packaged. Root LOCAL ZIP is a mirror of `releases/FAM-Custom-Access-LOCAL-Patch.zip`.
