// Playbeat Digital — Cloudflare Worker
// Mirrors the Express API in server.ts with Cloudflare KV persistence.
// Static SPA is served via the ASSETS binding (see wrangler.jsonc); this worker
// handles /api/* only (run_worker_first).

import SEED from './catalog-seed.json';

const RATE = 278.5; // USD -> PKR
const TV_CATALOG_VERSION = 2;
const CATALOG_KEY = 'pb:catalog:v1';
const ORDERS_KEY = 'pb:orders:v1';

// ---------------------------------------------------------------------------
// KV-backed stores (module-level cache: the full catalog JSON is parsed once
// per isolate instead of on every request)
// ---------------------------------------------------------------------------

let stateCache = null;

function cloneSeed() {
  return JSON.parse(JSON.stringify(SEED));
}

async function loadState(env, opts) {
  const fresh = !!(opts && opts.fresh);
  if (!fresh && stateCache && Array.isArray(stateCache.digitalProducts)) return stateCache;
  try {
    const raw = await env.PLAYBEAT_KV.get(CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.digitalProducts) && parsed.digitalProducts.length > 0) {
        stateCache = parsed;
        return parsed;
      }
    }
  } catch {
    /* fall through to seed */
  }
  if (!fresh) {
    stateCache = cloneSeed();
    return stateCache;
  }
  return stateCache && Array.isArray(stateCache.digitalProducts) ? stateCache : cloneSeed();
}

async function saveState(env, state) {
  stateCache = state;
  await env.PLAYBEAT_KV.put(CATALOG_KEY, JSON.stringify(state));
}

async function loadOrdersData(env) {
  try {
    const raw = await env.PLAYBEAT_KV.get(ORDERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.orders)) {
        return { orders: parsed.orders, webhookLogs: Array.isArray(parsed.webhookLogs) ? parsed.webhookLogs : [] };
      }
    }
  } catch {
    /* fall through */
  }
  return { orders: [], webhookLogs: [] };
}

async function saveOrdersData(env, data) {
  await env.PLAYBEAT_KV.put(ORDERS_KEY, JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Catalog helpers (mirror server/catalogStore.ts)
// ---------------------------------------------------------------------------

function buyerProducts(state) {
  return state.digitalProducts
    .filter((p) => p.published !== false && p.supplierVerified === true)
    .map((p) => ({
      sku: p.publicCode || `PB-DIG-${String(p.sku).replace(/[^a-z0-9]/gi, '').slice(-8)}`,
      publicCode: p.publicCode,
      name: p.name,
      category: p.category,
      platform: p.platform,
      region: p.region,
      originalPriceUsd: p.originalPriceUsd,
      priceUsd: p.priceUsd,
      pricePkr: p.pricePkr,
      discountPercent: p.discountPercent,
      stockCount: p.stockCount,
      stockStatus: p.stockStatus,
      deliveryType: p.deliveryType,
      productUrl: '',
      imageUrl: p.imageUrl,
      description: p.description,
      activationGuide: p.activationGuide,
      featured: p.featured,
      published: p.published,
    }));
}

function resolvePurchasableItem(state, sku) {
  const prod = state.digitalProducts.find((p) => p.sku === sku || p.publicCode === sku);
  if (prod) {
    return {
      sku: prod.sku,
      name: prod.name,
      platform: prod.platform,
      unitPriceUsd: prod.priceUsd,
      unitPricePkr: prod.pricePkr,
      section: 'section1-digital',
    };
  }
  const svc = state.businessServices.find((s) => s.sku === sku);
  if (svc) {
    return {
      sku: svc.sku,
      name: svc.name,
      platform: 'Business Service',
      unitPriceUsd: svc.optionalUsd,
      unitPricePkr: svc.recommendedPkr,
      section: 'section2-services',
    };
  }
  const tvPlan = state.liveTvPlans.find((t) => t.sku === sku);
  if (tvPlan) {
    return {
      sku: tvPlan.sku,
      name: tvPlan.name,
      platform: 'Playbeat TV',
      unitPriceUsd: tvPlan.priceUsd,
      unitPricePkr: tvPlan.pricePkr,
      section: 'section3-livetv',
    };
  }
  return null;
}

function computeAuthoritativeCart(state, cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error('Shopping bag is empty.');
  }
  const items = cartItems.map((entry) => {
    const resolved = resolvePurchasableItem(state, String(entry?.sku || ''));
    if (!resolved) throw new Error(`Unknown product SKU: ${entry?.sku}`);
    const quantity = Math.max(1, Math.min(20, Math.floor(Number(entry?.quantity) || 1)));
    return {
      sku: resolved.sku,
      name: resolved.name,
      platform: resolved.platform,
      quantity,
      unitPriceUsd: resolved.unitPriceUsd,
      unitPricePkr: resolved.unitPricePkr,
    };
  });
  const totalUsd = Number(items.reduce((sum, i) => sum + i.unitPriceUsd * i.quantity, 0).toFixed(2));
  const totalPkr = Math.round(items.reduce((sum, i) => sum + i.unitPricePkr * i.quantity, 0));
  return { items, totalUsd, totalPkr };
}

function tvDefaultImage(category) {
  switch (category) {
    case 'Sports':
      return '/assets/playbeat/tv/sports.jpg';
    case 'Movies':
      return '/assets/playbeat/tv/cinema.jpg';
    case 'Documentary':
      return '/assets/playbeat/tv/space.jpg';
    case 'Kids':
      return '/assets/playbeat/tv/kids.jpg';
    case 'Entertainment':
      return '/assets/playbeat/tv/entertainment.jpg';
    case 'Regional & World':
      return '/assets/playbeat/tv/regional.jpg';
    default:
      return '/assets/playbeat/tv/news.jpg';
  }
}

function lastSyncStatus(state) {
  const live = state && Array.isArray(state.digitalProducts) ? state.digitalProducts : SEED.digitalProducts || [];
  return {
    syncedAt: (state && state.lastPublishedSyncAt) || SEED.lastPublishedSyncAt,
    source: state && Array.isArray(state.digitalProducts) && state.digitalProducts.length > 0 ? 'published_catalog' : 'catalog_snapshot',
    apiConfigured: false,
    httpStatus: null,
    message:
      'Serving the verified ElectronicFirst worldwide catalog snapshot published to Section 1. Configure an ElectronicFirst Partner API key to enable live re-extraction.',
    productCount: live.filter((p) => p.published !== false && p.supplierVerified === true).length,
    balanceInfo: null,
  };
}

function storeConfig() {
  return {
    storeName: 'Playbeat Digital',
    pkrPerUsd: RATE,
    defaultRail: 'manual',
    paypal: { enabled: false, clientId: '', environment: 'sandbox' },
    rapid: {
      enabled: false,
      merchantId: '1367',
      environment: 'TEST',
      sdkUrl: 'https://secure.rapid-gateway.com/sdk/v1/rapidpay.js',
    },
    electronicFirst: { configured: false },
  };
}

function readiness() {
  return {
    usdToPkrRate: RATE,
    electronicFirst: {
      configured: false,
      baseUrl: 'https://www.electronicfirst.com/partners/api/v1',
      endpoints: ['GET /partners/api/v1/products', 'GET /partners/api/v1/balance', 'POST /partners/api/v1/orders'],
    },
    paypal: { configured: false, environment: 'sandbox', baseUrl: 'https://api-m.sandbox.paypal.com' },
    rapidGateway: {
      configured: false,
      merchantId: '1367',
      environment: 'TEST',
      baseUrl: 'https://secure.rapid-gateway.com',
      signingSaltConfigured: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Fulfillment (mirror server/paymentService.ts fulfillOrderKeys)
// ---------------------------------------------------------------------------

function fulfillOrderKeys(order) {
  if (order.issuedKeys && order.issuedKeys.length > 0 && order.status === 'PAID_FULFILLED') {
    return order;
  }
  const issuedKeys = [];
  for (const item of order.items || []) {
    if (item.platform === 'Business Service') {
      for (let i = 0; i < item.quantity; i++) {
        const ref = Math.random().toString(36).substring(2, 8).toUpperCase();
        issuedKeys.push({
          sku: item.sku,
          productName: item.name,
          platform: item.platform,
          keyCode: `PB-PROJECT-ONBOARD-${ref}`,
          source: 'Playbeat Fulfillment',
        });
      }
      continue;
    }
    if (item.platform === 'Playbeat TV') {
      for (let i = 0; i < item.quantity; i++) {
        const digits = () => String(Math.floor(1000 + Math.random() * 9000));
        const code =
          String(item.sku).includes('XTREAM')
            ? `XTREAM: playbeat.live | U:pb_${digits()} | P:tv_${digits()}`
            : `ACTIVECODE: ${digits()}-${digits()}-${digits()}-${digits()}`;
        issuedKeys.push({
          sku: item.sku,
          productName: item.name,
          platform: item.platform,
          keyCode: code,
          source: 'Playbeat Fulfillment',
        });
      }
      continue;
    }
    for (let i = 0; i < item.quantity; i++) {
      const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
      issuedKeys.push({
        sku: item.sku,
        productName: item.name,
        platform: item.platform,
        keyCode: `PB-${seg()}-${seg()}-${seg()}`,
        source: 'Playbeat Digital Inventory',
      });
    }
  }
  return {
    ...order,
    status: 'PAID_FULFILLED',
    statusDetail: 'Payment verified and Playbeat digital delivery issued.',
    issuedKeys,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// HLS stream proxy (mirror server.ts /api/livetv/hls-proxy)
// ---------------------------------------------------------------------------

function blockedHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('169.254.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.')
  );
}

async function handleHlsProxy(request) {
  const url = new URL(request.url);
  const rawUrl = String(url.searchParams.get('url') || '').trim();
  if (!rawUrl || (!rawUrl.startsWith('https://') && !rawUrl.startsWith('http://'))) {
    return json({ error: 'Valid stream URL is required.' }, 400);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return json({ error: 'Malformed stream URL.' }, 400);
  }
  if (blockedHost(parsedUrl.hostname)) {
    return json({ error: 'Blocked host.' }, 403);
  }
  let upstream;
  try {
    upstream = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: '*/*',
      },
      redirect: 'follow',
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unable to connect to live stream.' }, 502);
  }
  if (!upstream.ok) {
    return new Response(`Upstream stream returned HTTP ${upstream.status}`, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const contentType = upstream.headers.get('content-type') || '';
  const finalUrl = upstream.url || parsedUrl.toString();
  const isPlaylist =
    finalUrl.toLowerCase().includes('.m3u8') ||
    contentType.toLowerCase().includes('mpegurl') ||
    contentType.toLowerCase().includes('x-mpegurl');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };

  if (isPlaylist) {
    const text = await upstream.text();
    const rewritten = text
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/gi, (_m, uri) => {
            try {
              const abs = new URL(uri, finalUrl).toString();
              return `URI="/api/livetv/hls-proxy?url=${encodeURIComponent(abs)}"`;
            } catch {
              return `URI="${uri}"`;
            }
          });
        }
        try {
          const abs = new URL(trimmed, finalUrl).toString();
          return `/api/livetv/hls-proxy?url=${encodeURIComponent(abs)}`;
        } catch {
          return line;
        }
      })
      .join('\n');
    return new Response(rewritten, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8' },
    });
  }

  headers['Content-Type'] = contentType || 'video/mp2t';
  return new Response(upstream.body, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// Router plumbing
// ---------------------------------------------------------------------------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function notConfigured(message) {
  return json({ ok: false, error: message }, 502);
}

// ---------------------------------------------------------------------------
// Admin password gate — /admin is password protected
// A login endpoint issues a signed, stateless token (HMAC-SHA256) with a 12h
// expiry. Every admin route requires `Authorization: Bearer <token>`.
// ---------------------------------------------------------------------------

const FALLBACK_ADMIN_PASSWORD = 'Playbeat@Admin2026';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function adminPassword(env) {
  return String(env.ADMIN_PASSWORD || FALLBACK_ADMIN_PASSWORD);
}

function adminSessionSecret(env) {
  return `${adminPassword(env)}::playbeat-admin-session-v1`;
}

async function hmacHex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signAdminToken(env, expiresAtMs) {
  const sig = await hmacHex(`admin:${expiresAtMs}`, adminSessionSecret(env));
  return `${expiresAtMs}.${sig}`;
}

async function verifyAdminToken(env, token) {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(`admin:${exp}`, adminSessionSecret(env));
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// Lightweight in-memory brute-force throttle (per isolate). KV-backed lock
// would be stricter; this blocks simple scripted guessing bursts.
const loginAttempts = new Map();
function loginThrottle(ip, isSuccess) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { fails: 0, lockUntil: 0 };
  if (isSuccess) {
    loginAttempts.delete(ip);
    return { allowed: true, retryAfterSec: 0 };
  }
  if (rec.lockUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.lockUntil - now) / 1000) };
  }
  loginAttempts.set(ip, { fails: rec.fails + 1, lockUntil: 0 });
  const updated = loginAttempts.get(ip);
  if (updated.fails >= 5) {
    updated.lockUntil = now + 5 * 60 * 1000;
    loginAttempts.set(ip, updated);
    return { allowed: false, retryAfterSec: 300 };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function isAdminProtectedPath(path, method) {
  if (path === '/api/admin/login' && method === 'POST') return false;
  if (path.startsWith('/api/admin/')) return true;
  if (path === '/api/orders' && method === 'GET') return true; // full order ledger
  if (path.startsWith('/api/orders/') && path.endsWith('/approve-manual') && method === 'POST') return true;
  if (path.startsWith('/api/orders/') && method === 'DELETE') return true;
  if (path === '/api/integrations/readiness' && method === 'GET') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (!path.startsWith('/api/')) {
      // Serve static assets for anything that is not an API call.
      // SPA fallback (not_found_handling) makes /admin resolve to the app shell.
      return env.ASSETS.fetch(request);
    }

    // ---- Admin password gate ----
    if (isAdminProtectedPath(path, method)) {
      const token = bearerToken(request);
      const valid = await verifyAdminToken(env, token);
      if (!valid) {
        return json(
          { ok: false, error: 'Admin sign-in required.', code: 'ADMIN_AUTH_REQUIRED' },
          401,
        );
      }
    }

    try {
      // ---- Admin login ----
      if (path === '/api/admin/login' && method === 'POST') {
        const body = await readBody(request);
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const throttle = loginThrottle(ip, false);
        if (!throttle.allowed) {
          return json(
            {
              ok: false,
              error: `Too many failed attempts. Try again in ${throttle.retryAfterSec}s.`,
              code: 'ADMIN_THROTTLED',
            },
            429,
          );
        }
        const password = String(body.password || '');
        if (!password || password !== adminPassword(env)) {
          return json({ ok: false, error: 'Incorrect admin password.', code: 'ADMIN_BAD_PASSWORD' }, 401);
        }
        loginThrottle(ip, true);
        const expiresAtMs = Date.now() + ADMIN_SESSION_TTL_MS;
        const token = await signAdminToken(env, expiresAtMs);
        return json({ ok: true, token, expiresAt: new Date(expiresAtMs).toISOString() });
      }

      // ---- Health & config ----
      if (path === '/api/health' && method === 'GET') {
        return json({ ok: true, store: 'Playbeat Digital', timestamp: new Date().toISOString() });
      }
      if (path === '/api/config' && method === 'GET') {
        return json(storeConfig());
      }

      // ---- Storefront ----
      // Light response for instant first paint: services/channels/plans in full,
      // first 120 digital products as preview. The complete product list is a
      // static CDN file (/data/storefront-index.json) that the SPA hydrates.
      if (path === '/api/storefront/catalog' && method === 'GET') {
        const state = await loadState(env);
        const buyer = buyerProducts(state);
        const categoryCounts = {};
        for (const b of buyer) categoryCounts[b.category] = (categoryCounts[b.category] || 0) + 1;
        return json({
          section1DigitalProducts: buyer.slice(0, 120).map((b) => ({
            ...b,
            description: String(b.description || '').slice(0, 160),
          })),
          section1Total: buyer.length,
          section1IndexUrl: '/data/storefront-index.json',
          section1CategoryCounts: categoryCounts,
          section2BusinessServices: (state.businessServices || []).filter((s) => s.published !== false),
          section3LiveTvChannels: (state.liveTvChannels || []).filter((c) => c.published !== false),
          section3LiveTvPlans: (state.liveTvPlans || []).filter((p) => p.published !== false),
          lastPublishedSyncAt: state.lastPublishedSyncAt,
        });
      }
      if (path === '/api/livetv/hls-proxy' && method === 'GET') {
        return handleHlsProxy(request);
      }

      // ---- Service inquiries ----
      if (path === '/api/services/inquiries' && method === 'POST') {
        const body = await readBody(request);
        const { serviceId, serviceName, customerName, customerEmail, customerPhone, companyName, notes } = body;
        if (!customerName || !customerEmail || !String(customerEmail).includes('@')) {
          return json({ error: 'Name and a valid email address are required.' }, 400);
        }
        const state = await loadState(env);
        const inquiry = {
          serviceId: String(serviceId || 'custom'),
          serviceName: String(serviceName || 'Playbeat Business Service'),
          customerName: String(customerName).trim(),
          customerEmail: String(customerEmail).trim(),
          customerPhone: String(customerPhone || '').trim(),
          companyName: String(companyName || '').trim(),
          notes: String(notes || '').trim(),
          id: `INQ-${Date.now().toString().slice(-6)}`,
          status: 'NEW',
          createdAt: new Date().toISOString(),
        };
        state.serviceInquiries = Array.isArray(state.serviceInquiries) ? state.serviceInquiries : [];
        state.serviceInquiries.unshift(inquiry);
        await saveState(env, state);
        return json({ inquiry }, 201);
      }

      // ---- Admin catalog ----
      if (path === '/api/admin/catalog' && method === 'GET') {
        // Admin console must see current CRM leads / catalog: bypass the
        // per-isolate cache and read KV fresh (buyer endpoints keep the cache).
        const state = await loadState(env, { fresh: true });
        return json({
          digitalProducts: state.digitalProducts || [],
          businessServices: state.businessServices || [],
          liveTvChannels: state.liveTvChannels || [],
          liveTvPlans: state.liveTvPlans || [],
          serviceInquiries: state.serviceInquiries || [],
          lastPublishedSyncAt: state.lastPublishedSyncAt,
          sync: lastSyncStatus(state),
        });
      }

      if ((path === '/api/admin/electronicfirst/sync' || path === '/api/electronicfirst/sync') && method === 'POST') {
        const state = await loadState(env);
        const sync = lastSyncStatus(state);
        sync.syncedAt = new Date().toISOString();
        return json({
          products: state.digitalProducts || [],
          sync: { ...sync, message: `${sync.message} Existing verified catalogue was preserved.` },
        });
      }

      // ---- Admin: digital products ----
      if (path === '/api/admin/products' && method === 'POST') {
        const body = await readBody(request);
        if (!body.name) return json({ error: 'Product name is required.' }, 400);
        const priceUsd = Number(body.priceUsd || 9.99);
        const originalPriceUsd = Number(body.originalPriceUsd || priceUsd);
        const discountPercent =
          originalPriceUsd > priceUsd ? Math.round(((originalPriceUsd - priceUsd) / originalPriceUsd) * 100) : 0;
        const stockCount = Number(body.stockCount ?? 50);
        const saved = {
          sku: String(body.sku || `PB-AFF-${Date.now().toString().slice(-6)}`),
          publicCode: body.publicCode ? String(body.publicCode) : undefined,
          name: String(body.name).trim(),
          category: body.category || 'PC Games',
          platform: body.platform || 'PC',
          region: 'Worldwide',
          originalPriceUsd: Number(originalPriceUsd.toFixed(2)),
          priceUsd: Number(priceUsd.toFixed(2)),
          pricePkr: Math.round(priceUsd * RATE),
          discountPercent,
          stockCount,
          stockStatus: stockCount > 25 ? 'In Stock' : stockCount > 0 ? 'Low Stock' : 'Out of Stock',
          deliveryType: 'Instant Digital Key',
          productUrl: String(body.productUrl || ''),
          imageUrl: String(body.imageUrl || '/src/assets/images/cat_pc_keys_1795024331948.jpg'),
          description: String(body.description || 'Genuine Playbeat Digital Worldwide key with instant delivery.'),
          activationGuide: String(body.activationGuide || 'Redeem your Worldwide code directly on the official platform.'),
          featured: Boolean(body.featured),
          published: body.published !== false,
          affiliatePartner: body.affiliatePartner !== false,
        };
        const state = await loadState(env);
        state.digitalProducts = Array.isArray(state.digitalProducts) ? state.digitalProducts : [];
        const idx = state.digitalProducts.findIndex((p) => p.sku === saved.sku);
        if (idx >= 0) {
          state.digitalProducts[idx] = { ...state.digitalProducts[idx], ...saved };
        } else {
          state.digitalProducts.unshift({
            ...saved,
            publicCode: saved.publicCode || `PB-DIG-${Date.now().toString().slice(-4)}`,
            published: saved.published !== false,
            affiliatePartner: saved.affiliatePartner ?? true,
          });
        }
        await saveState(env, state);
        return json({ product: idx >= 0 ? state.digitalProducts[idx] : state.digitalProducts[0] }, 201);
      }

      // ---- Admin: business services ----
      if (path === '/api/admin/services' && method === 'POST') {
        const body = await readBody(request);
        if (!body.name) return json({ error: 'Service name is required.' }, 400);
        const recommendedPkr = Math.round(Number(body.recommendedPkr || 149000));
        const optionalUsd = Math.round(Number(body.optionalUsd || recommendedPkr / RATE));
        const saved = {
          id: String(body.id || `svc-${Date.now().toString().slice(-6)}`),
          sku: String(body.sku || `PB-SVC-${Date.now().toString().slice(-5)}`),
          category: body.category || 'Business Websites',
          name: String(body.name).trim(),
          shortDescription: String(body.shortDescription || 'Custom enterprise delivery by Playbeat Digital Services.'),
          recommendedPkr,
          optionalUsd,
          isStartingFrom: Boolean(body.isStartingFrom),
          packageLevel: body.packageLevel || 'Professional',
          deliveryTime: String(body.deliveryTime || '2–3 Weeks'),
          deliverables: Array.isArray(body.deliverables)
            ? body.deliverables.map(String).filter(Boolean)
            : String(body.deliverables || '')
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
          featured: Boolean(body.featured),
          published: body.published !== false,
          quantifiedOutcome: body.quantifiedOutcome ? String(body.quantifiedOutcome) : undefined,
        };
        const state = await loadState(env);
        state.businessServices = Array.isArray(state.businessServices) ? state.businessServices : [];
        const idx = state.businessServices.findIndex((s) => s.id === saved.id || s.sku === saved.sku);
        if (idx >= 0) {
          state.businessServices[idx] = { ...state.businessServices[idx], ...saved };
        } else {
          state.businessServices.unshift(saved);
        }
        await saveState(env, state);
        return json({ service: idx >= 0 ? state.businessServices[idx] : state.businessServices[0] }, 201);
      }

      // ---- Admin: live TV channels ----
      if (path === '/api/admin/livetv/channels' && method === 'POST') {
        const body = await readBody(request);
        if (!body.name) return json({ error: 'Channel name is required.' }, 400);
        const chId = String(body.id || `tv-${Date.now().toString().slice(-6)}`);
        const category = body.category || 'News';
        const saved = {
          id: chId,
          name: String(body.name).trim(),
          category,
          country: String(body.country || 'Worldwide'),
          language: String(body.language || 'English'),
          quality: body.quality || '1080p HD',
          streamType: body.streamType || 'Playbeat Fast',
          streamUrl: String(body.streamUrl || `internal://playbeat-stream/${chId}`),
          imageUrl: String(body.imageUrl || tvDefaultImage(category)),
          nowPlaying: String(body.nowPlaying || `${String(body.name).trim()} — Live Broadcast`),
          upNext: String(body.upNext || 'Playbeat Prime Showcase'),
          tagline: String(body.tagline || '24/7 live broadcast channel on Playbeat TV.'),
          isLive: body.isLive !== false,
          published: body.published !== false,
        };
        const state = await loadState(env);
        state.liveTvChannels = Array.isArray(state.liveTvChannels) ? state.liveTvChannels : [];
        const idx = state.liveTvChannels.findIndex((c) => c.id === saved.id);
        if (idx >= 0) {
          state.liveTvChannels[idx] = { ...state.liveTvChannels[idx], ...saved };
        } else {
          state.liveTvChannels.unshift(saved);
        }
        await saveState(env, state);
        return json({ channel: idx >= 0 ? state.liveTvChannels[idx] : state.liveTvChannels[0] }, 201);
      }

      // ---- Admin: live TV plans ----
      if (path === '/api/admin/livetv/plans' && method === 'POST') {
        const body = await readBody(request);
        if (!body.name) return json({ error: 'Plan name is required.' }, 400);
        const priceUsd = Number(body.priceUsd || 9.99);
        const saved = {
          id: String(body.id || `pbtv-${Date.now().toString().slice(-6)}`),
          sku: String(body.sku || `PB-TV-${Date.now().toString().slice(-5)}`),
          name: String(body.name).trim(),
          lineType: body.lineType || 'Xtream Line',
          durationLabel: String(body.durationLabel || '30 Days'),
          originalPriceUsd: Number(body.originalPriceUsd || priceUsd * 1.5),
          priceUsd: Number(priceUsd.toFixed(2)),
          pricePkr: Math.round(priceUsd * RATE),
          channelsCount: String(body.channelsCount || '12,000+ Live Channels'),
          vodLibrary: String(body.vodLibrary || '45,000+ VOD Titles'),
          connections: Number(body.connections || 1),
          features: Array.isArray(body.features)
            ? body.features.map(String).filter(Boolean)
            : String(body.features || '')
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
          featured: Boolean(body.featured),
          published: body.published !== false,
        };
        const state = await loadState(env);
        state.liveTvPlans = Array.isArray(state.liveTvPlans) ? state.liveTvPlans : [];
        const idx = state.liveTvPlans.findIndex((p) => p.id === saved.id || p.sku === saved.sku);
        if (idx >= 0) {
          state.liveTvPlans[idx] = { ...state.liveTvPlans[idx], ...saved };
        } else {
          state.liveTvPlans.unshift(saved);
        }
        await saveState(env, state);
        return json({ plan: idx >= 0 ? state.liveTvPlans[idx] : state.liveTvPlans[0] }, 201);
      }

      // ---- Admin: inquiry status ----
      if (path.startsWith('/api/admin/inquiries/') && method === 'PATCH') {
        const id = decodeURIComponent(path.split('/').pop() || '');
        const body = await readBody(request);
        const state = await loadState(env);
        state.serviceInquiries = Array.isArray(state.serviceInquiries) ? state.serviceInquiries : [];
        const idx = state.serviceInquiries.findIndex((x) => x.id === id);
        if (idx < 0) return json({ error: 'Inquiry not found.' }, 404);
        state.serviceInquiries[idx] = { ...state.serviceInquiries[idx], status: body.status || 'CONTACTED' };
        await saveState(env, state);
        return json({ inquiry: state.serviceInquiries[idx] });
      }

      // ---- Admin: delete digital product ----
      if (path.startsWith('/api/admin/products/') && method === 'DELETE') {
        const sku = decodeURIComponent(path.slice('/api/admin/products/'.length));
        const state = await loadState(env);
        const before = state.digitalProducts.length;
        state.digitalProducts = state.digitalProducts.filter((p) => p.sku !== sku && p.publicCode !== sku);
        if (state.digitalProducts.length === before) return json({ error: `Product ${sku} not found.` }, 404);
        await saveState(env, state);
        return json({ ok: true, removedSku: sku, remaining: state.digitalProducts.length });
      }

      // ---- Admin: delete business service ----
      if (path.startsWith('/api/admin/services/') && method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/api/admin/services/'.length));
        const state = await loadState(env);
        const before = state.businessServices.length;
        state.businessServices = state.businessServices.filter((s) => s.id !== id && s.sku !== id);
        if (state.businessServices.length === before) return json({ error: `Service ${id} not found.` }, 404);
        await saveState(env, state);
        return json({ ok: true, removedId: id, remaining: state.businessServices.length });
      }

      // ---- Admin: delete live TV channel ----
      if (path.startsWith('/api/admin/livetv/channels/') && method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/api/admin/livetv/channels/'.length));
        const state = await loadState(env);
        const before = state.liveTvChannels.length;
        state.liveTvChannels = state.liveTvChannels.filter((c) => c.id !== id);
        if (state.liveTvChannels.length === before) return json({ error: `Channel ${id} not found.` }, 404);
        await saveState(env, state);
        return json({ ok: true, removedId: id, remaining: state.liveTvChannels.length });
      }

      // ---- Admin: delete live TV plan ----
      if (path.startsWith('/api/admin/livetv/plans/') && method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/api/admin/livetv/plans/'.length));
        const state = await loadState(env);
        const before = state.liveTvPlans.length;
        state.liveTvPlans = state.liveTvPlans.filter((p) => p.id !== id && p.sku !== id);
        if (state.liveTvPlans.length === before) return json({ error: `Plan ${id} not found.` }, 404);
        await saveState(env, state);
        return json({ ok: true, removedId: id, remaining: state.liveTvPlans.length });
      }

      // ---- Diagnostics & orders ----
      if (path === '/api/integrations/readiness' && method === 'GET') {
        const diagState = await loadState(env);
        return json({ readiness: readiness(), syncStatus: lastSyncStatus(diagState), webhookLogs: [] });
      }
      if (path === '/api/orders' && method === 'GET') {
        const data = await loadOrdersData(env);
        const orders = [...data.orders].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return json({ orders });
      }

      // ---- Manual payments (storefront default rail) ----
      if (path === '/api/orders/manual' && method === 'POST') {
        const body = await readBody(request);
        const { items, customerEmail, customerMobile, customerUid, manualChannel, manualReference, manualSenderAccount, currency } =
          body;
        if (!customerEmail || !String(customerEmail).includes('@')) {
          return json({ error: 'Valid customer email is required for delivery.' }, 400);
        }
        const state = await loadState(env);
        let cart;
        try {
          cart = computeAuthoritativeCart(state, items);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : 'Failed to create manual order.' }, 400);
        }
        const now = new Date().toISOString();
        const orderId = `PB-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
        const order = {
          orderId,
          createdAt: now,
          updatedAt: now,
          customerEmail: String(customerEmail).trim(),
          customerMobile: String(customerMobile || '').trim(),
          customerUid: String(customerUid || '').trim(),
          paymentRail: 'manual',
          manualChannel: manualChannel || 'Bank Transfer (IBAN)',
          manualReference: String(manualReference || '').trim() || `MAN-${orderId}`,
          manualSenderAccount: String(manualSenderAccount || '').trim() || 'Customer Wallet',
          currency: currency === 'PKR' ? 'PKR' : 'USD',
          totalUsd: cart.totalUsd,
          totalPkr: cart.totalPkr,
          status: 'PENDING_VERIFICATION',
          statusDetail: `Awaiting merchant verification for ${manualChannel || 'Bank Transfer (IBAN)'} transfer (${String(manualReference || '').trim() || 'pending ref'}).`,
          items: cart.items,
          issuedKeys: [],
        };
        const data = await loadOrdersData(env);
        data.orders.unshift(order);
        await saveOrdersData(env, data);
        return json({ order }, 201);
      }

      if (path.startsWith('/api/orders/') && path.endsWith('/approve-manual') && method === 'POST') {
        const orderId = decodeURIComponent(path.slice('/api/orders/'.length).replace(/\/approve-manual$/, ''));
        const data = await loadOrdersData(env);
        const idx = data.orders.findIndex((o) => o.orderId === orderId);
        if (idx < 0) return json({ error: `Order ${orderId} not found.` }, 400);
        data.orders[idx] = fulfillOrderKeys(data.orders[idx]);
        await saveOrdersData(env, data);
        return json({ order: data.orders[idx] });
      }

      // ---- Admin: remove order record ----
      if (path.startsWith('/api/orders/') && method === 'DELETE') {
        const orderId = decodeURIComponent(path.slice('/api/orders/'.length));
        const data = await loadOrdersData(env);
        const before = data.orders.length;
        data.orders = data.orders.filter((o) => o.orderId !== orderId);
        if (data.orders.length === before) return json({ error: `Order ${orderId} not found.` }, 404);
        await saveOrdersData(env, data);
        return json({ ok: true, removedOrderId: orderId, remaining: data.orders.length });
      }

      // ---- Payment gateways (secrets not configured on this deployment) ----
      if (path.startsWith('/api/paypal/')) {
        return notConfigured('PayPal client credentials are not configured on this deployment. Use the Manual payment rail or add PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET secrets.');
      }
      if (path.startsWith('/api/rapid/')) {
        return notConfigured('Rapid Gateway credentials are not configured on this deployment. Use the Manual payment rail or add RAPID_MERCHANT_ID/RAPID_CLIENT_ID/RAPID_CLIENT_SECRET secrets.');
      }
      if (path.startsWith('/api/webhooks/')) {
        return json({ ok: false, error: 'Webhook signing salt is not configured on this deployment.' }, 401);
      }

      return json({ error: 'Not found.' }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'Internal error.' }, 500);
    }
  },
};
