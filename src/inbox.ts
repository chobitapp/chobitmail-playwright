import type { ChobitmailClient } from "./client.js";
import { ChobitmailSelectionError } from "./errors.js";
import type {
  Inbox,
  InboxHandle,
  Message,
  WaitForCodeOptions,
  WaitForLinkOptions,
  WaitForMessageOptions,
} from "./types.js";

export function createInboxHandle(
  client: ChobitmailClient,
  inbox: Inbox,
): InboxHandle {
  return {
    ...inbox,
    waitForMessage(options?: WaitForMessageOptions) {
      return client.waitForMessage(inbox.id, options);
    },
    async waitForCode(options?: WaitForCodeOptions) {
      const message = await client.waitForMessage(inbox.id, options);
      return pickCode(message, options);
    },
    async waitForLink(options?: WaitForLinkOptions) {
      const message = await client.waitForMessage(inbox.id, options);
      return pickLink(message, options);
    },
    listMessages() {
      return client.listMessages(inbox.id);
    },
    delete() {
      return client.deleteInbox(inbox.id);
    },
  };
}

export function pickCode(
  message: Message,
  options?: WaitForCodeOptions,
): string {
  let codes = message.codes;
  if (options?.length !== undefined) {
    codes = codes.filter((c) => c.length === options.length);
  }

  if (codes.length === 0) {
    throw new ChobitmailSelectionError(
      `Email arrived (id=${message.id}, subject=${JSON.stringify(message.subject)}) but no OTP codes matched. ` +
        "Server extracts 4–8 digit codes only. Tighten Message filters (subject/from); " +
        "do not expect waitForCode to skip to a later email. " +
        "Use timestamp_from if an earlier noise email matched.",
      { code: "no_code", messageId: message.id, subject: message.subject },
    );
  }

  const pick = options?.pick ?? "first";

  if (typeof pick === "function") {
    const selected = pick(codes, message);
    if (!codes.includes(selected)) {
      throw new ChobitmailSelectionError(
        `Email arrived (id=${message.id}, subject=${JSON.stringify(message.subject)}) but pick() returned a code not in the candidates.`,
        { code: "no_code", messageId: message.id, subject: message.subject },
      );
    }
    return selected;
  }
  if (pick === "longest") {
    return codes.reduce((a, b) => (b.length > a.length ? b : a));
  }
  if (pick === "shortest") {
    return codes.reduce((a, b) => (b.length < a.length ? b : a));
  }
  const first = codes[0];
  if (first === undefined) {
    throw new ChobitmailSelectionError(
      `Email arrived (id=${message.id}, subject=${JSON.stringify(message.subject)}) but no OTP codes matched.`,
      { code: "no_code", messageId: message.id, subject: message.subject },
    );
  }
  return first;
}

export function pickLink(
  message: Message,
  options?: WaitForLinkOptions,
): string {
  let links = message.links;
  const includes = options?.includes;
  if (includes !== undefined) {
    links = links.filter((l) => l.includes(includes));
  }
  const match = options?.match;
  if (match !== undefined) {
    links = links.filter((l) => match.test(l));
  }

  if (links.length === 0) {
    const preview = message.links.slice(0, 5).join(", ") || "(none)";
    throw new ChobitmailSelectionError(
      `Email arrived (id=${message.id}, subject=${JSON.stringify(message.subject)}) but no links matched. ` +
        'Use includes (e.g. "/verify") or match. Available links (sample): ' +
        `${preview}. Do not expect waitForLink to skip to a later email.`,
      { code: "no_link", messageId: message.id, subject: message.subject },
    );
  }

  if (options?.pick) {
    const selected = options.pick(links, message);
    if (!links.includes(selected)) {
      throw new ChobitmailSelectionError(
        `Email arrived (id=${message.id}, subject=${JSON.stringify(message.subject)}) but pick() returned a link not in the candidates.`,
        { code: "no_link", messageId: message.id, subject: message.subject },
      );
    }
    return selected;
  }

  const first = links[0];
  if (first === undefined) {
    throw new ChobitmailSelectionError(
      `Email arrived (id=${message.id}, subject=${JSON.stringify(message.subject)}) but no links matched.`,
      { code: "no_link", messageId: message.id, subject: message.subject },
    );
  }
  return first;
}
