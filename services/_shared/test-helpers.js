import { readFile } from 'node:fs/promises';
import { newDb } from 'pg-mem';
import { signToken } from '../src/common.js';

export const TEST_SECRET = 'test-auth-secret';
export const TEST_SERVICE_TOKEN = 'test-service-token';

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function emptyFetch() {
  return async () => jsonResponse({ items: [] });
}

export function fakeFetch(handlers = {}) {
  return async (url, options = {}) => {
    const match = Object.keys(handlers).find((needle) => String(url).includes(needle));
    const handler = match ? handlers[match] : null;
    const result =
      typeof handler === 'function' ? handler(url, options) : handler === null ? { items: [] } : handler;
    if (result instanceof Response) return result;
    return jsonResponse(result);
  };
}

export function makeToken(overrides = {}) {
  return signToken(
    {
      id: 'usr_test_student',
      email: 'student@campus.edu',
      name: 'Test Student',
      role: 'STUDENT',
      status: 'ACTIVE',
      ...overrides,
    },
    TEST_SECRET,
  );
}

export function adminToken(overrides = {}) {
  return makeToken({
    id: 'usr_test_admin',
    email: 'admin@campus.edu',
    name: 'Test Admin',
    role: 'ADMIN',
    ...overrides,
  });
}

export async function harness({
  schemaUrl,
  createApp,
  ensureSeedData,
  config = {},
  fetchImpl = emptyFetch(),
}) {
  const db = newDb();
  const schema = await readFile(schemaUrl, 'utf8');
  db.public.none(schema);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await ensureSeedData(pool);

  const app = createApp({
    pool,
    config: {
      authSecret: TEST_SECRET,
      serviceToken: TEST_SERVICE_TOKEN,
      ...config,
    },
    fetchImpl,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    pool,
    db,
    config,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

export async function call(
  base,
  path,
  { method = 'GET', body, token, serviceToken, headers = {} } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(serviceToken ? { 'X-Service-Token': serviceToken } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  const contentType = response.headers.get('content-type') || '';
  if (text) {
    if (contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    } else {
      parsed = text;
    }
  }
  return {
    status: response.status,
    body: parsed,
    text,
    headers: response.headers,
  };
}
