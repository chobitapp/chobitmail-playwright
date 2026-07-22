import { afterEach, describe, expect, it } from "vitest";
import { ChobitmailClient } from "../src/client.js";
import {
  ChobitmailAuthError,
  ChobitmailConfigError,
  ChobitmailQuotaError,
  ChobitmailTimeoutError,
  ChobitmailTooManyWaitersError,
} from "../src/errors.js";
import { createMockFetch, sampleInbox, sampleMessage } from "./mock-fetch.js";

const KEY = "cbm_live_test";

afterEach(() => {
  delete process.env.CHOBITMAIL_API_KEY;
  delete process.env.CHOBITMAIL_BASE_URL;
});

describe("ChobitmailClient", () => {
  it("throws config error when API key missing", () => {
    expect(() => new ChobitmailClient({ baseUrl: "http://localhost" })).toThrow(
      ChobitmailConfigError,
    );
  });

  it("creates inbox on 201 and unwraps envelope", async () => {
    const inbox = sampleInbox();
    const { fetch, calls } = createMockFetch([
      { method: "POST", path: "/api/inboxes", status: 201, body: inbox },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    const handle = await client.createInbox({ ttl: 600 });
    expect(handle.address).toBe(inbox.address);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toContain("600");
  });

  it("rejects create when status is not 201", async () => {
    const { fetch } = createMockFetch([
      {
        method: "POST",
        path: "/api/inboxes",
        status: 200,
        body: sampleInbox(),
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    await expect(client.createInbox()).rejects.toThrow(
      /Unexpected response 200/,
    );
  });

  it("lists inboxes unwrapping envelope", async () => {
    const inbox = sampleInbox();
    const { fetch } = createMockFetch([
      {
        method: "GET",
        path: "/api/inboxes",
        status: 200,
        body: { inboxes: [inbox] },
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    await expect(client.listInboxes()).resolves.toEqual([inbox]);
  });

  it("deleteInbox treats 404 as success", async () => {
    const { fetch } = createMockFetch([
      {
        method: "DELETE",
        path: "/api/inboxes/inbox1",
        status: 404,
        body: { error: "notFound" },
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    await expect(client.deleteInbox("inbox1")).resolves.toBeUndefined();
  });

  it("maps 401 to ChobitmailAuthError", async () => {
    const { fetch } = createMockFetch([
      {
        method: "GET",
        path: "/api/usage",
        status: 401,
        body: { error: "unauthorized" },
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    await expect(client.getUsage()).rejects.toBeInstanceOf(ChobitmailAuthError);
  });

  it("maps concurrent quota and includes active count once", async () => {
    const { fetch, calls } = createMockFetch([
      {
        method: "POST",
        path: "/api/inboxes",
        status: 429,
        body: { error: "quotaExceeded", reason: "concurrent" },
      },
      {
        method: "GET",
        path: "/api/inboxes",
        status: 200,
        body: { inboxes: [sampleInbox(), sampleInbox({ id: "inbox2" })] },
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    try {
      await client.createInbox();
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ChobitmailQuotaError);
      expect((e as ChobitmailQuotaError).reason).toBe("concurrent");
      expect((e as Error).message).toContain("Active inboxes: 2");
    }
    expect(calls.some((c) => c.method === "GET")).toBe(true);
  });

  it("maps daily quota", async () => {
    const { fetch } = createMockFetch([
      {
        method: "POST",
        path: "/api/inboxes",
        status: 429,
        body: { error: "quotaExceeded", reason: "daily" },
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    await expect(client.createInbox()).rejects.toMatchObject({
      reason: "daily",
    });
  });

  it("reconnects on 408 then returns message", async () => {
    const message = sampleMessage();
    const { fetch, calls } = createMockFetch([
      {
        method: "GET",
        path: /\/messages\/wait/,
        status: 200,
        sequence: [
          { status: 408, body: { error: "timeout" } },
          { status: 200, body: { message } },
        ],
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    const got = await client.waitForMessage("inbox1", {
      timeout: 5_000,
      pollTimeoutSec: 1,
    });
    expect(got.codes).toEqual(["482913"]);
    expect(calls.length).toBe(2);
  });

  it("stringifies timestamp filters", async () => {
    const message = sampleMessage();
    const { fetch, calls } = createMockFetch([
      {
        method: "GET",
        path: /\/messages\/wait/,
        status: 200,
        body: { message },
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    await client.waitForMessage("inbox1", {
      timeout: 5_000,
      pollTimeoutSec: 1,
      timestamp_from: 1_700_000_000_000,
      subject: "Verify",
    });
    expect(calls[0]?.url).toContain("timestamp_from=1700000000000");
    expect(calls[0]?.url).toContain("subject=Verify");
  });

  it("does not send wait when remaining under 1s", async () => {
    const { fetch, calls } = createMockFetch([
      {
        method: "GET",
        path: /\/messages\/wait/,
        status: 200,
        body: { message: sampleMessage() },
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    await expect(
      client.waitForMessage("inbox1", { timeout: 0, pollTimeoutSec: 1 }),
    ).rejects.toBeInstanceOf(ChobitmailTimeoutError);
    expect(calls.length).toBe(0);
  });

  it("backs off on tooManyWaiters then succeeds", async () => {
    const message = sampleMessage();
    const { fetch } = createMockFetch([
      {
        method: "GET",
        path: /\/messages\/wait/,
        status: 200,
        sequence: [
          { status: 429, body: { error: "tooManyWaiters" } },
          { status: 200, body: { message } },
        ],
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    const got = await client.waitForMessage("inbox1", {
      timeout: 5_000,
      pollTimeoutSec: 1,
    });
    expect(got.id).toBe("msg1");
  });

  it("throws TooManyWaiters when backoff cannot finish before deadline", async () => {
    const { fetch } = createMockFetch([
      {
        method: "GET",
        path: /\/messages\/wait/,
        status: 429,
        body: { error: "tooManyWaiters" },
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: KEY,
      baseUrl: "http://example.test",
      fetch,
    });
    await expect(
      client.waitForMessage("inbox1", { timeout: 1_100, pollTimeoutSec: 1 }),
    ).rejects.toBeInstanceOf(ChobitmailTooManyWaitersError);
  });
});
