# SERVER review-fix validation — 2026-10-17

This is implementation/release validation, not the historical unfixed review snapshot.

## Artifact

- `releases/FAM-Custom-Access-SERVER-Patch.zip`
- Size: 1,807,338 bytes; 26 files total, including 20 allowlisted payload files.
- SHA256: `13fe88ad657da69f3979f280676b2966561b4d195e46d39e5dad1498eade67c1`
- Persian installation/acceptance/rollback guide: `SERVER_REVIEW_FIX_PATCH_FA.md`; byte-identical to `README_FA.txt` inside ZIP.
- Protected UI release marker: `FAM-EQUIPMENT-V2-SERVER-FIX-20261017`.
- LOCAL artifact unchanged; no production deployment or real-device communication performed.

## Executed checks

| Check | Result |
| --- | --- |
| `.venv/bin/python -m unittest discover -s server/tests -v` | 144 run: 143 passed, 1 skipped; final run 21.414 s |
| Skip | Offline carried-wheel bytes absent; test explicitly requires separate offline wheel preparation |
| `.venv/bin/python -m unittest server.tests.test_review_fixes -v` | 19 acceptance contracts passed, including separate Python-process exclusion |
| `npm test` | 107 passed, 0 failed, 0 skipped; 268.354 s |
| `node --test tests/shared-build.test.cjs` | 15 passed after final UI marker rebuild |
| `scripts/verify_server_fix_release.py` | ZIP checksum, 20 payload hashes, canonical source parity, guide parity, and 73 isolated extracted-runtime tests passed |
| `scripts/smoke_equipment_live.cjs` | Real Chromium UI → authenticated disposable API → synthetic executor passed; no real SSH |
| `scripts/smoke_equipment_server.cjs` | Two-session central persistence, editor draft, history broadcast, pending/conflict gates passed |
| Python compile and JavaScript syntax | Passed for changed executable sources |
| PowerShell tree-sitter syntax | Changed/deployed scripts parsed; final updater and rollback reparsed after final edits |
| Packaging hygiene | No runtime SQLite/settings/known_hosts, credentials, keys/certificates, logs, venv, wheels, executables or dependency directories |
| `git diff --check` | Passed |

The acceptance suite covers bootstrap fail-before-file creation and secure retry, no echoed-stdin fallback, production new-password minimum with legacy verification, custom-manager normal/preflight/API backups, malformed/disabled manager rejection, random and one-use approvals, concurrent recovery without consuming a busy waiting approval, cross-instance/global admission, separate-process exclusion, lease cleanup, structured uncertainty, switch-only known inventory enforcement, case/long/keyword masking, helper environment filtering, strict default and mocked Windows Job Object ABI/fail-closed contracts.

The live browser check additionally verifies explicit status-only reads, normal inspect selection despite DOM MouseEvent arguments, stop-all and invalidation of unexecuted approvals after both uncertainty and still_errdisabled, manual internal targets, safe exact table text, confirmation/cancellation, malformed-result uncertainty, RAM-only credentials across navigation and clearing on refresh/session expiry. Browser JavaScript errors: zero in both smoke checks. The fixture server was stopped after checks.

## Important limits

PowerShell syntax parsing and mocked ctypes calls **are not Windows execution**. IIS, Task Scheduler behavior, the kernel Job Object implementation, organization OpenSSH/ASKPASS compatibility, RADIUS and device firmware still require authorized staging acceptance. Deployed-source parity is not known. The updater checks port readiness, not end-to-end HTTPS/application/device health; follow the Persian post-install checklist.

Existing data, settings, accounts and permissions are preserved, including existing passwords. An authorized administrator must rotate any old known/default password through the UI. Rollback restores code only; it never automatically replaces the current database. Returning to old code also returns its weaknesses.

The first full UI run exposed an obsolete combined-request-only assertion; it was updated for the explicit status-only path and the complete 107-test suite subsequently passed. A browser check exposed the status-only button disappearing with empty results; this was corrected and the expanded live smoke passed. Historical defect reproduction assertions are marked inactive; current acceptance tests are separate.

KDF/versioning migration, proxy-aware per-client login rate limiting and full CSP redesign are not represented as completed; see `SECURITY_NOTES.md`. No real credentials, production database, or equipment screenshots were used or included.
