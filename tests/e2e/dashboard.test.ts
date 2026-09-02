// Phase 6 -- the Options page (entrypoints/options/), this project's first
// UI surface that isn't the popup. Unlike the popup's firewall/single-
// origin-ledger sections (firewallApproval.test.ts's own documented
// limitation), none of this page's three tabs depend on
// browser.tabs.query -- so unlike those, this page needs no graceful-
// degradation-only treatment; the tab strip and every tab's content can be
// exercised directly.
//
// GET_ALL_PRIVACY_LEDGER reads the same encrypted vault index
// GET_PERSONAL_DATA does, so on a fresh, uninitialized vault (no setup has
// happened in this context) the ledger tab correctly shows the same
// VAULT_LOCKED error Personal Data shows, not the "no sites yet"
// empty-list message -- that message only appears once the vault is
// unlocked and genuinely has no recorded disclosures.

import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures/extension';

test('the Options page opens with the tab strip and defaults to "Who knows what about me"', async ({
  context,
  extensionId,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(
    options.getByRole('heading', { name: 'Identity Firewall — Dashboard' }),
  ).toBeVisible();
  await expect(options.getByText('VAULT_LOCKED', { exact: true })).toBeVisible();
});

test('switching tabs shows the content for each panel', async ({ context, extensionId }) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);

  // No vault yet in this fresh context -- the Backup & Recovery tab's
  // uninitialized-state messaging is exactly what should show.
  await options.getByRole('button', { name: 'Backup & recovery' }).click();
  await expect(
    options.getByText(
      'No vault yet. Open the extension icon to set one up, or restore one from a backup below.',
    ),
  ).toBeVisible();

  await options.getByRole('button', { name: 'Personal data' }).click();
  await expect(options.getByText('VAULT_LOCKED', { exact: true })).toBeVisible();

  await options.getByRole('button', { name: 'Who knows what about me' }).click();
  await expect(options.getByText('VAULT_LOCKED', { exact: true })).toBeVisible();
});

test('an unlocked vault with no recorded disclosures shows the ledger tab’s empty state', async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup
    .getByPlaceholder('Or choose a passphrase instead')
    .fill('correct horse battery staple');
  await popup.getByRole('button', { name: 'Set up with Passphrase' }).click();
  await expect(popup.getByRole('button', { name: 'Lock vault' })).toBeVisible();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(
    options.getByText('No sites have any recorded disclosures or denials yet.'),
  ).toBeVisible();
});

test('the Backup & Recovery tab exports a real backup file once unlocked', async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup
    .getByPlaceholder('Or choose a passphrase instead')
    .fill('correct horse battery staple');
  await popup.getByRole('button', { name: 'Set up with Passphrase' }).click();
  await expect(popup.getByRole('button', { name: 'Lock vault' })).toBeVisible();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: 'Backup & recovery' }).click();

  await options.getByPlaceholder('Choose a backup passphrase').fill('another passphrase entirely');
  const [download] = await Promise.all([
    options.waitForEvent('download'),
    options.getByRole('button', { name: 'Download backup' }).click(),
  ]);

  // Proves the moved UI actually drives vault.store.ts's real
  // exportBackup() -> a genuine EXPORT_VAULT_BACKUP round trip and file
  // download, not just that the button renders. The crypto/schema
  // correctness of the bundle itself is already covered by Phase 2 M7's
  // own unit/e2e tests, unchanged by this move -- this test's job is only
  // to confirm the relocated form still works end to end from its new home.
  const path = await download.path();
  expect(path).toBeTruthy();
  const content = await readFile(path as string, 'utf-8');
  const bundle = JSON.parse(content);
  expect(bundle).toMatchObject({ formatVersion: 1, kdf: 'argon2id' });
  expect(bundle.ciphertextB64).toBeTruthy();

  // Before the UI-quality pass, a successful export gave literally no
  // on-screen confirmation beyond the file landing in the Downloads
  // folder -- components/ui/UiToastHost.vue's toast is the first feedback
  // this action has ever had.
  await expect(options.getByRole('status').filter({ hasText: 'Backup downloaded.' })).toBeVisible();
});
