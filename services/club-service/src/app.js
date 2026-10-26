import express from 'express';

export function createApp({ pool, service, resource, peers = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ service, status: 'alive' }));
  app.get('/ready', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ service, status: 'ready' }); }
    catch { res.status(503).json({ service, status: 'unavailable' }); }
  });
  app.get('/', (_req, res) => res.json({ service, stage: 'development-foundation', resource: `/api/${resource}` }));
  // Resource is a fixed application constant, never taken from the request.
  if (!/^[a-z_]+$/.test(resource)) throw new Error('Invalid resource');
  app.get(`/api/${resource}`, async (_req, res) => {
    try {
      const { rows } = await pool.query(`SELECT id, name, created_at FROM ${resource} ORDER BY id LIMIT 100`);
      res.json({ service, sampleData: true, items: rows });
    } catch { res.status(503).json({ error: 'Database unavailable' }); }
  });
  app.get('/dependencies', async (_req, res) => {
    const checks = await Promise.all(Object.entries(peers).map(async ([name, url]) => {
      try {
        const response = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(3000) });
        return [name, response.ok];
      } catch { return [name, false]; }
    }));
    const ready = checks.every(([, ok]) => ok);
    res.status(ready ? 200 : 503).json({ service, dependencies: Object.fromEntries(checks) });
  });
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}
