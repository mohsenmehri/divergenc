# FAM lab mock switch (TEST TOOL ONLY)

`mock_switch.py` — a mock Cisco IOS switch CLI used to exercise the FAM
equipment flows in the lab (SSH login, host keys, read-only reviews,
err-disabled recovery). This is original test software: it is **not** Cisco
software, contains no Cisco code or images, and never ships in the customer
kit (see `scripts/package_linux_lab.py`).

`selftest.py` — feeds the probe's exact command sequences to the mock and
validates the answers with the real product parsers (`server/equipment_probe`,
`server/equipment_diagnostics`):

```sh
python3 lab/mock/selftest.py
```

Step-by-step setup guide (Persian): `docs/MOCK_LAB_FA.md`.
