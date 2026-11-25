import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp, ensureSeedData } from '../src/app.js';
import { adminToken, call, fakeFetch, harness, makeToken, TEST_SERVICE_TOKEN } from './helpers.js';

const schemaUrl = new URL('../db/init.sql', import.meta.url);
const config = {
  userServiceUrl: 'http://user-service',
  paymentServiceUrl: 'http://payment-service',
  communicationServiceUrl: 'http://communication-service',
};

function setup() {
  return harness({
    schemaUrl,
    createApp,
    ensureSeedData,
    config,
    fetchImpl: fakeFetch({
      'internal/charges': { payment: { id: 'pay_test_transport' } },
      'internal/refunds': { refund: { id: 'ref_test_transport' } },
      'internal/notifications': { notification: { id: 'ntf_test' } },
    }),
  });
}

test('browses routes and schedules', async () => {
  const app = await setup();
  try {
    const routes = await call(app.base, '/api/routes');
    assert.equal(routes.status, 200);
    assert.ok(routes.body.items.length >= 3);

    const search = await call(app.base, '/api/routes?q=airport');
    assert.equal(search.status, 200);
    assert.ok(search.body.items.every((route) => /airport/i.test(route.name)));

    const route = routes.body.items[0];
    const details = await call(app.base, `/api/routes/${route.id}`);
    assert.equal(details.status, 200);
    assert.ok(details.body.schedules.length > 0);

    const schedules = await call(app.base, `/api/schedules?routeId=${route.id}`);
    assert.equal(schedules.status, 200);
    assert.ok(schedules.body.items.length > 0);
    assert.equal(schedules.body.items[0].routeId, route.id);
  } finally {
    await app.close();
  }
});

test('books a seat, prevents duplicates and cancels with a refund', async () => {
  const app = await setup();
  const token = makeToken();
  try {
    const booking = await call(app.base, '/api/bookings', {
      method: 'POST',
      token,
      body: { scheduleId: 'sch_campus_1200' },
    });
    assert.equal(booking.status, 201);
    assert.equal(booking.body.booking.status, 'CONFIRMED');
    assert.equal(booking.body.booking.paymentId, 'pay_test_transport');
    assert.equal(booking.body.booking.seatNumber, 1);

    const duplicate = await call(app.base, '/api/bookings', {
      method: 'POST',
      token,
      body: { scheduleId: 'sch_campus_1200' },
    });
    assert.equal(duplicate.status, 409);

    const unknown = await call(app.base, '/api/bookings', {
      method: 'POST',
      token,
      body: { scheduleId: 'sch_missing' },
    });
    assert.equal(unknown.status, 404);

    const mine = await call(app.base, '/api/bookings', { token });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.items.some((item) => item.id === booking.body.booking.id));

    const cancelled = await call(app.base, `/api/bookings/${booking.body.booking.id}/cancel`, {
      method: 'POST',
      token,
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.booking.status, 'CANCELLED');

    const otherUser = makeToken({ id: 'usr_other_student' });
    const denied = await call(app.base, `/api/bookings/${booking.body.booking.id}/cancel`, {
      method: 'POST',
      token: otherUser,
    });
    assert.equal(denied.status, 403);

    const schedules = await call(app.base, '/api/schedules?routeId=rte_campus_express');
    const schedule = schedules.body.items.find((item) => item.id === 'sch_campus_1200');
    assert.equal(schedule.seatsAvailable, 40);
  } finally {
    await app.close();
  }
});

test('enforces schedule capacity', async () => {
  const app = await setup();
  try {
    const route = await call(app.base, '/api/admin/routes', {
      method: 'POST',
      token: adminToken(),
      body: { name: 'Capacity Test', origin: 'A', destination: 'B', fare: 5 },
    });
    assert.equal(route.status, 201);

    const schedule = await call(app.base, '/api/admin/schedules', {
      method: 'POST',
      token: adminToken(),
      body: {
        routeId: route.body.route.id,
        departureAt: '2028-05-01T08:00:00.000Z',
        capacity: 1,
      },
    });
    assert.equal(schedule.status, 201);

    const first = await call(app.base, '/api/bookings', {
      method: 'POST',
      token: makeToken({ id: 'usr_capacity_one' }),
      body: { scheduleId: schedule.body.schedule.id },
    });
    assert.equal(first.status, 201);

    const second = await call(app.base, '/api/bookings', {
      method: 'POST',
      token: makeToken({ id: 'usr_capacity_two' }),
      body: { scheduleId: schedule.body.schedule.id },
    });
    assert.equal(second.status, 409);
  } finally {
    await app.close();
  }
});

test('admin manages routes and schedules while students are denied', async () => {
  const app = await setup();
  try {
    const denied = await call(app.base, '/api/admin/routes', {
      method: 'POST',
      token: makeToken(),
      body: { name: 'No Access' },
    });
    assert.equal(denied.status, 403);

    const token = adminToken();
    const route = await call(app.base, '/api/admin/routes', {
      method: 'POST',
      token,
      body: { name: 'Library Loop', fare: 1.5, status: 'ACTIVE' },
    });
    assert.equal(route.status, 201);

    const updatedRoute = await call(app.base, `/api/admin/routes/${route.body.route.id}`, {
      method: 'PATCH',
      token,
      body: { destination: 'Library' },
    });
    assert.equal(updatedRoute.body.route.destination, 'Library');

    const schedule = await call(app.base, '/api/admin/schedules', {
      method: 'POST',
      token,
      body: {
        routeId: route.body.route.id,
        departureAt: '2028-06-01T10:00:00.000Z',
        capacity: 10,
      },
    });
    assert.equal(schedule.status, 201);

    const patched = await call(app.base, `/api/admin/schedules/${schedule.body.schedule.id}`, {
      method: 'PATCH',
      token,
      body: { vehicle: 'Minibus', capacity: 12 },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.schedule.vehicle, 'Minibus');
    assert.equal(patched.body.schedule.seatsAvailable, 12);

    const deletedSchedule = await call(
      app.base,
      `/api/admin/schedules/${schedule.body.schedule.id}`,
      { method: 'DELETE', token },
    );
    assert.equal(deletedSchedule.status, 200);

    const deletedRoute = await call(app.base, `/api/admin/routes/${route.body.route.id}`, {
      method: 'DELETE',
      token,
    });
    assert.equal(deletedRoute.status, 200);
  } finally {
    await app.close();
  }
});

test('internal activity and stats require the service token', async () => {
  const app = await setup();
  try {
    const denied = await call(app.base, '/api/internal/stats');
    assert.equal(denied.status, 403);

    const activity = await call(app.base, '/api/internal/activity?studentId=usr_test_student', {
      serviceToken: TEST_SERVICE_TOKEN,
    });
    assert.equal(activity.status, 200);
    assert.ok(Array.isArray(activity.body.items));

    const stats = await call(app.base, '/api/internal/stats', {
      serviceToken: TEST_SERVICE_TOKEN,
    });
    assert.equal(stats.status, 200);
    assert.equal(typeof stats.body.activeBookings, 'number');
  } finally {
    await app.close();
  }
});
