import type { ChobitmailClient } from "./client.js";
import type { InboxHandle } from "./types.js";

export type RunWithInboxOptions = {
  ttl?: number;
  /** 既定 true */
  autoDelete?: boolean;
  /** DELETE 失敗時コールバック（fixture は annotation + warn に接続） */
  onDeleteError?: (err: unknown, inboxId: string) => void;
};

/**
 * create → fn(handle) → finally delete（1 リトライ）。
 * fixture と vitest の両方から使う。
 */
export async function runWithInbox<T>(
  client: ChobitmailClient,
  options: RunWithInboxOptions,
  fn: (inbox: InboxHandle) => Promise<T>,
): Promise<T> {
  const inbox = await client.createInbox({ ttl: options.ttl });
  try {
    return await fn(inbox);
  } finally {
    if (options.autoDelete !== false) {
      await deleteWithRetry(inbox, options.onDeleteError);
    }
  }
}

const DELETE_RETRY_BACKOFF_MS = 150;

/** DELETE: 1 回リトライ（短い backoff）。404 は成功。 */
export async function deleteWithRetry(
  inbox: InboxHandle,
  onDeleteError?: (err: unknown, inboxId: string) => void,
): Promise<void> {
  try {
    await inbox.delete();
    return;
  } catch {
    await new Promise((r) => setTimeout(r, DELETE_RETRY_BACKOFF_MS));
    try {
      await inbox.delete();
    } catch (second) {
      onDeleteError?.(second, inbox.id);
      console.warn(
        `[chobitmail] failed to delete inbox ${inbox.id} after retry:`,
        second,
      );
    }
  }
}
