import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
// Permissions are kept minimal on purpose — see docs/security-model.md
// ("minimal permissions") and docs/plans/phase-1-extension-foundation.md
// (M1). Phase 1 needs local storage only; no host_permissions are
// declared, since content-script `matches` does not require one.
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    permissions: ['storage'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
