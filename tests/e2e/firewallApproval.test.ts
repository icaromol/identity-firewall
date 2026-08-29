// Phase 3 M6 / Phase 4 M5 -- the "Pending request" and "What this site
// knows about you" sections' error paths.
//
// The full detect -> classify -> approve -> autofill loop CANNOT be
// exercised end-to-end here: both stores/firewall.store.ts and
// stores/privacyLedger.store.ts resolve the active tab via
// browser.tabs.query({active:true, currentWindow:true}), and without a
// real user-invoked click on the extension's toolbar icon, Chrome's
// 'activeTab' permission (see wxt.config.ts's own comment on why that
// permission, not the broader 'tabs') never activates -- the returned Tab
// object has `url`/`title` stripped entirely. Playwright has no way to
// simulate that click at all (the same limitation Phase 1's M6 already
// hit for the action icon in general). This is therefore a
// manual-verification requirement (docs/plans/phase-3-identity-firewall.md's
// M6), not something this suite asserts end-to-end.
//
// What CAN be verified here, and is worth a real regression test: that
// this permission gap fails gracefully in BOTH sections -- a clear error
// message, not a crash or a silently blank section -- since that's
// exactly the state Playwright itself is permanently stuck in,
// e2e-testing it for real.

import { expect, test } from './fixtures/extension';

test('the Pending request and privacy-ledger sections both show a graceful error when the active tab cannot be resolved', async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(
    popup.getByText('Could not load pending request: Could not determine the active tab', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    popup.getByText('Could not determine the active tab', { exact: true }),
  ).toBeVisible();
});
