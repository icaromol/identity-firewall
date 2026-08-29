import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// Environment split (formalized here at M8, per docs/plans/
// phase-2-local-identity-vault.md -- followed implicitly since Phase 2 M2,
// never centrally documented before): `environment` is deliberately left
// unset below, relying on Vitest's own default (`node`). Every file under
// background/vault/ and background/identity/ touches real crypto.subtle
// and MUST stay on that default -- jsdom@30's own `window.crypto`
// implements only getRandomValues/randomUUID, crypto.subtle is undefined
// under jsdom (confirmed empirically, M2). Exactly one file needs jsdom
// instead -- stores/vault.store.ts's WebAuthn-mocking tests, which need a
// `navigator.credentials` global jsdom provides and node doesn't, opted in
// via that file's own `// @vitest-environment jsdom` pragma -- plus one
// pre-existing Phase 1 file, tests/unit/content/formDetection.test.ts, for
// the same DOM-availability reason. No file should ever need BOTH jsdom
// AND real crypto.subtle in the same run; if a future test seems to need
// both, that's a sign that its crypto-touching and DOM-touching concerns
// should split across two files instead, not proof this project needs
// `environmentMatchGlobs`.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    // tests/e2e/**/*.test.ts uses @playwright/test's own test/expect, not
    // Vitest's -- without this exclude, Vitest's default include glob
    // (**/*.test.ts) would try to run them too and fail. Extends Vitest's
    // own default excludes (configDefaults.exclude) rather than replacing
    // them, so node_modules/dist/etc. stay excluded too. See M6 in
    // docs/plans/phase-1-extension-foundation.md.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
