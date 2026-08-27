// Phase 1 scaffold placeholder. ISOLATED world only — permanently, see
// docs/plans/phase-1-extension-foundation.md ("Resolved conflict") and
// ADR-011. Real structural form detection lands in M4.
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    console.log('Identity Firewall content script loaded');
  },
});
