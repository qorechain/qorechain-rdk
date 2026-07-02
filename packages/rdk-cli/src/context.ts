/**
 * Resolve a runtime context (client, network, signing env, tx connector) from
 * CLI flags and `QORE_*` environment variables. Command handlers receive a
 * {@link CliContext}, so they can be unit-tested with a mock client and a
 * mock tx connector.
 */
import { createRdkClient, type CreateRdkClientOptions, type FetchLike, type NetworkName, type RdkClient, type RdkTxClient } from "@qorechain/rdk";
import { signerFromEnv } from "@qorechain/rdk";
import { flagBool, flagStr } from "./args";
import type { Output } from "./output";

export type CliEnv = Record<string, string | undefined>;

export interface CliContext {
  client: RdkClient;
  out: Output;
  json: boolean;
  yes: boolean;
  network: NetworkName;
  /** Environment used to build the signer (merged flags + process env). */
  signerEnv: CliEnv;
  gasPrice: string;
  faucetUrl?: string;
  /** Shared fetch (undefined = global); lets helpers like the faucet be mocked. */
  fetch?: FetchLike;
  /** Connect a signing tx client; throws a friendly error if no key is set. */
  connectTx(): Promise<RdkTxClient>;
}

export function resolveNetwork(flags: Record<string, string | boolean>, env: CliEnv): NetworkName {
  const n = flagStr(flags, "network") ?? env.QORE_NETWORK;
  return n === "mainnet" ? "mainnet" : "testnet";
}

export interface BuildContextOptions {
  flags: Record<string, string | boolean>;
  env?: CliEnv;
  out: Output;
}

export function buildContext(options: BuildContextOptions): CliContext {
  const { flags, out } = options;
  const env = options.env ?? (typeof process !== "undefined" ? process.env : {});
  const network = resolveNetwork(flags, env);

  const endpoints: NonNullable<CreateRdkClientOptions["endpoints"]> = {};
  const rest = flagStr(flags, "rest") ?? env.QORE_REST_URL;
  const rpc = flagStr(flags, "rpc") ?? env.QORE_RPC_URL;
  const evmRpc = flagStr(flags, "evm-rpc") ?? env.QORE_EVM_RPC_URL;
  if (rest) endpoints.rest = rest;
  if (rpc) endpoints.rpc = rpc;
  if (evmRpc) endpoints.evmRpc = evmRpc;

  const client = createRdkClient({ network, endpoints });

  const signerEnv: CliEnv = {
    QORE_OPERATOR_PRIVATE_KEY_HEX: flagStr(flags, "key") ?? env.QORE_OPERATOR_PRIVATE_KEY_HEX,
    QORE_MNEMONIC: flagStr(flags, "mnemonic") ?? env.QORE_MNEMONIC,
  };
  const gasPrice = flagStr(flags, "gas-price") ?? env.QORE_GAS_PRICE ?? "0.15uqor";
  const faucetUrl = flagStr(flags, "faucet-url") ?? env.QORE_FAUCET_URL;

  return {
    client,
    out,
    json: flagBool(flags, "json"),
    yes: flagBool(flags, "yes"),
    network,
    signerEnv,
    gasPrice,
    faucetUrl,
    async connectTx() {
      const signer = await signerFromEnv(signerEnv);
      if (!signer) {
        throw new Error(
          "No signing key. Set QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC (or pass --key/--mnemonic).",
        );
      }
      return client.connectTx(signer, { gasPrice });
    },
  };
}
