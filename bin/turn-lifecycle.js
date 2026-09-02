function createTurnLifecycle() {
  let activeTurns = 0;

  return {
    recordClientMessage(message) {
      if (message?.method === "turn/start") activeTurns += 1;
    },
    recordBackendMessage(message) {
      if (message?.method === "turn/completed") {
        activeTurns = Math.max(0, activeTurns - 1);
        return true;
      }
      return false;
    },
    isIdle() {
      return activeTurns === 0;
    },
  };
}

module.exports = { createTurnLifecycle };
