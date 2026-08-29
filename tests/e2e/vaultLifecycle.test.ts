// M8 -- proves the vault survives a REAL MV3 service-worker restart, not a
// simulated one. Unit tests (background/vault/**) mock browser.* via
// fakeBrowser, which can never truly clear module-level JS state
// (salt.ts's cachedSalt, storage.ts's per-tier write-queues, the
// per-payloadStorageKey queue Map, etc.) the way an actual service-worker
// termination does -- this test is the only thing in the suite that
// exercises that specific failure mode for real. See
// tests/e2e/fixtures/extension.ts's restartServiceWorker for the CDP
// technique and its own empirical verification notes.

import { expect, test } from './fixtures/extension';

// popup.evaluate() callbacks below run inside the extension's own popup
// page, where `chrome.*` is a real global -- but this project has no
// @types/chrome dependency (deliberately avoided as an extra dependency;
// wxt/browser's own types don't cover raw `chrome.*` either). Declared
// separately from fixtures/extension.ts's own (narrower) ChromeRuntime
// type rather than reused -- this file needs a generic `sendMessage<T>`
// to type each call's response payload, which that simpler ping-only type
// doesn't need.
declare const chrome: {
  runtime: {
    sendMessage: <T = unknown>(
      message: unknown,
    ) => Promise<{ ok: boolean; data?: T; error?: string }>;
  };
};

test('a Service Identity survives a real service-worker restart', async ({
  context,
  extensionId,
  restartServiceWorker,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const passphrase = 'correct horse battery staple';

  // Setup via the REAL UI, not a raw message -- exercises
  // stores/vault.store.ts's actual setupWithPassphrase code path.
  await popup.getByPlaceholder('Or choose a passphrase instead').fill(passphrase);
  await popup.getByRole('button', { name: 'Set up with Passphrase' }).click();
  await expect(popup.getByText('Vault unlocked.')).toBeVisible();

  // CREATE_SERVICE_IDENTITY has no UI yet (Phase 3's job) -- direct message
  // is the only way to reach it.
  const created = await popup.evaluate(
    (origin) =>
      chrome.runtime.sendMessage<{ identifierB64: string }>({
        type: 'CREATE_SERVICE_IDENTITY',
        payload: { origin },
      }),
    'https://example.com',
  );
  expect(created.ok).toBe(true);

  await popup.getByRole('button', { name: 'Lock' }).click();
  await expect(popup.getByText('Vault is locked.')).toBeVisible();

  // Force a REAL restart -- not simulated (see fixtures/extension.ts).
  await restartServiceWorker();

  // Warm-up: confirm the app layer (message routing) is responsive again
  // BEFORE touching the UI, so a wake failure is diagnosed here, not as a
  // generic UI-assertion timeout several steps later. A forced CDP kill is
  // a more abrupt termination than the natural idle-timeout MV3's
  // wake-on-event logic was primarily built and tested against.
  await expect
    .poll(async () => {
      const status = await popup
        .evaluate(() => chrome.runtime.sendMessage({ type: 'VAULT_STATUS' }))
        .catch(() => null);
      return status?.ok === true;
    })
    .toBe(true);

  // Reload so the popup re-fetches VAULT_STATUS against the (freshly-
  // respawned) worker, then unlock via the real UI again. getByPlaceholder
  // ('Passphrase')/getByRole('button', {name: 'Unlock with Passphrase'})
  // only resolve unambiguously because App.vue's three vault sections are
  // mutually exclusive v-else-if branches -- only the locked branch is in
  // the DOM right now. A future App.vue change that ever shows two
  // branches at once would need these selectors revisited.
  await popup.reload();
  await popup.getByPlaceholder('Passphrase').fill(passphrase);
  await popup.getByRole('button', { name: 'Unlock with Passphrase' }).click();
  await expect(popup.getByText('Vault unlocked.')).toBeVisible();

  // The Service Identity created before the restart must be exactly the
  // same after it -- the concrete proof that everything the vault needs
  // (the encrypted index tier, FixedAppSalt, the site's Tier 3 payload) was
  // truly persisted, not held in any module-level cache that a real
  // restart wipes clean.
  const after = await popup.evaluate(
    (origin) =>
      chrome.runtime.sendMessage<{ identifierB64: string }>({
        type: 'GET_SERVICE_IDENTITY',
        payload: { origin },
      }),
    'https://example.com',
  );
  expect(after.data?.identifierB64).toBe(created.data?.identifierB64);
});
