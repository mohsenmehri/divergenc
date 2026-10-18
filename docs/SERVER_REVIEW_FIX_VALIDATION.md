# SERVER release validation — 2026-10-18

Current release retains the SERVER security review fixes, branding/background update and read-only diagnosis, and adds **explicitly approved port-scoped MAC replacement with unchanged IP**. This is not a production/device acceptance report.

## Artifacts

- SERVER: `releases/FAM-Custom-Access-SERVER-Patch.zip`, **22 allowlisted payload files**, 30 total archive entries.
- New module `equipment_replacement.py` is included in packaging, fresh-install copy list, updater and same-version rollback manifests.
- LOCAL: `releases/FAM-Custom-Access-LOCAL-Patch.zip`; styling only, no SSH/replacement capability.
- Exact reproducible ZIP digests are in adjacent `.zip.sha256` files.
- Three byte-identical Persian guides inside SERVER: `README_FA.txt`, `CLIENT-MOVE-DIAGNOSIS-FA.txt`, `CLIENT-MAC-REPLACEMENT-FA.txt`, corresponding to the installation, read-only diagnosis and new replacement guides in `docs/`.
- New SERVER-only marker: `FAM-CLIENT-MAC-REPLACEMENT-20261018`. Existing branding/security/diagnosis markers retained.

## Executed checks

| Check | Result |
| --- | --- |
| Full `python -m unittest discover -s server/tests -v` | **186 run: 185 passed, 1 skipped** |
| Skip | Offline carried-wheel bytes absent; offline wheel preparation remains separate |
| New `server.tests.test_equipment_replacement` | **23 passed**, pure parser/command, mocked SSH process and authenticated API contracts |
| `scripts/verify_server_fix_release.py` | **115 isolated extracted-runtime tests passed**, plus ZIP checksum, all 22 payload hashes, source parity and all three guide comparisons |
| New `tests/equipment-replacement-ui.test.cjs` | **6 passed**, synthetic browser/API only |
| Final replacement + diagnosis UI + shared-build focused run | **26 passed, 0 failed** |
| Initial full `npm test` | **111 passed, 11 failed**: all 11 failures share the LOCAL equipment suite's before-hook login timeout (10 seconds); not a claim of a green full invocation |
| Unchanged LOCAL equipment suite rerun separately | **11 passed, 0 failed**; all tests blocked by that hook were exercised successfully |
| `scripts/smoke_equipment_replacement.cjs` | Authenticated real SERVER UI/API → synthetic executor: per-switch port/static checkbox, old IP/MAC preview, cancel, explicit approval, unchanged-IP result, ticket invalidation, RAM/navigation/reload; **zero browser errors** |
| `scripts/smoke_equipment_live.cjs` | Existing authenticated inspect/status/descriptions/recovery/diagnosis regression smoke passed; **zero browser errors** |
| `scripts/smoke_equipment_server.cjs` | Central two-session persistence/history/scopes/drafts/pending/conflict smoke passed; **zero browser errors** |
| Syntax | Changed Python compiled, JavaScript checked; two changed PowerShell files parsed by tree-sitter, **not executed on Windows** |
| Build/packaging | Canonical generated HTML, exact payload source parity, duplicate/traversal checks, deterministic ZIP and guide parity |
| Hygiene | No runtime DB/settings/known_hosts, credentials, private keys/certificates, logs, venv, wheels, executables or dependency directories in the patch |
| Diff | `git diff --check` passed |

The full JavaScript invocation's hook timeout occurred while other browser/CPU checks were also running. The successful unchanged separate rerun is reported separately, rather than relabeling that original invocation as passed. No application login behavior or test timeout was weakened.

## Replacement coverage and safety boundaries

- Empty optional port uses the existing inspect/error-recovery workflow. Per-branch port is independent, access-only `Fa0/1`–`Fa0/24`; explicit status-only remains read-only regardless of optional port.
- Static checkbox reads exactly one matching static VLAN 100 binding and exact simple `Inspection` permit. IP is never entered, allocated or derived from port number. Old/new pair commands preserve the actual old IP, including an IP whose last octet is not the port number.
- No static checkbox: no write to source binding or ARP ACL; a configured static binding blocks this mode rather than silently leaving stale policy.
- Preflight gates model/IOS/access configuration, single client, IPSG, admin state, bindings/ACL, command boundaries and output bounds. Explicit existing configured/sticky secure addresses block before writes; no clear-all or automatic sticky removal.
- Plan/apply require both scan and repair permissions plus all five current scopes. API tests deny either missing permission and each missing scope; Origin/CSRF/session and existing shared per-host/global admission remain enforced.
- One-use 300-second approval binds operation purpose, user, SSH identity, host, port, static checkbox and configuration fingerprint. Tampering, cross-purpose recovery, stale snapshots, replay, public/invalid hosts, uplinks, input commands/new IP and malformed helper output are rejected.
- Application shuts the target before removing IPSG/policy, verifies closed/unprotected state, then opens for bounded learning. It does not assume an err-disable must occur; at most one observed error is bounced.
- Single unicast new MAC must agree in CAM/secure observations, differ from recorded old MAC and not conflict with other binding/secure identities. Multiple MACs, missing traffic and repeated failures do not produce success.
- Restoration happens while shutdown; unchanged-IP binding/new permit and IPSG are checked before opening. Final link, CAM and secure identity are checked. This is **not end-to-end client IP connectivity verification**.
- Failure after possible writes attempts a bounded shutdown-only compensation with known old IP/MAC policy and IPSG. Confirmed shutdown/protection yields a manual-review/quarantined failure; failed cleanup or transport loss yields **uncertain protection, immediate operator review**, never success/retry/reopen.
- Helper/apply deadline 150 seconds, executor 160 seconds, browser 170 seconds, existing lease 180 seconds. Leaving the page or browser timeout does not promise physical cancellation.
- Credentials, plans/results and raw switch output are not persisted. Only existing lease ownership and consumed-ticket digests/expiry are stored. No enable/save/free-form CLI/debug was added.

## Preserved behavior and staging limits

Read-only diagnosis remains separate and never repairs or confirms movement; historical DAI and configured binding/sticky entries remain nonproof of current location. Existing branding/company name, theme, account/data/scopes, LOCAL offline boundary, direct server SSH, strict host keys, single aes128-cbc exception and safe description display are retained.

No real switch, production database, real device credentials, RADIUS or Windows/IIS deployment was accessed. All CLI/SSH data is synthetic. Windows Job Object/ASKPASS/IIS/Task Scheduler and exact branch IOS remain staging acceptance tasks. The 2960 profile and strict parser are not certification of all firmware/output variants.

**Important functional limit:** this patch does not automatically remove an old Sticky/Configured secure address. Such a port is stopped before changes and needs an independently authorized operator decision. Lack of new MAC traffic can leave the target deliberately shutdown; SSH loss can leave protection unconfirmed. Do not roll out across branches without a maintenance/staging acceptance procedure and independent management access.

Existing data/settings/accounts/scopes are not reset. Rollback restores application code only, not device configuration or the current database; use updater and backup from the same release (manifest expanded from 21 to 22 payload files). KDF/proxy-rate-limit/CSP redesign remains separate work.
