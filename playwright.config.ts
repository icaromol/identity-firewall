import { defineConfig } from '@playwright/test';

// M6 -- the first automated test that drives the real built extension in
// an actual browser, rather than mocking browser.* via fakeBrowser the
// way every unit test does. See docs/plans/phase-1-extension-foundation.md
// (M6) and docs/research/phase-1-tooling-scaffold.md §9.
//
// Deliberately NOT part of `pnpm check` / Husky's pre-commit hook: a real
// Chromium launch is multi-second and needs a separately-installed browser
// binary (`pnpm exec playwright install chromium`, a one-time manual step
// -- see README) not guaranteed present on every dev machine, unlike the
// fast, always-available Vitest suite. Run explicitly via `pnpm test:e2e`.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  reporter: 'list',
  // Repo-wide, not a per-test override -- tests/e2e/vaultLifecycle.test.ts
  // (M8) found the default 5s web-assertion timeout genuinely too tight
  // for this extension specifically: deriveVaultUnlockKey's Argon2id call
  // runs through @noble/hashes's pure-JS implementation (no WASM/native),
  // and that cost recurs in every vault e2e test this project writes, not
  // just one -- combined with MV3 service-worker cold-start after a forced
  // restart, it can plausibly exceed 5s on a loaded machine.
  expect: {
    timeout: 15_000,
  },
});
