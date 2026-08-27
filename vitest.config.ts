import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

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
