import express from 'express';
import {
  HttpError,
  asyncHandler,
  authenticate,
  badRequest,
  cleanString,
  cors,
  createClient,
  csv,
  errorHandler,
  forbidden,
  healthRoutes,
  iso,
  notFound,
  parseDate,
  requireFields,
  requireService,
  toBool,
  uuid,
} from './common.js';

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

function mapNotification(row) {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    type: row.type,
    title: row.title,
    body: row.body,
    read: Boolean(row.is_read),
    createdAt: iso(row.created_at),
  };
}

function mapTicket(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    subject: row.subject,
    description: row.description,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.author_id,
    authorRole: row.author_role,
    body: row.body,
    createdAt: iso(row.created_at),
  };
}

function mapAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  };
}

async function findNotification(pool, id) {
  const { rows } = await pool.query('SELECT * FROM notifications WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findTicket(pool, id) {
  const { rows } = await pool.query('SELECT * FROM tickets WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findTicketMessages(pool, ticketId) {
  const { rows } = await pool.query(
    'SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
    [ticketId],
  );
  return rows.map(mapMessage);
}

async function canAccessTicket(ticket, user) {
  return ticket.student_id === user.sub || user.role === 'ADMIN';
}

function ownershipAllowed(ownerId, user) {
  return ownerId === user.sub || user.role === 'ADMIN';
}

async function insertNotification(pool, { recipientId, type, title, body }) {
  const id = uuid('ntf');
  await pool.query(
    `INSERT INTO notifications(id, recipient_id, type, title, body, is_read)
     VALUES($1,$2,$3,$4,$5,false)`,
    [id, recipientId, type, title, body],
  );
  return mapNotification(await findNotification(pool, id));
}

async function readSemesterSetting(pool) {
  const { rows } = await pool.query('SELECT * FROM settings WHERE setting_key = $1', ['semester']);
  const row = rows[0];
  if (!row) return { startDate: null, endDate: null, updatedAt: null };
  let parsed = {};
  try {
    parsed = JSON.parse(row.setting_value);
  } catch {
    parsed = {};
  }
  return {
    startDate: parsed.startDate || null,
    endDate: parsed.endDate || null,
    updatedAt: iso(row.updated_at),
  };
}

export function createApp({ pool, config, fetchImpl = fetch }) {
  const app = express();
  const http = createClient(config, fetchImpl);
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json({ limit: '1mb' }));

  healthRoutes(app, pool, 'communication-service', {
    ...(config.userServiceUrl ? { user: config.userServiceUrl } : {}),
    ...(config.accommodationServiceUrl ? { accommodation: config.accommodationServiceUrl } : {}),
    ...(config.transportServiceUrl ? { transport: config.transportServiceUrl } : {}),
    ...(config.clubServiceUrl ? { club: config.clubServiceUrl } : {}),
    ...(config.diningServiceUrl ? { dining: config.diningServiceUrl } : {}),
    ...(config.libraryServiceUrl ? { library: config.libraryServiceUrl } : {}),
    ...(config.paymentServiceUrl ? { payment: config.paymentServiceUrl } : {}),
  });

  const auth = authenticate(config.authSecret);
  const admin = authenticate(config.authSecret, { roles: ['ADMIN'] });
  const service = requireService(config.serviceToken);

  // FR19 Notifications -------------------------------------------------------

  app.get(
    '/api/notifications',
    auth,
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query(
        'SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC',
        [req.user.sub],
      );
      const unreadOnly = toBool(req.query.unread, false);
      const items = rows.map(mapNotification).filter((item) => !unreadOnly || !item.read);
      res.json({ items });
    }),
  );

  app.patch(
    '/api/notifications/:id/read',
    auth,
    asyncHandler(async (req, res) => {
      const notification = await findNotification(pool, req.params.id);
      if (!notification) throw notFound('Notification not found');
      if (!ownershipAllowed(notification.recipient_id, req.user)) throw forbidden();
      await pool.query('UPDATE notifications SET is_read = true WHERE id = $1', [notification.id]);
      res.json({ notification: mapNotification(await findNotification(pool, notification.id)) });
    }),
  );

  // FR19.2 / FR20 Admin notifications (single recipient or broadcast)
  app.post(
    '/api/admin/notifications',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['title', 'body']);
      const broadcast = toBool(body.all, false);
      const recipientId = cleanString(body.recipientId, 120);
      if (!broadcast && !recipientId) {
        throw badRequest('recipientId is required unless all is true');
      }
      const type = cleanString(body.type, 60) || 'GENERAL';
      const title = cleanString(body.title, 200);
      const messageBody = cleanString(body.body, 4000);

      const recipients = [];
      if (broadcast) {
        if (!config.userServiceUrl) throw badRequest('User service is not configured');
        let result;
        try {
          result = await http.request(config.userServiceUrl, '/api/internal/users', {
            service: true,
          });
        } catch {
          throw new HttpError(502, 'Unable to load recipients');
        }
        for (const user of result?.items || []) {
          if (user?.id) recipients.push(user.id);
        }
      } else {
        recipients.push(recipientId);
      }

      const items = [];
      for (const id of recipients) {
        items.push(
          await insertNotification(pool, {
            recipientId: id,
            type,
            title,
            body: messageBody,
          }),
        );
      }
      res.status(201).json({ notification: items[0] || null, items, count: items.length });
    }),
  );

  app.post(
    '/api/internal/notifications',
    service,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['recipientId', 'title', 'body']);
      const notification = await insertNotification(pool, {
        recipientId: cleanString(body.recipientId, 120),
        type: cleanString(body.type, 60) || 'GENERAL',
        title: cleanString(body.title, 200),
        body: cleanString(body.body, 4000),
      });
      res.status(201).json({ notification });
    }),
  );

  // FR20 Support tickets -----------------------------------------------------

  app.post(
    '/api/tickets',
    auth,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['subject', 'description']);
      const id = uuid('tkt');
      await pool.query(
        `INSERT INTO tickets(id, student_id, subject, description, status)
         VALUES($1,$2,$3,$4,'OPEN')`,
        [id, req.user.sub, cleanString(body.subject, 200), cleanString(body.description, 4000)],
      );
      const ticket = await findTicket(pool, id);
      res.status(201).json({ ticket: mapTicket(ticket) });
    }),
  );

  app.get(
    '/api/tickets',
    auth,
    asyncHandler(async (req, res) => {
      const showAll = req.user.role === 'ADMIN' && toBool(req.query.all, false);
      const { rows } = showAll
        ? await pool.query('SELECT * FROM tickets ORDER BY created_at DESC')
        : await pool.query(
            'SELECT * FROM tickets WHERE student_id = $1 ORDER BY created_at DESC',
            [req.user.sub],
          );
      res.json({ items: rows.map(mapTicket) });
    }),
  );

  app.get(
    '/api/tickets/:id',
    auth,
    asyncHandler(async (req, res) => {
      const ticket = await findTicket(pool, req.params.id);
      if (!ticket) throw notFound('Ticket not found');
      if (!(await canAccessTicket(ticket, req.user))) throw forbidden();      const messages = await findTicketMessages(pool, ticket.id);
      res.json({ ticket: { ...mapTicket(ticket), messages }, messages });
    }),
  );

  app.post(
    '/api/admin/tickets/:id/respond',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['body']);
      const ticket = await findTicket(pool, req.params.id);
      if (!ticket) throw notFound('Ticket not found');
      let status = cleanString(body.status, 30);
      if (status) {
        status = status.toUpperCase();
        if (!['IN_PROGRESS', 'RESOLVED'].includes(status)) {
          throw badRequest('status must be IN_PROGRESS or RESOLVED');
        }
      } else {
        status = ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status;
      }
      const messageId = uuid('msg');
      await pool.query(
        `INSERT INTO ticket_messages(id, ticket_id, author_id, author_role, body)
         VALUES($1,$2,$3,'ADMIN',$4)`,
        [messageId, ticket.id, req.user.sub, cleanString(body.body, 4000)],
      );
      await pool.query('UPDATE tickets SET status = $1, updated_at = now() WHERE id = $2', [
        status,
        ticket.id,
      ]);
      const updated = await findTicket(pool, ticket.id);
      const messages = await findTicketMessages(pool, ticket.id);
      const message = messages.find((item) => item.id === messageId) || null;
      res.json({ ticket: { ...mapTicket(updated), messages }, message, messages });
    }),
  );

  app.patch(
    '/api/admin/tickets/:id/status',
    admin,
    asyncHandler(async (req, res) => {
      const status = String(req.body?.status || '').toUpperCase();
      if (!TICKET_STATUSES.includes(status)) throw badRequest('Invalid ticket status');
      const ticket = await findTicket(pool, req.params.id);
      if (!ticket) throw notFound('Ticket not found');
      await pool.query('UPDATE tickets SET status = $1, updated_at = now() WHERE id = $2', [
        status,
        ticket.id,
      ]);
      res.json({ ticket: mapTicket(await findTicket(pool, ticket.id)) });
    }),
  );

  // FR21 Analytics and reports ----------------------------------------------

  app.get(
    '/api/admin/analytics/summary',
    admin,
    asyncHandler(async (_req, res) => {
      const notificationCount = await scalar(pool, 'SELECT COUNT(*) AS value FROM notifications');
      const unreadCount = await scalar(
        pool,
        'SELECT COUNT(*) AS value FROM notifications WHERE is_read = false',
      );
      const ticketCount = await scalar(pool, 'SELECT COUNT(*) AS value FROM tickets');
      const openTickets = await scalar(
        pool,
        `SELECT COUNT(*) AS value FROM tickets WHERE status = 'OPEN' OR status = 'IN_PROGRESS'`,
      );
      const announcementCount = await scalar(
        pool,
        'SELECT COUNT(*) AS value FROM announcements',
      );

      const sources = [
        ['accommodation', config.accommodationServiceUrl],
        ['transport', config.transportServiceUrl],
        ['clubs', config.clubServiceUrl],
        ['dining', config.diningServiceUrl],
        ['library', config.libraryServiceUrl],
        ['payment', config.paymentServiceUrl],
      ];
      const peerEntries = await Promise.all(
        sources.map(async ([name, baseUrl]) => {
          if (!baseUrl) return [name, null];
          try {
            const stats = await http.request(baseUrl, '/api/internal/stats', { service: true });
            return [name, stats];
          } catch {
            return [name, null];
          }
        }),
      );
      const peers = Object.fromEntries(peerEntries);
      const summary = {
        notifications: notificationCount,
        unreadNotifications: unreadCount,
        tickets: ticketCount,
        openTickets,
        announcements: announcementCount,
        peers,
      };
      res.json({ ...summary, summary });
    }),
  );

  // FR21.2 CSV report from club-service
  app.get(
    '/api/admin/reports/clubs',
    admin,
    asyncHandler(async (_req, res) => {
      if (!config.clubServiceUrl) throw badRequest('Club service is not configured');
      let result;
      try {
        result = await http.request(
          config.clubServiceUrl,
          '/api/internal/report?type=clubs',
          { service: true },
        );
      } catch {
        throw new HttpError(502, 'Unable to load club report');
      }
      const items = Array.isArray(result?.items) ? result.items : [];
      const preferred = [
        'id',
        'name',
        'category',
        'status',
        'members',
        'membersCount',
        'events',
        'eventsCount',
        'createdAt',
      ];
      const columns = preferred.filter((column) =>
        items.some((item) => item && item[column] !== undefined),
      );
      if (!columns.length) columns.push('id', 'name', 'status');
      const body = csv(items, columns);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="clubs-report.csv"');
      res.send(body);
    }),
  );

  // FR22 Announcements and semester settings --------------------------------

  app.get(
    '/api/announcements',
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(
        'SELECT * FROM announcements ORDER BY created_at DESC',
      );
      res.json({ items: rows.map(mapAnnouncement) });
    }),
  );

  app.post(
    '/api/admin/announcements',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['title', 'body']);
      const id = uuid('ann');
      await pool.query(
        'INSERT INTO announcements(id, title, body, created_by) VALUES($1,$2,$3,$4)',
        [
          id,
          cleanString(body.title, 200),
          cleanString(body.body, 4000),
          req.user.sub,
        ],
      );
      const { rows } = await pool.query('SELECT * FROM announcements WHERE id = $1', [id]);
      res.status(201).json({ announcement: mapAnnouncement(rows[0]) });
    }),
  );

  app.get(
    '/api/settings/semester',
    asyncHandler(async (_req, res) => {
      const semester = await readSemesterSetting(pool);
      res.json({
        settings: semester,
        semester,
        startDate: semester.startDate,
        endDate: semester.endDate,
      });
    }),
  );

  app.put(
    '/api/admin/settings/semester',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['startDate', 'endDate']);
      const start = parseDate(body.startDate, 'startDate');
      const end = parseDate(body.endDate, 'endDate');
      if (start >= end) throw badRequest('startDate must be before endDate');
      const value = JSON.stringify({
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      });
      const { rows } = await pool.query(
        'SELECT * FROM settings WHERE setting_key = $1',
        ['semester'],
      );
      if (rows[0]) {
        await pool.query(
          'UPDATE settings SET setting_value = $1, updated_at = now() WHERE setting_key = $2',
          [value, 'semester'],
        );
      } else {
        await pool.query(
          'INSERT INTO settings(setting_key, setting_value) VALUES($1,$2)',
          ['semester', value],
        );
      }
      const semester = await readSemesterSetting(pool);
      res.json({
        settings: semester,
        semester,
        startDate: semester.startDate,
        endDate: semester.endDate,
      });
    }),
  );

  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}

async function scalar(pool, sql) {
  const { rows } = await pool.query(sql);
  return Number(rows[0]?.value ?? 0);
}

export async function ensureSeedData(pool) {
  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM notifications');
  if (Number(rows[0]?.count) > 0) return;

  const studentId = 'usr_demo_student';
  const now = Date.now();

  await pool.query(
    `INSERT INTO settings(setting_key, setting_value) VALUES($1,$2)`,
    ['semester', JSON.stringify({ startDate: '2026-09-01', endDate: '2027-01-15' })],
  );

  const notifications = [
    [
      uuid('ntf'),
      studentId,
      'WELCOME',
      'Welcome to Student Services',
      'Your campus account is ready. Explore library, dining and club services.',
      false,
      new Date(now - 3 * 86400000),
    ],
    [
      uuid('ntf'),
      studentId,
      'PAYMENT',
      'Payment received',
      'Your accommodation deposit payment was received. Your receipt is available.',
      true,
      new Date(now - 2 * 86400000),
    ],
  ];
  for (const row of notifications) {
    await pool.query(
      `INSERT INTO notifications(id, recipient_id, type, title, body, is_read, created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      row,
    );
  }

  const announcements = [
    [
      uuid('ann'),
      'Library extended hours',
      'The main library stays open until 23:00 during the exam period.',
      'usr_demo_admin',
      new Date(now - 86400000),
    ],
    [
      uuid('ann'),
      'Semester registration',
      'Course registration closes at the end of the second week of the semester.',
      'usr_demo_admin',
      new Date(now - 4 * 86400000),
    ],
  ];
  for (const row of announcements) {
    await pool.query(
      'INSERT INTO announcements(id, title, body, created_by, created_at) VALUES($1,$2,$3,$4,$5)',
      row,
    );
  }

  const ticketId = uuid('tkt');
  await pool.query(
    `INSERT INTO tickets(id, student_id, subject, description, status, created_at, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$6)`,
    [
      ticketId,
      studentId,
      'Cannot access digital library',
      'Opening a digital book returns an error page.',
      'RESOLVED',
      new Date(now - 5 * 86400000),
    ],
  );
  await pool.query(
    `INSERT INTO ticket_messages(id, ticket_id, author_id, author_role, body, created_at)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      uuid('msg'),
      ticketId,
      studentId,
      'STUDENT',
      'Opening a digital book returns an error page.',
      new Date(now - 5 * 86400000),
    ],
  );
  await pool.query(
    `INSERT INTO ticket_messages(id, ticket_id, author_id, author_role, body, created_at)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      uuid('msg'),
      ticketId,
      'usr_demo_admin',
      'ADMIN',
      'The digital library link was refreshed. Please try again.',
      new Date(now - 4 * 86400000),
    ],
  );
}
