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
});
