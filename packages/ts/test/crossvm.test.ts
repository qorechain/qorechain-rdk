import { describe, it, expect } from "vitest";
import {
  CROSS_VM_PRECOMPILE,
  CROSS_VM_DEFAULT_SIGNATURE,
  functionSelector,
  CROSS_VM_TARGET,
  encodeCrossVmCalldata,
  encodeDynamicTuple,
  isCrossVmPrecompileActive,
} from "../src/index";

describe("crossvm precompile helpers", () => {
  it("exposes the fixed precompile address", () => {
    expect(CROSS_VM_PRECOMPILE).toBe("0x0000000000000000000000000000000000000901");
  });

  it("derives a 4-byte selector from the signature", () => {
    const sel = functionSelector(CROSS_VM_DEFAULT_SIGNATURE);
    expect(sel).toMatch(/^0x[0-9a-f]{8}$/);
    // deterministic for a fixed signature — and it is the chain's signature.
    // (This test used to assert the (string,bytes) form, pinning the bug.)
    expect(functionSelector("executeCrossVMCall(uint8,string,bytes)")).toBe(sel);
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

describe("cross-VM calldata matches the chain's own decoder", () => {
  // Verified by decoding with the chain's x/vm/precompiles.DecodeCrossVMCallInput:
  // selector matched, targetVM=1, contract and payload round-tripped exactly.
  const CHAIN_VERIFIED_NATIVE =
    "0x3c11078c0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000001c716f72316e6174697665636f6e74726163746164647265737378797a0000000000000000000000000000000000000000000000000000000000000000000000107b22696e6372656d656e74223a7b7d7d00000000000000000000000000000000";

  it("encodes executeCrossVMCall(uint8,string,bytes) exactly as the chain decodes it", () => {
    expect(
      encodeCrossVmCalldata({ contract: "qor1nativecontractaddressxyz", msg: '{"increment":{}}' }),
    ).toBe(CHAIN_VERIFIED_NATIVE);
  });

  it("uses the chain's selector, not the one releases before 0.6.0 used", () => {
    expect(functionSelector(CROSS_VM_DEFAULT_SIGNATURE)).toBe("0x3c11078c");
    // The old (string,bytes) signature hashes to a different selector, so no
    // call encoded with it could ever have reached the precompile.
    expect(functionSelector("executeCrossVMCall(string,bytes)")).toBe("0x352ebc70");
  });

  it("defaults to the Native target and encodes targetVM as the first head word", () => {
    const hex = encodeCrossVmCalldata({ contract: "qor1x", msg: "{}" }).slice(10); // drop 0x + selector
    expect(BigInt(`0x${hex.slice(0, 64)}`)).toBe(1n);
    const toEvm = encodeCrossVmCalldata({ contract: "0xabc", msg: "{}", targetVm: CROSS_VM_TARGET.EVM }).slice(10);
    expect(BigInt(`0x${toEvm.slice(0, 64)}`)).toBe(0n);
  });

  it("refuses a target the precompile would reject", () => {
    expect(() =>
      encodeCrossVmCalldata({ contract: "qor1x", msg: "{}", targetVm: 2 as unknown as 0 }),
    ).toThrow(/0 \(EVM\) or 1 \(Native\)/);
  });
});

describe("isCrossVmPrecompileActive", () => {
  const reply = (list: unknown) => async () => ({
    ok: true,
    status: 200,
    json: async () => ({ params: { active_static_precompiles: list } }),
  });

  it("reports inactive when the list is empty, as on both networks today", async () => {
    const s = await isCrossVmPrecompileActive("https://node", reply([]));
    expect(s.active).toBe(false);
    expect(s.reason).toMatch(/empty data and does nothing/);
  });

  it("reports active only when the precompile's address is listed", async () => {
    const s = await isCrossVmPrecompileActive(
      "https://node/",
      reply(["0x0000000000000000000000000000000000000901"]),
    );
    expect(s.active).toBe(true);
  });

  it("is not fooled by other precompiles being active", async () => {
    const s = await isCrossVmPrecompileActive(
      "https://node",
      reply(["0x0000000000000000000000000000000000000a01"]),
    );
    expect(s.active).toBe(false);
  });

  it("reads the right route", async () => {
    let seen = "";
    await isCrossVmPrecompileActive("https://node/", async (u) => {
      seen = u;
      return { ok: true, status: 200, json: async () => ({ params: {} }) };
    });
    expect(seen).toBe("https://node/cosmos/evm/vm/v1/params");
  });
});
