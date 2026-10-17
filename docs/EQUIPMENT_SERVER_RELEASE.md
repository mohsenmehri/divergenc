# Central equipment test release — 2026-10-17

Scope selected: latest LOCAL inventory, categories, cards, per-model/location standards, dynamic Excel, configuration and simulated scan/recovery UX, with central metadata persistence and server-authorized operation permissions and stable-ID scopes. Latest correction explicitly requested a simple real multi-selection port workflow. The existing single-device executor is reused serially (up to five switches/ports per round); no freeform command, background worker or persistent job system was added.

## Deployment

Use `releases/FAM-Custom-Access-SERVER-Patch.zip` on a **test copy** of the existing Windows/IIS deployment. Extract, take an independent verified FAM SQLite backup, and run `APPLY-CUSTOM-ACCESS-UPDATE.cmd` as administrator. Read bundled `README_FA.txt`. A code rollback is not a substitute for a database backup. Additive schema migration does not reseed existing accounts or replace the workbook.

Package: 1,774,043 bytes. SHA256: `fe939260bec0e95c32fc014a49d2bf2d5386bb616d7e11c9a5d60e983b5d5b74`.

The ten-file payload is checksum verified; the new `equipment_inventory.py` participates in installation, presence-aware backup and rollback. The full-install source allowlist also includes equipment backend modules; the historical full-install ZIP was not rebuilt in this release. No runtime DB, credentials, keys, known_hosts, logs, environment, or node_modules are shipped. Root SERVER ZIP mirrors the release ZIP. LOCAL release bytes and hash are unchanged.

## Persistence and authorization

- `equipment_state` is separate from central workbook state, in the same private SQLite database. Only inventory/cards/standards metadata is stored. Browser equipment storage is replaced in the generated SERVER client by an in-memory central cache; no automatic upload of old LOCAL browser data occurs.
- Every central metadata write reauthorizes the current session inside the write transaction, checks revision/request identity and validates strict metadata schemas, private IPv4s, global IP uniqueness, references and per-operation capabilities. Scoped merges preserve hidden canonical records and reject collisions and hidden dependencies. Standards with a hidden parent type are not disclosed.
- Five independent AND scopes: types/models/regions/siteKinds/sites. `*` permits present/future identifiers; empty denies. Deleted references fail closed. Existing legacy equipment users retain compatibility until custom policy is saved; a stored scope never falls back to implicit defaults. Account/scope edits change the account revision and invalidate other old sessions.
- Pending writes block the interface until acknowledged. Errors, uncertain delivery and stale revisions do not claim confirmation or automatically overwrite/retry. Explicit reload/review is required. Workbook/equipment UI blocking is coordinated.
- Polling updates idle metadata and the live user-scope category options without discarding the user editor's unsaved draft. While equipment editing is active, external revisions are announced, not silently applied over the draft.
- History cleanup sets a durable central history visibility floor and propagates independently of workbook revision. Internal rollback snapshots remain under existing retention; this is **not** physical erasure of recovery backups. Workbook records and undo snapshots are preserved.

## Simulation versus real SSH

Configuration and configuration-audit tools remain offline/simulated. SERVER port scanning and recovery now have **one simple real SSH workflow** in Tools and device pages: select switches → scan → list owning switch/IP and error ports → explicit confirmation → controlled repair. The LOCAL scenario controls and separate legacy live panel are absent in SERVER. There is no dummy RADIUS authentication step. The device credentials are held only in document RAM until main logout/refresh, survive in-page navigation, and are sent only to the existing authenticated HTTPS endpoints.

At most five switches are scanned serially; at most five selected ports are repaired serially. Every call reuses the existing bounded helper and server permission/scope checks. A successful check includes a server-SSH source marker, host and check timestamp. Missing/malformed replies, authentication failure, timeout or unreadable/partially parsed tables are unknown, never clean. The parser recognizes explicit err-disabled/errdisable/errdisabled variants, not administrative disabled/notconnect states. Pre/post recovery must both contain the exact target interface; disappearance is not success.

Real checks require equipment-scan; recovery requires equipment-repair. Scoped users can target only an IP in their permitted inventory; all-five-wildcard users retain the previous private-IP API flow. Recovery requires review of exact switch/IP/interface and a short-lived server ticket; cancel sends no mutation. Unknown outcomes and expired tickets require a new check, with no automatic retry. Leaving an active operation stops subsequent calls, but cannot guarantee cancellation of the already-sent device request; the UI requires rechecking its outcome.

The constrained Windows SSH transport/command allowlist remains unchanged; only status interpretation/completeness checking was tightened: strict host-key handling, only the narrow aes128-cbc exception, no enable/freeform/save commands, transient credentials and secret-free temporary ASKPASS. The shared request helper now honors the existing bounded 110-second caller timeout, rather than silently aborting at 20 seconds.

## Validation

- Backend: **112 cases, 111 passed, 1 environment-specific skipped** using `.venv/bin/python -m unittest discover -s server/tests -p 'test_*.py'`. Includes central equipment coverage: persistence/restart, receipts/stale writes, scoped reads/merges, hidden dependencies, private-IP collision, operation denial, import capability, standards validation/parent privacy, scope session revocation, central history cleanup.
- JavaScript: **57/57** shared-build and pure inventory/access/Excel/configuration/tools model tests.
- Chromium integration: `FAM_EQUIPMENT_TEST_URL=http://localhost:8765 node scripts/smoke_equipment_server.cjs` against a disposable synthetic TESTING server. Actual private client, two isolated sessions, browser form save and reload, no equipment localStorage, shared real workflow presence, category rename and unsaved account draft preservation, central history broadcast, pending acknowledgment, coordinated workbook/equipment blocking and stale-write freeze. **Zero uncaught browser errors.**
- Historical LOCAL full regression remains 110/110 from the preceding release; it was not rerun in full here because LOCAL source/artifact bytes are unchanged.
- Windows/IIS installation, Microsoft Excel desktop and a real device connection were **not run**. No real device credentials were used.

### Simple SSH workflow correction checks

`FAM_EQUIPMENT_FIXTURE=SYNTHETIC_ONLY .venv/bin/python scripts/serve_equipment_test_fixture.py` starts a disposable TESTING fixture; `FAM_EQUIPMENT_TEST_URL=http://localhost:8765 node scripts/smoke_equipment_live.cjs` runs the actual private UI/authenticated API with a **synthetic executor**. Three selected switches return err-disabled, clean, timeout respectively. Assertions cover switch/IP/port ownership, cancel without a repair call, exactly one explicitly confirmed recovery, malformed HTTP-success reply treated as unknown, password absent from storage, preserved across tab changes and cleared by refresh and a 401 session-expiration response; zero browser errors. The generic two-session central integration smoke also passed again. Its stale-write check uses the independent API context to avoid a page-route/poll timing dependency.

Additional mocked-OpenSSH tests cover errdisable status variants, a mixed clean/unparseable error table, pagination, missing recovery target in pre/post checks and actionable sanitized unreadable-table errors. Existing Windows SSH cipher, ASKPASS, command restrictions and host-key tests still pass. **No claim is made that the user's actual switch is reachable or fixed; live Windows/server-to-switch verification remains pending.**
