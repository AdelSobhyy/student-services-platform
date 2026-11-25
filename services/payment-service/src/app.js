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
  uuid,
} from './common.js';

const RESERVED_REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'ISSUED'];

function mapPayment(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    payableType: row.payable_type,
    payableId: row.payable_id,
    amount: Number(row.amount),
    description: row.description,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    paidAt: iso(row.paid_at),
  };
}

function mapReceipt(row) {
  return {
    id: row.id,
    paymentId: row.payment_id,
    receiptNumber: row.receipt_number,
    number: row.receipt_number,
    amount: Number(row.amount),
    issuedAt: iso(row.issued_at),
  };
}

function mapRefund(row) {
  return {
    id: row.id,
    paymentId: row.payment_id,
    studentId: row.student_id,
    amount: Number(row.amount),
    reason: row.reason,
    status: row.status,
    requestedAt: iso(row.requested_at),
    processedAt: iso(row.processed_at),
    updatedAt: iso(row.updated_at),
  };
}

async function findPayment(pool, id) {
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findRefund(pool, id) {
  const { rows } = await pool.query('SELECT * FROM refunds WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findReceipt(pool, paymentId) {
  const { rows } = await pool.query('SELECT * FROM receipts WHERE payment_id = $1', [paymentId]);
  return rows[0] || null;
}

function ownsPayment(payment, user) {
  return payment.student_id === user.sub || user.role === 'ADMIN';
}

async function reservedRefundTotal(pool, paymentId) {
  const { rows } = await pool.query('SELECT * FROM refunds WHERE payment_id = $1', [paymentId]);
  return rows
    .filter((row) => RESERVED_REFUND_STATUSES.includes(row.status))
    .reduce((sum, row) => sum + Number(row.amount), 0);
}

function parseAmount(value, field = 'amount') {
  const amount = toNumber(value, null);
  if (amount === null || !Number.isFinite(amount)) throw badRequest(`${field} is required`);
  return amount;
}

function receiptNumber() {
  return `RCPT-${uuid('').replace('_', '').slice(0, 12).toUpperCase()}`;
}

export function createApp({ pool, config, fetchImpl = fetch }) {
  const app = express();
  const http = createClient(config, fetchImpl);
  app.disable('x-powered-by');
  app.use(cors);
  app.use(express.json({ limit: '1mb' }));

  healthRoutes(app, pool, 'payment-service', {
    ...(config.userServiceUrl ? { user: config.userServiceUrl } : {}),
    ...(config.communicationServiceUrl ? { communication: config.communicationServiceUrl } : {}),
  });

  const auth = authenticate(config.authSecret);
  const admin = authenticate(config.authSecret, { roles: ['ADMIN'] });
  const service = requireService(config.serviceToken);

  async function issueReceipt(payment, amount) {
    const id = uuid('rcp');
    const number = receiptNumber();
    await pool.query(
      'INSERT INTO receipts(id, payment_id, receipt_number, amount) VALUES($1,$2,$3,$4)',
      [id, payment.id, number, amount],
    );
    const { rows } = await pool.query('SELECT * FROM receipts WHERE id = $1', [id]);
    return mapReceipt(rows[0]);
  }

  async function notifyPayment(payment, receipt) {
    await http.notify({
      recipientId: payment.studentId,
      type: 'PAYMENT',
      title: 'Payment received',
      body: `Payment of ${Number(payment.amount).toFixed(2)} for ${payment.payableType} was successful. Receipt ${receipt.number}.`,
    });
  }

  // Creates a PENDING payment, then simulates the gateway. Positive amounts
  // always succeed; zero/negative amounts fail without producing a receipt.
  async function createPaymentRecord({
    studentId,
    payableType,
    payableId,
    amount,
    description,
  }) {
    const id = uuid('pay');
    await pool.query(
      `INSERT INTO payments(id, student_id, payable_type, payable_id, amount, description, status)
       VALUES($1,$2,$3,$4,$5,$6,'PENDING')`,
      [id, studentId, payableType, payableId, amount, description],
    );
    let receipt = null;
    if (amount > 0) {
      await pool.query(
        `UPDATE payments SET status = 'PAID', paid_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
      const paid = await findPayment(pool, id);
      receipt = await issueReceipt(paid, amount);
      await notifyPayment(mapPayment(paid), receipt);
    } else {
      await pool.query(
        `UPDATE payments SET status = 'FAILED', updated_at = now() WHERE id = $1`,
        [id],
      );
    }
    const payment = mapPayment(await findPayment(pool, id));
    return { payment, receipt };
  }

  async function validateRefundAmount(payment, requested) {
    const amount = requested === undefined || requested === null ? Number(payment.amount) : Number(requested);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw badRequest('Refund amount must be greater than zero');
    }
    const reserved = await reservedRefundTotal(pool, payment.id);
    const remaining = Number(payment.amount) - reserved;
    if (amount > remaining + 0.000001) {
      throw badRequest(`Refund amount exceeds the remaining refundable balance of ${remaining.toFixed(2)}`);
    }
    return amount;
  }

  // FR24.1 Make a payment ---------------------------------------------------

  app.post(
    '/api/payments',
    auth,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['payableType', 'payableId']);
      if (body.amount === undefined || body.amount === null || body.amount === '') {
        throw badRequest('amount is required');
      }
      const amount = parseAmount(body.amount);
      const result = await createPaymentRecord({
        studentId: req.user.sub,
        payableType: cleanString(body.payableType, 80),
        payableId: cleanString(body.payableId, 120),
        amount,
        description: cleanString(body.description, 500),
      });
      res.status(201).json(result);
    }),
  );

  app.get(
    '/api/payments',
    auth,
    asyncHandler(async (req, res) => {
      const showAll = req.user.role === 'ADMIN' && req.query.all === 'true';
      const { rows } = showAll
        ? await pool.query('SELECT * FROM payments ORDER BY created_at DESC')
        : await pool.query(
            'SELECT * FROM payments WHERE student_id = $1 ORDER BY created_at DESC',
            [req.user.sub],
          );
      res.json({ items: rows.map(mapPayment) });
    }),
  );

  app.get(
    '/api/payments/:id',
    auth,
    asyncHandler(async (req, res) => {
      const payment = await findPayment(pool, req.params.id);
      if (!payment) throw notFound('Payment not found');
      if (!ownsPayment(payment, req.user)) throw forbidden();
      const receipt = await findReceipt(pool, payment.id);
      res.json({
        payment: mapPayment(payment),
        receipt: receipt ? mapReceipt(receipt) : null,
      });
    }),
  );

  app.get(
    '/api/payments/:id/receipt',
    auth,
    asyncHandler(async (req, res) => {
      const payment = await findPayment(pool, req.params.id);
      if (!payment) throw notFound('Payment not found');
      if (!ownsPayment(payment, req.user)) throw forbidden();
      const receipt = await findReceipt(pool, payment.id);
      if (!receipt) throw notFound('Receipt not found');
      res.json({ receipt: mapReceipt(receipt) });
    }),
  );

  // FR24.2 Refunds ----------------------------------------------------------

  app.post(
    '/api/refunds',
    auth,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['paymentId', 'reason']);
      const payment = await findPayment(pool, body.paymentId);
      if (!payment) throw notFound('Payment not found');
      if (!ownsPayment(payment, req.user)) throw forbidden();
      if (payment.status !== 'PAID') {
        throw badRequest('Only paid payments can be refunded');
      }
      const amount = await validateRefundAmount(payment, body.amount);
      const id = uuid('ref');
      await pool.query(
        `INSERT INTO refunds(id, payment_id, student_id, amount, reason, status)
         VALUES($1,$2,$3,$4,$5,'REQUESTED')`,
        [id, payment.id, payment.student_id, amount, cleanString(body.reason, 500)],
      );
      res.status(201).json({ refund: mapRefund(await findRefund(pool, id)) });
    }),
  );

  app.get(
    '/api/refunds',
    auth,
    asyncHandler(async (req, res) => {
      const { rows } =
        req.user.role === 'ADMIN'
          ? await pool.query('SELECT * FROM refunds ORDER BY requested_at DESC')
          : await pool.query(
              'SELECT * FROM refunds WHERE student_id = $1 ORDER BY requested_at DESC',
              [req.user.sub],
            );
      res.json({ items: rows.map(mapRefund) });
    }),
  );

  app.patch(
    '/api/admin/refunds/:id',
    admin,
    asyncHandler(async (req, res) => {
      const action = String(req.body?.action || '').toLowerCase();
      if (!['approve', 'reject', 'issue'].includes(action)) {
        throw badRequest('action must be approve, reject or issue');
      }
      const refund = await findRefund(pool, req.params.id);
      if (!refund) throw notFound('Refund not found');

      let status;
      if (action === 'approve') {
        if (refund.status !== 'REQUESTED') {
          throw badRequest(`Cannot approve a refund with status ${refund.status}`);
        }
        status = 'APPROVED';
      } else if (action === 'reject') {
        if (!['REQUESTED', 'APPROVED'].includes(refund.status)) {
          throw badRequest(`Cannot reject a refund with status ${refund.status}`);
        }
        status = 'REJECTED';
      } else {
        if (refund.status !== 'APPROVED') {
          throw badRequest('A refund must be approved before it can be issued');
        }
        status = 'ISSUED';
      }

      if (status === 'ISSUED') {
        await pool.query(
          `UPDATE refunds
           SET status = $1, processed_at = now(), updated_at = now()
           WHERE id = $2`,
          [status, refund.id],
        );
        await pool.query(
          `UPDATE payments SET status = 'REFUNDED', updated_at = now() WHERE id = $1`,
          [refund.payment_id],
        );
      } else {
        await pool.query(
          'UPDATE refunds SET status = $1, updated_at = now() WHERE id = $2',
          [status, refund.id],
        );
      }
      const updated = await findRefund(pool, refund.id);
      const payment = await findPayment(pool, refund.payment_id);
      res.json({
        refund: mapRefund(updated),
        payment: payment ? mapPayment(payment) : null,
      });
    }),
  );

  // Internal charge and refund endpoints used by peer services --------------

  app.post(
    '/api/internal/charges',
    service,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['studentId', 'payableType', 'payableId']);
      if (body.amount === undefined || body.amount === null || body.amount === '') {
        throw badRequest('amount is required');
      }
      const amount = parseAmount(body.amount);
      const result = await createPaymentRecord({
        studentId: cleanString(body.studentId, 120),
        payableType: cleanString(body.payableType, 80),
        payableId: cleanString(body.payableId, 120),
        amount,
        description: cleanString(body.description, 500),
      });
      res.status(201).json(result);
    }),
  );

  app.post(
    '/api/internal/refunds',
    service,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      requireFields(body, ['paymentId']);
      const payment = await findPayment(pool, body.paymentId);
      if (!payment) throw notFound('Payment not found');
      if (payment.status === 'FAILED' || payment.status === 'PENDING') {
        throw badRequest('Payment was not completed');
      }
      const amount = await validateRefundAmount(payment, body.amount);
      const id = uuid('ref');
      await pool.query(
        `INSERT INTO refunds(
           id, payment_id, student_id, amount, reason, status, processed_at
         ) VALUES($1,$2,$3,$4,$5,'ISSUED',now())`,
        [
          id,
          payment.id,
          payment.student_id,
          amount,
          cleanString(body.reason, 500) || 'Automatic refund',
        ],
      );
      await pool.query(
        `UPDATE payments SET status = 'REFUNDED', updated_at = now() WHERE id = $1`,
        [payment.id],
      );
      res.status(201).json({
        refund: mapRefund(await findRefund(pool, id)),
        payment: mapPayment(await findPayment(pool, payment.id)),
      });
    }),
  );

  // Cross-service activity and statistics ----------------------------------

  app.get(
    '/api/internal/activity',
    service,
    asyncHandler(async (req, res) => {
      const studentId = cleanString(req.query.studentId, 120);
      if (!studentId) throw badRequest('studentId is required');
      const { rows: payments } = await pool.query(
        'SELECT * FROM payments WHERE student_id = $1 ORDER BY created_at DESC',
        [studentId],
      );
      const { rows: refunds } = await pool.query(
        'SELECT * FROM refunds WHERE student_id = $1 ORDER BY requested_at DESC',
        [studentId],
      );
      const items = [
        ...payments.map((row) => ({
          type: 'PAYMENT',
          id: row.id,
          title: row.description || row.payable_type,
          status: row.status,
          amount: Number(row.amount),
          date: iso(row.created_at),
        })),
        ...refunds.map((row) => ({
          type: 'REFUND',
          id: row.id,
          title: row.reason || 'Refund',
          status: row.status,
          amount: Number(row.amount),
          date: iso(row.requested_at),
        })),
      ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      res.json({ items });
    }),
  );

  app.get(
    '/api/internal/stats',
    service,
    asyncHandler(async (_req, res) => {
      const payments = await count(pool, 'SELECT COUNT(*) AS value FROM payments');
      const { rows } = await pool.query('SELECT * FROM payments');
      const revenue = rows
        .filter((row) => row.status === 'PAID')
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const refunds = await count(pool, 'SELECT COUNT(*) AS value FROM refunds');
      res.json({ payments, revenue, refunds });
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
  const { rows } = await pool.query('SELECT COUNT(*) AS count FROM payments');
  if (Number(rows[0]?.count) > 0) return;

  const studentId = 'usr_demo_student';
  const now = Date.now();

  async function seedPayment({ amount, payableType, payableId, description, status, daysAgo }) {
    const id = uuid('pay');
    const createdAt = new Date(now - daysAgo * 86400000);
    await pool.query(
      `INSERT INTO payments(
         id, student_id, payable_type, payable_id, amount, description, status,
         created_at, updated_at, paid_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)`,
      [id, studentId, payableType, payableId, amount, description, status, createdAt],
    );
    const receiptId = uuid('rcp');
    await pool.query(
      `INSERT INTO receipts(id, payment_id, receipt_number, amount, issued_at)
       VALUES($1,$2,$3,$4,$5)`,
      [receiptId, id, receiptNumber(), amount, createdAt],
    );
    return id;
  }

  await seedPayment({
    amount: 120,
    payableType: 'ACCOMMODATION',
    payableId: 'bkg_demo_1',
    description: 'Accommodation deposit',
    status: 'PAID',
    daysAgo: 12,
  });
  await seedPayment({
    amount: 25.5,
    payableType: 'DINING',
    payableId: 'ord_demo_1',
    description: 'Dining meal plan order',
    status: 'PAID',
    daysAgo: 6,
  });
  const refundedPaymentId = await seedPayment({
    amount: 10,
    payableType: 'TRANSPORT',
    payableId: 'trb_demo_1',
    description: 'Campus shuttle pass',
    status: 'REFUNDED',
    daysAgo: 20,
  });
  await pool.query(
    `INSERT INTO refunds(
       id, payment_id, student_id, amount, reason, status, requested_at, processed_at, updated_at
     ) VALUES($1,$2,$3,$4,$5,'ISSUED',$6,$6,$6)`,
    [
      uuid('ref'),
      refundedPaymentId,
      studentId,
      10,
      'Trip cancelled',
      new Date(now - 15 * 86400000),
    ],
  );
}
