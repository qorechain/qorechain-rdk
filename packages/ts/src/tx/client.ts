/**
 * `RdkTxClient` — submits `rdk` transactions (rollup lifecycle, settlement
 * batches, withdrawals) through a `@cosmjs` signing client configured with the
 * `rdk` registry.
 *
 * Two signing paths:
 *
 * - **Classical** (default) — a standard `@cosmjs` `OfflineSigner` signs with
 *   SIGN_MODE_DIRECT and the connected `SigningStargateClient` broadcasts.
 * - **Hybrid (post-quantum)** — pass `pqcKeypair` on connect. The transaction is
 *   then built, signed, and broadcast by
 *   [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)'s
 *   `signAndBroadcastHybrid`, which attaches the ML-DSA-87 half as a tx-body
 *   extension alongside the classical secp256k1 signature. Networks that
 *   require the post-quantum signature on native-lane transactions only accept
 *   this path.
 *
 * `@qorechain/sdk`'s `directSignerFromPrivateKey` provides a suitable
 * `OfflineDirectSigner`; any compatible one works.
 */
import {
  GasPrice,
  SigningStargateClient,
  calculateFee,
  type DeliverTxResponse,
  type StdFee,
} from "@cosmjs/stargate";
import type {
  EncodeObject,
  OfflineSigner,
  OfflineDirectSigner,
} from "@cosmjs/proto-signing";
import {
  HYBRID_VERIFY_GAS,
  buildRegisterPqcKeyMsg,
  qorechainRegistryTypes,
  signProofOfPossession,
  pqcSign,
  signAndBroadcastHybrid,
  type PqcKeypair,
  type SignBytesVersionOption,
} from "@qorechain/sdk";
import { RestClient, isRestNotFound } from "../client/rest";
import { dataHashError, rollupIdError, stopRollupError, withdrawalErrors, withdrawalsRootError } from "../rules";
import { FEATURE_RDK_CHALLENGE_SETTLEMENT } from "../transition";
import { MIN_ROLLUP_DEPOSIT_UQOR, RDK_FEATURES } from "../constants";
import { rollupModeErrors } from "../config/validate";
import { PAUSED_PROOF_SYSTEMS, MAX_ROLLUP_MEMBERS, type ProofSystem } from "../config/enums";
import { isDataHashChainBound, zkPublicInputErrors } from "../zk";
import { qledgerBatchErrors } from "../qledger/batch";
import { anchorSignBytesV2 } from "../receipts";
import { bytesToHex, toBytes } from "../utils/bytes";
import type { RollupStatus } from "../config/enums";
import { assertRollupAction } from "../lifecycle/state-machine";
import { createRdkRegistry } from "./registry";
import * as msgs from "./messages";

/**
 * The exact bytes a rollup creator signs to anchor a settlement batch (the v2
 * anchor message, chain v3.2.2+), with the mapping the chain uses for a batch:
 * `layer_id` is the rollup's layer id, `layer_height` is the batch index,
 * `state_root` the batch state root, `transaction_count` the batch's
 * transaction count, and the compressed state proof empty.
 *
 * For a rollup whose sequencer is not its creator: build these bytes, have the
 * creator sign them with their registered ML-DSA-87 key, and pass the result
 * as `anchorSignature` to `submitBatch`.
 */
export function anchorSignBytesForBatch(input: {
  chainId: string;
  layerId: string;
  batchIndex: number | bigint | string;
  /** Hex string or raw bytes. */
  stateRoot: string | Uint8Array;
  txCount: number | bigint | string;
  /** Hex string or raw bytes; omit or empty when the batch carries none. */
  validatorSetHash?: string | Uint8Array;
}): Uint8Array {
  return anchorSignBytesV2({
    chainId: input.chainId,
    layerId: input.layerId,
    layerHeight: BigInt(input.batchIndex),
    stateRoot: bytesToHex(toBytes(input.stateRoot)),
    validatorSetHash: input.validatorSetHash ? bytesToHex(toBytes(input.validatorSetHash)) : "",
    transactionCount: BigInt(input.txCount),
    compressedStateProof: "",
  });
}

/** A transaction fee: an explicit `StdFee`, a gas number, or `"auto"`. */
export type TxFee = StdFee | number | "auto";

/** The multiplier applied to a simulated gas estimate for an `"auto"` fee. */
const GAS_MULTIPLIER = 1.4;
/** The chain's per-byte transaction size gas (`tx_size_cost_per_byte`). */
const TX_SIZE_COST_PER_BYTE = 10;
const ML_DSA_87_SIGNATURE_BYTES = 4627;
const ML_DSA_87_PUBLIC_KEY_BYTES = 2592;

/** The signing capability `RdkTxClient` depends on (satisfied by `SigningStargateClient`). */
export interface SignAndBroadcastCapable {
  signAndBroadcast(
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: TxFee,
    memo?: string,
  ): Promise<DeliverTxResponse>;
}

/** Optional gas-simulation capability (also satisfied by `SigningStargateClient`). */
export interface SimulateCapable {
  simulate(
    signerAddress: string,
    messages: readonly EncodeObject[],
    memo: string | undefined,
  ): Promise<number>;
}

/**
 * The extra capabilities the hybrid (post-quantum) path needs from the
 * connected client: the chain id, the signer's account number/sequence, and raw
 * transaction broadcast. `SigningStargateClient` (and `StargateClient`) satisfy
 * all of them.
 */
export interface HybridTxCapable {
  getChainId(): Promise<string>;
  getSequence(
    address: string,
  ): Promise<{ accountNumber: number | bigint; sequence: number | bigint }>;
  broadcastTx(
    tx: Uint8Array,
    timeoutMs?: number,
    pollIntervalMs?: number,
  ): Promise<{
    code: number;
    transactionHash: string;
    height?: number;
    gasUsed?: bigint;
    gasWanted?: bigint;
    rawLog?: string;
  }>;
  broadcastTxSync(tx: Uint8Array): Promise<string>;
}

/**
 * Post-quantum signing configuration. Supplying {@link pqcKeypair} switches the
 * client to the hybrid path; everything else is optional tuning.
 */
export interface HybridSigningOptions {
  /**
   * The ML-DSA-87 (Dilithium-5) keypair providing the post-quantum half of the
   * signature. When present, every transaction this client sends is signed
   * hybrid.
   *
   * The key is expected to already be registered on chain (via
   * `MsgRegisterPQCKey`) unless {@link includePqcPublicKey} is set.
   */
  pqcKeypair?: PqcKeypair;
  /**
   * The network's REST (LCD) base URL, used by `signBytesVersion: "auto"` to
   * ask the network which hybrid sign-bytes form it expects. `RdkClient.connectTx`
   * fills this in from the network preset.
   */
  rest?: string;
  /**
   * Which hybrid sign-bytes form to sign. `"auto"` (the default) asks the
   * network over `rest`; `"v1"` / `"v2"` force a form — useful when a network's
   * upgrade plan name differs from what `"auto"` looks up.
   */
  signBytesVersion?: SignBytesVersionOption;
  /**
   * The ML-DSA-87 key is not registered on chain yet. The client then sends a
   * `MsgRegisterPQCKeyV2` (with a proof of possession) in a transaction of its
   * own before the first real one: since chain v3.2.3 an account without a
   * registered key may send nothing else. Defaults to `false`.
   */
  includePqcPublicKey?: boolean;
}

export interface RdkTxClientConnectOptions extends HybridSigningOptions {
  /** Gas price for `"auto"` fee estimation, e.g. `"0.15uqor"`. */
  gasPrice?: GasPrice | string;
}

export interface TxOptions {
  /** Fee override; defaults to `"auto"` (requires a gas price on connect). */
  fee?: TxFee;
  /** Optional memo. */
  memo?: string;
}

/** Resolved hybrid configuration held by a client that signs post-quantum. */
interface HybridConfig {
  signer: OfflineDirectSigner;
  pqcKeypair: PqcKeypair;
  rest?: string;
  signBytesVersion?: SignBytesVersionOption;
  includePqcPublicKey?: boolean;
}

function asDirectSigner(signer: OfflineSigner): OfflineDirectSigner {
  if (typeof (signer as Partial<OfflineDirectSigner>).signDirect !== "function") {
    throw new Error(
      "hybrid (post-quantum) signing requires an OfflineDirectSigner (SIGN_MODE_DIRECT); " +
        "the signer provided has no signDirect — amino-only signers cannot carry the " +
        "PQC signature extension. Use directSignerFromPrivateKey from @qorechain/sdk.",
    );
  }
  return signer as OfflineDirectSigner;
}

/** Build the hybrid config from connect options, or `undefined` for the classical path. */
function hybridConfigFrom(
  signer: OfflineSigner,
  options: HybridSigningOptions,
): HybridConfig | undefined {
  if (!options.pqcKeypair) return undefined;
  return {
    signer: asDirectSigner(signer),
    pqcKeypair: options.pqcKeypair,
    rest: options.rest,
    signBytesVersion: options.signBytesVersion,
    includePqcPublicKey: options.includePqcPublicKey,
  };
}

/** The settlement and proof system the chain derives from each preset profile. */
const PROFILE_SETTLEMENT: Record<string, { settlement: string; proofSystem: string }> = {
  defi: { settlement: "zk", proofSystem: "snark" },
  gaming: { settlement: "based", proofSystem: "none" },
  nft: { settlement: "optimistic", proofSystem: "fraud" },
  enterprise: { settlement: "based", proofSystem: "none" },
  custom: { settlement: "optimistic", proofSystem: "fraud" },
};

/** Messages a keyless account may send on its own (chain `txIsRegistrationOnly`). */
const PQC_REGISTRATION_TYPES = new Set([
  "/qorechain.pqc.v1.MsgRegisterPQCKey",
  "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
  "/qorechain.pqc.v1.MsgMigratePQCKey",
]);
/** The pqc codespace's "key already registered" refusal. */
const PQC_ALREADY_REGISTERED_CODE = 7;

/** The rdk registry plus the `x/pqc` key messages. */
function registryWithPqc() {
  const r = createRdkRegistry();
  for (const [url, type] of qorechainRegistryTypes) {
    if (url.startsWith("/qorechain.pqc.v1.MsgRegisterPQCKey") && !r.lookupType(url)) r.register(url, type);
  }
  return r;
}

export class RdkTxClient {
  private constructor(
    private readonly client: SignAndBroadcastCapable &
      Partial<SimulateCapable> &
      Partial<HybridTxCapable>,
    /** The signing/operator address used as the message signer. */
    readonly address: string,
    private readonly hybrid?: HybridConfig,
    private readonly gasPrice?: GasPrice,
  ) {}

  /** Whether this client signs hybrid (post-quantum) transactions. */
  get isHybrid(): boolean {
    return this.hybrid !== undefined;
  }

  /**
   * Estimate gas for a set of messages without broadcasting — the basis for a
   * dry run. Throws if the underlying client does not support simulation.
   */
  async simulate(messages: readonly EncodeObject[], memo?: string): Promise<number> {
    if (typeof this.client.simulate !== "function") {
      throw new Error("the underlying client does not support simulation");
    }
    return this.client.simulate(this.address, messages, memo);
  }

  /** Connect a signing client at a consensus RPC endpoint with the `rdk` registry. */
  static async connect(
    rpcUrl: string,
    signer: OfflineSigner,
    options: RdkTxClientConnectOptions = {},
  ): Promise<RdkTxClient> {
    const gasPrice =
      typeof options.gasPrice === "string"
        ? GasPrice.fromString(options.gasPrice)
        : options.gasPrice;
    // Validate the signer before opening a connection, so a misconfigured
    // hybrid setup fails fast with a clear message.
    const hybrid = hybridConfigFrom(signer, options);
    const client = await SigningStargateClient.connectWithSigner(rpcUrl, signer, {
      registry: createRdkRegistry(),
      gasPrice,
    });
    const accounts = await signer.getAccounts();
    if (accounts.length === 0) {
      throw new Error("signer has no accounts");
    }
    return new RdkTxClient(client, accounts[0].address, hybrid, gasPrice);
  }

  /**
   * Wrap an existing sign-and-broadcast client (advanced use and testing).
   *
   * Pass `options.pqcKeypair` together with an `OfflineDirectSigner` to exercise
   * the hybrid path against a custom transport; the client must then also
   * satisfy {@link HybridTxCapable}.
   */
  static fromClient(
    client: SignAndBroadcastCapable & Partial<SimulateCapable> & Partial<HybridTxCapable>,
    address: string,
    options: RdkTxClientConnectOptions & { signer?: OfflineSigner } = {},
  ): RdkTxClient {
    const gasPrice =
      typeof options.gasPrice === "string"
        ? GasPrice.fromString(options.gasPrice)
        : options.gasPrice;
    let hybrid: HybridConfig | undefined;
    if (options.pqcKeypair) {
      if (!options.signer) {
        throw new Error("hybrid signing requires `signer` (an OfflineDirectSigner)");
      }
      hybrid = hybridConfigFrom(options.signer, options);
    }
    return new RdkTxClient(client, address, hybrid, gasPrice);
  }

  /**
   * Turn the caller's {@link TxFee} into the explicit `StdFee` the hybrid
   * builder requires: an `StdFee` passes through, a number is a gas limit, and
   * `"auto"` simulates and applies the standard multiplier.
   */
  private async resolveFee(
    messages: readonly EncodeObject[],
    fee: TxFee,
    memo: string | undefined,
  ): Promise<StdFee> {
    if (typeof fee === "object") return fee;
    if (!this.gasPrice) {
      throw new Error(
        "hybrid signing needs an explicit fee: pass `fee` as an StdFee in the transaction " +
          'options, or set `gasPrice` on connect (e.g. "0.15uqor") so a gas limit or "auto" ' +
          "can be priced.",
      );
    }
    if (typeof fee === "number") return calculateFee(fee, this.gasPrice);
    const gas = await this.simulate(messages, memo);
    // The simulation runs the classical transaction; a hybrid one also carries
    // the ML-DSA-87 extension (charged per byte) and its verification.
    const hybridExtra = this.hybrid
      ? HYBRID_VERIFY_GAS +
        TX_SIZE_COST_PER_BYTE * (ML_DSA_87_SIGNATURE_BYTES + 64 + (this.hybrid.includePqcPublicKey ? ML_DSA_87_PUBLIC_KEY_BYTES : 0))
      : 0;
    return calculateFee(Math.round(gas * GAS_MULTIPLIER) + hybridExtra, this.gasPrice);
  }

  /** Sign and broadcast hybrid, mapping the SDK result onto cosmjs's shape. */
  private async broadcastHybrid(
    hybrid: HybridConfig,
    messages: EncodeObject[],
    opts: TxOptions,
  ): Promise<DeliverTxResponse> {
    const transport = this.client as Partial<HybridTxCapable>;
    if (
      typeof transport.getChainId !== "function" ||
      typeof transport.getSequence !== "function" ||
      typeof transport.broadcastTx !== "function"
    ) {
      throw new Error(
        "the underlying client cannot sign hybrid transactions: it must provide " +
          "getChainId, getSequence, and broadcastTx (a connected StargateClient does).",
      );
    }
    const chainId = await transport.getChainId();
    // Since chain v3.2.3 (`pqc-keyless-extension-closed`) a key carried in the
    // signature extension is no longer registered on first use: an account
    // without a registered key may send only a registration. Register it in a
    // transaction of its own first, then send `messages`.
    if (hybrid.includePqcPublicKey && !messages.every((m) => PQC_REGISTRATION_TYPES.has(m.typeUrl))) {
      const reg = buildRegisterPqcKeyMsg(this.address, {
        pqcKeypair: hybrid.pqcKeypair,
        keyType: "hybrid",
        proofOfPossession: signProofOfPossession({
          chainId,
          account: this.address,
          algorithmId: 1,
          keypair: hybrid.pqcKeypair,
        }),
      });
      const res = await this.broadcastHybrid(hybrid, [reg], { fee: { amount: [{ denom: "uqor", amount: "90000" }], gas: "600000" } });
      if (res.code !== 0 && res.code !== PQC_ALREADY_REGISTERED_CODE) {
        throw new Error(`registering this account's post-quantum key failed (code ${res.code}): ${res.rawLog ?? ""}`);
      }
      hybrid.includePqcPublicKey = false;
    }
    const memo = opts.memo ?? "";
    const fee = await this.resolveFee(messages, opts.fee ?? "auto", opts.memo);
    const { accountNumber, sequence } = await transport.getSequence(this.address);

    const result = await signAndBroadcastHybrid({
      registry: registryWithPqc(),
      signer: hybrid.signer,
      pqcKeypair: hybrid.pqcKeypair,
      messages,
      fee,
      memo,
      chainId,
      accountNumber,
      sequence,
      includePqcPublicKey: hybrid.includePqcPublicKey,
      signBytesVersion: hybrid.signBytesVersion ?? "auto",
      rest: hybrid.rest,
      transport: transport as HybridTxCapable,
    });

    return {
      code: result.code,
      height: result.height ?? 0,
      txIndex: 0,
      transactionHash: result.transactionHash,
      events: (result.events ?? []) as DeliverTxResponse["events"],
      rawLog: result.rawLog,
      // The typed Msg*Response for each message, which the SDK forwards from the
      // node (0.9.0+). Earlier releases dropped them.
      msgResponses: (result.msgResponses ?? []).map((r) => ({ typeUrl: r.typeUrl, value: new Uint8Array(r.value) })),
      gasUsed: result.gasUsed ?? BigInt(0),
      gasWanted: result.gasWanted ?? BigInt(0),
    };
  }

  private broadcast(messages: EncodeObject[], opts: TxOptions = {}): Promise<DeliverTxResponse> {
    if (this.hybrid) {
      return this.broadcastHybrid(this.hybrid, messages, opts);
    }
    return this.client.signAndBroadcast(this.address, messages, opts.fee ?? "auto", opts.memo ?? "");
  }

  /**
   * Create a rollup. The client's address is the creator.
   *
   * Throws before broadcasting if `rollupId` breaks the chain's id grammar
   * (enforced at creation from v3.2.2), since the chain would refuse it only
   * after the creation fee had been paid.
   */
  async createRollup(
    input: Omit<msgs.CreateRollupInput, "creator">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    const idError = rollupIdError(input.rollupId);
    if (idError) throw new Error(`rollupId "${input.rollupId}" ${idError}`);
    // Chain v3.2.8 mode rules: checked against the profile's settlement when
    // the profile is one of the presets, so a refused combination costs no fee.
    const preset = PROFILE_SETTLEMENT[input.profile];
    if (preset) {
      const errors = rollupModeErrors({ ...preset, ...input });
      if (errors.length > 0) throw new Error(`rollup "${input.rollupId}" would be refused: ${errors.join("; ")}`);
    }
    return this.broadcast([msgs.createRollupMsg({ creator: this.address, ...input })], opts);
  }

  /**
   * Submit a settlement batch. The client's address is the sequencer.
   *
   * **Anchoring.** From chain v3.2.2 a batch is anchored in `x/multilayer` only
   * if it carries the rollup creator's ML-DSA-87 signature over its v2 anchor
   * sign bytes, and only an anchored batch can ever yield a settlement receipt.
   * With `anchor: "auto"` (the default) this client signs it for you when it
   * can do so correctly: it signs hybrid, and **it is the rollup's creator** —
   * the chain verifies the signature against the creator's registered key, and
   * "a refused anchor refuses the batch", so signing with any other key would
   * not skip anchoring but break the submission. In every other case the batch
   * is submitted unanchored, exactly as before.
   *
   * - `"require"` throws instead of submitting unanchored.
   * - `"off"` never signs.
   * - An explicit `anchorSignature` in `input` is always sent as given — the
   *   path for a rollup with a separate sequencer, which must obtain the
   *   creator's signature out of band (see {@link anchorSignBytesForBatch}).
   */
  async submitBatch(
    input: Omit<msgs.SubmitBatchInput, "sequencer">,
    opts: TxOptions & { anchor?: "auto" | "require" | "off" } = {},
  ): Promise<DeliverTxResponse> {
    const mode = opts.anchor ?? "auto";
    const rootErr = withdrawalsRootError(input.withdrawalsRoot);
    if (rootErr) throw new Error(`cannot submit batch ${String(input.batchIndex)}: ${rootErr}`);
    // Checks the chain would make after the fee is paid, when the rollup can
    // be read: a native-DA data hash, a based rollup's inbox range, and (chain
    // v3.2.8) canonical ZK public inputs and the paused STARK settlement.
    if (this.hybrid?.rest) {
      const rest = new RestClient(this.hybrid.rest);
      const rollup = await rest.getRollup(input.rollupId);
      const fail = (why: string) => new Error(`cannot submit batch ${String(input.batchIndex)}: ${why}`);
      const based = rollup.sequencing === "based";
      const inboxEnd = input.inboxEnd === undefined ? 0n : BigInt(input.inboxEnd);
      if (based && inboxEnd === 0n) {
        throw fail("the rollup is based: set inboxEnd and carry the inbox range commitment as dataHash");
      }
      if (!based && inboxEnd !== 0n) throw fail("inboxEnd must be 0 on a rollup that is not based");
      if (!based && input.dataHash && toBytes(input.dataHash).length > 0) {
        const postedDataEnabled = await rest.isProtocolFeatureEnabled(RDK_FEATURES.postRollupData);
        const err = dataHashError(rollup.daBackend, input.dataHash, { postedDataEnabled });
        if (err) throw fail(err);
      }
      if (rollup.executionVm === "qledger-v1") {
        // Chain v3.2.8 admission rules for qledger-v1 batches.
        const [params, bond, inbox] = await Promise.all([
          rest.getParams(),
          rest.getSubmitterBond(input.rollupId, this.address),
          rest.getInbox(input.rollupId),
        ]);
        const head = BigInt(inbox.headSequence);
        const retained = async (x: bigint) => x === head || (await rest.getInbox(input.rollupId, x)).rangeDataHash !== "";
        let nextRetained: boolean | undefined;
        let nextHeight: number | undefined;
        if (inboxEnd < head) {
          try {
            nextHeight = (await rest.getPostedData(input.rollupId, inboxEnd + 1n)).height;
            nextRetained = true;
          } catch (err) {
            if (!isRestNotFound(err)) throw err;
            nextRetained = false;
          }
        }
        const errors = qledgerBatchErrors({
          consumed: inbox.consumedSequence,
          head,
          end: inboxEnd,
          bond: bond.amount,
          minBond: params.minSubmitterBond ?? "1000000000",
          pending: bond.pending,
          endRetained: inboxEnd <= head && (await retained(inboxEnd)),
          nextRetained,
          nextHeight,
          inclusionHeight: (await rest.getLatestHeight()) + 2,
        });
        if (errors.length > 0) throw fail(errors.join("; "));
      }
      if (rollup.settlementMode === "zk") {
        if (PAUSED_PROOF_SYSTEMS.includes(rollup.proofSystem as ProofSystem)) {
          if (await rest.isProtocolFeatureEnabled(RDK_FEATURES.starkStatement)) {
            throw fail("STARK settlement is paused on the network; governance can move the rollup to a Groth16 key");
          }
        } else if (await rest.isProtocolFeatureEnabled(RDK_FEATURES.zkCanonicalInputs)) {
          const errors = zkPublicInputErrors(input, { dataHashBound: isDataHashChainBound(rollup, input.dataHash) });
          if (errors.length > 0) throw fail(errors.join("; "));
        }
      }
    }
    let anchored = input;
    if (!input.anchorSignature && mode !== "off") {
      const sig = await this.tryAnchorSignature(input);
      if (sig.signature) {
        anchored = { ...input, anchorSignature: sig.signature };
      } else if (mode === "require") {
        throw new Error(`cannot anchor batch ${String(input.batchIndex)}: ${sig.reason}`);
      }
    }
    return this.broadcast([msgs.submitBatchMsg({ sequencer: this.address, ...anchored })], opts);
  }

  /**
   * Produce this batch's anchor signature if — and only if — this client can
   * produce the one the chain will accept. Never throws; says why not.
   */
  private async tryAnchorSignature(
    input: Omit<msgs.SubmitBatchInput, "sequencer">,
  ): Promise<{ signature?: Uint8Array; reason: string }> {
    if (!this.hybrid) {
      return { reason: "this client does not sign hybrid, so it holds no post-quantum key to sign the anchor" };
    }
    if (!this.hybrid.rest) {
      return { reason: "no REST endpoint configured, so the rollup's layer and creator cannot be read" };
    }
    const transport = this.client as Partial<HybridTxCapable>;
    if (typeof transport.getChainId !== "function") {
      return { reason: "the underlying client cannot report the chain id" };
    }
    let rollup;
    try {
      rollup = await new RestClient(this.hybrid.rest).getRollup(input.rollupId);
    } catch (err) {
      return { reason: `could not read rollup "${input.rollupId}": ${(err as Error).message}` };
    }
    if (!rollup.layerId) {
      return { reason: `rollup "${input.rollupId}" has no layer_id, so there is nothing to anchor to` };
    }
    if (rollup.creator !== this.address) {
      return {
        reason:
          `this client (${this.address}) is not the rollup's creator (${rollup.creator}); the chain ` +
          "verifies the anchor against the creator's key, so the creator must sign it out of band",
      };
    }
    const chainId = await transport.getChainId();
    const message = anchorSignBytesForBatch({
      chainId,
      layerId: rollup.layerId,
      batchIndex: input.batchIndex,
      stateRoot: input.stateRoot,
      txCount: input.txCount,
      validatorSetHash: input.validatorSetHash,
    });
    return { signature: pqcSign(this.hybrid.pqcKeypair.secretKey, message), reason: "signed" };
  }

  /** Challenge an optimistic batch with a fraud proof. */
  challengeBatch(
    input: Omit<msgs.ChallengeBatchInput, "challenger">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    return this.broadcast([msgs.challengeBatchMsg({ challenger: this.address, ...input })], opts);
  }

  /** Resolve an open challenge (upheld or dismissed). */
  resolveChallenge(
    input: Omit<msgs.ResolveChallengeInput, "resolver">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    return this.broadcast([msgs.resolveChallengeMsg({ resolver: this.address, ...input })], opts);
  }

  /** Pause an active rollup. Pass `currentStatus` to guard the transition. */
  async pauseRollup(
    input: { rollupId: string; reason?: string; currentStatus?: RollupStatus },
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    if (input.currentStatus) assertRollupAction("pause", input.currentStatus);
    return this.broadcast(
      [msgs.pauseRollupMsg({ creator: this.address, rollupId: input.rollupId, reason: input.reason })],
      opts,
    );
  }

  /** Resume a paused rollup. Pass `currentStatus` to guard the transition. */
  async resumeRollup(
    input: { rollupId: string; currentStatus?: RollupStatus },
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    if (input.currentStatus) assertRollupAction("resume", input.currentStatus);
    return this.broadcast(
      [msgs.resumeRollupMsg({ creator: this.address, rollupId: input.rollupId })],
      opts,
    );
  }

  /** Stop a rollup permanently. Pass `currentStatus` to guard the transition. */
  async stopRollup(
    input: { rollupId: string; currentStatus?: RollupStatus },
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    if (input.currentStatus) assertRollupAction("stop", input.currentStatus);
    // From chain v3.2.5 a rollup with an unsettled latest batch cannot be
    // stopped; check before paying the fee when the chain can be read.
    if (this.hybrid?.rest) {
      const rest = new RestClient(this.hybrid.rest);
      if (await rest.isProtocolFeatureEnabled(FEATURE_RDK_CHALLENGE_SETTLEMENT)) {
        let latest: { status: string } | undefined;
        try {
          latest = await rest.getLatestBatch(input.rollupId);
        } catch {
          latest = undefined; // no batch yet
        }
        const err = stopRollupError(latest?.status);
        if (err) throw new Error(`cannot stop rollup "${input.rollupId}": ${err}`);
      }
    }
    return this.broadcast(
      [msgs.stopRollupMsg({ creator: this.address, rollupId: input.rollupId })],
      opts,
    );
  }

  /**
   * Register or replace the rollup's ZK verification key (chain v3.2.7+). The
   * client's address must be the creator, and only before the first batch.
   * `proofSystem` `"stark"` is refused from v3.2.8.
   */
  setVerificationKey(
    input: Omit<msgs.SetVerificationKeyInput, "creator">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    if (input.proofSystem && PAUSED_PROOF_SYSTEMS.includes(input.proofSystem as ProofSystem)) {
      return Promise.reject(new Error("STARK keys are refused by the chain from v3.2.8; register a snark (Groth16) key"));
    }
    return this.broadcast([msgs.setVerificationKeyMsg({ creator: this.address, ...input })], opts);
  }

  /**
   * Post rollup data on chain (chain v3.2.8+). The response's
   * `MsgPostRollupDataResponse` carries the inbox sequence and SHA-256; on a
   * private rollup `data` must be an envelope (`sealEnvelope`). The poster pays
   * `posted_data_fee_per_byte` per billable byte (at least 1 KiB) on top of gas.
   */
  postRollupData(input: { rollupId: string; data: string | Uint8Array }, opts?: TxOptions): Promise<DeliverTxResponse> {
    if (toBytes(input.data).length === 0) return Promise.reject(new Error("data cannot be empty"));
    return this.broadcast([msgs.postRollupDataMsg({ poster: this.address, ...input })], opts);
  }

  /**
   * Deposit uqor into a qledger-v1 rollup, crediting the 32-byte L2 `account`
   * through the rollup's inbox (chain v3.2.8+). At least 1 QOR.
   */
  depositToRollup(
    input: { rollupId: string; account: string | Uint8Array; amount: string | number | bigint },
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    const account = toBytes(input.account);
    if (account.length !== 32 || account.every((b) => b === 0)) {
      return Promise.reject(new Error("account must be a non-zero 32-byte qledger-v1 account id"));
    }
    if (BigInt(input.amount) < MIN_ROLLUP_DEPOSIT_UQOR) {
      return Promise.reject(new Error(`a deposit is at least ${MIN_ROLLUP_DEPOSIT_UQOR} uqor (1 QOR)`));
    }
    return this.broadcast([msgs.depositToRollupMsg({ depositor: this.address, ...input, account })], opts);
  }

  /** Add to this client's submitter bond on a qledger-v1 rollup (chain v3.2.8+). */
  bondRollupSubmitter(
    input: { rollupId: string; amount: string | number | bigint },
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    if (BigInt(input.amount) <= 0n) return Promise.reject(new Error("amount must be positive"));
    return this.broadcast([msgs.bondRollupSubmitterMsg({ submitter: this.address, ...input })], opts);
  }

  /** Withdraw this client's whole submitter bond, a full challenge window after its last batch (chain v3.2.8+). */
  unbondRollupSubmitter(input: { rollupId: string }, opts?: TxOptions): Promise<DeliverTxResponse> {
    return this.broadcast([msgs.unbondRollupSubmitterMsg({ submitter: this.address, ...input })], opts);
  }

  /**
   * Set a private rollup's member list (chain v3.2.8+). The client's address
   * must be the creator; each member needs a registered ML-KEM-1024 key. Starts
   * a new membership epoch.
   */
  setRollupMembers(input: { rollupId: string; members: string[] }, opts?: TxOptions): Promise<DeliverTxResponse> {
    const { members } = input;
    if (members.length === 0 || members.length > MAX_ROLLUP_MEMBERS) {
      return Promise.reject(new Error(`a private rollup has 1 to ${MAX_ROLLUP_MEMBERS} members`));
    }
    if (new Set(members).size !== members.length) return Promise.reject(new Error("a member is listed twice"));
    return this.broadcast([msgs.setRollupMembersMsg({ creator: this.address, ...input })], opts);
  }

  /**
   * Publish this client's ML-KEM-1024 encapsulation key in the chain's KEM
   * registry (chain v3.2.5+), so a private rollup can list it as a member.
   * Derive the key pair with `kemKeypairFromSeed` and keep the seed secret.
   */
  registerKemKey(input: { publicKey: string | Uint8Array }, opts?: TxOptions): Promise<DeliverTxResponse> {
    const pk = toBytes(input.publicKey);
    if (pk.length !== 1568) return Promise.reject(new Error(`an ML-KEM-1024 key is 1568 bytes, got ${pk.length}`));
    return this.broadcast([msgs.registerKemKeyMsg({ sender: this.address, publicKey: pk })], opts);
  }

  /** Execute a finalized-batch withdrawal. The client's address is the submitter. */
  async executeWithdrawal(
    input: Omit<msgs.ExecuteWithdrawalInput, "submitter">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    // The chain refuses these at the start of ExecuteWithdrawal (v3.2.3+) —
    // after the fee is paid. Catch them first.
    const errors = withdrawalErrors({ submitter: this.address, ...input });
    if (errors.length > 0) {
      throw new Error(`withdrawal would be refused by the chain: ${errors.join("; ")}`);
    }
    return this.broadcast([msgs.executeWithdrawalMsg({ submitter: this.address, ...input })], opts);
  }
}
