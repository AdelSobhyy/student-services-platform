import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp, ensureSeedData } from '../src/app.js';
import { adminToken, call, fakeFetch, harness, makeToken, TEST_SERVICE_TOKEN } from './helpers.js';

const schemaUrl = new URL('../db/init.sql', import.meta.url);
const config = {
  userServiceUrl: 'http://user-service',
  accommodationServiceUrl: 'http://accommodation-service',
  transportServiceUrl: 'http://transport-service',
  clubServiceUrl: 'http://club-service',
  diningServiceUrl: 'http://dining-service',
  libraryServiceUrl: 'http://library-service',
  paymentServiceUrl: 'http://payment-service',
};

function setup() {
  return harness({
    schemaUrl,
    createApp,
    ensureSeedData,
    config,
    fetchImpl: fakeFetch({
      'user-service/api/internal/users': {
        items: [{ id: 'usr_test_student' }, { id: 'usr_other_student' }],
      },
      'accommodation-service/api/internal/stats': { activeBookings: 2, totalBookings: 5 },
      'transport-service/api/internal/stats': { activeBookings: 1, totalBookings: 4 },
      'club-service/api/internal/stats': { clubs: 5, memberships: 12, events: 3 },
      'club-service/api/internal/report': {
        items: [
          {
            id: 'club_robotics',
            name: 'Robotics Club',
            category: 'Technology',
            status: 'APPROVED',
            membersCount: 9,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      'dining-service/api/internal/stats': { activeOrders: 3, totalOrders: 10 },
      'library-service/api/internal/stats': { resources: 20, reservations: 4, downloads: 7 },
      'payment-service/api/internal/stats': { payments: 15, revenue: 250 },
    }),
  });
}

test('TC6.1 TC6.2 delivers, lists and marks notifications as read', async () => {
  const app = await setup();
  const token = makeToken();
  try {
    const denied = await call(app.base, '/api/internal/notifications', {
      method: 'POST',
      body: { recipientId: 'usr_test_student', title: 'Nope', body: 'Nope' },
    });
    assert.equal(denied.status, 403);

    const created = await call(app.base, '/api/internal/notifications', {
      method: 'POST',
      serviceToken: TEST_SERVICE_TOKEN,
      body: {
        recipientId: 'usr_test_student',
        type: 'SYSTEM',
        title: 'Test notice',
        body: 'Read me',
      },
    });
    assert.equal(created.status, 201);

    const notifications = await call(app.base, '/api/notifications', { token });
    assert.equal(notifications.status, 200);
    const notice = notifications.body.items.find((item) => item.title === 'Test notice');
    assert.ok(notice);
    assert.equal(notice.read, false);

    const unread = await call(app.base, '/api/notifications?unread=true', { token });
    assert.ok(unread.body.items.some((item) => item.id === notice.id));

    const read = await call(app.base, `/api/notifications/${notice.id}/read`, {
      method: 'PATCH',
      token,
    });
    assert.equal(read.status, 200);
    assert.equal(read.body.notification.read, true);

    const after = await call(app.base, '/api/notifications?unread=true', { token });
    assert.ok(!after.body.items.some((item) => item.id === notice.id));

    const broadcast = await call(app.base, '/api/admin/notifications', {
      method: 'POST',
      token: adminToken(),
      body: { all: true, title: 'Broadcast', body: 'To everyone' },
    });
    assert.equal(broadcast.status, 201);
    assert.equal(broadcast.body.count, 2);
  } finally {
    await app.close();
  }
});

test('TC6.3 TC6.4 submits, responds to and resolves support tickets', async () => {
  const app = await setup();
  const token = makeToken();
  try {
    const ticket = await call(app.base, '/api/tickets', {
      method: 'POST',
      token,
      body: { subject: 'Need help', description: 'Cannot access my room' },
    });
    assert.equal(ticket.status, 201);
    assert.equal(ticket.body.ticket.status, 'OPEN');

    const mine = await call(app.base, '/api/tickets', { token });
    assert.ok(mine.body.items.some((item) => item.id === ticket.body.ticket.id));

    const detail = await call(app.base, `/api/tickets/${ticket.body.ticket.id}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.messages.length, 0);

    const other = await call(app.base, `/api/tickets/${ticket.body.ticket.id}`, {
      token: makeToken({ id: 'usr_other_student' }),
    });
    assert.equal(other.status, 403);

    const admin = adminToken();
    const all = await call(app.base, '/api/tickets?all=true', { token: admin });
    assert.ok(all.body.items.some((item) => item.id === ticket.body.ticket.id));

    const responded = await call(app.base, `/api/admin/tickets/${ticket.body.ticket.id}/respond`, {
      method: 'POST',
      token: admin,
      body: { body: 'We are looking into it', status: 'IN_PROGRESS' },
    });
    assert.equal(responded.status, 200);
    assert.equal(responded.body.ticket.status, 'IN_PROGRESS');
    assert.equal(responded.body.messages.length, 1);

    const resolved = await call(app.base, `/api/admin/tickets/${ticket.body.ticket.id}/status`, {
      method: 'PATCH',
      token: admin,
      body: { status: 'RESOLVED' },
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.ticket.status, 'RESOLVED');

    const finalDetail = await call(app.base, `/api/tickets/${ticket.body.ticket.id}`, { token });
    assert.equal(finalDetail.body.ticket.status, 'RESOLVED');
    assert.equal(finalDetail.body.messages.length, 1);
  } finally {
    await app.close();
  }
});

test('TC6.5 TC6.6 builds analytics summaries and CSV club reports', async () => {
  const app = await setup();
  try {
    const denied = await call(app.base, '/api/admin/analytics/summary', {
      token: makeToken(),
    });
    assert.equal(denied.status, 403);

    const summary = await call(app.base, '/api/admin/analytics/summary', {
      token: adminToken(),
    });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.summary.peers.accommodation.activeBookings, 2);
    assert.equal(summary.body.summary.peers.clubs.clubs, 5);
    assert.equal(typeof summary.body.summary.tickets, 'number');

    const report = await call(app.base, '/api/admin/reports/clubs', {
      token: adminToken(),
    });
    assert.equal(report.status, 200);
    assert.match(report.headers.get('content-type') || '', /text\/csv/);
    assert.match(report.text, /id,name,category,status/);
    assert.match(report.text, /Robotics Club/);
  } finally {
    await app.close();
  }
});

test('TC6.7 TC6.8 TC6.9 manages semester settings and announcements', async () => {
  const app = await setup();
  try {
    const initial = await call(app.base, '/api/settings/semester');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.semester.startDate, '2026-09-01');

    const denied = await call(app.base, '/api/admin/settings/semester', {
      method: 'PUT',
      token: makeToken(),
      body: { startDate: '2027-01-01', endDate: '2027-06-01' },
    });
    assert.equal(denied.status, 403);

    const updated = await call(app.base, '/api/admin/settings/semester', {
      method: 'PUT',
      token: adminToken(),
      body: { startDate: '2027-02-01', endDate: '2027-06-01' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.semester.startDate, '2027-02-01');

    const announcement = await call(app.base, '/api/admin/announcements', {
      method: 'POST',
      token: adminToken(),
      body: { title: 'Welcome back', body: 'Classes start soon' },
    });
    assert.equal(announcement.status, 201);

    const announcements = await call(app.base, '/api/announcements');
    assert.ok(announcements.body.items.some((item) => item.title === 'Welcome back'));
  } finally {
    await app.close();
  }
});
