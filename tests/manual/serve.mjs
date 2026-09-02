// Serves each manual-test page on its own fixed localhost port, so the
// extension treats every one as a distinct origin/site -- the same
// different-port-same-host trick tests/e2e/fixtures/server.ts uses, just
// with fixed ports (not OS-assigned) so the URLs are stable to bookmark
// across repeated manual test runs. Content scripts only inject into
// http(s) pages (wxt.config.ts's manifest `matches`), never file://, so
// these pages must be served, not opened directly from disk.
//
// Run with: node tests/manual/serve.mjs
// Then open http://127.0.0.1:5300/ for the index of links.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const DIR = import.meta.dirname;

const PAGES = [
  { port: 5300, file: 'index.html', label: 'Index -- links to everything below' },
  {
    port: 5301,
    file: 'signup.html',
    label: 'Signup form -- all 6 PersonalData fields, new-password',
  },
  { port: 5302, file: 'login.html', label: 'Login form -- identifier + current-password' },
  {
    port: 5303,
    file: 'optional-fields.html',
    label: 'Personal-data disclosure -- required/optional mix, no password',
  },
  { port: 5304, file: 'sensitive-site.html', label: '"Bank" site -- nationalId + Safe Mode' },
  {
    port: 5305,
    file: 'dynamic-signup.html',
    label: 'Dynamic SPA form -- KNOWN LIMITATION, never detected',
  },
  {
    port: 5306,
    file: 'wizard.html',
    label: 'Multi-step wizard -- KNOWN LIMITATION, hidden step fillable',
  },
];

for (const page of PAGES) {
  const html = await readFile(path.join(DIR, page.file), 'utf-8');

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.on('error', (err) => {
    console.error(`Failed to start ${page.file} on port ${page.port}: ${err.message}`);
  });

  server.listen(page.port, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${page.port}/  --  ${page.label}`);
  });
}

console.log('\nAll test pages are running. Open http://127.0.0.1:5300/ to start. Ctrl+C to stop.');
