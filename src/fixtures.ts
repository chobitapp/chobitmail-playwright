import { test as base, expect } from "@playwright/test";
import { ChobitmailClient } from "./client.js";
import { resolveConfig } from "./env.js";
import { ChobitmailConfigError } from "./errors.js";
import { runWithInbox } from "./lifecycle.js";
import type { InboxFixtureOptions, InboxHandle } from "./types.js";

type WorkerFixtures = {
  chobitmail: ChobitmailClient;
};

type TestFixtures = {
  inboxOptions: InboxFixtureOptions;
  inbox: InboxHandle;
};

export type ChobitmailFixtures = WorkerFixtures & TestFixtures;

const defaultInboxOptions: Required<
  Pick<InboxFixtureOptions, "ttl" | "autoDelete" | "autoCreate">
> = {
  ttl: 600,
  autoDelete: true,
  autoCreate: true,
};

function unusableInbox(): InboxHandle {
  const fail = (): never => {
    throw new ChobitmailConfigError(
      "inbox autoCreate is disabled. Use chobitmail.createInbox() and delete() yourself.",
    );
  };
  return new Proxy({} as InboxHandle, {
    get: () => fail,
  });
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  chobitmail: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright worker fixture has no deps
    async ({}, use) => {
      await use(new ChobitmailClient(resolveConfig()));
    },
    { scope: "worker" },
  ],

  inboxOptions: [defaultInboxOptions, { option: true }],

  inbox: async ({ chobitmail, inboxOptions }, use, testInfo) => {
    if (inboxOptions.autoCreate === false) {
      await use(unusableInbox());
      return;
    }

    await runWithInbox(
      chobitmail,
      {
        ttl: inboxOptions.ttl,
        autoDelete: inboxOptions.autoDelete,
        onDeleteError: (err, inboxId) => {
          testInfo.annotations.push({
            type: "chobitmail:delete-failed",
            description: `inbox ${inboxId}: ${err instanceof Error ? err.message : String(err)}`,
          });
        },
      },
      async (handle) => {
        await use(handle);
      },
    );
  },
});

export { expect };
