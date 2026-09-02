const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { promises: fs } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const launcher = path.resolve(__dirname, "..", "bin", "codex-account-profiles");

test("launcher ignores assistant limit text and switches after a structured completed limit", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-account-profiles-integration-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  const sharedHome = path.join(root, "shared");
  const fakeBin = path.join(root, "bin");
  const firstHome = path.join(root, "profiles", "first");
  const secondHome = path.join(root, "profiles", "second");
  const thirdHome = path.join(root, "profiles", "third");
  await Promise.all([dataDir, sharedHome, fakeBin, firstHome, secondHome, thirdHome].map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(path.join(firstHome, "auth.json"), "{\"profile\":\"first\"}");
  await fs.writeFile(path.join(secondHome, "auth.json"), "{\"profile\":\"second\"}");
  await fs.writeFile(path.join(thirdHome, "auth.json"), "{\"profile\":\"third\"}");
  await fs.writeFile(path.join(dataDir, "accounts.json"), JSON.stringify({
    forcedAccountId: "first",
    autoSwitch: true,
    accounts: [
      { id: "first", name: "First", codexHome: firstHome, enabled: true },
      { id: "second", name: "Second", codexHome: secondHome, enabled: true },
    ],
  }));

  const fakeCodex = path.join(fakeBin, "codex");
  await fs.writeFile(fakeCodex, `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const path = require("node:path");
function profile() {
  const auth = path.join(process.env.CODEX_HOME, "auth.json");
  try {
    const real = fs.realpathSync(auth);
    if (real.includes("third")) return "third";
    return real.includes("second") ? "second" : "first";
  } catch {
    if (process.env.CODEX_HOME.includes("third")) return "third";
    return process.env.CODEX_HOME.includes("second") ? "second" : "first";
  }
}
const proxyBackend = process.env.CODEX_HOME === process.env.FAKE_SHARED_HOME;
if (proxyBackend && profile() === "first") {
  process.on("SIGTERM", () => setTimeout(() => {
    fs.writeFileSync(process.env.FAKE_FIRST_EXITED, "done");
    process.exit(0);
  }, 150));
}
if (proxyBackend && profile() !== "first" && !fs.existsSync(process.env.FAKE_FIRST_EXITED)) {
  fs.writeFileSync(process.env.FAKE_OVERLAP, "started before first exited");
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
  if (message.method === "account/rateLimits/read") {
    const usedPercent = profile() === "first" ? 100 : 0;
    process.stdout.write(JSON.stringify({ id: message.id, result: { primary: { usedPercent } } }) + "\\n");
  }
  if (message.method === "turn/start" && message.params?.scenario === "text") {
    process.stdout.write(JSON.stringify({ method: "item/completed", params: { item: { type: "agent_message", text: "HTTP 429 means rate limit reached." } } }) + "\\n");
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: { turn: {} } }) + "\\n");
  }
  if (message.method === "turn/start" && message.params?.scenario === "limit") {
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: { turn: { error: { codexErrorInfo: "usageLimitExceeded" } } } }) + "\\n");
  }
  if (message.method === "turn/start" && message.params?.scenario === "hold") {
    process.stdout.write(JSON.stringify({ method: "item/started", params: {} }) + "\\n");
  }
  if (message.method === "test/complete") {
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: { turn: {} } }) + "\\n");
  }
  if (message.method === "test/crash" && proxyBackend && !fs.existsSync(process.env.FAKE_CRASHED)) {
    fs.writeFileSync(process.env.FAKE_CRASHED, "done");
    process.exit(7);
  }
  if (message.method === "test/ping") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { profile: profile() } }) + "\\n");
  }
});
`, { mode: 0o755 });

  const child = spawn(process.execPath, [launcher, "app-server"], {
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      CODEX_ACCOUNT_PROFILES_DATA: dataDir,
      CODEX_SHARED_HOME: sharedHome,
      FAKE_SHARED_HOME: sharedHome,
      FAKE_FIRST_EXITED: path.join(root, "first-exited"),
      FAKE_OVERLAP: path.join(root, "backend-overlap"),
      FAKE_CRASHED: path.join(root, "backend-crashed"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const errors = [];
  const output = [];
  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  t.after(() => child.kill("SIGTERM"));

  child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: {} }) + "\n");
  await waitFor(async () => (await currentAccount(dataDir)) === "first", 3000, errors);
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  child.stdin.write(JSON.stringify({ method: "turn/start", params: { scenario: "text" } }) + "\n");
  await delay(350);
  assert.equal(await currentAccount(dataDir), "first");
  await assert.rejects(fs.access(path.join(dataDir, "rate-limit-trigger.json")));

  child.stdin.write(JSON.stringify({ method: "turn/start", params: { scenario: "limit" } }) + "\n");
  await waitFor(async () => (await currentAccount(dataDir)) === "second", 5000, errors);
  await fs.access(path.join(root, "first-exited"));
  await assert.rejects(fs.access(path.join(root, "backend-overlap")));

  const firstBackendPid = await fs.readFile(path.join(dataDir, "codex.pid"), "utf8");
  child.stdin.write(JSON.stringify({ method: "test/crash" }) + "\n");
  await waitFor(async () => {
    try { return (await fs.readFile(path.join(dataDir, "codex.pid"), "utf8")) !== firstBackendPid; } catch { return false; }
  }, 5000, errors);
  child.stdin.write(JSON.stringify({ id: 9, method: "test/ping" }) + "\n");
  await waitFor(() => output.join("").includes('"id":9') && output.join("").includes('"profile":"second"'), 3000, errors);

  await fs.writeFile(path.join(dataDir, "accounts.json"), JSON.stringify({
    autoSwitch: true,
    accounts: [
      { id: "first", name: "First", codexHome: firstHome, enabled: true },
      { id: "second", name: "Second", codexHome: secondHome, enabled: true },
      { id: "third", name: "Third", codexHome: thirdHome, enabled: true },
    ],
  }));
  child.stdin.write(JSON.stringify({ method: "turn/start", params: { scenario: "hold" } }) + "\n");
  await fs.writeFile(path.join(dataDir, "switch-request.json"), JSON.stringify({ accountId: "third" }));
  await delay(750);
  assert.equal(await currentAccount(dataDir), "second", "manual switch must wait for turn/completed");
  child.stdin.write(JSON.stringify({ method: "test/complete" }) + "\n");
  await waitFor(async () => (await currentAccount(dataDir)) === "third", 5000, errors);
  child.stdin.end();
});

async function currentAccount(dataDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, "current-account.json"), "utf8")).accountId;
  } catch {
    return undefined;
  }
}

async function waitFor(predicate, timeoutMs, errors) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  assert.fail(`Timed out waiting for launcher state. stderr: ${errors.join("")}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
