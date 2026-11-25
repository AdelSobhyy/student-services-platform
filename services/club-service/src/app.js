import express from 'express';
import {
  asyncHandler,
  authenticate,
  badRequest,
  cleanString,
  conflict,
  cors,
  createClient,
  errorHandler,
  forbidden,
  healthRoutes,
  iso,
  notFound,
  parseDate,
  requireFields,
  requireService,
  uuid,
} from './common.js';

const CLUB_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const MEMBERSHIP_STATUSES = ['ACTIVE', 'LEFT'];

function mapClub(row, memberCount) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    category: row.category,
    status: row.status,
    proposedBy: row.proposed_by || null,
    leaderId: row.leader_id || null,
    memberCount: memberCount === undefined ? undefined : Number(memberCount),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapMembership(row) {
  return {
    id: row.id,
    clubId: row.club_id,
    userId: row.user_id,
    status: row.status,
    joinedAt: iso(row.joined_at),
    leftAt: iso(row.left_at),
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    clubId: row.club_id,
    clubName: row.club_name || undefined,
    title: row.title,
    description: row.description || null,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    createdBy: row.created_by || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function findClub(pool, id) {
  const { rows } = await pool.query('SELECT * FROM clubs WHERE id = $1', [id]);
  return rows[0] || null;
}

async function requireClub(pool, id) {
  const club = await findClub(pool, id);
  if (!club) throw notFound('Club not found');
  return club;
}

function canManageClub(user, club) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (club.leader_id && club.leader_id === user.sub) return true;
  return user.role === 'CLUB_LEADER' && Boolean(user.clubId) && user.clubId === club.id;
}

async function activeMemberCounts(pool) {
  const { rows } = await pool.query(
    "SELECT club_id, COUNT(*)::int AS count FROM memberships WHERE status = 'ACTIVE' GROUP BY club_id",
  );
  const counts = new Map();
  for (const row of rows) counts.set(row.club_id, Number(row.count));
  return counts;
}

async function notifyMembers(pool, http, clubId, payload, excludeUserId = null) {
  const { rows } = await pool.query(
    "SELECT user_id FROM memberships WHERE club_id = $1 AND status = 'ACTIVE'",
    [clubId],
  );
  for (const row of rows) {
    if (row.user_id === excludeUserId) continue;
    await http.notify({ recipientId: row.user_id, ...payload });
  }
}

export function createApp({ pool, config, fetchImpl = fetch }) {
  const app = express();
  const http = createClient(config, fetchImpl);
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json({ limit: '1mb' }));

  healthRoutes(app, pool, 'club-service', {
    ...(config.userServiceUrl ? { user: config.userServiceUrl } : {}),
    ...(config.communicationServiceUrl ? { communication: config.communicationServiceUrl } : {}),
    ...(config.paymentServiceUrl ? { payment: config.paymentServiceUrl } : {}),
  });

  const auth = authenticate(config.authSecret);
  const admin = authenticate(config.authSecret, { roles: ['ADMIN'] });
  const service = requireService(config.serviceToken);

  // FR11 Browse clubs
  app.get(
    '/api/clubs',
    asyncHandler(async (req, res) => {
      const filters = [];
      const params = [];

      const status = cleanString(req.query.status, 40);
      const effectiveStatus = status ? status.toUpperCase() : 'APPROVED';
      if (!CLUB_STATUSES.includes(effectiveStatus)) throw badRequest('Invalid club status');
      params.push(effectiveStatus);
      filters.push(`status = $${params.length}`);

      const category = cleanString(req.query.category, 80);
      if (category) {
        params.push(category.toLowerCase());
        filters.push(`lower(category) = $${params.length}`);
      }

      const q = cleanString(req.query.q, 120);
      if (q) {
        params.push(`%${q.toLowerCase()}%`);
        filters.push(
          `(lower(name) LIKE $${params.length} OR lower(coalesce(description, '')) LIKE $${params.length})`,
        );
      }

      const { rows } = await pool.query(
        `SELECT * FROM clubs WHERE ${filters.join(' AND ')} ORDER BY name ASC`,
        params,
      );
      const counts = await activeMemberCounts(pool);
      res.json({ items: rows.map((row) => mapClub(row, counts.get(row.id) || 0)) });
    }),
  );

  // FR12 My memberships (registered before /api/clubs/:id)
  app.get(
    '/api/clubs/mine',
    auth,
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT m.*, c.name AS club_name, c.category AS club_category, c.status AS club_status,
                c.description AS club_description, c.leader_id AS club_leader_id
         FROM memberships m
         JOIN clubs c ON c.id = m.club_id
         WHERE m.user_id = $1
         ORDER BY m.joined_at DESC`,
        [req.user.sub],
      );
      const items = rows.map((row) => ({
        ...mapMembership(row),
        club: {
          id: row.club_id,
          name: row.club_name,
          description: row.club_description || null,
          category: row.club_category,
          status: row.club_status,
          leaderId: row.club_leader_id || null,
        },
      }));
      res.json({ items });
    }),
  );

  app.get(
    '/api/clubs/:id',
    asyncHandler(async (req, res) => {
      const club = await requireClub(pool, req.params.id);
      const counts = await activeMemberCounts(pool);
      res.json({ club: mapClub(club, counts.get(club.id) || 0) });
    }),
  );

  // FR11.1 Propose a new club
  app.post(
    '/api/clubs',
    auth,
    asyncHandler(async (req, res) => {
      requireFields(req.body || {}, ['name', 'description', 'category']);
      const club = {
        id: uuid('club'),
        name: cleanString(req.body.name, 120),
        description: cleanString(req.body.description, 2000),
        category: cleanString(req.body.category, 80),
        status: 'PENDING',
        proposed_by: req.user.sub,
        leader_id: null,
      };
      await pool.query(
        `INSERT INTO clubs(id, name, description, category, status, proposed_by, leader_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          club.id,
          club.name,
          club.description,
          club.category,
          club.status,
          club.proposed_by,
          club.leader_id,
        ],
      );
      await http.notify({
        recipientId: req.user.sub,
        type: 'CLUB_PROPOSED',
        title: 'Club proposal submitted',
        body: `Your proposal for ${club.name} is awaiting administrator review.`,
      });
      const created = await findClub(pool, club.id);
      res.status(201).json({ club: mapClub(created, 0) });
    }),
  );

  // FR12.1 Join an approved club
  app.post(
    '/api/clubs/:id/join',
    auth,
    asyncHandler(async (req, res) => {
      const club = await requireClub(pool, req.params.id);
      if (club.status !== 'APPROVED') {
        throw badRequest('Only approved clubs can be joined');
      }
      const { rows } = await pool.query(
        'SELECT * FROM memberships WHERE club_id = $1 AND user_id = $2',
        [club.id, req.user.sub],
      );
      const existing = rows[0];
      let membershipId;
      if (existing && existing.status === 'ACTIVE') {
        throw conflict('You are already a member of this club');
      }
      if (existing) {
        membershipId = existing.id;
        await pool.query(
          `UPDATE memberships
           SET status = 'ACTIVE', joined_at = now(), left_at = NULL, updated_at = now()
           WHERE id = $1`,
          [membershipId],
        );
      } else {
        membershipId = uuid('mbr');
        await pool.query(
          `INSERT INTO memberships(id, club_id, user_id, status)
           VALUES($1,$2,$3,'ACTIVE')`,
          [membershipId, club.id, req.user.sub],
        );
      }
      const membership = await pool.query('SELECT * FROM memberships WHERE id = $1', [
        membershipId,
      ]);
      await http.notify({
        recipientId: req.user.sub,
        type: 'CLUB_JOINED',
        title: 'Club membership confirmed',
        body: `You are now a member of ${club.name}.`,
      });
      res.json({ membership: mapMembership(membership.rows[0]) });
    }),
  );

  // FR12.2 Leave a club
  app.post(
    '/api/clubs/:id/leave',
    auth,
    asyncHandler(async (req, res) => {
      const club = await requireClub(pool, req.params.id);
      const { rows } = await pool.query(
        'SELECT * FROM memberships WHERE club_id = $1 AND user_id = $2',
        [club.id, req.user.sub],
      );
      const membership = rows[0];
      if (!membership || membership.status !== 'ACTIVE') {
        throw badRequest('You are not an active member of this club');
      }
      await pool.query(
        `UPDATE memberships
         SET status = 'LEFT', left_at = now(), updated_at = now()
         WHERE id = $1`,
        [membership.id],
      );
      const updated = await pool.query('SELECT * FROM memberships WHERE id = $1', [
        membership.id,
      ]);
      await http.notify({
        recipientId: req.user.sub,
        type: 'CLUB_LEFT',
        title: 'Club membership ended',
        body: `You have left ${club.name}.`,
      });
      res.json({ membership: mapMembership(updated.rows[0]) });
    }),
  );

  // FR13.1 Club members (administrator or club leader)
  app.get(
    '/api/clubs/:id/members',
    auth,
    asyncHandler(async (req, res) => {
      const club = await requireClub(pool, req.params.id);
      if (!canManageClub(req.user, club)) {
        throw forbidden('Only the club leader or an administrator can view members');
      }
      const { rows } = await pool.query(
        "SELECT * FROM memberships WHERE club_id = $1 AND status = 'ACTIVE' ORDER BY joined_at ASC",
        [club.id],
      );
      res.json({ items: rows.map(mapMembership) });
    }),
  );

  // FR13.2 Club events
  app.get(
    '/api/clubs/:id/events',
    asyncHandler(async (req, res) => {
      const club = await requireClub(pool, req.params.id);
      const { rows } = await pool.query(
        'SELECT * FROM events WHERE club_id = $1 ORDER BY starts_at ASC',
        [club.id],
      );
      res.json({ items: rows.map(mapEvent) });
    }),
  );

  app.get(
    '/api/events',
    auth,
    asyncHandler(async (req, res) => {
      const joined = String(req.query.joined || '').toLowerCase() === 'true';
      let rows;
      if (joined) {
        const result = await pool.query(
          `SELECT e.*, c.name AS club_name
           FROM events e
           JOIN memberships m ON m.club_id = e.club_id
           JOIN clubs c ON c.id = e.club_id
           WHERE m.user_id = $1 AND m.status = 'ACTIVE'
           ORDER BY e.starts_at ASC`,
          [req.user.sub],
        );
        rows = result.rows;
      } else {
        const result = await pool.query(
          `SELECT e.*, c.name AS club_name
           FROM events e
           JOIN clubs c ON c.id = e.club_id
           ORDER BY e.starts_at ASC`,
        );
        rows = result.rows;
      }
      res.json({ items: rows.map(mapEvent) });
    }),
  );

  app.post(
    '/api/clubs/:id/events',
    auth,
    asyncHandler(async (req, res) => {
      const club = await requireClub(pool, req.params.id);
      if (!canManageClub(req.user, club)) {
        throw forbidden('Only the club leader or an administrator can create events');
      }
      if (club.status !== 'APPROVED') throw badRequest('Events can only be created for approved clubs');
      requireFields(req.body || {}, ['title', 'startsAt']);
      const startsAt = parseDate(req.body.startsAt, 'startsAt');
      const endsAt = req.body.endsAt ? parseDate(req.body.endsAt, 'endsAt') : null;
      if (endsAt && endsAt <= startsAt) throw badRequest('endsAt must be after startsAt');
      const id = uuid('evt');
      await pool.query(
        `INSERT INTO events(id, club_id, title, description, starts_at, ends_at, created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          club.id,
          cleanString(req.body.title, 160),
          cleanString(req.body.description, 2000),
          startsAt,
          endsAt,
          req.user.sub,
        ],
      );
      const created = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
      await notifyMembers(
        pool,
        http,
        club.id,
        {
          type: 'CLUB_EVENT',
          title: `New event: ${created.rows[0].title}`,
          body: `${club.name} scheduled a new event.`,
        },
        req.user.sub,
      );
      res.status(201).json({ event: mapEvent(created.rows[0]) });
    }),
  );

  app.patch(
    '/api/events/:id',
    auth,
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
      const event = rows[0];
      if (!event) throw notFound('Event not found');
      const club = await requireClub(pool, event.club_id);
      if (!canManageClub(req.user, club)) {
        throw forbidden('Only the club leader or an administrator can update events');
      }
      const title =
        req.body?.title === undefined ? event.title : cleanString(req.body.title, 160);
      const description =
        req.body?.description === undefined
          ? event.description
          : cleanString(req.body.description, 2000);
      const startsAt =
        req.body?.startsAt === undefined
          ? new Date(event.starts_at)
          : parseDate(req.body.startsAt, 'startsAt');
      const endsAt =
        req.body?.endsAt === undefined
          ? event.ends_at
            ? new Date(event.ends_at)
            : null
          : req.body.endsAt
            ? parseDate(req.body.endsAt, 'endsAt')
            : null;
      if (!title) throw badRequest('Title cannot be empty');
      if (endsAt && endsAt <= startsAt) throw badRequest('endsAt must be after startsAt');
      await pool.query(
        `UPDATE events
         SET title = $1, description = $2, starts_at = $3, ends_at = $4, updated_at = now()
         WHERE id = $5`,
        [title, description, startsAt, endsAt, event.id],
      );
      const updated = await pool.query('SELECT * FROM events WHERE id = $1', [event.id]);
      res.json({ event: mapEvent(updated.rows[0]) });
    }),
  );

  app.delete(
    '/api/events/:id',
    auth,
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
      const event = rows[0];
      if (!event) throw notFound('Event not found');
      const club = await requireClub(pool, event.club_id);
      if (!canManageClub(req.user, club)) {
        throw forbidden('Only the club leader or an administrator can delete events');
      }
      await pool.query('DELETE FROM events WHERE id = $1', [event.id]);
      res.json({ message: 'Event deleted' });
    }),
  );

  // FR14.1 Administrator club lifecycle
  async function changeStatus(req, res, fromStatus, toStatus) {
    const club = await requireClub(pool, req.params.id);
    if (club.status !== fromStatus) {
      throw badRequest(`Cannot change club status from ${club.status} to ${toStatus}`);
    }
    await pool.query('UPDATE clubs SET status = $1, updated_at = now() WHERE id = $2', [
      toStatus,
      club.id,
    ]);
    const updated = await requireClub(pool, club.id);
    const recipient = updated.proposed_by || updated.leader_id;
    if (recipient) {
      await http.notify({
        recipientId: recipient,
        type: `CLUB_${toStatus}`,
        title: `Club ${toStatus.toLowerCase()}`,
        body: `${updated.name} is now ${toStatus}.`,
      });
    }
    res.json({ club: mapClub(updated) });
  }

  app.post(
    '/api/admin/clubs/:id/approve',
    admin,
    asyncHandler(async (req, res) => changeStatus(req, res, 'PENDING', 'APPROVED')),
  );

  app.post(
    '/api/admin/clubs/:id/reject',
    admin,
    asyncHandler(async (req, res) => changeStatus(req, res, 'PENDING', 'REJECTED')),
  );

  app.post(
    '/api/admin/clubs/:id/suspend',
    admin,
    asyncHandler(async (req, res) => changeStatus(req, res, 'APPROVED', 'SUSPENDED')),
  );

  app.patch(
    '/api/admin/clubs/:id/leader',
    admin,
    asyncHandler(async (req, res) => {
      requireFields(req.body || {}, ['userId']);
      const club = await requireClub(pool, req.params.id);
      const userId = cleanString(req.body.userId, 120);
      await pool.query('UPDATE clubs SET leader_id = $1, updated_at = now() WHERE id = $2', [
        userId,
        club.id,
      ]);
      const updated = await requireClub(pool, club.id);
      await http.notify({
        recipientId: userId,
        type: 'CLUB_LEADER_ASSIGNED',
        title: 'Club leader assigned',
        body: `You are now the leader of ${updated.name}.`,
      });
      res.json({ club: mapClub(updated) });
    }),
  );

  // Internal endpoints
  app.get(
    '/api/internal/activity',
    service,
    asyncHandler(async (req, res) => {
      requireFields(req.query, ['studentId']);
      const memberships = await pool.query(
        `SELECT m.*, c.name AS club_name
         FROM memberships m
         JOIN clubs c ON c.id = m.club_id
         WHERE m.user_id = $1`,
        [req.query.studentId],
      );
      const events = await pool.query(
        `SELECT DISTINCT e.*, c.name AS club_name
         FROM events e
         JOIN memberships m ON m.club_id = e.club_id
         JOIN clubs c ON c.id = e.club_id
         WHERE m.user_id = $1 AND m.status = 'ACTIVE'`,
        [req.query.studentId],
      );
      const items = [
        ...memberships.rows.map((row) => ({
          type: 'CLUB_MEMBERSHIP',
          id: row.id,
          title: `Membership: ${row.club_name}`,
          clubId: row.club_id,
          status: row.status,
          date: iso(row.joined_at),
        })),
        ...events.rows.map((row) => ({
          type: 'CLUB_EVENT',
          id: row.id,
          title: row.title,
          clubId: row.club_id,
          status: 'SCHEDULED',
          date: iso(row.starts_at),
        })),
      ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      res.json({ items });
    }),
  );

  app.get(
    '/api/internal/stats',
    service,
    asyncHandler(async (_req, res) => {
      const clubs = await pool.query('SELECT COUNT(*)::int AS count FROM clubs');
      const memberships = await pool.query(
        "SELECT COUNT(*)::int AS count FROM memberships WHERE status = 'ACTIVE'",
      );
      const events = await pool.query('SELECT COUNT(*)::int AS count FROM events');
      res.json({
        clubs: Number(clubs.rows[0].count),
        memberships: Number(memberships.rows[0].count),
        events: Number(events.rows[0].count),
      });
    }),
  );

  app.get(
    '/api/internal/report',
    service,
    asyncHandler(async (req, res) => {
      const type = cleanString(req.query.type, 40) || 'clubs';
      if (type !== 'clubs') throw badRequest('Unsupported report type');
      const clubs = await pool.query('SELECT * FROM clubs ORDER BY name ASC');
      const counts = await activeMemberCounts(pool);
      const items = clubs.rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        status: row.status,
        leaderId: row.leader_id || '',
        memberCount: counts.get(row.id) || 0,
        createdAt: iso(row.created_at),
      }));
      res.json({ items });
    }),
  );

  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}

function futureDate(days, hour) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

export async function ensureSeedData(pool) {
  const count = await pool.query('SELECT COUNT(*)::int AS count FROM clubs');
  if (Number(count.rows[0]?.count) > 0) return;

  const clubs = [
    {
      id: 'club_robotics',
      name: 'Robotics Club',
      category: 'Technology',
      status: 'APPROVED',
      description:
        'Design, build and compete with autonomous robots. Weekly build nights and workshops for all skill levels.',
      proposedBy: 'usr_club_leader',
      leaderId: 'usr_club_leader',
    },
    {
      id: 'club_debate',
      name: 'Debate Society',
      category: 'Academic',
      status: 'APPROVED',
      description:
        'Competitive and casual debating, public speaking coaching and inter-university tournaments.',
      proposedBy: 'usr_leader_debate',
      leaderId: 'usr_leader_debate',
    },
    {
      id: 'club_photography',
      name: 'Campus Photography Society',
      category: 'Arts',
      status: 'APPROVED',
      description:
        'Photo walks, studio sessions and exhibitions for photographers of every experience level.',
      proposedBy: 'usr_leader_photo',
      leaderId: 'usr_leader_photo',
    },
    {
      id: 'club_hiking',
      name: 'Hiking and Outdoors',
      category: 'Sports',
      status: 'APPROVED',
      description:
        'Weekend trail hikes, camping trips and outdoor safety training around the region.',
      proposedBy: 'usr_leader_hike',
      leaderId: 'usr_leader_hike',
    },
    {
      id: 'club_entrepreneurship',
      name: 'Entrepreneurship Hub',
      category: 'Business',
      status: 'PENDING',
      description:
        'Pitch practice, startup mentoring and networking events for student founders.',
      proposedBy: 'usr_demo_student',
      leaderId: null,
    },
    {
      id: 'club_culinary',
      name: 'Culinary Explorers',
      category: 'Culture',
      status: 'SUSPENDED',
      description:
        'Hands-on cooking sessions exploring cuisines from around the world.',
      proposedBy: 'usr_leader_culinary',
      leaderId: 'usr_leader_culinary',
    },
  ];

  for (const club of clubs) {
    await pool.query(
      `INSERT INTO clubs(id, name, description, category, status, proposed_by, leader_id)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        club.id,
        club.name,
        club.description,
        club.category,
        club.status,
        club.proposedBy,
        club.leaderId,
      ],
    );
  }

  const memberships = [
    ['club_robotics', 'usr_club_leader', 'ACTIVE'],
    ['club_robotics', 'usr_demo_student', 'ACTIVE'],
    ['club_robotics', 'usr_member_alex', 'ACTIVE'],
    ['club_robotics', 'usr_member_sam', 'LEFT'],
    ['club_debate', 'usr_leader_debate', 'ACTIVE'],
    ['club_debate', 'usr_member_priya', 'ACTIVE'],
    ['club_photography', 'usr_leader_photo', 'ACTIVE'],
    ['club_photography', 'usr_demo_student', 'ACTIVE'],
    ['club_hiking', 'usr_leader_hike', 'ACTIVE'],
    ['club_hiking', 'usr_member_alex', 'ACTIVE'],
    ['club_culinary', 'usr_leader_culinary', 'ACTIVE'],
  ];

  for (const [clubId, userId, status] of memberships) {
    const joinedAt = futureDate(-30, 12);
    const leftAt = status === 'LEFT' ? futureDate(-5, 12) : null;
    await pool.query(
      `INSERT INTO memberships(id, club_id, user_id, status, joined_at, left_at)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [uuid('mbr'), clubId, userId, status, joinedAt, leftAt],
    );
  }

  const events = [
    [
      'club_robotics',
      'Robotics Build Night',
      'Bring your project or join a team and build a line-following robot.',
      futureDate(3, 18),
      futureDate(3, 21),
      'usr_club_leader',
    ],
    [
      'club_robotics',
      'Intro to ROS Workshop',
      'A beginner-friendly workshop on the Robot Operating System.',
      futureDate(10, 17),
      futureDate(10, 19),
      'usr_club_leader',
    ],
    [
      'club_debate',
      'Public Speaking Bootcamp',
      'Practice impromptu speaking with feedback from experienced debaters.',
      futureDate(5, 19),
      futureDate(5, 21),
      'usr_leader_debate',
    ],
    [
      'club_photography',
      'Golden Hour Photo Walk',
      'Meet at the main quad for a sunset photography walk.',
      futureDate(2, 18),
      futureDate(2, 20),
      'usr_leader_photo',
    ],
    [
      'club_hiking',
      'Weekend Trail Hike',
      'A moderate 10 km hike along the river trail. Bring water and snacks.',
      futureDate(7, 8),
      futureDate(7, 15),
      'usr_leader_hike',
    ],
  ];

  for (const [clubId, title, description, startsAt, endsAt, createdBy] of events) {
    await pool.query(
      `INSERT INTO events(id, club_id, title, description, starts_at, ends_at, created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [uuid('evt'), clubId, title, description, startsAt, endsAt, createdBy],
    );
  }
}
