#!/bin/sh
# FAM lab helper — scan the IOL switch SSH host key ONCE and show it so you can
# verify it against the device console. Nothing is trusted or installed
# automatically. Lab-only tool; never shipped to customers.
#
# Usage (on FAM-Ubuntu):
#   sh scan_iol_hostkey.sh              # default IP 192.168.97.140
#   sh scan_iol_hostkey.sh 192.168.97.141
set -eu

IP="${1:-192.168.97.140}"
OUT="$HOME/iol-hostkey.txt"

echo "Scanning $IP once (saved to $OUT) ..."
ssh-keyscan -T 10 -t rsa "$IP" > "$OUT" 2> "$HOME/iol-hostkey.err" || true

if [ ! -s "$OUT" ]; then
  echo "No key received from $IP."
  echo "Check: switch is running, interface VLAN1 is up, SSH is enabled."
  if [ -s "$HOME/iol-hostkey.err" ]; then
    echo "ssh-keyscan said:"
    cat "$HOME/iol-hostkey.err"
  fi
  exit 1
fi

echo "--- key line received from $IP ---"
cat "$OUT"
echo "--- fingerprint ---"
ssh-keygen -lf "$OUT"
echo
echo "NEXT (manual step, never skipped):"
echo "  1. On the switch console run:  show crypto key mypubkey rsa"
echo "  2. Compare that key with the key line above (first and last characters)."
echo "  3. ONLY if they match, run:"
echo "       cat $OUT >> ~/FAM-Linux-Lab/data/equipment_known_hosts"
