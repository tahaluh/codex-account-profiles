function createTurnLifecycle() {
  const turns = new Map();
  const requests = new Map();
  let sequence = 0;
  return {
    recordClientMessage(message) {
      if (message?.method !== "turn/start") return;
      const key = ++sequence;
      turns.set(key, { threadId: message.params?.threadId });
      if (message.id !== undefined) requests.set(message.id, key);
    },
    recordBackendMessage(message) {
      if (!message?.method && requests.has(message?.id)) {
        const key = requests.get(message.id);
        requests.delete(message.id);
        if (message.error || ["completed", "failed", "interrupted"].includes(message.result?.turn?.status)) turns.delete(key);
        else if (turns.has(key)) turns.get(key).turnId = message.result?.turn?.id;
      }
      if (message?.method === "turn/started") {
        const threadId = message.params?.threadId;
        const turnId = message.params?.turn?.id;
        const existing = [...turns.values()].find((turn) => turnId && turn.turnId === turnId
          || threadId && turn.threadId === threadId && !turn.turnId)
          || (!threadId && !turnId ? turns.values().next().value : undefined);
        if (existing) existing.turnId = turnId;
        else turns.set(++sequence, { threadId, turnId });
      }
      if (message?.method !== "turn/completed") return false;
      const threadId = message.params?.threadId;
      const turnId = message.params?.turn?.id;
      const entry = [...turns].find(([, turn]) => turnId && turn.turnId === turnId)
        || [...turns].find(([, turn]) => threadId && turn.threadId === threadId && !turn.turnId)
        || (!threadId && !turnId ? turns.entries().next().value : undefined);
      if (entry) turns.delete(entry[0]);
      return true;
    },
    reset() { turns.clear(); requests.clear(); },
    isIdle() { return turns.size === 0; },
  };
}

module.exports = { createTurnLifecycle };
