import { readFileSync } from "node:fs";
import { ml_dsa44 as mldsa44 } from "@noble/post-quantum/ml-dsa.js";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  QLEDGER_DEPOSIT_POSTER_PREFIX,
  QLEDGER_WITHDRAWAL_COUNTER_ID,
  QledgerLedger,
  QledgerPartialTree,
  buildQledgerFraudProof,
  bytesToHex,
  checkQledgerFraud,
  decodeQledgerFraudProof,
  decodeQledgerTx,
  encodeQledgerDeposit,
  encodeQledgerFraudProof,
  encodeQledgerTx,
  executeQledger,
  hexToBytes,
  isCanonicalQorAddress,
  qledgerEmptyRoot,
  qledgerKeypairFromSeed,
  qledgerSigningMessage,
  qledgerTxUnsigned,
  qledgerWithdrawalProof,
  qledgerWithdrawalsRoot,
  signQledgerTx,
  verifyQledgerTx,
  type QledgerEntry,
} from "../src";

const q = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/v328.json", import.meta.url)), "utf8"),
).qledger;
const env = { chainId: q.chainId, rollupId: q.rollupId };
const entries: QledgerEntry[] = q.entries.map((e: { height: number; poster: string; payload: string }) => ({
  height: e.height,
  poster: e.poster,
  payload: hexToBytes(e.payload),
}));

describe("qledger-v1 matches the chain", () => {
  it("empty root, counter slot and account keys", () => {
    expect(bytesToHex(qledgerEmptyRoot())).toBe(q.emptyRoot);
    expect(bytesToHex(QLEDGER_WITHDRAWAL_COUNTER_ID)).toBe(q.withdrawalCounterId);
    for (const a of q.accounts) {
      const kp = qledgerKeypairFromSeed(a.seed);
      expect(bytesToHex(kp.publicKey)).toBe(a.publicKey);
      expect(bytesToHex(kp.accountId)).toBe(a.id);
    }
  });

  it("signs transactions byte for byte (deterministic ML-DSA-44)", () => {
    const A = qledgerKeypairFromSeed(q.accounts[0].seed);
    const t1 = signQledgerTx({ ...env, ...A, nonce: 0, to: q.accounts[1].id, amount: 1_000_000 });
    expect(bytesToHex(qledgerTxUnsigned(t1))).toBe(q.txs.t1.unsigned);
    expect(bytesToHex(qledgerSigningMessage(q.chainId, q.rollupId, qledgerTxUnsigned(t1)))).toBe(q.txs.t1.signingMessage);
    expect(bytesToHex(encodeQledgerTx(t1))).toBe(q.txs.t1.encoded);
    const t2 = signQledgerTx({ ...env, ...A, nonce: 1, recipient: q.recipient, amount: 700_000 });
    expect(bytesToHex(encodeQledgerTx(t2))).toBe(q.txs.t2.encoded);
    const parsed = decodeQledgerTx(q.txs.t2.encoded)!;
    expect(parsed.recipient).toBe(q.recipient);
    expect(verifyQledgerTx(parsed, q.chainId, q.rollupId)).toBe(true);
    expect(verifyQledgerTx(parsed, q.chainId, "other-rollup")).toBe(false);
  });

  it("executes every entry to the chain's root, including the no-ops", () => {
    const led = new QledgerLedger();
    q.entries.forEach((e: { rootAfter: string; note: string }, i: number) => {
      executeQledger(env, led, [entries[i]!]);
      expect(bytesToHex(led.root()), e.note).toBe(e.rootAfter);
    });
  });

  it("produces the batch's roots, withdrawals and proofs", () => {
    const res = executeQledger(env, new QledgerLedger(), entries);
    expect(bytesToHex(res.stateRoot)).toBe(q.batch.stateRoot);
    expect(bytesToHex(res.withdrawalsRoot)).toBe(q.batch.withdrawalsRoot);
    expect(res.withdrawals.map((w) => [Number(w.index), w.recipient, Number(w.amount)])).toEqual(
      q.batch.withdrawals.map((w: { index: number; recipient: string; amount: number }) => [w.index, w.recipient, w.amount]),
    );
    res.withdrawals.forEach((_, i) => {
      expect(qledgerWithdrawalProof(q.chainId, q.rollupId, res.withdrawals, i).map(bytesToHex)).toEqual(q.batch.proofs[i]);
    });
    const later = [5n, 6n, 7n].map((index, k) => ({ index, recipient: q.recipient, amount: BigInt(k + 1) }));
    expect(bytesToHex(qledgerWithdrawalsRoot(q.chainId, q.rollupId, later))).toBe(q.laterWithdrawals.root);
    expect(qledgerWithdrawalProof(q.chainId, q.rollupId, later, 2).map(bytesToHex)).toEqual(q.laterWithdrawals.proofOfIndex7);
  });

  it("builds the chain's witnesses, and a partial tree recomputes the root", () => {
    const led = new QledgerLedger();
    executeQledger(env, led, entries);
    expect(bytesToHex(led.root())).toBe(q.witnessesAfterBatch.root);
    for (const w of q.witnessesAfterBatch.witnesses) {
      const got = led.witness(hexToBytes(w.id));
      expect({
        id: bytesToHex(got.id),
        balance: Number(got.balance),
        nonce: Number(got.nonce),
        bitmap: bytesToHex(got.bitmap),
        siblings: got.siblings.map(bytesToHex),
      }).toEqual({ ...w, siblings: w.siblings ?? [] });
    }
    const ws = q.witnessesAfterBatch.witnesses.map((w: { id: string }) => led.witness(hexToBytes(w.id)));
    const tree = new QledgerPartialTree(led.root(), ws);
    const id = hexToBytes(q.witnessesAfterBatch.witnesses[3].id);
    tree.set(id, 1n, 0n);
    led.set(id, 1n, 0n);
    expect(bytesToHex(tree.root())).toBe(bytesToHex(led.root()));
    expect(() => tree.get(new Uint8Array(32).fill(9))).toThrow(/does not open/);
  });

  it("builds the chain's fraud proof and decides it as the chain does", () => {
    const parent = new QledgerLedger();
    executeQledger(env, parent, entries.slice(0, 2));
    expect(bytesToHex(parent.root())).toBe(q.fraud.parentRoot);
    const { proof, honest } = buildQledgerFraudProof(env, parent, q.batch.accFrom, entries.slice(2));
    expect(bytesToHex(proof)).toBe(q.fraud.proof);
    expect(bytesToHex(honest.stateRoot)).toBe(q.fraud.honestStateRoot);
    expect(bytesToHex(encodeQledgerFraudProof(decodeQledgerFraudProof(proof)))).toBe(q.fraud.proof);
    const claim = {
      inboxStart: q.fraud.inboxStart,
      inboxEnd: q.fraud.inboxEnd,
      dataHash: q.fraud.dataHash,
      prevStateRoot: q.fraud.parentRoot,
      stateRoot: q.fraud.honestStateRoot,
      withdrawalsRoot: q.fraud.honestWithdrawalsRoot,
    };
    expect(checkQledgerFraud(env, claim, proof)).toBe(false);
    expect(checkQledgerFraud(env, { ...claim, stateRoot: q.fraud.wrongStateRoot }, proof)).toBe(true);
    expect(() => checkQledgerFraud(env, { ...claim, inboxEnd: q.fraud.inboxEnd + 1 }, proof)).toThrow(/does not apply/);
    expect(() => checkQledgerFraud(env, { ...claim, dataHash: "00".repeat(32) }, proof)).toThrow(/does not apply/);
  });

  it("a withdrawal to non-UTF-8 recipient bytes verifies, is a no-op, and still opens its sender", () => {
    const A = qledgerKeypairFromSeed(q.accounts[0].seed);
    const tx = {
      scheme: 1,
      publicKey: A.publicKey,
      kind: 2,
      nonce: 2n,
      recipientBytes: new Uint8Array([0x71, 0x6f, 0x72, 0xff, 0xfe]),
      amount: 1n,
      signature: new Uint8Array(),
    };
    const ml_dsa44 = mldsa44;
    tx.signature = ml_dsa44.sign(qledgerSigningMessage(q.chainId, q.rollupId, qledgerTxUnsigned(tx)), A.secretKey, {
      context: new TextEncoder().encode("qledger/v1"),
      extraEntropy: false,
    });
    const posted = encodeQledgerTx(tx);
    const parsed = decodeQledgerTx(posted)!;
    expect(bytesToHex(encodeQledgerTx(parsed))).toBe(bytesToHex(posted));
    expect(verifyQledgerTx(parsed, q.chainId, q.rollupId)).toBe(true);
    const parent = new QledgerLedger();
    executeQledger(env, parent, entries.slice(0, 3));
    const before = bytesToHex(parent.root());
    const odd = { height: 999, poster: "qor1alice", payload: posted };
    const { proof, honest } = buildQledgerFraudProof(env, parent, "", [odd]);
    expect(bytesToHex(honest.stateRoot)).toBe(before);
    expect(decodeQledgerFraudProof(proof).witnesses.map((w) => bytesToHex(w.id))).toContain(q.accounts[0].id);
  });

  it("canonical recipients and deposit payloads", () => {
    expect(isCanonicalQorAddress(q.recipient)).toBe(true);
    expect(isCanonicalQorAddress(q.recipient.toUpperCase())).toBe(false);
    expect(isCanonicalQorAddress("cosmos1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnuddlrw")).toBe(false);
    const dep = entries[0]!;
    expect(dep.poster.startsWith(QLEDGER_DEPOSIT_POSTER_PREFIX)).toBe(true);
    expect(bytesToHex(encodeQledgerDeposit(q.accounts[0].id, 5_000_000))).toBe(bytesToHex(dep.payload));
  });
});
