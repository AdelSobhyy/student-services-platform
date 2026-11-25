import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { newDb } from 'pg-mem';
import { createApp, ensureSeedData } from '../src/app.js';

const schema = await readFile(new URL('../db/init.sql', import.meta.url), 'utf8');

const offlineFetch = async () =>
  new Response(JSON.stringify({ items: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

async function harness(fetchImpl = offlineFetch) {
  const db = newDb();
  db.public.none(schema);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await ensureSeedData(pool);
  const config = {
    authSecret: 'test-secret',
    serviceToken: 'test-service-token',
    accommodationServiceUrl: 'http://accommodation',
    transportServiceUrl: 'http://transport',
    clubServiceUrl: 'http://club',
    diningServiceUrl: 'http://dining',
    libraryServiceUrl: 'http://library',
    paymentServiceUrl: 'http://payment',
    communicationServiceUrl: 'http://communication',
  };
  const app = createApp({ pool, config, fetchImpl });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    pool,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

async function call(base, path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('TC1.1 TC1.2 TC1.3 registers, logs in and rejects duplicate email', async () => {
  const app = await harness();
  try {
    const created = await call(app.base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'New Student', email: 'new@student.edu', password: 'Password123!' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'STUDENT');
    assert.ok(created.body.token);

    const duplicate = await call(app.base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'New Student', email: 'new@student.edu', password: 'Password123!' },
    });
    assert.equal(duplicate.status, 409);

    const login = await call(app.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'new@student.edu', password: 'Password123!' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, 'new@student.edu');
  } finally {
    await app.close();
  }
});

test('TC1.4 TC1.10 rejects bad credentials and suspended accounts', async () => {
  const app = await harness();
  try {
    const bad = await call(app.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'student@campus.edu', password: 'wrong-password' },
    });
    assert.equal(bad.status, 401);

    const admin = await call(app.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@campus.edu', password: 'Admin123!' },
    });
    const users = await call(app.base, '/api/admin/users', { token: admin.body.token });
    const student = users.body.items.find((item) => item.email === 'student@campus.edu');
    const suspended = await call(app.base, `/api/admin/users/${student.id}/status`, {
      method: 'PATCH',
      token: admin.body.token,
      body: { status: 'SUSPENDED' },
    });
    assert.equal(suspended.status, 200);

    const blocked = await call(app.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'student@campus.edu', password: 'Student123!' },
    });
    assert.equal(blocked.status, 403);
  } finally {
    await app.close();
  }
});

test('TC1.5 TC1.6 TC1.7 updates profile and recovers password', async () => {
  const app = await harness();
  try {
    const login = await call(app.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'student@campus.edu', password: 'Student123!' },
    });
    const token = login.body.token;
    const updated = await call(app.base, '/api/users/me', {
      method: 'PATCH',
      token,
      body: { name: 'Updated Student' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.name, 'Updated Student');

    const recovery = await call(app.base, '/api/auth/recover', {
      method: 'POST',
      body: { email: 'student@campus.edu' },
    });
    assert.equal(recovery.status, 200);
    assert.ok(recovery.body.resetToken);

    const reset = await call(app.base, '/api/auth/reset', {
      method: 'POST',
      body: { token: recovery.body.resetToken, password: 'NewPassword123!' },
    });
    assert.equal(reset.status, 200);

    const relogin = await call(app.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'student@campus.edu', password: 'NewPassword123!' },
    });
    assert.equal(relogin.status, 200);
  } finally {
    await app.close();
  }
});

test('TC1.8 aggregates activity from peer services', async () => {
  const fetchImpl = async (url) => {
    const body = url.includes('accommodation')
      ? { items: [{ type: 'BOOKING', id: 'b1', title: 'Room', status: 'CONFIRMED', date: '2026-01-02' }] }
      : { items: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const app = await harness(fetchImpl);
  try {
    const login = await call(app.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'student@campus.edu', password: 'Student123!' },
    });
    const activity = await call(app.base, '/api/users/me/activity', {
      token: login.body.token,
    });
    assert.equal(activity.status, 200);
    assert.equal(activity.body.items.length, 1);
    assert.equal(activity.body.items[0].source, 'accommodation');
  } finally {
    await app.close();
  }
});

test('TC1.9 admin assigns roles and creates staff accounts', async () => {
  const app = await harness();
  try {
    const admin = await call(app.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@campus.edu', password: 'Admin123!' },
    });
    const token = admin.body.token;
    const created = await call(app.base, '/api/admin/users', {
      method: 'POST',
      token,
      body: {
        name: 'New Leader',
        email: 'leader2@campus.edu',
        password: 'Leader123!',
        role: 'CLUB_LEADER',
        clubId: 'C-1',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'CLUB_LEADER');
    assert.equal(created.body.user.clubId, 'C-1');

    const promoted = await call(app.base, `/api/admin/users/${created.body.user.id}/role`, {
      method: 'PATCH',
      token,
      body: { role: 'STAFF' },
    });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.user.role, 'STAFF');
  } finally {
    await app.close();
  }
});
