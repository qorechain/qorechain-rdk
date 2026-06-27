import { describe, it, expect } from "vitest";
import {
  CROSS_VM_PRECOMPILE,
  CROSS_VM_DEFAULT_SIGNATURE,
  functionSelector,
  encodeCrossVmCalldata,
  encodeDynamicTuple,
} from "../src/index";

describe("crossvm precompile helpers", () => {
  it("exposes the fixed precompile address", () => {
    expect(CROSS_VM_PRECOMPILE).toBe("0x0000000000000000000000000000000000000901");
  });

  it("derives a 4-byte selector from the signature", () => {
    const sel = functionSelector(CROSS_VM_DEFAULT_SIGNATURE);
    expect(sel).toMatch(/^0x[0-9a-f]{8}$/);
    // deterministic for a fixed signature
    expect(functionSelector("executeCrossVMCall(string,bytes)")).toBe(sel);
  });

  it("ABI-encodes a (string,bytes) tuple with correct head offsets", () => {
    const enc = new TextEncoder();
    const tuple = encodeDynamicTuple([enc.encode("qor1abc"), enc.encode('{"x":1}')]);
    // two head words: first offset 0x40 (64), second offset 0x80 (128)
    const head0 = tuple.slice(0, 32);
    const head1 = tuple.slice(32, 64);
    expect(head0[31]).toBe(0x40);
    expect(head1[31]).toBe(0x80);
  });

  it("builds calldata that starts with the selector", () => {
    const calldata = encodeCrossVmCalldata({ contract: "qor1contract", msg: '{"increment":{}}' });
    const sel = functionSelector(CROSS_VM_DEFAULT_SIGNATURE);
    expect(calldata.startsWith(sel)).toBe(true);
    // selector (4B) + 2 head words (64B) + 2 dynamic chunks → multiple of 32 after selector
    const body = calldata.slice(10); // strip 0x + 8 hex selector
    expect(body.length % 64).toBe(0);
  });
});
