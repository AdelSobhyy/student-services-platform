import express from 'express';
import {
  HttpError,
  asyncHandler,
  authenticate,
  badRequest,
  cleanString,
  conflict,
  cors,
  createClient,
  errorHandler,
  hashPassword,
  healthRoutes,
  isEmail,
  notFound,
  parseDate,
  requireFields,
  requireService,
  signToken,
  unauthorized,
  uuid,
  verifyPassword,
} from './common.js';

const ROLES = ['STUDENT', 'STAFF', 'CLUB_LEADER', 'ADMIN'];
const STATUS_TRANSITIONS = {
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE'],
};

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    clubId: row.club_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findUserByEmail(pool, email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
}

async function findUserById(pool, id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

export function createApp({ pool, config, fetchImpl = fetch }) {
  const app = express();
  const http = createClient(config, fetchImpl);
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json({ limit: '1mb' }));

  healthRoutes(app, pool, 'user-service', {
    ...(config.accommodationServiceUrl ? { accommodation: config.accommodationServiceUrl } : {}),
    ...(config.transportServiceUrl ? { transport: config.transportServiceUrl } : {}),
    ...(config.clubServiceUrl ? { club: config.clubServiceUrl } : {}),
    ...(config.diningServiceUrl ? { dining: config.diningServiceUrl } : {}),
    ...(config.communicationServiceUrl ? { communication: config.communicationServiceUrl } : {}),
    ...(config.libraryServiceUrl ? { library: config.libraryServiceUrl } : {}),
    ...(config.paymentServiceUrl ? { payment: config.paymentServiceUrl } : {}),
  });

  // FR1.1 Register Account
  app.post(
    '/api/auth/register',
    asyncHandler(async (req, res) => {
      const { name, email, password } = req.body || {};
      requireFields(req.body || {}, ['name', 'email', 'password']);
      if (!isEmail(email)) throw badRequest('A valid email address is required');
      if (password.length < 8) throw badRequest('Password must contain at least 8 characters');
      if (await findUserByEmail(pool, email)) {
        throw conflict('Email address is already registered');
      }
      const user = {
        id: uuid('usr'),
        name: cleanString(name, 120),
        email: String(email).trim().toLowerCase(),
        password_hash: hashPassword(password),
        role: 'STUDENT',
        status: 'ACTIVE',
        club_id: null,
      };
      await pool.query(
        `INSERT INTO users(id, name, email, password_hash, role, status, club_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [user.id, user.name, user.email, user.password_hash, user.role, user.status, user.club_id],
      );
      const token = signToken(user, config.authSecret);
      await http.notify({
        recipientId: user.id,
        type: 'ACCOUNT_CREATED',
        title: 'Welcome to Student Services',
        body: `Your account ${user.email} was created successfully.`,
      });
      res.status(201).json({ token, user: mapUser({ ...user, created_at: new Date() }) });
    }),
  );

  // FR1.2 Log In
  app.post(
    '/api/auth/login',
    asyncHandler(async (req, res) => {
      const { email, password } = req.body || {};
      requireFields(req.body || {}, ['email', 'password']);
      const user = await findUserByEmail(pool, email);
      if (!user || !verifyPassword(password, user.password_hash)) {
        throw unauthorized('Invalid email or password');
      }
      if (user.status === 'SUSPENDED') throw new HttpError(403, 'Account is suspended');
      if (user.status === 'DEACTIVATED') throw new HttpError(403, 'Account is deactivated');
      const token = signToken(user, config.authSecret);
      res.json({ token, user: mapUser(user) });
    }),
  );

  // FR1.3 Recover Password
  app.post(
    '/api/auth/recover',
    asyncHandler(async (req, res) => {
      requireFields(req.body || {}, ['email']);
      const user = await findUserByEmail(pool, req.body.email);
      if (user) {
        const token = cryptoRandomToken();
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        await pool.query(
          'INSERT INTO recovery_tokens(token, user_id, expires_at, used) VALUES($1,$2,$3,false)',
          [token, user.id, expiresAt],
        );
        await http.notify({
          recipientId: user.id,
          type: 'PASSWORD_RECOVERY',
          title: 'Password recovery',
          body: `Use this recovery token to reset your password: ${token}`,
        });
        // The token is returned only so the demo UI can complete the flow without an email server.
        return res.json({
          message: 'If the account exists, a recovery message has been sent.',
          resetToken: token,
        });
      }
      return res.json({ message: 'If the account exists, a recovery message has been sent.' });
    }),
  );

  app.post(
    '/api/auth/reset',
    asyncHandler(async (req, res) => {
      requireFields(req.body || {}, ['token', 'password']);
      if (req.body.password.length < 8) {
        throw badRequest('Password must contain at least 8 characters');
      }
      const { rows } = await pool.query('SELECT * FROM recovery_tokens WHERE token = $1', [
        req.body.token,
      ]);
      const record = rows[0];
      if (!record || record.used || parseDate(record.expires_at, 'token expiry') < new Date()) {
        throw badRequest('Recovery token is invalid or expired');
      }
      await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
        hashPassword(req.body.password),
        record.user_id,
      ]);
      await pool.query('UPDATE recovery_tokens SET used = true WHERE token = $1', [
        req.body.token,
      ]);
      res.json({ message: 'Password updated successfully' });
    }),
  );

  const auth = authenticate(config.authSecret);

  // FR2.1 Update Profile
  app.get(
    '/api/users/me',
    auth,
    asyncHandler(async (req, res) => {
      const user = await findUserById(pool, req.user.sub);
      if (!user) throw notFound('User not found');
      res.json({ user: mapUser(user) });
    }),
  );

  app.patch(
    '/api/users/me',
    auth,
    asyncHandler(async (req, res) => {
      const user = await findUserById(pool, req.user.sub);
      if (!user) throw notFound('User not found');
      const name = req.body?.name === undefined ? user.name : cleanString(req.body.name, 120);
      const email = req.body?.email === undefined ? user.email : String(req.body.email).trim().toLowerCase();
      if (!name) throw badRequest('Name cannot be empty');
      if (!isEmail(email)) throw badRequest('A valid email address is required');
      const existing = await findUserByEmail(pool, email);
      if (existing && existing.id !== user.id) throw conflict('Email address is already registered');
      await pool.query('UPDATE users SET name = $1, email = $2, updated_at = now() WHERE id = $3', [
        name,
        email,
        user.id,
      ]);
      const updated = await findUserById(pool, user.id);
      res.json({ user: mapUser(updated) });
    }),
  );

  // FR2.2 View Activity History
  app.get(
    '/api/users/me/activity',
    auth,
    asyncHandler(async (req, res) => {
      const sources = [
        ['accommodation', config.accommodationServiceUrl],
        ['transport', config.transportServiceUrl],
        ['clubs', config.clubServiceUrl],
        ['dining', config.diningServiceUrl],
        ['library', config.libraryServiceUrl],
        ['payments', config.paymentServiceUrl],
      ];
      const groups = await Promise.all(
        sources.map(async ([source, baseUrl]) => {
          const items = await http.activity(baseUrl, req.user.sub);
          return items.map((item) => ({ ...item, source }));
        }),
      );
      const items = groups
        .flat()
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      res.json({ items });
    }),
  );

  const admin = authenticate(config.authSecret, { roles: ['ADMIN'] });

  // FR3.1 Assign Roles and create staff accounts
  app.get(
    '/api/admin/users',
    admin,
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
      res.json({ items: rows.map(mapUser) });
    }),
  );

  app.post(
    '/api/admin/users',
    admin,
    asyncHandler(async (req, res) => {
      const { name, email, password, role = 'STAFF', clubId = null } = req.body || {};
      requireFields(req.body || {}, ['name', 'email', 'password']);
      if (!isEmail(email)) throw badRequest('A valid email address is required');
      if (!ROLES.includes(role)) throw badRequest('Invalid role');
      if (role === 'CLUB_LEADER' && !clubId) throw badRequest('clubId is required for CLUB_LEADER');
      if (await findUserByEmail(pool, email)) throw conflict('Email address is already registered');
      const user = {
        id: uuid('usr'),
        name: cleanString(name, 120),
        email: String(email).trim().toLowerCase(),
        password_hash: hashPassword(password),
        role,
        status: 'ACTIVE',
        club_id: clubId,
      };
      await pool.query(
        `INSERT INTO users(id, name, email, password_hash, role, status, club_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [user.id, user.name, user.email, user.password_hash, user.role, user.status, user.club_id],
      );
      const created = await findUserById(pool, user.id);
      res.status(201).json({ user: mapUser(created) });
    }),
  );

  app.patch(
    '/api/admin/users/:id/role',
    admin,
    asyncHandler(async (req, res) => {
      const { role, clubId = null } = req.body || {};
      if (!ROLES.includes(role)) throw badRequest('Invalid role');
      if (role === 'CLUB_LEADER' && !clubId) throw badRequest('clubId is required for CLUB_LEADER');
      const user = await findUserById(pool, req.params.id);
      if (!user) throw notFound('User not found');
      await pool.query('UPDATE users SET role = $1, club_id = $2, updated_at = now() WHERE id = $3', [
        role,
        role === 'CLUB_LEADER' ? clubId : null,
        user.id,
      ]);
      const updated = await findUserById(pool, user.id);
      res.json({ user: mapUser(updated) });
    }),
  );

  // FR3.2 Manage Account Status
  app.patch(
    '/api/admin/users/:id/status',
    admin,
    asyncHandler(async (req, res) => {
      const { status } = req.body || {};
      const user = await findUserById(pool, req.params.id);
      if (!user) throw notFound('User not found');
      if (!['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].includes(status)) {
        throw badRequest('Invalid account status');
      }
      if (!(STATUS_TRANSITIONS[user.status] || []).includes(status)) {
        throw badRequest(`Cannot change account status from ${user.status} to ${status}`);
      }
      await pool.query('UPDATE users SET status = $1, updated_at = now() WHERE id = $2', [
        status,
        user.id,
      ]);
      const updated = await findUserById(pool, user.id);
      res.json({ user: mapUser(updated) });
    }),
  );

  app.get(
    '/api/internal/users',
    requireService(config.serviceToken),
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
      res.json({ items: rows.map(mapUser) });
    }),
  );

  app.get(
    '/api/internal/users/:id',
    requireService(config.serviceToken),
    asyncHandler(async (req, res) => {
      const user = await findUserById(pool, req.params.id);
      if (!user) throw notFound('User not found');
      res.json({ user: mapUser(user) });
    }),
  );

  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}

function cryptoRandomToken() {
  return uuid('reset').replace('reset_', '') + uuid('').replace('_', '');
}

export async function ensureSeedData(pool) {
  const count = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (Number(count.rows[0]?.count) > 0) return;
  // Stable IDs keep seeded records consistent across every service so the demo
  // accounts own the bookings, memberships, preferences and notifications seeded
  // by their peer services.
  const seed = [
    ['usr_admin', 'Admin User', 'admin@campus.edu', 'Admin123!', 'ADMIN', null],
    ['usr_demo_student', 'Demo Student', 'student@campus.edu', 'Student123!', 'STUDENT', null],
    ['usr_club_leader', 'Club Leader', 'leader@campus.edu', 'Leader123!', 'CLUB_LEADER', 'club_robotics'],
    ['usr_staff', 'Staff Member', 'staff@campus.edu', 'Staff123!', 'STAFF', null],
  ];
  for (const [id, name, email, password, role, clubId] of seed) {
    await pool.query(
      `INSERT INTO users(id, name, email, password_hash, role, status, club_id)
       VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)`,
      [id, name, email, hashPassword(password), role, clubId],
    );
  }
}
