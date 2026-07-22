export type Attachment = {
  filename: string | null;
  mimeType: string;
  size: number;
};

export type Message = {
  id: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  links: string[];
  codes: string[];
  attachments: Attachment[];
  /** ISO 8601 */
  receivedAt: string;
};

export type Inbox = {
  id: string;
  address: string;
  createdAt: string;
  expiresAt: string;
};

/**
 * API wait クエリと対応（複数指定時は AND）。
 * subject: 部分一致・case-sensitive。from: エンベロープ完全一致。
 */
export type WaitFilter = {
  /**
   * 件名の部分一致（case-sensitive）。
   * `message.subject.includes(subject)` と同等。
   */
  subject?: string;
  /**
   * エンベロープ From の完全一致（ヘッダ From ではない）。
   */
  from?: string;
  /** receivedAt 下限（Unix ms, inclusive）。HTTP では十進文字列 */
  timestamp_from?: number;
  /** receivedAt 上限（Unix ms, inclusive） */
  timestamp_to?: number;
};

export type WaitForMessageOptions = WaitFilter & {
  /** クライアント全体の上限待機。既定 120_000 ms */
  timeout?: number;
  /** 1 回の wait の timeout 秒（1–30）。既定 25 */
  pollTimeoutSec?: number;
  /** abort 時は即座に中断（ループ先頭で signal を deadline より優先） */
  signal?: AbortSignal;
};

export type WaitForCodeOptions = WaitForMessageOptions & {
  pick?:
    | "first"
    | "longest"
    | "shortest"
    | ((codes: string[], message: Message) => string);
  /** 期待桁数。該当なし → ChobitmailSelectionError（再待受しない） */
  length?: number;
};

export type WaitForLinkOptions = WaitForMessageOptions & {
  includes?: string;
  match?: RegExp;
  pick?: (links: string[], message: Message) => string;
};

export type Usage = {
  teamId: string;
  plan: "free" | "pro";
  complimentaryPro: boolean;
  verified: boolean;
  concurrent: { used: number; limit: number | null };
  dailyInboxes: { used: number; limit: number | null };
  dailyMessages: { used: number; limit: number | null };
  ttl: { defaultSeconds: number; maxSeconds: number };
  maxDomains: number;
  maxApiKeys: number;
};

export type InboxFixtureOptions = {
  /** 作成時 TTL 秒。Free は 60–600、Pro は 60–86400 に clamp */
  ttl?: number;
  /** false で teardown DELETE をスキップ。既定 true */
  autoDelete?: boolean;
  /**
   * false のとき `inbox` fixture は受信箱を作成しない。
   * 既定 true
   */
  autoCreate?: boolean;
};

export type InboxHandle = Inbox & {
  /** Message フィルタに合う最古の 1 通が届くまで 408 再接続 */
  waitForMessage(options?: WaitForMessageOptions): Promise<Message>;

  /**
   * waitForMessage で得たその 1 通から codes を選ぶ。
   * 選択失敗は ChobitmailSelectionError（fail-fast）。
   */
  waitForCode(options?: WaitForCodeOptions): Promise<string>;

  /**
   * waitForMessage で得たその 1 通から links を選ぶ。
   * 選択失敗は ChobitmailSelectionError（fail-fast）。
   */
  waitForLink(options?: WaitForLinkOptions): Promise<string>;

  listMessages(): Promise<Message[]>;

  /** DELETE。404 は成功。 */
  delete(): Promise<void>;
};
