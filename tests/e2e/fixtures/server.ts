// A minimal static HTTP server for the e2e fixture page -- deliberately
// just Node's built-in http/fs, no new dependency, matching this
// project's general preference for fewer dependencies (see
// docs/security-model.md). Two distinct origins are produced by starting
// two independent instances on two dynamically-allocated ports (port 0 --
// the OS picks a free one, avoiding flakiness from a hardcoded port
// colliding with something else on the machine); shared/origin.ts's own
// normalizeOrigin already treats different ports on the same host as
// different origins (see tests/unit/shared/origin.test.ts), so a second
// hostname is unnecessary.

import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

// import.meta.dirname (Node 20.11+/24), not __dirname -- package.json's
// "type": "module" makes every .ts/.js file here ESM, which has no
// __dirname global.
const FIXTURE_PATH = path.join(import.meta.dirname, 'login-form.html');

export interface FixtureServer {
  origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const html = await readFile(FIXTURE_PATH, 'utf-8');

  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Fixture server failed to bind to a port');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // server.close() alone only stops accepting NEW connections and
        // waits for existing ones to end on their own -- an idle
        // keep-alive connection from the browser (which never navigates
        // away from this origin before we close it) would otherwise hang
        // this forever. closeAllConnections() (Node 18.2+) forcibly ends
        // any still-open sockets so the callback below actually fires.
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
