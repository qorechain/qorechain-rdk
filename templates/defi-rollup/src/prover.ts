import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Committed Groth16 artifacts for the reference circuit (built by
// `pnpm circuit:build`; the small final artifacts are checked in).
const artifactsDir = join(here, "..", "circuits", "artifacts");

/**
 * Generate a SNARK proof for the reference circuit and return it as the bytes
 * for a settlement batch's `proof` field.
 *
 * The reference Groth16 artifacts ship checked in under `circuits/artifacts/`, so
 * this performs a real prove + local verify with snarkjs out of the box. (If the
 * artifacts are ever missing, it returns a clearly-labeled placeholder so the
 * create → submit → query flow still runs; rebuild them with `pnpm circuit:build`.)
 *
 * The on-chain SNARK verifier defines the exact proof encoding it accepts — align
 * `encodeProof` with your own circuit and the network's verifier.
 */
export async function generateProof(
  input: { a: number; b: number } = { a: 3, b: 11 },
): Promise<Uint8Array> {
  const wasm = join(artifactsDir, "multiplier.wasm");
  const zkey = join(artifactsDir, "multiplier_final.zkey");
  const vkeyPath = join(artifactsDir, "verification_key.json");

  if (existsSync(wasm) && existsSync(zkey) && existsSync(vkeyPath)) {
    const snarkjs = await import("snarkjs");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    const vkey = JSON.parse(await readFile(vkeyPath, "utf8"));
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    if (!ok) throw new Error("local proof verification failed");
    console.log("Generated and locally verified a Groth16 proof.");
    return encodeProof(proof, publicSignals);
  }

  console.warn(
    "[reference] Circuit artifacts not found — returning a placeholder proof. " +
      "Run `pnpm circuit:build` (requires circom) to produce a real proof.",
  );
  return new TextEncoder().encode("PLACEHOLDER_PROOF");
}

function encodeProof(proof: unknown, publicSignals: unknown): Uint8Array {
  // Reference encoding: JSON of the Groth16 proof and public signals. The exact
  // on-chain encoding is defined by the network's SNARK verifier — adapt here.
  return new TextEncoder().encode(JSON.stringify({ proof, publicSignals }));
}
