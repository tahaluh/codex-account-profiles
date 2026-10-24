export interface PendingSwitch { accountId: string; requestedAt: number; requestId?: string }
export interface SwitchResult { accountId?: string; requestId?: string; success?: boolean; completedAt?: number; error?: string }
export interface LauncherState { updatedAt?: number; phase?: string; accountId?: string; pid?: number; activeTurns?: boolean }
export interface SwitchProgress { requestId?: string; accountId?: string; updatedAt?: number; phase?: string }

export function evaluateSwitch(pending: PendingSwitch, current: { accountId?: string; startedAt?: number } | undefined,
  result: SwitchResult | undefined, launcher: LauncherState | undefined, progress: SwitchProgress | undefined, now = Date.now()) {
  const matchingResult = result?.accountId === pending.accountId && (pending.requestId
    ? result.requestId === pending.requestId : (result.completedAt || 0) >= pending.requestedAt);
  if (matchingResult) return { done: true, error: result?.success ? undefined : result?.error || "Profile switch failed. The previous account is still active." };
  if (current?.accountId === pending.accountId && (current.startedAt || 0) >= pending.requestedAt) return { done: true };
  const live = launcher && now - (launcher.updatedAt || 0) < 10000;
  const matchingProgress = progress && (pending.requestId ? progress.requestId === pending.requestId : progress.accountId === pending.accountId);
  if (live && launcher.phase === "busy" && launcher.activeTurns !== false) return { done: false, label: "Waiting for current response" };
  if (live && launcher.phase === "busy" && launcher.activeTurns === false && now - pending.requestedAt >= 60000) {
    return { done: true, error: "Codex is not answering a pending operation. Reload the VS Code window and retry the profile switch." };
  }
  if (live && matchingProgress && now - (progress.updatedAt || 0) < 90000) {
    return { done: false, label: progress.phase === "waiting" ? "Waiting for current response" : "Switching account" };
  }
  if (now - pending.requestedAt < 15000) return { done: false, label: "Connecting to Codex" };
  return { done: true, error: live
    ? "Codex did not complete the profile switch. Retry, or reload the VS Code window if it persists."
    : "The Codex launcher is not connected to this window. Reload the VS Code window, open Codex, and retry." };
}
