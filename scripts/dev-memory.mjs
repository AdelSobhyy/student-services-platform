// Temporary local harness: runs all eight services with pg-mem and serves the frontend.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pgMemModule from '../services/user-service/node_modules/pg-mem/index.js';

const { newDb } = pgMemModule;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const authSecret = 'ssp-local-dev-auth-secret-change-me';
const serviceToken = 'ssp-local-dev-service-token';
const urls = {
  userServiceUrl: 'http://127.0.0.1:3001',
  accommodationServiceUrl: 'http://127.0.0.1:3002',
  transportServiceUrl: 'http://127.0.0.1:3003',
  clubServiceUrl: 'http://127.0.0.1:3004',
  diningServiceUrl: 'http://127.0.0.1:3005',
  communicationServiceUrl: 'http://127.0.0.1:3006',
  libraryServiceUrl: 'http://127.0.0.1:3007',
  paymentServiceUrl: 'http://127.0.0.1:3008',
};
const config = { authSecret, serviceToken, ...urls };

const services = [
  ['user-service', 3001],
  ['accommodation-service', 3002],
  ['transport-service', 3003],
  ['club-service', 3004],
  ['dining-service', 3005],
  ['communication-service', 3006],
  ['library-service', 3007],
  ['payment-service', 3008],
];

for (const [name, port] of services) {
  const module = await import(pathToFileURL(path.join(root, 'services', name, 'src', 'app.js')).href);
  const db = newDb();
  db.public.none(await readFile(path.join(root, 'services', name, 'db', 'init.sql'), 'utf8'));
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await module.ensureSeedData(pool);
  const app = module.createApp({ pool, config });
  await new Promise((resolve) => app.listen(port, '127.0.0.1', resolve));
  console.log(`${name} listening on ${port}`);
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
const staticServer = http.createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent((req.url || '/').split('?')[0]);
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const file = path.join(root, 'frontend', relative);
    if (!file.startsWith(path.join(root, 'frontend'))) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});
await new Promise((resolve) => staticServer.listen(8080, '127.0.0.1', resolve));
console.log('frontend listening on 8080');
