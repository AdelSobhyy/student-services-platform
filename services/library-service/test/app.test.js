import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withServer(pool, fn, peers = {}) {
  const server = createApp({ pool, service: 'test-service', resource: 'items', peers }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('readiness fails on a database outage while liveness stays available', async () => {
  await withServer({ query: async () => { throw new Error('private connection detail'); } }, async url => {
    assert.equal((await fetch(`${url}/health`)).status, 200);
    const response = await fetch(`${url}/ready`);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private connection detail/);
    assert.equal((await fetch(`${url}/api/items`)).status, 503);
  });
});
test('resource endpoint returns database results and marks them as sample data', async () => {
  await withServer({ query: async () => ({ rows: [{ id: 'sample', name: 'Example' }] }) }, async url => {
    assert.equal((await fetch(`${url}/ready`)).status, 200);
    const response = await fetch(`${url}/api/items`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sampleData, true);
    assert.equal(body.items[0].name, 'Example');
    assert.equal((await fetch(`${url}/unknown`)).status, 404);
  });
});
test('unavailable upstream produces 503', async () => {
  await withServer({ query: async () => ({ rows: [] }) }, async url => {
    const response = await fetch(`${url}/dependencies`);
    assert.equal(response.status, 503);
    assert.deepEqual((await response.json()).dependencies, { user: false });
  }, { user: 'http://127.0.0.1:1' });
});
