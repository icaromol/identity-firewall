// The official Playwright extension-testing pattern
// (playwright.dev/docs/chrome-extensions, verified directly rather than
// assumed): a persistent context -- a plain chromium.launch() does not
// support extensions at all -- loaded with the real unpacked build, plus a
// fixture that reads the extension's own ID off its service worker.
// `channel: 'chromium'` is what makes this work headless. Shared by every
// e2e test in this suite -- extracted from formDetection.test.ts's own
// inline fixture (Phase 1, M6) once a second test (M8) needed the identical
// setup, matching M8's own "test consolidation" framing.

import path from 'node:path';
import { type BrowserContext, test as base, chromium, expect } from '@playwright/test';

// Points at the real production build -- not a hand-maintained test
// fixture extension. `pnpm test:e2e` runs `pnpm build` first (see
// package.json) so this reflects current source, never a stale build.
// import.meta.dirname, not __dirname -- see fixtures/server.ts's comment.
const EXTENSION_PATH = path.join(import.meta.dirname, '../../../.output/chrome-mv3');

// Minimal ambient type for the one chrome.* call this file needs inside
// page.evaluate()/worker.evaluate() callbacks -- this project has no
// @types/chrome dependency (deliberately avoided as an extra dependency).
type ChromeRuntime = { chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } } };

async function getServiceWorker(context: BrowserContext) {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  return sw;
}

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  restartServiceWorker: () => Promise<void>;
}>({
  // Playwright requires the first parameter to be an actual (possibly
  // empty) object-destructuring pattern -- it's how Playwright detects
  // which other fixtures this one depends on. This fixture needs none.
  // biome-ignore lint/correctness/noEmptyPattern: required by Playwright, see above
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const serviceWorker = await getServiceWorker(context);

    const extensionId = serviceWorker.url().split('/')[2];
    if (!extensionId) {
      throw new Error(
        `Could not determine extension ID from service worker URL: ${serviceWorker.url()}`,
      );
    }
    await use(extensionId);
  },
  // Forces a REAL termination + respawn of the extension's MV3 service
  // worker via CDP -- not a simulated one, and not waiting out the ~30s
  // idle timeout Phase 1's own e2e test (above) found Playwright can't
  // reliably control.
  //
  // Two things verified empirically against the real build before landing
  // on this exact implementation (both surprising enough to be worth
  // recording, not just asserting):
  //
  // 1. A browser-level CDP session (context.newCDPSession() only accepts a
  //    Page/Frame, not a service worker, hence going through
  //    context.browser() instead) can see the extension's service_worker
  //    CDP target, and Target.closeTarget on it genuinely tears down the
  //    worker's JS execution context.
  // 2. Chrome REUSES THE SAME CDP targetId for the respawned worker of the
  //    same extension -- an initial design that polled for a "different
  //    targetId" as proof of restart was reliably wrong (confirmed: 30
  //    consecutive poll attempts, same ID every time, timing out even
  //    though the restart demonstrably happened by other measures). The
  //    only reliable positive signal found is a globalThis marker set on
  //    the pre-kill worker via Worker.evaluate() and confirmed gone on the
  //    post-wake worker -- module-level JS state cannot survive a genuine
  //    context teardown, regardless of what CDP's own target bookkeeping
  //    reports.
  //
  // Closing the target does not respawn it by itself, either -- MV3
  // service workers are purely event-driven and stay dead until something
  // asks them to do something (a message, a navigation, an alarm). The
  // wake step below explicitly sends and AWAITS a real message response
  // (not just a page navigation) so the wake page isn't closed until the
  // round trip has genuinely completed.
  restartServiceWorker: async ({ context, extensionId }, use) => {
    await use(async () => {
      const browser = context.browser();
      if (!browser) {
        throw new Error(
          'context.browser() returned null -- expected non-null for a Chromium persistent context',
        );
      }

      // One session for both CDP calls this restart needs -- detached in
      // `finally` regardless of how the restart turns out. (The browser
      // process itself is torn down at context.close() either way, so this
      // detach is about hygiene within a single test run that might call
      // restartServiceWorker() more than once, not a correctness fix.)
      const cdp = await browser.newBrowserCDPSession();
      try {
        const sw = await getServiceWorker(context);

        // Mark the CURRENT execution context so its disappearance can be
        // positively confirmed after the kill+wake below.
        await sw.evaluate(() => {
          (globalThis as Record<string, unknown>).__e2eRestartMarker = true;
        });

        const { targetInfos } = await cdp.send('Target.getTargets');
        const matches = targetInfos.filter(
          (t) => t.type === 'service_worker' && t.url.includes(extensionId),
        );
        const [match] = matches;
        if (matches.length !== 1 || !match) {
          throw new Error(
            `Expected exactly one service_worker target for ${extensionId}, found ${matches.length}`,
          );
        }
        await cdp.send('Target.closeTarget', { targetId: match.targetId });

        const wakePage = await context.newPage();
        try {
          await wakePage.goto(`chrome-extension://${extensionId}/popup.html`);
          await wakePage.evaluate(() =>
            (globalThis as unknown as ChromeRuntime).chrome.runtime.sendMessage({
              type: 'VAULT_STATUS',
            }),
          );
        } finally {
          await wakePage.close();
        }

        // Proves a NEW execution context actually replaced the old one --
        // not just that closeTarget returned success, and not via targetId
        // (see this fixture's own header comment for why that's unreliable).
        // Without this check, the test could keep passing even if this
        // mechanism silently degraded into a no-op in some future
        // Playwright/Chromium version, since VAULT_LOCK already clears the
        // cached key regardless of whether the JS context actually died.
        await expect
          .poll(
            async () => {
              const respawned = await getServiceWorker(context);
              return await respawned
                .evaluate(() => (globalThis as Record<string, unknown>).__e2eRestartMarker)
                .catch(() => 'eval-failed' as const);
            },
            {
              timeout: 15_000,
              message:
                'Service worker still reports the pre-restart marker -- restart may not have occurred',
            },
          )
          .toBe(undefined);
      } finally {
        await cdp.detach().catch(() => {});
      }
    });
  },
});

export { expect } from '@playwright/test';
