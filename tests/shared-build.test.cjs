const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8');
test('central HTML contains server auth and sync, never restores a local workbook at boot',()=>{
 const html=read('server/www/FAM.html');
 assert.equal((html.match(/id="fam-shared-js"/g)||[]).length,1);
 assert.equal((html.match(/id="fam-local-access-js"/g)||[]).length,1);
 const access=html.match(/<script id="fam-local-access-js">([\s\S]*?)<\/script>/)[1];
 assert.ok(!access.includes('localStorage'));assert.ok(!access.includes('hashPassword'));
 assert.match(access,/FamShared.api\('users'/);assert.match(access,/FamShared.api\('password'/);
 assert.match(html,/idbDelete=async\(\)=>true/);
 assert.match(html,/await Access.start\(\);\s+await FamShared.load\(\);/);
 assert.equal((html.match(/FamShared.ready\(\)/g)||[]).length,2);
 assert.ok(!html.includes('restore saved session (previously imported data), if any'));
 for(const [,js] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(js);
});
test('light theme only paints: no DOM relocation, box geometry or background shorthand resets',()=>{
 const css=read('src/light-palette.css'),html=read('FAM.html');
 assert.doesNotMatch(css,/(?:^|[;{])\s*(?:display|visibility|position|width|height|min-width|min-height|font|font-size|font-family|padding|margin|gap|order|grid-template-columns|background)\s*:/m);
 assert.doesNotMatch(read('src/ui-theme.js'),/FamOperationsLayout/);
 assert.doesNotMatch(html,/id="fam-operations-js"/);
 assert.match(css,/#fx-stage[^}]*opacity:0!important/);
});
test('original XLSM bytes remain untouched',()=>{
 const sha=crypto.createHash('sha256').update(fs.readFileSync('Mohsen_FINAL_v5.xlsm')).digest('hex');
 assert.equal(sha,'bf1d5519e8e47b79212ef7bfbb7f0a6585faf6ae8604fd1f73a3af2a3b89ed66');
});
