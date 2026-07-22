export type MockRoute = {
  method: string;
  path: string | RegExp;
  status: number;
  body?: unknown;
  /** 呼び出し回数に応じて返す（配列なら順に消費） */
  sequence?: Array<{ status: number; body?: unknown }>;
};

export function createMockFetch(routes: MockRoute[]): {
  fetch: typeof fetch;
  calls: Array<{ method: string; url: string; body?: string }>;
} {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const seqIndex = new Map<MockRoute, number>();

  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, body });

    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const pathWithQuery = pathname + parsed.search;

    for (const route of routes) {
      if (route.method.toUpperCase() !== method) continue;
      const match =
        typeof route.path === "string"
          ? pathname === route.path
          : route.path.test(pathname) || route.path.test(pathWithQuery);
      if (!match) continue;

      if (route.sequence && route.sequence.length > 0) {
        const i = seqIndex.get(route) ?? 0;
        const step =
          route.sequence[Math.min(i, route.sequence.length - 1)] ??
          route.sequence[route.sequence.length - 1];
        if (!step) {
          return jsonResponse(599, { error: "empty sequence" });
        }
        seqIndex.set(route, i + 1);
        return jsonResponse(step.status, step.body);
      }

      return jsonResponse(route.status, route.body);
    }

    return jsonResponse(599, { error: `no mock for ${method} ${pathname}` });
  };

  return { fetch: fetchImpl as typeof fetch, calls };
}

function jsonResponse(status: number, body?: unknown): Response {
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function sampleInbox(
  overrides?: Partial<{
    id: string;
    address: string;
  }>,
) {
  const id = overrides?.id ?? "inbox1";
  return {
    id,
    address: overrides?.address ?? `${id}@chobitmail.com`,
    createdAt: "2026-07-22T00:00:00.000Z",
    expiresAt: "2026-07-22T00:10:00.000Z",
  };
}

export function sampleMessage(
  overrides?: Partial<{
    id: string;
    subject: string;
    codes: string[];
    links: string[];
  }>,
) {
  return {
    id: overrides?.id ?? "msg1",
    from: "noreply@example.com",
    subject: overrides?.subject ?? "Your verification code",
    text: "code 482913",
    html: "<p>code 482913</p>",
    links: overrides?.links ?? ["https://example.com/verify?t=1"],
    codes: overrides?.codes ?? ["482913"],
    attachments: [],
    receivedAt: "2026-07-22T00:00:01.000Z",
  };
}
