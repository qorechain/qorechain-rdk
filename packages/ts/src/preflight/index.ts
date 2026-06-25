/**
 * Preflight checks — the engine behind the `doctor` command. Verifies, in plain
 * language, that a developer is ready to create/operate a rollup: endpoints
 * reachable, network as expected, module params readable, config valid, a signer
 * configured, and the operator balance covering the stake plus a fee buffer.
 */
import type { RdkClient } from "../client/rdk-client";
import type { NetworkName } from "../constants";
import type { RollupConfig } from "../config/types";
import { validateRollupConfig } from "../config/validate";
import { uqorToQor } from "../utils/denom";

export type CheckStatus = "ok" | "warn" | "fail";

export interface PreflightCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  hint?: string;
}

export interface PreflightResult {
  /** True when no check failed (warnings are allowed). */
  ok: boolean;
  checks: PreflightCheck[];
}

export interface PreflightOptions {
  /** A rollup config to validate. */
  config?: RollupConfig;
  /** The operator/signer address, to check balance and signer presence. */
  signerAddress?: string;
  /** Assert the client is pointed at this network. */
  expectedNetwork?: NetworkName;
  /** Extra uqor buffer to require on top of the stake (fees). Default 1 QOR. */
  feeBufferUqor?: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run the preflight checks against a client. */
export async function checkPreflight(
  client: RdkClient,
  options: PreflightOptions = {},
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  let params: Awaited<ReturnType<RdkClient["params"]>> | undefined;
  try {
    params = await client.params();
    checks.push({
      id: "rest",
      label: "REST endpoint reachable",
      status: "ok",
      detail: client.network.endpoints.rest,
    });
    checks.push({
      id: "params",
      label: "Module parameters readable",
      status: "ok",
      detail: `min stake ${uqorToQor(params.minStakeForRollup)} QOR, burn ${
        Number(params.rollupCreationBurnRate) * 100
      }%`,
    });
  } catch (e) {
    checks.push({
      id: "rest",
      label: "REST endpoint reachable",
      status: "fail",
      detail: errMsg(e),
      hint: "Set QORE_REST_URL to a reachable node REST (LCD) endpoint.",
    });
  }

  if (options.expectedNetwork) {
    const match = client.network.name === options.expectedNetwork;
    checks.push({
      id: "network",
      label: "Network matches expectation",
      status: match ? "ok" : "warn",
      detail: `client is ${client.network.name} (${client.network.chainId})`,
      hint: match ? undefined : `Expected ${options.expectedNetwork}.`,
    });
  }

  if (options.config) {
    const r = validateRollupConfig(options.config);
    checks.push({
      id: "config",
      label: "Rollup config valid",
      status: r.valid ? (r.warnings.length ? "warn" : "ok") : "fail",
      detail: r.valid ? (r.warnings[0] ?? "compatibility matrix satisfied") : r.errors[0],
      hint: r.valid ? undefined : "Fix the configuration errors before creating.",
    });
  }

  if (options.signerAddress) {
    checks.push({
      id: "signer",
      label: "Signer configured",
      status: "ok",
      detail: options.signerAddress,
    });
    if (params) {
      try {
        const bal = await client.rest.getBalance(options.signerAddress);
        const stake = BigInt(params.minStakeForRollup);
        const buffer = BigInt(options.feeBufferUqor ?? "1000000");
        const required = stake + buffer;
        const ok = BigInt(bal) >= required;
        checks.push({
          id: "balance",
          label: "Balance covers stake + fees",
          status: ok ? "ok" : "fail",
          detail: `have ${uqorToQor(bal)} QOR, need ~${uqorToQor(required.toString())} QOR`,
          hint: ok ? undefined : "Fund the operator account (see the keys & funding guide).",
        });
      } catch (e) {
        checks.push({
          id: "balance",
          label: "Balance readable",
          status: "warn",
          detail: errMsg(e),
        });
      }
    }
  } else {
    checks.push({
      id: "signer",
      label: "Signer configured",
      status: "warn",
      detail: "no signer",
      hint: "Set QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC to create/operate.",
    });
  }

  return { ok: checks.every((c) => c.status !== "fail"), checks };
}
