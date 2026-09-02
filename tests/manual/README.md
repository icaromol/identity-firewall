# Manual test pages

A small set of static HTML pages for exercising the extension by hand in a real browser —
distinct from `tests/e2e/` (Playwright, automated, headless-but-real Chromium) and
`tests/unit/` (Vitest, mocked `browser.*`). Nothing here runs as part of `pnpm check` or
`pnpm test:e2e`; these are for a human clicking through the extension.

Each page is served on its own fixed `127.0.0.1` port so the extension treats every one as a
genuinely distinct origin/site — the same different-port-same-host trick
[`tests/e2e/fixtures/server.ts`](../e2e/fixtures/server.ts) uses for its own fixture, just
with fixed (not OS-assigned) ports so the URLs are stable to bookmark across repeated runs.

## Usage

```bash
pnpm build   # or `pnpm dev` if you want hot-reload while testing
node tests/manual/serve.mjs
```

Then, with the built extension loaded unpacked (`chrome://extensions` → Developer mode →
Load unpacked → `.output/chrome-mv3`), open **http://127.0.0.1:5300/** — an index page
linking to everything below.

## Pages

| Port | Page | What it exercises |
|---:|---|---|
| 5300 | `index.html` | Links to every page below. |
| 5301 | `signup.html` | All six `PersonalData` field types, a required/optional mix, and `autocomplete="new-password"` — should classify as a **signup** form. Submitting should trigger both the Identity Firewall approval flow and the "Save this login?" credential-capture prompt. |
| 5302 | `login.html` | `autocomplete="current-password"` — should classify as a **login**, not a signup. Use this to test capturing an existing login on submit, and the "Saved logins" Fill action once a credential has been saved here. |
| 5303 | `optional-fields.html` | No password field at all — pure `PersonalData` disclosure. Only email is required. Tests the per-field approval matrix (Real/Alias/Synthetic/Nonsense/Deny), the "Deny optional" button, and the Policy Engine's automatic apply once policies exist. |
| 5304 | `sensitive-site.html` | A "bank"-shaped form including `nationalId` (always-ask, highly sensitive — see `docs/data-model.md`). Use this to test the "Safe mode" toggle overriding any stored policy. |
| 5305 | `dynamic-signup.html` | **Known limitation** (Phase 9 territory, see `CLAUDE.md`): the form is injected via JS 1.5s after page load, simulating a real SPA. The content script's one-shot `document_idle` scan runs before this form exists, so it is never detected at all. |
| 5306 | `wizard.html` | **Known limitation** (Phase 9 territory): both wizard steps live in one `<form>` from page load, step 2 merely hidden with `display:none`. The one-shot structural scan sees step 2's fields too, so autofill can silently write into a field the user hasn't seen yet. |

## Adding a new page

Add the HTML file here, then add one entry to the `PAGES` array in
[`serve.mjs`](serve.mjs) (port, filename, one-line label) and a row to the table above.
