const test = require("node:test");
const assert = require("node:assert/strict");
const { confirmedLimitBoundary } = require("../dist/quotaPolicy");
const { remainingPercent } = require("../dist/codexClient");

const limits = {
  rateLimitsByLimitId: {
    usage: {
      primary: { windowDurationMins: 300, usedPercent: 96 },
      secondary: { windowDurationMins: 10080, usedPercent: 40 },
    },
  },
};

test("remainingPercent uses the smallest remaining limit", () => {
  assert.equal(remainingPercent(limits), 4);
  assert.equal(remainingPercent({
    rateLimitsByLimitId: {
      usage: {
        primary: { windowDurationMins: 300, usedPercent: 0 },
        secondary: { windowDurationMins: 10080, usedPercent: 0 },
      },
      images: {
        primary: { windowDurationMins: 300, usedPercent: 12 },
      },
    },
  }), 88);
});

test("automatic switching requires a confirmed limit followed by a turn boundary", () => {
  assert.equal(confirmedLimitBoundary(false, 0, 200, 0), undefined);
  assert.equal(confirmedLimitBoundary(true, 200, 199, 0), undefined);
  assert.equal(confirmedLimitBoundary(true, 200, 201, 201), undefined);
  assert.equal(confirmedLimitBoundary(true, 200, 201, 0), 201);
});
