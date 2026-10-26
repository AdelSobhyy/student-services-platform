import pg from 'pg';
import { createApp } from './app.js';
import { service, resource } from './config.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000 });
pool.on('error', () => console.error('Unexpected database connection error'));
const peers = process.env.USER_SERVICE_URL ? { 'user-service': process.env.USER_SERVICE_URL } : {};
const server = createApp({ pool, service, resource, peers }).listen(port, '0.0.0.0', () => console.log(`${service} listening on ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(async () => { await pool.end(); clearTimeout(timeout); process.exit(0); });
  });
}
