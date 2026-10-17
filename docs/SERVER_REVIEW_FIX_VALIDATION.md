# SERVER release validation — 2026-10-18

This release retains the previously implemented SERVER review fixes and adds read-only branch-client diagnosis plus the shared logo/background UI update. It is not the historical unfixed review ZIP.

## Artifacts

- SERVER: `releases/FAM-Custom-Access-SERVER-Patch.zip`, 21 allowlisted payload files; both installation and client-diagnosis Persian guides are inside.
- LOCAL: `releases/FAM-Custom-Access-LOCAL-Patch.zip`; updated branding/background only, no SSH or diagnosis execution.
- Exact ZIP checksums are in the adjacent `.zip.sha256` files; the build regenerates both deterministically.
- Main Persian guide: `SERVER_REVIEW_FIX_PATCH_FA.md`, byte-identical to SERVER `README_FA.txt`.
- Diagnosis guide: `CLIENT_MOVE_DIAGNOSIS_FA.md`, byte-identical to SERVER `CLIENT-MOVE-DIAGNOSIS-FA.txt`.
- Branding/background guide: `UI_BRAND_BACKGROUND_FA.md`.
- UI markers: existing SERVER security marker `FAM-EQUIPMENT-V2-SERVER-FIX-20261017`; new branding marker `FAM-BRAND-BACKGROUND-20261018`; new SERVER-only diagnosis marker `FAM-CLIENT-DIAGNOSIS-20261018`.

## Executed checks

| Check | Result |
| --- | --- |
| `.venv/bin/python -m unittest discover -s server/tests -v` | 163 run: 162 passed, 1 skipped; 22.255 s |
| Skip | Offline carried-wheel bytes absent; requires separate offline wheel preparation |
| `server.tests.test_equipment_diagnostics` | 19 new API/parser/transport contracts passed; synthetic CLI/SSH only |
| `npm test` | 111 passed, 0 failed, 0 skipped; 299.697 s; includes the 4 new branding checks |
| New diagnosis UI test file, run separately after it was added | 5 passed, 0 failed; no real network |
| Final focused run: branding + diagnosis UI + shared build | 24 passed, 0 failed; 26.202 s |
| `scripts/verify_server_fix_release.py` | ZIP checksum, 21 payload hashes, canonical source parity, both Persian guides and 92 isolated extracted-runtime tests passed |
| `scripts/smoke_equipment_live.cjs` | Real Chromium → authenticated disposable API → synthetic executor/parsed diagnosis evidence passed; zero browser JavaScript errors |
| `scripts/smoke_equipment_server.cjs` | Two-session central persistence, editor draft, history broadcast, pending/conflict gates passed; zero browser JavaScript errors |
| Syntax | Changed Python compiled; JavaScript checked; changed installer PowerShell parsed with tree-sitter, not executed on Windows |
| Packaging hygiene | No runtime DB/settings/known_hosts, real credentials, keys/certificates, logs, venv, wheels, executables or dependency directories |
| Working diff whitespace | `git diff --check` passed |

The 111-test full JavaScript run started before the separate 5-test diagnosis UI file was created; these results are explicitly separate, not a claim that all 116 ran in one invocation. The 24-test focused run rechecked the final compiled UI and includes those 5 diagnosis tests.

## New read-only diagnosis coverage

Tests cover supported/unsupported model and IOS/image profiles; unknown platform stops before the second read phase; exactly fixed read commands, one request-owned ASKPASS and no configuration/retry; timeout cleanup; input injection rejection; strict command boundaries, pagination/control/size rejection; per-source unavailable handling; VLAN 100 only; no Gi uplink offered as a direct client port; dynamic-MAC evidence at most medium confidence; historical-only DAI low confidence; binding-only unknown; no movement confirmation; typed API report validation; session/Origin/CSRF, independent scan permission and scope enforcement; known-router denial; busy admission; no repair tickets, persistent results or credential leakage.

The authenticated live-browser check exercises the actual diagnosis endpoint with synthetic parsed CLI fixtures. It verifies Fa0/7 observation versus recorded Fa0/12, the explicit non-confirmation warning, no repair action and no IP/MAC search-result storage. Existing recovery/inspection checks still pass, including stop-all after uncertainty/still_errdisabled, approval invalidation, exact safe description text, manual targets and credential RAM lifecycle.

## Branding/background coverage

Actual offline HTML tests verify the login and automatic two-workspace chooser use the byte-identical embedded sidebar logo with the exact full company name underneath. Both themes, chooser widths 320/390/768/1440, account/inventory preservation and matching dashboard/equipment background and FX behavior were checked. No external logo request is needed. Existing user theme and reduced-motion policy remain in control.

## Limits

No production deployment, actual device communication, real credentials, production database or equipment screenshots were used. The disposable synthetic server was stopped after checks.

PowerShell syntax parsing and mocked ctypes calls are not Windows execution. IIS, Task Scheduler, Windows kernel Job Object behavior, organization OpenSSH/ASKPASS compatibility, RADIUS and the actual branch IOS remain staging acceptance tasks. The new profile is a conservative initial parser for WS-C2960-24TT-L / VLAN 100, not certification of every firmware release. No raw version/serial/log data is released, no switch configuration changes occur and no client move is declared confirmed.

Existing data/settings/accounts/scopes are preserved. Rotate any old known/default password through the authorized UI; the patch does not reset existing accounts. Rollback restores code only and never automatically replaces the current database. Use the backup and updater from the same patch version because allowlists changed from 20 to 21 payload files.

KDF migration, trusted-proxy client-IP-aware login limiting and full CSP redesign remain separate work; see `SECURITY_NOTES.md`.
