import {
  Building2,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderGoogleSurveyOptIn } from '../lib/googleReviews';
import type {
  BusinessService,
  CartItem,
  LiveTvPlan,
  ManualChannel,
  OrderRecord,
  PaymentRail,
  Product,
  PublicStoreConfig,
} from '../types/store';

declare global {
  interface Window {
    RapidPay?: (publishableKey: string) => {
      mountCheckout: (
        selector: string,
        opts: {
          clientSecret: string;
          amount: number;
          currency: string;
          merchantName: string;
          onSuccess?: (payload: { sessionId: string }) => void;
          onPending?: (payload: { sessionId: string }) => void;
          onError?: (err: unknown) => void;
        },
      ) => void;
    };
  }
}

interface ResolvedCartProduct {
  sku: string;
  name: string;
  badge: string;
  priceUsd: number;
  pricePkr: number;
  imageUrl: string;
}

interface CheckoutDrawerProps {
  isCartOpen: boolean;
  onCloseCart: () => void;
  cart: CartItem[];
  products: Product[];
  businessServices: BusinessService[];
  liveTvPlans: LiveTvPlan[];
  storeConfig: PublicStoreConfig;
  onUpdateQty: (sku: string, delta: number) => void;
  onRemoveItem: (sku: string) => void;
  onClearCart: () => void;
  onOrderCreated: (order: OrderRecord) => void;
  onOpenAdminOrders: () => void;
  onShowToast: (msg: string) => void;
}

const RAPID_SCENARIOS = [
  { value: 'AUTO', label: 'Auto (Use Cart Amount / Magic Value)' },
  { value: 'SUCCESS', label: 'SUCCESS (Approved Payment)' },
  { value: 'FAILED', label: 'FAILED (Declined)' },
  { value: 'PENDING', label: 'PENDING (Wallet / Raast Approval)' },
  { value: 'EXPIRED', label: 'EXPIRED (Session Timed Out)' },
  { value: 'INSUFFICIENT_BALANCE', label: 'INSUFFICIENT_BALANCE' },
  { value: 'INVALID_OTP', label: 'INVALID_OTP' },
  { value: 'TIMEOUT', label: 'TIMEOUT' },
];

export function CheckoutDrawer({
  isCartOpen,
  onCloseCart,
  cart,
  products,
  businessServices,
  liveTvPlans,
  storeConfig,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  onOrderCreated,
  onOpenAdminOrders,
  onShowToast,
}: CheckoutDrawerProps) {
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  // Confirmed default rail: Rapid Gateway PKR first
  const [activeRail, setActiveRail] = useState<PaymentRail>('rapid');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');

  // Rapid Gateway state
  const [rapidEnv, setRapidEnv] = useState<'TEST' | 'LIVE'>(storeConfig.rapid.environment || 'TEST');
  const [rapidScenario, setRapidScenario] = useState('AUTO');
  const [rapidMagicAmount, setRapidMagicAmount] = useState<string>('');
  const [rapidSession, setRapidSession] = useState<{
    sessionId: string;
    clientSecret: string;
    publishableKey: string;
    sdkUrl: string;
    amountPkr: number;
    environment: 'TEST' | 'LIVE';
    liveGatewayConnected: boolean;
    order: OrderRecord;
  } | null>(null);
  const [rapidSdkMounted, setRapidSdkMounted] = useState(false);

  // PayPal state
  const [paypalState, setPaypalState] = useState<{
    paypalOrderId: string;
    approvalUrl: string | null;
    order: OrderRecord;
  } | null>(null);

  // Manual payment state
  const [manualChannel, setManualChannel] = useState<ManualChannel>('Bank Transfer (IBAN)');
  const [manualSenderAccount, setManualSenderAccount] = useState('');
  const [manualReference, setManualReference] = useState('');

  // Shared async status
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<OrderRecord | null>(null);
  const rapidMountRef = useRef<HTMLDivElement | null>(null);

  // Google Customer Reviews — survey opt-in fires on the confirmation
  // screen for completed (paid & fulfilled) purchases only.
  useEffect(() => {
    if (completedOrder && completedOrder.status === 'PAID_FULFILLED') {
      renderGoogleSurveyOptIn(completedOrder);
    }
  }, [completedOrder]);

  const cartLines = useMemo(() => {
    return cart
      .map((item) => {
        const prod = products.find((p) => p.sku === item.sku);
        if (prod) {
          const resolved: ResolvedCartProduct = {
            sku: prod.sku,
            name: prod.name,
            badge: `Digital · ${prod.platform}`,
            priceUsd: prod.priceUsd,
            pricePkr: prod.pricePkr,
            imageUrl: prod.imageUrl,
          };
          return { ...item, resolved };
        }
        const svc = businessServices.find((s) => s.sku === item.sku);
        if (svc) {
          const resolved: ResolvedCartProduct = {
            sku: svc.sku,
            name: svc.name,
            badge: `Business Service · ${svc.packageLevel}`,
            priceUsd: svc.optionalUsd,
            pricePkr: svc.recommendedPkr,
            imageUrl: '/assets/playbeat/promo-showcase.webp',
          };
          return { ...item, resolved };
        }
        const plan = liveTvPlans.find((pl) => pl.sku === item.sku);
        if (plan) {
          const resolved: ResolvedCartProduct = {
            sku: plan.sku,
            name: plan.name,
            badge: `LIVE TV · ${plan.lineType}`,
            priceUsd: plan.priceUsd,
            pricePkr: plan.pricePkr,
            imageUrl: '/assets/playbeat/cta-showcase.webp',
          };
          return { ...item, resolved };
        }
        return null;
      })
      .filter((x): x is { sku: string; quantity: number; resolved: ResolvedCartProduct } => x !== null);
  }, [cart, products, businessServices, liveTvPlans]);

  const totals = useMemo(() => {
    const usd = cartLines.reduce((sum, l) => sum + l.resolved.priceUsd * l.quantity, 0);
    const pkr = cartLines.reduce((sum, l) => sum + l.resolved.pricePkr * l.quantity, 0);
    return { usd: Number(usd.toFixed(2)), pkr: Math.round(pkr) };
  }, [cartLines]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (checkoutModalOpen) {
          setCheckoutModalOpen(false);
        } else if (isCartOpen) {
          onCloseCart();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkoutModalOpen, isCartOpen, onCloseCart]);

  const mirrorToLocalOrders = (order: OrderRecord) => {
    try {
      const existing = JSON.parse(localStorage.getItem('gv_orders') || '[]') as Array<Record<string, unknown>>;
      const summary = {
        ref: order.orderId,
        items: order.items.map((i) => `${i.name} ×${i.quantity}`).join(', '),
        totalUSD: order.totalUsd,
        totalPKR: order.totalPkr,
        status: order.status,
        rail: order.paymentRail,
        date: order.updatedAt,
      };
      const filtered = existing.filter((x) => x.ref !== order.orderId);
      localStorage.setItem('gv_orders', JSON.stringify([summary, ...filtered].slice(0, 200)));
    } catch {
      // ignore storage errors
    }
  };

  const resetCheckoutModalState = () => {
    setErrorMsg(null);
    setCompletedOrder(null);
    setRapidSession(null);
    setRapidSdkMounted(false);
    setPaypalState(null);
    setActiveRail('rapid');
  };

  const handleOpenCheckoutModal = () => {
    if (cartLines.length === 0) {
      onShowToast('Your cart is empty. Add a product, service, or TV pass first.');
      return;
    }
    resetCheckoutModalState();
    onCloseCart();
    setCheckoutModalOpen(true);
  };

  const ensureEmail = (): boolean => {
    if (!customerEmail.trim() || !customerEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address for instant delivery.');
      return false;
    }
    return true;
  };

  const loadRapidPaySdk = (sdkUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.RapidPay) {
        resolve();
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${sdkUrl}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('RapidPay SDK failed to load')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = sdkUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('RapidPay JS SDK unavailable in current network'));
      document.head.appendChild(script);
    });
  };

  const handleStartRapidSession = async () => {
    setErrorMsg(null);
    if (!ensureEmail()) return;

    setBusy(true);
    try {
      const res = await fetch('/api/rapid/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart,
          customerEmail: customerEmail.trim(),
          customerMobile: customerMobile.trim() || '03001234567',
          environmentOverride: rapidEnv,
          testScenario: rapidEnv === 'TEST' ? rapidScenario : undefined,
          sandboxAmountOverride:
            rapidEnv === 'TEST' && rapidMagicAmount ? Number(rapidMagicAmount) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not initialize Rapid Gateway session.');

      setRapidSession(data);
      onOrderCreated(data.order);
      mirrorToLocalOrders(data.order);

      if (data.liveGatewayConnected) {
        try {
          await loadRapidPaySdk(data.sdkUrl);
          if (window.RapidPay && rapidMountRef.current) {
            rapidMountRef.current.innerHTML = '';
            window.RapidPay(data.publishableKey).mountCheckout('#rp-checkout', {
              clientSecret: data.clientSecret,
              amount: Math.round(data.amountPkr),
              currency: 'PKR',
              merchantName: storeConfig.storeName,
              onSuccess: ({ sessionId }) => {
                void handleVerifyRapidSession(sessionId);
              },
              onPending: ({ sessionId }) => {
                onShowToast('Awaiting wallet/Raast approval...');
                void handleVerifyRapidSession(sessionId);
              },
              onError: () => {
                setErrorMsg('RapidPay embedded checkout reported an error. Try verifying status or switching rail.');
              },
            });
            setRapidSdkMounted(true);
          }
        } catch {
          setRapidSdkMounted(false);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Rapid Gateway session creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyRapidSession = async (sessionIdOverride?: string) => {
    const sid = sessionIdOverride || rapidSession?.sessionId;
    if (!sid) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/rapid/session-status/${encodeURIComponent(sid)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not verify Rapid Gateway session.');

      onOrderCreated(data.order);
      mirrorToLocalOrders(data.order);

      if (data.order.status === 'PAID_FULFILLED') {
        setCompletedOrder(data.order);
        onClearCart();
        onShowToast('Rapid Gateway payment verified! Order fulfilled.');
      } else {
        setRapidSession((prev) => (prev ? { ...prev, order: data.order } : prev));
        setErrorMsg(`Session verified as ${data.gatewayStatus}: ${data.order.statusDetail}`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Rapid verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSimulateRapidWebhook = async () => {
    if (!rapidSession) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/rapid/simulate-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: rapidSession.sessionId,
          eventType: 'transaction.completed',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Signed webhook delivery failed.');

      await handleVerifyRapidSession(rapidSession.sessionId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Webhook simulation failed.');
      setBusy(false);
    }
  };

  const handleCreatePayPalOrder = async () => {
    setErrorMsg(null);
    if (!ensureEmail()) return;

    setBusy(true);
    try {
      const res = await fetch('/api/paypal/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart,
          customerEmail: customerEmail.trim(),
          customerMobile: customerMobile.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PayPal order creation failed.');

      setPaypalState({
        paypalOrderId: data.paypalOrderId,
        approvalUrl: data.approvalUrl,
        order: data.order,
      });
      onOrderCreated(data.order);
      mirrorToLocalOrders(data.order);
      onShowToast('PayPal USD order created. Complete approval, then capture.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'PayPal initialization failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCapturePayPalOrder = async () => {
    if (!paypalState) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paypalOrderId: paypalState.paypalOrderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PayPal capture requires buyer approval first.');

      onOrderCreated(data.order);
      mirrorToLocalOrders(data.order);
      if (data.order.status === 'PAID_FULFILLED') {
        setCompletedOrder(data.order);
        onClearCart();
        onShowToast('PayPal payment captured! Order fulfilled.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'PayPal capture failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitManualOrder = async () => {
    setErrorMsg(null);
    if (!ensureEmail()) return;

    setBusy(true);
    try {
      const res = await fetch('/api/orders/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart,
          customerEmail: customerEmail.trim(),
          customerMobile: customerMobile.trim(),
          manualChannel,
          manualSenderAccount: manualSenderAccount.trim(),
          manualReference: manualReference.trim(),
          currency: manualChannel === 'Crypto (USDT)' ? 'USD' : 'PKR',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Manual order creation failed.');

      onOrderCreated(data.order);
      mirrorToLocalOrders(data.order);
      setCompletedOrder(data.order);
      onClearCart();
      onShowToast(`Manual order ${data.order.orderId} submitted for verification.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not submit manual order.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = (val: string, label: string) => {
    void navigator.clipboard?.writeText(val);
    onShowToast(`${label} copied to clipboard.`);
  };

  return (
    <>
      {/* ══════════════ SLIDE-OVER CART DRAWER ══════════════ */}
      <div
        className={`fixed inset-0 z-[55] bg-black/60 transition-opacity duration-200 ${
          isCartOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onCloseCart}
      />

      <aside
        aria-label="Shopping cart"
        className={`edge-solid fixed top-0 right-0 h-full w-[min(410px,100%)] z-[60] p-5 flex flex-col rounded-l-2xl transition-transform duration-250 ${
          isCartOpen ? 'translate-x-0 visible' : 'translate-x-full invisible'
        }`}
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#1d4ed855]">
          <div>
            <h2 className="text-lg font-extrabold text-[#f2f6ff]">Your Playbeat Cart</h2>
            <p className="text-[11px] text-[#c8d3ea]">
              Digital Keys · Business Services · Playbeat LIVE TV
            </p>
          </div>
          <button
            type="button"
            onClick={onCloseCart}
            aria-label="Close cart"
            className="w-8 h-8 rounded-full border border-[#2154d4] grid place-items-center text-[#f2f6ff] hover:text-[#ffd958] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {cartLines.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <p className="text-sm text-[#c8d3ea]">
              Your cart is empty. Add a Digital Product, Business Service package, or LIVE TV Pass from the storefront.
            </p>
          </div>
        ) : (
          <>
            <ul className="flex-1 overflow-y-auto mt-2 divide-y divide-[#1d4ed844]">
              {cartLines.map(({ sku, quantity, resolved }) => (
                <li key={sku} className="flex items-center gap-3 py-3 text-sm">
                  <img
                    src={resolved.imageUrl}
                    alt={resolved.name}
                    className="w-11 h-11 rounded-lg object-cover border border-[#2154d4] shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-[#1ea0ff] uppercase truncate">
                      {resolved.badge}
                    </p>
                    <p className="font-semibold text-[12.5px] leading-snug text-[#f2f6ff] truncate">
                      {resolved.name}
                    </p>
                    <p className="text-[11px] text-[#ffd958] font-mono tabular-nums mt-0.5">
                      ${(resolved.priceUsd * quantity).toFixed(2)}{' '}
                      <span className="text-[#c8d3ea]">
                        (₨{(resolved.pricePkr * quantity).toLocaleString()})
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onUpdateQty(sku, -1)}
                      aria-label={`Decrease ${resolved.name}`}
                      className="w-6 h-6 rounded-full border border-[#2f8bff] grid place-items-center text-[#f2f6ff] hover:bg-[#0b2a8a] cursor-pointer"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-5 text-center font-bold text-xs font-mono tabular-nums">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateQty(sku, 1)}
                      aria-label={`Increase ${resolved.name}`}
                      className="w-6 h-6 rounded-full border border-[#2f8bff] grid place-items-center text-[#f2f6ff] hover:bg-[#0b2a8a] cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveItem(sku)}
                      aria-label={`Remove ${resolved.name}`}
                      className="ml-1 text-[#c8d3ea] hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t border-[#1d4ed866] pt-3 mt-2 space-y-2">
              <div className="flex items-center justify-between text-xs text-[#c8d3ea]">
                <span>Total (USD · PayPal)</span>
                <span className="font-mono font-bold text-[#f2f6ff]">${totals.usd.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm font-extrabold">
                <span>Total (PKR · Rapid Default)</span>
                <span className="text-[#ffd958] font-mono tabular-nums">
                  ₨{totals.pkr.toLocaleString()} PKR
                </span>
              </div>
              <button
                type="button"
                onClick={handleOpenCheckoutModal}
                className="yb rounded-full h-10 w-full text-[13px] font-bold mt-2"
              >
                Checkout · Rapid PKR / PayPal / Manual
              </button>
            </div>
          </>
        )}
      </aside>

      {/* ══════════════ MULTI-RAIL CHECKOUT MODAL ══════════════ */}
      {checkoutModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Playbeat Digital Secure Checkout"
        >
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setCheckoutModalOpen(false)}
          />

          <div className="edge-solid relative z-10 w-[min(540px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl p-5 sm:p-6">
            <button
              type="button"
              onClick={() => setCheckoutModalOpen(false)}
              aria-label="Close checkout"
              className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full border border-[#2154d4] grid place-items-center text-[#f2f6ff] hover:text-[#ffd958] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {completedOrder ? (
              <div className="text-center py-3">
                <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-400/50 grid place-items-center text-emerald-400 mb-3">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-extrabold text-[#f2f6ff]">
                  {completedOrder.status === 'PAID_FULFILLED'
                    ? 'Payment Confirmed & Fulfilled!'
                    : 'Manual Order Registered'}
                </h2>
                <p className="text-xs text-[#c8d3ea] mt-1.5 leading-relaxed">
                  {completedOrder.statusDetail}
                </p>

                <div className="mt-4 rounded-xl bg-[#06123699] border border-dashed border-[#2154d4] p-3 text-xs">
                  <span className="text-[#c8d3ea]">Order Reference: </span>
                  <b className="text-[#ffd958] font-mono text-sm">{completedOrder.orderId}</b>
                  <button
                    type="button"
                    onClick={() => handleCopy(completedOrder.orderId, 'Order Reference')}
                    className="ml-2 inline-flex items-center text-[#1ea0ff] hover:underline cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>

                {completedOrder.issuedKeys.length > 0 && (
                  <div className="mt-4 text-left space-y-2">
                    <p className="text-[11px] font-bold text-[#ffc928] uppercase tracking-wider">
                      Issued Playbeat Credentials &amp; Keys
                    </p>
                    {completedOrder.issuedKeys.map((k, idx) => (
                      <div
                        key={`${k.sku}-${idx}`}
                        className="rounded-lg bg-[#040d29] border border-[#2154d4] p-3 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#f2f6ff] truncate">
                            {k.productName}
                          </p>
                          <p className="font-mono text-xs font-bold text-[#ffd958] mt-0.5 select-all break-all">
                            {k.keyCode}
                          </p>
                          <p className="text-[10px] text-[#c8d3ea]">Playbeat Verified Fulfillment</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(k.keyCode, 'Access code')}
                          className="shrink-0 ob rounded-lg px-2.5 py-1.5 text-[11px] font-bold hover:bg-[#0b2a8a] cursor-pointer"
                        >
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5 mt-5">
                  <button
                    type="button"
                    onClick={() => {
                      setCheckoutModalOpen(false);
                      onOpenAdminOrders();
                    }}
                    className="ob rounded-full h-10 text-xs font-bold bg-[#061236] hover:bg-[#0b2a8a] cursor-pointer"
                  >
                    Manage in Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheckoutModalOpen(false)}
                    className="yb rounded-full h-10 text-xs font-bold"
                  >
                    Continue Shopping
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-extrabold text-[#f2f6ff] pr-8">
                  Playbeat Digital Checkout
                </h2>
                <p className="text-[11.5px] text-[#c8d3ea] mt-0.5">
                  Server-locked totals · Instant Playbeat Digital fulfillment
                </p>

                {/* Order Summary */}
                <div className="mt-3 space-y-1">
                  {cartLines.map(({ sku, quantity, resolved }) => (
                    <div
                      key={sku}
                      className="flex justify-between text-xs text-[#c8d3ea] gap-3"
                    >
                      <span className="truncate">
                        {resolved.name} ×{quantity}
                      </span>
                      <b className="text-[#f2f6ff] font-mono tabular-nums shrink-0">
                        ${(resolved.priceUsd * quantity).toFixed(2)}
                      </b>
                    </div>
                  ))}
                  <div className="border-t border-[#2154d4] mt-2.5 pt-2.5 flex items-baseline justify-between font-extrabold text-sm">
                    <span>Total</span>
                    <span className="font-mono tabular-nums text-[#ffd958]">
                      ₨{totals.pkr.toLocaleString()} PKR{' '}
                      <small className="text-[#c8d3ea] font-medium text-xs">
                        (${totals.usd.toFixed(2)} USD)
                      </small>
                    </span>
                  </div>
                </div>

                {/* Delivery Contact */}
                <div className="grid sm:grid-cols-2 gap-2.5 mt-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                      Email for delivery *
                    </label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="pb-input px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                      Mobile (JazzCash / EasyPaisa)
                    </label>
                    <input
                      type="tel"
                      value={customerMobile}
                      onChange={(e) => setCustomerMobile(e.target.value)}
                      placeholder="03001234567"
                      className="pb-input px-3 py-2 text-xs font-mono"
                    />
                  </div>
                </div>

                {/* Payment Rail Tabs (Rapid Gateway PKR Default First) */}
                <div className="grid grid-cols-3 gap-2 mt-4" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeRail === 'rapid'}
                    onClick={() => {
                      setActiveRail('rapid');
                      setErrorMsg(null);
                    }}
                    className={`co-tab rounded-xl p-2.5 flex flex-col items-center gap-0.5 text-center cursor-pointer ${
                      activeRail === 'rapid' ? 'co-tab-active' : ''
                    }`}
                  >
                    <Smartphone className="w-4 h-4 text-[#ffd958]" />
                    <span className="text-[11.5px] font-bold leading-tight">Rapid Gateway</span>
                    <small className="text-[10px] text-[#c8d3ea]">PKR · Default</small>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeRail === 'paypal'}
                    onClick={() => {
                      setActiveRail('paypal');
                      setErrorMsg(null);
                    }}
                    className={`co-tab rounded-xl p-2.5 flex flex-col items-center gap-0.5 text-center cursor-pointer ${
                      activeRail === 'paypal' ? 'co-tab-active' : ''
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-[#1ea0ff]" />
                    <span className="text-[11.5px] font-bold leading-tight">PayPal Card</span>
                    <small className="text-[10px] text-[#c8d3ea]">Intl · USD</small>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeRail === 'manual'}
                    onClick={() => {
                      setActiveRail('manual');
                      setErrorMsg(null);
                    }}
                    className={`co-tab rounded-xl p-2.5 flex flex-col items-center gap-0.5 text-center cursor-pointer ${
                      activeRail === 'manual' ? 'co-tab-active' : ''
                    }`}
                  >
                    <Building2 className="w-4 h-4 text-[#ffd958]" />
                    <span className="text-[11.5px] font-bold leading-tight">Manual Pay</span>
                    <small className="text-[10px] text-[#c8d3ea]">Bank / Crypto</small>
                  </button>
                </div>

                {errorMsg && (
                  <div className="mt-3 rounded-xl bg-rose-500/15 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-200">
                    {errorMsg}
                  </div>
                )}

                {/* ── TAB 1: RAPID GATEWAY (DEFAULT PKR) ── */}
                {activeRail === 'rapid' && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-[#c8d3ea] leading-relaxed">
                      Pay in Pakistan with <b className="text-[#f2f6ff]">JazzCash, EasyPaisa, Bank Transfer, Raast, or Card</b> via Rapid Gateway Merchant{' '}
                      <span className="font-mono text-[#ffd958]">#{storeConfig.rapid.merchantId}</span>. Amount locked server-side:{' '}
                      <b className="text-[#ffd958] font-mono">₨{totals.pkr.toLocaleString()} PKR</b>.
                    </p>

                    <div className="rounded-xl bg-[#040d29aa] border border-[#1d4ed866] p-3 space-y-2.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#c8d3ea]">Gateway Environment</span>
                        <div className="inline-flex rounded-lg border border-[#2154d4] overflow-hidden">
                          {(['TEST', 'LIVE'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => {
                                setRapidEnv(mode);
                                setRapidSession(null);
                              }}
                              className={`px-3 py-1 text-[10.5px] font-bold cursor-pointer ${
                                rapidEnv === mode
                                  ? 'bg-[#1ea0ff] text-[#030a1f]'
                                  : 'bg-[#061236] text-[#c8d3ea]'
                              }`}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>

                      {rapidEnv === 'TEST' && (
                        <div className="grid sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10.5px] text-[#c8d3ea] mb-1">
                              TEST_SCENARIO Override
                            </label>
                            <select
                              value={rapidScenario}
                              onChange={(e) => setRapidScenario(e.target.value)}
                              className="pb-input px-2.5 py-1.5 text-[11px]"
                            >
                              {RAPID_SCENARIOS.map((sc) => (
                                <option key={sc.value} value={sc.value} className="bg-[#051239]">
                                  {sc.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10.5px] text-[#c8d3ea] mb-1">
                              Magic Amount (100/200/300/400/500)
                            </label>
                            <input
                              type="number"
                              value={rapidMagicAmount}
                              onChange={(e) => setRapidMagicAmount(e.target.value)}
                              placeholder={`Default: ${totals.pkr}`}
                              className="pb-input px-2.5 py-1.5 text-[11px] font-mono"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {!rapidSession ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleStartRapidSession}
                        className="yb rounded-full h-10 w-full text-[13px] font-bold inline-flex items-center justify-center gap-2"
                      >
                        {busy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Smartphone className="w-4 h-4" />
                        )}
                        Initialize Rapid Checkout · ₨
                        {(rapidEnv === 'TEST' && rapidMagicAmount
                          ? Number(rapidMagicAmount)
                          : totals.pkr
                        ).toLocaleString()}{' '}
                        PKR
                      </button>
                    ) : (
                      <div className="rounded-xl bg-[#040d29] border border-[#2f8bff] p-3.5 space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[#ffd958]">
                            Rapid Session Ready ({rapidSession.environment})
                          </span>
                          <span className="font-mono text-[11px] text-[#c8d3ea]">
                            {rapidSession.sessionId.slice(0, 18)}…
                          </span>
                        </div>

                        <div
                          id="rp-checkout"
                          ref={rapidMountRef}
                          className="rounded-lg bg-[#061236] border border-[#1d4ed866] p-3 text-xs text-[#c8d3ea]"
                        >
                          {!rapidSdkMounted && (
                            <p className="leading-relaxed">
                              {rapidSession.liveGatewayConnected
                                ? 'RapidPay Checkout session initialized. Complete payment in wallet/card widget or verify server-side below.'
                                : `Sandbox session (${rapidSession.order.orderId}) ready. Use server-side verification or signed HMAC webhook below to complete test fulfillment.`}
                            </p>
                          )}
                        </div>

                        <div className="grid sm:grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleVerifyRapidSession()}
                            className="yb rounded-full h-9 text-xs font-bold inline-flex items-center justify-center gap-1.5"
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                            Verify Server Status
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={handleSimulateRapidWebhook}
                            className="ob rounded-full h-9 text-xs font-bold bg-[#061236] hover:bg-[#0b2a8a] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 text-[#1ea0ff]" />
                            Trigger Signed Webhook
                          </button>
                        </div>
                      </div>
                    )}

                    <p className="text-[11px] text-[#c8d3ea] text-center flex items-center justify-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-[#ffd958]" />
                      Server-verified checkout · Instant delivery upon payment confirmation
                    </p>
                  </div>
                )}

                {/* ── TAB 2: PAYPAL INTERNATIONAL (USD) ── */}
                {activeRail === 'paypal' && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-[#c8d3ea] leading-relaxed">
                      International card or PayPal balance checkout via PayPal REST v2 (
                      <span className="uppercase font-mono text-[#1ea0ff]">
                        {storeConfig.paypal.environment}
                      </span>
                      ). Locked amount:{' '}
                      <b className="text-[#ffd958] font-mono">${totals.usd.toFixed(2)} USD</b>.
                    </p>

                    {!paypalState ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleCreatePayPalOrder}
                        className="yb rounded-full h-10 w-full text-[13px] font-bold inline-flex items-center justify-center gap-2"
                      >
                        {busy ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CreditCard className="w-4 h-4" />
                        )}
                        Create PayPal Order · ${totals.usd.toFixed(2)} USD
                      </button>
                    ) : (
                      <div className="rounded-xl bg-[#040d29] border border-[#2f8bff] p-3.5 space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[#1ea0ff]">PayPal Order Created</span>
                          <span className="font-mono text-[#ffd958]">
                            {paypalState.paypalOrderId}
                          </span>
                        </div>
                        <p className="text-[11.5px] text-[#c8d3ea] leading-relaxed">
                          PayPal order <span className="font-mono text-[#ffd958]">{paypalState.paypalOrderId}</span> is initialized inside Playbeat Checkout. Confirm capture below to issue your order immediately.
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleCapturePayPalOrder}
                          className="yb rounded-full h-9 w-full text-xs font-bold inline-flex items-center justify-center gap-1.5"
                        >
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          Confirm PayPal Payment &amp; Fulfill Order
                        </button>
                      </div>
                    )}

                    <p className="text-[11px] text-[#c8d3ea] text-center flex items-center justify-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-[#1ea0ff]" />
                      Processed by PayPal — Playbeat Digital never sees your card details.
                    </p>
                  </div>
                )}

                {/* ── TAB 3: MANUAL PAYMENT ── */}
                {activeRail === 'manual' && (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl bg-[#040d29aa] border border-[#1d4ed866] p-3 text-xs text-[#c8d3ea] space-y-1.5">
                      <p className="font-bold text-[#ffd958]">Manual Transfer Instructions</p>
                      <p>
                        Send <b className="text-[#f2f6ff]">${totals.usd.toFixed(2)} USD</b> or{' '}
                        <b className="text-[#f2f6ff]">₨{totals.pkr.toLocaleString()} PKR</b> via your preferred rail, then submit your transfer reference below for verification.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                        Manual Payment Channel
                      </label>
                      <select
                        value={manualChannel}
                        onChange={(e) => setManualChannel(e.target.value as ManualChannel)}
                        className="pb-input px-3 py-2 text-xs"
                      >
                        <option value="Bank Transfer (IBAN)" className="bg-[#051239]">
                          Bank Transfer (IBAN / Raast)
                        </option>
                        <option value="JazzCash Manual" className="bg-[#051239]">
                          JazzCash Manual Transfer
                        </option>
                        <option value="Easypaisa Manual" className="bg-[#051239]">
                          Easypaisa Manual Transfer
                        </option>
                        <option value="Crypto (USDT)" className="bg-[#051239]">
                          Crypto (USDT TRC-20)
                        </option>
                      </select>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                          Sender Account / Name
                        </label>
                        <input
                          type="text"
                          value={manualSenderAccount}
                          onChange={(e) => setManualSenderAccount(e.target.value)}
                          placeholder="Account title or mobile"
                          className="pb-input px-3 py-2 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                          Transfer Reference / TID
                        </label>
                        <input
                          type="text"
                          value={manualReference}
                          onChange={(e) => setManualReference(e.target.value)}
                          placeholder="e.g. TXN-982341"
                          className="pb-input px-3 py-2 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSubmitManualOrder}
                      className="yb rounded-full h-10 w-full text-[13px] font-bold inline-flex items-center justify-center gap-2"
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Submit Manual Order for Verification
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
