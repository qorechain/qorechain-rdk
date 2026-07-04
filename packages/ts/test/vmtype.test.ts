import { describe, it, expect } from "vitest";
import {
  isVmType,
  vmTypeWireValue,
  vmTypeLabel,
  createRollupMsg,
  validateRollupConfig,
  presets,
  VM_TYPES,
} from "../src/index";

describe("QoreChain Native vm-type alias", () => {
  it("advertises native (not cosmwasm) in the public list", () => {
    expect(VM_TYPES).toContain("native");
    expect(VM_TYPES).not.toContain("cosmwasm");
  });

  it("accepts native, evm, svm, custom, and the cosmwasm legacy alias", () => {
    for (const v of ["native", "evm", "svm", "custom", "cosmwasm"]) {
      expect(isVmType(v)).toBe(true);
    }
    expect(isVmType("wasm2")).toBe(false);
  });

  it("maps native to the cosmwasm wire value; others pass through", () => {
    expect(vmTypeWireValue("native")).toBe("cosmwasm");
    expect(vmTypeWireValue("cosmwasm")).toBe("cosmwasm");
    expect(vmTypeWireValue("evm")).toBe("evm");
    expect(vmTypeWireValue("svm")).toBe("svm");
  });

  it("labels the Wasm runtime as QoreChain Native", () => {
    expect(vmTypeLabel("native")).toBe("QoreChain Native");
    expect(vmTypeLabel("cosmwasm")).toBe("QoreChain Native");
    expect(vmTypeLabel("evm")).toBe("EVM");
  });

  it("emits cosmwasm on the wire when the config says native", () => {
    const msg = createRollupMsg({
      creator: "qor1creator",
      rollupId: "r",
      profile: "nft",
      vmType: "native",
      stakeAmount: "1",
    });
    expect((msg.value as { vmType: string }).vmType).toBe("cosmwasm");
  });

  it("validates native and the nft preset (now native)", () => {
    const cfg = presets.nft({ rollupId: "r" }).build();
    expect(cfg.vmType).toBe("native");
    expect(validateRollupConfig(cfg).valid).toBe(true);
  });
});
