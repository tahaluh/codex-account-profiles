const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Windows cannot directly spawn npm's codex.cmd without a shell. Resolve the
// npm JavaScript entrypoint instead; never pass prompts or paths through cmd.exe.
function resolveCodexInvocation(args, env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const execPath = options.execPath || process.execPath;
  const exists = options.exists || ((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } });
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const fallback = env.CODEX_ACCOUNT_PROFILES_FALLBACK_CLI;
  if (platform !== "win32") {
    const hasCommand = (env.PATH || "").split(path.delimiter).some(directory => directory && exists(path.join(directory, "codex")));
    return { command: !hasCommand && fallback && exists(fallback) ? fallback : "codex", args, env: childEnv };
  }
  const paths = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] || "";
  for (let directory of paths.split(";")) {
    directory = directory.trim().replace(/^"|"$/g, "");
    if (!directory) continue;
    const exe = path.win32.join(directory, "codex.exe");
    if (exists(exe)) return { command: exe, args, env: childEnv };
    if (!exists(path.win32.join(directory, "codex.cmd")) && !exists(path.win32.join(directory, "codex.ps1"))) continue;
    const script = path.win32.join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (exists(script)) {
      // Electron's Node mode is needed only for the bootstrap process. Clear it
      // before loading the CLI so browser authentication gets a normal environment.
      const bootstrap = 'delete process.env.ELECTRON_RUN_AS_NODE; import(require("node:url").pathToFileURL(process.argv[1]).href).catch(() => { process.stderr.write("Could not load the installed Codex CLI. Reinstall @openai/codex.\\n"); process.exitCode = 1; });';
      return { command: execPath, args: ["-e", bootstrap, script, ...args], env: { ...childEnv, ELECTRON_RUN_AS_NODE: "1" } };
    }
    if (fallback && exists(fallback)) return { command: fallback, args, env: childEnv };
    throw new Error("Codex npm launcher found, but its CLI entrypoint is missing. Run npm install -g @openai/codex@latest on this computer, then reload VS Code.");
  }
  if (fallback && exists(fallback)) return { command: fallback, args, env: childEnv };
  throw new Error("Codex CLI was not found on PATH. Run npm install -g @openai/codex@latest on this computer, then reload VS Code.");
}
function spawnCodex(args, options = {}) {
  const invocation = resolveCodexInvocation(args, options.env || process.env);
  return spawn(invocation.command, invocation.args, { ...options, env: invocation.env, shell: false });
}
module.exports = { spawnCodex, resolveCodexInvocation };
