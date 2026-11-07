/** Build a command for the terminal's actual shell, rather than the host OS. */
export function terminalCommand(executable: string, args: string[], shellPath: string): string {
  const shell = shellPath.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, "") || "";
  const values = [executable, ...args];
  if (shell === "pwsh" || shell === "powershell") {
    // A quoted executable is a string expression in PowerShell until invoked
    // with &: doubling single quotes preserves literal paths and arguments.
    return "& " + values.map(value => "'" + value.replace(/'/g, "''") + "'").join(" ");
  }
  if (shell === "cmd") {
    // Windows paths cannot contain quotes. Reject command metacharacters that
    // cannot be represented safely here instead of expanding caller input.
    if (values.some(value => /["%\r\n]/.test(value))) throw new Error("This path cannot be launched safely in Command Prompt. Select PowerShell as the terminal profile.");
    return values.map(value => `"${value}"`).join(" ");
  }
  return values.map(value => "'" + value.replace(/'/g, "'\\''") + "'").join(" ");
}
