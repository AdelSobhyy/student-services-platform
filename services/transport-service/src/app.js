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
  toInt,
  toNumber,
  uuid,
} from './common.js';

const ROUTE_STATUSES = ['ACTIVE', 'INACTIVE'];
const SCHEDULE_STATUSES = ['SCHEDULED', 'CANCELLED', 'COMPLETED'];
const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'COMPLETED'];
const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED'];

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapRoute(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    origin: row.origin || null,
    destination: row.destination || null,
    distanceKm:
      row.distance_km === null || row.distance_km === undefined ? null : Number(row.distance_km),
    durationMinutes:
      row.duration_minutes === null || row.duration_minutes === undefined
        ? null
        : Number(row.duration_minutes),
    fare: Number(row.fare),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSchedule(row) {
  const capacity = Number(row.capacity);
  const seatsAvailable = Number(row.seats_available);
  const schedule = {
    id: row.id,
    routeId: row.route_id,
    routeName: row.route_name || null,
    origin: row.origin || null,
    destination: row.destination || null,
    departureAt: row.departure_at,
    arrivalAt: row.arrival_at || null,
    vehicle: row.vehicle || null,
    capacity,
    seatsAvailable,
    bookedSeats: Math.max(0, capacity - seatsAvailable),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.fare !== undefined && row.fare !== null) schedule.fare = Number(row.fare);
  return schedule;
}

function mapBooking(row) {
  const booking = {
    id: row.id,
    studentId: row.student_id,
    scheduleId: row.schedule_id,
    seatNumber: Number(row.seat_number),
    amount: Number(row.amount),
    status: row.status,
    paymentId: row.payment_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.departure_at) {
    booking.departureAt = row.departure_at;
    booking.arrivalAt = row.arrival_at || null;
    booking.routeName = row.route_name || null;
    booking.origin = row.origin || null;
    booking.destination = row.destination || null;
    booking.schedule = {
      id: row.schedule_id,
      departureAt: row.departure_at,
      arrivalAt: row.arrival_at || null,
      vehicle: row.vehicle || null,
      capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
      seatsAvailable:
        row.seats_available === null || row.seats_available === undefined
          ? null
          : Number(row.seats_available),
      status: row.schedule_status || null,
      routeName: row.route_name || null,
      origin: row.origin || null,
      destination: row.destination || null,
      fare: row.fare === null || row.fare === undefined ? null : Number(row.fare),
    };
  }
  return booking;
}

function isoDateTime(value, field) {
  return parseDate(value, field).toISOString();
}

function paymentIdOf(result) {
  return result?.payment?.id || result?.id || null;
}

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function findRoute(pool, id) {
  const { rows } = await pool.query('SELECT * FROM routes WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findSchedule(pool, id) {
  const { rows } = await pool.query(
    `SELECT s.*, r.name AS route_name, r.origin, r.destination, r.fare, r.status AS route_status
       FROM schedules s JOIN routes r ON r.id = s.route_id
      WHERE s.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function findBooking(pool, id) {
  const { rows } = await pool.query(
    `SELECT b.*, s.departure_at, s.arrival_at, s.vehicle, s.capacity, s.seats_available,
            s.status AS schedule_status,
            r.name AS route_name, r.origin, r.destination, r.fare
       FROM bookings b
       LEFT JOIN schedules s ON s.id = b.schedule_id
       LEFT JOIN routes r ON r.id = s.route_id
      WHERE b.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function nextSeatNumber(pool, scheduleId) {
  const { rows } = await pool.query(
    `SELECT seat_number FROM bookings
      WHERE schedule_id = $1 AND status IN ('PENDING','CONFIRMED')`,
    [scheduleId],
  );
  const used = new Set(rows.map((row) => Number(row.seat_number)));
  let seat = 1;
  while (used.has(seat)) seat += 1;
  return seat;
}

function incrementSeatsSql() {
  return `UPDATE schedules
             SET seats_available = CASE
                   WHEN seats_available < capacity THEN seats_available + 1
                   ELSE seats_available
                 END,
                 updated_at = now()
           WHERE id = $1`;
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

  healthRoutes(app, pool, 'transport-service', {
    ...(config.userServiceUrl ? { user: config.userServiceUrl } : {}),
    ...(config.paymentServiceUrl ? { payment: config.paymentServiceUrl } : {}),
    ...(config.communicationServiceUrl ? { communication: config.communicationServiceUrl } : {}),
  });

  // -------------------------------------------------------------------------
  // Public timetable (FR8)
  // -------------------------------------------------------------------------

  app.get(
    '/api/routes',
    asyncHandler(async (req, res) => {
      const clauses = [];
      const params = [];
      if (req.query.q) {
        params.push(`%${String(req.query.q).trim().toLowerCase()}%`);
        const placeholder = `$${params.length}`;
        clauses.push(
          `(lower(name) LIKE ${placeholder} OR lower(origin) LIKE ${placeholder} ` +
            `OR lower(destination) LIKE ${placeholder})`,
        );
      }
      if (req.query.status) {
        const status = String(req.query.status);
        if (!ROUTE_STATUSES.includes(status)) throw badRequest('Invalid route status');
        params.push(status);
        clauses.push(`status = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM routes ${where} ORDER BY name ASC`, params);
      res.json({ items: rows.map(mapRoute) });
    }),
  );

  app.get(
    '/api/routes/:id',
    asyncHandler(async (req, res) => {
      const route = await findRoute(pool, req.params.id);
      if (!route) throw notFound('Route not found');
      const { rows } = await pool.query(
        `SELECT s.*, r.name AS route_name, r.origin, r.destination, r.fare
           FROM schedules s JOIN routes r ON r.id = s.route_id
          WHERE s.route_id = $1
          ORDER BY s.departure_at ASC`,
        [route.id],
      );
      const schedules = rows.map(mapSchedule);
      res.json({ route: { ...mapRoute(route), schedules }, schedules });
    }),
  );

  app.get(
    '/api/schedules',
    asyncHandler(async (req, res) => {
      const clauses = [];
      const params = [];
      if (req.query.routeId) {
        params.push(String(req.query.routeId));
        clauses.push(`s.route_id = $${params.length}`);
      }
      if (req.query.date) {
        const date = parseDate(req.query.date, 'date').toISOString().slice(0, 10);
        params.push(date);
        clauses.push(`substr(s.departure_at, 1, 10) = $${params.length}`);
      }
      if (req.query.status) {
        const status = String(req.query.status);
        if (!SCHEDULE_STATUSES.includes(status)) throw badRequest('Invalid schedule status');
        params.push(status);
        clauses.push(`s.status = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT s.*, r.name AS route_name, r.origin, r.destination, r.fare
           FROM schedules s JOIN routes r ON r.id = s.route_id
           ${where}
          ORDER BY s.departure_at ASC`,
        params,
      );
      res.json({ items: rows.map(mapSchedule) });
    }),
  );

  const admin = authenticate(config.authSecret, { roles: ['ADMIN'] });
  const auth = authenticate(config.authSecret);

  // -------------------------------------------------------------------------
  // Admin timetable management (FR9)
  // -------------------------------------------------------------------------

  app.post(
    '/api/admin/routes',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['name']);
      const status = body.status === undefined ? 'ACTIVE' : String(body.status);
      if (!ROUTE_STATUSES.includes(status)) throw badRequest('Invalid route status');
      const fare = toNumber(body.fare, 0);
      const distanceKm = toNumber(body.distanceKm, null);
      const durationMinutes = toInt(body.durationMinutes, null);
      if (fare === null || fare < 0) throw badRequest('Fare must be a positive number');
      if (distanceKm !== null && distanceKm < 0) throw badRequest('distanceKm cannot be negative');
      if (durationMinutes !== null && durationMinutes < 1) {
        throw badRequest('durationMinutes must be at least 1');
      }

      const id = uuid('rte');
      await pool.query(
        `INSERT INTO routes(id, name, description, origin, destination, distance_km, duration_minutes, fare, status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          cleanString(body.name, 160),
          cleanString(body.description, 2000),
          cleanString(body.origin, 160),
          cleanString(body.destination, 160),
          distanceKm,
          durationMinutes,
          fare,
          status,
        ],
      );
      const route = await findRoute(pool, id);
      res.status(201).json({ route: mapRoute(route) });
    }),
  );

  app.patch(
    '/api/admin/routes/:id',
    admin,
    asyncHandler(async (req, res) => {
      const route = await findRoute(pool, req.params.id);
      if (!route) throw notFound('Route not found');
      const body = req.body || {};
      const fields = [];
      const values = [];
      const set = (column, value) => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };

      if (body.name !== undefined) {
        const name = cleanString(body.name, 160);
        if (!name) throw badRequest('Route name cannot be empty');
        set('name', name);
      }
      if (body.description !== undefined) set('description', cleanString(body.description, 2000));
      if (body.origin !== undefined) set('origin', cleanString(body.origin, 160));
      if (body.destination !== undefined) set('destination', cleanString(body.destination, 160));
      if (body.distanceKm !== undefined) {
        const distanceKm = toNumber(body.distanceKm, null);
        if (distanceKm !== null && distanceKm < 0) throw badRequest('distanceKm cannot be negative');
        set('distance_km', distanceKm);
      }
      if (body.durationMinutes !== undefined) {
        const durationMinutes = toInt(body.durationMinutes, null);
        if (durationMinutes !== null && durationMinutes < 1) {
          throw badRequest('durationMinutes must be at least 1');
        }
        set('duration_minutes', durationMinutes);
      }
      if (body.fare !== undefined) {
        const fare = toNumber(body.fare, null);
        if (fare === null || fare < 0) throw badRequest('Fare must be a positive number');
        set('fare', fare);
      }
      if (body.status !== undefined) {
        if (!ROUTE_STATUSES.includes(String(body.status))) throw badRequest('Invalid route status');
        set('status', String(body.status));
      }
      if (!fields.length) throw badRequest('No route fields to update');

      values.push(route.id);
      await pool.query(
        `UPDATE routes SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
        values,
      );
      const updated = await findRoute(pool, route.id);
      res.json({ route: mapRoute(updated) });
    }),
  );

  app.delete(
    '/api/admin/routes/:id',
    admin,
    asyncHandler(async (req, res) => {
      const route = await findRoute(pool, req.params.id);
      if (!route) throw notFound('Route not found');
      const schedules = await pool.query('SELECT COUNT(*) AS count FROM schedules WHERE route_id = $1', [
        route.id,
      ]);
      if (Number(schedules.rows[0]?.count || 0) > 0) {
        throw conflict('Cannot delete a route that still has schedules');
      }
      await pool.query('DELETE FROM routes WHERE id = $1', [route.id]);
      res.json({ deleted: true, id: route.id });
    }),
  );

  app.post(
    '/api/admin/schedules',
    admin,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['routeId', 'departureAt', 'capacity']);
      const route = await findRoute(pool, body.routeId);
      if (!route) throw badRequest('Unknown routeId');

      const departureAt = isoDateTime(body.departureAt, 'departureAt');
      let arrivalAt = null;
      if (body.arrivalAt !== undefined && body.arrivalAt !== null && body.arrivalAt !== '') {
        arrivalAt = isoDateTime(body.arrivalAt, 'arrivalAt');
      } else if (route.duration_minutes) {
        arrivalAt = addMinutes(departureAt, Number(route.duration_minutes));
      }
      if (arrivalAt && arrivalAt <= departureAt) {
        throw badRequest('arrivalAt must be after departureAt');
      }

      const capacity = toInt(body.capacity);
      if (capacity === null || capacity < 1) throw badRequest('Capacity must be at least 1');
      const status = body.status === undefined ? 'SCHEDULED' : String(body.status);
      if (!SCHEDULE_STATUSES.includes(status)) throw badRequest('Invalid schedule status');

      const id = uuid('sch');
      await pool.query(
        `INSERT INTO schedules(id, route_id, departure_at, arrival_at, vehicle, capacity, seats_available, status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          route.id,
          departureAt,
          arrivalAt,
          cleanString(body.vehicle, 120),
          capacity,
          capacity,
          status,
        ],
      );
      const schedule = await findSchedule(pool, id);
      res.status(201).json({ schedule: mapSchedule(schedule) });
    }),
  );

  app.patch(
    '/api/admin/schedules/:id',
    admin,
    asyncHandler(async (req, res) => {
      const schedule = await findSchedule(pool, req.params.id);
      if (!schedule) throw notFound('Schedule not found');
      const body = req.body || {};
      const fields = [];
      const values = [];
      const set = (column, value) => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
      };

      if (body.routeId !== undefined) {
        const route = await findRoute(pool, body.routeId);
        if (!route) throw badRequest('Unknown routeId');
        set('route_id', route.id);
      }

      let departureAt = schedule.departure_at;
      let arrivalAt = schedule.arrival_at;
      if (body.departureAt !== undefined) {
        departureAt = isoDateTime(body.departureAt, 'departureAt');
        set('departure_at', departureAt);
      }
      if (body.arrivalAt !== undefined) {
        arrivalAt =
          body.arrivalAt === null || body.arrivalAt === ''
            ? null
            : isoDateTime(body.arrivalAt, 'arrivalAt');
        set('arrival_at', arrivalAt);
      }
      if (arrivalAt && arrivalAt <= departureAt) {
        throw badRequest('arrivalAt must be after departureAt');
      }
      if (body.vehicle !== undefined) set('vehicle', cleanString(body.vehicle, 120));
      if (body.capacity !== undefined) {
        const capacity = toInt(body.capacity);
        if (capacity === null || capacity < 1) throw badRequest('Capacity must be at least 1');
        const booked = Math.max(0, Number(schedule.capacity) - Number(schedule.seats_available));
        if (capacity < booked) {
          throw conflict(`Capacity cannot be lower than the ${booked} seats already booked`);
        }
        set('capacity', capacity);
        set('seats_available', capacity - booked);
      }
      if (body.status !== undefined) {
        if (!SCHEDULE_STATUSES.includes(String(body.status))) {
          throw badRequest('Invalid schedule status');
        }
        set('status', String(body.status));
      }
      if (!fields.length) throw badRequest('No schedule fields to update');

      values.push(schedule.id);
      await pool.query(
        `UPDATE schedules SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
        values,
      );
      const updated = await findSchedule(pool, schedule.id);
      res.json({ schedule: mapSchedule(updated) });
    }),
  );

  app.delete(
    '/api/admin/schedules/:id',
    admin,
    asyncHandler(async (req, res) => {
      const schedule = await findSchedule(pool, req.params.id);
      if (!schedule) throw notFound('Schedule not found');
      const active = await pool.query(
        `SELECT COUNT(*) AS count FROM bookings
          WHERE schedule_id = $1 AND status IN ('PENDING','CONFIRMED')`,
        [schedule.id],
      );
      if (Number(active.rows[0]?.count || 0) > 0) {
        throw conflict('Cannot delete a schedule with active bookings');
      }
      await pool.query('DELETE FROM schedules WHERE id = $1', [schedule.id]);
      res.json({ deleted: true, id: schedule.id });
    }),
  );

  // -------------------------------------------------------------------------
  // Booking flow (FR10)
  // -------------------------------------------------------------------------

  app.post(
    '/api/bookings',
    auth,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['scheduleId']);
      const schedule = await findSchedule(pool, body.scheduleId);
      if (!schedule) throw notFound('Schedule not found');
      if (schedule.status !== 'SCHEDULED') {
        throw conflict('This schedule is not open for booking');
      }
      if (schedule.route_status && schedule.route_status !== 'ACTIVE') {
        throw conflict('The route for this schedule is not active');
      }
      if (Number(schedule.seats_available) <= 0) {
        throw conflict('This schedule is fully booked');
      }

      const existing = await pool.query(
        `SELECT id FROM bookings
          WHERE schedule_id = $1 AND student_id = $2 AND status IN ('PENDING','CONFIRMED')`,
        [schedule.id, req.user.sub],
      );
      if (existing.rows.length) {
        throw conflict('You already have a booking for this schedule');
      }

      const seatNumber = await nextSeatNumber(pool, schedule.id);
      const bookingId = uuid('trb');
      const amount = Number(schedule.fare || 0);
      await pool.query(
        `INSERT INTO bookings(id, student_id, schedule_id, seat_number, amount, status)
         VALUES($1,$2,$3,$4,$5,'PENDING')`,
        [bookingId, req.user.sub, schedule.id, seatNumber, amount],
      );

      const seatUpdate = await pool.query(
        'UPDATE schedules SET seats_available = seats_available - 1, updated_at = now() WHERE id = $1 AND seats_available > 0',
        [schedule.id],
      );
      if (!seatUpdate.rowCount) {
        await pool.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
        throw conflict('This schedule is fully booked');
      }

      let charge;
      try {
        charge = await http.charge({
          studentId: req.user.sub,
          payableType: 'TRANSPORT_BOOKING',
          payableId: bookingId,
          amount,
          description: `Seat ${seatNumber} on ${schedule.route_name} departing ${schedule.departure_at}`,
        });
      } catch (error) {
        await pool.query(
          "UPDATE bookings SET status = 'FAILED', updated_at = now() WHERE id = $1",
          [bookingId],
        );
        await pool.query(incrementSeatsSql(), [schedule.id]);
        throw new HttpError(502, 'Payment could not be processed', {
          reason: error.message,
        });
      }

      await pool.query(
        `UPDATE bookings
            SET status = 'CONFIRMED', payment_id = $1, updated_at = now()
          WHERE id = $2`,
        [paymentIdOf(charge), bookingId],
      );
      await http.notify({
        recipientId: req.user.sub,
        type: 'TRANSPORT_BOOKING_CONFIRMED',
        title: 'Transport booking confirmed',
        body: `Seat ${seatNumber} on ${schedule.route_name} departing ${schedule.departure_at} is confirmed.`,
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
        `SELECT b.*, s.departure_at, s.arrival_at, s.vehicle, s.capacity, s.seats_available,
                s.status AS schedule_status,
                r.name AS route_name, r.origin, r.destination, r.fare
           FROM bookings b
           LEFT JOIN schedules s ON s.id = b.schedule_id
           LEFT JOIN routes r ON r.id = s.route_id
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
      await pool.query(incrementSeatsSql(), [booking.schedule_id]);

      if (booking.payment_id) {
        await http.refund({
          paymentId: booking.payment_id,
          studentId: booking.student_id,
          amount: Number(booking.amount),
          reason: 'Transport booking cancelled',
        });
      }
      await http.notify({
        recipientId: booking.student_id,
        type: 'TRANSPORT_BOOKING_CANCELLED',
        title: 'Transport booking cancelled',
        body: `Your seat on ${booking.route_name || 'the shuttle'} was released.`,
      });

      const updated = await findBooking(pool, booking.id);
      res.json({ booking: mapBooking(updated) });
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
      const { rows } = await pool.query(
        `SELECT b.*, s.departure_at, s.arrival_at, s.vehicle, s.status AS schedule_status,
                r.name AS route_name, r.origin, r.destination
           FROM bookings b
           LEFT JOIN schedules s ON s.id = b.schedule_id
           LEFT JOIN routes r ON r.id = s.route_id
          WHERE b.student_id = $1
          ORDER BY b.created_at DESC`,
        [studentId],
      );
      const items = rows.map((row) => ({
        id: row.id,
        type: 'TRANSPORT_BOOKING',
        title: row.route_name ? `Trip on ${row.route_name}` : 'Campus transport trip',
        description: `Seat ${row.seat_number}${
          row.destination ? ` to ${row.destination}` : ''
        } · departs ${row.departure_at}`,
        status: row.status,
        date: row.created_at,
        amount: Number(row.amount),
      }));
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
  const count = await pool.query('SELECT COUNT(*) AS count FROM routes');
  if (Number(count.rows[0]?.count || 0) > 0) return;

  const routes = [
    ['rte_campus_express', 'Campus Express', 'Frequent shuttle between the main gate and north campus.', 'Main Gate', 'North Campus', 5.2, 15, 2.5, 'ACTIVE'],
    ['rte_downtown_shuttle', 'Downtown Shuttle', 'Evening service connecting campus with the downtown station.', 'Campus Center', 'Downtown Station', 8.4, 25, 3, 'ACTIVE'],
    ['rte_airport_line', 'Airport Line', 'Direct coach to the international airport with luggage space.', 'Main Gate', 'International Airport', 28, 45, 12, 'ACTIVE'],
  ];
  for (const route of routes) {
    await pool.query(
      `INSERT INTO routes(id, name, description, origin, destination, distance_km, duration_minutes, fare, status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      route,
    );
  }

  const schedules = [
    ['sch_campus_0800', 'rte_campus_express', '2026-12-02T08:00:00.000Z', '2026-12-02T08:15:00.000Z', 'Shuttle A', 40, 38, 'SCHEDULED'],
    ['sch_campus_1200', 'rte_campus_express', '2026-12-02T12:00:00.000Z', '2026-12-02T12:15:00.000Z', 'Shuttle B', 40, 40, 'SCHEDULED'],
    ['sch_campus_1700', 'rte_campus_express', '2026-12-02T17:00:00.000Z', '2026-12-02T17:15:00.000Z', 'Shuttle A', 40, 40, 'SCHEDULED'],
    ['sch_downtown_1800', 'rte_downtown_shuttle', '2026-12-03T18:00:00.000Z', '2026-12-03T18:25:00.000Z', 'Coach 12', 32, 30, 'SCHEDULED'],
    ['sch_airport_0900', 'rte_airport_line', '2026-12-04T09:00:00.000Z', '2026-12-04T09:45:00.000Z', 'Coach 7', 24, 24, 'SCHEDULED'],
    ['sch_airport_1500', 'rte_airport_line', '2026-12-04T15:00:00.000Z', '2026-12-04T15:45:00.000Z', 'Coach 8', 24, 24, 'CANCELLED'],
    ['sch_campus_past', 'rte_campus_express', '2026-09-15T08:00:00.000Z', '2026-09-15T08:15:00.000Z', 'Shuttle C', 40, 39, 'COMPLETED'],
  ];
  for (const schedule of schedules) {
    await pool.query(
      `INSERT INTO schedules(id, route_id, departure_at, arrival_at, vehicle, capacity, seats_available, status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      schedule,
    );
  }

  const bookings = [
    ['trb_seed_1', 'usr_demo_student', 'sch_campus_0800', 1, 2.5, 'CONFIRMED', 'pay_seed_transport_1'],
    ['trb_seed_2', 'usr_demo_leader', 'sch_campus_0800', 2, 2.5, 'CONFIRMED', 'pay_seed_transport_2'],
    ['trb_seed_3', 'usr_demo_student', 'sch_campus_past', 1, 2.5, 'COMPLETED', 'pay_seed_transport_3'],
  ];
  for (const booking of bookings) {
    await pool.query(
      `INSERT INTO bookings(id, student_id, schedule_id, seat_number, amount, status, payment_id)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      booking,
    );
  }
}
