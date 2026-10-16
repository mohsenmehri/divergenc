# Equipment inventory / Device 360 — local UI preview

Source inspiration: Cisco Prime Infrastructure's Device Groups, Network Devices inventory and Device 360 interaction pattern. This is an independently implemented FAM UI, not Cisco software or a complete replacement for Prime.

Official references consulted:
- https://www.cisco.com/c/en/us/td/docs/net_mgmt/prime/infrastructure/3-10/user/guide/ciscoprimeinfrastructure_3_10_userguide/user_interface_reference.html
- https://www.cisco.com/c/en/us/td/docs/net_mgmt/prime/infrastructure/3-0/user/guide/pi_ug/monitor_network.html

## Implemented

- Full standalone FAM, with existing local FAM login (fresh profile admin / 1109).
- Enter Equipment: first show a RADIUS credential gate. In the preview this accepts **fake test values only**, with a clear notice that no actual authentication occurs.
- Credentials stay in closure RAM, not local/session storage or any global API. Password input is cleared on submit. Navigation to the dashboard, other FAM views or back to Equipment preserves this RAM-only credential session. Main FAM logout, a different main account or permission revocation clears it. Manual RADIUS-change and refresh/pagehide also clear it; no credentials are persisted to support refresh.
- Router and switch cards; CRUD for device types, categories and subsections.
- Each default type independently receives the exact requested branch/area, six-building and Tehran/Semnan datacenter hierarchy.
- Inventory nodes contain only UUID, display name and RFC1918 IPv4. Names/IPs persist in `fam.equipment.inventory.v2` in the local browser. No workbook/data-sheet modifications.
- Duplicate IPs within a device type rejected. Maximum field lengths/tree sizes validated. Data rendered with textContent, never user HTML. Corrupt/unreadable local inventory is not silently overwritten.
- Redesigned horizontal device-family navigation (replacing the old side tree), large router/switch cards, color-coded location folders with inline subsection previews, compact location tiles, breadcrumbs, compact counts, standalone inventory table/search, blue primary buttons, small card management controls, add/edit dialogs and explicit delete confirmation (including subtree warning).
- Clicking a node name opens its Device 360-style workspace and automatically starts a **simulated** check for that node.
- Overview, ports/errors and future favorites tabs. Uncollected model, software, CPU, memory and uptime are labeled unavailable, not fabricated as real telemetry.
- Err-disabled recovery remains simulated and requires confirmation naming the node, IP and exact Gi0/1 interface. Pre/post outcomes, authentication failure, timeout and connection failure have explicit demo labels.
- RADIUS auth failure does not imply local-account detection. Local username/password and Enable workflow is deferred and inactive. No Enable command, free-form command or real SSH was added.
- Layout supports existing FAM themes and mobile widths.

## Tests

- `npm test`: **37 passed**, including eight full local-file Equipment workspace tests.
- `python -m unittest discover -s server/tests -p 'test_*.py'`: **97 tests, 96 passed / 1 skipped** (offline wheel-byte test; no wheels imported).
- All 12 local inline scripts parse with Node vm.Script; equipment source passes node --check.
- Final ZIP allowlist and FAM.html SHA256SUMS verified; root/release ZIP copies match.
- Source server files and server ZIP are unchanged by this UI work. Server ZIP SHA-256 remains `3d0247974f5ee5cae179ca65ea09cd45fb0b1bd739b4c05241a4eccc2b0ee71a`.

Local-file browser coverage includes FAM login, gate-before-inventory, exact hierarchy for both types, adding a node, click-to-open/auto-check, tabs, recovery confirmation cancellation/approval, deferred Local/Enable messaging, invalid/duplicate IP, node editing/deletion, safe rendering of HTML-like names, type/category/subsection creation, search, inventory survival after reload, credential expiration, no credential persistence, zero HTTP requests and mobile overflow checks.

## Not implemented / boundaries

No real RADIUS, SSH, SNMP, monitoring, scheduled polling, configuration deployment, topology discovery or favorite-command execution. No network calls from this module. Only local inventory editing is functional. The RADIUS gate is a UI simulation, not a security boundary. Local inventory is shared by equipment-authorized users of the same browser profile; production needs authenticated server-backed inventory and permissions.

Existing server payload remains a separate, previously built artifact; this local UI has not been deployed to that payload. Preserve existing local browser data; there is no automatic destructive migration or reset. To test with a fresh FAM account, use a separate browser profile rather than clearing existing data.

## Build / artifacts

Edit `src/equipment-local-preview.js` and `.css`, then run `python scripts/embed_local_access.py` to embed them in FAM.html. The workspace shell lives in FAM.html. Run `python scripts/package_custom_access_updates.py` to rebuild deterministic patches. For root download mirror, copy releases/FAM-Custom-Access-LOCAL-Patch.zip to the repository root.

Local ZIP has exactly FAM.html, README_FA.txt, SHA256SUMS.txt and START-FAM.cmd. No passwords entered by an operator, topology data, logs, database, private keys or runtime environment are packaged.
