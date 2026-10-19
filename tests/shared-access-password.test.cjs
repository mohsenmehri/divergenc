/* Regression guard: the central own-password dialog must only use names it
 * defines. Its close() previously referenced manageUsers' `equipmentChanged`
 * out of scope, so every close threw "equipmentChanged is not defined" AFTER
 * the server had already saved the new password. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('src/shared-access.js','utf8');

test('editOwnPassword only uses names it defines (no dangling equipmentChanged)',()=>{
  const start=source.indexOf('function editOwnPassword(');
  const end=source.indexOf('async function manageUsers(');
  assert.ok(start>=0&&end>start,'editOwnPassword block not found');
  const body=source.slice(start,end);
  if(body.includes('equipmentChanged'))assert.match(body,/const equipmentChanged=/);
  assert.ok(!body.includes('localStorage'),'the central client never stores credentials in the browser');
});

test('manageUsers still registers and unregisters its equipment listener',()=>{
  const start=source.indexOf('async function manageUsers(');
  assert.ok(start>=0,'manageUsers block not found');
  const body=source.slice(start,start+4000);
  assert.match(body,/const equipmentChanged=\(\)=>equipmentScopeRefresh\?\.\(\);document\.addEventListener\('fam-equipment-changed',equipmentChanged\);/);
  assert.match(body,/document\.removeEventListener\('fam-equipment-changed',equipmentChanged\)/);
});

test('every fam-equipment-changed registration in shared-access is paired',()=>{
  const adds=(source.match(/addEventListener\('fam-equipment-changed'/g)||[]).length;
  const removes=(source.match(/removeEventListener\('fam-equipment-changed'/g)||[]).length;
  assert.equal(adds,removes);
  assert.ok(adds>=1);
});
