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

function upstream() {
  return fakeFetch({
    'internal/charges': { payment: { id: 'pay_test_accommodation' } },
    'internal/refunds': { refund: { id: 'ref_test_accommodation' } },
    'internal/notifications': { notification: { id: 'ntf_test' } },
  });
}

function setup() {
  return harness({ schemaUrl, createApp, ensureSeedData, config, fetchImpl: upstream() });
}

test('browses and filters accommodation catalogue', async () => {
  const app = await setup();
  try {
    const buildings = await call(app.base, '/api/buildings');
    assert.equal(buildings.status, 200);
    assert.ok(buildings.body.items.length >= 3);
    assert.ok(buildings.body.items[0].roomCount >= 0);

    const rooms = await call(app.base, '/api/rooms?available=true');
    assert.equal(rooms.status, 200);
    assert.ok(rooms.body.items.length > 0);
    assert.ok(rooms.body.items.every((room) => room.status === 'AVAILABLE'));

    const filtered = await call(app.base, '/api/rooms?maxPrice=450&capacity=2');
    assert.equal(filtered.status, 200);
    assert.ok(filtered.body.items.every((room) => room.price <= 450 && room.capacity >= 2));

    const searched = await call(app.base, '/api/rooms?q=lakeside');
    assert.equal(searched.status, 200);
    assert.ok(searched.body.items.every((room) => /lakeside/i.test(room.buildingName || '')));

    const room = rooms.body.items[0];
    const detail = await call(app.base, `/api/rooms/${room.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.room.id, room.id);
    assert.equal(typeof detail.body.room.averageRating, 'number');

    const reviews = await call(app.base, `/api/rooms/${room.id}/reviews`);
    assert.equal(reviews.status, 200);
    assert.ok(Array.isArray(reviews.body.items));
  } finally {
    await app.close();
  }
});

test('books, rejects overlaps, lists and cancels a room', async () => {
  const app = await setup();
  const token = makeToken();
  try {
    const catalogue = await call(app.base, '/api/rooms?available=true');
    const room = catalogue.body.items[0];

    const booking = await call(app.base, '/api/bookings', {
      method: 'POST',
      token,
      body: { roomId: room.id, checkIn: '2028-03-01', checkOut: '2028-03-05' },
    });
    assert.equal(booking.status, 201);
    assert.equal(booking.body.booking.status, 'CONFIRMED');
    assert.equal(booking.body.booking.nights, 4);
    assert.equal(booking.body.booking.paymentId, 'pay_test_accommodation');

    const overlap = await call(app.base, '/api/bookings', {
      method: 'POST',
      token,
      body: { roomId: room.id, checkIn: '2028-03-03', checkOut: '2028-03-07' },
    });
    assert.equal(overlap.status, 409);

    const invalidDates = await call(app.base, '/api/bookings', {
      method: 'POST',
      token,
      body: { roomId: room.id, checkIn: '2028-03-05', checkOut: '2028-03-01' },
    });
    assert.equal(invalidDates.status, 400);

    const mine = await call(app.base, '/api/bookings', { token });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.items.some((item) => item.id === booking.body.booking.id));

    const cancelled = await call(app.base, `/api/bookings/${booking.body.booking.id}/cancel`, {
      method: 'POST',
      token,
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.booking.status, 'CANCELLED');

    const released = await call(app.base, `/api/rooms/${room.id}`);
    assert.equal(released.body.room.status, 'AVAILABLE');
  } finally {
    await app.close();
  }
});

test('requires a completed stay before accepting a review', async () => {
  const app = await setup();
  const token = makeToken();
  try {
    const catalogue = await call(app.base, '/api/rooms?available=true');
    const rooms = catalogue.body.items;
    const room = rooms[0];

    const denied = await call(app.base, '/api/reviews', {
      method: 'POST',
      token,
      body: { roomId: room.id, rating: 5 },
    });
    assert.equal(denied.status, 403);

    const booking = await call(app.base, '/api/bookings', {
      method: 'POST',
      token,
      body: { roomId: room.id, checkIn: '2028-04-01', checkOut: '2028-04-03' },
    });
    await app.pool.query("UPDATE bookings SET status = 'COMPLETED' WHERE id = $1", [
      booking.body.booking.id,
    ]);

    const review = await call(app.base, '/api/reviews', {
      method: 'POST',
      token,
      body: { roomId: room.id, rating: 5, comment: 'Excellent room' },
    });
    assert.equal(review.status, 201);
    assert.equal(review.body.review.rating, 5);

    const reviews = await call(app.base, `/api/rooms/${room.id}/reviews`);
    assert.equal(reviews.body.average, 5);
    assert.equal(reviews.body.items.length, 1);
  } finally {
    await app.close();
  }
});

test('admin manages buildings and room availability while students are denied', async () => {
  const app = await setup();
  try {
    const forbidden = await call(app.base, '/api/admin/buildings', {
      method: 'POST',
      token: makeToken(),
      body: { name: 'Student Hall' },
    });
    assert.equal(forbidden.status, 403);

    const token = adminToken();
    const building = await call(app.base, '/api/admin/buildings', {
      method: 'POST',
      token,
      body: { name: 'Test Hall', address: '1 Test Road' },
    });
    assert.equal(building.status, 201);

    const room = await call(app.base, '/api/admin/rooms', {
      method: 'POST',
      token,
      body: {
        buildingId: building.body.building.id,
        name: 'T-1',
        price: 300,
        capacity: 2,
        amenities: ['Wi-Fi', 'Desk'],
      },
    });
    assert.equal(room.status, 201);
    assert.deepEqual(room.body.room.amenities, ['Wi-Fi', 'Desk']);

    const maintenance = await call(
      app.base,
      `/api/admin/rooms/${room.body.room.id}/availability`,
      { method: 'PATCH', token, body: { status: 'MAINTENANCE' } },
    );
    assert.equal(maintenance.status, 200);
    assert.equal(maintenance.body.room.status, 'MAINTENANCE');

    const badStatus = await call(
      app.base,
      `/api/admin/rooms/${room.body.room.id}/availability`,
      { method: 'PATCH', token, body: { status: 'UNKNOWN' } },
    );
    assert.equal(badStatus.status, 400);
  } finally {
    await app.close();
  }
});

test('internal activity and stats require the service token', async () => {
  const app = await setup();
  try {
    const unauthorised = await call(app.base, '/api/internal/stats');
    assert.equal(unauthorised.status, 403);

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
    assert.equal(typeof stats.body.totalBookings, 'number');
  } finally {
    await app.close();
  }
});
