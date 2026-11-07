const test=require('node:test');
const assert=require('node:assert/strict');
const {windowsLauncher}=require('../dist/nativeLauncher');

test('Windows native integration uses a batch entrypoint with Node mode and the bundled CLI fallback',()=>{
 const wrapper=windowsLauncher('C:\\Program Files\\Code.exe','C:\\Users\\Name %value%\\bin\\codex-account-profiles','C:\\extensions\\codex.exe');
 assert.match(wrapper,/setlocal DisableDelayedExpansion/);
 assert.match(wrapper,/ELECTRON_RUN_AS_NODE=1/);
 assert.ok(wrapper.includes('"C:\\Program Files\\Code.exe" "C:\\Users\\Name %%value%%\\bin\\codex-account-profiles" %*'));
 assert.match(wrapper,/CODEX_ACCOUNT_PROFILES_FALLBACK_CLI=/);
 assert.throws(()=>windowsLauncher('bad\ncommand','file'),/Unsupported/);
});
