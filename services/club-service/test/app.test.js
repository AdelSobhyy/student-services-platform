import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp, ensureSeedData } from '../src/app.js';
import { adminToken, call, fakeFetch, harness, makeToken, TEST_SERVICE_TOKEN } from './helpers.js';

const schemaUrl = new URL('../db/init.sql', import.meta.url);
const config = {
  userServiceUrl: 'http://user-service',
  communicationServiceUrl: 'http://communication-service',
};

function setup() {
  return harness({
    schemaUrl,
    createApp,
    ensureSeedData,
    config,
    fetchImpl: fakeFetch({ 'internal/notifications': { notification: { id: 'ntf_test' } } }),
  });
}

test('browses and filters approved clubs', async () => {
  const app = await setup();
  try {
    const clubs = await call(app.base, '/api/clubs');
    assert.equal(clubs.status, 200);
    assert.ok(clubs.body.items.length >= 2);
    assert.ok(clubs.body.items.every((club) => club.status === 'APPROVED'));

    const searched = await call(app.base, '/api/clubs?q=robotics');
    assert.equal(searched.status, 200);
    assert.ok(searched.body.items.some((club) => /robotics/i.test(club.name)));

    const category = await call(app.base, '/api/clubs?category=Technology');
    assert.equal(category.status, 200);
    assert.ok(category.body.items.every((club) => club.category === 'Technology'));

    const first = clubs.body.items[0];
    const detail = await call(app.base, `/api/clubs/${first.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.club.id, first.id);

    const missing = await call(app.base, '/api/clubs/club_missing');
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test('proposes, approves, joins and leaves a club', async () => {
  const app = await setup();
  const student = makeToken();
  try {
    const proposal = await call(app.base, '/api/clubs', {
      method: 'POST',
      token: student,
      body: { name: 'Test Coding Club', description: 'Weekly coding sessions', category: 'Technology' },
    });
    assert.equal(proposal.status, 201);
    assert.equal(proposal.body.club.status, 'PENDING');
    assert.equal(proposal.body.club.proposedBy, 'usr_test_student');

    const publicList = await call(app.base, '/api/clubs');
    assert.ok(!publicList.body.items.some((club) => club.id === proposal.body.club.id));

    const earlyJoin = await call(app.base, `/api/clubs/${proposal.body.club.id}/join`, {
      method: 'POST',
      token: student,
    });
    assert.equal(earlyJoin.status, 400);

    const approved = await call(app.base, `/api/admin/clubs/${proposal.body.club.id}/approve`, {
      method: 'POST',
      token: adminToken(),
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.club.status, 'APPROVED');

    const joined = await call(app.base, `/api/clubs/${proposal.body.club.id}/join`, {
      method: 'POST',
      token: student,
    });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.membership.status, 'ACTIVE');

    const duplicate = await call(app.base, `/api/clubs/${proposal.body.club.id}/join`, {
      method: 'POST',
      token: student,
    });
    assert.equal(duplicate.status, 409);

    const mine = await call(app.base, '/api/clubs/mine', { token: student });
    assert.ok(mine.body.items.some((item) => item.club.id === proposal.body.club.id));

    const left = await call(app.base, `/api/clubs/${proposal.body.club.id}/leave`, {
      method: 'POST',
      token: student,
    });
    assert.equal(left.status, 200);
    assert.equal(left.body.membership.status, 'LEFT');
  } finally {
    await app.close();
  }
});

test('manages club events and restricts membership lists', async () => {
  const app = await setup();
  const admin = adminToken();
  try {
    const clubs = await call(app.base, '/api/clubs');
    const club = clubs.body.items[0];

    const event = await call(app.base, `/api/clubs/${club.id}/events`, {
      method: 'POST',
      token: admin,
      body: {
        title: 'Open Day',
        description: 'Meet the team',
        startsAt: '2028-07-01T10:00:00.000Z',
        endsAt: '2028-07-01T12:00:00.000Z',
      },
    });
    assert.equal(event.status, 201);
    assert.equal(event.body.event.title, 'Open Day');

    const events = await call(app.base, `/api/clubs/${club.id}/events`);
    assert.ok(events.body.items.some((item) => item.id === event.body.event.id));

    const leader = makeToken({ id: 'usr_leader', role: 'CLUB_LEADER', clubId: club.id });
    const assigned = await call(app.base, `/api/admin/clubs/${club.id}/leader`, {
      method: 'PATCH',
      token: admin,
      body: { userId: 'usr_leader' },
    });
    assert.equal(assigned.status, 200);

    const members = await call(app.base, `/api/clubs/${club.id}/members`, { token: leader });
    assert.equal(members.status, 200);

    const studentDenied = await call(app.base, `/api/clubs/${club.id}/members`, {
      token: makeToken(),
    });
    assert.equal(studentDenied.status, 403);

    const updated = await call(app.base, `/api/events/${event.body.event.id}`, {
      method: 'PATCH',
      token: leader,
      body: { title: 'Updated Open Day' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.event.title, 'Updated Open Day');

    const joined = await call(app.base, '/api/events?joined=true', { token: makeToken() });
    assert.equal(joined.status, 200);
    assert.ok(Array.isArray(joined.body.items));

    const deleted = await call(app.base, `/api/events/${event.body.event.id}`, {
      method: 'DELETE',
      token: leader,
    });
    assert.equal(deleted.status, 200);
  } finally {
    await app.close();
  }
});

test('admin rejects and suspends clubs', async () => {
  const app = await setup();
  const admin = adminToken();
  try {
    const proposal = await call(app.base, '/api/clubs', {
      method: 'POST',
      token: makeToken(),
      body: { name: 'Rejected Club', description: 'Test', category: 'Academic' },
    });
    const rejected = await call(app.base, `/api/admin/clubs/${proposal.body.club.id}/reject`, {
      method: 'POST',
      token: admin,
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.club.status, 'REJECTED');

    const clubs = await call(app.base, '/api/clubs');
    const approved = clubs.body.items.find((club) => club.status === 'APPROVED');
    const suspended = await call(app.base, `/api/admin/clubs/${approved.id}/suspend`, {
      method: 'POST',
      token: admin,
    });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.club.status, 'SUSPENDED');

    const blockedJoin = await call(app.base, `/api/clubs/${approved.id}/join`, {
      method: 'POST',
      token: makeToken(),
    });
    assert.equal(blockedJoin.status, 400);
  } finally {
    await app.close();
  }
});

test('internal activity, stats and reports require the service token', async () => {
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
    assert.equal(typeof stats.body.clubs, 'number');

    const report = await call(app.base, '/api/internal/report?type=clubs', {
      serviceToken: TEST_SERVICE_TOKEN,
    });
    assert.equal(report.status, 200);
    assert.ok(report.body.items.length >= 2);
  } finally {
    await app.close();
  }
});
