import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Errors and middleware
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message, details) {
  return new HttpError(400, message, details);
}

export function unauthorized(message = 'Authentication required') {
  return new HttpError(401, message);
}

export function forbidden(message = 'Not allowed') {
  return new HttpError(403, message);
}

export function notFound(message = 'Not found') {
  return new HttpError(404, message);
}

export function conflict(message = 'Conflict', details) {
  return new HttpError(409, message, details);
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Service-Token, X-Requested-With',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
}

export function healthRoutes(app, pool, service, peerUrls = {}) {
  app.get('/health', (_req, res) => res.json({ service, status: 'alive' }));
  app.get('/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ service, status: 'ready' });
    } catch {
      res.status(503).json({ service, status: 'unavailable' });
    }
  });
  app.get('/dependencies', async (_req, res) => {
    const checks = await Promise.all(
      Object.entries(peerUrls).map(async ([name, url]) => {
        try {
          const response = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(3000) });
          return [name, response.ok];
        } catch {
          return [name, false];
        }
      }),
    );
    const dependencies = Object.fromEntries(checks);
    res
      .status(Object.values(dependencies).every(Boolean) ? 200 : 503)
      .json({ service, dependencies });
  });
}

export function errorHandler(err, _req, res, _next) {
  const status = err instanceof HttpError ? err.status : 500;
  const body = {
    error: err instanceof HttpError ? err.message : 'Internal server error',
  };
  if (err instanceof HttpError && err.details) body.details = err.details;
  if (status >= 500) console.error(err);
  res.status(status).json(body);
}

// ---------------------------------------------------------------------------
// Authentication and passwords
// ---------------------------------------------------------------------------

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw badRequest('Password must contain at least 8 characters');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function signToken(user, secret, ttlSeconds = 60 * 60 * 12) {
  if (!secret) throw new Error('AUTH_SECRET is required');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'STUDENT',
    status: user.status || 'ACTIVE',
    clubId: user.clubId || user.club_id || null,
    iat: now,
    exp: now + ttlSeconds,
  };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token, secret) {
  if (!secret) throw new Error('AUTH_SECRET is required');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw unauthorized('Invalid token');
  const [header, body, signature] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw unauthorized('Invalid token');
  }
  let payload;
  try {
    payload = JSON.parse(fromBase64url(body));
  } catch {
    throw unauthorized('Invalid token');
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw unauthorized('Token expired');
  }
  if (payload.status && payload.status !== 'ACTIVE') {
    throw new HttpError(403, 'Account is not active');
  }
  return payload;
}

export function authenticate(secret, { required = true, roles = [] } = {}) {
  return (req, _res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token) {
        if (!required) return next();
        throw unauthorized();
      }
      const user = verifyToken(token, secret);
      if (roles.length && !roles.includes(user.role)) throw forbidden();
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireService(serviceToken) {
  return (req, _res, next) => {
    if (!serviceToken || req.headers['x-service-token'] !== serviceToken) {
      return next(forbidden('Service authentication required'));
    }
    return next();
  };
}

// ---------------------------------------------------------------------------
// Validation and small utilities
// ---------------------------------------------------------------------------

export function requireFields(body, fields) {
  const missing = fields.filter((field) => {
    const value = body?.[field];
    return value === undefined || value === null || String(value).trim() === '';
  });
  if (missing.length) throw badRequest(`Missing required field(s): ${missing.join(', ')}`);
}

export function isEmail(value) {
  return typeof value === 'string' && /^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(value);
}

export function toNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw badRequest(`Invalid number: ${value}`);
  return number;
}

export function toInt(value, fallback = null) {
  const number = toNumber(value, fallback);
  return number === null ? null : Math.trunc(number);
}

export function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (['true', '1', 'yes'].includes(String(value).toLowerCase())) return true;
  if (['false', '0', 'no'].includes(String(value).toLowerCase())) return false;
  throw badRequest(`Invalid boolean: ${value}`);
}

export function cleanString(value, max = 2000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function parseDate(value, field = 'date') {
  if (!value) throw badRequest(`${field} is required`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`Invalid ${field}`);
  return date;
}

export function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function uuid(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function parsePagination(query) {
  const limit = Math.min(Math.max(toInt(query.limit, 50) || 50, 1), 200);
  const offset = Math.max(toInt(query.offset, 0) || 0, 0);
  return { limit, offset };
}

export function csv(rows, columns) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Service-to-service HTTP helpers
// ---------------------------------------------------------------------------

export function createClient(config, fetchImpl = fetch) {
  async function request(baseUrl, path, options = {}) {
    if (!baseUrl) throw new Error(`No base URL configured for ${path}`);
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.service) headers['X-Service-Token'] = config.serviceToken;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeout || 5000),
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    if (!response.ok) {
      const error = new Error(body?.error || `Upstream ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  return {
    request,
    async charge({ studentId, payableType, payableId, amount, description }) {
      if (!config.paymentServiceUrl) throw new Error('Payment service is not configured');
      return request(config.paymentServiceUrl, '/api/internal/charges', {
        method: 'POST',
        service: true,
        body: { studentId, payableType, payableId, amount, description },
      });
    },
    async refund({ paymentId, studentId, amount, reason }) {
      if (!config.paymentServiceUrl) return null;
      try {
        return await request(config.paymentServiceUrl, '/api/internal/refunds', {
          method: 'POST',
          service: true,
          body: { paymentId, studentId, amount, reason },
        });
      } catch (error) {
        console.error('Refund failed', error.message);
        return null;
      }
    },
    async notify({ recipientId, type, title, body }) {
      if (!config.communicationServiceUrl) return null;
      try {
        return await request(config.communicationServiceUrl, '/api/internal/notifications', {
          method: 'POST',
          service: true,
          body: { recipientId, type, title, body },
        });
      } catch (error) {
        console.error('Notification failed', error.message);
        return null;
      }
    },
    async activity(baseUrl, studentId) {
      if (!baseUrl) return [];
      try {
        const result = await request(
          baseUrl,
          `/api/internal/activity?studentId=${encodeURIComponent(studentId)}`,
          { service: true },
        );
        return Array.isArray(result?.items) ? result.items : [];
      } catch {
        return [];
      }
    },
  };
}

export function serviceConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    authSecret: env.AUTH_SECRET || 'ssp-dev-auth-secret-change-me',
    serviceToken: env.SERVICE_TOKEN || 'ssp-dev-service-token',
    userServiceUrl: env.USER_SERVICE_URL || '',
    accommodationServiceUrl: env.ACCOMMODATION_SERVICE_URL || '',
    transportServiceUrl: env.TRANSPORT_SERVICE_URL || '',
    clubServiceUrl: env.CLUB_SERVICE_URL || '',
    diningServiceUrl: env.DINING_SERVICE_URL || '',
    communicationServiceUrl: env.COMMUNICATION_SERVICE_URL || '',
    libraryServiceUrl: env.LIBRARY_SERVICE_URL || '',
    paymentServiceUrl: env.PAYMENT_SERVICE_URL || '',
  };
}
