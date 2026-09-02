// Phase 5 M1 -- the Personal Data screen. Unlike firewallApproval.test.ts's
// sections, stores/personalData.store.ts never calls browser.tabs.query --
// PersonalData is one single vault-wide blob, not scoped per active tab --
// so this one CAN be exercised fully end-to-end here, not just for its
// graceful-degradation path.
//
// Phase 6 M3 -- the Personal Data form itself moved from the popup to the
// Options page (options.html), a separate WXT entrypoint with its own JS
// execution context and Pinia instance. Vault setup/unlock still happens
// through the popup first (that's a precondition regardless of which page
// shows the form), so every test here opens the popup to set up/unlock,
// then a second page for options.html to exercise the form.

import { expect, test } from './fixtures/extension';

test('entering personal data through the Options page survives a reload (real encrypted round trip)', async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const passphrase = 'correct horse battery staple';

  // Setup via the real UI -- same pattern as vaultLifecycle.test.ts.
  await popup.getByPlaceholder('Or choose a passphrase instead').fill(passphrase);
  await popup.getByRole('button', { name: 'Set up with Passphrase' }).click();
  await expect(popup.getByText('Vault unlocked.')).toBeVisible();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: 'Personal data' }).click();

  await options.getByPlaceholder('Name').fill('Ícaro');
  await options.getByPlaceholder('Email').fill('icaro@example.com');
  await options.getByPlaceholder('Phone').fill('+55 11 90000-0000');
  await options.getByRole('button', { name: 'Save' }).click();
  await expect(options.getByText('Saved.', { exact: true })).toBeVisible();

  // Reload -- forces a fresh GET_PERSONAL_DATA against real, freshly-
  // decrypted storage, not whatever the store happened to hold in memory
  // right after the save.
  await options.reload();
  await options.getByRole('button', { name: 'Personal data' }).click();
  await expect(options.getByPlaceholder('Name')).toHaveValue('Ícaro');
  await expect(options.getByPlaceholder('Email')).toHaveValue('icaro@example.com');
  await expect(options.getByPlaceholder('Phone')).toHaveValue('+55 11 90000-0000');
});

test('a malformed email does not block saving the other fields (/code-review regression guard)', async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const passphrase = 'correct horse battery staple';

  await popup.getByPlaceholder('Or choose a passphrase instead').fill(passphrase);
  await popup.getByRole('button', { name: 'Set up with Passphrase' }).click();
  await expect(popup.getByText('Vault unlocked.')).toBeVisible();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: 'Personal data' }).click();

  // The Email input is type="email" -- without the form's own `novalidate`,
  // the browser's native constraint validation would silently swallow this
  // click entirely (submitPersonalData never called), leaving Name unsaved
  // too even though it's perfectly valid. This is exactly the bug a
  // /code-review finder caught (in the popup, before the move; the same
  // markup/logic moved verbatim to this page).
  await options.getByPlaceholder('Name').fill('Ícaro');
  await options.getByPlaceholder('Email').fill('not-a-valid-email');
  await options.getByRole('button', { name: 'Save' }).click();

  await options.reload();
  await options.getByRole('button', { name: 'Personal data' }).click();
  await expect(options.getByPlaceholder('Name')).toHaveValue('Ícaro');
});

test('the Personal data tab shows a graceful error while the vault is locked', async ({
  context,
  extensionId,
}) => {
  // No vault has been set up in this fresh context, so GET_PERSONAL_DATA's
  // VAULT_LOCKED rejection (readPersonalDataBlob's own guard) is exactly
  // what this tab should surface -- not a crash, not a blank form. No
  // popup interaction needed for this one: the Options page fetches vault
  // status/personal data on its own mount, independent of the popup.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: 'Personal data' }).click();

  await expect(options.getByText('VAULT_LOCKED', { exact: true })).toBeVisible();
});
