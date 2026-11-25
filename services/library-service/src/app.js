import express from 'express';
import {
  asyncHandler,
  authenticate,
  badRequest,
  cleanString,
  conflict,
  cors,
  errorHandler,
  forbidden,
  healthRoutes,
  iso,
  notFound,
  requireFields,
  requireService,
  toInt,
  uuid,
} from './common.js';

const RESOURCE_TYPES = ['PRINTED_BOOK', 'DIGITAL'];

function mapResource(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    type: row.type,
    subject: row.subject,
    isbn: row.isbn,
    url: row.url,
    copiesTotal: Number(row.copies_total),
    copiesAvailable: Number(row.copies_available),
    available: Number(row.copies_available) > 0,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapReservation(row, resourceTitle = null) {
  return {
    id: row.id,
    resourceId: row.resource_id,
    resourceTitle: row.resource_title ?? resourceTitle,
    studentId: row.student_id,
    status: row.status,
    reservedAt: iso(row.reserved_at),
    dueDate: iso(row.due_date),
    collectedAt: iso(row.collected_at),
    returnedAt: iso(row.returned_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapDownload(row, resourceTitle = null) {
  return {
    id: row.id,
    resourceId: row.resource_id,
    resourceTitle: row.resource_title ?? resourceTitle,
    studentId: row.student_id,
    createdAt: iso(row.created_at),
  };
}

async function findResource(pool, id) {
  const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findReservation(pool, id) {
  const { rows } = await pool.query('SELECT * FROM reservations WHERE id = $1', [id]);
  return rows[0] || null;
}

async function resourceTitleMap(pool) {
  const { rows } = await pool.query('SELECT id, title FROM resources');
  return new Map(rows.map((row) => [row.id, row.title]));
}

function ownsReservation(reservation, user) {
  return reservation.student_id === user.sub || user.role === 'ADMIN';
}

async function setCopyCount(pool, resource, available) {
  const next = Math.max(0, Math.min(Number(resource.copies_total), available));
  await pool.query(
    'UPDATE resources SET copies_available = $1, updated_at = now() WHERE id = $2',
    [next, resource.id],
  );
}

function parseResourceType(value, fallback = null) {
  const type = (cleanString(value, 40) || fallback || '').toUpperCase();
  if (!RESOURCE_TYPES.includes(type)) {
    throw badRequest('Invalid resource type; expected PRINTED_BOOK or DIGITAL');
  }
  return type;
}

export function createApp({ pool, config, fetchImpl = fetch }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json({ limit: '1mb' }));

  healthRoutes(app, pool, 'library-service', {
    ...(config.userServiceUrl ? { user: config.userServiceUrl } : {}),
    ...(config.paymentServiceUrl ? { payment: config.paymentServiceUrl } : {}),
    ...(config.communicationServiceUrl ? { communication: config.communicationServiceUrl } : {}),
  });

  const auth = authenticate(config.authSecret);
  const admin = authenticate(config.authSecret, { roles: ['ADMIN'] });
  const service = requireService(config.serviceToken);

  // FR23.1 Public catalogue -------------------------------------------------

  app.get(
    '/api/resources',
    asyncHandler(async (req, res) => {
      const q = (cleanString(req.query.q, 200) || '').toLowerCase();
      const type = cleanString(req.query.type, 40);
      const subject = cleanString(req.query.subject, 120);
      if (type && !RESOURCE_TYPES.includes(type.toUpperCase())) {
        throw badRequest('Invalid resource type; expected PRINTED_BOOK or DIGITAL');
      }
      const { rows } = await pool.query('SELECT * FROM resources ORDER BY title ASC');
      let items = rows.map(mapResource);
      if (q) {
        items = items.filter((item) =>
          [item.title, item.author, item.subject, item.isbn]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(q)),
        );
      }
      if (type) {
        const wanted = type.toUpperCase();
        items = items.filter((item) => item.type === wanted);
      }
      if (subject) {
        const wanted = subject.toLowerCase();
        items = items.filter(
          (item) => String(item.subject || '').toLowerCase() === wanted,
        );
      }
      res.json({ items });
    }),
  );

  app.get(
    '/api/resources/:id',
    asyncHandler(async (req, res) => {
      const resource = await findResource(pool, req.params.id);
      if (!resource) throw notFound('Resource not found');
      res.json({ resource: mapResource(resource) });
    }),
  );

  // FR23.2 Access a resource ------------------------------------------------

  app.post(
    '/api/resources/:id/access',
    auth,
    asyncHandler(async (req, res) => {
      const resource = await findResource(pool, req.params.id);
      if (!resource) throw notFound('Resource not found');

      if (resource.type === 'DIGITAL') {
        const id = uuid('dwn');
        await pool.query(
          'INSERT INTO downloads(id, resource_id, student_id) VALUES($1,$2,$3)',
          [id, resource.id, req.user.sub],
        );
        const { rows } = await pool.query('SELECT * FROM downloads WHERE id = $1', [id]);
        return res.status(201).json({
          accessType: 'DIGITAL',
          download: mapDownload(rows[0], resource.title),
          resource: mapResource(resource),
        });
      }

      if (Number(resource.copies_available) <= 0) {
        throw conflict('No copies of this resource are currently available');
      }
      const dueDate = new Date(Date.now() + 14 * 86400000);
      const id = uuid('res');
      await pool.query(
        `INSERT INTO reservations(id, resource_id, student_id, status, due_date)
         VALUES($1,$2,$3,'RESERVED',$4)`,
        [id, resource.id, req.user.sub, dueDate],
      );
      await setCopyCount(pool, resource, Number(resource.copies_available) - 1);
      const reservation = await findReservation(pool, id);
      const updated = await findResource(pool, resource.id);
      return res.status(201).json({
        accessType: 'PRINTED_BOOK',
        reservation: mapReservation(reservation, resource.title),
        resource: mapResource(updated),
      });
    }),
  );

  // FR23.3 Reservations -----------------------------------------------------

  app.get(
    '/api/reservations',
    auth,
    asyncHandler(async (req, res) => {
      const showAll = req.user.role === 'ADMIN' && req.query.all === 'true';
      const { rows } = showAll
        ? await pool.query('SELECT * FROM reservations ORDER BY created_at DESC')
        : await pool.query(
            'SELECT * FROM reservations WHERE student_id = $1 ORDER BY created_at DESC',
            [req.user.sub],
          );
      const titles = await resourceTitleMap(pool);
      res.json({
        items: rows.map((row) => mapReservation(row, titles.get(row.resource_id) || null)),
      });
    }),
  );

  async function loadOwnedReservation(req) {
    const reservation = await findReservation(pool, req.params.id);
    if (!reservation) throw notFound('Reservation not found');
    if (!ownsReservation(reservation, req.user)) throw forbidden();
    return reservation;
  }

  app.post(
    '/api/reservations/:id/collect',
    auth,
    asyncHandler(async (req, res) => {
      const reservation = await loadOwnedReservation(req);
      if (reservation.status !== 'RESERVED') {
        throw badRequest(`Cannot collect a reservation with status ${reservation.status}`);
      }
      await pool.query(
        `UPDATE reservations
         SET status = 'COLLECTED', collected_at = now(), updated_at = now()
         WHERE id = $1`,
        [reservation.id],
      );
      const updated = await findReservation(pool, reservation.id);
      const resource = await findResource(pool, reservation.resource_id);
      res.json({
        reservation: mapReservation(updated, resource?.title || null),
        resource: resource ? mapResource(resource) : null,
      });
    }),
  );

  app.post(
    '/api/reservations/:id/cancel',
    auth,
    asyncHandler(async (req, res) => {
      const reservation = await loadOwnedReservation(req);
      if (reservation.status !== 'RESERVED') {
        throw badRequest(`Cannot cancel a reservation with status ${reservation.status}`);
      }
      await pool.query(
        `UPDATE reservations
         SET status = 'CANCELLED', updated_at = now()
         WHERE id = $1`,
        [reservation.id],
      );
      const resource = await findResource(pool, reservation.resource_id);
      if (resource) {
        await setCopyCount(pool, resource, Number(resource.copies_available) + 1);
      }
      const updated = await findReservation(pool, reservation.id);
      const refreshed = await findResource(pool, reservation.resource_id);
      res.json({
        reservation: mapReservation(updated, refreshed?.title || null),
        resource: refreshed ? mapResource(refreshed) : null,
      });
    }),
  );

  app.post(
    '/api/reservations/:id/return',
    auth,
    asyncHandler(async (req, res) => {
      const reservation = await loadOwnedReservation(req);
      if (reservation.status !== 'COLLECTED') {
        throw badRequest(`Cannot return a reservation with status ${reservation.status}`);
      }
      await pool.query(
        `UPDATE reservations
         SET status = 'RETURNED', returned_at = now(), updated_at = now()
         WHERE id = $1`,
        [reservation.id],
      );
      const resource = await findResource(pool, reservation.resource_id);
      if (resource) {
        await setCopyCount(pool, resource, Number(resource.copies_available) + 1);
      }
      const updated = await findReservation(pool, reservation.id);
      const refreshed = await findResource(pool, reservation.resource_id);
      res.json({
        reservation: mapReservation(updated, refreshed?.title || null),
        resource: refreshed ? mapResource(refreshed) : null,
      });
    }),
  );

  // FR23.4 Admin catalogue management --------------------------------------

  app.post(
    '/api/admin/resources',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['title', 'type']);
      const type = parseResourceType(body.type);
      const total = toInt(body.copiesTotal ?? body.copies_total, 1);
      if (total === null || total < 0) throw badRequest('copiesTotal must be zero or more');
      const id = uuid('lib');
      await pool.query(
        `INSERT INTO resources(
           id, title, author, description, type, subject, isbn, url,
           copies_total, copies_available
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          id,
          cleanString(body.title, 200),
          cleanString(body.author, 200),
          cleanString(body.description, 2000),
          type,
          cleanString(body.subject, 120),
          cleanString(body.isbn, 40),
          cleanString(body.url, 500),
          total,
        ],
      );
      const resource = await findResource(pool, id);
      res.status(201).json({ resource: mapResource(resource) });
    }),
  );

  app.patch(
    '/api/admin/resources/:id',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const resource = await findResource(pool, req.params.id);
      if (!resource) throw notFound('Resource not found');

      const title = body.title === undefined ? resource.title : cleanString(body.title, 200);
      if (!title) throw badRequest('Title cannot be empty');
      const type =
        body.type === undefined ? resource.type : parseResourceType(body.type);
      const author =
        body.author === undefined ? resource.author : cleanString(body.author, 200);
      const description =
        body.description === undefined
          ? resource.description
          : cleanString(body.description, 2000);
      const subject =
        body.subject === undefined ? resource.subject : cleanString(body.subject, 120);
      const isbn = body.isbn === undefined ? resource.isbn : cleanString(body.isbn, 40);
      const url = body.url === undefined ? resource.url : cleanString(body.url, 500);

      let total = Number(resource.copies_total);
      let available = Number(resource.copies_available);
      if (body.copiesTotal !== undefined || body.copies_total !== undefined) {
        const requested = toInt(body.copiesTotal ?? body.copies_total, total);
        if (requested === null || requested < 0) {
          throw badRequest('copiesTotal must be zero or more');
        }
        available = Math.max(0, Math.min(requested, available + (requested - total)));
        total = requested;
      }

      await pool.query(
        `UPDATE resources
         SET title = $1, author = $2, description = $3, type = $4, subject = $5,
             isbn = $6, url = $7, copies_total = $8, copies_available = $9,
             updated_at = now()
         WHERE id = $10`,
        [title, author, description, type, subject, isbn, url, total, available, resource.id],
      );
      const updated = await findResource(pool, resource.id);
      res.json({ resource: mapResource(updated) });
    }),
  );

  app.delete(
    '/api/admin/resources/:id',
    admin,
    asyncHandler(async (req, res) => {
      const resource = await findResource(pool, req.params.id);
      if (!resource) throw notFound('Resource not found');
      await pool.query('DELETE FROM downloads WHERE resource_id = $1', [resource.id]);
      await pool.query('DELETE FROM reservations WHERE resource_id = $1', [resource.id]);
      await pool.query('DELETE FROM resources WHERE id = $1', [resource.id]);
      res.json({ deleted: true, id: resource.id });
    }),
  );

  // Cross-service activity and statistics ----------------------------------

  app.get(
    '/api/internal/activity',
    service,
    asyncHandler(async (req, res) => {
      const studentId = cleanString(req.query.studentId, 120);
      if (!studentId) throw badRequest('studentId is required');
      const { rows: reservations } = await pool.query(
        'SELECT * FROM reservations WHERE student_id = $1 ORDER BY created_at DESC',
        [studentId],
      );
      const { rows: downloads } = await pool.query(
        'SELECT * FROM downloads WHERE student_id = $1 ORDER BY created_at DESC',
        [studentId],
      );
      const titles = await resourceTitleMap(pool);
      const items = [
        ...reservations.map((row) => ({
          type: 'LIBRARY_RESERVATION',
          id: row.id,
          title: titles.get(row.resource_id) || 'Library resource',
          status: row.status,
          date: iso(row.created_at),
        })),
        ...downloads.map((row) => ({
          type: 'LIBRARY_DOWNLOAD',
          id: row.id,
          title: titles.get(row.resource_id) || 'Digital resource',
          status: 'COMPLETED',
          date: iso(row.created_at),
        })),
      ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      res.json({ items });
    }),
  );

  app.get(
    '/api/internal/stats',
    service,
    asyncHandler(async (_req, res) => {
      const resources = await count(pool, 'SELECT COUNT(*) AS value FROM resources');
      const reservations = await count(pool, 'SELECT COUNT(*) AS value FROM reservations');
      const downloads = await count(pool, 'SELECT COUNT(*) AS value FROM downloads');
      const activeReservations = await count(
        pool,
        `SELECT COUNT(*) AS value FROM reservations WHERE status = 'RESERVED' OR status = 'COLLECTED'`,
      );
      res.json({ resources, reservations, downloads, activeReservations });
    }),
  );

  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}

async function count(pool, sql) {
  const { rows } = await pool.query(sql);
  return Number(rows[0]?.value ?? 0);
}

export async function ensureSeedData(pool) {
  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM resources');
  if (Number(rows[0]?.count) > 0) return;

  const now = Date.now();
  const printedAlgorithms = uuid('lib');
  const printedCleanCode = uuid('lib');
  const printedHistory = uuid('lib');
  const digitalNode = uuid('lib');
  const digitalCalculus = uuid('lib');

  const resources = [
    [
      printedAlgorithms,
      'Introduction to Algorithms',
      'Thomas H. Cormen',
      'A comprehensive reference on algorithms and data structures.',
      'PRINTED_BOOK',
      'Computer Science',
      '978-0262046305',
      null,
      3,
      2,
    ],
    [
      printedCleanCode,
      'Clean Code',
      'Robert C. Martin',
      'Practical advice for writing readable and maintainable software.',
      'PRINTED_BOOK',
      'Computer Science',
      '978-0132350884',
      null,
      2,
      2,
    ],
    [
      printedHistory,
      'A Short History of the World',
      'H. G. Wells',
      'A concise survey of world history.',
      'PRINTED_BOOK',
      'History',
      '978-0141441825',
      null,
      1,
      1,
    ],
    [
      digitalNode,
      'Node.js Design Patterns',
      'Mario Casciaro',
      'Patterns and best practices for building Node.js applications.',
      'DIGITAL',
      'Computer Science',
      '978-1839214110',
      'https://library.example.edu/digital/nodejs-design-patterns.pdf',
      1,
      1,
    ],
    [
      digitalCalculus,
      'Calculus Made Easy',
      'Silvanus P. Thompson',
      'An approachable introduction to differential and integral calculus.',
      'DIGITAL',
      'Mathematics',
      '978-1684221050',
      'https://library.example.edu/digital/calculus-made-easy.pdf',
      1,
      1,
    ],
  ];
  for (const row of resources) {
    await pool.query(
      `INSERT INTO resources(
         id, title, author, description, type, subject, isbn, url,
         copies_total, copies_available
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      row,
    );
  }

  const studentId = 'usr_demo_student';
  const reservedId = uuid('res');
  await pool.query(
    `INSERT INTO reservations(
       id, resource_id, student_id, status, reserved_at, due_date, created_at, updated_at
     ) VALUES($1,$2,$3,'RESERVED',$4,$5,$4,$4)`,
    [reservedId, printedAlgorithms, studentId, new Date(now - 2 * 86400000), new Date(now + 12 * 86400000)],
  );

  const returnedAt = new Date(now - 10 * 86400000);
  await pool.query(
    `INSERT INTO reservations(
       id, resource_id, student_id, status, reserved_at, due_date,
       collected_at, returned_at, created_at, updated_at
     ) VALUES($1,$2,$3,'RETURNED',$4,$5,$6,$7,$4,$7)`,
    [
      uuid('res'),
      printedCleanCode,
      studentId,
      new Date(now - 22 * 86400000),
      new Date(now - 8 * 86400000),
      new Date(now - 20 * 86400000),
      returnedAt,
    ],
  );

  await pool.query(
    'INSERT INTO downloads(id, resource_id, student_id, created_at) VALUES($1,$2,$3,$4)',
    [uuid('dwn'), digitalNode, studentId, new Date(now - 86400000)],
  );
}
