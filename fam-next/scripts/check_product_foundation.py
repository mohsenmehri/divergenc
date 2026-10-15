"""Offline guardrails for the FAM Next product foundation."""
from pathlib import Path
import re

root=Path(__file__).resolve().parents[1]
required=[
    'README_FA.md','FamNext.sln','Directory.Build.props','global.json',
    'src/FamNext.Domain/ProductContracts.cs',
    'src/FamNext.Application/ImportPolicy.cs',
    'deploy/sql/001_initial.sql',
    'deploy/vm/Test-FamNextVm.ps1',
    'docs/VM_IMPLEMENTATION_FA.md',
]
for item in required:
    assert (root/item).is_file(),item
sdk=(root/'global.json').read_text(encoding='utf8')
assert '10.0.402' in sdk and 'latestPatch' in sdk
schema=(root/'deploy/sql/001_initial.sql').read_text(encoding='utf8')
for token in ('dbo.Tenants','TenantId','dbo.ApplicationUsers','dbo.WorksheetRows','dbo.ImportBatches','dbo.AuditEvents','dbo.Licenses'):
    assert token in schema,token
policy=(root/'src/FamNext.Application/ImportPolicy.cs').read_text(encoding='utf8')
assert '".csv", ".xlsx"' in policy
assert '.xlsm' not in policy
assert 'ImportData' in policy and 'Tenant scope mismatch' in policy
for path in root.rglob('*'):
    if path.is_file() and path.suffix.lower() in {'.cs','.csproj','.sql','.ps1','.md'}:
        text=path.read_text(encoding='utf8')
        assert not re.search(r'(?i)(password|secret|token)\s*=\s*["\'][^"\']{5,}',text),path
print('FAM Next product foundation checks passed.')
