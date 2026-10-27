import { describe, expect, it } from "vitest";
import { decodeRdkTxError, RDK_ERRORS } from "../src/index";

describe("decodeRdkTxError", () => {
  it("names the rdk codes an operator meets, with what to do", () => {
    const vk = decodeRdkTxError({ code: 21, codespace: "rdk", rawLog: "x" });
    expect(vk.kind).toBe("verification_key_missing");
    expect(vk.message).toMatch(/zk settlement cannot be used yet/);
    expect(decodeRdkTxError({ code: 26, codespace: "rdk" }).hint).toMatch(/leave dataHash empty/);
    expect(decodeRdkTxError({ code: 36, codespace: "rdk" }).kind).toBe("settlement_pending");
  });

  it("falls back to the SDK for other codespaces and unknown codes", () => {
    expect(decodeRdkTxError({ code: 5, codespace: "sdk" }).codespace).toBe("sdk");
    expect(decodeRdkTxError({ code: 999, codespace: "rdk", rawLog: "raw" }).rawLog).toBe("raw");
  });

  it("covers every code the chain registers, 2 to 36", () => {
    for (let c = 2; c <= 36; c++) expect(RDK_ERRORS[c], `code ${c}`).toBeDefined();
  });
});
