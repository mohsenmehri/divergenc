# FAM direct OpenSSH patch — verification report

Date: 2026-10-16. Source baseline: `d1ad2da80be2360948883913b292c150dfa64a8d`.

## Deliverable

- `releases/FAM-Custom-Access-SERVER-Patch.zip` (also mirrored at repository root)
- Size: 1,720,166 bytes
- SHA-256: `3d0247974f5ee5cae179ca65ea09cd45fb0b1bd739b4c05241a4eccc2b0ee71a`
- Companion checksum: `releases/FAM-Custom-Access-SERVER-Patch.zip.sha256`
- ZIP has exactly 13 allowlisted files: installer CMD/PS1, Persian README, 9 payload files and payload SHA256SUMS.txt.
- All nine payload digests verified against bytes extracted from the final ZIP.
- No wheels, database, PFX, private keys, logs, credentials or venv are bundled.

## Tests run

| Check | Result |
|---|---|
| `python -m unittest discover -s server/tests -p 'test_*.py'` | 97 tests, 96 passed / 1 skipped |
| `python -m unittest tests.test_unique_excel_fields` | 5 passed |
| `npm test` | 29 passed, including three equipment UI interaction tests |
| `python -m compileall -q server scripts` | Passed |
| All 13 inline scripts in central FAM.html parsed with Node vm.Script | Passed |
| `node --check server/www/login.js` | Passed |
| SHA-256 payload manifest, ZIP allowlist and root/release byte equality | Passed |

The skipped test checks offline wheel bytes, which were intentionally not imported into this source checkout. No equipment behavior test was skipped.

### SSH mock coverage

23 dedicated probe tests cover the exact `Ciphers=+aes128-cbc` option, clean connected/disabled/notconnect statuses, err-disabled ports and descriptions, sanitized results, authentication failures, SSH and wall-clock timeouts, connection refusal/cipher mismatch, changed host keys, malformed/header-only output, secret absent from argv/source files, secret present only in SSH child environment, bounded secret-free .NET compilation, ASKPASS cleanup after success/failure/spawn failure, strict host-key policy, invalid operation/host/username/interface input, fixed status commands, exact-interface recovery precheck/config/postcheck, no configuration when the target is clean, still-errdisabled result, and nonzero SSH exit rejection.

Equipment browser tests verify immediate check-on-submit, a clear Persian clean-state message, password clearing on success/error, and explicit same-interface recovery confirmation with fresh password.

## Implementation-specific checks

- Server connects directly to device; legacy Connector broker and endpoints removed. `FAM_EQUIPMENT_CONNECTOR_ENABLED=0` in start.ps1.
- Host keys remain checked using dedicated known_hosts with accept-new/strict; changed keys map to `connection_failed`.
- Public probe errors are limited to `authentication_failed`, `connection_timeout`, `connection_failed`, `invalid_request`.
- Win32 OpenSSH needs an executable ASKPASS helper. The probe compiles fixed secret-free C# source with the Windows .NET Framework compiler into a per-session executable, then injects the password only into ssh.exe's transient environment. Source and executable are deleted in finally. Compiler is preflighted by installer; compilation has a 5-second timeout within the SSH session budget.
- Existing central HTML contained a literal newline inside SheetJS's Wm string; repaired that pre-existing syntax error without changing spreadsheet logic.
- Internal session budget 25s, helper deadline status/recover 30/85s, backend executor 40/95s, browser wait 110s.

## Files changed relative to source baseline

Primary source:
- `server/equipment_probe.py`
- `server/equipment_ops.py`
- `server/app.py`
- `server/windows/start.ps1`
- `server/requirements.txt`
- `server/private_ui/FAM.html`

Packaging and tests:
- `scripts/package_custom_access_updates.py`
- `patches/fam-custom-access-server/APPLY-CUSTOM-ACCESS-UPDATE.ps1`
- `patches/fam-custom-access-server/README_FA.txt`
- Regenerated matching payload files and `payload/SHA256SUMS.txt`
- Removed patch wheels and WHEELS-SHA256SUMS.txt
- `server/tests/test_equipment_probe.py` (new)
- `server/tests/test_equipment_ops.py`
- `server/tests/test_equipment_connector.py`
- `server/tests/test_installer.py`
- `tests/equipment-ui.test.cjs` (new)
- `docs/EQUIPMENT_MANAGEMENT_FA.md`, `docs/SECURITY_NOTES.md`, `docs/OFFLINE_SERVER_2019_FA.md`
- Release ZIPs/checksum files and root ZIP mirrors

The session's initial branch had only flat archive files and no server source. Required project source/test/reference files were imported from the requested baseline, excluding heavy historical releases and wheel binaries; this accounts for the larger Git file list beyond the feature changes above.

## Not verified here / deployment prerequisites

This sandbox is Linux. The Windows PowerShell installer, native Win32 ssh.exe and .NET-compiled ASKPASS executable have **not** been executed on Windows here. SSH tests mock subprocesses; no live connection to 10.2.35.2 was made and no real device credentials were requested or used.

Before production deployment, validate on the FAM Windows server: installed OpenSSH Client and .NET Framework csc.exe, direct TCP/22 reachability, known-host fingerprint approval, and a read-only status check. Installer checks required executable/cipher presence, backs up application files and verifies hashes before replacement. Actual Windows execution and device compatibility still require an operator smoke test. Do not treat mocked tests as proof of a successful live login.
