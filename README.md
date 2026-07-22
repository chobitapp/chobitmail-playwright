# @chobitmail/playwright

Playwright fixtures for the [chobitmail](https://chobitmail.com) disposable email API.

Create a one-time inbox per test, wait for mail (with 408 reconnect), and use pre-extracted OTP codes and verification links.

## Free tier limits (read this first)

| Limit | Free (unverified) | With verified sender domain |
| --- | --- | --- |
| Concurrent active inboxes | **1** | **2** |
| Inbox creates / day (UTC) | **5** | **50** |
| Messages received / day (UTC) | **5** | **50** |

- The fixture **auto-deletes** the inbox after each test so concurrent slots free up.
- **`workers=1` only helps concurrent**, not daily create/message caps.
- **Do not share one API key** across CI shards / matrix jobs.
- For larger suites: verify a sender domain, use a higher plan, or develop against local `CHOBITMAIL_BASE_URL` + seed key.

## Requirements

- **Node.js 18+**
- **ESM** (`"type": "module"` or `.mts` / bundler resolution)
- **`@playwright/test` >= 1.42.0** as a peer (same major as your project recommended)

## Install

```bash
pnpm add -D @chobitmail/playwright
# peer: @playwright/test already in your project
```

Runnable sample in this monorepo: [`example/playwright`](../../example/playwright)（OTP / verify-link / manual inbox）.

```bash
export CHOBITMAIL_API_KEY=cbm_live_...
# optional:
# export CHOBITMAIL_BASE_URL=https://chobitmail.com
# export CHOBITMAIL_DEBUG=1
```

## 3-line happy path

```ts
import { test, expect } from "@chobitmail/playwright";

test("signup OTP", async ({ page, inbox }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(inbox.address);
  await page.getByRole("button", { name: /sign up/i }).click();

  // OTP = waitForCode (not waitForOtp). Tighten subject so the first match is the OTP mail.
  const code = await inbox.waitForCode({ subject: "verification" });
  await page.getByLabel(/code|otp/i).fill(code);
  await expect(page.getByText(/welcome/i)).toBeVisible();
});
```

## API overview

| Fixture / API | Role |
| --- | --- |
| `inbox` | Per-test auto create + auto delete |
| `chobitmail` | Shared client (extra inboxes, usage) |
| `inboxOptions` | `test.use({ inboxOptions: { ttl, autoCreate, autoDelete } })` |
| `inbox.waitForMessage` | Long-poll with 408 reconnect |
| `inbox.waitForCode` | First matching message → pick OTP (fail-fast) |
| `inbox.waitForLink` | First matching message → pick URL (fail-fast) |
| `ChobitmailClient` | Use without Playwright fixtures |
| `runWithInbox` | create / use / delete lifecycle helper |

### Selection semantics (fail-fast)

`waitForCode` / `waitForLink` use the **first message** matching `subject` / `from` / `timestamp_*`.  
If that message has no matching codes/links, they throw **`ChobitmailSelectionError`** and **do not wait for a later email**.

Remediation:

1. Tighten `subject` / `from` to the OTP / verify template only.
2. Pass `timestamp_from` (test start ms) to ignore earlier noise.
3. Or use `waitForMessage` and pick from `message.codes` / `message.links` yourself.

### Magic / verify link

```ts
const link = await inbox.waitForLink({
  subject: "Verify",
  includes: "/verify",
});
await page.goto(link);
```

### Compose with other fixtures (`mergeTests`)

```ts
// fixtures/auth.ts
import { test as base } from "@playwright/test";

export type AuthFixtures = { authToken: string };

export const authTest = base.extend<AuthFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture
  authToken: async ({}, use) => {
    await use("test-token");
  },
});

// fixtures/index.ts
import { mergeTests } from "@playwright/test";
import { test as chobitmailTest, expect } from "@chobitmail/playwright";
import { authTest } from "./auth";

export const test = mergeTests(chobitmailTest, authTest);
export { expect };

// signup.spec.ts
import { test, expect } from "./fixtures";

test("signup with OTP", async ({ page, inbox, authToken }) => {
  expect(authToken).toBeTruthy();
  await page.getByLabel("Email").fill(inbox.address);
  const code = await inbox.waitForCode({ subject: "verification" });
  expect(code).toMatch(/^\d{4,8}$/);
});
```

### Manual inbox (no auto fixture)

```ts
test.use({ inboxOptions: { autoCreate: false } });

test("manual", async ({ chobitmail }) => {
  const box = await chobitmail.createInbox({ ttl: 600 });
  try {
    // ...
  } finally {
    await box.delete();
  }
});
```

### CI

```yaml
# GitHub Actions
env:
  CHOBITMAIL_API_KEY: ${{ secrets.CHOBITMAIL_API_KEY }}
```

In Playwright config for mail-dependent projects:

```ts
// workers: 1 for free-tier concurrent=1
export default defineConfig({
  workers: 1,
});
```

## Errors

| Class | When |
| --- | --- |
| `ChobitmailConfigError` | Missing `CHOBITMAIL_API_KEY`, or `inbox` used with `autoCreate: false` |
| `ChobitmailQuotaError` | `reason: "concurrent" \| "daily"` |
| `ChobitmailTimeoutError` | No matching mail before deadline |
| `ChobitmailSelectionError` | Mail arrived but no code/link matched (`code: "no_code" \| "no_link"`) |
| `ChobitmailNotFoundError` | Inbox expired / wrong id |
| `ChobitmailAuthError` / `Forbidden` | Auth |

## Source

- Product: [chobitmail.com](https://chobitmail.com)
- Public mirror: [chobitapp/chobitmail-playwright](https://github.com/chobitapp/chobitmail-playwright)
- Design: see monorepo `docs/playwright-fixture-design.md`

## License

MIT
