# SERVER group-recovery release validation — 2026-10-18

Current release: **FAM-EQUIPMENT-GROUP-20261018**. Real SERVER implementation, not the LOCAL mock. This is a code/packaging acceptance report, **not production, physical-device or Windows/IIS acceptance**. Previous single-port API remains available for compatibility; the actual SERVER form now uses group endpoints.

## Deliverable

- `releases/FAM-Custom-Access-SERVER-Patch.zip`: **1,908,389 bytes**, 32 archive entries, 23 allowlisted payload files plus manifest/updater and four Persian guides.
- SHA256: `5e27a43afea71ea50e28e6165eb32d0f286c9eebb4697d3642f73176c0ab16d1` (also adjacent `.zip.sha256`).
- New engine `server/equipment_group.py` included in ZIP, fresh-install file list, updater targets and same-version rollback manifests. No new runtime dependencies.
- New picker `src/equipment-switch-picker.js` embedded before actual SERVER controller; existing scoped central persistence, categories, user permissions and history mechanisms retained.
- Four guides checked byte-for-byte against source: `README_FA.txt`, `GROUP-RECOVERY-FA.txt`, `CLIENT-MOVE-DIAGNOSIS-FA.txt`, `CLIENT-MAC-REPLACEMENT-FA.txt`. The last guide explicitly describes the retained legacy single-port API, not the new form.

## Executed final checks

| Check | Result |
| --- | --- |
| Full Python `unittest discover -s server/tests -v` | **213 run: 212 passed, 1 skipped** |
| Skip | Existing optional carried-wheel hash check: wheel artifacts absent; no offline wheels added to this patch |
| New `server.tests.test_equipment_group` | **27 passed**, strict parser/range/cleanup contracts, mocked actual SSH subprocess protocol, real authenticated Flask guards |
| Isolated extracted ZIP runtime `scripts/verify_server_fix_release.py` | **142 passed**, plus ZIP SHA256, all 23 payload hashes/source parity, traversal/duplicates and all four guide comparisons |
| Full `npm test` (all 18 test files, serial) | **132 passed, 0 failed**, including unchanged LOCAL equipment suite and LOCAL preview tests |
| Focused real-controller/diagnosis/shared-build suite | **30 passed**, synthetic API/browser only |
| Authenticated browser smoke `scripts/smoke_equipment_replacement.cjs` | Real SERVER HTML/API with disposable synthetic executor: unified picker/manual target, inspect, exact escaped descriptions, 6/10 in one group apply, explicit old-MAC/old-port and conditional discovery consent, cancel, rejected replay, unchanged per-port IP replacement, removal report, read-only diagnosis, RAM/navigation/reload. **Zero browser errors.** |
| Authenticated central smoke `scripts/smoke_equipment_server.cjs` | Two sessions/reload, central persistence, no browser equipment storage, scope editor draft preservation, central history broadcast, pending/conflict gates. **Zero browser errors.** |
| `scripts/smoke_equipment_live.cjs` | Now delegates to the unified current live/group smoke instead of obsolete checkbox/single-recover harness; not counted as a third independent run |
| Syntax/static installer contracts | Changed Python compiled; changed JavaScript parsed; installer allowlist/manifest tests passed. PowerShell and Windows tasks **not executed on Windows** |
| Build/packaging | Canonical generated HTML; deterministic rebuild/repack; exact source/payload and guide parity |
| Hygiene/invariance | No runtime secrets/settings/DB/keys/certificates/known_hosts/logs/venv/wheels in ZIP; no changes to approved LOCAL HTML/ZIPs or original XLSM; `git diff --check` passed |

The first broad JavaScript pass exposed five obsolete test-harness assertions (new picker dependency and legacy single-recover patterns). Those harnesses were updated to load/test the actual new controller; focused tests and the subsequent **complete 132-test invocation** passed. No failing tests were skipped or removed.

## Specific safety evidence

- Exact 6 and 10 => `interface range FastEthernet0/6 , FastEthernet0/10`, never implicit 7–9. Adjacent explicit members only are compacted; five clauses maximum per range command.
- Source binding/Inspection commands use the existing independently read IP per port, not a port-number-derived address. Without static checkbox there is no static binding/ARP modification.
- All targets closed before cleanup; only exact reviewed Sticky/Configured records, or globally unique Dynamic address, are removed. Dynamic disappearance skips the clear; relocation/mismatch aborts without widening cleanup.
- Old connected ports, uplinks, other VLANs, selected-target ambiguity, multiple clients, static references and unknown output fail closed. No clear-all, blanket Sticky deletion, ACL deletion, enable, freeform CLI or save commands.
- When a replacement MAC is first visible only after reopening: fresh Secure-shutdown and increased violation counter, same-switch unique record, idle access VLAN100 old port, no static reference, recheck after range shutdown, exact clear/proof, at most one additional grouped recovery. Explicit conditional consent is visible in the confirmation.
- New-MAC evidence must be coherent for **all members in the same poll**; disappearing evidence cannot carry forward into a stale binding write.
- Scope, scan+repair permissions, session/Origin/CSRF, target/mode/static/fingerprint/policy-bound one-use tickets, shared host/global leases and deadlines retained. Unknown manual hosts require all five wildcard dimensions; manual targets never write inventory.
- Any uncertain/partial member stops remaining switch groups and invalidates approvals. After possible changes, only one bounded shutdown/protection attempt is made; previous foreign/target secure MACs are not blindly re-authorized. Typed failure metadata names old ports when known. A timeout can leave their identity/state unknown and requires immediate manual inspection.
- UI reports only verified replacement/protection or absence of err-disable, **not end-to-end client IP reachability or physical identity**.
- Full guide: `docs/GROUP_RECOVERY_FA.md` / `GROUP-RECOVERY-FA.txt` in ZIP.

## Still required before rollout

No real switch, RADIUS/SSH, branch network, Windows installer, Task Scheduler or IIS was exercised; no real credentials received, no production DB reset, no production deployment. The authenticated fixture was explicitly synthetic, disposable, and stopped after testing.

Staging acceptance must cover exact classic IOS/model/output and range/clear syntax, independently trusted host fingerprints, RADIUS privilege/command authorization, permitted maintenance ports, old-port active/idle and concurrent-change scenarios, Sticky/Configured/Dynamic, DHCP/static traffic, multiple ports, MAC learning/fresh-counter behavior, missing traffic, disconnect/timeout and manual restoration. Preserve independent management access and verified backups. Rollback restores application code, not actual switch configuration.
