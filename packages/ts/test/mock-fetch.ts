import type { FetchLike } from "../src/index";

export interface MockCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

export interface MockReply {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json: unknown;
}

/** A FetchLike that records calls and returns scripted JSON replies. */
export function mockFetch(handler: (call: MockCall) => MockReply): {
  fetch: FetchLike;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: MockCall = { url, init };
    calls.push(call);
    const reply = handler(call);
    return {
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      statusText: reply.statusText ?? "OK",
      json: async () => reply.json,
    };
  };
  return { fetch, calls };
}
