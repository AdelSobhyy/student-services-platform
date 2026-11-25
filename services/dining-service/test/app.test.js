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
const futureDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

function setup() {
  return harness({
    schemaUrl,
    createApp,
    ensureSeedData,
    config,
    fetchImpl: fakeFetch({
      'internal/charges': { payment: { id: 'pay_test_dining' } },
      'internal/refunds': { refund: { id: 'ref_test_dining' } },
      'internal/notifications': { notification: { id: 'ntf_test' } },
    }),
  });
}

async function createMeal(app, overrides = {}) {
  const response = await call(app.base, '/api/admin/meals', {
    method: 'POST',
    token: adminToken(),
    body: {
      name: 'Test Meal',
      price: 9.5,
      mealDate: futureDate,
      ingredients: ['rice', 'chicken'],
      nutrition: ['calories:550', 'protein:35g'],
      allergens: [],
      ...overrides,
    },
  });
  assert.equal(response.status, 201);
  return response.body.meal;
}

test('TC5.1 TC5.2 browses menus and meal details', async () => {
  const app = await setup();
  try {
    const meals = await call(app.base, '/api/meals');
    assert.equal(meals.status, 200);
    assert.ok(meals.body.items.length >= 3);

    const meal = meals.body.items[0];
    assert.ok(Array.isArray(meal.ingredients));
    assert.equal(typeof meal.nutrition, 'object');

    const detail = await call(app.base, `/api/meals/${meal.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.meal.id, meal.id);

    const searched = await call(app.base, '/api/meals?q=lentil');
    assert.equal(searched.status, 200);
    assert.ok(searched.body.items.length > 0);
  } finally {
    await app.close();
  }
});

test('TC5.9 TC5.10 saves dietary preferences and highlights conflicts', async () => {
  const app = await setup();
  try {
    const meal = await createMeal(app, {
      name: 'Peanut Rice',
      ingredients: ['Peanuts', 'rice'],
      allergens: ['Peanuts'],
    });

    const preferences = await call(app.base, '/api/dietary', {
      method: 'PUT',
      token: makeToken(),
      body: { restrictions: 'Vegetarian', allergies: ['Peanuts'] },
    });
    assert.equal(preferences.status, 200);
    assert.deepEqual(preferences.body.preferences.allergies, ['Peanuts']);

    const conflicts = await call(app.base, `/api/meals/${meal.id}/conflicts`, {
      token: makeToken(),
    });
    assert.equal(conflicts.status, 200);
    assert.deepEqual(conflicts.body.conflicts, ['Peanuts']);

    const highlighted = await call(app.base, '/api/meals?highlight=true', {
      token: makeToken(),
    });
    assert.equal(highlighted.status, 200);
    assert.ok(highlighted.body.items.some((item) => item.id === meal.id));

    const anonymousHighlight = await call(app.base, '/api/meals?highlight=true');
    assert.equal(anonymousHighlight.status, 401);
  } finally {
    await app.close();
  }
});

test('TC5.3 TC5.4 TC5.5 TC5.6 orders a meal and cancels before the deadline', async () => {
  const app = await setup();
  const token = makeToken();
  try {
    const meal = await createMeal(app, { name: 'Lunch Special' });

    const order = await call(app.base, '/api/orders', {
      method: 'POST',
      token,
      body: { mealId: meal.id },
    });
    assert.equal(order.status, 201);
    assert.equal(order.body.order.status, 'PAID');
    assert.equal(order.body.order.paymentId, 'pay_test_dining');

    const orders = await call(app.base, '/api/orders', { token });
    assert.ok(orders.body.items.some((item) => item.id === order.body.order.id));

    const cancelled = await call(app.base, `/api/orders/${order.body.order.id}/cancel`, {
      method: 'POST',
      token,
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.order.status, 'CANCELLED');

    const outOfStock = await createMeal(app, {
      name: 'Sold Out',
      stockStatus: 'OUT_OF_STOCK',
    });
    const rejected = await call(app.base, '/api/orders', {
      method: 'POST',
      token,
      body: { mealId: outOfStock.id },
    });
    assert.equal(rejected.status, 400);
  } finally {
    await app.close();
  }
});

test('TC5.7 TC5.8 admin manages meals and stock while students are denied', async () => {
  const app = await setup();
  try {
    const denied = await call(app.base, '/api/admin/meals', {
      method: 'POST',
      token: makeToken(),
      body: { name: 'Nope', price: 1, mealDate: futureDate },
    });
    assert.equal(denied.status, 403);

    const meal = await createMeal(app, { name: 'Managed Meal' });
    const stock = await call(app.base, `/api/admin/meals/${meal.id}/stock`, {
      method: 'PATCH',
      token: adminToken(),
      body: { stockStatus: 'OUT_OF_STOCK' },
    });
    assert.equal(stock.status, 200);
    assert.equal(stock.body.meal.stockStatus, 'OUT_OF_STOCK');

    const patched = await call(app.base, `/api/admin/meals/${meal.id}`, {
      method: 'PATCH',
      token: adminToken(),
      body: { name: 'Renamed Meal', price: 11.25 },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.meal.name, 'Renamed Meal');
    assert.equal(patched.body.meal.price, 11.25);

    const deleted = await call(app.base, `/api/admin/meals/${meal.id}`, {
      method: 'DELETE',
      token: adminToken(),
    });
    assert.equal(deleted.status, 200);
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
    assert.equal(typeof stats.body.activeOrders, 'number');
  } finally {
    await app.close();
  }
});
