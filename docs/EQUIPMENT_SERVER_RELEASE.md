# Central equipment test release — 2026-10-17

Scope selected: latest LOCAL inventory, categories, cards, per-model/location standards, dynamic Excel, configuration and simulated scan/recovery UX, with central metadata persistence and server-authorized operation permissions and stable-ID scopes. No expansion of the real single-device SSH executor.

## Deployment

Use `releases/FAM-Custom-Access-SERVER-Patch.zip` on a **test copy** of the existing Windows/IIS deployment. Extract, take an independent verified FAM SQLite backup, and run `APPLY-CUSTOM-ACCESS-UPDATE.cmd` as administrator. Read bundled `README_FA.txt`. A code rollback is not a substitute for a database backup. Additive schema migration does not reseed existing accounts or replace the workbook.

Package: 1,775,186 bytes. SHA256: `d4207121b49f1b8825d98de61a203785f67888612d99ac5d501b710c70b05162`.

The ten-file payload is checksum verified; the new `equipment_inventory.py` participates in installation, presence-aware backup and rollback. The full-install source allowlist also includes equipment backend modules; the historical full-install ZIP was not rebuilt in this release. No runtime DB, credentials, keys, known_hosts, logs, environment, or node_modules are shipped. Root SERVER ZIP mirrors the release ZIP. LOCAL release bytes and hash are unchanged.

## Persistence and authorization

- `equipment_state` is separate from central workbook state, in the same private SQLite database. Only inventory/cards/standards metadata is stored. Browser equipment storage is replaced in the generated SERVER client by an in-memory central cache; no automatic upload of old LOCAL browser data occurs.
- Every central metadata write reauthorizes the current session inside the write transaction, checks revision/request identity and validates strict metadata schemas, private IPv4s, global IP uniqueness, references and per-operation capabilities. Scoped merges preserve hidden canonical records and reject collisions and hidden dependencies. Standards with a hidden parent type are not disclosed.
- Five independent AND scopes: types/models/regions/siteKinds/sites. `*` permits present/future identifiers; empty denies. Deleted references fail closed. Existing legacy equipment users retain compatibility until custom policy is saved; a stored scope never falls back to implicit defaults. Account/scope edits change the account revision and invalidate other old sessions.
- Pending writes block the interface until acknowledged. Errors, uncertain delivery and stale revisions do not claim confirmation or automatically overwrite/retry. Explicit reload/review is required. Workbook/equipment UI blocking is coordinated.
- Polling updates idle metadata and the live user-scope category options without discarding the user editor's unsaved draft. While equipment editing is active, external revisions are announced, not silently applied over the draft.
- History cleanup sets a durable central history visibility floor and propagates independently of workbook revision. Internal rollback snapshots remain under existing retention; this is **not** physical erasure of recovery backups. Workbook records and undo snapshots are preserved.

## Simulation versus real SSH

New configuration/audit/group scan/repair features remain explicitly simulated; their working configurations/results are RAM-only. Central FAM authentication replaces the LOCAL dummy RADIUS gate. The existing real single-device form is a separately labeled panel with prefixed IDs. Its real checks require equipment-scan; recovery requires equipment-repair; scoped users can target only an IP in their permitted inventory. Users with all five wildcard scopes retain the previous private-IP flow.

The constrained Windows SSH helper is unchanged: strict host-key handling, only the narrow aes128-cbc exception, no enable/freeform/save commands, transient credentials and secret-free temporary ASKPASS. The shared request helper now honors the existing bounded 110-second caller timeout, rather than silently aborting at 20 seconds.

## Validation

- Backend: **107 cases, 106 passed, 1 environment-specific skipped** using `.venv/bin/python -m unittest discover -s server/tests -p 'test_*.py'`. Includes 10 new central equipment cases: persistence/restart, receipts/stale writes, scoped reads/merges, hidden dependencies, private-IP collision, operation denial, import capability, standards validation/parent privacy, scope session revocation, central history cleanup.
- JavaScript: **56/56** shared-build and pure inventory/access/Excel/configuration/tools model tests.
- Chromium integration: `FAM_EQUIPMENT_TEST_URL=http://localhost:8765 node scripts/smoke_equipment_server.cjs` against a disposable synthetic TESTING server. Actual private client, two isolated sessions, browser form save and reload, no equipment localStorage, live SSH/demo separation, category rename and unsaved account draft preservation, central history broadcast, pending acknowledgment, coordinated workbook/equipment blocking and stale-write freeze. **Zero uncaught browser errors.**
- Historical LOCAL full regression remains 110/110 from the preceding release; it was not rerun in full here because LOCAL source/artifact bytes are unchanged.
- Windows/IIS installation, Microsoft Excel desktop and a real device connection were **not run**. No real device credentials were used.
