# Service API contract

All services are Node 24 + Express 5 + PostgreSQL 17. Each service has its own database.
Every service copies `services/_shared/common.js` to `src/common.js`.

## Shared conventions

- JSON only. Error shape: `{ "error": "message", "details": ... }`.
- Authentication: `Authorization: Bearer <token>` issued by user-service.
  Token payload contains `sub`, `email`, `name`, `role`, `status`, `clubId`, `exp`.
- Internal calls: `X-Service-Token: <SERVICE_TOKEN>`.
- `AUTH_SECRET`, `SERVICE_TOKEN`, `DATABASE_URL`, `PORT`, and peer `*_SERVICE_URL` variables are env.
- Every service exposes `/health`, `/ready`, `/dependencies`, and CORS.
- IDs are generated in application code with `uuid('<prefix>')`; do not rely on database defaults.
- Dates are ISO strings in JSON. Numeric money values are returned as numbers.
- `ensureSeedData(pool)` is called by `server.js` and by tests. It inserts demo rows only when the main table is empty.

## user-service (FR1–FR3)

Endpoints:

- `POST /api/auth/register` `{name,email,password}` → `201 {token,user}`.
- `POST /api/auth/login` `{email,password}` → `{token,user}`; rejects SUSPENDED/DEACTIVATED.
- `POST /api/auth/recover` `{email}` → `{message,resetToken?}`.
- `POST /api/auth/reset` `{token,password}` → `{message}`.
- `GET /api/users/me` auth → `{user}`.
- `PATCH /api/users/me` auth `{name?,email?}` → `{user}`.
- `GET /api/users/me/activity` auth → `{items}` aggregated from peers.
- `GET /api/admin/users` admin → `{items}`.
- `POST /api/admin/users` admin `{name,email,password,role,clubId?}` → `201 {user}`.
- `PATCH /api/admin/users/:id/role` admin `{role,clubId?}` → `{user}`.
- `PATCH /api/admin/users/:id/status` admin `{status}` → `{user}`.
- `GET /api/internal/users` service → `{items}`.
- `GET /api/internal/users/:id` service → `{user}`.

Roles: `STUDENT`, `STAFF`, `CLUB_LEADER`, `ADMIN`.
Status transitions: ACTIVE→SUSPENDED/DEACTIVATED; SUSPENDED→ACTIVE/DEACTIVATED; DEACTIVATED→ACTIVE.

## accommodation-service (FR4–FR7)

Tables: `buildings`, `rooms`, `bookings`, `reviews`.

- `GET /api/buildings` public.
- `GET /api/rooms?minPrice=&maxPrice=&capacity=&available=&buildingId=&q=` public.
- `GET /api/rooms/:id` public.
- `GET /api/rooms/:id/reviews` public → `{items,average}`.
- `POST /api/admin/buildings` admin.
- `PATCH /api/admin/buildings/:id` admin.
- `POST /api/admin/rooms` admin.
- `PATCH /api/admin/rooms/:id` admin.
- `PATCH /api/admin/rooms/:id/availability` admin `{status}`.
- `POST /api/bookings` auth `{roomId,checkIn,checkOut}` → `201 {booking}`.
  Reject unavailable room, overlapping dates, invalid dates. Charge via payment internal endpoint.
- `GET /api/bookings` auth (own; admin all).
- `POST /api/bookings/:id/cancel` auth (own or admin) → `{booking}`; refund if paid.
- `POST /api/reviews` auth `{roomId,rating,comment}`; requires a CONFIRMED/COMPLETED booking.
- `GET /api/internal/activity?studentId=` service → `{items}`.
- `GET /api/internal/stats` service → `{activeBookings,totalBookings}`.

Booking statuses: PENDING → CONFIRMED/FAILED → CANCELLED/COMPLETED.
Room statuses: AVAILABLE, BOOKED, MAINTENANCE.

## transport-service (FR8–FR10)

Tables: `routes`, `schedules`, `bookings`.

- `GET /api/routes` public.
- `GET /api/routes/:id` public (include schedules).
- `GET /api/schedules?routeId=` public.
- `POST/PATCH/DELETE /api/admin/routes` admin.
- `POST/PATCH/DELETE /api/admin/schedules` admin.
- `POST /api/bookings` auth `{scheduleId}` → `201 {booking}`; prevent over-capacity; charge via payment.
- `GET /api/bookings` auth.
- `POST /api/bookings/:id/cancel` auth → `{booking}`; release seat and refund.
- `GET /api/internal/activity?studentId=` service.
- `GET /api/internal/stats` service → `{activeBookings,totalBookings}`.

## club-service (FR11–FR14)

Tables: `clubs`, `memberships`, `events`.

Club statuses: PENDING, APPROVED, REJECTED, SUSPENDED.
Membership statuses: ACTIVE, LEFT.

- `GET /api/clubs?q=&category=&status=` public (default only APPROVED).
- `GET /api/clubs/:id` public.
- `POST /api/clubs` auth `{name,description,category}` → `201 {club}` PENDING; `proposed_by=user.sub`.
- `POST /api/clubs/:id/join` auth → `{membership}`; only APPROVED.
- `POST /api/clubs/:id/leave` auth → `{membership}`.
- `GET /api/clubs/mine` auth → memberships with club.
- `GET /api/clubs/:id/members` admin or club leader.
- `GET /api/clubs/:id/events` public.
- `GET /api/events?joined=true` auth; joined clubs only.
- `POST /api/clubs/:id/events` admin or club leader `{title,description,startsAt,endsAt}`.
- `PATCH/DELETE /api/events/:id` admin or club leader.
- `POST /api/admin/clubs/:id/approve` admin.
- `POST /api/admin/clubs/:id/reject` admin.
- `POST /api/admin/clubs/:id/suspend` admin.
- `PATCH /api/admin/clubs/:id/leader` admin `{userId}`.
- `GET /api/internal/activity?studentId=` service.
- `GET /api/internal/stats` service → `{clubs,memberships,events}`.
- `GET /api/internal/report?type=clubs` service → `{items}` for FR21.2.

## dining-service (FR15–FR18)

Tables: `meals`, `dietary_preferences`, `orders`.
Store ingredients, nutrition and conflict names as comma-separated text.

- `GET /api/meals?q=&date=` public.
- `GET /api/meals/:id` public.
- `GET /api/meals/:id/conflicts` auth → `{conflicts}`.
- `GET /api/meals?highlight=true` auth → meals with `conflicts`.
- `POST/PATCH/DELETE /api/admin/meals` admin.
- `PATCH /api/admin/meals/:id/stock` admin `{stockStatus}`.
- `GET /api/dietary` auth → `{preferences}`.
- `PUT /api/dietary` auth `{restrictions,allergies}`.
- `POST /api/orders` auth `{mealId}` → `201 {order}`; rejects OUT_OF_STOCK; charge via payment.
- `GET /api/orders` auth.
- `POST /api/orders/:id/cancel` auth; allowed before cancellation deadline (menu date 18:00); refund.
- `GET /api/internal/activity?studentId=` service.
- `GET /api/internal/stats` service → `{activeOrders,totalOrders}`.

Order statuses: CREATED → PAID/PAYMENT_FAILED → CANCELLED/COMPLETED.
Meal stock statuses: AVAILABLE, OUT_OF_STOCK.

## communication-service (FR19–FR22)

Tables: `notifications`, `tickets`, `ticket_messages`, `announcements`, `settings`.

- `GET /api/notifications` auth (own; `?unread=true`).
- `PATCH /api/notifications/:id/read` auth.
- `POST /api/admin/notifications` admin `{recipientId?,title,body,type?}`; `all:true` broadcasts.
- `POST /api/internal/notifications` service.
- `POST /api/tickets` auth `{subject,description}` → `201 {ticket}`.
- `GET /api/tickets` auth (own; admin `?all=true`).
- `GET /api/tickets/:id` auth (owner or admin) with messages.
- `POST /api/admin/tickets/:id/respond` admin `{body,status?}`; status IN_PROGRESS or RESOLVED.
- `PATCH /api/admin/tickets/:id/status` admin `{status}`.
- `GET /api/admin/analytics/summary` admin; combines peer stats and local counts.
- `GET /api/admin/reports/clubs` admin; CSV report from club-service.
- `GET /api/settings/semester` public.
- `PUT /api/admin/settings/semester` admin `{startDate,endDate}`.
- `POST /api/admin/announcements` admin `{title,body}`.
- `GET /api/announcements` public.

Ticket statuses: OPEN, IN_PROGRESS, RESOLVED.

## library-service (FR23)

Tables: `resources`, `reservations`, `downloads`.

Resource types: `PRINTED_BOOK`, `DIGITAL`.

- `GET /api/resources?q=&type=&subject=` public.
- `GET /api/resources/:id` public.
- `POST /api/resources/:id/access` auth; printed → RESERVED reservation + decrement copies; digital → download log.
- `GET /api/reservations` auth.
- `POST /api/reservations/:id/collect` auth.
- `POST /api/reservations/:id/cancel` auth; return copy.
- `POST /api/reservations/:id/return` auth; return copy.
- `POST/PATCH/DELETE /api/admin/resources` admin.
- `GET /api/internal/activity?studentId=` service.
- `GET /api/internal/stats` service → `{resources,reservations,downloads}`.

Reservation statuses: RESERVED, COLLECTED, CANCELLED, EXPIRED, RETURNED.

## payment-service (FR24)

Tables: `payments`, `receipts`, `refunds`.

- `POST /api/payments` auth `{payableType,payableId,amount,description?}` → `201 {payment}`; simulated gateway always approves positive amounts; create receipt; notify.
- `GET /api/payments` auth (own; admin all).
- `GET /api/payments/:id` auth.
- `GET /api/payments/:id/receipt` auth.
- `POST /api/refunds` auth `{paymentId,reason,amount?}` → `201 {refund}`.
- `GET /api/refunds` auth.
- `PATCH /api/admin/refunds/:id` admin `{action}`; actions `approve`, `reject`, `issue`.
- `POST /api/internal/charges` service `{studentId,payableType,payableId,amount,description?}` → `201 {payment}`.
- `POST /api/internal/refunds` service `{paymentId,studentId,amount?,reason?}` → `201 {refund}`; auto-issues.
- `GET /api/internal/activity?studentId=` service.
- `GET /api/internal/stats` service → `{payments,revenue}`.

Payment statuses: PENDING, PAID, FAILED, REFUNDED.
Refund statuses: REQUESTED, APPROVED, REJECTED, ISSUED, FAILED.

## Cross-service calls

- charge: `POST <payment>/api/internal/charges`
- refund: `POST <payment>/api/internal/refunds`
- notify: `POST <communication>/api/internal/notifications`
- activity: `GET <peer>/api/internal/activity?studentId=`
- stats: `GET <peer>/api/internal/stats`
- club report: `GET <club>/api/internal/report?type=clubs`
- broadcast users: `GET <user>/api/internal/users`
