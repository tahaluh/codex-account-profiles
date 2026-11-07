/** Windows executable lookup is handled by VS Code's cross-spawn support for .cmd. */
export function windowsLauncher(execPath: string, scriptPath: string, fallback?: string): string {
  const literal = (value: string) => {
    if (/["\r\n]/.test(value)) throw new Error("Unsupported characters in the Codex launcher path.");
    return value.replace(/%/g, "%%");
  };
  return ["@echo off", "setlocal DisableDelayedExpansion", 'set "ELECTRON_RUN_AS_NODE=1"',
    ...(fallback ? [`set "CODEX_ACCOUNT_PROFILES_FALLBACK_CLI=${literal(fallback)}"`] : []),
    `"${literal(execPath)}" "${literal(scriptPath)}" %*`, "exit /b %ERRORLEVEL%", ""].join("\r\n");
}
