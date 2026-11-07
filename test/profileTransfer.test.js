const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { importProfileEntries, collectExportEntries, classifyImportFailure } = require("../dist/profileTransfer");
const { encryptBackup, decryptBackup } = require("../dist/backupCrypto");
const { parseAccountBackup } = require("../dist/accountBackup");
const entry = (name, token = name) => ({name,enabled:true,priority:0,authJson:{tokens:{access_token:token,refresh_token:'refresh-'+token}}});
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'profile-transfer-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;
}

test("encrypted export/import recreates profiles under destination paths and validates access", async (t) => {
 const source=await fixture(t), destination=await fixture(t);
 await fs.writeFile(path.join(source,'auth.json'),JSON.stringify(entry('Work').authJson));
 const exported=await collectExportEntries([{id:'source-id',name:'Work',enabled:true,priority:4,codexHome:source,email:'test@example.invalid'}]);
 const backup=parseAccountBackup(await decryptBackup(await encryptBackup({version:1,accounts:exported.entries},'password for fixture'),'password for fixture'));
 let saved=[];
 const result=await importProfileEntries(backup,destination,[],async accounts=>{saved=accounts;},async()=>({status:'ready',email:'test@example.invalid'}));
 assert.equal(result.imported.length,1);assert.equal(saved[0].importStatus,'ready');
 assert.ok(saved[0].codexHome.startsWith(path.join(destination,'profiles')));assert.notEqual(saved[0].id,'source-id');
 assert.equal(JSON.parse(await fs.readFile(path.join(saved[0].codexHome,'auth.json'))).tokens.access_token,'Work');
 const repeated=await importProfileEntries(backup,destination,saved,async()=>assert.fail('duplicate import must not modify stored profiles'),async()=>assert.fail('duplicate must not refresh old tokens'));
 assert.equal(repeated.duplicates,1);
});
test("invalid, expired, and unreachable profiles are reported instead of false successful verification", async (t) => {
 const root=await fixture(t);let saved=[];
 const result=await importProfileEntries({version:1,accounts:[entry('Ready'),entry('Expired'),entry('Offline'),{...entry('Invalid'),authJson:{tokens:{}}}]},root,[],async accounts=>{saved=accounts;},async account=>{
  if(account.name==='Expired')throw new Error('401 refresh token expired');
  if(account.name==='Offline')throw new Error('spawn codex ENOENT');
  return {status:'ready'};
 });
 assert.deepEqual(result.imported.map(item=>item.status),['ready','needsLogin','unverified']);assert.equal(result.invalid,1);assert.equal(saved.length,3);
 assert.match(saved[2].importReason,/Install/);
});
test("failed writes do not leave a profile with orphan credentials", async (t) => {
 const root=await fixture(t);
 const result=await importProfileEntries({version:1,accounts:[entry('Work')]},root,[],async()=>{throw new Error('store unavailable');},async()=>({status:'ready'}));
 assert.equal(result.failed,1);assert.deepEqual(await fs.readdir(path.join(root,'profiles')),[]);
});
test("export reports profiles with missing credentials instead of silently making an empty backup", async (t) => {
 const root=await fixture(t);
 const result=await collectExportEntries([{name:'Missing',codexHome:root}]);assert.deepEqual(result.entries,[]);assert.deepEqual(result.skipped,['Missing']);
 assert.match(classifyImportFailure(new Error('401 invalid token')).reason,/Re-authenticate/);
});
