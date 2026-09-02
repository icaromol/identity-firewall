import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
// Permissions are kept minimal on purpose — see docs/security-model.md
// ("minimal permissions") and docs/plans/phase-1-extension-foundation.md
// (M1). Phase 1 needed local storage only; no host_permissions are
// declared, since content-script `matches` does not require one.
//
// 'activeTab' added for Phase 3 M4 -- the approval UI needs to know which
// site the popup is open for (browser.tabs.query({active, currentWindow})),
// and without ANY tab-related permission, Chrome strips `url`/`title` from
// the returned Tab object entirely. 'activeTab' is the deliberately minimal
// choice here over the broader 'tabs' permission: it grants access to only
// the one tab the user is looking at, only for the session after they
// invoke the extension (e.g. by opening this very popup) -- not standing
// visibility into every open tab's URL the way 'tabs' would be, and it
// doesn't trigger Chrome's "read your browsing history" permission warning.
// Known, accepted limitation: Playwright can't simulate the real toolbar
// click that grants activeTab (same limitation Phase 1's M6 already
// documented for clicking the action icon at all), so the full
// detect -> approve -> autofill loop needs manual verification in a real
// browser (docs/plans/phase-3-identity-firewall.md's M6) rather than an
// e2e test asserting on it end-to-end.
//
// 'idle' added for Phase 7 Part A -- background/settings/idleLock.ts's
// auto-lock mechanism (docs/plans/autolock-and-configuration.md).
// Doesn't trigger a Chrome permission warning at all.
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    permissions: ['storage', 'activeTab', 'idle'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
