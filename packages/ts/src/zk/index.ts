/**
 * ZK public inputs as the chain checks them (chain v3.2.8+, `rdk-zk-canonical-inputs`).
 *
 * A Groth16 batch is verified with four public inputs, in order:
 * `prev_state_root`, `state_root`, `data_hash`, `withdrawals_root`, each read
 * as a 32-byte big-endian integer. From v3.2.8 the chain no longer reduces a
 * submitter-chosen input into the BLS12-381 scalar field: it refuses the batch
 * unless the value is already below the scalar modulus `r`. A raw SHA-256 or
 * SHAKE-256 output is at or above `r` about 55% of the time.
 *
 * - `prev_state_root` and `state_root` are always checked. Commit to state with
 *   a field-friendly hash, or reduce with {@link toCanonicalScalar} and prove
 *   the reduced value.
 * - `data_hash` is not checked when the chain fixed it itself: a based rollup's
 *   inbox range commitment, or a native-DA batch whose hash names a posted or
 *   stored blob ({@link isDataHashChainBound}). Otherwise it must be canonical.
 * - `withdrawals_root` may be any 32 bytes: the chain stores it reduced
 *   modulo r and checks withdrawals against it modulo r
 *   ({@link withdrawalsRootMatches}). The circuit's fourth input is
 *   `int(withdrawals_root) mod r` ({@link zkPublicInputs}).
 */
import { bytesToHex, toBytes } from "../utils/bytes";

/** The BLS12-381 scalar field modulus `r`. */
export const BLS12_381_SCALAR_MODULUS = BigInt(
  "0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001",
);

function toBigInt(value: Uint8Array | string): bigint {
  const b = toBytes(value);
  return b.length === 0 ? 0n : BigInt(`0x${bytesToHex(b)}`);
}

/** Whether a big-endian value is a canonical BLS12-381 scalar (strictly below `r`). */
export function isCanonicalScalar(value: Uint8Array | string): boolean {
  return toBigInt(value) < BLS12_381_SCALAR_MODULUS;
}

/**
 * Reduce a big-endian value modulo `r` and return it as 32 big-endian bytes.
 * Use it for values the rollup chooses (state roots, an unbound data hash),
 * and prove the reduced value in the circuit.
 */
export function toCanonicalScalar(value: Uint8Array | string): Uint8Array {
  const x = toBigInt(value) % BLS12_381_SCALAR_MODULUS;
  return toBytes(x.toString(16).padStart(64, "0"));
}

/** The public inputs of a zk batch, as they go into `MsgSubmitBatch`. */
export interface ZkBatchInputs {
  prevStateRoot?: Uint8Array | string;
  stateRoot: Uint8Array | string;
  dataHash?: Uint8Array | string;
  withdrawalsRoot?: Uint8Array | string;
}

/**
 * Why the chain would refuse a zk (snark) batch's public inputs as not
 * canonical, one message per input; empty when they are all accepted.
 *
 * @param opts.dataHashBound the chain fixed `data_hash` itself (see
 *   {@link isDataHashChainBound}), so it is not checked.
 */
export function zkPublicInputErrors(inputs: ZkBatchInputs, opts: { dataHashBound?: boolean } = {}): string[] {
  const checks: [string, Uint8Array | string | undefined][] = [
    ["prev_state_root", inputs.prevStateRoot],
    ["state_root", inputs.stateRoot],
  ];
  if (!opts.dataHashBound) checks.push(["data_hash", inputs.dataHash]);
  const errors: string[] = [];
  for (const [name, v] of checks) {
    if (v === undefined) continue;
    if (!isCanonicalScalar(v)) {
      errors.push(
        `${name} is not a canonical BLS12-381 scalar (it must be below r): ` +
          "reduce it with toCanonicalScalar and prove the reduced value",
      );
    }
  }
  return errors;
}

/**
 * The four public inputs of a Groth16 rollup circuit, in the chain's order
 * (`prev_state_root`, `state_root`, `data_hash`, `withdrawals_root`), each the
 * 32-byte big-endian value reduced modulo r. An empty value is 0. Use them as
 * the circuit's public witness.
 */
export function zkPublicInputs(inputs: ZkBatchInputs): Uint8Array[] {
  return [inputs.prevStateRoot, inputs.stateRoot, inputs.dataHash, inputs.withdrawalsRoot].map((v) =>
    toCanonicalScalar(v ?? new Uint8Array()),
  );
}

/**
 * Whether a withdrawals tree root matches a batch's stored root, as the chain
 * checks a withdrawal: modulo r when the batch's `withdrawalsRootReduced` is
 * set (chain v3.2.8+ Groth16 batches), byte for byte otherwise.
 */
export function withdrawalsRootMatches(
  storedRoot: Uint8Array | string,
  treeRoot: Uint8Array | string,
  withdrawalsRootReduced: boolean,
): boolean {
  if (withdrawalsRootReduced) return toBigInt(storedRoot) % BLS12_381_SCALAR_MODULUS === toBigInt(treeRoot) % BLS12_381_SCALAR_MODULUS;
  return bytesToHex(toBytes(storedRoot)) === bytesToHex(toBytes(treeRoot));
}

/**
 * Whether the chain fixes a batch's `data_hash` itself, so it is exempt from
 * the canonical check: always on a based rollup (the inbox range commitment),
 * and on a `native` or `both` DA rollup when the hash is non-empty (the chain
 * then requires a posted or stored blob with exactly that hash).
 */
export function isDataHashChainBound(
  rollup: { daBackend: string; sequencing?: string },
  dataHash?: Uint8Array | string,
): boolean {
  if (rollup.sequencing === "based") return true;
  const nonEmpty = dataHash !== undefined && toBytes(dataHash).length > 0;
  return nonEmpty && (rollup.daBackend === "native" || rollup.daBackend === "both");
}
