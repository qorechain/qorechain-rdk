import "dotenv/config";
import { createRdkClient, type CreateRdkClientOptions } from "@qorechain/rdk";

/** Build an RdkClient from the QORE_* environment variables. */
export function getClient() {
  const network = (process.env.QORE_NETWORK as "testnet" | "mainnet") || "testnet";
  const endpoints: CreateRdkClientOptions["endpoints"] = {};
  if (process.env.QORE_REST_URL) endpoints.rest = process.env.QORE_REST_URL;
  if (process.env.QORE_RPC_URL) endpoints.rpc = process.env.QORE_RPC_URL;
  if (process.env.QORE_EVM_RPC_URL) endpoints.evmRpc = process.env.QORE_EVM_RPC_URL;
  return createRdkClient({ network, endpoints });
}

/** The rollup id for this project (override with QORE_ROLLUP_ID). */
export const ROLLUP_ID = process.env.QORE_ROLLUP_ID ?? "my-nft-rollup";

/** Gas price for fee estimation. */
export const GAS_PRICE = process.env.QORE_GAS_PRICE ?? "0.15uqor";
