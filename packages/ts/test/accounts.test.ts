import { describe, it, expect } from "vitest";
import { generateMnemonic, deriveNativeAccount, signerFromEnv, bytesToHex } from "../src/index";

describe("accounts", () => {
  it("signerFromEnv returns undefined when no key is set", async () => {
    expect(await signerFromEnv({})).toBeUndefined();
  });

  it("derives the same qor address from a mnemonic and from its hex key", async () => {
    const mnemonic = generateMnemonic();
    const account = await deriveNativeAccount(mnemonic);
    expect(account.address.startsWith("qor1")).toBe(true);

    const fromMnemonic = await signerFromEnv({ QORE_MNEMONIC: mnemonic });
    const fromHex = await signerFromEnv({
      QORE_OPERATOR_PRIVATE_KEY_HEX: bytesToHex(account.privateKey),
    });
    expect(fromMnemonic).toBeDefined();
    expect(fromHex).toBeDefined();

    const a1 = (await fromMnemonic!.getAccounts())[0].address;
    const a2 = (await fromHex!.getAccounts())[0].address;
    expect(a1).toBe(account.address);
    expect(a2).toBe(account.address);
  });
});
