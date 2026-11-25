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
  healthRoutes,
  notFound,
  parseDate,
  requireFields,
  requireService,
  toBool,
  toInt,
  toNumber,
  uuid,
} from './common.js';

const ROOM_STATUSES = ['AVAILABLE', 'BOOKED', 'MAINTENANCE'];
const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'COMPLETED'];
const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED'];

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapBuilding(row) {
  const building = {
    id: row.id,
    name: row.name,
    description: row.description || null,
    address: row.address || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.room_count !== undefined && row.room_count !== null) {
    building.roomCount = Number(row.room_count);
  }
  return building;
}

function splitAmenities(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapRoom(row) {
  return {
    id: row.id,
    buildingId: row.building_id,
    buildingName: row.building_name || null,
    buildingAddress: row.building_address || null,
    name: row.name,
    type: row.type,
    description: row.description || null,
    price: Number(row.price),
    capacity: Number(row.capacity),
    status: row.status,
    available: row.status === 'AVAILABLE',
    amenities: splitAmenities(row.amenities),
    imageUrl: row.image_url || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dateText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapBooking(row) {
  const booking = {
    id: row.id,
    studentId: row.student_id,
    roomId: row.room_id,
    checkIn: dateText(row.check_in),
    checkOut: dateText(row.check_out),
    nights: Number(row.nights),
    totalPrice: Number(row.total_price),
    status: row.status,
    paymentId: row.payment_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.room_name) {
    booking.room = {
      id: row.room_id,
      name: row.room_name,
      type: row.room_type || null,
      price: row.room_price === null || row.room_price === undefined ? null : Number(row.room_price),
      capacity:
        row.room_capacity === null || row.room_capacity === undefined
          ? null
          : Number(row.room_capacity),
      status: row.room_status || null,
      buildingId: row.building_id || null,
      buildingName: row.building_name || null,
    };
  }
  return booking;
}

function mapReview(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    studentId: row.student_id,
    rating: Number(row.rating),
    comment: row.comment || null,
    createdAt: row.created_at,
  };
}

function dateOnly(value, field) {
  const date = parseDate(value, field);
  return date.toISOString().slice(0, 10);
}

function nightsBetween(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00.000Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.round((end - start) / 86400000));
}

function amenitiesText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    const list = value.map((item) => cleanString(item, 60)).filter(Boolean);
    return list.length ? list.join(',') : null;
  }
  return cleanString(value, 500);
}

function paymentIdOf(result) {
  return result?.payment?.id || result?.id || null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function findBuilding(pool, id) {
  const { rows } = await pool.query('SELECT * FROM buildings WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findRoom(pool, id) {
  const { rows } = await pool.query(
    `SELECT r.*, b.name AS building_name, b.address AS building_address
       FROM rooms r JOIN buildings b ON b.id = r.building_id
      WHERE r.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function findBooking(pool, id) {
  const { rows } = await pool.query(
    `SELECT b.*, r.name AS room_name, r.type AS room_type, r.price AS room_price,
            r.capacity AS room_capacity, r.status AS room_status,
            bld.id AS building_id, bld.name AS building_name
       FROM bookings b
       LEFT JOIN rooms r ON r.id = b.room_id
       LEFT JOIN buildings bld ON bld.id = r.building_id
      WHERE b.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function roomRating(pool, roomId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) AS count, SUM(rating) AS total FROM reviews WHERE room_id = $1',
    [roomId],
  );
  const count = Number(rows[0]?.count || 0);
  const total = Number(rows[0]?.total || 0);
  return {
    reviewCount: count,
    averageRating: count ? Math.round((total / count) * 10) / 10 : 0,
  };
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export function createApp({ pool, config, fetchImpl = fetch }) {
  const app = express();
  const http = createClient(config, fetchImpl);
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json({ limit: '1mb' }));

  healthRoutes(app, pool, 'accommodation-service', {
    ...(config.userServiceUrl ? { user: config.userServiceUrl } : {}),
    ...(config.paymentServiceUrl ? { payment: config.paymentServiceUrl } : {}),
    ...(config.communicationServiceUrl ? { communication: config.communicationServiceUrl } : {}),
  });

  // -------------------------------------------------------------------------
  // Public catalogue (FR4)
  // -------------------------------------------------------------------------

  app.get(
    '/api/buildings',
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query('SELECT * FROM buildings ORDER BY name ASC');
      const items = [];
      for (const row of rows) {
        const counts = await pool.query(
          'SELECT COUNT(*) AS count FROM rooms WHERE building_id = $1',
          [row.id],
        );
        items.push(mapBuilding({ ...row, room_count: counts.rows[0]?.count || 0 }));
      }
      res.json({ items });
    }),
  );

  app.get(
    '/api/rooms',
    asyncHandler(async (req, res) => {
      const query = req.query || {};
      const clauses = [];
      const params = [];

      if (query.minPrice !== undefined && query.minPrice !== '') {
        params.push(toNumber(query.minPrice));
        clauses.push(`r.price >= $${params.length}`);
      }
      if (query.maxPrice !== undefined && query.maxPrice !== '') {
        params.push(toNumber(query.maxPrice));
        clauses.push(`r.price <= $${params.length}`);
      }
      if (query.capacity !== undefined && query.capacity !== '') {
        params.push(toInt(query.capacity));
        clauses.push(`r.capacity >= $${params.length}`);
      }
      if (query.available !== undefined && query.available !== '') {
        if (toBool(query.available)) {
          clauses.push("r.status = 'AVAILABLE'");
        } else {
          clauses.push("r.status <> 'AVAILABLE'");
        }
      }
      if (query.buildingId) {
        params.push(String(query.buildingId));
        clauses.push(`r.building_id = $${params.length}`);
      }
      if (query.q) {
        params.push(`%${String(query.q).trim().toLowerCase()}%`);
        const placeholder = `$${params.length}`;
        clauses.push(
          `(lower(r.name) LIKE ${placeholder} OR lower(r.description) LIKE ${placeholder} ` +
            `OR lower(b.name) LIKE ${placeholder} OR lower(b.address) LIKE ${placeholder})`,
        );
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT r.*, b.name AS building_name, b.address AS building_address
           FROM rooms r JOIN buildings b ON b.id = r.building_id
           ${where}
          ORDER BY r.price ASC, r.name ASC`,
        params,
      );
      res.json({ items: rows.map(mapRoom) });
    }),
  );

  app.get(
    '/api/rooms/:id',
    asyncHandler(async (req, res) => {
      const room = await findRoom(pool, req.params.id);
      if (!room) throw notFound('Room not found');
      const rating = await roomRating(pool, room.id);
      res.json({ room: { ...mapRoom(room), ...rating } });
    }),
  );

  app.get(
    '/api/rooms/:id/reviews',
    asyncHandler(async (req, res) => {
      const room = await findRoom(pool, req.params.id);
      if (!room) throw notFound('Room not found');
      const { rows } = await pool.query(
        'SELECT * FROM reviews WHERE room_id = $1 ORDER BY created_at DESC',
        [room.id],
      );
      const items = rows.map(mapReview);
      const total = items.reduce((sum, item) => sum + item.rating, 0);
      const average = items.length ? Math.round((total / items.length) * 10) / 10 : 0;
      res.json({ items, average });
    }),
  );

  const admin = authenticate(config.authSecret, { roles: ['ADMIN'] });
  const auth = authenticate(config.authSecret);

  // -------------------------------------------------------------------------
  // Admin building and room management (FR5)
  // -------------------------------------------------------------------------

  app.post(
    '/api/admin/buildings',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['name']);
      const id = uuid('bld');
      await pool.query(
        `INSERT INTO buildings(id, name, description, address)
         VALUES($1,$2,$3,$4)`,
        [id, cleanString(body.name, 160), cleanString(body.description, 2000), cleanString(body.address, 300)],
      );
      const building = await findBuilding(pool, id);
      res.status(201).json({ building: mapBuilding(building) });
    }),
  );

  app.patch(
    '/api/admin/buildings/:id',
    admin,
    asyncHandler(async (req, res) => {
      const building = await findBuilding(pool, req.params.id);
      if (!building) throw notFound('Building not found');
      const body = req.body || {};
      const fields = [];
      const values = [];
      const set = (column, value) => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };

      if (body.name !== undefined) {
        const name = cleanString(body.name, 160);
        if (!name) throw badRequest('Building name cannot be empty');
        set('name', name);
      }
      if (body.description !== undefined) set('description', cleanString(body.description, 2000));
      if (body.address !== undefined) set('address', cleanString(body.address, 300));
      if (!fields.length) throw badRequest('No building fields to update');

      values.push(building.id);
      await pool.query(
        `UPDATE buildings SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
        values,
      );
      const updated = await findBuilding(pool, building.id);
      res.json({ building: mapBuilding(updated) });
    }),
  );

  app.post(
    '/api/admin/rooms',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['buildingId', 'name', 'price', 'capacity']);
      const building = await findBuilding(pool, body.buildingId);
      if (!building) throw badRequest('Unknown buildingId');

      const price = toNumber(body.price);
      const capacity = toInt(body.capacity);
      if (price === null || price < 0) throw badRequest('Price must be a positive number');
      if (capacity === null || capacity < 1) throw badRequest('Capacity must be at least 1');
      const status = body.status === undefined ? 'AVAILABLE' : String(body.status);
      if (!ROOM_STATUSES.includes(status)) throw badRequest('Invalid room status');

      const id = uuid('room');
      await pool.query(
        `INSERT INTO rooms(id, building_id, name, type, description, price, capacity, status, amenities, image_url)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          building.id,
          cleanString(body.name, 60),
          cleanString(body.type, 60) || 'SINGLE',
          cleanString(body.description, 2000),
          price,
          capacity,
          status,
          amenitiesText(body.amenities) ?? null,
          cleanString(body.imageUrl, 500),
        ],
      );
      const room = await findRoom(pool, id);
      res.status(201).json({ room: mapRoom(room) });
    }),
  );

  app.patch(
    '/api/admin/rooms/:id',
    admin,
    asyncHandler(async (req, res) => {
      const room = await findRoom(pool, req.params.id);
      if (!room) throw notFound('Room not found');
      const body = req.body || {};
      const fields = [];
      const values = [];
      const set = (column, value) => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };

      if (body.buildingId !== undefined) {
        const building = await findBuilding(pool, body.buildingId);
        if (!building) throw badRequest('Unknown buildingId');
        set('building_id', building.id);
      }
      if (body.name !== undefined) {
        const name = cleanString(body.name, 60);
        if (!name) throw badRequest('Room name cannot be empty');
        set('name', name);
      }
      if (body.type !== undefined) set('type', cleanString(body.type, 60) || 'SINGLE');
      if (body.description !== undefined) set('description', cleanString(body.description, 2000));
      if (body.price !== undefined) {
        const price = toNumber(body.price);
        if (price === null || price < 0) throw badRequest('Price must be a positive number');
        set('price', price);
      }
      if (body.capacity !== undefined) {
        const capacity = toInt(body.capacity);
        if (capacity === null || capacity < 1) throw badRequest('Capacity must be at least 1');
        set('capacity', capacity);
      }
      if (body.status !== undefined) {
        if (!ROOM_STATUSES.includes(String(body.status))) throw badRequest('Invalid room status');
        set('status', String(body.status));
      }
      if (body.amenities !== undefined) set('amenities', amenitiesText(body.amenities) ?? null);
      if (body.imageUrl !== undefined) set('image_url', cleanString(body.imageUrl, 500));
      if (!fields.length) throw badRequest('No room fields to update');

      values.push(room.id);
      await pool.query(
        `UPDATE rooms SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
        values,
      );
      const updated = await findRoom(pool, room.id);
      res.json({ room: mapRoom(updated) });
    }),
  );

  app.patch(
    '/api/admin/rooms/:id/availability',
    admin,
    asyncHandler(async (req, res) => {
      const room = await findRoom(pool, req.params.id);
      if (!room) throw notFound('Room not found');
      const { status } = req.body || {};
      if (!ROOM_STATUSES.includes(status)) {
        throw badRequest(`Status must be one of: ${ROOM_STATUSES.join(', ')}`);
      }
      await pool.query('UPDATE rooms SET status = $1, updated_at = now() WHERE id = $2', [
        status,
        room.id,
      ]);
      const updated = await findRoom(pool, room.id);
      res.json({ room: mapRoom(updated) });
    }),
  );

  // -------------------------------------------------------------------------
  // Booking flow (FR6)
  // -------------------------------------------------------------------------

  app.post(
    '/api/bookings',
    auth,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['roomId', 'checkIn', 'checkOut']);
      const checkIn = dateOnly(body.checkIn, 'checkIn');
      const checkOut = dateOnly(body.checkOut, 'checkOut');
      if (checkOut <= checkIn) throw badRequest('checkOut must be after checkIn');

      const room = await findRoom(pool, body.roomId);
      if (!room) throw notFound('Room not found');
      if (room.status !== 'AVAILABLE') {
        throw conflict('Room is not available for booking');
      }

      const overlap = await pool.query(
        `SELECT id FROM bookings
          WHERE room_id = $1
            AND status IN ('PENDING','CONFIRMED')
            AND check_in < $2
            AND check_out > $3`,
        [room.id, checkOut, checkIn],
      );
      if (overlap.rows.length) {
        throw conflict('Room is already booked for the selected dates');
      }

      const nights = nightsBetween(checkIn, checkOut);
      const totalPrice = Math.round(Number(room.price) * nights * 100) / 100;
      const bookingId = uuid('bkg');
      await pool.query(
        `INSERT INTO bookings(id, student_id, room_id, check_in, check_out, nights, total_price, status)
         VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING')`,
        [bookingId, req.user.sub, room.id, checkIn, checkOut, nights, totalPrice],
      );

      let charge;
      try {
        charge = await http.charge({
          studentId: req.user.sub,
          payableType: 'ACCOMMODATION_BOOKING',
          payableId: bookingId,
          amount: totalPrice,
          description: `Room ${room.name} in ${room.building_name || 'campus residence'} (${checkIn} to ${checkOut})`,
        });
      } catch (error) {
        await pool.query(
          "UPDATE bookings SET status = 'FAILED', updated_at = now() WHERE id = $1",
          [bookingId],
        );
        throw new HttpError(502, 'Payment could not be processed', {
          reason: error.message,
        });
      }

      const paymentId = paymentIdOf(charge);
      await pool.query(
        `UPDATE bookings
            SET status = 'CONFIRMED', payment_id = $1, updated_at = now()
          WHERE id = $2`,
        [paymentId, bookingId],
      );
      await pool.query(
        "UPDATE rooms SET status = 'BOOKED', updated_at = now() WHERE id = $1",
        [room.id],
      );

      await http.notify({
        recipientId: req.user.sub,
        type: 'ACCOMMODATION_BOOKING_CONFIRMED',
        title: 'Accommodation booking confirmed',
        body: `Your stay in room ${room.name} from ${checkIn} to ${checkOut} is confirmed.`,
      });

      const booking = await findBooking(pool, bookingId);
      res.status(201).json({ booking: mapBooking(booking) });
    }),
  );

  app.get(
    '/api/bookings',
    auth,
    asyncHandler(async (req, res) => {
      const isAdmin = req.user.role === 'ADMIN';
      const clauses = [];
      const params = [];

      if (!isAdmin) {
        params.push(req.user.sub);
        clauses.push(`b.student_id = $${params.length}`);
      }
      if (req.query.status) {
        const status = String(req.query.status);
        if (!BOOKING_STATUSES.includes(status)) throw badRequest('Invalid booking status');
        params.push(status);
        clauses.push(`b.status = $${params.length}`);
      }
      if (isAdmin && req.query.studentId) {
        params.push(String(req.query.studentId));
        clauses.push(`b.student_id = $${params.length}`);
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT b.*, r.name AS room_name, r.type AS room_type, r.price AS room_price,
                r.capacity AS room_capacity, r.status AS room_status,
                bld.id AS building_id, bld.name AS building_name
           FROM bookings b
           LEFT JOIN rooms r ON r.id = b.room_id
           LEFT JOIN buildings bld ON bld.id = r.building_id
           ${where}
          ORDER BY b.created_at DESC`,
        params,
      );
      res.json({ items: rows.map(mapBooking) });
    }),
  );

  app.post(
    '/api/bookings/:id/cancel',
    auth,
    asyncHandler(async (req, res) => {
      const booking = await findBooking(pool, req.params.id);
      if (!booking) throw notFound('Booking not found');
      if (req.user.role !== 'ADMIN' && booking.student_id !== req.user.sub) {
        throw new HttpError(403, 'Not allowed to cancel this booking');
      }
      if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
        throw conflict(`A ${booking.status} booking cannot be cancelled`);
      }

      await pool.query(
        "UPDATE bookings SET status = 'CANCELLED', updated_at = now() WHERE id = $1",
        [booking.id],
      );
      await pool.query(
        "UPDATE rooms SET status = 'AVAILABLE', updated_at = now() WHERE id = $1 AND status = 'BOOKED'",
        [booking.room_id],
      );

      if (booking.payment_id) {
        await http.refund({
          paymentId: booking.payment_id,
          studentId: booking.student_id,
          amount: Number(booking.total_price),
          reason: 'Accommodation booking cancelled',
        });
      }
      await http.notify({
        recipientId: booking.student_id,
        type: 'ACCOMMODATION_BOOKING_CANCELLED',
        title: 'Accommodation booking cancelled',
        body: `Your booking ${booking.id} was cancelled and the room was released.`,
      });

      const updated = await findBooking(pool, booking.id);
      res.json({ booking: mapBooking(updated) });
    }),
  );

  // -------------------------------------------------------------------------
  // Reviews (FR7)
  // -------------------------------------------------------------------------

  app.post(
    '/api/reviews',
    auth,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['roomId', 'rating']);
      const rating = toInt(body.rating);
      if (rating === null || rating < 1 || rating > 5) {
        throw badRequest('Rating must be an integer between 1 and 5');
      }
      const room = await findRoom(pool, body.roomId);
      if (!room) throw notFound('Room not found');

      const prior = await pool.query(
        `SELECT COUNT(*) AS count FROM bookings
          WHERE student_id = $1 AND room_id = $2 AND status IN ('CONFIRMED','COMPLETED')`,
        [req.user.sub, room.id],
      );
      if (Number(prior.rows[0]?.count || 0) === 0) {
        throw new HttpError(403, 'A confirmed or completed booking is required to review this room');
      }

      const review = {
        id: uuid('rev'),
        room_id: room.id,
        student_id: req.user.sub,
        rating,
        comment: cleanString(body.comment, 2000),
      };
      await pool.query(
        `INSERT INTO reviews(id, room_id, student_id, rating, comment)
         VALUES($1,$2,$3,$4,$5)`,
        [review.id, review.room_id, review.student_id, review.rating, review.comment],
      );
      const { rows } = await pool.query('SELECT * FROM reviews WHERE id = $1', [review.id]);
      res.status(201).json({ review: mapReview(rows[0]) });
    }),
  );

  // -------------------------------------------------------------------------
  // Internal integration endpoints
  // -------------------------------------------------------------------------

  app.get(
    '/api/internal/activity',
    requireService(config.serviceToken),
    asyncHandler(async (req, res) => {
      const studentId = req.query.studentId;
      if (!studentId) return res.json({ items: [] });

      const bookings = await pool.query(
        `SELECT b.*, r.name AS room_name, bld.name AS building_name
           FROM bookings b
           LEFT JOIN rooms r ON r.id = b.room_id
           LEFT JOIN buildings bld ON bld.id = r.building_id
          WHERE b.student_id = $1
          ORDER BY b.created_at DESC`,
        [studentId],
      );
      const reviews = await pool.query(
        `SELECT rv.*, r.name AS room_name
           FROM reviews rv
           LEFT JOIN rooms r ON r.id = rv.room_id
          WHERE rv.student_id = $1
          ORDER BY rv.created_at DESC`,
        [studentId],
      );

      const items = [
        ...bookings.rows.map((row) => ({
          id: row.id,
          type: 'ACCOMMODATION_BOOKING',
          title: `Stay in room ${row.room_name || 'campus residence'}`,
          description:
            row.building_name
              ? `${row.building_name} · ${dateText(row.check_in)} to ${dateText(row.check_out)}`
              : `${dateText(row.check_in)} to ${dateText(row.check_out)}`,
          status: row.status,
          date: row.created_at,
          amount: Number(row.total_price),
        })),
        ...reviews.rows.map((row) => ({
          id: row.id,
          type: 'ACCOMMODATION_REVIEW',
          title: `Review for room ${row.room_name || 'campus residence'}`,
          description: row.comment || null,
          status: 'PUBLISHED',
          date: row.created_at,
          rating: Number(row.rating),
        })),
      ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      res.json({ items });
    }),
  );

  app.get(
    '/api/internal/stats',
    requireService(config.serviceToken),
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS active
           FROM bookings`,
      );
      res.json({
        activeBookings: Number(rows[0]?.active || 0),
        totalBookings: Number(rows[0]?.total || 0),
      });
    }),
  );

  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

export async function ensureSeedData(pool) {
  const count = await pool.query('SELECT COUNT(*) AS count FROM buildings');
  if (Number(count.rows[0]?.count || 0) > 0) return;

  const buildings = [
    {
      id: 'bld_north',
      name: 'North Campus Residence',
      description: 'Modern residence halls a short walk from the engineering faculty.',
      address: '12 North Campus Drive',
    },
    {
      id: 'bld_lakeside',
      name: 'Lakeside Halls',
      description: 'Quiet lakeside rooms with shared study lounges and a cafeteria.',
      address: '4 Lakeside Walk',
    },
    {
      id: 'bld_west',
      name: 'West Gate Apartments',
      description: 'Self-contained apartments for senior students near the west gate.',
      address: '88 West Gate Avenue',
    },
  ];
  for (const building of buildings) {
    await pool.query(
      `INSERT INTO buildings(id, name, description, address)
       VALUES($1,$2,$3,$4)`,
      [building.id, building.name, building.description, building.address],
    );
  }

  const rooms = [
    ['room_north_101', 'bld_north', '101', 'SINGLE', 'Bright single room with a private bathroom.', 450, 1, 'BOOKED', 'Wi-Fi,Desk,Private bathroom', null],
    ['room_north_102', 'bld_north', '102', 'SINGLE', 'Single room facing the courtyard.', 440, 1, 'AVAILABLE', 'Wi-Fi,Desk,Shared bathroom', null],
    ['room_north_201', 'bld_north', '201', 'DOUBLE', 'Spacious double room with two desks.', 620, 2, 'AVAILABLE', 'Wi-Fi,Desk,Private bathroom,Balcony', null],
    ['room_north_202', 'bld_north', '202', 'DOUBLE', 'Double room with a study corner.', 600, 2, 'AVAILABLE', 'Wi-Fi,Desk,Shared kitchen', null],
    ['room_lakeside_101', 'bld_lakeside', 'L101', 'STUDIO', 'Studio with a lake view and kitchenette.', 720, 1, 'AVAILABLE', 'Wi-Fi,Kitchenette,Lake view', null],
    ['room_lakeside_201', 'bld_lakeside', 'L201', 'SINGLE', 'Quiet single room overlooking the lake.', 480, 1, 'AVAILABLE', 'Wi-Fi,Desk,Shared bathroom', null],
    ['room_lakeside_202', 'bld_lakeside', 'L202', 'DOUBLE', 'Double room beside the common lounge.', 640, 2, 'AVAILABLE', 'Wi-Fi,Desk,Shared lounge', null],
    ['room_west_301', 'bld_west', 'W301', 'APARTMENT', 'One-bedroom apartment with a full kitchen.', 900, 2, 'AVAILABLE', 'Wi-Fi,Kitchen,Private bathroom,Laundry', null],
    ['room_west_302', 'bld_west', 'W302', 'APARTMENT', 'Two-bedroom apartment for shared living.', 1150, 3, 'AVAILABLE', 'Wi-Fi,Kitchen,Private bathroom,Laundry,Parking', null],
    ['room_west_305', 'bld_west', 'W305', 'SINGLE', 'Single apartment currently under maintenance.', 560, 1, 'MAINTENANCE', 'Wi-Fi,Kitchenette', null],
  ];
  for (const room of rooms) {
    await pool.query(
      `INSERT INTO rooms(id, building_id, name, type, description, price, capacity, status, amenities, image_url)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      room,
    );
  }

  const bookings = [
    ['bkg_seed_active', 'usr_demo_student', 'room_north_101', '2027-01-10', '2027-01-14', 4, 1800, 'CONFIRMED', 'pay_seed_accommodation_active'],
    ['bkg_seed_completed', 'usr_demo_student', 'room_lakeside_201', '2026-09-01', '2026-09-04', 3, 1440, 'COMPLETED', 'pay_seed_accommodation_completed'],
    ['bkg_seed_cancelled', 'usr_demo_leader', 'room_west_301', '2026-10-05', '2026-10-08', 3, 2700, 'CANCELLED', 'pay_seed_accommodation_cancelled'],
    ['bkg_seed_second', 'usr_demo_leader', 'room_north_201', '2026-09-10', '2026-09-12', 2, 1240, 'COMPLETED', 'pay_seed_accommodation_second'],
  ];
  for (const booking of bookings) {
    await pool.query(
      `INSERT INTO bookings(id, student_id, room_id, check_in, check_out, nights, total_price, status, payment_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      booking,
    );
  }

  const reviews = [
    ['rev_seed_1', 'room_lakeside_201', 'usr_demo_student', 5, 'Quiet, clean and exactly as described. The lake view is worth it.'],
    ['rev_seed_2', 'room_north_201', 'usr_demo_leader', 4, 'Plenty of space and a very helpful residence team.'],
  ];
  for (const review of reviews) {
    await pool.query(
      `INSERT INTO reviews(id, room_id, student_id, rating, comment)
       VALUES($1,$2,$3,$4,$5)`,
      review,
    );
  }
}
