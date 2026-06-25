/** Minimal HTTP abstraction so the read clients are easy to mock and test. */

/** The subset of a `fetch` Response the clients use. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

/** A `fetch`-compatible function. The global `fetch` satisfies this. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

/** The default fetch, bound to the global `fetch`. */
export const defaultFetch: FetchLike = (url, init) =>
  globalThis.fetch(url, init as RequestInit) as Promise<HttpResponse>;
