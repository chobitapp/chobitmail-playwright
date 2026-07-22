import { ChobitmailConfigError } from "./errors.js";

export type ResolvedConfig = {
  apiKey: string;
  baseUrl: string;
};

export function resolveConfig(overrides?: {
  apiKey?: string;
  baseUrl?: string;
}): ResolvedConfig {
  const apiKey = overrides?.apiKey ?? process.env.CHOBITMAIL_API_KEY;
  const baseUrl = (
    overrides?.baseUrl ??
    process.env.CHOBITMAIL_BASE_URL ??
    "https://chobitmail.com"
  ).replace(/\/$/, "");

  if (!apiKey || apiKey.trim() === "") {
    throw new ChobitmailConfigError(
      "CHOBITMAIL_API_KEY is not set. Create a key at https://chobitmail.com and export it " +
        "(e.g. export CHOBITMAIL_API_KEY=cbm_live_...). " +
        "For local monorepo: pnpm run seed:dev and set CHOBITMAIL_BASE_URL=http://localhost:8787.",
    );
  }
  return { apiKey, baseUrl };
}

export function isDebugEnabled(): boolean {
  return process.env.CHOBITMAIL_DEBUG === "1";
}

export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.error("[chobitmail]", ...args);
  }
}
