# Equipment workspace v2 — 2026-10-17

## Replacement, not a visual overlay

`equipment-workspace.js` and `.css` replace the old equipment local-preview controller and both layers of its CSS. The old nested inventory facets/card grids/device tabs and tools-within-tools navigation are no longer embedded. The old scenario/recovery tool UI and build-time controller rewrite chain were removed. Native SSH now has one canonical source rather than a base controller plus injected fragments. The database workspace is not redesigned.

Six direct destinations share a single navigation bar: inventory, port inspection, standards, offline configuration, Excel, and classification management. Inventory uses a 25-row paginated table, metadata-aware search, explicit dependent filters and name/numeric-IP sorting. Equipment details open in a dialog **without** automatically connecting. Counts and completeness badges represent inventory metadata, not reachability or device health. Classification CRUD is a direct page; saved shortcuts remain available under progressive disclosure rather than defining a navigation maze. Persian built-in copy now uses «تجهیز», not «نود». User-provided names are deliberately not rewritten.

## Preservation and boundaries

- Existing canonical inventory v3, legacy v2 migration, cards v1 and standards v1 storage identities/IDs remain compatible. No data reset, account reseed or schema migration was added by this redesign. Metadata CRUD, in-use dependency protection, exiting one category without deleting equipment, shortcuts, live Excel templates/import preview and standards remain available.
- LOCAL manages metadata/offline tools only. Its misleading RADIUS entrance gate and fabricated scan/recovery scenarios are gone. The local port page explicitly requires the SERVER edition. It makes no SSH/API request and fabricates no results.
- SERVER uses the same workspace with the existing server-backed storage adapter, revision checks, pending/conflict gate, session/Origin/CSRF and five AND scopes. No inventory, credentials, description output or repair tickets are placed in browser storage. Simultaneous metadata notifications coalesce into one workspace render.
- SSH account entry appears only on the direct port page. Credentials stay in that module's document RAM across navigation until main logout/session reset/refresh. Scope checks, private-IP validation, one-session combined inspection, bounded serial execution, strict host keys/narrow cipher exception and exact pre/post-confirmed repairs are unchanged.
- The fixed, twice-sanitized description table is visible in expandable panels, rendered with textContent. No other CLI, arbitrary configuration execution or save/enable action was added. Config planning and textual standards checks remain offline.
- Scoped equipment CSS removes irrelevant workbook search/import/save chrome only while the equipment view is active. Table-only horizontal scrolling fits 390px screens in both themes; keyboard focus, dialog Escape, explicit labels, empty/error states and reduced-motion preference are supported.

## Reproducible builds

```
python3 scripts/embed_local_access.py
python3 scripts/build_shared.py
python3 scripts/build_simple_local_preview.py
python3 scripts/package_custom_access_updates.py
```

The embedder replaces only the relevant embedded modules. The shared builder adds central auth/storage/sync and the canonical native-SSH UI; it no longer rewrites a LOCAL equipment controller. The separate LOCAL preview is the same current offline UI, not a simulation adapter. Existing historical releases are not rewritten except the current LOCAL/SERVER patch aliases.

## Validation

`npm test`: **103/103** model, build and browser tests, including rewritten tests for retired navigation/scenario UI. Existing import atomicity, quota failure, stale workbook/catalog rejection, scoped accounts, offline configuration confirmation and logout/privacy checks remain covered.

Backend suite: **122 tests, 121 pass, one environment-dependent skip** after packaging. Authenticated two-session central smoke and synthetic-executor SSH smoke cover persistence/reload, live scope drafts, history sync, pending/conflict gates, exact port ownership, explicit cancel/repair, malformed responses, manual IP, safe description output and RAM-only credentials. No live Windows/IIS/RADIUS or hardware-device test is claimed. Screenshots were reviewed at desktop and 390px mobile sizes.

Deployment: take an independent verified live SQLite backup, install the SERVER patch on a test copy with the existing administrator script, refresh, and validate against approved devices locally. Code rollback alone is not a database backup.
