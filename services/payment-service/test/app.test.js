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

async function pay(app, amount, overrides = {}) {
  const response = await call(app.base, '/api/payments', {
    method: 'POST',
    token: makeToken(),
    body: {
      payableType: 'TEST_FEE',
      payableId: 'fee_1',
      amount,
      description: 'Test payment',
      ...overrides,
    },
  });
  assert.equal(response.status, 201);
  return response.body;
}

test('pays fees and issues receipts', async () => {
  const app = await setup();
  const token = makeToken();
  try {
    const result = await pay(app, 25);
    assert.equal(result.payment.status, 'PAID');
    assert.equal(result.payment.amount, 25);
    assert.ok(result.receipt.receiptNumber);

    const list = await call(app.base, '/api/payments', { token });
    assert.ok(list.body.items.some((item) => item.id === result.payment.id));

    const detail = await call(app.base, `/api/payments/${result.payment.id}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.payment.status, 'PAID');

    const receipt = await call(app.base, `/api/payments/${result.payment.id}/receipt`, { token });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.receipt.id, result.receipt.id);

    const other = await call(app.base, `/api/payments/${result.payment.id}`, {
      token: makeToken({ id: 'usr_other_student' }),
    });
    assert.equal(other.status, 403);

    const failed = await pay(app, 0, { payableId: 'fee_zero' });
    assert.equal(failed.payment.status, 'FAILED');
    assert.equal(failed.receipt, null);
  } finally {
    await app.close();
  }
});

test('requests, approves, rejects and issues refunds', async () => {
  const app = await setup();
  const token = makeToken();
  const admin = adminToken();
  try {
    const result = await pay(app, 100, { payableId: 'refundable_fee' });

    const refund = await call(app.base, '/api/refunds', {
      method: 'POST',
      token,
      body: { paymentId: result.payment.id, reason: 'Changed my mind' },
    });
    assert.equal(refund.status, 201);
    assert.equal(refund.body.refund.status, 'REQUESTED');

    const tooMuch = await call(app.base, '/api/refunds', {
      method: 'POST',
      token,
      body: { paymentId: result.payment.id, reason: 'Too much', amount: 60 },
    });
    assert.equal(tooMuch.status, 400);

    const mine = await call(app.base, '/api/refunds', { token });
    assert.ok(mine.body.items.some((item) => item.id === refund.body.refund.id));

    const approved = await call(app.base, `/api/admin/refunds/${refund.body.refund.id}`, {
      method: 'PATCH',
      token: admin,
      body: { action: 'approve' },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.refund.status, 'APPROVED');

    const issued = await call(app.base, `/api/admin/refunds/${refund.body.refund.id}`, {
      method: 'PATCH',
      token: admin,
      body: { action: 'issue' },
    });
    assert.equal(issued.status, 200);
    assert.equal(issued.body.refund.status, 'ISSUED');
    assert.equal(issued.body.payment.status, 'REFUNDED');

    const second = await pay(app, 40, { payableId: 'rejectable_fee' });
    const requested = await call(app.base, '/api/refunds', {
      method: 'POST',
      token,
      body: { paymentId: second.payment.id, reason: 'Duplicate charge' },
    });
    const rejected = await call(app.base, `/api/admin/refunds/${requested.body.refund.id}`, {
      method: 'PATCH',
      token: admin,
      body: { action: 'reject' },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.refund.status, 'REJECTED');
  } finally {
    await app.close();
  }
});

test('exposes authenticated internal charge and auto-refund endpoints', async () => {
  const app = await setup();
  try {
    const denied = await call(app.base, '/api/internal/charges', {
      method: 'POST',
      body: {
        studentId: 'usr_test_student',
        payableType: 'INTERNAL',
        payableId: 'internal_1',
        amount: 30,
      },
    });
    assert.equal(denied.status, 403);

    const charged = await call(app.base, '/api/internal/charges', {
      method: 'POST',
      serviceToken: TEST_SERVICE_TOKEN,
      body: {
        studentId: 'usr_test_student',
        payableType: 'ACCOMMODATION_BOOKING',
        payableId: 'booking_1',
        amount: 30,
        description: 'Room booking',
      },
    });
    assert.equal(charged.status, 201);
    assert.equal(charged.body.payment.status, 'PAID');

    const refunded = await call(app.base, '/api/internal/refunds', {
      method: 'POST',
      serviceToken: TEST_SERVICE_TOKEN,
      body: {
        paymentId: charged.body.payment.id,
        studentId: 'usr_test_student',
        amount: 30,
        reason: 'Booking cancelled',
      },
    });
    assert.equal(refunded.status, 201);
    assert.equal(refunded.body.refund.status, 'ISSUED');
    assert.equal(refunded.body.payment.status, 'REFUNDED');
  } finally {
    await app.close();
  }
});

test('internal activity and stats require the service token', async () => {
  const app = await setup();
  try {
    await pay(app, 12, { payableId: 'activity_fee' });

    const denied = await call(app.base, '/api/internal/stats');
    assert.equal(denied.status, 403);

    const activity = await call(app.base, '/api/internal/activity?studentId=usr_test_student', {
      serviceToken: TEST_SERVICE_TOKEN,
    });
    assert.equal(activity.status, 200);
    assert.ok(activity.body.items.some((item) => item.type === 'PAYMENT'));

    const stats = await call(app.base, '/api/internal/stats', {
      serviceToken: TEST_SERVICE_TOKEN,
    });
    assert.equal(stats.status, 200);
    assert.equal(typeof stats.body.revenue, 'number');
  } finally {
    await app.close();
  }
});
