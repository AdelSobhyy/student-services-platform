/**
 * Student Services Platform - dependency-free single-page frontend.
 *
 * Talks to the eight backend services described in docs/service-api.md.
 * No framework, no build step, no external CDN.
 */
(function () {
  'use strict';

  /* ==========================================================================
     Configuration, storage, state
     ========================================================================== */

  var CONFIG = window.SSP_CONFIG || {};
  var SERVICES = CONFIG.services || {
    user: 'http://localhost:3001',
    accommodation: 'http://localhost:3002',
    transport: 'http://localhost:3003',
    club: 'http://localhost:3004',
    dining: 'http://localhost:3005',
    communication: 'http://localhost:3006',
    library: 'http://localhost:3007',
    payment: 'http://localhost:3008',
  };

  var STORAGE = { token: 'ssp.token', user: 'ssp.user' };

  var state = {
    token: null,
    user: null,
    view: 'dashboard',
    adminTab: 'users',
    authTab: 'login',
    authNotice: null,
    resetToken: '',
    renderSeq: 0,
    filters: {
      accommodation: {
        q: '',
        buildingId: '',
        minPrice: '',
        maxPrice: '',
        capacity: '',
        available: false,
      },
      transport: { q: '' },
      clubs: { q: '', category: '' },
      dining: { q: '', date: '' },
      library: { q: '', type: '', subject: '' },
    },
    data: {
      buildings: [],
      notifications: [],
      eventsById: {},
      eventContext: null,
      clubReport: null,
    },
  };

  var ROLES = ['STUDENT', 'STAFF', 'CLUB_LEADER', 'ADMIN'];
  var ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'];
  var ROOM_STATUSES = ['AVAILABLE', 'BOOKED', 'MAINTENANCE'];
  var TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

  /* ==========================================================================
     Tiny utilities
     ========================================================================== */

  function esc(value) {
    return String(value === undefined || value === null ? '' : value).replace(
      /[&<>"']/g,
      function (char) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[char];
      },
    );
  }

  function firstDefined(object, keys, fallback) {
    if (!object) return fallback;
    for (var i = 0; i < keys.length; i += 1) {
      var value = object[keys[i]];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  }

  function text(value, fallback) {
    var result = firstDefined({ value: value }, ['value'], fallback);
    return result === undefined || result === null || result === '' ? '' : String(result);
  }

  function truncate(value, maxLength) {
    var string = String(value || '').replace(/\s+/g, ' ').trim();
    if (!maxLength || string.length <= maxLength) return string;
    return string.slice(0, maxLength - 1).trimEnd() + '…';
  }

  function itemsOf(payload, key) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (key && Array.isArray(payload[key])) return payload[key];
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.data)) return payload.data;
    var found = Object.keys(payload).find(function (name) {
      return Array.isArray(payload[name]);
    });
    return found ? payload[found] : [];
  }

  function entityOf(payload, key) {
    if (payload && typeof payload === 'object' && payload[key]) return payload[key];
    return payload;
  }

  function settledValue(result, fallback) {
    return result && result.status === 'fulfilled' ? result.value : fallback;
  }

  function queryString(params) {
    var search = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === '' || value === false) return;
      search.set(key, String(value));
    });
    var result = search.toString();
    return result ? '?' + result : '';
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function dateOnly(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function dateTimeLocal(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16);
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return (
      date.getFullYear() +
      '-' +
      pad(date.getMonth() + 1) +
      '-' +
      pad(date.getDate()) +
      'T' +
      pad(date.getHours()) +
      ':' +
      pad(date.getMinutes())
    );
  }

  function toIso(value) {
    if (!value) return value;
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  function formatDate(value, includeTime) {
    if (!value) return '—';
    var raw = String(value);
    var date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(raw + 'T00:00:00')
      : new Date(value);
    if (Number.isNaN(date.getTime())) return raw;
    var options = { year: 'numeric', month: 'short', day: 'numeric' };
    if (includeTime !== false) options.hour = '2-digit';
    if (includeTime !== false) options.minute = '2-digit';
    try {
      return new Intl.DateTimeFormat(undefined, options).format(date);
    } catch (error) {
      return date.toLocaleString();
    }
  }

  function formatMoney(value, currency) {
    if (value === undefined || value === null || value === '') return '—';
    var amount = Number(value);
    if (!Number.isFinite(amount)) return esc(value);
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: 2,
      }).format(amount);
    } catch (error) {
      return '$' + amount.toFixed(2);
    }
  }

  function humanize(value) {
    var special = {
      CLUB_LEADER: 'Club leader',
      OUT_OF_STOCK: 'Out of stock',
      IN_PROGRESS: 'In progress',
      PRINTED_BOOK: 'Printed book',
      DIGITAL: 'Digital resource',
      PENDING: 'Pending',
      APPROVED: 'Approved',
      REJECTED: 'Rejected',
      SUSPENDED: 'Suspended',
      ACTIVE: 'Active',
      INACTIVE: 'Inactive',
      DEACTIVATED: 'Deactivated',
      AVAILABLE: 'Available',
      UNAVAILABLE: 'Unavailable',
      MAINTENANCE: 'Maintenance',
      BOOKED: 'Booked',
      CONFIRMED: 'Confirmed',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled',
      FAILED: 'Failed',
      CREATED: 'Created',
      PAID: 'Paid',
      REFUNDED: 'Refunded',
      REQUESTED: 'Requested',
      ISSUED: 'Issued',
      OPEN: 'Open',
      RESOLVED: 'Resolved',
      RESERVED: 'Reserved',
      COLLECTED: 'Collected',
      RETURNED: 'Returned',
      EXPIRED: 'Expired',
      LEFT: 'Left',
      STUDENT: 'Student',
      STAFF: 'Staff',
      ADMIN: 'Administrator',
    };
    var key = String(value === undefined || value === null ? '' : value)
      .trim()
      .toUpperCase();
    if (special[key]) return special[key];
    return key
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
      });
  }

  function statusTone(value) {
    var key = String(value || '').toUpperCase();
    if (
      ['ACTIVE', 'APPROVED', 'CONFIRMED', 'COMPLETED', 'PAID', 'ISSUED', 'RESOLVED', 'RETURNED', 'COLLECTED', 'AVAILABLE'].indexOf(key) >= 0
    ) {
      return 'success';
    }
    if (['PENDING', 'REQUESTED', 'IN_PROGRESS', 'OPEN', 'RESERVED'].indexOf(key) >= 0) return 'warning';
    if (
      ['FAILED', 'REJECTED', 'CANCELLED', 'DEACTIVATED', 'SUSPENDED', 'OUT_OF_STOCK', 'MAINTENANCE', 'EXPIRED'].indexOf(key) >= 0
    ) {
      return 'danger';
    }
    if (['REFUNDED'].indexOf(key) >= 0) return 'info';
    return 'neutral';
  }

  function badge(value) {
    if (!value) return '';
    return '<span class="badge badge-' + statusTone(value) + '">' + esc(humanize(value)) + '</span>';
  }

  function stripHtml(value) {
    return String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (part) {
        return part.charAt(0).toUpperCase();
      })
      .join('');
  }

  function arrayOf(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return String(value)
      .split(',')
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
  }

  function tagList(values) {
    var list = arrayOf(values);
    if (!list.length) return '<span class="muted small">None listed</span>';
    return (
      '<ul class="tag-list">' +
      list
        .map(function (tag) {
          return '<li class="tag">' + esc(tag) + '</li>';
        })
        .join('') +
      '</ul>'
    );
  }

  function options(values, selected, labels) {
    return values
      .map(function (value) {
        return (
          '<option value="' +
          esc(value) +
          '"' +
          (String(value) === String(selected) ? ' selected' : '') +
          '>' +
          esc(labels && labels[value] ? labels[value] : humanize(value)) +
          '</option>'
        );
      })
      .join('');
  }

  function truncateId(value) {
    if (!value) return '—';
    var string = String(value);
    return string.length > 18 ? string.slice(0, 8) + '…' + string.slice(-4) : string;
  }

  function errorText(error) {
    var message = error && error.message ? error.message : 'Something went wrong.';
    if (error && error.details) {
      if (Array.isArray(error.details)) message += ' ' + error.details.join('; ');
      else if (typeof error.details === 'string') message += ' ' + error.details;
      else if (typeof error.details === 'object') message += ' ' + JSON.stringify(error.details);
    }
    return message;
  }

  /* ==========================================================================
     API
     ========================================================================== */

  function ApiError(status, message, details) {
    this.name = 'ApiError';
    this.status = status;
    this.message = message;
    this.details = details || null;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function api(service, path, options) {
    var settings = options || {};
    var base = SERVICES[service];
    var method = settings.method || 'GET';
    if (!base) return Promise.reject(new ApiError(0, 'Unknown service: ' + service));

    var url = /^https?:\/\//i.test(path) ? path : base + path;
    var headers = {};
    if (settings.body !== undefined && settings.body !== null) {
      headers['Content-Type'] = 'application/json';
    }
    if (state.token && settings.auth !== false) {
      headers.Authorization = 'Bearer ' + state.token;
    }
    if (settings.headers) {
      Object.keys(settings.headers).forEach(function (key) {
        headers[key] = settings.headers[key];
      });
    }

    return fetch(url, {
      method: method,
      headers: headers,
      body:
        settings.body === undefined || settings.body === null
          ? undefined
          : JSON.stringify(settings.body),
    })
      .catch(function () {
        var networkError = new ApiError(
          0,
          'Cannot reach the ' +
            service +
            ' service at ' +
            base +
            '. Make sure the service is running and reachable from this browser.',
        );
        networkError.service = service;
        networkError.url = url;
        throw networkError;
      })
      .then(function (response) {
        var contentType = response.headers.get('content-type') || '';
        var parse = contentType.indexOf('application/json') >= 0
          ? response.json().catch(function () {
              return null;
            })
          : response.text().catch(function () {
              return '';
            });

        return parse.then(function (payload) {
          if (response.status === 401 && state.token) {
            expireSession(
              'Your session has expired or is no longer valid. Please sign in again.',
            );
          }
          if (!response.ok) {
            var message =
              payload && typeof payload === 'object' && payload.error
                ? payload.error
                : typeof payload === 'string' && payload.trim()
                  ? payload.trim().slice(0, 300)
                  : 'Request failed with status ' + response.status;
            var failure = new ApiError(
              response.status,
              message,
              payload && typeof payload === 'object' ? payload.details : null,
            );
            failure.service = service;
            failure.url = url;
            throw failure;
          }
          return payload;
        });
      });
  }

  /* ==========================================================================
     Session helpers
     ========================================================================== */

  function loadSession() {
    try {
      state.token = localStorage.getItem(STORAGE.token) || null;
      var rawUser = localStorage.getItem(STORAGE.user);
      state.user = rawUser ? JSON.parse(rawUser) : null;
    } catch (error) {
      state.token = null;
      state.user = null;
    }
    if (state.token && !state.user) {
      state.user = userFromToken(state.token);
    }
  }

  function saveSession(token, user) {
    state.token = token || null;
    state.user = user || null;
    try {
      if (token) localStorage.setItem(STORAGE.token, token);
      else localStorage.removeItem(STORAGE.token);
      if (user) localStorage.setItem(STORAGE.user, JSON.stringify(user));
      else localStorage.removeItem(STORAGE.user);
    } catch (error) {
      /* Private browsing may reject storage; the in-memory session still works. */
    }
  }

  function clearSession() {
    state.token = null;
    state.user = null;
    try {
      localStorage.removeItem(STORAGE.token);
      localStorage.removeItem(STORAGE.user);
    } catch (error) {
      /* ignore */
    }
  }

  function userFromToken(token) {
    try {
      var part = String(token).split('.')[1];
      if (!part) return null;
      var normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      var padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      var payload = JSON.parse(atob(padded));
      return {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        status: payload.status,
        clubId: payload.clubId || null,
      };
    } catch (error) {
      return null;
    }
  }

  function tokenExpired(token) {
    try {
      var part = String(token).split('.')[1];
      if (!part) return false;
      var normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      var padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      var payload = JSON.parse(atob(padded));
      return Boolean(payload.exp && payload.exp * 1000 < Date.now() + 5000);
    } catch (error) {
      return false;
    }
  }

  function expireSession(message) {
    if (!state.token && !state.user) return;
    clearSession();
    closeModal();
    state.authTab = 'login';
    state.authNotice = { type: 'warning', text: message || 'Please sign in again.' };
    if (location.hash !== '#/login') {
      history.replaceState(null, '', '#/login');
    }
    renderAuth();
  }

  function isAdmin() {
    return Boolean(state.user && String(state.user.role).toUpperCase() === 'ADMIN');
  }

  function isClubLeader() {
    return Boolean(state.user && String(state.user.role).toUpperCase() === 'CLUB_LEADER');
  }

  function userClubId() {
    return state.user ? state.user.clubId || state.user.club_id || null : null;
  }

  function canManageClub(club) {
    if (!club || !state.user) return false;
    if (isAdmin()) return true;
    return (
      isClubLeader() &&
      userClubId() &&
      String(userClubId()) === String(club.id)
    );
  }

  /* ==========================================================================
     UI primitives: icons, toast, modal, loading, messages
     ========================================================================== */

  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bed: '<path d="M3 18v-7a2 2 0 0 1 2-2h12a4 4 0 0 1 4 4v5"/><path d="M3 18h18"/><path d="M6 9V6h6v3"/>',
    bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    utensils: '<path d="M4 3v7a3 3 0 0 0 3 3 3 3 0 0 0 3-3V3"/><path d="M7 13v8"/><path d="M17 3v18"/><path d="M17 3c3 1 3 5 0 6"/>',
    life: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.8 3.8M14.6 14.6l3.8 3.8M18.4 5.6l-3.8 3.8M9.4 14.6l-3.8 3.8"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
    shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 17h.01"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
  };

  function icon(name, className) {
    var paths = ICONS[name] || ICONS.info;
    return (
      '<svg class="icon ' +
      (className || '') +
      '" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      paths +
      '</svg>'
    );
  }

  function toast(message, type) {
    var region = document.getElementById('toast-region');
    if (!region) return;
    var node = document.createElement('div');
    node.className = 'toast toast-' + (type || 'success');
    node.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check';
    node.innerHTML = icon(iconName, 'icon-sm');
    var textNode = document.createElement('span');
    textNode.textContent = message;
    node.appendChild(textNode);
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss message');
    close.textContent = '×';
    close.addEventListener('click', function () {
      node.remove();
    });
    node.appendChild(close);
    region.appendChild(node);
    window.setTimeout(function () {
      if (node.isConnected) node.remove();
    }, 6500);
  }

  function notifyError(error) {
    toast(errorText(error), 'error');
  }

  function loadingBlock(label) {
    return (
      '<div class="loading-panel" role="status" aria-live="polite">' +
      '<span class="spinner" aria-hidden="true"></span><span>' +
      esc(label || 'Loading…') +
      '</span></div>'
    );
  }

  function emptyState(title, body, iconName) {
    return (
      '<div class="empty">' +
      '<span class="empty-icon">' +
      icon(iconName || 'info', 'icon-sm') +
      '</span><strong>' +
      esc(title) +
      '</strong>' +
      (body ? '<p>' + esc(body) + '</p>' : '') +
      '</div>'
    );
  }

  function errorPanel(error) {
    var hint =
      error && error.status === 0
        ? '<p class="small">The browser could not connect. Check that the service is running, that the port is reachable, and that this page is not blocked by CORS or mixed-content rules.</p>'
        : '';
    return (
      '<div class="notice notice-error" role="alert">' +
      icon('alert') +
      '<div><strong>Could not load this section.</strong><p>' +
      esc(errorText(error)) +
      '</p>' +
      hint +
      '<div class="form-actions"><button class="btn btn-sm" type="button" data-action="retry">' +
      icon('refresh', 'icon-sm') +
      'Try again</button></div></div></div>'
    );
  }

  function formMessage(form, message, type) {
    if (!form) return;
    var box = form.querySelector('.form-message');
    if (!box) {
      box = document.createElement('div');
      box.className = 'form-message';
      box.setAttribute('role', 'alert');
      form.insertBefore(box, form.firstChild);
    }
    box.className = 'form-message ' + (type || 'error');
    box.textContent = message;
  }

  function clearFormMessage(form) {
    var box = form && form.querySelector('.form-message');
    if (box) {
      box.className = 'form-message';
      box.textContent = '';
    }
  }

  function setFormBusy(form, busy, label) {
    if (!form) return;
    var button = form.querySelector('button[type="submit"]');
    if (busy) {
      form.setAttribute('aria-busy', 'true');
      if (button) {
        if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML =
          '<span class="spinner spinner-light" aria-hidden="true"></span><span>' +
          esc(label || 'Working…') +
          '</span>';
      }
    } else {
      form.removeAttribute('aria-busy');
      if (button && button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        button.disabled = false;
        delete button.dataset.originalHtml;
      }
    }
  }

  function withButtonBusy(button, task) {
    if (!button || button.disabled) return Promise.resolve();
    var original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
    return Promise.resolve()
      .then(task)
      .finally(function () {
        if (button.isConnected) {
          button.disabled = false;
          button.innerHTML = original;
        }
      });
  }

  function readForm(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      data[key] = typeof value === 'string' ? value.trim() : value;
    });
    return data;
  }

  /* ==========================================================================
     Modal
     ========================================================================== */

  var activeModal = null;

  function closeModal() {
    var root = document.getElementById('modal-root');
    if (!root) return;
    var previousFocus = activeModal && activeModal.previousFocus;
    root.innerHTML = '';
    document.body.classList.remove('modal-open');
    activeModal = null;
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
    }
  }

  function openModal(options) {
    var settings = options || {};
    closeModal();
    var root = document.getElementById('modal-root');
    var previousFocus = document.activeElement;

    root.innerHTML =
      '<div class="modal-backdrop" data-modal-backdrop>' +
      '<div class="modal ' +
      (settings.size === 'lg' ? 'modal-lg' : settings.size === 'sm' ? 'modal-sm' : '') +
      '" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">' +
      '<div class="modal-header"><div><h2 id="modal-title">' +
      esc(settings.title || 'Details') +
      '</h2>' +
      (settings.subtitle ? '<p>' + esc(settings.subtitle) + '</p>' : '') +
      '</div><button type="button" class="modal-close" data-modal-close aria-label="Close dialog">' +
      icon('x', 'icon-sm') +
      '</button></div>' +
      '<div class="modal-body" id="modal-body">' +
      (settings.body || '') +
      '</div></div></div>';

    var backdrop = root.querySelector('[data-modal-backdrop]');
    var dialog = root.querySelector('.modal');
    var body = root.querySelector('.modal-body');
    document.body.classList.add('modal-open');

    function keydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      var focusable = dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onRootClick(event) {
      if (event.target.closest('[data-modal-close]')) {
        closeModal();
        return;
      }
      if (event.target === backdrop) closeModal();
    }

    root.addEventListener('click', onRootClick);
    document.addEventListener('keydown', keydown);

    var modal = {
      root: root,
      dialog: dialog,
      body: body,
      previousFocus: previousFocus,
      setBody: function (html) {
        body.innerHTML = html;
      },
      setTitle: function (title) {
        var heading = dialog.querySelector('#modal-title');
        if (heading) heading.textContent = title;
      },
      close: closeModal,
    };
    activeModal = modal;

    var firstFocus =
      body.querySelector(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]',
      ) || dialog;
    window.setTimeout(function () {
      if (firstFocus && firstFocus.isConnected) firstFocus.focus();
    }, 30);
    return modal;
  }

  function confirmDialog(options, onConfirm) {
    var settings = options || {};
    var modal = openModal({
      title: settings.title || 'Please confirm',
      size: 'sm',
      body:
        '<p>' +
        esc(settings.message || 'Are you sure?') +
        '</p><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button>' +
        '<button type="button" class="btn ' +
        (settings.danger ? 'btn-danger-solid' : 'btn-primary') +
        '" id="confirm-dialog-action">' +
        esc(settings.confirmLabel || 'Confirm') +
        '</button></div>',
    });
    var button = modal.body.querySelector('#confirm-dialog-action');
    button.addEventListener('click', function () {
      withButtonBusy(button, function () {
        return Promise.resolve(onConfirm()).then(function () {
          modal.close();
        }).catch(function (error) {
          notifyError(error);
        });
      });
    });
  }

  /* ==========================================================================
     HTML helpers
     ========================================================================== */

  function table(headers, rows, caption) {
    return (
      '<div class="table-wrap"><table class="data-table">' +
      (caption ? '<caption>' + esc(caption) + '</caption>' : '') +
      '<thead><tr>' +
      headers
        .map(function (heading) {
          return '<th scope="col">' + esc(heading) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      (rows.length ? rows.join('') : '<tr><td colspan="' + headers.length + '">No records.</td></tr>') +
      '</tbody></table></div>'
    );
  }

  function pageHead(options) {
    return (
      '<div class="view-head"><div><p class="eyebrow">' +
      esc(options.eyebrow || 'Student services') +
      '</p><h1 class="page-title">' +
      esc(options.title || '') +
      '</h1>' +
      (options.subtitle ? '<p class="page-sub">' + esc(options.subtitle) + '</p>' : '') +
      '</div>' +
      (options.actions ? '<div class="view-actions">' + options.actions + '</div>' : '') +
      '</div>'
    );
  }

  function metaItem(label, value) {
    return '<div class="meta-item"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>';
  }

  function metaRow(label, value) {
    return (
      '<div class="meta-row"><span>' +
      esc(label) +
      '</span><span>' +
      (value === undefined || value === null || value === '' ? '—' : value) +
      '</span></div>'
    );
  }

  function userLabel(user) {
    return text(firstDefined(user, ['name', 'email'], 'Student'));
  }

  function semesterParts(payload) {
    var root = payload || {};
    var value =
      (root.semester && typeof root.semester === 'object' && root.semester) ||
      (root.settings && typeof root.settings === 'object' && root.settings) ||
      root;
    return {
      startDate: firstDefined(value, ['startDate', 'start_date', 'start'], ''),
      endDate: firstDefined(value, ['endDate', 'end_date', 'end'], ''),
    };
  }

  /* ==========================================================================
     View building blocks
     ========================================================================== */

  function panel(title, body, options) {
    var settings = options || {};
    return (
      '<section class="panel' +
      (settings.className ? ' ' + settings.className : '') +
      '"' +
      (settings.id ? ' id="' + esc(settings.id) + '"' : '') +
      '>' +
      '<div class="panel-head"><div><h2 class="panel-title">' +
      esc(title) +
      '</h2>' +
      (settings.subtitle ? '<p class="panel-sub">' + esc(settings.subtitle) + '</p>' : '') +
      '</div>' +
      (settings.actions ? '<div class="row">' + settings.actions + '</div>' : '') +
      '</div>' +
      '<div class="panel-body">' +
      body +
      '</div>' +
      (settings.foot ? '<div class="panel-foot">' + settings.foot + '</div>' : '') +
      '</section>'
    );
  }

  function panelResult(result, title, renderBody, subtitle, options) {
    return panel(
      title,
      result.status === 'fulfilled' ? renderBody(result.value) : errorPanel(result.reason),
      Object.assign({ subtitle: subtitle }, options || {}),
    );
  }

  function listOf(payload, key) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload[key])) return payload[key];
    var found = Object.keys(payload).find(function (name) {
      return Array.isArray(payload[name]);
    });
    return found ? payload[found] : [];
  }

  function entityOfPayload(payload, key) {
    if (!payload || typeof payload !== 'object') return null;
    return payload[key] || null;
  }

  function numberOrZero(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function splitInput(value) {
    if (Array.isArray(value)) return value.map(String).map(function (part) { return part.trim(); }).filter(Boolean);
    return String(value || '')
      .split(/[,\n]/)
      .map(function (part) { return part.trim(); })
      .filter(Boolean);
  }

  function asNumber(value, fallback) {
    if (value === '' || value === undefined || value === null) return fallback;
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function activityList(items, limit) {
    var rows = (items || []).slice(0, limit || 12);
    if (!rows.length) return emptyState('No activity yet', 'Actions you take will appear here.', 'activity');
    return (
      '<ul class="activity-list">' +
      rows
        .map(function (item) {
          return (
            '<li class="activity-item"><span class="timeline-dot" aria-hidden="true"></span>' +
            '<div class="activity-main"><div class="activity-title">' +
            esc(item.title || humanize(item.type || 'Activity')) +
            '</div>' +
            (item.description ? '<p class="small">' + esc(item.description) + '</p>' : '') +
            '<div class="activity-meta">' +
            (item.source ? '<span class="badge badge-info">' + esc(humanize(item.source)) + '</span>' : '') +
            (item.status ? badge(item.status) : '') +
            (item.amount !== undefined && item.amount !== null
              ? '<span>' + formatMoney(item.amount) + '</span>'
              : '') +
            (item.rating ? '<span>' + esc(item.rating) + '/5</span>' : '') +
            '<span>' + esc(formatDate(item.date)) + '</span>' +
            '</div></div></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function filterForm(name, fields, values) {
    var current = values || {};
    var controls = fields
      .map(function (field) {
        var value = current[field.name] === undefined || current[field.name] === null ? '' : current[field.name];
        if (field.type === 'checkbox') {
          return (
            '<label class="checkbox"><input type="checkbox" name="' +
            esc(field.name) +
            '"' +
            (value === 'true' || value === true ? ' checked' : '') +
            '/>' +
            esc(field.label) +
            '</label>'
          );
        }
        if (field.type === 'select') {
          return (
            '<div class="field"><label for="filter-' +
            esc(field.name) +
            '">' +
            esc(field.label) +
            '</label><select class="select" id="filter-' +
            esc(field.name) +
            '" name="' +
            esc(field.name) +
            '">' +
            options(field.options || [], value, field.labels) +
            '</select></div>'
          );
        }
        return (
          '<div class="field"><label for="filter-' +
          esc(field.name) +
          '">' +
          esc(field.label) +
          '</label><input class="input" id="filter-' +
          esc(field.name) +
          '" name="' +
          esc(field.name) +
          '" type="' +
          (field.type || 'text') +
          '"' +
          (field.step ? ' step="' + esc(field.step) + '"' : '') +
          (field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '') +
          ' value="' +
          esc(value) +
          '"/></div>'
        );
      })
      .join('');
    return (
      '<form class="filters" data-form="filter-' +
      esc(name) +
      '"><div class="filter-grid">' +
      controls +
      '<div class="filter-actions"><button class="btn btn-primary" type="submit">' +
      icon('search', 'icon-sm') +
      'Apply</button><button class="btn" type="button" data-action="reset-filter" data-filter="' +
      esc(name) +
      '">Clear</button></div>' +
      '</div></form>'
    );
  }

  function filterValues(name) {
    return (state.filters || {})[name] || {};
  }

  function filterQuery(values, allowed) {
    var params = {};
    Object.keys(values || {}).forEach(function (key) {
      var value = values[key];
      if (value !== '' && value !== undefined && value !== null && (!allowed || allowed.indexOf(key) >= 0)) {
        params[key] = value;
      }
    });
    return queryString(params);
  }

  function detailRow(label, value) {
    return '<div class="meta-row"><span>' + esc(label) + '</span><span>' + (value === undefined || value === null || value === '' ? '—' : value) + '</span></div>';
  }

  function renderStars(rating) {
    var score = Math.max(0, Math.min(5, Math.round(numberOrZero(rating))));
    return (
      '<span class="rating" aria-label="' +
      score +
      ' out of 5 stars"><span class="stars">' +
      '★★★★★'.slice(0, score) +
      '</span><span class="muted">' +
      '☆☆☆☆☆'.slice(0, 5 - score) +
      '</span> <strong>' +
      score +
      '/5</strong></span>'
    );
  }

  /* ==========================================================================
     Application shell and routing
     ========================================================================== */

  var NAV_GROUPS = [
    {
      label: 'Overview',
      items: [{ view: 'dashboard', label: 'Dashboard', icon: 'grid' }],
    },
    {
      label: 'Campus services',
      items: [
        { view: 'accommodation', label: 'Accommodation', icon: 'bed' },
        { view: 'transport', label: 'Transport', icon: 'bus' },
        { view: 'clubs', label: 'Clubs & events', icon: 'users' },
        { view: 'dining', label: 'Dining', icon: 'utensils' },
        { view: 'library', label: 'Library', icon: 'book' },
      ],
    },
    {
      label: 'Account',
      items: [
        { view: 'notifications', label: 'Notifications', icon: 'bell' },
        { view: 'tickets', label: 'Support tickets', icon: 'life' },
        { view: 'payments', label: 'Payments', icon: 'card' },
        { view: 'profile', label: 'My profile', icon: 'user' },
      ],
    },
    {
      label: 'Administration',
      admin: true,
      items: [
        { view: 'admin', label: 'Admin console', icon: 'shield' },
        { view: 'analytics', label: 'Analytics & reports', icon: 'grid' },
        { view: 'settings', label: 'Settings', icon: 'calendar' },
      ],
    },
  ];

  var VIEW_TITLES = {
    dashboard: 'Dashboard',
    accommodation: 'Accommodation',
    transport: 'Transport',
    clubs: 'Clubs & events',
    dining: 'Dining',
    library: 'Library',
    notifications: 'Notifications',
    tickets: 'Support tickets',
    payments: 'Payments',
    profile: 'My profile',
    admin: 'Admin console',
    analytics: 'Analytics & reports',
    settings: 'Settings',
  };

  function currentRoute() {
    var raw = String(location.hash || '').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    var view = parts.shift() || 'dashboard';
    if (!VIEW_TITLES[view]) view = 'dashboard';
    return { view: view, param: parts.join('/') };
  }

  function navHref(view, param) {
    return '#/' + view + (param ? '/' + param : '');
  }

  function renderShell() {
    var user = state.user || {};
    var nav = NAV_GROUPS.filter(function (group) {
      return !group.admin || isAdmin();
    })
      .map(function (group) {
        return (
          '<div class="nav-group"><p class="nav-label">' +
          esc(group.label) +
          '</p>' +
          group.items
            .map(function (item) {
              return (
                '<a class="nav-link" href="' +
                navHref(item.view) +
                '" data-view="' +
                esc(item.view) +
                '">' +
                icon(item.icon, 'icon-sm') +
                '<span>' +
                esc(item.label) +
                '</span></a>'
              );
            })
            .join('') +
          '</div>'
        );
      })
      .join('');

    document.getElementById('app').innerHTML =
      '<div class="shell">' +
      '<header class="topbar"><a class="brand" href="#/dashboard">' +
      '<span class="brand-mark">' +
      icon('grid', 'icon-sm') +
      '</span><span class="brand-text"><span>Student Services</span><span>Campus platform</span></span></a>' +
      '<div class="topbar-actions">' +
      '<a class="btn btn-ghost btn-sm" href="#/notifications" aria-label="Notifications">' +
      icon('bell', 'icon-sm') +
      ' <span id="nav-unread">Alerts</span></a>' +
      '<a class="user-chip" href="#/profile"><span class="avatar">' +
      esc(initials(user.name)) +
      '</span><span class="user-chip-text"><span class="user-chip-name">' +
      esc(userLabel(user)) +
      '</span><span class="user-chip-role">' +
      esc(humanize(user.role || 'Student')) +
      '</span></span></a>' +
      '<button class="btn btn-icon btn-ghost" type="button" data-action="logout" aria-label="Sign out" title="Sign out">' +
      icon('logout', 'icon-sm') +
      '</button></div></header>' +
      '<div class="workspace"><aside class="sidebar">' +
      nav +
      '<div class="sidebar-note"><strong>Need help?</strong>Use support tickets for any campus service issue. Admins can view all requests.</div>' +
      '</aside><main class="main" id="main-content" tabindex="-1">' +
      loadingBlock() +
      '</main></div></div>';
    updateNav();
  }

  function updateNav() {
    var links = document.querySelectorAll('.nav-link[data-view]');
    Array.prototype.forEach.call(links, function (link) {
      if (link.dataset.view === state.view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function refreshUnread() {
    if (!state.token) return;
    api('communication', '/api/notifications?unread=true')
      .then(function (payload) {
        var badge = document.getElementById('nav-unread');
        if (!badge) return;
        var count = listOf(payload, 'items').length;
        badge.textContent = count ? count + ' unread' : 'Alerts';
      })
      .catch(function () {
        /* The dashboard and notification view report their own errors. */
      });
  }

  function renderRoute() {
    var seq = ++state.renderSeq;
    var route = currentRoute();

    if (!state.token) {
      renderAuth(state.authTab === 'register' || state.authTab === 'recover' || state.authTab === 'reset' ? state.authTab : 'login');
      return;
    }
    if (route.view === 'login') {
      location.replace(navHref('dashboard'));
      return;
    }

    state.view = route.view;
    if (route.param) state.adminTab = route.param;
    renderShell();

    var loader = VIEWS[state.view] || renderDashboard;
    Promise.resolve()
      .then(loader)
      .then(function (html) {
        if (seq !== state.renderSeq) return;
        var main = document.getElementById('main-content');
        if (main) main.innerHTML = '<div class="view">' + html + '</div>';
      })
      .catch(function (error) {
        if (seq !== state.renderSeq) return;
        var main = document.getElementById('main-content');
        if (main) main.innerHTML = '<div class="view">' + errorPanel(error) + '</div>';
      });
    refreshUnread();
  }

  function go(view, param) {
    var target = navHref(view, param);
    if (location.hash === target) renderRoute();
    else location.hash = target;
  }

  function refresh() {
    renderRoute();
  }

  /* ==========================================================================
     Authentication screens (FR1)
     ========================================================================== */

  var DEMO_ACCOUNTS = [
    { role: 'Administrator', email: 'admin@campus.edu', password: 'Admin123!' },
    { role: 'Student', email: 'student@campus.edu', password: 'Student123!' },
    { role: 'Club leader', email: 'leader@campus.edu', password: 'Leader123!' },
    { role: 'Staff', email: 'staff@campus.edu', password: 'Staff123!' },
  ];

  function authFormHtml(tab) {
    if (tab === 'register') {
      return (
        '<form class="auth-form" data-form="auth-register">' +
        '<div class="field"><label for="auth-name">Full name</label><input class="input" id="auth-name" name="name" autocomplete="name" required /></div>' +
        '<div class="field"><label for="auth-email">Email address</label><input class="input" id="auth-email" name="email" type="email" autocomplete="email" required /></div>' +
        '<div class="field"><label for="auth-password">Password</label><input class="input" id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" required /><p class="field-hint">At least 8 characters.</p></div>' +
        '<button class="btn btn-primary btn-block" type="submit">Create student account</button></form>'
      );
    }
    if (tab === 'recover') {
      return (
        '<form class="auth-form" data-form="auth-recover">' +
        '<div class="field"><label for="auth-email">Email address</label><input class="input" id="auth-email" name="email" type="email" autocomplete="email" required /></div>' +
        '<button class="btn btn-primary btn-block" type="submit">Send recovery token</button></form>'
      );
    }
    if (tab === 'reset') {
      return (
        '<form class="auth-form" data-form="auth-reset">' +
        '<div class="field"><label for="auth-token">Recovery token</label><input class="input" id="auth-token" name="token" required /><p class="field-hint">Use the token shown after requesting recovery.</p></div>' +
        '<div class="field"><label for="auth-password">New password</label><input class="input" id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" required /></div>' +
        '<button class="btn btn-primary btn-block" type="submit">Reset password</button></form>'
      );
    }
    return (
      '<form class="auth-form" data-form="auth-login">' +
      '<div class="field"><label for="auth-email">Email address</label><input class="input" id="auth-email" name="email" type="email" autocomplete="username" value="student@campus.edu" required /></div>' +
      '<div class="field"><label for="auth-password">Password</label><input class="input" id="auth-password" name="password" type="password" autocomplete="current-password" value="Student123!" required /></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Sign in</button></form>'
    );
  }

  function authCopy(tab) {
    if (tab === 'register') return { title: 'Create your account', body: 'Register as a student to access every campus service.' };
    if (tab === 'recover') return { title: 'Recover password', body: 'We will issue a demo recovery token for your account.' };
    if (tab === 'reset') return { title: 'Choose a new password', body: 'Enter the recovery token and your new password.' };
    return { title: 'Welcome back', body: 'Sign in to manage housing, transport, clubs, dining and more.' };
  }

  function renderAuth(tab) {
    state.authTab = tab || 'login';
    var copy = authCopy(state.authTab);
    var tabs = [
      { key: 'login', label: 'Sign in' },
      { key: 'register', label: 'Register' },
      { key: 'recover', label: 'Recover' },
      { key: 'reset', label: 'Reset' },
    ];
    document.getElementById('app').innerHTML =
      '<main class="auth-page"><section class="auth-brand"><div class="auth-brand-inner">' +
      '<a class="brand" href="#/login"><span class="brand-mark">' +
      icon('grid', 'icon-sm') +
      '</span><span class="brand-text"><span>Student Services</span><span>Campus platform</span></span></a>' +
      '<h1>One place for every campus service.</h1>' +
      '<p>Book a room, catch a bus, join a club, order lunch, find library resources and manage payments.</p>' +
      '<ul class="auth-features">' +
      [
        ['bed', 'Accommodation & transport bookings'],
        ['users', 'Clubs, events and support tickets'],
        ['card', 'Payments, receipts and refunds'],
      ]
        .map(function (feature) {
          return '<li><span class="feature-dot">' + icon(feature[0], 'icon-sm') + '</span>' + esc(feature[1]) + '</li>';
        })
        .join('') +
      '</ul></div><div class="auth-brand-foot">Student Services Platform · Full-stack demonstration</div></section>' +
      '<section class="auth-panel"><div class="auth-card"><h2>' +
      esc(copy.title) +
      '</h2><p>' +
      esc(copy.body) +
      '</p><div class="auth-tabs" role="tablist">' +
      tabs
        .map(function (item) {
          return (
            '<button class="auth-tab" type="button" role="tab" data-action="auth-tab" data-tab="' +
            item.key +
            '" aria-selected="' +
            (state.authTab === item.key ? 'true' : 'false') +
            '">' +
            esc(item.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      (state.authNotice
        ? '<div class="notice notice-warning auth-notice" role="status">' +
          icon('alert') +
          '<div>' +
          esc(state.authNotice.text) +
          '</div></div>'
        : '') +
      authFormHtml(state.authTab) +
      '<div class="demo-accounts"><strong>Demo accounts</strong><br />' +
      DEMO_ACCOUNTS.map(function (account) {
        return (
          '<div class="row" style="justify-content:space-between"><span>' +
          esc(account.role) +
          '</span><button class="btn btn-sm btn-ghost" type="button" data-action="demo-login" data-email="' +
          esc(account.email) +
          '" data-password="' +
          esc(account.password) +
          '">' +
          esc(account.email) +
          '</button></div>'
        );
      }).join('') +
      '</div><p class="auth-footnote">Passwords are prefilled so you can sign in with one click.</p></div></section></main>';
  }

  /* ==========================================================================
     Dashboard (FR2 overview)
     ========================================================================== */

  function renderDashboard() {
    var requests = [
      api('user', '/api/users/me/activity'),
      api('communication', '/api/announcements'),
      api('accommodation', '/api/bookings'),
      api('transport', '/api/bookings'),
      api('dining', '/api/orders'),
      api('library', '/api/reservations'),
      api('payment', '/api/payments'),
      api('communication', '/api/notifications?unread=true'),
    ];
    return Promise.allSettled(requests).then(function (results) {
      var activity = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var announcements = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var stays = results[2].status === 'fulfilled' ? listOf(results[2].value, 'items') : [];
      var trips = results[3].status === 'fulfilled' ? listOf(results[3].value, 'items') : [];
      var orders = results[4].status === 'fulfilled' ? listOf(results[4].value, 'items') : [];
      var reservations = results[5].status === 'fulfilled' ? listOf(results[5].value, 'items') : [];
      var payments = results[6].status === 'fulfilled' ? listOf(results[6].value, 'items') : [];
      var unread = results[7].status === 'fulfilled' ? listOf(results[7].value, 'items') : [];

      var quick = [
        { view: 'accommodation', icon: 'bed', label: 'Accommodation', hint: 'Rooms & bookings' },
        { view: 'transport', icon: 'bus', label: 'Transport', hint: 'Routes & seats' },
        { view: 'clubs', icon: 'users', label: 'Clubs', hint: 'Join & events' },
        { view: 'dining', icon: 'utensils', label: 'Dining', hint: 'Menus & orders' },
        { view: 'library', icon: 'book', label: 'Library', hint: 'Resources' },
        { view: 'payments', icon: 'card', label: 'Payments', hint: 'Fees & receipts' },
        { view: 'tickets', icon: 'life', label: 'Support', hint: 'Get help' },
        { view: 'settings', icon: 'calendar', label: 'Semester', hint: 'Dates & news' },
      ];

      var stats = [
        { label: 'Active stays', value: stays.filter(function (item) { return item.status === 'CONFIRMED'; }).length },
        { label: 'Upcoming trips', value: trips.filter(function (item) { return item.status === 'CONFIRMED'; }).length },
        { label: 'Meal orders', value: orders.length },
        { label: 'Library items', value: reservations.filter(function (item) { return ['RESERVED', 'COLLECTED'].indexOf(item.status) >= 0; }).length },
        { label: 'Payments', value: payments.length },
        { label: 'Unread alerts', value: unread.length },
      ];

      return (
        '<div class="hero"><h2>Hello, ' +
        esc((state.user && state.user.name || 'there').split(' ')[0]) +
        '.</h2><p>Everything you need for campus life is here. Pick a service below or review your recent activity.</p>' +
        '<div class="row"><a class="btn" href="#/accommodation">Browse rooms</a>' +
        '<a class="btn btn-ghost" href="#/tickets">Ask for help</a></div></div>' +
        '<div><p class="eyebrow">Services</p><div class="quick-grid">' +
        quick.map(function (item) {
          return '<a class="quick-link" href="#/' + item.view + '"><span class="quick-icon">' + icon(item.icon, 'icon-sm') + '</span><span>' + esc(item.label) + '<small>' + esc(item.hint) + '</small></span></a>';
        }).join('') +
        '</div></div>' +
        '<div class="grid grid-3">' +
        stats.map(function (item) {
          return '<div class="stat"><div class="stat-value">' + item.value + '</div><div class="stat-label">' + esc(item.label) + '</div></div>';
        }).join('') +
        '</div>' +
        '<div class="grid-wide">' +
        panel('Recent activity', activityList(activity), { subtitle: 'Across all campus services', foot: '<a href="#/profile">View full activity history →</a>' }) +
        '<div class="side-stack">' +
        panel(
          'Announcements',
          announcements.length
            ? '<div class="stack-sm">' + announcements.slice(0, 5).map(function (item) {
                return '<article class="message"><div class="message-head"><strong>' + esc(item.title) + '</strong><span class="small">' + esc(formatDate(item.createdAt)) + '</span></div><p class="small">' + esc(stripHtml(item.body)) + '</p></article>';
              }).join('') + '</div>'
            : emptyState('No announcements', 'Campus news will appear here.', 'bell'),
          { subtitle: 'From the administration', foot: '<a href="#/settings">See all notices →</a>' }
        ) +
        (isAdmin()
          ? panel('Administration', '<p class="small">Manage users, inventory, approvals, refunds and reports from the admin console.</p><div class="row"><a class="btn btn-primary btn-sm" href="#/admin">Open console</a><a class="btn btn-sm" href="#/analytics">Analytics</a></div>')
          : '') +
        '</div></div>'
      );
    });
  }

  /* ==========================================================================
     Profile and activity (FR2)
     ========================================================================== */

  function renderProfile() {
    return Promise.allSettled([api('user', '/api/users/me'), api('user', '/api/users/me/activity')]).then(
      function (results) {
        var profile = results[0].status === 'fulfilled' ? results[0].value.user : null;
        var activity = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
        var form = profile
          ? '<form class="form-grid" data-form="update-profile">' +
            '<div class="field"><label for="profile-name">Full name</label><input class="input" id="profile-name" name="name" value="' + esc(profile.name) + '" required /></div>' +
            '<div class="field"><label for="profile-email">Email address</label><input class="input" id="profile-email" name="email" type="email" value="' + esc(profile.email) + '" required /></div>' +
            '<div class="form-actions"><button class="btn btn-primary" type="submit">Save changes</button></div></form>'
          : errorPanel(results[0].reason);

        return (
          pageHead({ eyebrow: 'My account', title: 'My profile', subtitle: 'Keep your contact details current and review your campus activity.' }) +
          '<div class="grid-wide">' +
          '<div class="stack">' +
          panel('Profile details', form, { subtitle: profile ? profile.email : '' }) +
          panel(
            'Account information',
            '<div class="meta-list">' +
            detailRow('User ID', '<span class="mono">' + esc(profile ? truncateId(profile.id) : '—') + '</span>') +
            detailRow('Role', badge(profile ? profile.role : '')) +
            detailRow('Status', badge(profile ? profile.status : '')) +
            detailRow('Club ID', profile && profile.clubId ? '<span class="mono">' + esc(truncateId(profile.clubId)) + '</span>' : '—') +
            detailRow('Member since', formatDate(profile ? profile.createdAt : null)) +
            '</div>'
          ) +
          '</div>' +
          panel('Activity history', results[1].status === 'fulfilled' ? activityList(activity, 40) : errorPanel(results[1].reason), {
            subtitle: 'Bookings, orders, library use, payments and club activity',
            actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>',
          }) +
          '</div>'
        );
      },
    );
  }

  /* ==========================================================================
     Accommodation (FR4–FR7)
     ========================================================================== */

  function roomCard(room) {
    return (
      '<article class="card"><div class="card-media">' +
      icon('bed', 'icon-lg') +
      '</div><div class="card-body"><div class="spread"><span class="card-title">' +
      esc(room.name) +
      '</span>' +
      badge(room.status) +
      '</div><div class="card-sub">' +
      esc(room.buildingName || 'Campus residence') +
      (room.type ? ' · ' + esc(humanize(room.type)) : '') +
      '</div>' +
      (room.description ? '<p class="small">' + esc(truncate(room.description, 140)) + '</p>' : '') +
      '<div class="meta-list">' +
      detailRow('Price', '<strong class="room-price">' + formatMoney(room.price) + '</strong> / night') +
      detailRow('Capacity', esc(room.capacity) + ' students') +
      '</div>' +
      tagList(room.amenities) +
      '<div class="card-actions"><button class="btn btn-primary btn-sm" type="button" data-action="room-details" data-id="' + esc(room.id) + '">View &amp; book</button>' +
      '<button class="btn btn-sm" type="button" data-action="room-reviews" data-id="' + esc(room.id) + '">Reviews</button></div>' +
      '</div></article>'
    );
  }

  function renderAccommodation() {
    var filters = filterValues('accommodation');
    var query = filterQuery(filters, ['q', 'minPrice', 'maxPrice', 'capacity', 'available', 'buildingId']);
    return Promise.allSettled([
      api('accommodation', '/api/rooms' + query),
      api('accommodation', '/api/buildings'),
      api('accommodation', '/api/bookings'),
    ]).then(function (results) {
      var rooms = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var buildings = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var bookings = results[2].status === 'fulfilled' ? listOf(results[2].value, 'items') : [];

      var bookingRows = bookings.map(function (booking) {
        var stay = booking.room ? booking.room.name : truncateId(booking.roomId);
        return (
          '<tr><td><div class="cell-title">' + esc(stay) + '</div><div class="cell-sub">' + esc(truncateId(booking.id)) + '</div></td>' +
          '<td>' + esc(formatDate(booking.checkIn, false)) + ' → ' + esc(formatDate(booking.checkOut, false)) + '</td>' +
          '<td>' + esc(booking.nights) + '</td><td>' + formatMoney(booking.totalPrice) + '</td>' +
          '<td>' + badge(booking.status) + '</td><td class="nowrap">' +
          (['CONFIRMED', 'PENDING'].indexOf(booking.status) >= 0
            ? '<button class="btn btn-danger btn-sm" type="button" data-action="cancel-stay" data-id="' + esc(booking.id) + '">Cancel</button>'
            : '—') +
          '</td></tr>'
        );
      });

      return (
        pageHead({
          eyebrow: 'FR4–FR7',
          title: 'Accommodation',
          subtitle: 'Compare campus rooms, reserve a stay, manage bookings and review completed visits.',
          actions: isAdmin()
            ? '<a class="btn btn-primary btn-sm" href="#/admin/housing">Manage inventory</a>'
            : '',
        }) +
        filterForm('accommodation', [
          { name: 'q', label: 'Search', placeholder: 'Building or room' },
          { name: 'buildingId', label: 'Building', type: 'select', options: [''].concat(buildings.map(function (building) { return building.id; })), labels: Object.assign({ '': 'All buildings' }, buildings.reduce(function (acc, building) { acc[building.id] = building.name; return acc; }, {})) },
          { name: 'minPrice', label: 'Min price', type: 'number', step: '1' },
          { name: 'maxPrice', label: 'Max price', type: 'number', step: '1' },
          { name: 'capacity', label: 'Capacity', type: 'number', step: '1' },
          { name: 'available', label: 'Available only', type: 'checkbox' },
        ], filters) +
        panelResult(results[0], 'Rooms (' + rooms.length + ')', function () {
          return rooms.length
            ? '<div class="grid grid-3">' + rooms.map(roomCard).join('') + '</div>'
            : emptyState('No rooms match these filters', 'Try clearing the filters or check availability later.', 'bed');
        }, 'Prices are per night') +
        '<div class="grid-wide">' +
        panel('My bookings', results[2].status === 'fulfilled' ? table(['Room', 'Dates', 'Nights', 'Total', 'Status', 'Action'], bookingRows) : errorPanel(results[2].reason), {
          subtitle: 'Cancellations release the room and refund the payment',
          actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>',
        }) +
        panelResult(results[1], 'Residence halls', function () {
          return buildings.length
            ? '<div class="stack-sm">' + buildings.map(function (building) {
                return '<div class="spread"><div><strong>' + esc(building.name) + '</strong><div class="small">' + esc(building.address || 'Campus') + '</div></div>' + badge((building.roomCount || 0) + ' rooms') + '</div>';
              }).join('') + '</div>'
            : emptyState('No buildings', 'Administrators can add residence halls.', 'bed');
        }, 'Campus accommodation buildings') +
        '</div>'
      );
    });
  }

  function showRoomDetails(id) {
    Promise.allSettled([
      api('accommodation', '/api/rooms/' + encodeURIComponent(id)),
      api('accommodation', '/api/rooms/' + encodeURIComponent(id) + '/reviews'),
    ]).then(function (results) {
      if (results[0].status !== 'fulfilled') {
        openModal({ title: 'Room details', body: errorPanel(results[0].reason), size: 'sm' });
        return;
      }
      var room = results[0].value.room || {};
      var reviews = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var average = results[1].status === 'fulfilled' ? results[1].value.average : null;
      var today = dateOnly(new Date());
      var body =
        '<div class="stack"><div class="spread"><div><h3>' + esc(room.name) + '</h3><p class="small">' + esc(room.buildingName || 'Campus residence') + '</p></div>' + badge(room.status) + '</div>' +
        '<p>' + esc(room.description || 'No description provided.') + '</p>' +
        '<div class="meta-list">' +
        detailRow('Nightly rate', formatMoney(room.price)) +
        detailRow('Capacity', esc(room.capacity)) +
        detailRow('Type', esc(humanize(room.type))) +
        detailRow('Rating', average === null || average === undefined ? 'No reviews' : renderStars(average)) +
        '</div>' +
        tagList(room.amenities) +
        '<details class="panel"><summary>Reserve this room</summary><div class="details-body">' +
        '<form class="form-grid" data-form="book-room">' +
        '<input type="hidden" name="roomId" value="' + esc(room.id) + '" />' +
        '<div class="field"><label for="book-check-in">Check in</label><input class="input" id="book-check-in" name="checkIn" type="date" min="' + today + '" required /></div>' +
        '<div class="field"><label for="book-check-out">Check out</label><input class="input" id="book-check-out" name="checkOut" type="date" min="' + today + '" required /></div>' +
        '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Confirm booking</button></div>' +
        '</form></div></details>' +
        '<details class="panel"><summary>Write a review</summary><div class="details-body">' +
        '<form class="form-grid" data-form="add-review">' +
        '<input type="hidden" name="roomId" value="' + esc(room.id) + '" />' +
        '<div class="field"><label for="review-rating">Rating (1–5)</label><select class="select" id="review-rating" name="rating">' + options(['5', '4', '3', '2', '1'], '5') + '</select></div>' +
        '<div class="field span-2"><label for="review-comment">Comment</label><textarea class="textarea" id="review-comment" name="comment" placeholder="How was your stay?"></textarea></div>' +
        '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Submit review</button></div>' +
        '</form><p class="field-hint">Reviews require a confirmed or completed stay in this room.</p></div></details>' +
        '<div><h3>Reviews</h3>' +
        (reviews.length
          ? '<div class="stack-sm">' + reviews.map(function (review) {
              return '<article class="message"><div class="message-head"><strong>' + renderStars(review.rating) + '</strong><span class="small">' + esc(formatDate(review.createdAt)) + '</span></div><p class="small">' + esc(review.comment || 'No comment') + '</p></article>';
            }).join('') + '</div>'
          : emptyState('No reviews', 'Be the first to review this room.', 'info')) +
        '</div></div>';
      openModal({ title: room.name, subtitle: room.buildingName || 'Campus residence', body: body, size: 'lg' });
    });
  }

  /* ==========================================================================
     Transport (FR8–FR10)
     ========================================================================== */

  function scheduleRow(schedule, routeFare) {
    var full = numberOrZero(schedule.seatsAvailable) <= 0 || String(schedule.status).toUpperCase() !== 'SCHEDULED';
    return (
      '<div class="schedule-row"><div><span class="schedule-label">Route</span><span class="schedule-time">' +
      esc(schedule.routeName || humanize(schedule.origin || '') + ' → ' + humanize(schedule.destination || '')) +
      '</span></div>' +
      '<div><span class="schedule-label">Departs</span>' + esc(formatDate(schedule.departureAt, true)) + '</div>' +
      '<div><span class="schedule-label">Seats</span>' + esc(schedule.seatsAvailable) + ' / ' + esc(schedule.capacity) + '</div>' +
      '<div><span class="schedule-label">Fare</span>' + formatMoney(schedule.fare === undefined ? routeFare : schedule.fare) + '</div>' +
      (full
        ? badge(schedule.status || 'FULL')
        : '<button class="btn btn-primary btn-sm" type="button" data-action="book-transport" data-id="' + esc(schedule.id) + '">Book seat</button>') +
      '</div>'
    );
  }

  function renderTransport() {
    var filters = filterValues('transport');
    return Promise.allSettled([
      api('transport', '/api/routes' + filterQuery(filters, ['q'])),
      api('transport', '/api/schedules'),
      api('transport', '/api/bookings'),
    ]).then(function (results) {
      var routes = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var schedules = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var bookings = results[2].status === 'fulfilled' ? listOf(results[2].value, 'items') : [];

      var routeCards = routes.map(function (route) {
        return (
          '<article class="card"><div class="card-media">' + icon('bus', 'icon-lg') + '</div>' +
          '<div class="card-body"><div class="spread"><span class="card-title">' + esc(route.name) + '</span>' + badge(route.status) + '</div>' +
          '<div class="card-sub">' + esc(route.origin || 'Campus') + ' → ' + esc(route.destination || 'Campus') + '</div>' +
          (route.description ? '<p class="small">' + esc(truncate(route.description, 120)) + '</p>' : '') +
          '<div class="meta-list">' + detailRow('Fare', formatMoney(route.fare)) + detailRow('Duration', route.durationMinutes ? esc(route.durationMinutes) + ' min' : '—') + '</div>' +
          '<div class="card-actions"><button class="btn btn-primary btn-sm" type="button" data-action="route-details" data-id="' + esc(route.id) + '">View schedules</button></div>' +
          '</div></article>'
        );
      });

      var bookingRows = bookings.map(function (booking) {
        return (
          '<tr><td>' + esc(booking.routeName || truncateId(booking.scheduleId)) + '</td>' +
          '<td>' + esc(formatDate(booking.departureAt, true)) + '</td>' +
          '<td>Seat ' + esc(booking.seatNumber) + '</td><td>' + formatMoney(booking.amount) + '</td>' +
          '<td>' + badge(booking.status) + '</td><td class="nowrap">' +
          (booking.status === 'CONFIRMED'
            ? '<button class="btn btn-danger btn-sm" type="button" data-action="cancel-trip" data-id="' + esc(booking.id) + '">Cancel</button>'
            : '—') +
          '</td></tr>'
        );
      });

      return (
        pageHead({
          eyebrow: 'FR8–FR10',
          title: 'Transport',
          subtitle: 'Find campus routes, check seat availability and manage your bookings.',
          actions: isAdmin() ? '<a class="btn btn-primary btn-sm" href="#/admin/transport">Manage routes</a>' : '',
        }) +
        filterForm('transport', [{ name: 'q', label: 'Search routes', placeholder: 'Route, origin or destination' }], filters) +
        panelResult(results[0], 'Routes (' + routes.length + ')', function () {
          return routes.length ? '<div class="grid grid-3">' + routeCards.join('') + '</div>' : emptyState('No routes found', 'Try another search term.', 'bus');
        }, 'Transport options available to students') +
        '<div class="grid-wide">' +
        panelResult(results[1], 'Upcoming schedules', function () {
          return schedules.length ? schedules.slice(0, 8).map(function (schedule) { return scheduleRow(schedule); }).join('') : emptyState('No schedules', 'Administrators can publish new schedules.', 'calendar');
        }, 'Seats update immediately after booking or cancellation') +
        panel('My trips', results[2].status === 'fulfilled' ? table(['Route', 'Departs', 'Seat', 'Fare', 'Status', 'Action'], bookingRows) : errorPanel(results[2].reason), {
          subtitle: 'Cancelling a trip releases your seat and refunds the fare',
          actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>',
        }) +
        '</div>'
      );
    });
  }

  function showRouteDetails(id) {
    return api('transport', '/api/routes/' + encodeURIComponent(id))
      .then(function (payload) {
        var route = payload.route || {};
        var schedules = listOf(payload, 'schedules');
        var body =
          '<div class="stack"><div class="meta-list">' +
          detailRow('Route', esc(route.name)) +
          detailRow('From', esc(route.origin || '—')) +
          detailRow('To', esc(route.destination || '—')) +
          detailRow('Fare', formatMoney(route.fare)) +
          detailRow('Distance', route.distanceKm ? esc(route.distanceKm) + ' km' : '—') +
          '</div>' +
          (route.description ? '<p>' + esc(route.description) + '</p>' : '') +
          '<div><h3>Schedules</h3>' +
          (schedules.length ? schedules.map(function (schedule) { return scheduleRow(schedule, route.fare); }).join('') : emptyState('No schedules', 'This route has no upcoming departures.', 'calendar')) +
          '</div></div>';
        openModal({ title: route.name || 'Route', subtitle: 'Choose a departure to book a seat', body: body, size: 'lg' });
      })
      .catch(function (error) {
        openModal({ title: 'Route details', body: errorPanel(error), size: 'sm' });
      });
  }

  /* ==========================================================================
     Clubs and events (FR11–FR14)
     ========================================================================== */

  function clubCard(club, memberships) {
    var active = memberships.some(function (item) {
      return item.clubId === club.id && item.status === 'ACTIVE';
    });
    return (
      '<article class="card"><div class="card-media">' + icon('users', 'icon-lg') + '</div>' +
      '<div class="card-body"><div class="spread"><span class="card-title">' + esc(club.name) + '</span>' + badge(club.status) + '</div>' +
      '<div class="card-sub">' + esc(club.category) + (club.memberCount !== undefined ? ' · ' + esc(club.memberCount) + ' members' : '') + '</div>' +
      (club.description ? '<p class="small">' + esc(truncate(club.description, 140)) + '</p>' : '') +
      '<div class="card-actions"><button class="btn btn-primary btn-sm" type="button" data-action="club-details" data-id="' + esc(club.id) + '">View club</button>' +
      (club.status === 'APPROVED'
        ? active
          ? '<button class="btn btn-sm" type="button" data-action="leave-club" data-id="' + esc(club.id) + '">Leave</button>'
          : '<button class="btn btn-sm" type="button" data-action="join-club" data-id="' + esc(club.id) + '">Join</button>'
        : '') +
      '</div></div></article>'
    );
  }

  function eventCard(event, canEdit) {
    return (
      '<article class="card"><div class="card-body"><div class="spread"><span class="card-title">' + esc(event.title) + '</span>' + badge(event.status || '') + '</div>' +
      '<div class="card-sub">' + esc(event.clubName || humanize(event.clubId)) + '</div>' +
      '<p class="small">' + esc(truncate(event.description || 'Campus club event', 120)) + '</p>' +
      '<div class="meta-list">' + detailRow('Starts', formatDate(event.startsAt, true)) + detailRow('Ends', event.endsAt ? formatDate(event.endsAt, true) : '—') + '</div>' +
      (canEdit
        ? '<div class="card-actions"><button class="btn btn-sm" type="button" data-action="edit-event" data-id="' + esc(event.id) + '">Edit</button><button class="btn btn-danger btn-sm" type="button" data-action="delete-event" data-id="' + esc(event.id) + '">Delete</button></div>'
        : '') +
      '</div></article>'
    );
  }

  function renderClubs() {
    var filters = filterValues('clubs');
    return Promise.allSettled([
      api('club', '/api/clubs' + filterQuery(filters, ['q', 'category', 'status'])),
      api('club', '/api/clubs/mine'),
      api('club', '/api/events?joined=true'),
    ]).then(function (results) {
      var clubs = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var memberships = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var events = results[2].status === 'fulfilled' ? listOf(results[2].value, 'items') : [];
      var categories = [];
      clubs.forEach(function (club) {
        if (club.category && categories.indexOf(club.category) < 0) categories.push(club.category);
      });

      var membershipRows = memberships.map(function (item) {
        var club = item.club || {};
        return (
          '<tr><td>' + esc(club.name || truncateId(item.clubId)) + '</td><td>' + esc(club.category || '—') + '</td>' +
          '<td>' + badge(item.status) + '</td><td>' + esc(formatDate(item.joinedAt, false)) + '</td><td class="nowrap">' +
          (item.status === 'ACTIVE'
            ? '<button class="btn btn-danger btn-sm" type="button" data-action="leave-club" data-id="' + esc(item.clubId) + '">Leave</button>'
            : '<button class="btn btn-sm" type="button" data-action="join-club" data-id="' + esc(item.clubId) + '">Rejoin</button>') +
          '</td></tr>'
        );
      });

      return (
        pageHead({
          eyebrow: 'FR11–FR14',
          title: 'Clubs & events',
          subtitle: 'Discover approved clubs, join your favourites and keep up with events.',
          actions: isAdmin() ? '<a class="btn btn-primary btn-sm" href="#/admin/clubs">Review proposals</a>' : '',
        }) +
        '<div class="grid-wide">' +
        '<div class="stack">' +
        filterForm('clubs', [
          { name: 'q', label: 'Search clubs', placeholder: 'Name or interest' },
          { name: 'category', label: 'Category', type: 'select', options: [''].concat(categories), labels: Object.assign({ '': 'All categories' }, categories.reduce(function (acc, category) { acc[category] = category; return acc; }, {})) },
          { name: 'status', label: 'Status', type: 'select', options: ['', 'APPROVED', 'PENDING', 'REJECTED', 'SUSPENDED'], labels: { '': 'Approved (default)' } },
        ], filters) +
        panelResult(results[0], 'Clubs (' + clubs.length + ')', function () {
          return clubs.length ? '<div class="grid grid-2">' + clubs.map(function (club) { return clubCard(club, memberships); }).join('') + '</div>' : emptyState('No clubs match', 'Try a different search or propose a new club.', 'users');
        }, 'Only approved clubs are shown by default') +
        '</div><div class="side-stack">' +
        panel('Propose a club', '<form class="form-grid" data-form="propose-club">' +
          '<div class="field"><label for="club-name">Club name</label><input class="input" id="club-name" name="name" required /></div>' +
          '<div class="field"><label for="club-category">Category</label><input class="input" id="club-category" name="category" placeholder="Technology, Arts…" required /></div>' +
          '<div class="field span-2"><label for="club-description">Description</label><textarea class="textarea" id="club-description" name="description" required></textarea></div>' +
          '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Submit proposal</button></div></form>', { subtitle: 'New clubs start as PENDING until approved' }) +
        panel('My memberships', results[1].status === 'fulfilled' ? (membershipRows.length ? table(['Club', 'Category', 'Status', 'Joined', 'Action'], membershipRows) : emptyState('No memberships', 'Join a club to see it here.', 'users')) : errorPanel(results[1].reason)) +
        '</div></div>' +
        panel('Upcoming events for my clubs', results[2].status === 'fulfilled' ? (events.length ? '<div class="grid grid-3">' + events.map(function (event) {
              state.data.eventsById[event.id] = event;
              return eventCard(event, canManageClub({ id: event.clubId }));
            }).join('') + '</div>' : emptyState('No upcoming events', 'Join a club and check back for scheduled events.', 'calendar')) : errorPanel(results[2].reason), {
          subtitle: 'Events from clubs you belong to',
          actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>',
        })
      );
    });
  }

  function showClubDetails(id) {
    Promise.allSettled([
      api('club', '/api/clubs/' + encodeURIComponent(id)),
      api('club', '/api/clubs/' + encodeURIComponent(id) + '/events'),
      canManageClub({ id: id }) ? api('club', '/api/clubs/' + encodeURIComponent(id) + '/members') : Promise.resolve({ items: [] }),
    ]).then(function (results) {
      if (results[0].status !== 'fulfilled') {
        openModal({ title: 'Club details', body: errorPanel(results[0].reason), size: 'sm' });
        return;
      }
      var club = results[0].value.club || {};
      var events = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var members = results[2].status === 'fulfilled' ? listOf(results[2].value, 'items') : [];
      var manage = canManageClub(club);
      var body =
        '<div class="stack"><div class="spread"><h3>' + esc(club.name) + '</h3>' + badge(club.status) + '</div>' +
        '<p>' + esc(club.description || 'No description provided.') + '</p>' +
        '<div class="meta-list">' + detailRow('Category', esc(club.category)) + detailRow('Members', esc(club.memberCount === undefined ? members.length || '—' : club.memberCount)) + detailRow('Proposed', formatDate(club.createdAt, false)) + '</div>' +
        '<div class="row">' +
        (club.status === 'APPROVED'
          ? '<button class="btn btn-primary btn-sm" type="button" data-action="join-club" data-id="' + esc(club.id) + '">Join club</button><button class="btn btn-sm" type="button" data-action="leave-club" data-id="' + esc(club.id) + '">Leave club</button>'
          : '<span class="muted small">Only approved clubs can be joined.</span>') +
        '</div>' +
        (manage && club.status === 'APPROVED'
          ? '<details class="panel"><summary>Add a club event</summary><div class="details-body"><form class="form-grid" data-form="add-event">' +
            '<input type="hidden" name="clubId" value="' + esc(club.id) + '" />' +
            '<div class="field"><label for="event-title">Title</label><input class="input" id="event-title" name="title" required /></div>' +
            '<div class="field"><label for="event-start">Starts at</label><input class="input" id="event-start" name="startsAt" type="datetime-local" required /></div>' +
            '<div class="field"><label for="event-end">Ends at <span class="optional">(optional)</span></label><input class="input" id="event-end" name="endsAt" type="datetime-local" /></div>' +
            '<div class="field"><label for="event-description">Description</label><input class="input" id="event-description" name="description" /></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Create event</button></div></form></div></details>'
          : '') +
        '<div><h3>Events</h3>' + (events.length ? '<div class="stack-sm">' + events.map(function (event) {
          state.data.eventsById[event.id] = event;
          return '<article class="message"><div class="message-head"><strong>' + esc(event.title) + '</strong><span class="small">' + esc(formatDate(event.startsAt, true)) + '</span></div><p class="small">' + esc(event.description || '') + '</p>' +
            (manage ? '<div class="row"><button class="btn btn-sm" type="button" data-action="edit-event" data-id="' + esc(event.id) + '">Edit</button><button class="btn btn-danger btn-sm" type="button" data-action="delete-event" data-id="' + esc(event.id) + '">Delete</button></div>' : '') +
            '</article>';
        }).join('') + '</div>' : emptyState('No events', 'This club has not scheduled an event yet.', 'calendar')) + '</div>' +
        (manage ? '<div><h3>Members (' + members.length + ')</h3>' + (members.length ? table(['User ID', 'Status', 'Joined'], members.map(function (member) { return '<tr><td class="mono">' + esc(truncateId(member.userId)) + '</td><td>' + badge(member.status) + '</td><td>' + esc(formatDate(member.joinedAt, false)) + '</td></tr>'; })) : emptyState('No members', 'Membership requests appear here.', 'users')) + '</div>' : '') +
        '</div>';
      openModal({ title: club.name, subtitle: club.category || 'Campus club', body: body, size: 'lg' });
    });
  }

  function showEventEditor(id) {
    var known = (state.data.eventsById || {})[id];
    if (known) {
      openEventEditor(known);
      return Promise.resolve();
    }
    return api('club', '/api/events?joined=true')
      .then(function (payload) {
        var event = listOf(payload, 'items').find(function (item) { return item.id === id; });
        if (!event) throw new Error('Event not found. Refresh the club page and try again.');
        return event;
      })
      .then(function (event) {
        openEventEditor(event);
      })
      .catch(notifyError);
  }

  function openEventEditor(event) {
    return Promise.resolve()
      .then(function () {
        if (!event) throw new Error('Event not found');
        openModal({
          title: 'Edit event',
          size: 'sm',
          body: '<form class="form-grid" data-form="edit-event">' +
            '<input type="hidden" name="id" value="' + esc(event.id) + '" />' +
            '<div class="field"><label for="edit-event-title">Title</label><input class="input" id="edit-event-title" name="title" value="' + esc(event.title) + '" required /></div>' +
            '<div class="field"><label for="edit-event-start">Starts at</label><input class="input" id="edit-event-start" name="startsAt" type="datetime-local" value="' + esc(dateTimeLocal(event.startsAt)) + '" required /></div>' +
            '<div class="field"><label for="edit-event-end">Ends at</label><input class="input" id="edit-event-end" name="endsAt" type="datetime-local" value="' + esc(dateTimeLocal(event.endsAt)) + '" /></div>' +
            '<div class="field span-2"><label for="edit-event-description">Description</label><textarea class="textarea" id="edit-event-description" name="description">' + esc(event.description || '') + '</textarea></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Save event</button></div></form>',
        });
      })
      .catch(notifyError);
  }

  /* ==========================================================================
     Dining (FR15–FR18)
     ========================================================================== */

  function mealCard(meal) {
    return (
      '<article class="card"><div class="card-media">' + icon('utensils', 'icon-lg') + '</div>' +
      '<div class="card-body"><div class="spread"><span class="card-title">' + esc(meal.name) + '</span>' + badge(meal.stockStatus) + '</div>' +
      '<div class="card-sub">' + esc(meal.category || 'Meal') + ' · ' + esc(formatDate(meal.mealDate, false)) + '</div>' +
      (meal.description ? '<p class="small">' + esc(truncate(meal.description, 120)) + '</p>' : '') +
      (meal.conflicts && meal.conflicts.length ? '<div class="meal-conflict">' + icon('alert', 'icon-sm') + ' Conflicts: ' + esc(meal.conflicts.join(', ')) + '</div>' : '') +
      '<div class="meta-list">' + detailRow('Price', formatMoney(meal.price)) + detailRow('Ingredients', esc((meal.ingredients || []).slice(0, 4).join(', '))) + '</div>' +
      '<div class="card-actions"><button class="btn btn-primary btn-sm" type="button" data-action="meal-details" data-id="' + esc(meal.id) + '">Details &amp; order</button></div>' +
      '</div></article>'
    );
  }

  function renderDining() {
    var filters = filterValues('dining');
    var params = ['q', 'date'];
    if (filters.highlight === 'true' || filters.highlight === true) params.push('highlight');
    var query = filterQuery(filters, params);
    return Promise.allSettled([
      api('dining', '/api/meals' + query),
      api('dining', '/api/dietary'),
      api('dining', '/api/orders'),
    ]).then(function (results) {
      var meals = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var preferences = results[1].status === 'fulfilled' ? results[1].value.preferences || {} : {};
      var orders = results[2].status === 'fulfilled' ? listOf(results[2].value, 'items') : [];

      var orderRows = orders.map(function (order) {
        return (
          '<tr><td>' + esc(order.mealName || truncateId(order.mealId)) + '</td><td>' + formatMoney(order.amount) + '</td>' +
          '<td>' + (order.conflicts && order.conflicts.length ? esc(order.conflicts.join(', ')) : '—') + '</td>' +
          '<td>' + badge(order.status) + '</td><td>' + esc(formatDate(order.createdAt)) + '</td><td class="nowrap">' +
          (order.status === 'PAID' || order.status === 'CREATED'
            ? '<button class="btn btn-danger btn-sm" type="button" data-action="cancel-order" data-id="' + esc(order.id) + '">Cancel</button>'
            : '—') +
          '</td></tr>'
        );
      });

      return (
        pageHead({
          eyebrow: 'FR15–FR18',
          title: 'Dining',
          subtitle: 'Browse the menu, check ingredients against your dietary needs and order meals.',
          actions: isAdmin() ? '<a class="btn btn-primary btn-sm" href="#/admin/dining">Manage meals</a>' : '',
        }) +
        filterForm('dining', [
          { name: 'q', label: 'Search menu', placeholder: 'Meal or ingredient' },
          { name: 'date', label: 'Meal date', type: 'date' },
          { name: 'highlight', label: 'Highlight my conflicts', type: 'checkbox' },
        ], filters) +
        '<div class="grid-wide"><div class="stack">' +
        panelResult(results[0], 'Menu (' + meals.length + ')', function () {
          return meals.length ? '<div class="grid grid-2">' + meals.map(mealCard).join('') + '</div>' : emptyState('No meals found', 'Try another date or search term.', 'utensils');
        }, 'Meal details include ingredients and nutrition') +
        panel('My orders', results[2].status === 'fulfilled' ? table(['Meal', 'Amount', 'Conflicts', 'Status', 'Ordered', 'Action'], orderRows) : errorPanel(results[2].reason), {
          subtitle: 'Orders can be cancelled before the meal deadline',
          actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>',
        }) +
        '</div><div class="side-stack">' +
        panelResult(results[1], 'Dietary preferences', function () {
          var restrictions = arrayOf(preferences.restrictions).join(', ');
          var allergies = arrayOf(preferences.allergies).join(', ');
          return '<form class="form-grid" data-form="save-dietary">' +
            '<div class="field span-2"><label for="diet-restrictions">Restrictions</label><input class="input" id="diet-restrictions" name="restrictions" value="' + esc(restrictions) + '" placeholder="Vegetarian, Halal…" /><p class="field-hint">Separate multiple values with commas.</p></div>' +
            '<div class="field span-2"><label for="diet-allergies">Allergies</label><input class="input" id="diet-allergies" name="allergies" value="' + esc(allergies) + '" placeholder="Peanuts, Gluten…" /></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Save preferences</button></div></form>';
        }, 'Used to flag conflicting meals') +
        panel('Nutrition guide', '<div class="meta-list">' + detailRow('Allergen data', 'Based on meal ingredients and declared allergens') + detailRow('Cancellation', 'Before 18:00 on the meal date') + detailRow('Payment', 'Charged automatically when you order') + '</div>') +
        '</div></div>'
      );
    });
  }

  function showMealDetails(id) {
    Promise.allSettled([api('dining', '/api/meals/' + encodeURIComponent(id)), api('dining', '/api/meals/' + encodeURIComponent(id) + '/conflicts')]).then(function (results) {
      if (results[0].status !== 'fulfilled') {
        openModal({ title: 'Meal details', body: errorPanel(results[0].reason), size: 'sm' });
        return;
      }
      var meal = results[0].value.meal || {};
      var conflicts = results[1].status === 'fulfilled' ? results[1].value.conflicts || [] : [];
      var nutrition = meal.nutrition || {};
      var nutritionRows = Object.keys(nutrition).map(function (key) { return detailRow(humanize(key), esc(nutrition[key])); }).join('');
      var body =
        '<div class="stack"><div class="spread"><h3>' + esc(meal.name) + '</h3>' + badge(meal.stockStatus) + '</div>' +
        '<p>' + esc(meal.description || 'No description provided.') + '</p>' +
        '<div class="grid grid-2"><div><h3>Ingredients</h3>' + tagList(meal.ingredients) + '</div><div><h3>Allergens</h3>' + tagList(meal.allergens) + '</div></div>' +
        (conflicts.length ? '<div class="meal-conflict">' + icon('alert', 'icon-sm') + ' Conflicts with your preferences: <strong>' + esc(conflicts.join(', ')) + '</strong></div>' : '') +
        '<div class="meta-list">' + detailRow('Price', formatMoney(meal.price)) + detailRow('Serves on', formatDate(meal.mealDate, false)) + nutritionRows + '</div>' +
        (String(meal.stockStatus).toUpperCase() === 'OUT_OF_STOCK'
          ? emptyState('Out of stock', 'This meal cannot be ordered right now.', 'utensils')
          : '<form class="inline-form" data-form="order-meal"><input type="hidden" name="mealId" value="' + esc(meal.id) + '" /><button class="btn btn-primary" type="submit">Order this meal · ' + formatMoney(meal.price) + '</button></form>') +
        '</div>';
      openModal({ title: meal.name, subtitle: formatDate(meal.mealDate, false), body: body, size: 'lg' });
    });
  }

  /* ==========================================================================
     Library (FR23)
     ========================================================================== */

  function resourceCard(resource) {
    return (
      '<article class="card"><div class="card-media">' + icon(resource.type === 'DIGITAL' ? 'download' : 'book', 'icon-lg') + '</div>' +
      '<div class="card-body"><div class="spread"><span class="card-title">' + esc(resource.title) + '</span>' + badge(resource.type) + '</div>' +
      '<div class="card-sub">' + esc(resource.author || 'Unknown author') + (resource.subject ? ' · ' + esc(resource.subject) : '') + '</div>' +
      (resource.description ? '<p class="small">' + esc(truncate(resource.description, 120)) + '</p>' : '') +
      '<div class="meta-list">' +
      detailRow(resource.type === 'DIGITAL' ? 'Access' : 'Copies', resource.type === 'DIGITAL' ? 'Digital download' : esc(resource.copiesAvailable) + ' / ' + esc(resource.copiesTotal)) +
      '</div>' +
      '<div class="card-actions"><button class="btn btn-primary btn-sm" type="button" data-action="resource-access" data-id="' + esc(resource.id) + '">' +
      (resource.type === 'DIGITAL' ? 'Open resource' : resource.available ? 'Reserve copy' : 'Unavailable') + '</button>' +
      '<button class="btn btn-sm" type="button" data-action="resource-details" data-id="' + esc(resource.id) + '">Details</button></div>' +
      '</div></article>'
    );
  }

  function renderLibrary() {
    var filters = filterValues('library');
    return Promise.allSettled([
      api('library', '/api/resources' + filterQuery(filters, ['q', 'type', 'subject'])),
      api('library', '/api/reservations'),
    ]).then(function (results) {
      var resources = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var reservations = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var reservationRows = reservations.map(function (reservation) {
        var status = String(reservation.status || '').toUpperCase();
        var actions = '';
        if (status === 'RESERVED') {
          actions =
            '<button class="btn btn-primary btn-sm" type="button" data-action="reservation-collect" data-id="' + esc(reservation.id) + '">Collect</button> ' +
            '<button class="btn btn-danger btn-sm" type="button" data-action="reservation-cancel" data-id="' + esc(reservation.id) + '">Cancel</button>';
        } else if (status === 'COLLECTED') {
          actions = '<button class="btn btn-sm" type="button" data-action="reservation-return" data-id="' + esc(reservation.id) + '">Return</button>';
        }
        return (
          '<tr><td>' + esc(reservation.resourceTitle || truncateId(reservation.resourceId)) + '</td>' +
          '<td>' + badge(status) + '</td><td>' + esc(formatDate(reservation.reservedAt, false)) + '</td>' +
          '<td>' + esc(formatDate(reservation.dueDate, false)) + '</td><td class="nowrap">' + (actions || '—') + '</td></tr>'
        );
      });

      return (
        pageHead({
          eyebrow: 'FR23',
          title: 'Library',
          subtitle: 'Find printed books and digital resources, reserve a copy and track returns.',
          actions: isAdmin() ? '<a class="btn btn-primary btn-sm" href="#/admin/library">Manage catalogue</a>' : '',
        }) +
        filterForm('library', [
          { name: 'q', label: 'Search catalogue', placeholder: 'Title, author, ISBN' },
          { name: 'type', label: 'Type', type: 'select', options: ['', 'PRINTED_BOOK', 'DIGITAL'], labels: { '': 'All types' } },
          { name: 'subject', label: 'Subject', placeholder: 'e.g. Computer Science' },
        ], filters) +
        panelResult(results[0], 'Resources (' + resources.length + ')', function () {
          return resources.length ? '<div class="grid grid-3">' + resources.map(resourceCard).join('') + '</div>' : emptyState('No resources found', 'Try another search term or filter.', 'book');
        }, 'Printed books can be reserved; digital items are downloaded') +
        panel('My reservations', results[1].status === 'fulfilled' ? table(['Resource', 'Status', 'Reserved', 'Due', 'Action'], reservationRows) : errorPanel(results[1].reason), {
          subtitle: 'Collect and return reserved books from the library desk',
          actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>',
        })
      );
    });
  }

  function showResourceDetails(id) {
    api('library', '/api/resources/' + encodeURIComponent(id))
      .then(function (payload) {
        var resource = payload.resource || {};
        openModal({
          title: resource.title || 'Resource',
          subtitle: resource.author || 'Library resource',
          size: 'lg',
          body:
            '<div class="stack"><div class="meta-list">' +
            detailRow('Type', esc(humanize(resource.type))) +
            detailRow('Subject', esc(resource.subject || '—')) +
            detailRow('ISBN', esc(resource.isbn || '—')) +
            detailRow('Copies', esc(resource.copiesAvailable) + ' available of ' + esc(resource.copiesTotal)) +
            '</div><p>' + esc(resource.description || 'No description provided.') + '</p>' +
            (resource.type === 'DIGITAL' && resource.url
              ? '<a class="btn btn-primary" href="' + esc(resource.url) + '" target="_blank" rel="noopener noreferrer">Open digital copy</a>'
              : '') +
            '<button class="btn btn-primary" type="button" data-action="resource-access" data-id="' + esc(resource.id) + '">' +
            (resource.type === 'DIGITAL' ? 'Log download' : 'Reserve a copy') + '</button></div>',
        });
      })
      .catch(notifyError);
  }

  function showAccessResult(payload) {
    var resource = payload.resource || {};
    var body =
      '<div class="stack"><p>' +
      (payload.accessType === 'DIGITAL'
        ? 'Your download was recorded in your activity history.'
        : 'Your reservation is confirmed. Collect it from the library desk before the due date.') +
      '</p><div class="meta-list">' +
      detailRow('Resource', esc(resource.title || 'Library resource')) +
      detailRow('Access', esc(humanize(payload.accessType))) +
      (payload.reservation ? detailRow('Status', badge(payload.reservation.status)) + detailRow('Due', formatDate(payload.reservation.dueDate, false)) : '') +
      '</div>' +
      (payload.accessType === 'DIGITAL' && resource.url ? '<a class="btn btn-primary" href="' + esc(resource.url) + '" target="_blank" rel="noopener noreferrer">Open resource</a>' : '') +
      '</div>';
    openModal({ title: 'Access confirmed', body: body, size: 'sm' });
  }

  /* ==========================================================================
     Payments (FR24)
     ========================================================================== */

  function paymentRows(payments) {
    return payments.map(function (payment) {
      return (
        '<tr><td class="mono">' + esc(truncateId(payment.id)) + '</td>' +
        '<td>' + esc(payment.description || humanize(payment.payableType)) + '</td>' +
        '<td>' + formatMoney(payment.amount) + '</td><td>' + badge(payment.status) + '</td>' +
        '<td>' + esc(formatDate(payment.createdAt)) + '</td><td class="nowrap">' +
        '<button class="btn btn-sm" type="button" data-action="payment-details" data-id="' + esc(payment.id) + '">Details</button></td></tr>'
      );
    });
  }

  function renderPayments() {
    return Promise.allSettled([api('payment', '/api/payments'), api('payment', '/api/refunds')]).then(function (results) {
      var payments = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var refunds = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var refundRows = refunds.map(function (refund) {
        return '<tr><td class="mono">' + esc(truncateId(refund.paymentId)) + '</td><td>' + formatMoney(refund.amount) + '</td><td>' + esc(truncate(refund.reason || '', 70)) + '</td><td>' + badge(refund.status) + '</td><td>' + esc(formatDate(refund.requestedAt)) + '</td></tr>';
      });
      var total = payments.reduce(function (sum, payment) { return sum + (payment.status === 'PAID' ? numberOrZero(payment.amount) : 0); }, 0);

      return (
        pageHead({
          eyebrow: 'FR24',
          title: 'Payments',
          subtitle: 'Pay campus fees, download receipts and request refunds.',
          actions: isAdmin() ? '<a class="btn btn-primary btn-sm" href="#/admin/payments">Review refunds</a>' : '',
        }) +
        '<div class="grid grid-4">' +
        '<div class="stat"><div class="stat-value">' + payments.length + '</div><div class="stat-label">Transactions</div></div>' +
        '<div class="stat"><div class="stat-value">' + formatMoney(total) + '</div><div class="stat-label">Paid total</div></div>' +
        '<div class="stat"><div class="stat-value">' + payments.filter(function (payment) { return payment.status === 'PAID'; }).length + '</div><div class="stat-label">Paid</div></div>' +
        '<div class="stat"><div class="stat-value">' + refunds.length + '</div><div class="stat-label">Refund requests</div></div>' +
        '</div>' +
        '<div class="grid-wide"><div class="stack">' +
        panel('Payment history', results[0].status === 'fulfilled' ? table(['ID', 'Description', 'Amount', 'Status', 'Date', 'Action'], paymentRows(payments)) : errorPanel(results[0].reason), {
          subtitle: 'All payments are recorded with a receipt when successful',
          actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>',
        }) +
        panel('My refund requests', results[1].status === 'fulfilled' ? table(['Payment', 'Amount', 'Reason', 'Status', 'Requested'], refundRows) : errorPanel(results[1].reason)) +
        '</div><div class="side-stack">' +
        panel('Pay a fee', '<form class="form-grid" data-form="pay-fee">' +
          '<div class="field span-2"><label for="pay-type">Fee type</label><input class="input" id="pay-type" name="payableType" value="OTHER_FEE" required /></div>' +
          '<div class="field span-2"><label for="pay-reference">Reference</label><input class="input" id="pay-reference" name="payableId" placeholder="Invoice or reference ID" required /></div>' +
          '<div class="field span-2"><label for="pay-amount">Amount</label><input class="input" id="pay-amount" name="amount" type="number" min="0.01" step="0.01" required /></div>' +
          '<div class="field span-2"><label for="pay-description">Description <span class="optional">(optional)</span></label><input class="input" id="pay-description" name="description" /></div>' +
          '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Pay now</button></div></form>', { subtitle: 'The demo gateway approves positive amounts' }) +
        panel('Refunds', '<p class="small">Open a paid transaction to request a refund. Administrators approve, reject or issue refunds from the admin console.</p>') +
        '</div></div>'
      );
    });
  }

  function showPaymentDetails(id) {
    var payment = null;
    api('payment', '/api/payments/' + encodeURIComponent(id))
      .then(function (payload) {
        payment = payload.payment || {};
        return Promise.allSettled([
          api('payment', '/api/payments/' + encodeURIComponent(id) + '/receipt'),
          api('payment', '/api/refunds'),
        ]);
      })
      .then(function (results) {
        var receipt = results[0].status === 'fulfilled' ? results[0].value.receipt : null;
        var refunds = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items').filter(function (item) { return item.paymentId === payment.id; }) : [];
        var body =
          '<div class="stack"><div class="meta-list">' +
          detailRow('Payment ID', '<span class="mono">' + esc(payment.id) + '</span>') +
          detailRow('Description', esc(payment.description || humanize(payment.payableType))) +
          detailRow('Reference', '<span class="mono">' + esc(payment.payableId) + '</span>') +
          detailRow('Amount', formatMoney(payment.amount)) +
          detailRow('Status', badge(payment.status)) +
          detailRow('Paid at', formatDate(payment.paidAt)) +
          '</div>' +
          (receipt
            ? '<div class="receipt"><strong>Receipt ' + esc(receipt.receiptNumber || receipt.number) + '</strong><div class="small">Issued ' + esc(formatDate(receipt.issuedAt)) + ' · ' + formatMoney(receipt.amount) + '</div></div>'
            : '<p class="muted small">No receipt was issued for this payment.</p>') +
          (refunds.length ? '<div><h3>Refund requests</h3><div class="stack-sm">' + refunds.map(function (refund) { return '<div class="spread"><span>' + formatMoney(refund.amount) + '</span>' + badge(refund.status) + '</div>'; }).join('') + '</div></div>' : '') +
          (payment.status === 'PAID'
            ? '<details class="panel"><summary>Request a refund</summary><div class="details-body"><form class="form-grid" data-form="request-refund">' +
              '<input type="hidden" name="paymentId" value="' + esc(payment.id) + '" />' +
              '<div class="field span-2"><label for="refund-amount">Amount <span class="optional">(blank for full refund)</span></label><input class="input" id="refund-amount" name="amount" type="number" min="0.01" step="0.01" /></div>' +
              '<div class="field span-2"><label for="refund-reason">Reason</label><textarea class="textarea" id="refund-reason" name="reason" required></textarea></div>' +
              '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Submit request</button></div></form></div></details>'
            : '') +
          '</div>';
        openModal({ title: 'Payment details', body: body, size: 'lg' });
      })
      .catch(notifyError);
  }

  /* ==========================================================================
     Notifications (FR19) and support tickets (FR20)
     ========================================================================== */

  function renderNotifications() {
    var filters = filterValues('notifications');
    return Promise.allSettled([
      api('communication', '/api/notifications' + filterQuery(filters, ['unread'])),
      api('communication', '/api/settings/semester'),
    ]).then(function (results) {
      var notifications = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var semester = semesterParts(results[1].status === 'fulfilled' ? results[1].value : null);
      var rows = notifications.map(function (notice) {
        return (
          '<article class="notification-item' + (notice.read ? ' is-read' : '') + '">' +
          '<span class="notification-dot" aria-hidden="true"></span>' +
          '<div class="notification-body"><div class="notification-title"><strong>' + esc(notice.title) + '</strong>' + badge(notice.type) + '</div>' +
          '<p class="small">' + esc(notice.body) + '</p><div class="notification-meta"><span>' + esc(formatDate(notice.createdAt)) + '</span>' +
          (notice.read ? '<span>Read</span>' : '<button class="btn btn-sm" type="button" data-action="mark-read" data-id="' + esc(notice.id) + '">Mark as read</button>') +
          '</div></div></article>'
        );
      });

      return (
        pageHead({ eyebrow: 'FR19–FR22', title: 'Notifications', subtitle: 'System alerts and semester updates in one inbox.' }) +
        '<div class="grid-wide"><div class="stack">' +
        filterForm('notifications', [{ name: 'unread', label: 'Unread only', type: 'checkbox' }], filters) +
        panelResult(results[0], 'Inbox (' + notifications.length + ')', function () {
          return notifications.length ? rows.join('') : emptyState('No notifications', 'You are all caught up.', 'bell');
        }, 'Booking, payment, library and club alerts', { actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>' }) +
        '</div><div class="side-stack">' +
        panel('Semester', '<div class="meta-list">' + detailRow('Starts', esc(formatDate(semester.startDate, false))) + detailRow('Ends', esc(formatDate(semester.endDate, false))) + '</div>', { foot: '<a href="#/settings">View settings →</a>' }) +
        (isAdmin()
          ? panel('Send a broadcast', '<form class="form-grid" data-form="broadcast-notification">' +
            '<div class="field span-2"><label class="checkbox"><input type="checkbox" name="all" checked /> Send to all students</label></div>' +
            '<div class="field span-2"><label for="broadcast-recipient">Or recipient ID <span class="optional">(optional)</span></label><input class="input" id="broadcast-recipient" name="recipientId" placeholder="usr_…" /></div>' +
            '<div class="field span-2"><label for="broadcast-title">Title</label><input class="input" id="broadcast-title" name="title" required /></div>' +
            '<div class="field span-2"><label for="broadcast-body">Message</label><textarea class="textarea" id="broadcast-body" name="body" required></textarea></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Send notification</button></div></form>')
          : '') +
        '</div></div>'
      );
    });
  }

  function renderTickets() {
    return api('communication', '/api/tickets' + (isAdmin() ? '?all=true' : ''))
      .catch(function (error) {
        return { __error: error };
      })
      .then(function (payload) {
        if (payload && payload.__error) return pageHead({ eyebrow: 'FR20', title: 'Support tickets' }) + errorPanel(payload.__error);
        var tickets = listOf(payload, 'items');
        var rows = tickets.map(function (ticket) {
          return (
            '<tr><td>' + esc(ticket.subject) + '</td><td>' + esc(truncate(ticket.description || '', 90)) + '</td>' +
            '<td>' + badge(ticket.status) + '</td><td>' + esc(formatDate(ticket.createdAt)) + '</td><td class="nowrap">' +
            '<button class="btn btn-sm" type="button" data-action="ticket-details" data-id="' + esc(ticket.id) + '">Open</button></td></tr>'
          );
        });
        return (
          pageHead({ eyebrow: 'FR20', title: 'Support tickets', subtitle: 'Ask for help with any campus service and track the response.' }) +
          '<div class="grid-wide"><div class="stack">' +
          panel('Tickets (' + tickets.length + ')', table(['Subject', 'Description', 'Status', 'Created', 'Action'], rows), {
            subtitle: isAdmin() ? 'Showing all student tickets' : 'Your submitted tickets',
            actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>',
          }) +
          '</div><div class="side-stack">' +
          panel('Open a ticket', '<form class="form-grid" data-form="create-ticket">' +
            '<div class="field span-2"><label for="ticket-subject">Subject</label><input class="input" id="ticket-subject" name="subject" required /></div>' +
            '<div class="field span-2"><label for="ticket-description">Describe the issue</label><textarea class="textarea" id="ticket-description" name="description" required></textarea></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Submit ticket</button></div></form>') +
          panel('How it works', '<div class="meta-list">' + detailRow('1', 'Submit your question or issue') + detailRow('2', 'Staff respond in the ticket thread') + detailRow('3', 'The ticket is resolved and archived') + '</div>') +
          '</div></div>'
        );
      });
  }

  function showTicketDetails(id) {
    return api('communication', '/api/tickets/' + encodeURIComponent(id))
      .then(function (payload) {
        var ticket = payload.ticket || {};
        var messages = listOf(payload, 'messages');
        var body =
          '<div class="stack"><div class="meta-list">' +
          detailRow('Subject', esc(ticket.subject)) +
          detailRow('Status', badge(ticket.status)) +
          detailRow('Opened', formatDate(ticket.createdAt)) +
          detailRow('Ticket ID', '<span class="mono">' + esc(truncateId(ticket.id)) + '</span>') +
          '</div><p>' + esc(ticket.description || '') + '</p>' +
          '<div class="message-thread">' +
          (messages.length
            ? messages.map(function (message) {
                return '<article class="message"><div class="message-head"><strong>' + esc(userLabel({ name: humanize(message.authorRole || 'Student') })) + '</strong><span class="small">' + esc(formatDate(message.createdAt)) + '</span></div><p class="small">' + esc(message.body) + '</p></article>';
              }).join('')
            : '<p class="muted small">No replies yet.</p>') +
          '</div>' +
          (isAdmin()
            ? '<form class="form-grid" data-form="respond-ticket">' +
              '<input type="hidden" name="id" value="' + esc(ticket.id) + '" />' +
              '<div class="field span-2"><label for="response-body">Reply</label><textarea class="textarea" id="response-body" name="body" required></textarea></div>' +
              '<div class="field"><label for="response-status">Status</label><select class="select" id="response-status" name="status">' + options(['IN_PROGRESS', 'RESOLVED'], ticket.status) + '</select></div>' +
              '<div class="form-actions"><button class="btn btn-primary" type="submit">Send reply</button>' +
              (String(ticket.status).toUpperCase() !== 'RESOLVED'
                ? '<button class="btn" type="button" data-action="resolve-ticket" data-id="' + esc(ticket.id) + '">Resolve without reply</button>'
                : '') +
              '</div></form>'
            : '') +
          '</div>';
        openModal({ title: ticket.subject || 'Support ticket', body: body, size: 'lg' });
      })
      .catch(notifyError);
  }

  /* ==========================================================================
     Administration console (FR3, FR6, FR10, FR14, FR17, FR23, FR24)
     ========================================================================== */

  function adminUsers() {
    return api('user', '/api/admin/users').then(function (payload) {
      var users = listOf(payload, 'items');
      var rows = users.map(function (user) {
        return (
          '<tr><td><div class="cell-title">' + esc(user.name) + '</div><div class="cell-sub">' + esc(user.email) + '</div></td>' +
          '<td><form class="inline-form" data-form="change-role"><input type="hidden" name="id" value="' + esc(user.id) + '" />' +
          '<select class="select" name="role">' + options(['STUDENT', 'STAFF', 'CLUB_LEADER', 'ADMIN'], user.role) + '</select>' +
          '<input class="input" name="clubId" value="' + esc(user.clubId || '') + '" placeholder="Club ID (leaders)" aria-label="Club ID for ' + esc(user.name) + '" />' +
          '<button class="btn btn-sm" type="submit">Save</button></form></td>' +
          '<td><form class="inline-form" data-form="change-status"><input type="hidden" name="id" value="' + esc(user.id) + '" />' +
          '<select class="select" name="status">' + options(['ACTIVE', 'SUSPENDED', 'DEACTIVATED'], user.status) + '</select>' +
          '<button class="btn btn-sm" type="submit">Save</button></form></td>' +
          '<td>' + esc(formatDate(user.createdAt, false)) + '</td></tr>'
        );
      });
      return (
        '<div class="grid-wide"><div class="stack">' +
        panel('Users (' + users.length + ')', table(['User', 'Role', 'Status', 'Created'], rows), { subtitle: 'Assign roles and manage account status' }) +
        '</div><div class="side-stack">' +
        panel('Create staff account', '<form class="form-grid" data-form="create-user">' +
          '<div class="field span-2"><label for="new-user-name">Full name</label><input class="input" id="new-user-name" name="name" required /></div>' +
          '<div class="field span-2"><label for="new-user-email">Email</label><input class="input" id="new-user-email" name="email" type="email" required /></div>' +
          '<div class="field span-2"><label for="new-user-password">Temporary password</label><input class="input" id="new-user-password" name="password" type="password" minlength="8" required /></div>' +
          '<div class="field span-2"><label for="new-user-role">Role</label><select class="select" id="new-user-role" name="role">' + options(['STAFF', 'CLUB_LEADER', 'ADMIN'], 'STAFF') + '</select></div>' +
          '<div class="field span-2"><label for="new-user-club">Club ID <span class="optional">(for club leaders)</span></label><input class="input" id="new-user-club" name="clubId" /></div>' +
          '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Create account</button></div></form>') +
        '</div></div>'
      );
    });
  }

  function adminHousing() {
    return Promise.allSettled([api('accommodation', '/api/buildings'), api('accommodation', '/api/rooms')]).then(function (results) {
      var buildings = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var rooms = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var buildingOptions = buildings.map(function (building) { return building.id; });
      var buildingLabels = buildings.reduce(function (acc, building) { acc[building.id] = building.name; return acc; }, {});
      var buildingRows = buildings.map(function (building) {
        return '<tr><td>' + esc(building.name) + '</td><td>' + esc(building.address || '—') + '</td><td>' + esc(building.roomCount === undefined ? '—' : building.roomCount) + '</td><td class="nowrap"><button class="btn btn-sm" type="button" data-action="edit-building" data-id="' + esc(building.id) + '">Edit</button></td></tr>';
      });
      var roomRows = rooms.map(function (room) {
        return '<tr><td>' + esc(room.name) + '</td><td>' + esc(room.buildingName || truncateId(room.buildingId)) + '</td><td>' + formatMoney(room.price) + '</td><td>' + esc(room.capacity) + '</td>' +
          '<td><form class="inline-form" data-form="room-availability"><input type="hidden" name="id" value="' + esc(room.id) + '" /><select class="select" name="status">' + options(['AVAILABLE', 'BOOKED', 'MAINTENANCE'], room.status) + '</select><button class="btn btn-sm" type="submit">Save</button></form></td>' +
          '<td class="nowrap"><button class="btn btn-sm" type="button" data-action="edit-room" data-id="' + esc(room.id) + '">Edit</button></td></tr>';
      });
      return (
        '<div class="stack">' +
        panel('Buildings (' + buildings.length + ')', results[0].status === 'fulfilled' ? table(['Name', 'Address', 'Rooms', 'Action'], buildingRows) : errorPanel(results[0].reason)) +
        panel('Rooms (' + rooms.length + ')', results[1].status === 'fulfilled' ? table(['Room', 'Building', 'Price', 'Capacity', 'Availability', 'Action'], roomRows) : errorPanel(results[1].reason)) +
        '<details class="panel"><summary>Add a building or room</summary><div class="details-body">' +
        '<div class="grid grid-2">' +
        '<form class="form-grid" data-form="create-building"><h3>New building</h3>' +
        '<div class="field"><label for="building-name">Name</label><input class="input" id="building-name" name="name" required /></div>' +
        '<div class="field"><label for="building-address">Address</label><input class="input" id="building-address" name="address" /></div>' +
        '<div class="field span-2"><label for="building-description">Description</label><input class="input" id="building-description" name="description" /></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Add building</button></div></form>' +
        '<form class="form-grid" data-form="create-room"><h3>New room</h3>' +
        '<div class="field"><label for="room-building">Building</label><select class="select" id="room-building" name="buildingId">' + options(buildingOptions, '', buildingLabels) + '</select></div>' +
        '<div class="field"><label for="room-name">Room name</label><input class="input" id="room-name" name="name" required /></div>' +
        '<div class="field"><label for="room-type">Type</label><input class="input" id="room-type" name="type" value="SINGLE" /></div>' +
        '<div class="field"><label for="room-price">Nightly price</label><input class="input" id="room-price" name="price" type="number" min="0" step="0.01" required /></div>' +
        '<div class="field"><label for="room-capacity">Capacity</label><input class="input" id="room-capacity" name="capacity" type="number" min="1" required /></div>' +
        '<div class="field"><label for="room-amenities">Amenities <span class="optional">(comma separated)</span></label><input class="input" id="room-amenities" name="amenities" /></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Add room</button></div></form>' +
        '</div></div></details></div>'
      );
    });
  }

  function adminTransport() {
    return Promise.allSettled([api('transport', '/api/routes'), api('transport', '/api/schedules')]).then(function (results) {
      var routes = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var schedules = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var routeOptions = routes.map(function (route) { return route.id; });
      var routeLabels = routes.reduce(function (acc, route) { acc[route.id] = route.name; return acc; }, {});
      var routeRows = routes.map(function (route) {
        return '<tr><td>' + esc(route.name) + '</td><td>' + esc(route.origin || '—') + ' → ' + esc(route.destination || '—') + '</td><td>' + formatMoney(route.fare) + '</td><td>' + badge(route.status) + '</td><td class="nowrap"><button class="btn btn-sm" type="button" data-action="edit-route" data-id="' + esc(route.id) + '">Edit</button> <button class="btn btn-danger btn-sm" type="button" data-action="delete-route" data-id="' + esc(route.id) + '">Delete</button></td></tr>';
      });
      var scheduleRows = schedules.map(function (schedule) {
        return '<tr><td>' + esc(schedule.routeName || truncateId(schedule.routeId)) + '</td><td>' + esc(formatDate(schedule.departureAt, true)) + '</td><td>' + esc(schedule.vehicle || '—') + '</td><td>' + esc(schedule.seatsAvailable) + ' / ' + esc(schedule.capacity) + '</td><td>' + badge(schedule.status) + '</td><td class="nowrap"><button class="btn btn-sm" type="button" data-action="edit-schedule" data-id="' + esc(schedule.id) + '">Edit</button> <button class="btn btn-danger btn-sm" type="button" data-action="delete-schedule" data-id="' + esc(schedule.id) + '">Delete</button></td></tr>';
      });
      return (
        '<div class="stack">' +
        panel('Routes (' + routes.length + ')', results[0].status === 'fulfilled' ? table(['Route', 'Path', 'Fare', 'Status', 'Action'], routeRows) : errorPanel(results[0].reason)) +
        panel('Schedules (' + schedules.length + ')', results[1].status === 'fulfilled' ? table(['Route', 'Departs', 'Vehicle', 'Seats', 'Status', 'Action'], scheduleRows) : errorPanel(results[1].reason)) +
        '<details class="panel"><summary>Add a route or schedule</summary><div class="details-body"><div class="grid grid-2">' +
        '<form class="form-grid" data-form="create-route"><h3>New route</h3>' +
        '<div class="field"><label for="route-name">Name</label><input class="input" id="route-name" name="name" required /></div>' +
        '<div class="field"><label for="route-origin">Origin</label><input class="input" id="route-origin" name="origin" /></div>' +
        '<div class="field"><label for="route-destination">Destination</label><input class="input" id="route-destination" name="destination" /></div>' +
        '<div class="field"><label for="route-fare">Fare</label><input class="input" id="route-fare" name="fare" type="number" min="0" step="0.01" required /></div>' +
        '<div class="field span-2"><label for="route-description">Description</label><input class="input" id="route-description" name="description" /></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Add route</button></div></form>' +
        '<form class="form-grid" data-form="create-schedule"><h3>New schedule</h3>' +
        '<div class="field"><label for="schedule-route">Route</label><select class="select" id="schedule-route" name="routeId">' + options(routeOptions, '', routeLabels) + '</select></div>' +
        '<div class="field"><label for="schedule-departure">Departure</label><input class="input" id="schedule-departure" name="departureAt" type="datetime-local" required /></div>' +
        '<div class="field"><label for="schedule-arrival">Arrival <span class="optional">(optional)</span></label><input class="input" id="schedule-arrival" name="arrivalAt" type="datetime-local" /></div>' +
        '<div class="field"><label for="schedule-vehicle">Vehicle</label><input class="input" id="schedule-vehicle" name="vehicle" /></div>' +
        '<div class="field"><label for="schedule-capacity">Capacity</label><input class="input" id="schedule-capacity" name="capacity" type="number" min="1" required /></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Add schedule</button></div></form>' +
        '</div></div></details></div>'
      );
    });
  }

  function adminClubs() {
    return Promise.allSettled([api('club', '/api/clubs?status=PENDING'), api('club', '/api/clubs')]).then(function (results) {
      var pending = results[0].status === 'fulfilled' ? listOf(results[0].value, 'items') : [];
      var approved = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      var pendingRows = pending.map(function (club) {
        return '<tr><td>' + esc(club.name) + '</td><td>' + esc(club.category) + '</td><td>' + esc(truncateId(club.proposedBy || '')) + '</td><td>' + badge(club.status) + '</td><td class="nowrap">' +
          '<button class="btn btn-primary btn-sm" type="button" data-action="approve-club" data-id="' + esc(club.id) + '">Approve</button> ' +
          '<button class="btn btn-danger btn-sm" type="button" data-action="reject-club" data-id="' + esc(club.id) + '">Reject</button></td></tr>';
      });
      var approvedRows = approved.map(function (club) {
        return '<tr><td>' + esc(club.name) + '</td><td>' + esc(club.category) + '</td><td>' + esc(club.memberCount === undefined ? '—' : club.memberCount) + '</td><td><form class="inline-form" data-form="assign-leader"><input type="hidden" name="id" value="' + esc(club.id) + '" /><input class="input" name="userId" value="' + esc(club.leaderId || '') + '" placeholder="User ID" aria-label="Leader for ' + esc(club.name) + '" required /><button class="btn btn-sm" type="submit">Assign</button></form></td><td class="nowrap"><button class="btn btn-danger btn-sm" type="button" data-action="suspend-club" data-id="' + esc(club.id) + '">Suspend</button></td></tr>';
      });
      return (
        '<div class="stack">' +
        panel('Pending proposals (' + pending.length + ')', results[0].status === 'fulfilled' ? table(['Club', 'Category', 'Proposed by', 'Status', 'Action'], pendingRows) : errorPanel(results[0].reason), { subtitle: 'Approve or reject new club requests' }) +
        panel('Approved clubs (' + approved.length + ')', results[1].status === 'fulfilled' ? table(['Club', 'Category', 'Members', 'Leader', 'Action'], approvedRows) : errorPanel(results[1].reason), { subtitle: 'Assign club leaders or suspend a club' }) +
        '</div>'
      );
    });
  }

  function adminDining() {
    return api('dining', '/api/meals').then(function (payload) {
      var meals = listOf(payload, 'items');
      var rows = meals.map(function (meal) {
        return '<tr><td>' + esc(meal.name) + '</td><td>' + esc(formatDate(meal.mealDate, false)) + '</td><td>' + formatMoney(meal.price) + '</td>' +
          '<td><form class="inline-form" data-form="meal-stock"><input type="hidden" name="id" value="' + esc(meal.id) + '" /><select class="select" name="stockStatus">' + options(['AVAILABLE', 'OUT_OF_STOCK'], meal.stockStatus) + '</select><button class="btn btn-sm" type="submit">Save</button></form></td>' +
          '<td class="nowrap"><button class="btn btn-sm" type="button" data-action="edit-meal" data-id="' + esc(meal.id) + '">Edit</button> <button class="btn btn-danger btn-sm" type="button" data-action="delete-meal" data-id="' + esc(meal.id) + '">Delete</button></td></tr>';
      });
      return (
        '<div class="stack">' +
        panel('Meals (' + meals.length + ')', table(['Meal', 'Date', 'Price', 'Stock', 'Action'], rows)) +
        '<details class="panel"><summary>Add a meal</summary><div class="details-body"><form class="form-grid" data-form="create-meal">' +
        '<div class="field"><label for="new-meal-name">Name</label><input class="input" id="new-meal-name" name="name" required /></div>' +
        '<div class="field"><label for="new-meal-price">Price</label><input class="input" id="new-meal-price" name="price" type="number" min="0" step="0.01" required /></div>' +
        '<div class="field"><label for="new-meal-date">Meal date</label><input class="input" id="new-meal-date" name="mealDate" type="date" required /></div>' +
        '<div class="field"><label for="new-meal-category">Category</label><input class="input" id="new-meal-category" name="category" value="MAIN" /></div>' +
        '<div class="field"><label for="new-meal-ingredients">Ingredients <span class="optional">(comma separated)</span></label><input class="input" id="new-meal-ingredients" name="ingredients" /></div>' +
        '<div class="field"><label for="new-meal-allergens">Allergens <span class="optional">(comma separated)</span></label><input class="input" id="new-meal-allergens" name="allergens" /></div>' +
        '<div class="field"><label for="new-meal-nutrition">Nutrition <span class="optional">(e.g. calories:550, protein:35g)</span></label><input class="input" id="new-meal-nutrition" name="nutrition" /></div>' +
        '<div class="field span-2"><label for="new-meal-description">Description</label><input class="input" id="new-meal-description" name="description" /></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Add meal</button></div></form></div></details></div>'
      );
    });
  }

  function adminLibrary() {
    return api('library', '/api/resources').then(function (payload) {
      var resources = listOf(payload, 'items');
      var rows = resources.map(function (resource) {
        return '<tr><td>' + esc(resource.title) + '</td><td>' + esc(humanize(resource.type)) + '</td><td>' + esc(resource.author || '—') + '</td><td>' + esc(resource.copiesAvailable) + ' / ' + esc(resource.copiesTotal) + '</td><td class="nowrap"><button class="btn btn-sm" type="button" data-action="edit-resource" data-id="' + esc(resource.id) + '">Edit</button> <button class="btn btn-danger btn-sm" type="button" data-action="delete-resource" data-id="' + esc(resource.id) + '">Delete</button></td></tr>';
      });
      return (
        '<div class="stack">' +
        panel('Catalogue (' + resources.length + ')', table(['Title', 'Type', 'Author', 'Copies', 'Action'], rows)) +
        '<details class="panel"><summary>Add a resource</summary><div class="details-body"><form class="form-grid" data-form="create-resource">' +
        '<div class="field"><label for="new-resource-title">Title</label><input class="input" id="new-resource-title" name="title" required /></div>' +
        '<div class="field"><label for="new-resource-type">Type</label><select class="select" id="new-resource-type" name="type">' + options(['PRINTED_BOOK', 'DIGITAL'], 'PRINTED_BOOK') + '</select></div>' +
        '<div class="field"><label for="new-resource-author">Author</label><input class="input" id="new-resource-author" name="author" /></div>' +
        '<div class="field"><label for="new-resource-subject">Subject</label><input class="input" id="new-resource-subject" name="subject" /></div>' +
        '<div class="field"><label for="new-resource-isbn">ISBN</label><input class="input" id="new-resource-isbn" name="isbn" /></div>' +
        '<div class="field"><label for="new-resource-url">Digital URL</label><input class="input" id="new-resource-url" name="url" /></div>' +
        '<div class="field"><label for="new-resource-copies">Copies</label><input class="input" id="new-resource-copies" name="copiesTotal" type="number" min="0" value="1" /></div>' +
        '<div class="field span-2"><label for="new-resource-description">Description</label><input class="input" id="new-resource-description" name="description" /></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Add resource</button></div></form></div></details></div>'
      );
    });
  }

  function adminPayments() {
    return api('payment', '/api/refunds').then(function (payload) {
      var refunds = listOf(payload, 'items');
      var rows = refunds.map(function (refund) {
        return '<tr><td class="mono">' + esc(truncateId(refund.paymentId)) + '</td><td class="mono">' + esc(truncateId(refund.studentId)) + '</td><td>' + formatMoney(refund.amount) + '</td>' +
          '<td>' + esc(truncate(refund.reason || '', 70)) + '</td><td>' + badge(refund.status) + '</td><td class="nowrap">' +
          (refund.status === 'REQUESTED'
            ? '<form class="inline-form" data-form="process-refund"><input type="hidden" name="id" value="' + esc(refund.id) + '" /><select class="select" name="action">' + options(['approve', 'reject'], 'approve') + '</select><button class="btn btn-sm" type="submit">Apply</button></form>'
            : refund.status === 'APPROVED'
              ? '<button class="btn btn-primary btn-sm" type="button" data-action="issue-refund" data-id="' + esc(refund.id) + '">Issue refund</button>'
              : '—') +
          '</td></tr>';
      });
      return panel('Refund requests (' + refunds.length + ')', table(['Payment', 'Student', 'Amount', 'Reason', 'Status', 'Action'], rows), { subtitle: 'Approve, reject and issue student refund requests' });
    });
  }

  var ADMIN_TABS = [
    { key: 'users', label: 'Users', render: adminUsers },
    { key: 'housing', label: 'Housing', render: adminHousing },
    { key: 'transport', label: 'Transport', render: adminTransport },
    { key: 'clubs', label: 'Club approvals', render: adminClubs },
    { key: 'dining', label: 'Dining', render: adminDining },
    { key: 'library', label: 'Library', render: adminLibrary },
    { key: 'payments', label: 'Refunds', render: adminPayments },
  ];

  function renderAdmin() {
    if (!isAdmin()) return Promise.resolve(errorPanel(new ApiError(403, 'Administrator access is required.')));
    var tab = state.adminTab;
    if (!ADMIN_TABS.some(function (item) { return item.key === tab; })) tab = 'users';
    state.adminTab = tab;
    var tabs =
      '<nav class="tabs" aria-label="Administration sections">' +
      ADMIN_TABS.map(function (item) {
        return '<a class="tab" href="' + navHref('admin', item.key) + '"' + (item.key === tab ? ' aria-current="page"' : '') + '>' + esc(item.label) + '</a>';
      }).join('') +
      '</nav>';
    var selected = ADMIN_TABS.find(function (item) { return item.key === tab; });
    return Promise.resolve()
      .then(selected.render)
      .catch(function (error) {
        return errorPanel(error);
      })
      .then(function (html) {
        return pageHead({ eyebrow: 'Administration', title: 'Admin console', subtitle: 'Manage accounts, inventory, approvals and refunds across every service.' }) + tabs + html;
      });
  }

  /* ==========================================================================
     Analytics and settings (FR21–FR22)
     ========================================================================== */

  function renderAnalytics() {
    if (!isAdmin()) return Promise.resolve(errorPanel(new ApiError(403, 'Administrator access is required.')));
    return Promise.allSettled([
      api('communication', '/api/admin/analytics/summary'),
      api('communication', '/api/admin/reports/clubs').catch(function () { return null; }),
    ]).then(function (results) {
      var summary = results[0].status === 'fulfilled' ? results[0].value.summary || results[0].value : {};
      var peers = summary.peers || {};
      var tiles = [
        ['Notifications', summary.notifications],
        ['Unread alerts', summary.unreadNotifications],
        ['Support tickets', summary.tickets],
        ['Open tickets', summary.openTickets],
        ['Announcements', summary.announcements],
      ];
      var peerRows = Object.keys(peers).map(function (key) {
        var stats = peers[key];
        return '<tr><td>' + esc(humanize(key)) + '</td><td>' +
          (stats ? Object.keys(stats).map(function (metric) { return esc(humanize(metric)) + ': <strong>' + esc(stats[metric]) + '</strong>'; }).join('<br />') : 'Unavailable') +
          '</td></tr>';
      });
      var reportText = results[1].status === 'fulfilled' && typeof results[1].value === 'string' ? results[1].value : '';
      var reportRows = reportText.split('\n').filter(Boolean).slice(0, 8).map(function (line) {
        return '<tr>' + line.split(',').map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join('') + '</tr>';
      });

      return (
        pageHead({ eyebrow: 'FR21', title: 'Analytics & reports', subtitle: 'Cross-service statistics and an exportable club report.' }) +
        '<div class="grid grid-3">' + tiles.map(function (tile) { return '<div class="stat"><div class="stat-value">' + esc(tile[1] === undefined ? '—' : tile[1]) + '</div><div class="stat-label">' + esc(tile[0]) + '</div></div>'; }).join('') + '</div>' +
        panelResult(results[0], 'Cross-service summary', function () { return table(['Service', 'Statistics'], peerRows); }, 'Live data from each service') +
        panel('Club report', reportText
          ? '<div class="stack"><div class="table-wrap"><table class="data-table"><tbody>' + reportRows.join('') + '</tbody></table></div><button class="btn btn-primary btn-sm" type="button" data-action="download-club-report">' + icon('download', 'icon-sm') + ' Download CSV</button></div>'
          : emptyState('Report unavailable', 'The club service did not return a report.', 'info'), {
          subtitle: 'CSV generated from approved clubs',
          actions: '<button class="btn btn-sm" type="button" data-action="retry">' + icon('refresh', 'icon-sm') + ' Refresh</button>',
        })
      );
    });
  }

  function renderSettings() {
    return Promise.allSettled([api('communication', '/api/settings/semester'), api('communication', '/api/announcements')]).then(function (results) {
      var semester = semesterParts(results[0].status === 'fulfilled' ? results[0].value : null);
      var announcements = results[1].status === 'fulfilled' ? listOf(results[1].value, 'items') : [];
      return (
        pageHead({ eyebrow: 'FR22', title: 'Settings', subtitle: 'Semester dates and campus announcements.' }) +
        '<div class="grid-wide"><div class="stack">' +
        panelResult(results[1], 'Announcements (' + announcements.length + ')', function () {
          return announcements.length ? '<div class="stack-sm">' + announcements.map(function (item) {
            return '<article class="message"><div class="message-head"><strong>' + esc(item.title) + '</strong><span class="small">' + esc(formatDate(item.createdAt, false)) + '</span></div><p class="small">' + esc(stripHtml(item.body)) + '</p></article>';
          }).join('') + '</div>' : emptyState('No announcements', 'Check back later for campus news.', 'bell');
        }, 'Published for every user') +
        (isAdmin()
          ? panel('Publish an announcement', '<form class="form-grid" data-form="create-announcement">' +
            '<div class="field span-2"><label for="announcement-title">Title</label><input class="input" id="announcement-title" name="title" required /></div>' +
            '<div class="field span-2"><label for="announcement-body">Message</label><textarea class="textarea" id="announcement-body" name="body" required></textarea></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Publish</button></div></form>')
          : '') +
        '</div><div class="side-stack">' +
        panel('Semester dates', '<div class="meta-list">' + detailRow('Starts', esc(formatDate(semester.startDate, false))) + detailRow('Ends', esc(formatDate(semester.endDate, false))) + '</div>') +
        (isAdmin()
          ? panel('Update semester', '<form class="form-grid" data-form="update-semester">' +
            '<div class="field"><label for="semester-start">Start date</label><input class="input" id="semester-start" name="startDate" type="date" value="' + esc(semester.startDate) + '" required /></div>' +
            '<div class="field"><label for="semester-end">End date</label><input class="input" id="semester-end" name="endDate" type="date" value="' + esc(semester.endDate) + '" required /></div>' +
            '<div class="form-actions"><button class="btn btn-primary" type="submit">Save dates</button></div></form>')
          : '') +
        '</div></div>'
      );
    });
  }

  /* ==========================================================================
     Shared action and form plumbing
     ========================================================================== */

  var VIEWS = {
    dashboard: renderDashboard,
    profile: renderProfile,
    accommodation: renderAccommodation,
    transport: renderTransport,
    clubs: renderClubs,
    dining: renderDining,
    library: renderLibrary,
    payments: renderPayments,
    notifications: renderNotifications,
    tickets: renderTickets,
    admin: renderAdmin,
    analytics: renderAnalytics,
    settings: renderSettings,
  };

  function perform(task, message, options) {
    var settings = options || {};
    return Promise.resolve()
      .then(task)
      .then(function (result) {
        if (message) toast(message, 'success');
        if (settings.closeModal !== false) closeModal();
        if (settings.refresh !== false) refresh();
        return result;
      })
      .catch(function (error) {
        notifyError(error);
        return null;
      });
  }

  function runForm(form, message, task) {
    clearFormMessage(form);
    setFormBusy(form, true, 'Saving…');
    return Promise.resolve()
      .then(task)
      .then(function () {
        setFormBusy(form, false);
        if (message) toast(message, 'success');
        closeModal();
        refresh();
      })
      .catch(function (error) {
        setFormBusy(form, false);
        formMessage(form, errorText(error), 'error');
        notifyError(error);
      });
  }

  function normaliseFormData(form, data) {
    Array.prototype.forEach.call(form.querySelectorAll('input[type="checkbox"]'), function (input) {
      data[input.name] = input.checked;
    });
    return data;
  }

  function withId(path, id) {
    return path + '/' + encodeURIComponent(id);
  }

  function editBuilding(id) {
    return api('accommodation', '/api/buildings')
      .then(function (payload) {
        var building = listOf(payload, 'items').find(function (item) { return item.id === id; });
        if (!building) throw new Error('Building not found');
        openModal({
          title: 'Edit building',
          size: 'sm',
          body: '<form class="form-grid" data-form="edit-building">' +
            '<input type="hidden" name="id" value="' + esc(building.id) + '" />' +
            '<div class="field"><label for="edit-building-name">Name</label><input class="input" id="edit-building-name" name="name" value="' + esc(building.name) + '" required /></div>' +
            '<div class="field"><label for="edit-building-address">Address</label><input class="input" id="edit-building-address" name="address" value="' + esc(building.address || '') + '" /></div>' +
            '<div class="field span-2"><label for="edit-building-description">Description</label><input class="input" id="edit-building-description" name="description" value="' + esc(building.description || '') + '" /></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Save building</button></div></form>',
        });
      })
      .catch(notifyError);
  }

  function editRoom(id) {
    return api('accommodation', '/api/rooms/' + encodeURIComponent(id))
      .then(function (payload) {
        var room = payload.room || {};
        openModal({
          title: 'Edit room',
          size: 'lg',
          body: '<form class="form-grid" data-form="edit-room">' +
            '<input type="hidden" name="id" value="' + esc(room.id) + '" />' +
            '<div class="field"><label for="edit-room-name">Name</label><input class="input" id="edit-room-name" name="name" value="' + esc(room.name) + '" required /></div>' +
            '<div class="field"><label for="edit-room-type">Type</label><input class="input" id="edit-room-type" name="type" value="' + esc(room.type || '') + '" /></div>' +
            '<div class="field"><label for="edit-room-price">Price</label><input class="input" id="edit-room-price" name="price" type="number" min="0" step="0.01" value="' + esc(room.price) + '" /></div>' +
            '<div class="field"><label for="edit-room-capacity">Capacity</label><input class="input" id="edit-room-capacity" name="capacity" type="number" min="1" value="' + esc(room.capacity) + '" /></div>' +
            '<div class="field span-2"><label for="edit-room-amenities">Amenities <span class="optional">(comma separated)</span></label><input class="input" id="edit-room-amenities" name="amenities" value="' + esc(arrayOf(room.amenities).join(', ')) + '" /></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Save room</button></div></form>',
        });
      })
      .catch(notifyError);
  }

  function editRoute(id) {
    return api('transport', '/api/routes/' + encodeURIComponent(id))
      .then(function (payload) {
        var route = payload.route || {};
        openModal({
          title: 'Edit route',
          size: 'lg',
          body: '<form class="form-grid" data-form="edit-route">' +
            '<input type="hidden" name="id" value="' + esc(route.id) + '" />' +
            '<div class="field"><label for="edit-route-name">Name</label><input class="input" id="edit-route-name" name="name" value="' + esc(route.name) + '" required /></div>' +
            '<div class="field"><label for="edit-route-origin">Origin</label><input class="input" id="edit-route-origin" name="origin" value="' + esc(route.origin || '') + '" /></div>' +
            '<div class="field"><label for="edit-route-destination">Destination</label><input class="input" id="edit-route-destination" name="destination" value="' + esc(route.destination || '') + '" /></div>' +
            '<div class="field"><label for="edit-route-fare">Fare</label><input class="input" id="edit-route-fare" name="fare" type="number" min="0" step="0.01" value="' + esc(route.fare) + '" /></div>' +
            '<div class="field"><label for="edit-route-status">Status</label><select class="select" id="edit-route-status" name="status">' + options(['ACTIVE', 'INACTIVE'], route.status) + '</select></div>' +
            '<div class="field"><label for="edit-route-description">Description</label><input class="input" id="edit-route-description" name="description" value="' + esc(route.description || '') + '" /></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Save route</button></div></form>',
        });
      })
      .catch(notifyError);
  }

  function editSchedule(id) {
    return api('transport', '/api/schedules')
      .then(function (payload) {
        var schedule = listOf(payload, 'items').find(function (item) { return item.id === id; });
        if (!schedule) throw new Error('Schedule not found');
        openModal({
          title: 'Edit schedule',
          size: 'lg',
          body: '<form class="form-grid" data-form="edit-schedule">' +
            '<input type="hidden" name="id" value="' + esc(schedule.id) + '" />' +
            '<div class="field"><label for="edit-schedule-departure">Departure</label><input class="input" id="edit-schedule-departure" name="departureAt" type="datetime-local" value="' + esc(dateTimeLocal(schedule.departureAt)) + '" required /></div>' +
            '<div class="field"><label for="edit-schedule-arrival">Arrival</label><input class="input" id="edit-schedule-arrival" name="arrivalAt" type="datetime-local" value="' + esc(dateTimeLocal(schedule.arrivalAt)) + '" /></div>' +
            '<div class="field"><label for="edit-schedule-vehicle">Vehicle</label><input class="input" id="edit-schedule-vehicle" name="vehicle" value="' + esc(schedule.vehicle || '') + '" /></div>' +
            '<div class="field"><label for="edit-schedule-capacity">Capacity</label><input class="input" id="edit-schedule-capacity" name="capacity" type="number" min="1" value="' + esc(schedule.capacity) + '" /></div>' +
            '<div class="field"><label for="edit-schedule-status">Status</label><select class="select" id="edit-schedule-status" name="status">' + options(['SCHEDULED', 'CANCELLED', 'COMPLETED'], schedule.status) + '</select></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Save schedule</button></div></form>',
        });
      })
      .catch(notifyError);
  }

  function editMeal(id) {
    return api('dining', '/api/meals/' + encodeURIComponent(id))
      .then(function (payload) {
        var meal = payload.meal || {};
        var nutrition = Object.keys(meal.nutrition || {}).map(function (key) { return key + ':' + meal.nutrition[key]; }).join(', ');
        openModal({
          title: 'Edit meal',
          size: 'lg',
          body: '<form class="form-grid" data-form="edit-meal">' +
            '<input type="hidden" name="id" value="' + esc(meal.id) + '" />' +
            '<div class="field"><label for="edit-meal-name">Name</label><input class="input" id="edit-meal-name" name="name" value="' + esc(meal.name) + '" required /></div>' +
            '<div class="field"><label for="edit-meal-price">Price</label><input class="input" id="edit-meal-price" name="price" type="number" min="0" step="0.01" value="' + esc(meal.price) + '" /></div>' +
            '<div class="field"><label for="edit-meal-date">Meal date</label><input class="input" id="edit-meal-date" name="mealDate" type="date" value="' + esc(meal.mealDate) + '" required /></div>' +
            '<div class="field"><label for="edit-meal-category">Category</label><input class="input" id="edit-meal-category" name="category" value="' + esc(meal.category || '') + '" /></div>' +
            '<div class="field"><label for="edit-meal-ingredients">Ingredients</label><input class="input" id="edit-meal-ingredients" name="ingredients" value="' + esc(arrayOf(meal.ingredients).join(', ')) + '" /></div>' +
            '<div class="field"><label for="edit-meal-allergens">Allergens</label><input class="input" id="edit-meal-allergens" name="allergens" value="' + esc(arrayOf(meal.allergens).join(', ')) + '" /></div>' +
            '<div class="field span-2"><label for="edit-meal-nutrition">Nutrition (key:value)</label><input class="input" id="edit-meal-nutrition" name="nutrition" value="' + esc(nutrition) + '" /></div>' +
            '<div class="field span-2"><label for="edit-meal-description">Description</label><input class="input" id="edit-meal-description" name="description" value="' + esc(meal.description || '') + '" /></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Save meal</button></div></form>',
        });
      })
      .catch(notifyError);
  }

  function editResource(id) {
    return api('library', '/api/resources/' + encodeURIComponent(id))
      .then(function (payload) {
        var resource = payload.resource || {};
        openModal({
          title: 'Edit resource',
          size: 'lg',
          body: '<form class="form-grid" data-form="edit-resource">' +
            '<input type="hidden" name="id" value="' + esc(resource.id) + '" />' +
            '<div class="field"><label for="edit-resource-title">Title</label><input class="input" id="edit-resource-title" name="title" value="' + esc(resource.title) + '" required /></div>' +
            '<div class="field"><label for="edit-resource-type">Type</label><select class="select" id="edit-resource-type" name="type">' + options(['PRINTED_BOOK', 'DIGITAL'], resource.type) + '</select></div>' +
            '<div class="field"><label for="edit-resource-author">Author</label><input class="input" id="edit-resource-author" name="author" value="' + esc(resource.author || '') + '" /></div>' +
            '<div class="field"><label for="edit-resource-subject">Subject</label><input class="input" id="edit-resource-subject" name="subject" value="' + esc(resource.subject || '') + '" /></div>' +
            '<div class="field"><label for="edit-resource-isbn">ISBN</label><input class="input" id="edit-resource-isbn" name="isbn" value="' + esc(resource.isbn || '') + '" /></div>' +
            '<div class="field"><label for="edit-resource-url">Digital URL</label><input class="input" id="edit-resource-url" name="url" value="' + esc(resource.url || '') + '" /></div>' +
            '<div class="field"><label for="edit-resource-copies">Copies</label><input class="input" id="edit-resource-copies" name="copiesTotal" type="number" min="0" value="' + esc(resource.copiesTotal) + '" /></div>' +
            '<div class="field span-2"><label for="edit-resource-description">Description</label><input class="input" id="edit-resource-description" name="description" value="' + esc(resource.description || '') + '" /></div>' +
            '<div class="form-actions span-2"><button class="btn btn-primary" type="submit">Save resource</button></div></form>',
        });
      })
      .catch(notifyError);
  }

  function confirmDelete(title, message, task) {
    confirmDialog({ title: title, message: message, confirmLabel: 'Delete', danger: true }, function () {
      return perform(task, 'Deleted successfully.');
    });
  }

  /* ==========================================================================
     Actions
     ========================================================================== */

  var ACTIONS = {
    logout: function () {
      clearSession();
      state.authNotice = null;
      state.authTab = 'login';
      location.hash = '#/login';
      renderRoute();
    },
    retry: function () {
      refresh();
    },
    'auth-tab': function (dataset) {
      state.authNotice = null;
      renderAuth(dataset.tab);
    },
    'demo-login': function (dataset, button) {
      return withButtonBusy(button, function () {
        return api('user', '/api/auth/login', {
          auth: false,
          method: 'POST',
          body: { email: dataset.email, password: dataset.password },
        }).then(function (payload) {
          saveSession(payload.token, payload.user);
          state.authNotice = null;
          location.hash = navHref('dashboard');
          renderRoute();
        });
      }).catch(notifyError);
    },
    'reset-filter': function (dataset) {
      state.filters = state.filters || {};
      state.filters[dataset.filter] = {};
      refresh();
    },
    'room-details': function (dataset) {
      return showRoomDetails(dataset.id);
    },
    'room-reviews': function (dataset) {
      return showRoomDetails(dataset.id);
    },
    'route-details': function (dataset) {
      return showRouteDetails(dataset.id);
    },
    'cancel-stay': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('accommodation', withId('/api/bookings', dataset.id) + '/cancel', { method: 'POST' });
        }, 'Booking cancelled and refunded.');
      });
    },
    'book-transport': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('transport', '/api/bookings', { method: 'POST', body: { scheduleId: dataset.id } });
        }, 'Seat booked successfully.');
      });
    },
    'cancel-trip': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('transport', withId('/api/bookings', dataset.id) + '/cancel', { method: 'POST' });
        }, 'Trip cancelled and refunded.');
      });
    },
    'join-club': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('club', withId('/api/clubs', dataset.id) + '/join', { method: 'POST' });
        }, 'You joined the club.');
      });
    },
    'leave-club': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('club', withId('/api/clubs', dataset.id) + '/leave', { method: 'POST' });
        }, 'You left the club.');
      });
    },
    'club-details': function (dataset) {
      return showClubDetails(dataset.id);
    },
    'edit-event': function (dataset) {
      return showEventEditor(dataset.id);
    },
    'delete-event': function (dataset) {
      confirmDelete('Delete event', 'This event will be removed permanently.', function () {
        return api('club', withId('/api/events', dataset.id), { method: 'DELETE' });
      });
    },
    'meal-details': function (dataset) {
      return showMealDetails(dataset.id);
    },
    'cancel-order': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('dining', withId('/api/orders', dataset.id) + '/cancel', { method: 'POST' });
        }, 'Order cancelled and refunded.');
      });
    },
    'resource-access': function (dataset, button) {
      return withButtonBusy(button, function () {
        return api('library', withId('/api/resources', dataset.id) + '/access', { method: 'POST' })
          .then(function (payload) {
            showAccessResult(payload);
            refresh();
          })
          .catch(notifyError);
      });
    },
    'resource-details': function (dataset) {
      return showResourceDetails(dataset.id);
    },
    'reservation-collect': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('library', withId('/api/reservations', dataset.id) + '/collect', { method: 'POST' });
        }, 'Reservation marked as collected.');
      });
    },
    'reservation-cancel': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('library', withId('/api/reservations', dataset.id) + '/cancel', { method: 'POST' });
        }, 'Reservation cancelled.');
      });
    },
    'reservation-return': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('library', withId('/api/reservations', dataset.id) + '/return', { method: 'POST' });
        }, 'Resource returned. Thank you.');
      });
    },
    'payment-details': function (dataset) {
      return showPaymentDetails(dataset.id);
    },
    'mark-read': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('communication', withId('/api/notifications', dataset.id) + '/read', { method: 'PATCH' });
        }, 'Notification marked as read.');
      });
    },
    'ticket-details': function (dataset) {
      return showTicketDetails(dataset.id);
    },
    'resolve-ticket': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('communication', withId('/api/admin/tickets', dataset.id) + '/status', { method: 'PATCH', body: { status: 'RESOLVED' } });
        }, 'Ticket resolved.');
      });
    },
    'edit-building': function (dataset) {
      return editBuilding(dataset.id);
    },
    'edit-room': function (dataset) {
      return editRoom(dataset.id);
    },
    'edit-route': function (dataset) {
      return editRoute(dataset.id);
    },
    'delete-route': function (dataset) {
      confirmDelete('Delete route', 'All schedules for this route must be removed first.', function () {
        return api('transport', withId('/api/admin/routes', dataset.id), { method: 'DELETE' });
      });
    },
    'edit-schedule': function (dataset) {
      return editSchedule(dataset.id);
    },
    'delete-schedule': function (dataset) {
      confirmDelete('Delete schedule', 'This departure will no longer be available.', function () {
        return api('transport', withId('/api/admin/schedules', dataset.id), { method: 'DELETE' });
      });
    },
    'approve-club': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('club', withId('/api/admin/clubs', dataset.id) + '/approve', { method: 'POST' });
        }, 'Club approved.');
      });
    },
    'reject-club': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('club', withId('/api/admin/clubs', dataset.id) + '/reject', { method: 'POST' });
        }, 'Club proposal rejected.');
      });
    },
    'suspend-club': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('club', withId('/api/admin/clubs', dataset.id) + '/suspend', { method: 'POST' });
        }, 'Club suspended.');
      });
    },
    'edit-meal': function (dataset) {
      return editMeal(dataset.id);
    },
    'delete-meal': function (dataset) {
      confirmDelete('Delete meal', 'This meal will be removed from the menu.', function () {
        return api('dining', withId('/api/admin/meals', dataset.id), { method: 'DELETE' });
      });
    },
    'edit-resource': function (dataset) {
      return editResource(dataset.id);
    },
    'delete-resource': function (dataset) {
      confirmDelete('Delete resource', 'This catalogue item will be removed.', function () {
        return api('library', withId('/api/admin/resources', dataset.id), { method: 'DELETE' });
      });
    },
    'issue-refund': function (dataset, button) {
      return withButtonBusy(button, function () {
        return perform(function () {
          return api('payment', withId('/api/admin/refunds', dataset.id), { method: 'PATCH', body: { action: 'issue' } });
        }, 'Refund issued.');
      });
    },
    'download-club-report': function (dataset, button) {
      return withButtonBusy(button, function () {
        return api('communication', '/api/admin/reports/clubs')
          .then(function (csv) {
            var blob = new Blob([typeof csv === 'string' ? csv : JSON.stringify(csv, null, 2)], { type: 'text/csv;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = 'club-report.csv';
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            toast('Club report downloaded.', 'success');
          })
          .catch(notifyError);
      });
    },
  };

  /* ==========================================================================
     Forms
     ========================================================================== */

  var FORM_MESSAGES = {
    'update-profile': 'Profile updated.',
    'book-room': 'Room booked successfully.',
    'add-review': 'Review submitted.',
    'add-event': 'Event created.',
    'edit-event': 'Event updated.',
    'propose-club': 'Club proposal submitted.',
    'save-dietary': 'Dietary preferences saved.',
    'order-meal': 'Meal ordered.',
    'pay-fee': 'Payment completed.',
    'request-refund': 'Refund request submitted.',
    'broadcast-notification': 'Notification sent.',
    'create-ticket': 'Ticket submitted.',
    'respond-ticket': 'Reply sent.',
    'create-user': 'Account created.',
    'change-role': 'Role updated.',
    'change-status': 'Account status updated.',
    'create-building': 'Building added.',
    'create-room': 'Room added.',
    'edit-building': 'Building updated.',
    'edit-room': 'Room updated.',
    'room-availability': 'Availability updated.',
    'create-route': 'Route added.',
    'create-schedule': 'Schedule added.',
    'edit-route': 'Route updated.',
    'edit-schedule': 'Schedule updated.',
    'assign-leader': 'Club leader assigned.',
    'create-meal': 'Meal added.',
    'edit-meal': 'Meal updated.',
    'meal-stock': 'Stock status updated.',
    'create-resource': 'Resource added.',
    'edit-resource': 'Resource updated.',
    'process-refund': 'Refund request processed.',
    'create-announcement': 'Announcement published.',
    'update-semester': 'Semester dates updated.',
  };

  function formMealBody(data) {
    var body = {
      name: data.name,
      price: asNumber(data.price, 0),
      mealDate: data.mealDate,
    };
    if (data.category !== undefined) body.category = data.category;
    if (data.description !== undefined) body.description = data.description;
    if (data.ingredients !== undefined) body.ingredients = splitInput(data.ingredients);
    if (data.allergens !== undefined) body.allergens = splitInput(data.allergens);
    if (data.nutrition !== undefined) body.nutrition = splitInput(data.nutrition);
    return body;
  }

  function formResourceBody(data) {
    var body = {
      title: data.title,
      type: data.type,
      copiesTotal: asNumber(data.copiesTotal, 1),
    };
    ['author', 'subject', 'isbn', 'url', 'description'].forEach(function (key) {
      if (data[key] !== undefined) body[key] = data[key];
    });
    return body;
  }

  var FORMS = {
    'auth-login': function (data, form) {
      return loginWith(form, { email: data.email, password: data.password });
    },
    'auth-register': function (data, form) {
      return api('user', '/api/auth/register', { auth: false, method: 'POST', body: data })
        .then(function (payload) {
          saveSession(payload.token, payload.user);
          state.authNotice = null;
          location.hash = navHref('dashboard');
          renderRoute();
          toast('Welcome to Student Services!', 'success');
        })
        .catch(function (error) {
          formMessage(form, errorText(error), 'error');
          notifyError(error);
        });
    },
    'auth-recover': function (data, form) {
      setFormBusy(form, true, 'Sending…');
      return api('user', '/api/auth/recover', { auth: false, method: 'POST', body: { email: data.email } })
        .then(function (payload) {
          setFormBusy(form, false);
          formMessage(form, 'Recovery token issued. Use the Reset tab to choose a new password.', 'success');
          if (payload.resetToken) {
            var box = document.createElement('div');
            box.className = 'token-box';
            box.innerHTML = '<span>Token</span><code>' + esc(payload.resetToken) + '</code>';
            form.appendChild(box);
          }
        })
        .catch(function (error) {
          setFormBusy(form, false);
          formMessage(form, errorText(error), 'error');
          notifyError(error);
        });
    },
    'auth-reset': function (data, form) {
      setFormBusy(form, true, 'Resetting…');
      return api('user', '/api/auth/reset', { auth: false, method: 'POST', body: { token: data.token, password: data.password } })
        .then(function () {
          setFormBusy(form, false);
          toast('Password updated. Please sign in.', 'success');
          renderAuth('login');
        })
        .catch(function (error) {
          setFormBusy(form, false);
          formMessage(form, errorText(error), 'error');
          notifyError(error);
        });
    },
    'update-profile': function (data) {
      return api('user', '/api/users/me', { method: 'PATCH', body: { name: data.name, email: data.email } }).then(function (payload) {
        var user = payload.user;
        saveSession(state.token, Object.assign({}, state.user, user));
      });
    },
    'book-room': function (data) {
      return api('accommodation', '/api/bookings', { method: 'POST', body: { roomId: data.roomId, checkIn: data.checkIn, checkOut: data.checkOut } });
    },
    'add-review': function (data) {
      return api('accommodation', '/api/reviews', { method: 'POST', body: { roomId: data.roomId, rating: asNumber(data.rating, 5), comment: data.comment } });
    },
    'add-event': function (data) {
      return api('club', withId('/api/clubs', data.clubId) + '/events', {
        method: 'POST',
        body: { title: data.title, description: data.description, startsAt: toIso(data.startsAt), endsAt: toIso(data.endsAt) },
      });
    },
    'edit-event': function (data) {
      return api('club', withId('/api/events', data.id), {
        method: 'PATCH',
        body: { title: data.title, description: data.description, startsAt: toIso(data.startsAt), endsAt: toIso(data.endsAt) },
      });
    },
    'propose-club': function (data) {
      return api('club', '/api/clubs', {
        method: 'POST',
        body: { name: data.name, category: data.category, description: data.description },
      });
    },
    'save-dietary': function (data) {
      return api('dining', '/api/dietary', { method: 'PUT', body: { restrictions: splitInput(data.restrictions), allergies: splitInput(data.allergies) } });
    },
    'order-meal': function (data) {
      return api('dining', '/api/orders', { method: 'POST', body: { mealId: data.mealId } });
    },
    'pay-fee': function (data) {
      return api('payment', '/api/payments', {
        method: 'POST',
        body: { payableType: data.payableType, payableId: data.payableId, amount: asNumber(data.amount, 0), description: data.description },
      });
    },
    'request-refund': function (data) {
      var body = { paymentId: data.paymentId, reason: data.reason };
      if (data.amount !== '' && data.amount !== undefined) body.amount = asNumber(data.amount, 0);
      return api('payment', '/api/refunds', { method: 'POST', body: body });
    },
    'broadcast-notification': function (data, form) {
      normaliseFormData(form, data);
      var body = { title: data.title, body: data.body, type: 'ANNOUNCEMENT' };
      if (data.all && !data.recipientId) body.all = true;
      else body.recipientId = data.recipientId;
      return api('communication', '/api/admin/notifications', { method: 'POST', body: body });
    },
    'create-ticket': function (data) {
      return api('communication', '/api/tickets', { method: 'POST', body: { subject: data.subject, description: data.description } });
    },
    'respond-ticket': function (data) {
      return api('communication', withId('/api/admin/tickets', data.id) + '/respond', { method: 'POST', body: { body: data.body, status: data.status } });
    },
    'create-user': function (data) {
      var body = { name: data.name, email: data.email, password: data.password, role: data.role };
      if (data.clubId) body.clubId = data.clubId;
      return api('user', '/api/admin/users', { method: 'POST', body: body });
    },
    'change-role': function (data) {
      var body = { role: data.role };
      if (data.clubId) body.clubId = data.clubId;
      return api('user', withId('/api/admin/users', data.id) + '/role', { method: 'PATCH', body: body });
    },
    'change-status': function (data) {
      return api('user', withId('/api/admin/users', data.id) + '/status', { method: 'PATCH', body: { status: data.status } });
    },
    'create-building': function (data) {
      return api('accommodation', '/api/admin/buildings', { method: 'POST', body: data });
    },
    'create-room': function (data) {
      return api('accommodation', '/api/admin/rooms', {
        method: 'POST',
        body: { buildingId: data.buildingId, name: data.name, type: data.type, price: asNumber(data.price, 0), capacity: asNumber(data.capacity, 1), amenities: splitInput(data.amenities) },
      });
    },
    'edit-building': function (data) {
      return api('accommodation', withId('/api/admin/buildings', data.id), { method: 'PATCH', body: { name: data.name, address: data.address, description: data.description } });
    },
    'edit-room': function (data) {
      return api('accommodation', withId('/api/admin/rooms', data.id), {
        method: 'PATCH',
        body: { name: data.name, type: data.type, price: asNumber(data.price, 0), capacity: asNumber(data.capacity, 1), amenities: splitInput(data.amenities) },
      });
    },
    'room-availability': function (data) {
      return api('accommodation', withId('/api/admin/rooms', data.id) + '/availability', { method: 'PATCH', body: { status: data.status } });
    },
    'create-route': function (data) {
      return api('transport', '/api/admin/routes', {
        method: 'POST',
        body: { name: data.name, origin: data.origin, destination: data.destination, fare: asNumber(data.fare, 0), description: data.description },
      });
    },
    'create-schedule': function (data) {
      var body = { routeId: data.routeId, departureAt: toIso(data.departureAt), capacity: asNumber(data.capacity, 1), vehicle: data.vehicle };
      if (data.arrivalAt) body.arrivalAt = toIso(data.arrivalAt);
      return api('transport', '/api/admin/schedules', { method: 'POST', body: body });
    },
    'edit-route': function (data) {
      return api('transport', withId('/api/admin/routes', data.id), {
        method: 'PATCH',
        body: { name: data.name, origin: data.origin, destination: data.destination, fare: asNumber(data.fare, 0), status: data.status, description: data.description },
      });
    },
    'edit-schedule': function (data) {
      var body = { departureAt: toIso(data.departureAt), capacity: asNumber(data.capacity, 1), vehicle: data.vehicle, status: data.status };
      if (data.arrivalAt) body.arrivalAt = toIso(data.arrivalAt);
      return api('transport', withId('/api/admin/schedules', data.id), { method: 'PATCH', body: body });
    },
    'assign-leader': function (data) {
      return api('club', withId('/api/admin/clubs', data.id) + '/leader', { method: 'PATCH', body: { userId: data.userId } });
    },
    'create-meal': function (data) {
      return api('dining', '/api/admin/meals', { method: 'POST', body: formMealBody(data) });
    },
    'edit-meal': function (data) {
      return api('dining', withId('/api/admin/meals', data.id), { method: 'PATCH', body: formMealBody(data) });
    },
    'meal-stock': function (data) {
      return api('dining', withId('/api/admin/meals', data.id) + '/stock', { method: 'PATCH', body: { stockStatus: data.stockStatus } });
    },
    'create-resource': function (data) {
      return api('library', '/api/admin/resources', { method: 'POST', body: formResourceBody(data) });
    },
    'edit-resource': function (data) {
      return api('library', withId('/api/admin/resources', data.id), { method: 'PATCH', body: formResourceBody(data) });
    },
    'process-refund': function (data) {
      return api('payment', withId('/api/admin/refunds', data.id), { method: 'PATCH', body: { action: data.action } });
    },
    'create-announcement': function (data) {
      return api('communication', '/api/admin/announcements', { method: 'POST', body: { title: data.title, body: data.body } });
    },
    'update-semester': function (data) {
      return api('communication', '/api/admin/settings/semester', { method: 'PUT', body: { startDate: data.startDate, endDate: data.endDate } });
    },
  };

  function loginWith(form, body) {
    setFormBusy(form, true, 'Signing in…');
    return api('user', '/api/auth/login', { auth: false, method: 'POST', body: body })
      .then(function (payload) {
        setFormBusy(form, false);
        saveSession(payload.token, payload.user);
        state.authNotice = null;
        location.hash = navHref('dashboard');
        renderRoute();
      })
      .catch(function (error) {
        setFormBusy(form, false);
        formMessage(form, errorText(error), 'error');
        notifyError(error);
      });
  }

  function onDocumentClick(event) {
    var target = event.target.closest('[data-action]');
    if (!target) return;
    var handler = ACTIONS[target.dataset.action];
    if (!handler) return;
    event.preventDefault();
    Promise.resolve()
      .then(function () { return handler(target.dataset, target, event); })
      .catch(notifyError);
  }

  function onDocumentSubmit(event) {
    var form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    var name = form.dataset.form;

    if (name.indexOf('filter-') === 0) {
      var key = name.slice(7);
      var values = normaliseFormData(form, readForm(form));
      Object.keys(values).forEach(function (field) {
        if (values[field] === true) values[field] = 'true';
        if (values[field] === false) delete values[field];
      });
      state.filters = state.filters || {};
      state.filters[key] = values;
      refresh();
      return;
    }

    var handler = FORMS[name];
    if (!handler) return;
    var formData = normaliseFormData(form, readForm(form));
    return runForm(form, FORM_MESSAGES[name], function () { return handler(formData, form); });
  }

  /* ==========================================================================
     Boot
     ========================================================================== */

  function boot() {
    loadSession();
    if (state.token && tokenExpired(state.token)) {
      expireSession('Your session has expired. Please sign in again.');
    }
    window.addEventListener('hashchange', renderRoute);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('submit', onDocumentSubmit);
    if (!location.hash || location.hash === '#') {
      history.replaceState(null, '', navHref(state.token ? 'dashboard' : 'login'));
    }
    renderRoute();
  }

  boot();
})();
