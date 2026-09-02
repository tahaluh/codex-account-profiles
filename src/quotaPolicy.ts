export function confirmedLimitBoundary(
  trigger: boolean,
  triggerAt: number,
  finishedAt: number,
  lastDecision: number,
): number | undefined {
  if (!trigger || triggerAt <= 0 || finishedAt < triggerAt || finishedAt <= lastDecision) return undefined;
  return finishedAt;
}
