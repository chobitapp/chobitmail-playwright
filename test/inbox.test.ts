import { describe, expect, it } from "vitest";
import { ChobitmailSelectionError } from "../src/errors.js";
import { pickCode, pickLink } from "../src/inbox.js";
import { sampleMessage } from "./mock-fetch.js";

describe("pickCode", () => {
  it("returns first by default", () => {
    const msg = sampleMessage({ codes: ["12", "123456"] });
    expect(pickCode(msg)).toBe("12");
  });

  it("picks longest", () => {
    const msg = sampleMessage({ codes: ["12", "123456", "999"] });
    expect(pickCode(msg, { pick: "longest" })).toBe("123456");
  });

  it("filters by length", () => {
    const msg = sampleMessage({ codes: ["12", "123456"] });
    expect(pickCode(msg, { length: 6 })).toBe("123456");
  });

  it("throws no_code without re-wait semantics", () => {
    const msg = sampleMessage({ codes: [] });
    try {
      pickCode(msg);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ChobitmailSelectionError);
      expect((e as ChobitmailSelectionError).code).toBe("no_code");
      expect((e as Error).message).toContain(
        "do not expect waitForCode to skip",
      );
    }
  });
});

describe("pickLink", () => {
  it("filters by includes", () => {
    const msg = sampleMessage({
      links: [
        "https://example.com/unsubscribe",
        "https://example.com/verify?t=1",
      ],
    });
    expect(pickLink(msg, { includes: "/verify" })).toBe(
      "https://example.com/verify?t=1",
    );
  });

  it("throws no_link when no match", () => {
    const msg = sampleMessage({ links: ["https://example.com/unsub"] });
    expect(() => pickLink(msg, { includes: "/verify" })).toThrow(
      ChobitmailSelectionError,
    );
  });
});
