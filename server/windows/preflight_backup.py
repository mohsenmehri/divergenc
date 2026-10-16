"""Dependency-free consistent SQLite backup before an installer changes code.
Uses the SQLite backup API, never a file copy over an active WAL. No credentials
are printed. It does not reset, migrate or write the source database.
"""
from pathlib import Path
import json
import sqlite3
import sys

def backup(source,destination):
    source=Path(source).resolve();destination=Path(destination).resolve()
    if not source.is_file():raise ValueError('Source database does not exist')
    if destination.exists():raise ValueError('Refusing to overwrite an existing backup')
    destination.parent.mkdir(parents=True,exist_ok=True)
    partial=destination.with_suffix('.partial')
    if partial.exists():raise ValueError('Partial backup already exists; use a new output name')
    src=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True,timeout=30)
    dst=sqlite3.connect(partial)
    try:
        src.backup(dst)
        if dst.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Backup integrity check failed')
        tables={r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'state','users','settings','sessions','receipts','audit','undo','attempts'}<=tables:raise ValueError('Not a FAM database')
        row=dst.execute('SELECT payload FROM state WHERE id=1').fetchone()
        payload=json.loads(row[0]) if row else None
        if not isinstance(payload,dict) or not isinstance(payload.get('order'),list) or not isinstance(payload.get('sheets'),dict):raise ValueError('Not an initialized FAM workbook')
        if not dst.execute('SELECT 1 FROM users WHERE role=1 AND enabled=1').fetchone():raise ValueError('No active administrator')
    finally:src.close();dst.close()
    partial.replace(destination)
    print('Verified pre-install database backup:',destination)

if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('Usage: preflight_backup.py EXISTING_DB NEW_BACKUP')
    backup(sys.argv[1],sys.argv[2])
