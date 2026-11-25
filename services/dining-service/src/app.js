import express from 'express';
import {
  asyncHandler,
  authenticate,
  badRequest,
  cleanString,
  cors,
  createClient,
  errorHandler,
  forbidden,
  healthRoutes,
  iso,
  notFound,
  requireFields,
  requireService,
  toNumber,
  unauthorized,
  uuid,
} from './common.js';

const STOCK_STATUSES = ['AVAILABLE', 'OUT_OF_STOCK'];
const CANCELLABLE_STATUSES = ['CREATED', 'PAID', 'PAYMENT_FAILED'];

function splitList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(items) {
  return items.length ? items.join(', ') : null;
}

function normalizeListInput(value, field) {
  if (value === undefined || value === null || value === '') return [];
  let items;
  if (Array.isArray(value)) {
    items = value.map((item) => cleanString(item, 80)).filter(Boolean);
  } else if (typeof value === 'string') {
    items = splitList(value);
  } else {
    throw badRequest(`${field} must be a string or an array`);
  }
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}

function parseNutrition(value) {
  const nutrition = {};
  for (const entry of splitList(value)) {
    const separator = entry.indexOf(':');
    if (separator === -1) {
      nutrition[entry] = true;
      continue;
    }
    const key = entry.slice(0, separator).trim();
    const raw = entry.slice(separator + 1).trim();
    if (!key) continue;
    const number = Number(raw);
    nutrition[key] = Number.isFinite(number) ? number : raw;
  }
  return nutrition;
}

function mapMeal(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    category: row.category,
    price: Number(row.price),
    mealDate: row.meal_date,
    ingredients: splitList(row.ingredients),
    nutrition: parseNutrition(row.nutrition),
    allergens: splitList(row.allergens),
    stockStatus: row.stock_status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapPreferences(row) {
  if (!row) return { restrictions: [], allergies: [], updatedAt: null };
  return {
    restrictions: splitList(row.restrictions),
    allergies: splitList(row.allergies),
    updatedAt: iso(row.updated_at),
  };
}

function mapOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    mealId: row.meal_id,
    mealName: row.meal_name,
    amount: Number(row.amount),
    status: row.status,
    paymentId: row.payment_id || null,
    conflicts: splitList(row.conflicts),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    cancelledAt: iso(row.cancelled_at),
    completedAt: iso(row.completed_at),
  };
}

function computeConflicts(mealRow, preferenceRow) {
  const terms = [
    ...splitList(preferenceRow?.restrictions),
    ...splitList(preferenceRow?.allergies),
  ];
  const ingredients = [...splitList(mealRow.ingredients), ...splitList(mealRow.allergens)];
  const conflicts = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    const matched = ingredients.some((ingredient) => {
      const haystack = ingredient.toLowerCase();
      return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
    });
    if (matched && !conflicts.some((item) => item.toLowerCase() === needle)) {
      conflicts.push(term);
    }
  }
  return conflicts;
}

function normalizeMealDate(value, field = 'mealDate') {
  const text = cleanString(value, 10);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw badRequest(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) throw badRequest(`Invalid ${field}`);
  return text;
}

function normalizePrice(value) {
  const price = toNumber(value);
  if (price === null || price < 0) throw badRequest('price must be a positive number');
  return Math.round(price * 100) / 100;
}

function cancellationDeadline(mealDate) {
  return new Date(`${mealDate}T18:00:00`);
}

async function findMeal(pool, id) {
  const { rows } = await pool.query('SELECT * FROM meals WHERE id = $1', [id]);
  return rows[0] || null;
}

async function requireMeal(pool, id) {
  const meal = await findMeal(pool, id);
  if (!meal) throw notFound('Meal not found');
  return meal;
}

async function findPreferences(pool, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM dietary_preferences WHERE user_id = $1',
    [userId],
  );
  return rows[0] || null;
}

export function createApp({ pool, config, fetchImpl = fetch }) {
  const app = express();
  const http = createClient(config, fetchImpl);
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json({ limit: '1mb' }));

  healthRoutes(app, pool, 'dining-service', {
    ...(config.userServiceUrl ? { user: config.userServiceUrl } : {}),
    ...(config.communicationServiceUrl ? { communication: config.communicationServiceUrl } : {}),
    ...(config.paymentServiceUrl ? { payment: config.paymentServiceUrl } : {}),
  });

  const auth = authenticate(config.authSecret);
  const optionalAuth = authenticate(config.authSecret, { required: false });
  const admin = authenticate(config.authSecret, { roles: ['ADMIN'] });
  const service = requireService(config.serviceToken);

  // FR15 Public menu
  app.get(
    '/api/meals',
    optionalAuth,
    asyncHandler(async (req, res) => {
      const highlight = String(req.query.highlight || '').toLowerCase() === 'true';
      if (highlight && !req.user) throw unauthorized('Authentication required');

      const filters = [];
      const params = [];
      const q = cleanString(req.query.q, 120);
      if (q) {
        params.push(`%${q.toLowerCase()}%`);
        filters.push(
          `(lower(name) LIKE $${params.length} OR lower(coalesce(description, '')) LIKE $${params.length})`,
        );
      }
      const date = cleanString(req.query.date, 10);
      if (date) {
        params.push(date);
        filters.push(`meal_date = $${params.length}`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM meals ${where} ORDER BY meal_date ASC, name ASC`,
        params,
      );

      if (highlight) {
        const preferences = await findPreferences(pool, req.user.sub);
        const items = rows
          .map((row) => ({ ...mapMeal(row), conflicts: computeConflicts(row, preferences) }))
          .filter((meal) => meal.conflicts.length > 0);
        return res.json({ items });
      }
      return res.json({ items: rows.map(mapMeal) });
    }),
  );

  app.get(
    '/api/meals/:id/conflicts',
    auth,
    asyncHandler(async (req, res) => {
      const meal = await requireMeal(pool, req.params.id);
      const preferences = await findPreferences(pool, req.user.sub);
      res.json({ conflicts: computeConflicts(meal, preferences) });
    }),
  );

  app.get(
    '/api/meals/:id',
    asyncHandler(async (req, res) => {
      const meal = await requireMeal(pool, req.params.id);
      res.json({ meal: mapMeal(meal) });
    }),
  );

  // FR17 Dietary preferences
  app.get(
    '/api/dietary',
    auth,
    asyncHandler(async (req, res) => {
      const preferences = await findPreferences(pool, req.user.sub);
      res.json({ preferences: mapPreferences(preferences) });
    }),
  );

  app.put(
    '/api/dietary',
    auth,
    asyncHandler(async (req, res) => {
      const restrictions = normalizeListInput(req.body?.restrictions, 'restrictions');
      const allergies = normalizeListInput(req.body?.allergies, 'allergies');
      const existing = await findPreferences(pool, req.user.sub);
      if (existing) {
        await pool.query(
          `UPDATE dietary_preferences
           SET restrictions = $1, allergies = $2, updated_at = now()
           WHERE id = $3`,
          [joinList(restrictions), joinList(allergies), existing.id],
        );
      } else {
        await pool.query(
          `INSERT INTO dietary_preferences(id, user_id, restrictions, allergies)
           VALUES($1,$2,$3,$4)`,
          [uuid('diet'), req.user.sub, joinList(restrictions), joinList(allergies)],
        );
      }
      const updated = await findPreferences(pool, req.user.sub);
      res.json({ preferences: mapPreferences(updated) });
    }),
  );

  // FR16 Order a meal
  app.post(
    '/api/orders',
    auth,
    asyncHandler(async (req, res) => {
      requireFields(req.body || {}, ['mealId']);
      const meal = await requireMeal(pool, req.body.mealId);
      if (meal.stock_status === 'OUT_OF_STOCK') throw badRequest('Meal is out of stock');

      const preferences = await findPreferences(pool, req.user.sub);
      const conflicts = computeConflicts(meal, preferences);
      const amount = Number(meal.price);
      const orderId = uuid('ord');
      await pool.query(
        `INSERT INTO orders(id, user_id, meal_id, meal_name, amount, status, conflicts)
         VALUES($1,$2,$3,$4,$5,'CREATED',$6)`,
        [orderId, req.user.sub, meal.id, meal.name, amount, joinList(conflicts)],
      );

      let paymentId = null;
      let status = 'PAID';
      try {
        const result = await http.charge({
          studentId: req.user.sub,
          payableType: 'DINING_ORDER',
          payableId: orderId,
          amount,
          description: `Meal order: ${meal.name}`,
        });
        paymentId = result?.payment?.id || result?.id || null;
      } catch (error) {
        status = 'PAYMENT_FAILED';
        console.error('Payment charge failed', error.message);
      }

      await pool.query(
        'UPDATE orders SET status = $1, payment_id = $2, updated_at = now() WHERE id = $3',
        [status, paymentId, orderId],
      );
      const created = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);

      await http.notify({
        recipientId: req.user.sub,
        type: status === 'PAID' ? 'MEAL_ORDER_PAID' : 'MEAL_ORDER_PAYMENT_FAILED',
        title: status === 'PAID' ? 'Meal order confirmed' : 'Meal order payment failed',
        body:
          status === 'PAID'
            ? `Your order for ${meal.name} has been paid and confirmed.`
            : `We could not process payment for your order of ${meal.name}.`,
      });

      res.status(201).json({ order: mapOrder(created.rows[0]) });
    }),
  );

  // FR18 Order history
  app.get(
    '/api/orders',
    auth,
    asyncHandler(async (req, res) => {
      const { rows } =
        req.user.role === 'ADMIN'
          ? await pool.query('SELECT * FROM orders ORDER BY created_at DESC')
          : await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [
              req.user.sub,
            ]);
      res.json({ items: rows.map(mapOrder) });
    }),
  );

  app.post(
    '/api/orders/:id/cancel',
    auth,
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
      const order = rows[0];
      if (!order) throw notFound('Order not found');
      if (order.user_id !== req.user.sub && req.user.role !== 'ADMIN') {
        throw forbidden('You can only cancel your own orders');
      }
      if (!CANCELLABLE_STATUSES.includes(order.status)) {
        throw badRequest(`Order cannot be cancelled while ${order.status}`);
      }
      const meal = await findMeal(pool, order.meal_id);
      if (meal && Date.now() > cancellationDeadline(meal.meal_date).getTime()) {
        throw badRequest('The cancellation deadline for this meal has passed');
      }

      let refundResult = null;
      if (order.payment_id) {
        refundResult = await http.refund({
          paymentId: order.payment_id,
          studentId: order.user_id,
          amount: Number(order.amount),
          reason: `Meal order cancelled: ${order.meal_name}`,
        });
      }

      await pool.query(
        `UPDATE orders
         SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
         WHERE id = $1`,
        [order.id],
      );
      const updated = await pool.query('SELECT * FROM orders WHERE id = $1', [order.id]);

      await http.notify({
        recipientId: order.user_id,
        type: 'MEAL_ORDER_CANCELLED',
        title: 'Meal order cancelled',
        body: `Your order for ${order.meal_name} was cancelled and the payment refunded.`,
      });

      res.json({ order: mapOrder(updated.rows[0]), refund: refundResult });
    }),
  );

  // FR15.1 Administrator meal management
  app.post(
    '/api/admin/meals',
    admin,
    asyncHandler(async (req, res) => {
      requireFields(req.body || {}, ['name', 'price', 'mealDate']);
      const stockStatus = cleanString(req.body.stockStatus, 40) || 'AVAILABLE';
      if (!STOCK_STATUSES.includes(stockStatus)) throw badRequest('Invalid stock status');
      const id = uuid('meal');
      await pool.query(
        `INSERT INTO meals(id, name, description, category, price, meal_date,
                           ingredients, nutrition, allergens, stock_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          cleanString(req.body.name, 160),
          cleanString(req.body.description, 2000),
          cleanString(req.body.category, 60) || 'MAIN',
          normalizePrice(req.body.price),
          normalizeMealDate(req.body.mealDate),
          joinList(normalizeListInput(req.body.ingredients, 'ingredients')),
          joinList(normalizeListInput(req.body.nutrition, 'nutrition')),
          joinList(normalizeListInput(req.body.allergens, 'allergens')),
          stockStatus,
        ],
      );
      const created = await requireMeal(pool, id);
      res.status(201).json({ meal: mapMeal(created) });
    }),
  );

  app.patch(
    '/api/admin/meals/:id/stock',
    admin,
    asyncHandler(async (req, res) => {
      const { stockStatus } = req.body || {};
      if (!STOCK_STATUSES.includes(stockStatus)) throw badRequest('Invalid stock status');
      const meal = await requireMeal(pool, req.params.id);
      await pool.query(
        'UPDATE meals SET stock_status = $1, updated_at = now() WHERE id = $2',
        [stockStatus, meal.id],
      );
      const updated = await requireMeal(pool, meal.id);
      res.json({ meal: mapMeal(updated) });
    }),
  );

  app.patch(
    '/api/admin/meals/:id',
    admin,
    asyncHandler(async (req, res) => {
      const meal = await requireMeal(pool, req.params.id);
      const name = req.body?.name === undefined ? meal.name : cleanString(req.body.name, 160);
      if (!name) throw badRequest('Name cannot be empty');
      const price =
        req.body?.price === undefined ? Number(meal.price) : normalizePrice(req.body.price);
      const mealDate =
        req.body?.mealDate === undefined
          ? meal.meal_date
          : normalizeMealDate(req.body.mealDate);
      const category =
        req.body?.category === undefined
          ? meal.category
          : cleanString(req.body.category, 60) || 'MAIN';
      const description =
        req.body?.description === undefined
          ? meal.description
          : cleanString(req.body.description, 2000);
      const ingredients =
        req.body?.ingredients === undefined
          ? meal.ingredients
          : joinList(normalizeListInput(req.body.ingredients, 'ingredients'));
      const nutrition =
        req.body?.nutrition === undefined
          ? meal.nutrition
          : joinList(normalizeListInput(req.body.nutrition, 'nutrition'));
      const allergens =
        req.body?.allergens === undefined
          ? meal.allergens
          : joinList(normalizeListInput(req.body.allergens, 'allergens'));
      const stockStatus =
        req.body?.stockStatus === undefined ? meal.stock_status : req.body.stockStatus;
      if (!STOCK_STATUSES.includes(stockStatus)) throw badRequest('Invalid stock status');
      await pool.query(
        `UPDATE meals
         SET name = $1, description = $2, category = $3, price = $4, meal_date = $5,
             ingredients = $6, nutrition = $7, allergens = $8, stock_status = $9,
             updated_at = now()
         WHERE id = $10`,
        [
          name,
          description,
          category,
          price,
          mealDate,
          ingredients,
          nutrition,
          allergens,
          stockStatus,
          meal.id,
        ],
      );
      const updated = await requireMeal(pool, meal.id);
      res.json({ meal: mapMeal(updated) });
    }),
  );

  app.delete(
    '/api/admin/meals/:id',
    admin,
    asyncHandler(async (req, res) => {
      const meal = await requireMeal(pool, req.params.id);
      await pool.query('DELETE FROM meals WHERE id = $1', [meal.id]);
      res.json({ message: 'Meal deleted' });
    }),
  );

  // Internal endpoints
  app.get(
    '/api/internal/activity',
    service,
    asyncHandler(async (req, res) => {
      requireFields(req.query, ['studentId']);
      const { rows } = await pool.query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
        [req.query.studentId],
      );
      const items = rows.map((row) => ({
        type: 'DINING_ORDER',
        id: row.id,
        title: row.meal_name,
        status: row.status,
        amount: Number(row.amount),
        date: iso(row.created_at),
      }));
      res.json({ items });
    }),
  );

  app.get(
    '/api/internal/stats',
    service,
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS total,
                SUM(CASE WHEN status IN ('CREATED', 'PAID') THEN 1 ELSE 0 END)::int AS active
         FROM orders`,
      );
      const row = rows[0] || {};
      res.json({
        activeOrders: Number(row.active || 0),
        totalOrders: Number(row.total || 0),
      });
    }),
  );

  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}

function dayOffset(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function ensureSeedData(pool) {
  const count = await pool.query('SELECT COUNT(*)::int AS count FROM meals');
  if (Number(count.rows[0]?.count) > 0) return;

  const meals = [
    {
      name: 'Grilled Chicken Bowl',
      description: 'Grilled chicken breast with brown rice, broccoli and a lemon olive oil dressing.',
      category: 'MAIN',
      price: 8.5,
      mealDate: dayOffset(0),
      ingredients: 'chicken, brown rice, broccoli, olive oil, lemon',
      nutrition: 'calories:620, protein:42g, carbs:58g, fat:18g',
      allergens: '',
      stockStatus: 'AVAILABLE',
    },
    {
      name: 'Vegan Lentil Curry',
      description: 'Slow-cooked red lentils with coconut milk, spinach and basmati rice.',
      category: 'VEGAN',
      price: 7.25,
      mealDate: dayOffset(0),
      ingredients: 'red lentils, coconut milk, curry powder, spinach, basmati rice',
      nutrition: 'calories:480, protein:19g, carbs:66g, fat:14g',
      allergens: '',
      stockStatus: 'AVAILABLE',
    },
    {
      name: 'Peanut Noodle Salad',
      description: 'Chilled wheat noodles tossed with peanut dressing, cabbage and sesame.',
      category: 'SALAD',
      price: 6.75,
      mealDate: dayOffset(1),
      ingredients: 'wheat noodles, peanuts, soy sauce, sesame oil, cabbage, carrot',
      nutrition: 'calories:540, protein:17g, carbs:62g, fat:24g',
      allergens: 'peanuts, soy, gluten',
      stockStatus: 'AVAILABLE',
    },
    {
      name: 'Margherita Pizza',
      description: 'Stone-baked pizza with tomato sauce, mozzarella and fresh basil.',
      category: 'MAIN',
      price: 7.0,
      mealDate: dayOffset(1),
      ingredients: 'wheat flour, tomato, mozzarella, basil, olive oil',
      nutrition: 'calories:710, protein:28g, carbs:88g, fat:26g',
      allergens: 'gluten, dairy',
      stockStatus: 'AVAILABLE',
    },
    {
      name: 'Greek Yogurt Parfait',
      description: 'Layered Greek yogurt with honey, granola and seasonal berries.',
      category: 'BREAKFAST',
      price: 4.5,
      mealDate: dayOffset(2),
      ingredients: 'greek yogurt, honey, granola, mixed berries',
      nutrition: 'calories:320, protein:16g, carbs:44g, fat:9g',
      allergens: 'dairy, gluten',
      stockStatus: 'AVAILABLE',
    },
    {
      name: 'Spiced Chickpea Wrap',
      description: 'Roasted chickpeas, tahini and lettuce wrapped in a soft tortilla.',
      category: 'VEGETARIAN',
      price: 6.25,
      mealDate: dayOffset(2),
      ingredients: 'chickpeas, tortilla, tahini, lettuce, tomato',
      nutrition: 'calories:450, protein:15g, carbs:58g, fat:17g',
      allergens: 'sesame, gluten',
      stockStatus: 'AVAILABLE',
    },
    {
      name: 'Miso Glazed Salmon',
      description: 'Miso-glazed salmon fillet with steamed jasmine rice and greens.',
      category: 'MAIN',
      price: 11.5,
      mealDate: dayOffset(3),
      ingredients: 'salmon, miso, jasmine rice, bok choy, ginger',
      nutrition: 'calories:590, protein:38g, carbs:52g, fat:22g',
      allergens: 'fish, soy',
      stockStatus: 'OUT_OF_STOCK',
    },
  ];

  for (const meal of meals) {
    await pool.query(
      `INSERT INTO meals(id, name, description, category, price, meal_date,
                         ingredients, nutrition, allergens, stock_status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        uuid('meal'),
        meal.name,
        meal.description,
        meal.category,
        meal.price,
        meal.mealDate,
        meal.ingredients,
        meal.nutrition,
        meal.allergens,
        meal.stockStatus,
      ],
    );
  }

  const preferences = [
    ['usr_demo_student', 'vegetarian', 'peanuts, dairy'],
    ['usr_member_alex', 'vegan', 'gluten'],
    ['usr_member_priya', '', 'shellfish, peanuts'],
  ];

  for (const [userId, restrictions, allergies] of preferences) {
    await pool.query(
      `INSERT INTO dietary_preferences(id, user_id, restrictions, allergies)
       VALUES($1,$2,$3,$4)`,
      [uuid('diet'), userId, restrictions || null, allergies || null],
    );
  }
}
