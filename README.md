# Identity Firewall

A local-first, open-source, privacy-first browser extension that lets you use a distinct
identity, credential, and/or alias per website instead of reusing one identity
(Google/Apple/Microsoft login, or one email/password) everywhere — and puts you in
explicit control of exactly what data each site receives.

This is a personal project, not a company or startup. No cloud backend, no account with
"us" required, no funding sought.

> Your identity is yours. Every disclosure is an explicit authorization.

## Status

Phase 1 (extension foundation) in progress — see
[`docs/plans/phase-1-extension-foundation.md`](docs/plans/phase-1-extension-foundation.md)
for milestone-by-milestone status. The full architecture, threat model, data model, and
phased roadmap live under [`docs/`](docs/). Start with
[`docs/product-vision.md`](docs/product-vision.md) for the *why*, and
[`docs/roadmap.md`](docs/roadmap.md) for the *what's next*.

If you're working on this with Claude Code, [`CLAUDE.md`](CLAUDE.md) has standing
instructions and a full index of the docs.

## Development

The extension is a [WXT](https://wxt.dev) + Vue 3 + TypeScript project, pinned to `wxt@0.21.4`. See [`docs/plans/phase-1-extension-foundation.md`](docs/plans/phase-1-extension-foundation.md) for the current implementation plan.

```bash
pnpm install
pnpm dev            # Chrome, with hot reload
pnpm dev:firefox    # Firefox, with hot reload
pnpm build          # production build -> .output/
pnpm compile        # type-check only (vue-tsc)
pnpm check          # lint + compile + unit tests -- what Husky's pre-commit hook runs
```

Load the built extension unpacked: `chrome://extensions` → enable Developer mode → "Load unpacked" → select `.output/chrome-mv3` (or `.output/chrome-mv3-dev` when running via `pnpm dev`). For Firefox: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" → select `manifest.json` inside `.output/firefox-mv2`.

### Testing

Unit tests (Vitest, mocking the browser API via `fakeBrowser`) run as part of `pnpm check`.
End-to-end tests (Playwright, driving the real built extension in an actual Chromium
instance) are separate — they're slower and need a browser binary not guaranteed present
on every machine, so they're not part of the pre-commit hook:

```bash
pnpm exec playwright install chromium   # one-time setup
pnpm test:e2e                           # builds the extension, then runs tests/e2e/
```

For clicking through the extension by hand against real-shaped forms (signup, login,
required/optional field mixes, Safe Mode, and the two documented dynamic-rendering
limitations), see [`tests/manual/README.md`](tests/manual/README.md).

Recommended IDE setup: [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar).

## License

[AGPL-3.0](LICENSE) — chosen so that any hosted fork or derivative of this privacy tool
stays open, in the same spirit as other privacy-focused projects (e.g. Bitwarden).
