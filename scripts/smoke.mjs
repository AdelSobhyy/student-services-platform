const ports = {
  user: 3001,
  accommodation: 3002,
  transport: 3003,
  club: 3004,
  dining: 3005,
  communication: 3006,
  library: 3007,
  payment: 3008,
};

const base = Object.fromEntries(
  Object.entries(ports).map(([name, port]) => [name, `http://127.0.0.1:${port}`]),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(service, path, { method = 'GET', body, token, serviceToken } = {}) {
  const response = await fetch(`${base[service]}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(serviceToken ? { 'X-Service-Token': serviceToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`${service}${path}: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

const email = `smoke-${Date.now()}@student.edu`;
const password = 'SmokeTest123!';

// Liveness, readiness and dependency checks.
for (const [name, url] of Object.entries(base)) {
  for (const path of ['/health', '/ready']) {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(5000) });
    assert(response.ok, `${name}${path} failed`);
  }
  console.log(`PASS ${name}: health and readiness`);
}

const frontend = await fetch('http://127.0.0.1:8080/', { signal: AbortSignal.timeout(5000) });
assert(frontend.ok, 'frontend is not reachable');
console.log('PASS frontend: static app reachable');

// FR1: register, login, profile.
const registration = await request('user', '/api/auth/register', {
  method: 'POST',
  body: { name: 'Smoke Student', email, password },
});
const token = registration.token;
assert(token, 'registration did not return a token');
const adminLogin = await request('user', '/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@campus.edu', password: 'Admin123!' },
});
const adminToken = adminLogin.token;
assert(adminToken, 'seeded admin login failed');
const profile = await request('user', '/api/users/me', { token });
assert(profile.user.email === email, 'profile email mismatch');
await request('user', '/api/users/me', {
  method: 'PATCH',
  token,
  body: { name: 'Smoke Student Updated' },
});
console.log('PASS user: register, login token, profile');

// FR4/FR5: browse, book and cancel a room.
const rooms = await request('accommodation', '/api/rooms?available=true');
assert(rooms.items.length > 0, 'no rooms returned');
const room = rooms.items[0];
const booking = await request('accommodation', '/api/bookings', {
  method: 'POST',
  token,
  body: { roomId: room.id, checkIn: '2027-02-01', checkOut: '2027-02-05' },
});
assert(booking.booking.status === 'CONFIRMED', 'room booking was not confirmed');
const cancelledBooking = await request(
  'accommodation',
  `/api/bookings/${booking.booking.id}/cancel`,
  { method: 'POST', token },
);
assert(cancelledBooking.booking.status === 'CANCELLED', 'room booking was not cancelled');
console.log('PASS accommodation: browse, book, cancel');

// FR7: review the room after a completed stay is not available through smoke,
// but ratings endpoint must be reachable.
const reviews = await request('accommodation', `/api/rooms/${room.id}/reviews`);
assert(Array.isArray(reviews.items), 'room reviews missing');
console.log('PASS accommodation: ratings endpoint');

// FR8/FR9: routes, schedules, book and cancel a seat.
const routes = await request('transport', '/api/routes');
assert(routes.items.length > 0, 'no routes returned');
const routeDetails = await request('transport', `/api/routes/${routes.items[0].id}`);
assert(routeDetails.schedules.length > 0, 'no schedules returned');
const schedule = routeDetails.schedules[0];
const seat = await request('transport', '/api/bookings', {
  method: 'POST',
  token,
  body: { scheduleId: schedule.id },
});
assert(seat.booking.status === 'CONFIRMED', 'seat booking was not confirmed');
const cancelledSeat = await request('transport', `/api/bookings/${seat.booking.id}/cancel`, {
  method: 'POST',
  token,
});
assert(cancelledSeat.booking.status === 'CANCELLED', 'seat booking was not cancelled');
console.log('PASS transport: routes, schedules, book, cancel');

// FR11/FR12: browse, join and leave a club.
const clubs = await request('club', '/api/clubs');
assert(clubs.items.length > 0, 'no clubs returned');
const club = clubs.items[0];
const joined = await request('club', `/api/clubs/${club.id}/join`, { method: 'POST', token });
assert(joined.membership.status === 'ACTIVE', 'club join failed');
const left = await request('club', `/api/clubs/${club.id}/leave`, { method: 'POST', token });
assert(left.membership.status === 'LEFT', 'club leave failed');
console.log('PASS club: browse, join, leave');

// FR15/FR16/FR18: menu, dietary preferences, conflicts, order and cancel.
const futureMealDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const createdMeal = await request('dining', '/api/admin/meals', {
  method: 'POST',
  token: adminToken,
  body: {
    name: `Smoke Meal ${Date.now()}`,
    price: 9.5,
    mealDate: futureMealDate,
    ingredients: ['rice', 'chicken'],
    nutrition: ['calories:550'],
    allergens: [],
  },
});
const meal = createdMeal.meal;
await request('dining', '/api/dietary', {
  method: 'PUT',
  token,
  body: { restrictions: 'Vegetarian', allergies: 'Peanuts' },
});
const conflicts = await request('dining', `/api/meals/${meal.id}/conflicts`, { token });
assert(Array.isArray(conflicts.conflicts), 'conflicts response missing');
const order = await request('dining', '/api/orders', {
  method: 'POST',
  token,
  body: { mealId: meal.id },
});
assert(order.order.status === 'PAID', 'meal order was not paid');
const cancelledOrder = await request('dining', `/api/orders/${order.order.id}/cancel`, {
  method: 'POST',
  token,
});
assert(cancelledOrder.order.status === 'CANCELLED', 'meal order was not cancelled');
console.log('PASS dining: menu, dietary, conflicts, order, cancel');

// FR19/FR20: notifications and support ticket lifecycle.
const notifications = await request('communication', '/api/notifications', { token });
assert(Array.isArray(notifications.items), 'notifications missing');
const ticket = await request('communication', '/api/tickets', {
  method: 'POST',
  token,
  body: { subject: 'Smoke ticket', description: 'Created by the smoke test' },
});
assert(ticket.ticket.status === 'OPEN', 'ticket was not opened');
const ticketDetails = await request('communication', `/api/tickets/${ticket.ticket.id}`, { token });
assert(ticketDetails.ticket.id === ticket.ticket.id, 'ticket details mismatch');
console.log('PASS communication: notifications, ticket');

// FR23: search/access a printed resource and cancel the reservation.
const resources = await request('library', '/api/resources');
assert(resources.items.length > 0, 'no library resources returned');
const printed = resources.items.find((item) => item.type === 'PRINTED_BOOK') || resources.items[0];
const access = await request('library', `/api/resources/${printed.id}/access`, {
  method: 'POST',
  token,
});
assert(access.reservation, 'printed resource did not create a reservation');
const cancelledReservation = await request(
  'library',
  `/api/reservations/${access.reservation.id}/cancel`,
  { method: 'POST', token },
);
assert(cancelledReservation.reservation.status === 'CANCELLED', 'reservation cancel failed');
console.log('PASS library: search, reserve, cancel');

// FR24: payment, receipt and refund request.
const payment = await request('payment', '/api/payments', {
  method: 'POST',
  token,
  body: {
    payableType: 'SMOKE',
    payableId: 'smoke-1',
    amount: 25,
    description: 'Smoke test payment',
  },
});
assert(payment.payment.status === 'PAID', 'payment was not paid');
const receipt = await request('payment', `/api/payments/${payment.payment.id}/receipt`, { token });
assert(receipt.receipt, 'receipt missing');
const refund = await request('payment', '/api/refunds', {
  method: 'POST',
  token,
  body: { paymentId: payment.payment.id, reason: 'Smoke test refund' },
});
assert(refund.refund.status === 'REQUESTED', 'refund was not requested');
console.log('PASS payment: pay, receipt, refund request');

// Admin flows: inspect users and analytics with the seeded admin token.
const users = await request('user', '/api/admin/users', { token: adminToken });
assert(users.items.length >= 4, 'seeded users missing');
const analytics = await request('communication', '/api/admin/analytics/summary', {
  token: adminToken,
});
assert(analytics.summary, 'analytics summary missing');
const report = await fetch(`${base.communication}/api/admin/reports/clubs`, {
  headers: { Authorization: `Bearer ${adminToken}` },
  signal: AbortSignal.timeout(10000),
});
assert(report.ok, 'club report failed');
assert((await report.text()).includes('club'), 'club report is empty');
console.log('PASS admin: users, analytics, club report');

console.log('All smoke checks passed.');
