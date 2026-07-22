export type ChobitmailErrorCode =
  | "config"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "quota_concurrent"
  | "quota_daily"
  | "timeout"
  | "too_many_waiters"
  | "no_code"
  | "no_link"
  | "unexpected";

export class ChobitmailError extends Error {
  readonly code: ChobitmailErrorCode;
  readonly status?: number;
  readonly body?: unknown;

  constructor(
    message: string,
    options: {
      code: ChobitmailErrorCode;
      status?: number;
      body?: unknown;
      cause?: unknown;
    },
  ) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "ChobitmailError";
    this.code = options.code;
    this.status = options.status;
    this.body = options.body;
  }
}

export class ChobitmailConfigError extends ChobitmailError {
  constructor(message: string) {
    super(message, { code: "config" });
    this.name = "ChobitmailConfigError";
  }
}

export class ChobitmailAuthError extends ChobitmailError {
  constructor(message: string, status = 401, body?: unknown) {
    super(message, { code: "unauthorized", status, body });
    this.name = "ChobitmailAuthError";
  }
}

export class ChobitmailForbiddenError extends ChobitmailError {
  constructor(message: string, status = 403, body?: unknown) {
    super(message, { code: "forbidden", status, body });
    this.name = "ChobitmailForbiddenError";
  }
}

export class ChobitmailNotFoundError extends ChobitmailError {
  constructor(message: string, status = 404, body?: unknown) {
    super(message, { code: "not_found", status, body });
    this.name = "ChobitmailNotFoundError";
  }
}

export class ChobitmailQuotaError extends ChobitmailError {
  readonly reason: "concurrent" | "daily";

  constructor(
    message: string,
    reason: "concurrent" | "daily",
    status = 429,
    body?: unknown,
  ) {
    super(message, {
      code: reason === "concurrent" ? "quota_concurrent" : "quota_daily",
      status,
      body,
    });
    this.name = "ChobitmailQuotaError";
    this.reason = reason;
  }
}

export class ChobitmailTimeoutError extends ChobitmailError {
  constructor(message: string) {
    super(message, { code: "timeout" });
    this.name = "ChobitmailTimeoutError";
  }
}

export class ChobitmailTooManyWaitersError extends ChobitmailError {
  constructor(message: string, status = 429, body?: unknown) {
    super(message, { code: "too_many_waiters", status, body });
    this.name = "ChobitmailTooManyWaitersError";
  }
}

/** codes/links 選択失敗（待受 200 後の fail-fast）。Timeout ではない */
export class ChobitmailSelectionError extends ChobitmailError {
  readonly messageId?: string;
  readonly subject?: string;

  constructor(
    message: string,
    options: {
      code: "no_code" | "no_link";
      messageId?: string;
      subject?: string;
    },
  ) {
    super(message, { code: options.code });
    this.name = "ChobitmailSelectionError";
    this.messageId = options.messageId;
    this.subject = options.subject;
  }
}
