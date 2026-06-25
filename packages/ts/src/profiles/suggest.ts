/**
 * QCAI-assisted profile suggestion.
 *
 * Wraps the `qor_suggestRollupProfile` advisory call, normalizing its response
 * to a known profile name. If the advisory service is unavailable or returns an
 * unrecognized value, it falls back to a documented default (`defi`).
 */
import { PROFILE_NAMES, type ProfileName } from "../config/enums";
import type { QorClient } from "../client/jsonrpc";

/** The result of a profile suggestion. */
export interface ProfileSuggestion {
  /** The recommended profile. */
  profile: ProfileName;
  /** Whether the suggestion came from the advisory service or the fallback. */
  source: "advisory" | "fallback";
  /** The raw advisory response (or error message), for transparency. */
  raw?: unknown;
}

function isProfileName(value: unknown): value is ProfileName {
  return typeof value === "string" && (PROFILE_NAMES as readonly string[]).includes(value);
}

function extractProfile(result: unknown): ProfileName | undefined {
  if (isProfileName(result)) return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    const candidate =
      r.profile ?? r.suggestedProfile ?? r.suggested_profile ?? r.recommendation;
    if (isProfileName(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Suggest a rollup profile from a plain-language use-case description.
 *
 * @param useCase a description of the application (e.g. "high-frequency DeFi DEX")
 * @param qor a connected {@link QorClient}
 * @param opts.fallback the profile to use when the advisory is unavailable (default `defi`)
 */
export async function suggestProfile(
  useCase: string,
  qor: QorClient,
  opts: { fallback?: ProfileName } = {},
): Promise<ProfileSuggestion> {
  const fallback = opts.fallback ?? "defi";
  try {
    const result = await qor.suggestRollupProfile(useCase);
    const profile = extractProfile(result);
    if (profile) {
      return { profile, source: "advisory", raw: result };
    }
    return { profile: fallback, source: "fallback", raw: result };
  } catch (err) {
    return { profile: fallback, source: "fallback", raw: err instanceof Error ? err.message : String(err) };
  }
}
