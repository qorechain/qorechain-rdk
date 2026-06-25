import { describe, it, expect } from "vitest";
import {
  buildDaBlob,
  isDaBackendAvailable,
  assertDaBackendAvailable,
} from "../src/index";

describe("native DA blob assembly", () => {
  it("builds a blob with a sha256 data hash", () => {
    const blob = buildDaBlob({ data: new Uint8Array([1, 2, 3]) });
    expect(blob.size).toBe(3);
    expect(blob.dataHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("accepts hex input", () => {
    const blob = buildDaBlob({ data: "0x010203" });
    expect(blob.size).toBe(3);
  });

  it("rejects a blob over the size limit", () => {
    expect(() => buildDaBlob({ data: new Uint8Array(5), maxBlobSize: 4 })).toThrow(/exceeding/);
  });
});

describe("DA backend availability", () => {
  it("treats only native as available today", () => {
    expect(isDaBackendAvailable("native")).toBe(true);
    expect(isDaBackendAvailable("celestia")).toBe(false);
    expect(isDaBackendAvailable("both")).toBe(false);
  });

  it("throws a clear message for not-yet-active backends", () => {
    expect(() => assertDaBackendAvailable("celestia")).toThrow(/not yet active/i);
    expect(() => assertDaBackendAvailable("native")).not.toThrow();
  });
});
