import pg from 'pg';
import { createApp, ensureSeedData } from './app.js';
import { serviceConfig } from './common.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const config = serviceConfig();
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('Invalid PORT');
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
});
pool.on('error', () => console.error('Unexpected database connection error'));

await ensureSeedData(pool);
const server = createApp({ pool, config }).listen(config.port, '0.0.0.0', () =>
  console.log(`club-service listening on ${config.port}`),
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(timeout);
      process.exit(0);
    });
  });
}
