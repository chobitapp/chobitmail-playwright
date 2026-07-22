import { describe, expect, it, vi } from "vitest";
import { ChobitmailClient } from "../src/client.js";
import { runWithInbox } from "../src/lifecycle.js";
import { createMockFetch, sampleInbox } from "./mock-fetch.js";

describe("runWithInbox", () => {
  it("deletes after success", async () => {
    const inbox = sampleInbox();
    const { fetch, calls } = createMockFetch([
      { method: "POST", path: "/api/inboxes", status: 201, body: inbox },
      { method: "DELETE", path: "/api/inboxes/inbox1", status: 204 },
    ]);
    const client = new ChobitmailClient({
      apiKey: "k",
      baseUrl: "http://example.test",
      fetch,
    });

    const result = await runWithInbox(client, {}, async (h) => {
      expect(h.id).toBe("inbox1");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
  });

  it("deletes after fn throws", async () => {
    const inbox = sampleInbox();
    const { fetch, calls } = createMockFetch([
      { method: "POST", path: "/api/inboxes", status: 201, body: inbox },
      { method: "DELETE", path: "/api/inboxes/inbox1", status: 204 },
    ]);
    const client = new ChobitmailClient({
      apiKey: "k",
      baseUrl: "http://example.test",
      fetch,
    });

    await expect(
      runWithInbox(client, {}, async () => {
        throw new Error("test failed");
      }),
    ).rejects.toThrow("test failed");
    expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
  });

  it("retries delete once and reports on second failure", async () => {
    const inbox = sampleInbox();
    const { fetch } = createMockFetch([
      { method: "POST", path: "/api/inboxes", status: 201, body: inbox },
      {
        method: "DELETE",
        path: "/api/inboxes/inbox1",
        status: 500,
        sequence: [
          { status: 500, body: { error: "boom" } },
          { status: 500, body: { error: "boom" } },
        ],
      },
    ]);
    const client = new ChobitmailClient({
      apiKey: "k",
      baseUrl: "http://example.test",
      fetch,
    });
    const onDeleteError = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runWithInbox(client, { onDeleteError }, async () => "ok");

    expect(onDeleteError).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips delete when autoDelete false", async () => {
    const inbox = sampleInbox();
    const { fetch, calls } = createMockFetch([
      { method: "POST", path: "/api/inboxes", status: 201, body: inbox },
    ]);
    const client = new ChobitmailClient({
      apiKey: "k",
      baseUrl: "http://example.test",
      fetch,
    });
    await runWithInbox(client, { autoDelete: false }, async () => "ok");
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
  });
});
