/**
 * Testnet faucet helper. The network does not publish a fixed faucet endpoint,
 * so this posts to a URL you supply (e.g. `QORE_FAUCET_URL`). It fails with a
 * clear message when no URL is configured rather than guessing one.
 */
import { defaultFetch, type FetchLike } from "../client/http";

export interface FaucetOptions {
  /** The faucet endpoint URL. Required. */
  url?: string;
  /** The address to fund. */
  address: string;
  /** Denomination to request. Default `uqor`. */
  denom?: string;
  /** Custom fetch (for testing). */
  fetch?: FetchLike;
}

export interface FaucetResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Request testnet funds from a configured faucet URL. */
export async function requestFaucet(options: FaucetOptions): Promise<FaucetResult> {
  if (!options.url || options.url.trim() === "") {
    throw new Error(
      "No faucet URL configured. Set a faucet endpoint (e.g. QORE_FAUCET_URL) or fund the " +
        "account manually — see the keys & funding guide.",
    );
  }
  const fetchImpl = options.fetch ?? defaultFetch;
  const res = await fetchImpl(options.url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ address: options.address, denom: options.denom ?? "uqor" }),
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    throw new Error(`Faucet request failed: ${res.status} ${res.statusText}`);
  }
  return { ok: true, status: res.status, body };
}
