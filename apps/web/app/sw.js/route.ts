export const serviceWorkerScript = `
const CACHE = 'modular-field-shell-v2';
const SHELL_KEY = '/__modular_field_offline_shell__';
const IDENTITY_CACHE = 'modular-field-client-identities-v1';
const FIELD_DATA_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FIELD_RESPONSES = 24;
const CACHE_TIME_HEADER = 'x-modular-crm-cached-at';
const SHELL = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Modular CRM · Offline</title><body style="font:16px system-ui,sans-serif;margin:0;padding:2rem;background:#f4f7f3;color:#203128"><main style="max-width:32rem;margin:12vh auto;background:white;padding:2rem;border-radius:1rem"><h1>You are offline</h1><p>If the field app was already open, its assigned route and job details cached on this device can still be used there. Field updates are saved under your account until they sync.</p><p>Reconnect to load the field app again.</p><button onclick="location.reload()">Try again</button></main></body></html>';
const ownCache = key => key.startsWith('modular-field-');
const clientIdentities = new Map();
const identityIsValid = identity => Boolean(identity && /^[a-zA-Z0-9_-]{1,160}$/.test(identity.userId) && /^[a-zA-Z0-9_-]{1,160}$/.test(identity.tenantId));
const dataCacheName = identity => 'modular-field-data-v1:' + encodeURIComponent(identity.tenantId) + ':' + encodeURIComponent(identity.userId);
const identityKey = clientId => new Request(self.location.origin + '/__modular_field_client_identity__/' + encodeURIComponent(clientId));
const isAssignedFieldRead = pathname => pathname === '/api/v1/field/today' || pathname === '/api/v1/field/route' || /^\\/api\\/v1\\/field\\/jobs\\/[a-zA-Z0-9_-]+$/.test(pathname);

async function readClientIdentity(clientId) {
  if (!clientId) return null;
  const current = clientIdentities.get(clientId);
  if (current) return current;
  const cache = await caches.open(IDENTITY_CACHE);
  const stored = await cache.match(identityKey(clientId));
  if (!stored) return null;
  try {
    const identity = await stored.json();
    if (!identityIsValid(identity)) return null;
    clientIdentities.set(clientId, identity);
    return identity;
  } catch { return null; }
}

async function storeClientIdentity(clientId, identity) {
  const cache = await caches.open(IDENTITY_CACHE);
  await cache.put(identityKey(clientId), new Response(JSON.stringify(identity), { headers: { 'Content-Type': 'application/json' } }));
}

async function cachedFieldResponse(cache, request) {
  const key = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(key);
  if (!cached) return null;
  const storedAt = Number(cached.headers.get(CACHE_TIME_HEADER));
  if (!Number.isFinite(storedAt) || Date.now() - storedAt > FIELD_DATA_TTL_MS) {
    await cache.delete(key);
    return null;
  }
  const headers = new Headers(cached.headers);
  headers.delete(CACHE_TIME_HEADER);
  return new Response(await cached.arrayBuffer(), { status: cached.status, statusText: cached.statusText, headers });
}

async function trimFieldCache(cache) {
  const requests = await cache.keys();
  const stored = await Promise.all(requests.map(async request => ({ request, response: await cache.match(request) })));
  const fresh = stored.filter(item => item.response && Date.now() - Number(item.response.headers.get(CACHE_TIME_HEADER)) <= FIELD_DATA_TTL_MS)
    .sort((a, b) => Number(a.response.headers.get(CACHE_TIME_HEADER)) - Number(b.response.headers.get(CACHE_TIME_HEADER)));
  for (const item of stored) if (!item.response || !fresh.includes(item)) await cache.delete(item.request);
  for (const item of fresh.slice(0, Math.max(0, fresh.length - MAX_FIELD_RESPONSES))) await cache.delete(item.request);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.put(SHELL_KEY, new Response(SHELL, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    try {
      const icon = await fetch('/icon.svg');
      if (icon.ok && !(icon.headers.get('content-type') || '').includes('text/html')) await cache.put('/icon.svg', icon);
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => ownCache(key) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const clientId = event.source?.id;
  if (event.data?.type === 'modular-crm-identity' && clientId && identityIsValid(event.data)) {
    event.waitUntil((async () => {
      const next = { userId: event.data.userId, tenantId: event.data.tenantId };
      const prior = clientIdentities.get(clientId) || (identityIsValid(event.data.previousIdentity) ? event.data.previousIdentity : undefined);
      if (prior && (prior.userId !== next.userId || prior.tenantId !== next.tenantId)) await caches.delete(dataCacheName(prior));
      clientIdentities.set(clientId, next);
      await storeClientIdentity(clientId, next);
    })());
    return;
  }
  if (event.data?.type !== 'modular-crm-logout') return;
  if (clientId) clientIdentities.delete(clientId);
  event.waitUntil((async () => {
    if (clientId) {
      const identityCache = await caches.open(IDENTITY_CACHE);
      await identityCache.delete(identityKey(clientId));
      if (!(await identityCache.keys()).length) await caches.delete(IDENTITY_CACHE);
    }
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => ownCache(key) && key !== IDENTITY_CACHE).map(key => caches.delete(key)));
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === 'GET' && url.pathname.startsWith('/api/v1/field/') && isAssignedFieldRead(url.pathname)) {
    event.respondWith((async () => {
      const identity = await readClientIdentity(event.clientId);
      if (!identity) return fetch(request);
      const cache = await caches.open(dataCacheName(identity));
      try {
        const response = await fetch(request);
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const copy = response.clone();
          const bytes = await copy.arrayBuffer();
          if (bytes.byteLength <= 1_500_000) {
            const headers = new Headers(response.headers);
            headers.set(CACHE_TIME_HEADER, String(Date.now()));
            await cache.put(new Request(request.url, { method: 'GET' }), new Response(bytes, { status: response.status, statusText: response.statusText, headers }));
            await trimFieldCache(cache);
          }
        }
        return response;
      } catch {
        return await cachedFieldResponse(cache, request) || new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'This assigned work is not available offline on this device.' } }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  // Field pages carry personalized job/customer data. Keep HTML network-only;
  // an offline navigation receives a generic shell with no tenant data.
  if (request.mode === 'navigate' && url.pathname.startsWith('/field/')) {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match(SHELL_KEY)));
    return;
  }

  const isStatic = url.pathname === '/icon.svg' || url.pathname.startsWith('/_next/static/');
  if (!isStatic) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && response.type !== 'opaque' && !contentType.includes('text/html')) await cache.put(request, response.clone());
    return response;
  })());
});
`;

export function GET() {
  return new Response(serviceWorkerScript, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
}
