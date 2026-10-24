const RESUME_KEYS = ["cwd", "model", "modelProvider", "approvalPolicy", "approvalsReviewer", "serviceTier", "sandbox", "config", "baseInstructions", "developerInstructions", "personality"];

function isMissingRollout(error) {
  return /no rollout|rollout.*not found|thread.*(?:not found|not loaded)|not.*persisted|not.*saved/i.test(error?.message || "");
}

function createConversationState() {
  const threads = new Map();
  const backendToClient = new Map();
  function attach(record, backendId) {
    if (record.backendId) backendToClient.delete(record.backendId);
    record.backendId = backendId;
    record.loaded = true;
    backendToClient.set(backendId, record.id);
  }
  return {
    remember(request, result) {
      const thread = result?.thread;
      if (!["thread/start", "thread/fork", "thread/resume"].includes(request.method) || !thread?.id) return;
      const id = request.method === "thread/resume" ? request.params?.threadId || thread.id : thread.id;
      const record = threads.get(id) || { id, hasTurns: request.method !== "thread/start", startParams: undefined };
      if (request.method === "thread/start") record.startParams = request.params || {};
      record.resumeParams = { ...record.resumeParams, threadId: thread.id, excludeTurns: true };
      for (const key of RESUME_KEYS) {
        if (request.params?.[key] !== undefined) record.resumeParams[key] = request.params[key];
      }
      if (thread.turns?.length) record.hasTurns = true;
      attach(record, thread.id);
      threads.set(id, record);
    },
    noteRequest(request) {
      if (request.method === "turn/start" && threads.has(request.params?.threadId)) threads.get(request.params.threadId).hasTurns = true;
    },
    remove(id) { const record = threads.get(id); if (record) backendToClient.delete(record.backendId); threads.delete(id); },
    resetLoaded() { for (const record of threads.values()) record.loaded = false; },
    records() { return [...threads.values()]; },
    get(id) { return threads.get(id); },
    attach,
    resume(record) { return { ...record.resumeParams, threadId: record.backendId || record.id, excludeTurns: true }; },
    toBackend(message) {
      if (!message.params?.threadId) return message;
      const record = threads.get(message.params.threadId);
      return record ? { ...message, params: { ...message.params, threadId: record.backendId } } : message;
    },
    toClient(message) {
      // Only protocol identity fields are mapped; prompt text and tool payloads stay untouched.
      const params = message.params;
      const threadId = backendToClient.get(params?.threadId);
      const paramThreadId = backendToClient.get(params?.thread?.id);
      const resultThreadId = backendToClient.get(message.result?.thread?.id);
      if (!threadId && !paramThreadId && !resultThreadId) return message;
      return { ...message,
        ...(params ? { params: { ...params,
          ...(threadId ? { threadId } : {}),
          ...(paramThreadId ? { thread: { ...params.thread, id: paramThreadId } } : {}),
        } } : {}),
        ...(resultThreadId ? { result: { ...message.result, thread: { ...message.result.thread, id: resultThreadId } } } : {}),
      };
    },
  };
}

module.exports = { createConversationState, isMissingRollout };
