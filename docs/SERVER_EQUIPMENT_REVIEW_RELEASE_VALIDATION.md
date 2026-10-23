# SERVER equipment review release validation — 2026-10-18

- Package: `releases/FAM-Custom-Access-SERVER-Patch.zip`.
- Bytes: **1,918,087**.
- SHA256: `584c489cc0c5a0857cd9becc247a22d8446b0910c0575bf409975034c8d4c9a9`.
- Root `FAM-Custom-Access-SERVER-Patch.zip` is byte-identical.
- Payload contains exactly 23 runtime files, all manifest-verified and byte-identical to current `server/` source, including the generated authenticated UI.
- Includes the `FAM-EQUIPMENT-REVIEW-20261018` marker and Persian installation/review guide, not the synthetic standalone preview.
- Package rebuilt with `python scripts/build_shared.py` and `python scripts/package_custom_access_updates.py --server-only`; repeat packaging produces the same hash. LOCAL patch source and release artifacts unchanged.
- `.venv/bin/python scripts/verify_server_fix_release.py`: **142 tests PASS**, executed against an isolated extraction of the shipped backend, plus ZIP/hash/path/manifest/source/guide parity checks. All equipment I/O is mocked.
- Focused UI/build suites: **43 tests PASS**, including checkbox hierarchy, mixed parents, router pre-API rejection, filtered group selection, 4000-member selection without truncation, pagination and keyboard/mobile behavior. See command in `EQUIPMENT_REVIEW_REDESIGN.md`.
- No DB, runtime settings, credentials, host-key file, private keys, logs, virtual environment or wheels bundled.
- No real device connections, production deployment, Windows/PowerShell/IIS execution or Docker image build/acceptance performed. Existing Windows installation must be backed up and tested before rollout.
- Container feasibility: the web backend can be containerized, but current C#/.NET Framework ASKPASS preparation is Windows-specific. A Linux SSH helper port and security/operational acceptance are prerequisites to enabling actual SSH there. See the Persian guide for volume, single-instance, HTTPS and secret-handling recommendations.
