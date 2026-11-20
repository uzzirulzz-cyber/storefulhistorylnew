import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  addServiceInquiry,
  deleteBusinessService,
  deleteDigitalProduct,
  deleteLiveTvChannel,
  deleteLiveTvPlan,
  getAdminDigitalProducts,
  getBuyerDigitalProducts,
  getCatalogState,
  replaceSyncedDigitalProducts,
  updateServiceInquiryStatus,
  upsertBusinessService,
  upsertDigitalProduct,
  upsertLiveTvChannel,
  upsertLiveTvPlan,
} from './server/catalogStore.ts';
import { getLastSyncStatus, syncElectronicFirstCatalog } from './server/electronicFirstService.ts';
import { listOrders, listWebhookLogs } from './server/ordersStore.ts';
import {
  approveManualOrder,
  capturePayPalCheckoutOrder,
  createManualOrder,
  createPayPalCheckoutOrder,
  createRapidCheckoutSession,
  getIntegrationReadiness,
  getPayPalAccessToken,
  getPublicStoreConfig,
  getRapidAccessToken,
  processRapidWebhook,
  signRapidWebhookPayload,
  verifyRapidCheckoutSession,
} from './server/paymentService.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Preserve rawBody for HMAC-SHA256 webhook signature verification
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    }),
  );

  // -------------------------------------------------------------------------
  // Admin password gate — same token scheme as the Cloudflare Worker
  // -------------------------------------------------------------------------
  const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
  const FALLBACK_ADMIN_PASSWORD = 'Playbeat@Admin2026';
  const adminSessionSecret = () =>
    `${String(process.env.ADMIN_PASSWORD || FALLBACK_ADMIN_PASSWORD)}::playbeat-admin-session-v1`;

  function signAdminToken(expiresAtMs: number): string {
    const sig = crypto.createHmac('sha256', adminSessionSecret()).update(`admin:${expiresAtMs}`).digest('hex');
    return `${expiresAtMs}.${sig}`;
  }

  function verifyAdminToken(token: string | undefined): boolean {
    if (!token) return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    const exp = Number(token.slice(0, dot));
    const sig = token.slice(dot + 1);
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    const expected = crypto.createHmac('sha256', adminSessionSecret()).update(`admin:${exp}`).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return false;
    }
  }

  const loginAttempts = new Map<string, { fails: number; lockUntil: number }>();
  app.post('/api/admin/login', (req, res) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = loginAttempts.get(ip) || { fails: 0, lockUntil: 0 };
    if (rec.lockUntil > now) {
      res.status(429).json({
        ok: false,
        error: `Too many failed attempts. Try again in ${Math.ceil((rec.lockUntil - now) / 1000)}s.`,
        code: 'ADMIN_THROTTLED',
      });
      return;
    }
    const password = String(req.body?.password || '');
    if (!password || password !== String(process.env.ADMIN_PASSWORD || FALLBACK_ADMIN_PASSWORD)) {
      const updated = { fails: rec.fails + 1, lockUntil: rec.fails + 1 >= 5 ? now + 5 * 60 * 1000 : 0 };
      loginAttempts.set(ip, updated);
      res.status(401).json({ ok: false, error: 'Incorrect admin password.', code: 'ADMIN_BAD_PASSWORD' });
      return;
    }
    loginAttempts.delete(ip);
    const expiresAtMs = Date.now() + ADMIN_SESSION_TTL_MS;
    res.json({ ok: true, token: signAdminToken(expiresAtMs), expiresAt: new Date(expiresAtMs).toISOString() });
  });

  // Path-aware guard: only admin surfaces require the bearer token. Public
  // checkout/storefront endpoints pass straight through.
  app.use((req, res, next) => {
    const path = req.path.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();
    const protectedRoute =
      (path.startsWith('/api/admin/') && !(path === '/api/admin/login' && method === 'POST')) ||
      (path === '/api/orders' && method === 'GET') ||
      (path.startsWith('/api/orders/') && path.endsWith('/approve-manual') && method === 'POST') ||
      (path.startsWith('/api/orders/') && method === 'DELETE') ||
      (path === '/api/integrations/readiness' && method === 'GET');
    if (!protectedRoute) return next();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!verifyAdminToken(token)) {
      res.status(401).json({ ok: false, error: 'Admin sign-in required.', code: 'ADMIN_AUTH_REQUIRED' });
      return;
    }
    next();
  });

  // -------------------------------------------------------------------------
  // Public Storefront APIs (Sanitized — Zero Confidential Supplier Details)
  // -------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, store: 'Playbeat Digital', timestamp: new Date().toISOString() });
  });

  app.get('/api/config', (_req, res) => {
    res.json(getPublicStoreConfig());
  });

  app.get('/api/storefront/catalog', (_req, res) => {
    const state = getCatalogState();
    res.json({
      section1DigitalProducts: getBuyerDigitalProducts(),
      section2BusinessServices: state.businessServices.filter((s) => s.published !== false),
      section3LiveTvChannels: state.liveTvChannels.filter((c) => c.published !== false),
      section3LiveTvPlans: state.liveTvPlans.filter((p) => p.published !== false),
      lastPublishedSyncAt: state.lastPublishedSyncAt,
    });
  });

  // Same-origin HLS stream & manifest proxy so live .m3u8 channels play embedded with zero CORS issues
  app.get('/api/livetv/hls-proxy', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl || (!rawUrl.startsWith('https://') && !rawUrl.startsWith('http://'))) {
      res.status(400).json({ error: 'Valid stream URL is required.' });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Malformed stream URL.' });
      return;
    }

    // Block loopback / private metadata IPs for SSRF safety
    const host = parsedUrl.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('169.254.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.')
    ) {
      res.status(403).json({ error: 'Blocked host.' });
      return;
    }

    try {
      const upstream = await fetch(parsedUrl.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: '*/*',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });

      if (!upstream.ok) {
        res.status(upstream.status).send(`Upstream stream returned HTTP ${upstream.status}`);
        return;
      }

      const contentType = upstream.headers.get('content-type') || '';
      const finalUrl = upstream.url || parsedUrl.toString();
      const isPlaylist =
        finalUrl.toLowerCase().includes('.m3u8') ||
        contentType.toLowerCase().includes('mpegurl') ||
        contentType.toLowerCase().includes('x-mpegurl');

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');

      if (isPlaylist) {
        const text = await upstream.text();
        const rewritten = text
          .split(/\r?\n/)
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith('#')) {
              // Rewrite URI="..." inside EXT-X-KEY / EXT-X-MEDIA / EXT-X-MAP tags
              return line.replace(/URI="([^"]+)"/gi, (_m, uri: string) => {
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

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.send(rewritten);
        return;
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', contentType || 'video/mp2t');
      res.send(buf);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to connect to live stream.',
      });
    }
  });

  app.post('/api/services/inquiries', (req, res) => {
    try {
      const { serviceId, serviceName, customerName, customerEmail, customerPhone, companyName, notes } =
        req.body;
      if (!customerName || !customerEmail || !String(customerEmail).includes('@')) {
        res.status(400).json({ error: 'Name and a valid email address are required.' });
        return;
      }
      const inquiry = addServiceInquiry({
        serviceId: String(serviceId || 'custom'),
        serviceName: String(serviceName || 'Playbeat Business Service'),
        customerName: String(customerName).trim(),
        customerEmail: String(customerEmail).trim(),
        customerPhone: String(customerPhone || '').trim(),
        companyName: String(companyName || '').trim(),
        notes: String(notes || '').trim(),
      });
      res.status(201).json({ inquiry });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Inquiry failed.' });
    }
  });

  // -------------------------------------------------------------------------
  // Admin-Only Catalog Extraction, Sync & 3-Section Management APIs
  // -------------------------------------------------------------------------
  app.get('/api/admin/catalog', (_req, res) => {
    const state = getCatalogState();
    res.json({
      digitalProducts: getAdminDigitalProducts(),
      businessServices: state.businessServices,
      liveTvChannels: state.liveTvChannels,
      liveTvPlans: state.liveTvPlans,
      serviceInquiries: state.serviceInquiries,
      lastPublishedSyncAt: state.lastPublishedSyncAt,
      sync: getLastSyncStatus(),
    });
  });

  app.post('/api/admin/electronicfirst/sync', async (_req, res) => {
    const result = await syncElectronicFirstCatalog();
    const merged = result.sync.source === 'live_api' ? replaceSyncedDigitalProducts(result.products) : getAdminDigitalProducts();
    res.json({
      products: merged,
      sync: {
        ...result.sync,
        productCount: result.sync.source === 'live_api' ? result.products.length : merged.filter((p) => p.supplierVerified === true).length,
        message: result.sync.source === 'live_api' ? `${result.sync.message} Published to PlayBeat Section 1.` : `${result.sync.message} Existing verified catalogue was preserved.`,
      },
    });
  });

  // Backwards-compatible alias for admin tools
  app.post('/api/electronicfirst/sync', async (_req, res) => {
    const result = await syncElectronicFirstCatalog();
    const merged = result.sync.source === 'live_api' ? replaceSyncedDigitalProducts(result.products) : getAdminDigitalProducts();
    res.json({ products: merged, sync: { ...result.sync, productCount: result.sync.source === 'live_api' ? result.products.length : merged.filter((p) => p.supplierVerified === true).length, message: result.sync.source === 'live_api' ? `${result.sync.message} Published to PlayBeat Section 1.` : `${result.sync.message} Existing verified catalogue was preserved.` } });
  });

  app.post('/api/admin/products', (req, res) => {
    try {
      const rate = Number(process.env.USD_TO_PKR_RATE || 278.5);
      const body = req.body;
      if (!body.name) {
        res.status(400).json({ error: 'Product name is required.' });
        return;
      }
      const priceUsd = Number(body.priceUsd || 9.99);
      const originalPriceUsd = Number(body.originalPriceUsd || priceUsd);
      const discountPercent =
        originalPriceUsd > priceUsd
          ? Math.round(((originalPriceUsd - priceUsd) / originalPriceUsd) * 100)
          : 0;
      const stockCount = Number(body.stockCount ?? 50);
      const saved = upsertDigitalProduct({
        sku: String(body.sku || `PB-AFF-${Date.now().toString().slice(-6)}`),
        publicCode: body.publicCode ? String(body.publicCode) : undefined,
        name: String(body.name).trim(),
        category: body.category || 'PC Games',
        platform: body.platform || 'PC',
        region: 'Worldwide',
        originalPriceUsd: Number(originalPriceUsd.toFixed(2)),
        priceUsd: Number(priceUsd.toFixed(2)),
        pricePkr: Math.round(priceUsd * rate),
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
      });
      res.status(201).json({ product: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save product.' });
    }
  });

  app.delete('/api/admin/products/:sku', (req, res) => {
    const ok = deleteDigitalProduct(req.params.sku);
    res.json({ ok });
  });

  app.post('/api/admin/services', (req, res) => {
    try {
      const rate = Number(process.env.USD_TO_PKR_RATE || 278.5);
      const body = req.body;
      if (!body.name) {
        res.status(400).json({ error: 'Service name is required.' });
        return;
      }
      const recommendedPkr = Math.round(Number(body.recommendedPkr || 149000));
      const optionalUsd = Math.round(Number(body.optionalUsd || recommendedPkr / rate));
      const id = String(body.id || `svc-${Date.now().toString().slice(-6)}`);
      const saved = upsertBusinessService({
        id,
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
      });
      res.status(201).json({ service: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save service.' });
    }
  });

  app.delete('/api/admin/services/:id', (req, res) => {
    const ok = deleteBusinessService(req.params.id);
    res.json({ ok });
  });

  app.post('/api/admin/livetv/channels', (req, res) => {
    try {
      const body = req.body;
      if (!body.name) {
        res.status(400).json({ error: 'Channel name is required.' });
        return;
      }
      const chId = String(body.id || `tv-${Date.now().toString().slice(-6)}`);
      const category = body.category || 'News';
      const defaultImg =
        category === 'Sports'
          ? '/assets/playbeat/tv/sports.jpg'
          : category === 'Movies'
            ? '/assets/playbeat/tv/cinema.jpg'
            : category === 'Documentary'
              ? '/assets/playbeat/tv/space.jpg'
              : category === 'Kids'
                ? '/assets/playbeat/tv/kids.jpg'
                : category === 'Entertainment'
                  ? '/assets/playbeat/tv/entertainment.jpg'
                  : category === 'Regional & World'
                    ? '/assets/playbeat/tv/regional.jpg'
                    : '/assets/playbeat/tv/news.jpg';
      const saved = upsertLiveTvChannel({
        id: chId,
        name: String(body.name).trim(),
        category,
        country: String(body.country || 'Worldwide'),
        language: String(body.language || 'English'),
        quality: body.quality || '1080p HD',
        streamType: body.streamType || 'Playbeat Fast',
        streamUrl: String(body.streamUrl || `internal://playbeat-stream/${chId}`),
        imageUrl: String(body.imageUrl || defaultImg),
        nowPlaying: String(body.nowPlaying || `${String(body.name).trim()} — Live Broadcast`),
        upNext: String(body.upNext || 'Playbeat Prime Showcase'),
        tagline: String(body.tagline || '24/7 live broadcast channel on Playbeat TV.'),
        isLive: body.isLive !== false,
        published: body.published !== false,
      });
      res.status(201).json({ channel: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save channel.' });
    }
  });

  app.delete('/api/admin/livetv/channels/:id', (req, res) => {
    const ok = deleteLiveTvChannel(req.params.id);
    res.json({ ok });
  });

  app.post('/api/admin/livetv/plans', (req, res) => {
    try {
      const rate = Number(process.env.USD_TO_PKR_RATE || 278.5);
      const body = req.body;
      if (!body.name) {
        res.status(400).json({ error: 'Plan name is required.' });
        return;
      }
      const priceUsd = Number(body.priceUsd || 9.99);
      const saved = upsertLiveTvPlan({
        id: String(body.id || `pbtv-${Date.now().toString().slice(-6)}`),
        sku: String(body.sku || `PB-TV-${Date.now().toString().slice(-5)}`),
        name: String(body.name).trim(),
        lineType: body.lineType || 'Xtream Line',
        durationLabel: String(body.durationLabel || '30 Days'),
        originalPriceUsd: Number(body.originalPriceUsd || priceUsd * 1.5),
        priceUsd: Number(priceUsd.toFixed(2)),
        pricePkr: Math.round(priceUsd * rate),
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
      });
      res.status(201).json({ plan: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save plan.' });
    }
  });

  app.delete('/api/admin/livetv/plans/:id', (req, res) => {
    const ok = deleteLiveTvPlan(req.params.id);
    res.json({ ok });
  });

  app.patch('/api/admin/inquiries/:id', (req, res) => {
    const updated = updateServiceInquiryStatus(req.params.id, req.body.status || 'CONTACTED');
    if (!updated) {
      res.status(404).json({ error: 'Inquiry not found.' });
      return;
    }
    res.json({ inquiry: updated });
  });

  // -------------------------------------------------------------------------
  // Admin Diagnostics & Orders Desk
  // -------------------------------------------------------------------------
  app.get('/api/integrations/readiness', (_req, res) => {
    res.json({
      readiness: getIntegrationReadiness(),
      syncStatus: getLastSyncStatus(),
      webhookLogs: listWebhookLogs(),
    });
  });

  app.get('/api/orders', (_req, res) => {
    res.json({ orders: listOrders() });
  });

  // -------------------------------------------------------------------------
  // Manual Payments
  // -------------------------------------------------------------------------
  app.post('/api/orders/manual', (req, res) => {
    try {
      const {
        items,
        customerEmail,
        customerMobile,
        manualChannel,
        manualReference,
        manualSenderAccount,
        currency,
      } = req.body;

      if (!customerEmail || !String(customerEmail).includes('@')) {
        res.status(400).json({ error: 'Valid customer email is required for delivery.' });
        return;
      }

      const order = createManualOrder({
        items,
        customerEmail,
        customerMobile: customerMobile || '',
        manualChannel: manualChannel || 'Bank Transfer (IBAN)',
        manualReference: manualReference || '',
        manualSenderAccount: manualSenderAccount || '',
        currency: currency === 'PKR' ? 'PKR' : 'USD',
      });
      res.status(201).json({ order });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create manual order.' });
    }
  });

  app.post('/api/orders/:orderId/approve-manual', async (req, res) => {
    try {
      const order = await approveManualOrder(req.params.orderId);
      res.json({ order });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Manual approval failed.' });
    }
  });

  // -------------------------------------------------------------------------
  // PayPal International Checkout (REST v2)
  // -------------------------------------------------------------------------
  app.post('/api/paypal/test-auth', async (_req, res) => {
    try {
      const token = await getPayPalAccessToken();
      res.json({
        ok: true,
        mode: token.mode,
        baseUrl: token.baseUrl,
        message: 'PayPal OAuth2 client_credentials handshake succeeded.',
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'PayPal OAuth test failed.',
      });
    }
  });

  app.post('/api/paypal/create-order', async (req, res) => {
    try {
      const { items, customerEmail, customerMobile } = req.body;
      if (!customerEmail || !String(customerEmail).includes('@')) {
        res.status(400).json({ error: 'Valid customer email is required.' });
        return;
      }
      const origin = `${req.protocol}://${req.get('host')}`;
      const result = await createPayPalCheckoutOrder({
        items,
        customerEmail,
        customerMobile: customerMobile || '',
        returnBaseUrl: process.env.APP_URL || origin,
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'PayPal order creation failed.' });
    }
  });

  app.post('/api/paypal/capture-order', async (req, res) => {
    try {
      const { paypalOrderId } = req.body;
      if (!paypalOrderId) {
        res.status(400).json({ error: 'paypalOrderId is required.' });
        return;
      }
      const order = await capturePayPalCheckoutOrder(String(paypalOrderId));
      res.json({ order });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'PayPal capture failed.' });
    }
  });

  // -------------------------------------------------------------------------
  // Rapid Gateway Local PKR Checkout (Default)
  // -------------------------------------------------------------------------
  app.post('/api/rapid/test-auth', async (req, res) => {
    try {
      const useShared = Boolean(req.body?.useSharedSandboxClient);
      const token = await getRapidAccessToken(useShared);
      res.json({
        ok: true,
        environment: token.environment,
        merchantId: token.merchantId,
        baseUrl: token.baseUrl,
        message: 'Rapid Gateway OAuth2 client_credentials handshake succeeded.',
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Rapid Gateway OAuth test failed.',
      });
    }
  });

  app.post('/api/rapid/create-session', async (req, res) => {
    try {
      const {
        items,
        customerEmail,
        customerMobile,
        environmentOverride,
        testScenario,
        sandboxAmountOverride,
      } = req.body;

      if (!customerEmail || !String(customerEmail).includes('@')) {
        res.status(400).json({ error: 'Valid customer email is required.' });
        return;
      }

      const result = await createRapidCheckoutSession({
        items,
        customerEmail,
        customerMobile: customerMobile || '03001234567',
        environmentOverride: environmentOverride === 'LIVE' ? 'LIVE' : 'TEST',
        testScenario,
        sandboxAmountOverride: sandboxAmountOverride ? Number(sandboxAmountOverride) : undefined,
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rapid session creation failed.' });
    }
  });

  app.get('/api/rapid/verify-session/:sessionId', async (req, res) => {
    try {
      const result = await verifyRapidCheckoutSession(req.params.sessionId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rapid verification failed.' });
    }
  });

  app.get('/api/rapid/session-status/:sessionId', async (req, res) => {
    try {
      const result = await verifyRapidCheckoutSession(req.params.sessionId);
      res.json({ ...result, status: result.gatewayStatus });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Rapid status check failed.' });
    }
  });

  app.post('/api/webhooks/rapid', async (req, res) => {
    try {
      const rawBody =
        (req as express.Request & { rawBody?: string }).rawBody || JSON.stringify(req.body);
      const signatureHeader = String(
        req.headers['x-rapid-signature'] || req.headers['x-signature'] || '',
      );
      const result = await processRapidWebhook({ rawBody, signatureHeader });
      if (!result.signatureValid) {
        res.status(401).json({ ok: false, error: 'Invalid webhook signature', ...result });
        return;
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Webhook error' });
    }
  });

  app.post('/api/rapid/simulate-webhook', async (req, res) => {
    try {
      const { sessionId, eventType } = req.body;
      const payload = JSON.stringify({
        event: eventType || 'transaction.completed',
        sessionId,
        timestamp: new Date().toISOString(),
      });
      const signature = signRapidWebhookPayload(payload);
      const result = await processRapidWebhook({
        rawBody: payload,
        signatureHeader: signature,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Simulation failed' });
    }
  });

  // -------------------------------------------------------------------------
  // Vite Dev Middleware / Production Static Assets
  // -------------------------------------------------------------------------
  const distPath = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distPath);

  if (isProd) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Import the complete verified supplier catalogue on server startup.
  // If the supplier is unavailable, keep the last saved catalogue unchanged.
  try {
    const initialSync = await syncElectronicFirstCatalog();
    if (initialSync.sync.source === 'live_api' && initialSync.products.length > 0) {
      replaceSyncedDigitalProducts(initialSync.products);
      console.log(`PlayBeat catalogue initialized with ${initialSync.products.length} verified products.`);
    } else {
      console.warn(`PlayBeat catalogue startup sync skipped: ${initialSync.sync.message}`);
    }
  } catch (error) {
    console.error('PlayBeat catalogue startup sync failed; existing catalogue was preserved.', error);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Playbeat Digital server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Playbeat Digital server:', err);
  process.exit(1);
});
