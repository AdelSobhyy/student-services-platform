/**
 * Student Services Platform - runtime configuration.
 *
 * No build step: the browser loads this file before app.js. Base URLs are
 * derived from the page hostname so the same static bundle works locally,
 * on a lab machine, or behind a reverse proxy. Each backend service listens
 * on its own port (user 3001 ... payment 3008).
 */
(function () {
  'use strict';

  var rawHost = window.location.hostname;
  var host = rawHost && rawHost !== '0.0.0.0' ? rawHost : 'localhost';
  var protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

  function serviceUrl(port) {
    return protocol + '//' + host + ':' + port;
  }

  // Optional escape hatch for unusual deployments without editing this file:
  //   window.SSP_API_OVERRIDES = { user: 'https://api.example.edu/user' };
  var overrides = window.SSP_API_OVERRIDES || {};

  window.SSP_CONFIG = {
    host: host,
    protocol: protocol,
    services: {
      user: overrides.user || serviceUrl(3001),
      accommodation: overrides.accommodation || serviceUrl(3002),
      transport: overrides.transport || serviceUrl(3003),
      club: overrides.club || serviceUrl(3004),
      dining: overrides.dining || serviceUrl(3005),
      communication: overrides.communication || serviceUrl(3006),
      library: overrides.library || serviceUrl(3007),
      payment: overrides.payment || serviceUrl(3008),
    },
  };
})();
