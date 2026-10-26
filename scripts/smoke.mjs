const resources = ['users', 'buildings', 'routes', 'clubs', 'meals', 'announcements', 'resources', 'payments'];
for (const [index, resource] of resources.entries()) {
  const base = `http://127.0.0.1:${3001 + index}`;
  for (const route of ['/health', '/ready', '/dependencies', `/api/${resource}`]) {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`${base}${route}: ${response.status}`);
    const body = await response.json();
    if (route.startsWith('/api/') && (!body.sampleData || !body.items?.length)) throw new Error(`Missing sample database records: ${resource}`);
  }
  console.log(`PASS ${base}: health, database, upstream, sample records`);
}
