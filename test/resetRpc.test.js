const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { readRateLimits, consumeResetCredit } = require("../dist/codexClient");

test("reset RPC uses the selected profile and passes the official idempotency and credit fields", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-reset-rpc-"));
  const previousPath = process.env.PATH;
  t.after(async () => { process.env.PATH = previousPath; await fs.rm(root, { recursive: true, force: true }); });
  await fs.writeFile(path.join(root, "codex"), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(!m.id)return;
 let result={};
 if(m.method==='account/rateLimits/read')result={primary:{usedPercent:50,resetsAt:1000000},rateLimitResetCredits:{availableCount:1,credits:[{id:'reset-1',resetType:'codexRateLimits',status:'available',grantedAt:100,expiresAt:200}]}};
 if(m.method==='account/rateLimitResetCredit/consume'){
  fs.writeFileSync(path.join(process.env.CODEX_HOME,'captured-reset.json'),JSON.stringify(m.params));
  result={outcome:'alreadyRedeemed'};
 }
 console.log(JSON.stringify({id:m.id,result}));
});
`, { mode: 0o755 });
  process.env.PATH = root + path.delimiter + previousPath;
  const account = { id: "test", codexHome: root };
  const limits = await readRateLimits(account);
  assert.equal(limits.rateLimitResetCredits.credits[0].expiresAt, 200);
  const outcome = await consumeResetCredit(account, "stable-attempt-id", "reset-1");
  assert.equal(outcome.outcome, "alreadyRedeemed");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "captured-reset.json"), "utf8")), { idempotencyKey: "stable-attempt-id", creditId: "reset-1" });
  await assert.rejects(consumeResetCredit(account, " ", "reset-1"), /attempt ID/);
});
