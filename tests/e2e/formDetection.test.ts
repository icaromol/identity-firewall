// M6 -- the first automated test that drives the real built extension in
// an actual browser, rather than mocking browser.* via fakeBrowser the
// way every unit test does. See
// docs/plans/phase-1-extension-foundation.md (M6).
//
// Deliberately not attempted here: simulating the ~30-second MV3
// service-worker idle-kill/restart -- Playwright doesn't reliably control
// that timing. That property stayed a manual-only check through M7; M8
// (tests/e2e/vaultLifecycle.test.ts) later found a way to force a real
// restart on demand via CDP instead of waiting out the timer -- see this
// file's shared context/extensionId fixture, now in ./fixtures/extension.

import { expect, test } from './fixtures/extension';
import { type FixtureServer, startFixtureServer } from './fixtures/server';

test('popup shows detected forms, accumulating across origins as the user navigates', async ({
  context,
  extensionId,
}) => {
  // Real HTTP, never file:// -- entrypoints/content.ts's manifest
  // `matches` is ['http://*/*', 'https://*/*'] only, so a file:// fixture
  // would never get the content script injected at all.
  //
  // Declared before the try so a throw from the second startFixtureServer()
  // call can't leak the first server unclosed -- ?.close() below is a
  // no-op for whichever one never got created.
  let siteA: FixtureServer | undefined;
  let siteB: FixtureServer | undefined;

  try {
    siteA = await startFixtureServer();
    siteB = await startFixtureServer();
    // Captured as plain strings rather than read off siteA/siteB again
    // below -- those are `let`s TypeScript won't narrow as still-defined
    // inside the expect.poll() closure further down.
    const originA = siteA.origin;
    const originB = siteB.origin;

    const page = await context.newPage();
    await page.goto(originA);

    // Playwright can't click a real toolbar icon -- navigate directly to
    // the popup's own page, exactly as the browser itself would render it.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(popup.getByText(originA, { exact: true })).toBeVisible();
    await expect(popup.getByText('1 form(s)', { exact: true })).toBeVisible();

    await page.goto(originB);

    // A popup is destroyed and recreated on every open (see
    // stores/session.store.ts's header comment) -- reload simulates
    // exactly that: a fresh mount, refetching from background. But
    // fetchSessionState() runs exactly once per mount, with no polling or
    // retry -- if this single reload races the content script's
    // document_idle injection + the background round-trip for siteB
    // (plausible on a slower/loaded CI runner), the popup renders once
    // with stale data and never updates again, so a plain toBeVisible()
    // retry-loop on the existing DOM would time out instead of recovering.
    // expect.poll() re-runs the whole reload on every attempt instead, so
    // each attempt is a fresh fetch, not just a fresh look at stale DOM.
    await expect
      .poll(
        async () => {
          await popup.reload();
          return popup.locator('li', { hasText: originB }).count();
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // Confirms accumulation, not replacement -- siteA must still be there
    // after siteB shows up.
    await expect(popup.getByText(originA, { exact: true })).toBeVisible();
  } finally {
    await siteA?.close();
    await siteB?.close();
  }
});
