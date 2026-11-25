import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp, ensureSeedData } from '../src/app.js';
import { adminToken, call, harness, makeToken, TEST_SERVICE_TOKEN } from './helpers.js';

const schemaUrl = new URL('../db/init.sql', import.meta.url);
const config = {
  userServiceUrl: 'http://user-service',
  communicationServiceUrl: 'http://communication-service',
};

function setup() {
  return harness({ schemaUrl, createApp, ensureSeedData, config });
}

test('TC7.1 searches and filters the library catalogue', async () => {
  const app = await setup();
  try {
    const resources = await call(app.base, '/api/resources');
    assert.equal(resources.status, 200);
    assert.ok(resources.body.items.length >= 4);

    const searched = await call(app.base, '/api/resources?q=algorithms');
    assert.ok(searched.body.items.some((item) => /algorithms/i.test(item.title)));

    const digital = await call(app.base, '/api/resources?type=DIGITAL');
    assert.ok(digital.body.items.length > 0);
    assert.ok(digital.body.items.every((item) => item.type === 'DIGITAL'));

    const subject = await call(app.base, '/api/resources?subject=Computer Science');
    assert.ok(subject.body.items.every((item) => item.subject === 'Computer Science'));

    const invalid = await call(app.base, '/api/resources?type=VIDEO');
    assert.equal(invalid.status, 400);

    const first = resources.body.items[0];
    const detail = await call(app.base, `/api/resources/${first.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.resource.id, first.id);
  } finally {
    await app.close();
  }
});

test('TC7.3 logs digital downloads', async () => {
  const app = await setup();
  try {
    const resources = await call(app.base, '/api/resources?type=DIGITAL');
    const resource = resources.body.items[0];

    const access = await call(app.base, `/api/resources/${resource.id}/access`, {
      method: 'POST',
      token: makeToken(),
    });
    assert.equal(access.status, 201);
    assert.equal(access.body.accessType, 'DIGITAL');
    assert.ok(access.body.download.id);

    const activity = await call(app.base, '/api/internal/activity?studentId=usr_test_student', {
      serviceToken: TEST_SERVICE_TOKEN,
    });
    assert.ok(activity.body.items.some((item) => item.type === 'LIBRARY_DOWNLOAD'));
  } finally {
    await app.close();
  }
});

test('TC7.2 reserves, collects, cancels and returns printed resources', async () => {
  const app = await setup();
  const token = makeToken();
  try {
    const created = await call(app.base, '/api/admin/resources', {
      method: 'POST',
      token: adminToken(),
      body: {
        title: 'Single Copy Book',
        author: 'Test Author',
        type: 'PRINTED_BOOK',
        subject: 'Testing',
        copiesTotal: 1,
      },
    });
    assert.equal(created.status, 201);
    const resource = created.body.resource;

    const access = await call(app.base, `/api/resources/${resource.id}/access`, {
      method: 'POST',
      token,
    });
    assert.equal(access.status, 201);
    assert.equal(access.body.accessType, 'PRINTED_BOOK');
    assert.equal(access.body.reservation.status, 'RESERVED');
    assert.equal(access.body.resource.copiesAvailable, 0);

    const unavailable = await call(app.base, `/api/resources/${resource.id}/access`, {
      method: 'POST',
      token: makeToken({ id: 'usr_other_student' }),
    });
    assert.equal(unavailable.status, 409);

    const reservations = await call(app.base, '/api/reservations', { token });
    assert.ok(
      reservations.body.items.some((item) => item.id === access.body.reservation.id),
    );

    const otherUser = await call(
      app.base,
      `/api/reservations/${access.body.reservation.id}/collect`,
      {
        method: 'POST',
        token: makeToken({ id: 'usr_other_student' }),
      },
    );
    assert.equal(otherUser.status, 403);

    const collected = await call(
      app.base,
      `/api/reservations/${access.body.reservation.id}/collect`,
      { method: 'POST', token },
    );
    assert.equal(collected.status, 200);
    assert.equal(collected.body.reservation.status, 'COLLECTED');

    const returned = await call(
      app.base,
      `/api/reservations/${access.body.reservation.id}/return`,
      { method: 'POST', token },
    );
    assert.equal(returned.status, 200);
    assert.equal(returned.body.reservation.status, 'RETURNED');
    assert.equal(returned.body.resource.copiesAvailable, 1);

    const second = await call(app.base, '/api/admin/resources', {
      method: 'POST',
      token: adminToken(),
      body: { title: 'Cancel Copy', type: 'PRINTED_BOOK', copiesTotal: 1 },
    });
    const reserved = await call(app.base, `/api/resources/${second.body.resource.id}/access`, {
      method: 'POST',
      token,
    });
    const cancelled = await call(
      app.base,
      `/api/reservations/${reserved.body.reservation.id}/cancel`,
      { method: 'POST', token },
    );
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.reservation.status, 'CANCELLED');
    assert.equal(cancelled.body.resource.copiesAvailable, 1);
  } finally {
    await app.close();
  }
});

test('TC7.4 admin manages the catalogue while students are denied', async () => {
  const app = await setup();
  try {
    const denied = await call(app.base, '/api/admin/resources', {
      method: 'POST',
      token: makeToken(),
      body: { title: 'Nope', type: 'DIGITAL' },
    });
    assert.equal(denied.status, 403);

    const created = await call(app.base, '/api/admin/resources', {
      method: 'POST',
      token: adminToken(),
      body: { title: 'Managed Resource', type: 'DIGITAL', url: 'https://example.test/book' },
    });
    assert.equal(created.status, 201);

    const patched = await call(app.base, `/api/admin/resources/${created.body.resource.id}`, {
      method: 'PATCH',
      token: adminToken(),
      body: { title: 'Renamed Resource', copiesTotal: 3 },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.resource.title, 'Renamed Resource');
    assert.equal(patched.body.resource.copiesTotal, 3);

    const deleted = await call(app.base, `/api/admin/resources/${created.body.resource.id}`, {
      method: 'DELETE',
      token: adminToken(),
    });
    assert.equal(deleted.status, 200);

    const missing = await call(app.base, `/api/admin/resources/${created.body.resource.id}`, {
      method: 'DELETE',
      token: adminToken(),
    });
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test('internal activity and stats require the service token', async () => {
  const app = await setup();
  try {
    const denied = await call(app.base, '/api/internal/stats');
    assert.equal(denied.status, 403);

    const stats = await call(app.base, '/api/internal/stats', {
      serviceToken: TEST_SERVICE_TOKEN,
    });
    assert.equal(stats.status, 200);
    assert.equal(typeof stats.body.resources, 'number');
    assert.equal(typeof stats.body.downloads, 'number');
  } finally {
    await app.close();
  }
});
