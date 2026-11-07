"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.windowsLauncher = windowsLauncher;
/** Windows executable lookup is handled by VS Code's cross-spawn support for .cmd. */
function windowsLauncher(execPath, scriptPath, fallback) {
    const literal = (value) => {
        if (/["\r\n]/.test(value))
            throw new Error("Unsupported characters in the Codex launcher path.");
        return value.replace(/%/g, "%%");
    };
    return ["@echo off", "setlocal DisableDelayedExpansion", 'set "ELECTRON_RUN_AS_NODE=1"',
        ...(fallback ? [`set "CODEX_ACCOUNT_PROFILES_FALLBACK_CLI=${literal(fallback)}"`] : []),
        `"${literal(execPath)}" "${literal(scriptPath)}" %*`, "exit /b %ERRORLEVEL%", ""].join("\r\n");
}
//# sourceMappingURL=nativeLauncher.js.map