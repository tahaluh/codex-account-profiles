// Offline protocol smoke test: synthetic history only, no model prompt or real account credentials.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { createInterface } = require("node:readline");
const { runtimeDataDir } = require("../bin/data-dir");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-native-profile-"));
  let child;
  try {
    for (const name of ["shared", "data", "first", "second"]) await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, "shared/config.toml"), 'cli_auth_credentials_store = "file"\ncheck_for_update_on_startup = false\n');
    const accounts = ["first", "second"].map(id => ({ id, enabled: true, codexHome: path.join(root, id) }));
    await fs.writeFile(path.join(root, "data/accounts.json"), JSON.stringify({ accounts }));
    const threadId = randomUUID(), stamp = new Date().toISOString();
    const dir = path.join(root, "shared/sessions", ...stamp.slice(0, 10).split("-"));
    await fs.mkdir(dir, { recursive: true });
    const rollout = path.join(dir, `rollout-${stamp.slice(0, 19).replace(/:/g, "-")}-${threadId}.jsonl`);
    const rows = [
      { type: "session_meta", payload: { id: threadId, timestamp: stamp, cwd: root, originator: "codex_cli_rs", cli_version: "0.164.0", source: "cli", model_provider: "openai" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Synthetic local history" }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] } },
    ];
    await fs.writeFile(rollout, rows.map(row => JSON.stringify({ timestamp: stamp, ...row }) + "\n").join(""));
    const env = { ...process.env, CODEX_SHARED_HOME: path.join(root, "shared"), CODEX_ACCOUNT_PROFILES_DATA: path.join(root, "data"), CODEX_ACCOUNT_PROFILES_INSTANCE: "native-smoke", CODEX_ACCOUNT_PROFILES_ACCOUNT_ID: "first" };
    const runtime = runtimeDataDir(env.CODEX_ACCOUNT_PROFILES_DATA, env);
    child = spawn(process.execPath, [path.resolve(__dirname, "../bin/codex-account-profiles"), "app-server"], { env, stdio: ["pipe", "pipe", "pipe"] });
    const replies = new Map();
    let diagnostics = "", id = 0;
    child.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
    createInterface({ input: child.stdout }).on("line", line => {
      const message = JSON.parse(line);
      const waiter = !message.method && replies.get(message.id);
      if (waiter) { replies.delete(message.id); waiter(message); }
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => { replies.delete(requestId); reject(new Error(`Timeout for ${method}: ${diagnostics}`)); }, 20000);
      replies.set(requestId, message => { clearTimeout(timeout); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
      child.stdin.write(JSON.stringify({ id: requestId, method, params }) + "\n");
    });
    await rpc("initialize", { clientInfo: { name: "profiles-offline-smoke", version: "1.0" } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    await rpc("thread/resume", { threadId, excludeTurns: true });
    const empty = await rpc("thread/start", { cwd: root });
    console.log("Native initialize, saved conversation, and empty tab: OK");
    const switchId = randomUUID();
    await fs.writeFile(path.join(runtime, "switch-request.json"), JSON.stringify({ accountId: "second", requestId: switchId, requestedAt: Date.now() }));
    let result;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try { result = JSON.parse(await fs.readFile(path.join(runtime, "switch-result.json"), "utf8")); } catch {}
      if (result?.requestId === switchId) break;
      await delay(30);
    }
    assert.equal(result?.success, true, JSON.stringify(result) + diagnostics);
    const conversation = await rpc("thread/read", { threadId, includeTurns: false });
    assert.equal(conversation.thread.id, threadId);
    console.log("Native account switch and preserved saved conversation: OK");
    // Extra threadId is ignored by this query, but makes the proxy ensure that
    // the empty client session has been re-established. It does not call a model.
    const loaded = await rpc("thread/loaded/list", { threadId: empty.thread.id });
    assert.ok(loaded.data?.length >= 2);
    console.log("Native empty session recreated on demand: OK");
  } finally {
    if (child) {
      child.stdin.end();
      await new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
