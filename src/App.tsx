import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminGate } from './components/AdminGate';
import { AdminPanelView, type AdminTab } from './components/AdminPanelView';
import { AiChatBoxSection } from './components/AiChatBoxSection';
import { AuthModal } from './components/AuthModal';
import { BusinessServicesSection } from './components/BusinessServicesSection';
import { CheckoutDrawer } from './components/CheckoutDrawer';
import type { WebhookLogEntry } from './components/IntegrationsView';
import { LiveTvSection } from './components/LiveTvSection';
import { type ActiveView, Navbar } from './components/Navbar';
import { ProductDetailModal } from './components/ProductDetailModal';
import { StorefrontView } from './components/StorefrontView';
import { StorefrontFooter } from './components/StorefrontFooter';
import type {
  BusinessService,
  CartItem,
  ElectronicFirstSyncResult,
  IntegrationReadiness,
  LiveTvChannel,
  LiveTvPlan,
  OrderRecord,
  Product,
  PublicStoreConfig,
  ServiceInquiry,
} from './types/store';
import {
  ADMIN_UNAUTHORIZED_EVENT,
  adminFetch,
  hasAdminSession,
} from './lib/adminAuth';

const CART_STORAGE_KEY = 'pb_cart_v3';

const DEFAULT_STORE_CONFIG: PublicStoreConfig = {
  storeName: 'Playbeat Digital',
  pkrPerUsd: 278.5,
  defaultRail: 'rapid',
  paypal: {
    enabled: true,
    clientId: '',
    environment: 'sandbox',
  },
  rapid: {
    enabled: true,
    merchantId: '1367',
    environment: 'TEST',
    sdkUrl: 'https://secure.rapid-gateway.com/sdk/v1/rapidpay.js',
  },
};

function readInitialViewFromLocation(): ActiveView {
  const pathname = window.location.pathname.replace(/\/+$/, '').toLowerCase() || '/';
  if (pathname === '/services' || pathname === '/business-services') return 'business-services';
  if (pathname === '/live-tv' || pathname === '/livetv' || pathname === '/tv') return 'live-tv';
  if (pathname === '/ai' || pathname === '/chat' || pathname === '/ai-chat') return 'ai-chat';
  if (pathname === '/admin') return 'admin';

  // Preserve older bookmarked hash URLs.
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  if (hash === 'services' || hash === 'business-services') return 'business-services';
  if (hash === 'live-tv' || hash === 'livetv' || hash === 'tv') return 'live-tv';
  if (hash === 'admin') return 'admin';
  return 'digital-store';
}

function readInitialProductSku(): string | null {
  const match = window.location.pathname.match(/^\/product\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function viewToPath(view: ActiveView): string {
  switch (view) {
    case 'business-services':
      return '/services';
    case 'live-tv':
      return '/live-tv';
    case 'ai-chat':
      return '/ai';
    case 'admin':
      return '/admin';
    default:
      return '/';
  }
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>(() => readInitialViewFromLocation());
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab>('overview');

  // Buyer-facing storefront catalog
  const [buyerDigitalProducts, setBuyerDigitalProducts] = useState<Product[]>([]);
  const [buyerBusinessServices, setBuyerBusinessServices] = useState<BusinessService[]>([]);
  const [buyerLiveTvChannels, setBuyerLiveTvChannels] = useState<LiveTvChannel[]>([]);
  const [buyerLiveTvPlans, setBuyerLiveTvPlans] = useState<LiveTvPlan[]>([]);

  // Admin-only catalog and operational records
  const [adminDigitalProducts, setAdminDigitalProducts] = useState<Product[]>([]);
  const [adminBusinessServices, setAdminBusinessServices] = useState<BusinessService[]>([]);
  const [adminLiveTvChannels, setAdminLiveTvChannels] = useState<LiveTvChannel[]>([]);
  const [adminLiveTvPlans, setAdminLiveTvPlans] = useState<LiveTvPlan[]>([]);
  const [serviceInquiries, setServiceInquiries] = useState<ServiceInquiry[]>([]);

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [storeConfig, setStoreConfig] = useState<PublicStoreConfig>(DEFAULT_STORE_CONFIG);
  const [readiness, setReadiness] = useState<IntegrationReadiness | null>(null);
  const [syncStatus, setSyncStatus] = useState<ElectronicFirstSyncResult | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLogEntry[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Admin password gate: /admin stays locked until a valid session token exists.
  const [adminAuthOk, setAdminAuthOk] = useState<boolean>(() => hasAdminSession());

  // Google Shopping / shared links land on /product/<sku> — open the product modal.
  const [pendingProductSku, setPendingProductSku] = useState<string | null>(() => readInitialProductSku());

  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return [];
  });
  const [cartPopKey, setCartPopKey] = useState(0);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [inspectedProduct, setInspectedProduct] = useState<Product | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  // Any 401 from an admin API call re-locks the admin panel.
  useEffect(() => {
    const onAdminUnauthorized = () => setAdminAuthOk(false);
    window.addEventListener(ADMIN_UNAUTHORIZED_EVENT, onAdminUnauthorized);
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED_EVENT, onAdminUnauthorized);
  }, []);

  // Resolve /product/<sku> deep links once the catalog is available. The
  // preview list (first 120) arrives first; the full index hydration follows.
  useEffect(() => {
    if (!pendingProductSku) return;
    const found = buyerDigitalProducts.find(
      (p) => p.sku === pendingProductSku || p.publicCode === pendingProductSku,
    );
    if (found) {
      setInspectedProduct(found);
      setPendingProductSku(null);
      return;
    }
    // Services resolve through the services section modal.
    const svc = buyerBusinessServices.find(
      (x) => x.sku === pendingProductSku || x.id === pendingProductSku,
    );
    if (svc) {
      window.dispatchEvent(new CustomEvent('pb-inspect-service', { detail: svc.sku }));
      setPendingProductSku(null);
      return;
    }
    // Hydrated list loaded but SKU unknown — stop waiting.
    if (buyerDigitalProducts.length > 150) setPendingProductSku(null);
  }, [buyerDigitalProducts, buyerBusinessServices, pendingProductSku]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // ignore storage errors
    }
  }, [cart]);

  useEffect(() => {
    const scrollToSection = (view: ActiveView, behavior: ScrollBehavior = 'smooth') => {
      if (view === 'admin') {
        window.scrollTo({ top: 0, behavior });
        return;
      }
      const targetId =
        view === 'business-services'
          ? 'section2-services'
          : view === 'live-tv'
            ? 'section3-livetv'
            : view === 'ai-chat'
              ? 'section4-ai-chatbox'
              : 'home';
      window.requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior, block: 'start' });
      });
    };

    const onLocationChange = () => {
      const view = readInitialViewFromLocation();
      setActiveView(view);
      scrollToSection(view);
    };
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);
    if (activeView !== 'digital-store') scrollToSection(activeView, 'auto');
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
    };
  }, [activeView]);

  const fetchBuyerCatalog = useCallback(async () => {
    try {
      const [catRes, cfgRes] = await Promise.all([
        fetch('/api/storefront/catalog'),
        fetch('/api/config'),
      ]);
      if (catRes.ok) {
        const data = await catRes.json();
        if (Array.isArray(data.section1DigitalProducts)) {
          setBuyerDigitalProducts(data.section1DigitalProducts);
          // Hydrate the FULL catalog (6,500+ products) from the static index
          // when the API preview only returns the first page.
          const total = Number(data.section1Total || 0);
          const indexUrl = String(data.section1IndexUrl || '');
          if (total > data.section1DigitalProducts.length && indexUrl) {
            void (async () => {
              try {
                const idxRes = await fetch(indexUrl);
                if (!idxRes.ok) return;
                const idx = await idxRes.json();
                if (Array.isArray(idx.products) && idx.products.length > 0) {
                  setBuyerDigitalProducts(idx.products);
                }
              } catch {
                // preview list stays in place
              }
            })();
          }
        }
        if (Array.isArray(data.section2BusinessServices)) {
          setBuyerBusinessServices(data.section2BusinessServices);
        }
        if (Array.isArray(data.section3LiveTvChannels)) {
          setBuyerLiveTvChannels(data.section3LiveTvChannels);
        }
        if (Array.isArray(data.section3LiveTvPlans)) {
          setBuyerLiveTvPlans(data.section3LiveTvPlans);
        }
      }
      if (cfgRes.ok) {
        const cfg = (await cfgRes.json()) as PublicStoreConfig;
        setStoreConfig(cfg);
      }
    } catch {
      // non-fatal
    }
  }, []);

  const fetchAdminData = useCallback(async () => {
    try {
      const [adminRes, ordersRes, diagRes] = await Promise.all([
        adminFetch('/api/admin/catalog'),
        adminFetch('/api/orders'),
        adminFetch('/api/integrations/readiness'),
      ]);
      if (adminRes.ok) {
        const data = await adminRes.json();
        if (Array.isArray(data.digitalProducts)) setAdminDigitalProducts(data.digitalProducts);
        if (Array.isArray(data.businessServices)) setAdminBusinessServices(data.businessServices);
        if (Array.isArray(data.liveTvChannels)) setAdminLiveTvChannels(data.liveTvChannels);
        if (Array.isArray(data.liveTvPlans)) setAdminLiveTvPlans(data.liveTvPlans);
        if (Array.isArray(data.serviceInquiries)) setServiceInquiries(data.serviceInquiries);
        if (data.sync) setSyncStatus(data.sync);
      }
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        if (Array.isArray(data.orders)) setOrders(data.orders);
      }
      if (diagRes.ok) {
        const diag = await diagRes.json();
        if (diag.readiness) setReadiness(diag.readiness);
        if (diag.syncStatus) setSyncStatus(diag.syncStatus);
        if (Array.isArray(diag.webhookLogs)) setWebhookLogs(diag.webhookLogs);
      }
    } catch {
      // non-fatal
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchBuyerCatalog(), fetchAdminData()]);
  }, [fetchBuyerCatalog, fetchAdminData]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleSyncElectronicFirst = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await adminFetch('/api/admin/electronicfirst/sync', { method: 'POST' });
      const data = await res.json();
      if (data.sync) {
        setSyncStatus(data.sync);
        showToast(data.sync.message);
      }
      await refreshAll();
    } catch {
      showToast('Could not reach Partner API sync endpoint.');
    } finally {
      setIsSyncing(false);
    }
  }, [refreshAll, showToast]);

  const handleSelectView = useCallback(
    (view: ActiveView, adminTab: AdminTab = 'overview') => {
      if (view === 'admin') {
        setAdminInitialTab(adminTab);
        if (hasAdminSession()) void fetchAdminData();
      }
      setActiveView(view);
      setSearchQuery('');
      const targetPath = viewToPath(view);
      if (window.location.pathname !== targetPath || window.location.hash) {
        window.history.pushState(null, '', targetPath);
      }
      if (view === 'admin') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const targetId =
          view === 'business-services'
            ? 'section2-services'
            : view === 'live-tv'
              ? 'section3-livetv'
              : view === 'ai-chat'
                ? 'section4-ai-chatbox'
                : 'home';
        document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [fetchAdminData],
  );

  const handleAddToCart = useCallback(
    (sku: string) => {
      const prod = buyerDigitalProducts.find((p) => p.sku === sku);
      const svc = buyerBusinessServices.find((s) => s.sku === sku);
      const plan = buyerLiveTvPlans.find((pl) => pl.sku === sku);
      const itemName = prod?.name || svc?.name || plan?.name || sku;

      setCart((prev) => {
        const existing = prev.find((i) => i.sku === sku);
        if (existing) {
          return prev.map((i) => (i.sku === sku ? { ...i, quantity: i.quantity + 1 } : i));
        }
        return [...prev, { sku, quantity: 1 }];
      });
      setCartPopKey((k) => k + 1);
      showToast(`${itemName} added to Playbeat cart.`);
    },
    [buyerDigitalProducts, buyerBusinessServices, buyerLiveTvPlans, showToast],
  );

  const handleUpdateCartQty = useCallback((sku: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.sku === sku ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0),
    );
  }, []);

  const handleRemoveCartItem = useCallback((sku: string) => {
    setCart((prev) => prev.filter((i) => i.sku !== sku));
  }, []);

  const handleClearCart = useCallback(() => {
    setCart([]);
  }, []);

  const handleOrderUpsert = useCallback((order: OrderRecord) => {
    setOrders((prev) => {
      const idx = prev.findIndex((o) => o.orderId === order.orderId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = order;
        return copy;
      }
      return [order, ...prev];
    });
  }, []);

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const adminBadgeCount = orders.length + serviceInquiries.length;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar
        activeView={activeView}
        onSelectView={(v) => handleSelectView(v)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        cartCount={cartCount}
        cartPopKey={cartPopKey}
        onOpenCart={() => setIsCartOpen(true)}
        adminBadgeCount={adminBadgeCount}
        onShowToast={showToast}
      />

      <div className="flex-1">
        {/* Public storefront: all three sections in the requested order. */}
        {activeView !== 'admin' && (
          <>
            <StorefrontView
              digitalProducts={buyerDigitalProducts}
              servicesCount={buyerBusinessServices.length}
              liveChannelsCount={buyerLiveTvChannels.length}
              searchQuery={searchQuery}
              onClearSearch={() => setSearchQuery('')}
              onAddToCart={handleAddToCart}
              onInspectProduct={setInspectedProduct}
              onSelectView={(v) => handleSelectView(v)}
              onShowToast={showToast}
            />

            <BusinessServicesSection
              services={buyerBusinessServices}
              globalSearch={searchQuery}
              onAddToCart={handleAddToCart}
              onSelectView={(v) => handleSelectView(v)}
              onShowToast={showToast}
            />

            <LiveTvSection
              channels={buyerLiveTvChannels}
              plans={buyerLiveTvPlans}
              globalSearch={searchQuery}
              onAddToCart={handleAddToCart}
              onSelectView={(v) => handleSelectView(v)}
              onShowToast={showToast}
            />

            <AiChatBoxSection />

            <StorefrontFooter
              currentPage="live-tv"
              onSelectView={(v) => handleSelectView(v)}
              onShowToast={showToast}
            />
          </>
        )}

        {/* ADMIN PANEL — password protected at /admin */}
        {activeView === 'admin' && !adminAuthOk && (
          <AdminGate
            onUnlocked={() => {
              setAdminAuthOk(true);
              void fetchAdminData();
            }}
            onBackToStorefront={() => handleSelectView('digital-store')}
          />
        )}
        {activeView === 'admin' && adminAuthOk && (
          <AdminPanelView
            key={adminInitialTab}
            initialTab={adminInitialTab}
            digitalProducts={adminDigitalProducts}
            businessServices={adminBusinessServices}
            liveTvChannels={adminLiveTvChannels}
            liveTvPlans={adminLiveTvPlans}
            serviceInquiries={serviceInquiries}
            orders={orders}
            readiness={readiness}
            syncStatus={syncStatus}
            webhookLogs={webhookLogs}
            isSyncing={isSyncing}
            onSyncElectronicFirst={handleSyncElectronicFirst}
            onRefreshAll={refreshAll}
            onOrderUpdated={handleOrderUpsert}
            onInquiryUpdated={(inq) =>
              setServiceInquiries((list) => list.map((x) => (x.id === inq.id ? inq : x)))
            }
            onBackToStorefront={() => handleSelectView('digital-store')}
            onShowToast={showToast}
          />
        )}
      </div>

      <ProductDetailModal
        product={inspectedProduct}
        onClose={() => setInspectedProduct(null)}
        onAddToCart={handleAddToCart}
      />

      <AuthModal onShowToast={showToast} />

      <CheckoutDrawer
        isCartOpen={isCartOpen}
        onCloseCart={() => setIsCartOpen(false)}
        cart={cart}
        products={buyerDigitalProducts}
        businessServices={buyerBusinessServices}
        liveTvPlans={buyerLiveTvPlans}
        storeConfig={storeConfig}
        onUpdateQty={handleUpdateCartQty}
        onRemoveItem={handleRemoveCartItem}
        onClearCart={handleClearCart}
        onOrderCreated={handleOrderUpsert}
        onOpenAdminOrders={() => handleSelectView('admin', 'orders')}
        onShowToast={showToast}
      />

      {/* Playbeat Digital Glowing Toast Notification */}
      <div
        role="status"
        aria-live="polite"
        className={`edge-solid rounded-xl px-4 py-3 text-xs font-semibold text-[#f2f6ff] fixed right-4 bottom-4 z-[80] max-w-sm transition-all duration-200 ${
          toastMessage
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
      >
        {toastMessage}
      </div>
    </div>
  );
}
