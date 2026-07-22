import { debugLog, resolveConfig } from "./env.js";
import {
  ChobitmailAuthError,
  ChobitmailError,
  ChobitmailForbiddenError,
  ChobitmailNotFoundError,
  ChobitmailQuotaError,
  ChobitmailTimeoutError,
  ChobitmailTooManyWaitersError,
} from "./errors.js";
import { createInboxHandle } from "./inbox.js";
import type {
  Inbox,
  InboxHandle,
  Message,
  Usage,
  WaitFilter,
  WaitForMessageOptions,
} from "./types.js";

export type ChobitmailClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const DEFAULT_MAX_WAIT_MS = 120_000;
const DEFAULT_POLL_TIMEOUT_SEC = 25;
const TOO_MANY_WAITERS_INITIAL_MS = 200;
const TOO_MANY_WAITERS_CAP_MS = 2000;

export class ChobitmailClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options?: ChobitmailClientOptions) {
    const config = resolveConfig({
      apiKey: options?.apiKey,
      baseUrl: options?.baseUrl,
    });
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.fetchImpl = options?.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async createInbox(options?: { ttl?: number }): Promise<InboxHandle> {
    const res = await this.request("POST", "/api/inboxes", {
      body: options?.ttl !== undefined ? { ttl: options.ttl } : {},
      expectStatus: 201,
    });
    const inbox = (await res.json()) as Inbox;
    return createInboxHandle(this, inbox);
  }

  async listInboxes(): Promise<Inbox[]> {
    const res = await this.request("GET", "/api/inboxes", {
      expectStatus: 200,
    });
    const body = (await res.json()) as { inboxes: Inbox[] };
    return body.inboxes;
  }

  async deleteInbox(id: string): Promise<void> {
    const res = await this.request(
      "DELETE",
      `/api/inboxes/${encodeURIComponent(id)}`,
      {
        allowNotFound: true,
      },
    );
    if (res.status === 204 || res.status === 404) return;
    await this.throwForResponse(res);
  }

  async deleteAllInboxes(): Promise<void> {
    const res = await this.request("DELETE", "/api/inboxes", {
      expectStatus: 204,
    });
    if (res.status === 204) return;
    await this.throwForResponse(res);
  }

  async getUsage(): Promise<Usage> {
    const res = await this.request("GET", "/api/usage", { expectStatus: 200 });
    return (await res.json()) as Usage;
  }

  async listMessages(inboxId: string): Promise<Message[]> {
    const res = await this.request(
      "GET",
      `/api/inboxes/${encodeURIComponent(inboxId)}/messages`,
      { expectStatus: 200 },
    );
    const body = (await res.json()) as { messages: Message[] };
    return body.messages;
  }

  async waitForMessage(
    inboxId: string,
    options?: WaitForMessageOptions,
  ): Promise<Message> {
    const maxWaitMs = options?.timeout ?? DEFAULT_MAX_WAIT_MS;
    const pollTimeoutSec = options?.pollTimeoutSec ?? DEFAULT_POLL_TIMEOUT_SEC;
    const deadline = Date.now() + maxWaitMs;
    let backoff = TOO_MANY_WAITERS_INITIAL_MS;
    const filters = describeFilters(options);

    while (true) {
      if (options?.signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }

      const remaining = deadline - Date.now();
      if (remaining < 1000) {
        throw new ChobitmailTimeoutError(
          `No matching email within ${maxWaitMs}ms (filters: ${filters}). ` +
            "App may not have sent; tighten subject/from; check daily message quota.",
        );
      }

      const apiTimeoutSec = Math.min(
        pollTimeoutSec,
        Math.floor(remaining / 1000),
        30,
      );

      const query = buildWaitQuery(options, apiTimeoutSec);
      const path = `/api/inboxes/${encodeURIComponent(inboxId)}/messages/wait?${query}`;
      const res = await this.request("GET", path, { signal: options?.signal });

      debugLog("wait", {
        status: res.status,
        inboxId,
        remainingMs: remaining,
      });

      if (res.status === 200) {
        const body = (await res.json()) as { message: Message };
        return body.message;
      }

      if (res.status === 408) {
        continue;
      }

      if (res.status === 429) {
        const body = await safeJson(res);
        if (isRecord(body) && body.error === "tooManyWaiters") {
          const remainingAfter = deadline - Date.now();
          // sleep 後に wait リクエストを送れないなら TooManyWaiters で終了（Timeout より原因を優先）
          if (remainingAfter - backoff < 1000) {
            throw new ChobitmailTooManyWaitersError(
              `Too many concurrent waiters on inbox ${inboxId}; deadline exceeded while backing off.`,
              429,
              body,
            );
          }
          await sleep(backoff, options?.signal);
          backoff = Math.min(backoff * 2, TOO_MANY_WAITERS_CAP_MS);
          continue;
        }
        await this.throwFromStatusBody(429, body, { forCreate: false });
      }

      const body = await safeJson(res);
      await this.throwFromStatusBody(res.status, body, { forCreate: false });
    }
  }

  private authHeaders(jsonBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (jsonBody) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  private async request(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      expectStatus?: number;
      allowNotFound?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const hasBody = options?.body !== undefined;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.authHeaders(hasBody),
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options?.signal,
    });

    debugLog(method, path, res.status);

    // expectStatus 未指定時は呼び出し側が status を解釈する（wait の 408/429 など）
    if (options?.expectStatus === undefined) {
      return res;
    }

    if (res.status === options.expectStatus) {
      return res;
    }

    if (options.allowNotFound && res.status === 404) {
      return res;
    }

    // create 時の concurrent は list 件数を付与
    await this.throwForResponse(res, {
      forCreate: method === "POST" && path === "/api/inboxes",
    });
    return res; // unreachable
  }

  private async throwForResponse(
    res: Response,
    ctx?: { forCreate?: boolean },
  ): Promise<never> {
    const body = await safeJson(res);
    return await this.throwFromStatusBody(res.status, body, ctx);
  }

  private async throwFromStatusBody(
    status: number,
    body: unknown,
    ctx?: { forCreate?: boolean },
  ): Promise<never> {
    const errorName =
      isRecord(body) && typeof body.error === "string" ? body.error : undefined;

    if (status === 401 || errorName === "unauthorized") {
      throw new ChobitmailAuthError(
        "Unauthorized. Check CHOBITMAIL_API_KEY.",
        status,
        body,
      );
    }
    if (status === 403 || errorName === "forbidden") {
      throw new ChobitmailForbiddenError(
        "Forbidden. Account may be banned.",
        status,
        body,
      );
    }
    if (status === 404 || errorName === "notFound") {
      throw new ChobitmailNotFoundError(
        "Inbox not found or expired (TTL max 600s). " +
          "Often appears on reconnect after purge (prior wait may have been 408). " +
          "Shorten the test or increase ttl (max 600).",
        status,
        body,
      );
    }
    if (status === 429 && errorName === "tooManyWaiters") {
      throw new ChobitmailTooManyWaitersError(
        "Too many concurrent waiters on this inbox (max 10).",
        status,
        body,
      );
    }
    if (status === 429 && errorName === "quotaExceeded") {
      const reason =
        isRecord(body) &&
        (body.reason === "concurrent" || body.reason === "daily")
          ? body.reason
          : "concurrent";
      if (reason === "daily") {
        throw new ChobitmailQuotaError(
          "Daily inbox create quota exceeded (free unverified: 5/day UTC; verified: 50). " +
            "Reduce mail E2E count, verify a sender domain, use a Pro (or local PRO_TEAM_IDS) team, " +
            "or develop against local CHOBITMAIL_BASE_URL + seed key. GET /api/usage.",
          "daily",
          status,
          body,
        );
      }
      let activeHint = "";
      if (ctx?.forCreate) {
        try {
          const inboxes = await this.listInboxes();
          activeHint = ` Active inboxes: ${inboxes.length} (from list).`;
        } catch {
          // ignore secondary failure
        }
      }
      throw new ChobitmailQuotaError(
        "Concurrent inbox limit (free: 1, verified domain: 2). " +
          "Fixture auto-deletes after each test. Use workers=1; " +
          "do not share one API key across CI shards/matrix jobs." +
          activeHint +
          " Emergency: chobitmail.deleteAllInboxes() once — destructive.",
        "concurrent",
        status,
        body,
      );
    }

    throw new ChobitmailError(
      `Unexpected response ${status}${errorName ? ` (${errorName})` : ""}`,
      { code: "unexpected", status, body },
    );
  }
}

function buildWaitQuery(
  options: WaitForMessageOptions | undefined,
  apiTimeoutSec: number,
): string {
  const params = new URLSearchParams();
  params.set("timeout", String(apiTimeoutSec));
  appendFilter(params, options);
  return params.toString();
}

function appendFilter(params: URLSearchParams, filter?: WaitFilter): void {
  if (!filter) return;
  if (filter.subject !== undefined) params.set("subject", filter.subject);
  if (filter.from !== undefined) params.set("from", filter.from);
  if (
    filter.timestamp_from !== undefined &&
    Number.isFinite(filter.timestamp_from)
  ) {
    params.set("timestamp_from", String(filter.timestamp_from));
  }
  if (
    filter.timestamp_to !== undefined &&
    Number.isFinite(filter.timestamp_to)
  ) {
    params.set("timestamp_to", String(filter.timestamp_to));
  }
}

function describeFilters(options?: WaitFilter): string {
  if (!options) return "(none)";
  const parts: string[] = [];
  if (options.subject !== undefined)
    parts.push(`subject=${JSON.stringify(options.subject)}`);
  if (options.from !== undefined)
    parts.push(`from=${JSON.stringify(options.from)}`);
  if (options.timestamp_from !== undefined) {
    parts.push(`timestamp_from=${options.timestamp_from}`);
  }
  if (options.timestamp_to !== undefined) {
    parts.push(`timestamp_to=${options.timestamp_to}`);
  }
  return parts.length > 0 ? parts.join(", ") : "(none)";
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      },
      { once: true },
    );
  });
}
