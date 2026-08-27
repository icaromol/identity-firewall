// Phase 1 scaffold placeholder. The real message router
// (installMessageRouter, per docs/research/phase-1-runtime-architecture.md
// §1) lands in M3.
export default defineBackground(() => {
  console.log('Identity Firewall background started', { id: browser.runtime.id });
});
