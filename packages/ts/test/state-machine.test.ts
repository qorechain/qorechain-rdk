import { describe, it, expect } from "vitest";
import {
  canPerformRollupAction,
  assertRollupAction,
  isBatchFinal,
  isChallengeWindowClosed,
  challengeWindowDeadline,
} from "../src/index";

describe("rollup lifecycle guards", () => {
  it("permits only valid creator transitions", () => {
    expect(canPerformRollupAction("pause", "active")).toBe(true);
    expect(canPerformRollupAction("pause", "paused")).toBe(false);
    expect(canPerformRollupAction("resume", "paused")).toBe(true);
    expect(canPerformRollupAction("stop", "active")).toBe(true);
    expect(canPerformRollupAction("stop", "paused")).toBe(true);
    expect(canPerformRollupAction("stop", "stopped")).toBe(false);
  });

  it("throws on an invalid transition", () => {
    expect(() => assertRollupAction("resume", "active")).toThrow();
    expect(() => assertRollupAction("pause", "active")).not.toThrow();
  });
});

describe("batch lifecycle", () => {
  it("marks finalized and rejected as terminal", () => {
    expect(isBatchFinal("finalized")).toBe(true);
    expect(isBatchFinal("rejected")).toBe(true);
    expect(isBatchFinal("submitted")).toBe(false);
    expect(isBatchFinal("challenged")).toBe(false);
  });

  it("computes the challenge-window deadline and closure", () => {
    expect(challengeWindowDeadline(1000, 604800)).toBe(605800);
    expect(isChallengeWindowClosed(1000, 604800, 605799)).toBe(false);
    expect(isChallengeWindowClosed(1000, 604800, 605800)).toBe(true);
  });
});
