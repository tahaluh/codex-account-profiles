const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { promises: fs } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");
const test = require("node:test");
const { runtimeDataDir } = require("../bin/data-dir");

const launcher = path.resolve(__dirname, "../bin/codex-account-profiles");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(read, predicate = Boolean) {
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    let value;
    try { value = await read(); } catch {}
    if (predicate(value)) return value;
    await delay(20);
  }
  assert.fail("Timed out waiting for launcher");
}
async function fixture(t, extraEnv = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-regression-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = path.join(root, "data");
  const shared = path.join(root, "shared");
  const bin = path.join(root, "bin");
  for (const directory of [data, shared, bin]) await fs.mkdir(directory);
  const accounts = [];
  for (const id of ["first", "second"]) {
    const codexHome = path.join(root, id);
    await fs.mkdir(codexHome);
    await fs.writeFile(path.join(codexHome, "auth.json"), JSON.stringify({ fakeAccount: id }));
    accounts.push({ id, codexHome, enabled: true });
  }
  await fs.writeFile(path.join(shared, "auth.json"), '{"untouched":true}');
  await fs.writeFile(path.join(data, "accounts.json"), JSON.stringify({ accounts }));
  await fs.writeFile(path.join(bin, "codex"), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.CODEX_HOME;
const account = path.basename(home);
if (!process.argv.includes('app-server')) {
  console.log(JSON.stringify({ home, sessions: fs.realpathSync(path.join(home, 'sessions')), args: process.argv.slice(2) }));
  process.exit(0);
}
const threads = new Set();
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
 const m = JSON.parse(line);
 if (m.method === 'initialize') return send({id:m.id,result:{}});
 if (m.method === 'account/rateLimits/read') return send({id:m.id,result:{primary:{usedPercent:0}}});
 if (m.method === 'thread/start' || m.method === 'thread/fork') {
  const id = m.method === 'thread/fork' ? 'chat-fork' : 'chat-new';
  threads.add(id); return send({id:m.id,result:{thread:{id}}});
 }
 if (m.method === 'thread/read') {
  if (process.env.UNSAVED_THREAD === '1') return send({id:m.id,error:{code:-32600,message:'No rollout found'}});
  return send({id:m.id,result:{thread:{id:m.params.threadId}}});
 }
 if (m.method === 'thread/resume') {
  fs.writeFileSync(path.join(process.env.TEST_ROOT, 'resume-' + account), 'received');
  return setTimeout(() => {
   if (process.env.FAIL_RESTORE === account) return send({id:m.id,error:{code:-32603,message:'Restore failed'}});
   threads.add(m.params.threadId); send({id:m.id,result:{thread:{id:m.params.threadId}}});
  }, Number(process.env.RESTORE_DELAY || 0));
 }
 if (m.method === 'turn/start') {
  if (m.params.reject || !threads.has(m.params.threadId)) return send({id:m.id,error:{code:-32600,message:'Turn rejected'}});
  send({id:m.id,result:{turn:{id:'t1'}}});
  send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:'t1',status:'completed'}}});
 }
});
`, { mode: 0o755 });
  const launch = async (instance, account = "first", args = ["app-server"]) => {
    const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      CODEX_SHARED_HOME: shared, CODEX_ACCOUNT_PROFILES_DATA: data,
      CODEX_ACCOUNT_PROFILES_INSTANCE: instance, CODEX_ACCOUNT_PROFILES_ACCOUNT_ID: account,
      TEST_ROOT: root, ...extraEnv };
    const state = runtimeDataDir(data, env);
    const child = spawn(process.execPath, [launcher, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    const messages = [], errors = [];
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => messages.push(JSON.parse(line)));
    child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
    t.after(async () => {
      child.stdin.end();
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    });
    const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
    const response = (id) => waitFor(() => messages.find((m) => m.id === id));
    if (args.includes("app-server")) {
      send({ id: 1, method: "initialize", params: {} });
      assert.ok((await response(1)).result);
      send({ method: "initialized" });
    }
    return { child, messages, errors, state, send, response };
  };
  const requestSwitch = async (client) => {
    await fs.writeFile(path.join(client.state, "switch-request.json"), JSON.stringify({ accountId: "second" }));
  };
  const result = (client) => waitFor(async () => JSON.parse(await fs.readFile(path.join(client.state, "switch-result.json"), "utf8")));
  return { root, shared, data, accounts, launch, requestSwitch, result };
}

test("new and forked conversations survive a switch; success waits for every resume acknowledgement", async (t) => {
  const f = await fixture(t, { RESTORE_DELAY: "750" });
  const c = await f.launch("window-a");
  c.send({ id: 2, method: "thread/start", params: {} });
  assert.equal((await c.response(2)).result.thread.id, "chat-new");
  c.send({ id: 3, method: "thread/fork", params: { threadId: "chat-new" } });
  await c.response(3);
  await f.requestSwitch(c);
  await waitFor(() => fs.access(path.join(f.root, "resume-second")).then(() => true));
  await delay(350);
  await assert.rejects(fs.access(path.join(c.state, "switch-result.json")));
  assert.equal((await f.result(c)).success, true);
  for (const [id, threadId] of [[4, "chat-new"], [5, "chat-fork"]]) {
    c.send({ id, method: "turn/start", params: { threadId } });
    assert.ok((await c.response(id)).result);
  }
});

test("a rejected turn/start does not block a queued account switch", async (t) => {
  const f = await fixture(t);
  const c = await f.launch("window-a");
  c.send({ id: 2, method: "turn/start", params: { threadId: "missing", reject: true } });
  assert.ok((await c.response(2)).error);
  await f.requestSwitch(c);
  assert.equal((await f.result(c)).success, true);
});

test("a resume error rejects the switch and restores the previous account and conversation", async (t) => {
  const f = await fixture(t, { FAIL_RESTORE: "second" });
  const c = await f.launch("window-a");
  c.send({ id: 2, method: "thread/start", params: {} });
  await c.response(2);
  await f.requestSwitch(c);
  assert.equal((await f.result(c)).success, false);
  const current = JSON.parse(await fs.readFile(path.join(c.state, "current-account.json"), "utf8"));
  assert.equal(current.accountId, "first");
  await fs.access(path.join(f.root, "resume-first"));
  c.send({ id: 3, method: "turn/start", params: { threadId: "chat-new" } });
  assert.ok((await c.response(3)).result);
});

test("two windows run with separate credentials and switch channels while preserving shared auth", async (t) => {
  const f = await fixture(t);
  const a = await f.launch("window-a");
  const b = await f.launch("window-b");
  assert.notEqual(a.state, b.state);
  const registry = JSON.parse(await fs.readFile(path.join(f.data, "accounts.json"), "utf8"));
  assert.equal(Object.hasOwn(registry, "forcedAccountId"), false, "window preferences must not rewrite the shared registry");
  await f.requestSwitch(a);
  assert.equal((await f.result(a)).success, true);
  const other = JSON.parse(await fs.readFile(path.join(b.state, "current-account.json"), "utf8"));
  assert.equal(other.accountId, "first");
  assert.equal(await fs.readFile(path.join(f.shared, "auth.json"), "utf8"), '{"untouched":true}');
  for (const account of f.accounts) {
    assert.equal(JSON.parse(await fs.readFile(path.join(account.codexHome, "auth.json"))).fakeAccount, account.id);
    assert.equal(await fs.realpath(path.join(account.codexHome, "sessions")), path.join(f.shared, "sessions"));
  }
});

test("terminal launcher uses selected account credentials and the same shared conversations", async (t) => {
  const f = await fixture(t);
  const c = await f.launch("terminal-a", "second", []);
  const value = await waitFor(() => c.messages[0]);
  assert.equal(value.home, f.accounts[1].codexHome);
  assert.equal(value.sessions, path.join(f.shared, "sessions"));
  assert.ok(value.args.includes(`sqlite_home=${JSON.stringify(f.shared)}`));
});


test("an unsaved conversation cancels the switch before stopping its live backend", async (t) => {
  const f = await fixture(t, { UNSAVED_THREAD: "1" });
  const c = await f.launch("window-a");
  const beforePid = await fs.readFile(path.join(c.state, "codex.pid"), "utf8");
  c.send({ id: 2, method: "thread/start", params: {} });
  await c.response(2);
  await f.requestSwitch(c);
  assert.equal((await f.result(c)).success, false);
  assert.equal(await fs.readFile(path.join(c.state, "codex.pid"), "utf8"), beforePid);
  c.send({ id: 3, method: "turn/start", params: { threadId: "chat-new" } });
  assert.ok((await c.response(3)).result);
});
