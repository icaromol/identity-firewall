// Phase 5 M1 -- the Personal Data screen. Unlike firewallApproval.test.ts's
// sections, stores/personalData.store.ts never calls browser.tabs.query --
// PersonalData is one single vault-wide blob, not scoped per active tab --
// so this one CAN be exercised fully end-to-end here, not just for its
// graceful-degradation path.

import { expect, test } from './fixtures/extension';

test('entering personal data through the popup survives a reload (real encrypted round trip)', async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const passphrase = 'correct horse battery staple';

  // Setup via the real UI -- same pattern as vaultLifecycle.test.ts. No
  // reload needed here (a Phase 5 M7 manual-verification finding, fixed
  // in App.vue): every vault-scoped section, personalData.store.ts
  // included, now refetches right after a successful setup/unlock,
  // instead of staying stuck on its stale pre-unlock VAULT_LOCKED state
  // until the popup was closed and reopened.
  await popup.getByPlaceholder('Or choose a passphrase instead').fill(passphrase);
  await popup.getByRole('button', { name: 'Set up with Passphrase' }).click();
  await expect(popup.getByText('Vault unlocked.')).toBeVisible();

  await popup.getByPlaceholder('Name').fill('Ícaro');
  await popup.getByPlaceholder('Email').fill('icaro@example.com');
  await popup.getByPlaceholder('Phone').fill('+55 11 90000-0000');
  await popup.getByRole('button', { name: 'Save' }).click();
  await expect(popup.getByText('Saved.', { exact: true })).toBeVisible();

  // Reload -- forces a fresh GET_PERSONAL_DATA against real, freshly-
  // decrypted storage, not whatever the store happened to hold in memory
  // right after the save.
  await popup.reload();
  await expect(popup.getByPlaceholder('Name')).toHaveValue('Ícaro');
  await expect(popup.getByPlaceholder('Email')).toHaveValue('icaro@example.com');
  await expect(popup.getByPlaceholder('Phone')).toHaveValue('+55 11 90000-0000');
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

  // The Email input is type="email" -- without the form's own `novalidate`,
  // the browser's native constraint validation would silently swallow this
  // click entirely (submitPersonalData never called), leaving Name unsaved
  // too even though it's perfectly valid. This is exactly the bug a
  // /code-review finder caught.
  await popup.getByPlaceholder('Name').fill('Ícaro');
  await popup.getByPlaceholder('Email').fill('not-a-valid-email');
  await popup.getByRole('button', { name: 'Save' }).click();

  await popup.reload();
  await expect(popup.getByPlaceholder('Name')).toHaveValue('Ícaro');
});

test('the Personal data section shows a graceful error while the vault is locked', async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // No vault has been set up in this fresh context, so GET_PERSONAL_DATA's
  // VAULT_LOCKED rejection (readPersonalDataBlob's own guard) is exactly
  // what this section should surface -- not a crash, not a blank form.
  await expect(popup.getByText('VAULT_LOCKED', { exact: true })).toBeVisible();
});
