/* Theme-2 paint contracts relevant to the standalone account editor. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const palette=fs.readFileSync('src/light-palette.css','utf8');
const access=fs.readFileSync('src/local-access.css','utf8');

test('Theme 2 keeps account controls on light readable surfaces',()=>{
  assert.match(palette,/\.mbox\{background-color:#fff!important;background-image:none!important;color:#203c52!important/);
  assert.match(palette,/\.access-field input,.access-login input,#user-form select,.own-password-dialog \.access-field input\{background-color:#fff;color:#203c52/);
  assert.match(palette,/#user-cancel\{background-color:#dce8ef!important;background-image:none!important;color:#29485f!important/);
  assert.match(palette,/#user-delete\{background-color:#e55c66!important;background-image:none!important;color:#111!important/);
});

test('cancel is filled and edit-only delete is compact in base styling',()=>{
  assert.match(access,/#user-cancel\{background-color:#31516b;background-image:none;color:#fff/);
  assert.match(access,/#user-delete\{display:inline-flex!important;width:max-content!important;max-width:max-content!important;min-width:0!important/);
  assert.match(access,/#user-delete\{[^}]*background-image:none!important;color:#111!important/);
});
