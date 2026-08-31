// Phase 5 M4 -- proves the real content-script submit-capture pipeline
// end to end: a real page, a real <form> submit event, captured by the
// actual capture-phase listener in entrypoints/content.ts, staged via a
// real FORM_SUBMITTED round trip to the background service worker.
//
// CONFIRM_PENDING_CREDENTIAL is NOT exercised here, unlike
// vaultLifecycle.test.ts's precedent for CREATE_SERVICE_IDENTITY: its own
// handler re-verifies the claimed tab via browser.tabs.get(tabId), which
// needs the real 'activeTab' permission to return anything but a
// url-stripped Tab object -- and activeTab only ever activates on a
// genuine, user-invoked toolbar click, which Playwright cannot produce at
// all (the same limitation Phase 1's M6 first documented for the action
// icon in general, and firewallApproval.test.ts's own header comment
// documents again for the sibling "Pending request" section). Confirmed
// directly: even the correct tabId (found via chrome.tabs.getCurrent()'s
// own openerTabId, which needs no permission at all) still fails this
// check, since 'activeTab' itself was never genuinely granted this
// session. handleConfirmPendingCredential's own logic is fully covered by
// tests/unit/background/vault/credentials/handler.test.ts instead (with
// tabs.get mocked, matching handleSetHighTrustOrigin/
// handleSubmitFieldDecisions's own established test convention); the
// popup Save/Discard buttons remain a manual-verification item, same
// category as the rest of this project's activeTab-gated UI.

import { expect, test } from './fixtures/extension';
import { type FixtureServer, startFixtureServer } from './fixtures/server';

declare const chrome: {
  runtime: {
    sendMessage: <T = unknown>(
      message: unknown,
    ) => Promise<{ ok: boolean; data?: T; error?: string }>;
  };
  tabs: {
    getCurrent: () => Promise<{ openerTabId?: number }>;
    sendMessage: <T = unknown>(tabId: number, message: unknown) => Promise<T>;
  };
};

let site: FixtureServer;

test.beforeAll(async () => {
  site = await startFixtureServer();
});

test.afterAll(async () => {
  await site.close();
});

test('a real form submit is captured and staged, reachable via GET_PENDING_CREDENTIAL', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(site.origin);

  await page.locator('input[type=email]').fill('alice@example.com');
  await page.locator('input[type=password]').fill('hunter2');
  // requestSubmit(), not dispatchEvent('submit') -- goes through the real
  // native submit pathway a synthetic event bypasses. The fixture page's
  // own script calls preventDefault() so this doesn't actually navigate
  // away mid-test.
  await page.evaluate(() => {
    document.querySelector('form')?.requestSubmit();
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // GET_PENDING_CREDENTIAL has no activeTab/tabs dependency at all (it's
  // origin-keyed, passed explicitly) -- fully reachable here, unlike
  // CONFIRM (see header comment).
  await expect
    .poll(async () =>
      popup.evaluate(
        (origin) =>
          chrome.runtime.sendMessage<{ identifier: string | null; password: string }>({
            type: 'GET_PENDING_CREDENTIAL',
            payload: { origin },
          }),
        site.origin,
      ),
    )
    .toMatchObject({ ok: true, data: { identifier: 'alice@example.com', password: 'hunter2' } });
});

test('AUTOFILL_FIELDS replies with whether it actually wrote anything (Phase 5 M5 /code-review fix)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(site.origin);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // Same technique credentialCapture's other test uses to find `page`'s
  // real tabId without any tabs permission -- see that test's own comment.
  const tabId = await popup.evaluate(async () => {
    const self = await chrome.tabs.getCurrent();
    return self.openerTabId;
  });

  // A real match -- the fixture's email field is index 0, name="email"
  // (see tests/e2e/fixtures/login-form.html), so its key is "0:email"
  // (shared/fieldKey.ts's own index-prefixed convention).
  const applied = await popup.evaluate(
    (id) =>
      chrome.tabs.sendMessage<boolean>(id as number, {
        type: 'AUTOFILL_FIELDS',
        payload: { formIndex: 0, values: { '0:email': 'alice@example.com' } },
      }),
    tabId,
  );
  expect(applied).toBe(true);
  await expect(page.locator('input[type=email]')).toHaveValue('alice@example.com');

  // A formIndex that doesn't exist on this page -- nothing to apply.
  const notApplied = await popup.evaluate(
    (id) =>
      chrome.tabs.sendMessage<boolean>(id as number, {
        type: 'AUTOFILL_FIELDS',
        payload: { formIndex: 5, values: { '0:email': 'nope' } },
      }),
    tabId,
  );
  expect(notApplied).toBe(false);
});

test('a form submit with no password field is never captured', async ({ context, extensionId }) => {
  const server = await startFixtureServer();
  try {
    const page = await context.newPage();
    // The shared fixture always has a password field -- this test proves
    // the negative case using a page with none, built inline.
    await page.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<form><input type="text" name="q" /></form>',
      }),
    );
    await page.goto(server.origin);
    await page.locator('input[type=text]').fill('just a search');
    await page.evaluate(() => document.querySelector('form')?.requestSubmit());

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const result = await popup.evaluate(
      (origin) =>
        chrome.runtime.sendMessage({ type: 'GET_PENDING_CREDENTIAL', payload: { origin } }),
      server.origin,
    );
    expect(result).toMatchObject({ ok: true, data: null });
  } finally {
    await server.close();
  }
});
