import { describe, it, expect } from "vitest";
import { estimateCreationCost, mulDecimalFloor, DEFAULT_RDK_PARAMS } from "../src/index";

describe("mulDecimalFloor", () => {
  it("multiplies by a decimal with integer math, flooring", () => {
    expect(mulDecimalFloor(10000000000n, "0.01")).toBe(100000000n);
    expect(mulDecimalFloor(100n, "0.01")).toBe(1n);
    expect(mulDecimalFloor(199n, "0.01")).toBe(1n); // floor(1.99)
    expect(mulDecimalFloor(50n, "0.01")).toBe(0n); // floor(0.5)
    expect(mulDecimalFloor(12345n, "1")).toBe(12345n);
  });

  it("rejects invalid decimals", () => {
    expect(() => mulDecimalFloor(1n, "abc")).toThrow();
  });
});

describe("estimateCreationCost", () => {
  it("computes the 1% burn from the default min stake", () => {
    const cost = estimateCreationCost({ stakeUqor: DEFAULT_RDK_PARAMS.minStakeForRollup });
    expect(cost.stakeUqor).toBe("10000000000");
    expect(cost.burnUqor).toBe("100000000"); // 100 QOR burned
    expect(cost.netStakeUqor).toBe("9900000000"); // 9,900 QOR net
    expect(cost.totalRequiredUqor).toBe("10000000000");
    expect(cost.burnRate).toBe("0.01");
  });

  it("honors an explicit (live) burn rate", () => {
    const cost = estimateCreationCost({ stakeUqor: "20000000000", burnRate: "0.025" });
    expect(cost.burnUqor).toBe("500000000");
    expect(cost.netStakeUqor).toBe("19500000000");
  });
});
