const test = require("node:test");
const assert = require("node:assert/strict");
const { remainingForWindow, shouldSwitchForThresholds } = require("../dist/quotaPolicy");

const limits = {
  rateLimitsByLimitId: {
    usage: {
      primary: { windowDurationMins: 300, usedPercent: 96 },
      secondary: { windowDurationMins: 10080, usedPercent: 40 },
    },
  },
};

test("remainingForWindow returns remaining quota for a specific window", () => {
  assert.equal(remainingForWindow(limits, 300), 4);
  assert.equal(remainingForWindow(limits, 10080), 60);
  assert.equal(remainingForWindow(limits, 30), undefined);
});

test("shouldSwitchForThresholds checks hourly and weekly thresholds independently", () => {
  assert.equal(shouldSwitchForThresholds(limits, 5, 1), true);
  assert.equal(shouldSwitchForThresholds(limits, 3, 1), false);
  assert.equal(shouldSwitchForThresholds(limits, 3, 60), true);
});
