import { describe, it, expect } from "vitest";
import { qorToUqor, uqorToQor } from "../src/index";

describe("qorToUqor", () => {
  it("converts whole QOR to uqor", () => {
    expect(qorToUqor("1")).toBe("1000000");
    expect(qorToUqor(10000)).toBe("10000000000");
    expect(qorToUqor("0")).toBe("0");
  });

  it("converts fractional QOR exactly", () => {
    expect(qorToUqor("1.5")).toBe("1500000");
    expect(qorToUqor("0.000001")).toBe("1");
    expect(qorToUqor("0.1")).toBe("100000");
  });

  it("rejects too many fractional digits and bad input", () => {
    expect(() => qorToUqor("0.0000001")).toThrow();
    expect(() => qorToUqor("abc")).toThrow();
    expect(() => qorToUqor("-1")).toThrow();
  });
});

describe("uqorToQor", () => {
  it("converts uqor to QOR, trimming trailing zeros", () => {
    expect(uqorToQor("1000000")).toBe("1");
    expect(uqorToQor("1500000")).toBe("1.5");
    expect(uqorToQor("1")).toBe("0.000001");
    expect(uqorToQor(10000000000n)).toBe("10000");
  });

  it("round-trips with qorToUqor", () => {
    for (const v of ["1", "1.5", "0.000001", "12345.678901", "10000"]) {
      expect(uqorToQor(qorToUqor(v))).toBe(v);
    }
  });

  it("rejects non-integer uqor strings", () => {
    expect(() => uqorToQor("1.5")).toThrow();
    expect(() => uqorToQor("xyz")).toThrow();
  });
});
