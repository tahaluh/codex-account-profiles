const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { terminalCommand } = require("../dist/terminalCommand");

test("PowerShell invokes quoted paths with & and literal escaping, including login", () => {
  const result = terminalCommand("C:\\Program Files\\Microsoft VS Code\\Code.exe", ["C:\\Users\\O'Brien\\extension\\bin\\codex-account-profiles", "login"], "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(result, "& 'C:\\Program Files\\Microsoft VS Code\\Code.exe' 'C:\\Users\\O''Brien\\extension\\bin\\codex-account-profiles' 'login'");
});
test("PowerShell shell detection works on Linux and for case-insensitive executable names", () => {
  for (const shell of ["/usr/bin/pwsh", "C:\\PowerShell\\PWSH.EXE"]) {
    assert.equal(terminalCommand("/app/$code", ["literal $(command); `text`", "login"], shell), "& '/app/$code' 'literal $(command); `text`' 'login'");
  }
});
test("POSIX commands preserve argument boundaries and do not evaluate shell substitutions", { skip: process.platform === "win32" }, () => {
  const args = ["login", "a space", "O'Brien", "$HOME", "$(printf BAD)", "a; b", "`printf BAD`"];
  const command = terminalCommand(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args], "/bin/bash");
  assert.deepEqual(JSON.parse(execFileSync("bash", ["-c", command], { encoding: "utf8" })), args);
});
test("Command Prompt retains quoted paths and rejects expandable unsafe path input", () => {
  assert.equal(terminalCommand("C:\\Program Files\\Code.exe", ["C:\\plugin\\launcher", "login"], "C:\\Windows\\System32\\cmd.exe"), '"C:\\Program Files\\Code.exe" "C:\\plugin\\launcher" "login"');
  assert.throws(() => terminalCommand("C:\\%TEMP%\\Code.exe", ["login"], "cmd.exe"), /PowerShell/);
});
