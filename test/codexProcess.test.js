const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveCodexInvocation } = require("../bin/codex-process");

test("Windows npm .cmd resolves to JavaScript with no shell interpolation", () => {
  const files = new Set(['C:\\Users\\Test User\\npm\\codex.cmd', 'C:\\Users\\Test User\\npm\\node_modules\\@openai\\codex\\bin\\codex.js']);
  const invocation = resolveCodexInvocation(['app-server', '$x; & value'], { Path: 'C:\\Users\\Test User\\npm', ELECTRON_RUN_AS_NODE: '1' }, {
    platform: 'win32', execPath: 'C:\\VS Code\\Code.exe', exists: file => files.has(file),
  });
  assert.equal(invocation.command, 'C:\\VS Code\\Code.exe');
  assert.equal(invocation.args[2], 'C:\\Users\\Test User\\npm\\node_modules\\@openai\\codex\\bin\\codex.js');
  assert.equal(invocation.args.at(-1), '$x; & value');
  assert.equal(invocation.env.ELECTRON_RUN_AS_NODE, '1');
});
test("Node bootstrap clears Electron mode before the CLI starts and preserves every argument", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bootstrap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'entry with spaces.cjs');
  fs.writeFileSync(script, 'process.stdout.write(JSON.stringify({args:process.argv.slice(2),electron:process.env.ELECTRON_RUN_AS_NODE||null}));');
  const invocation = resolveCodexInvocation(['login', 'literal $(x); "& value'], { Path: 'C:\\npm' }, { platform: 'win32', exists: file => /codex\.cmd$|codex\.js$/.test(file) });
  const args = [...invocation.args]; args[2] = script;
  const result = JSON.parse(execFileSync(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }));
  assert.deepEqual(result, {args:['login', 'literal $(x); "& value'], electron:null});
});
test("native Windows executable is preferred and installation errors are actionable", () => {
  const invocation = resolveCodexInvocation(['app-server'], { PATH: 'C:\\tools', ELECTRON_RUN_AS_NODE:'1' }, { platform:'win32', exists: file => file.endsWith('codex.exe') });
  assert.equal(invocation.command,'C:\\tools\\codex.exe');
  assert.equal(invocation.env.ELECTRON_RUN_AS_NODE,undefined);
  assert.throws(() => resolveCodexInvocation([], {PATH:'C:\\missing'}, {platform:'win32',exists:()=>false}), /npm install -g/);
});

test("official bundled CLI is used when npm Codex is not installed on the destination", () => {
  const executable='C:\\VSCode Extensions\\openai.chatgpt\\bin\\windows-x86_64\\codex.exe';
  const resolved=resolveCodexInvocation(['app-server'],{Path:'C:\\missing',CODEX_ACCOUNT_PROFILES_FALLBACK_CLI:executable},{platform:'win32',exists:file=>file===executable});
  assert.equal(resolved.command,executable);
  assert.deepEqual(resolved.args,['app-server']);
  const linux=resolveCodexInvocation(['app-server'],{PATH:'/missing',CODEX_ACCOUNT_PROFILES_FALLBACK_CLI:'/extension/codex'},{platform:'linux',exists:file=>file==='/extension/codex'});
  assert.equal(linux.command,'/extension/codex');
});
