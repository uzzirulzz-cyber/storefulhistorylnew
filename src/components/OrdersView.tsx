import {
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { adminFetch } from '../lib/adminAuth';
import type { OrderRecord } from '../types/store';

interface OrdersViewProps {
  orders: OrderRecord[];
  onRefreshOrders: () => Promise<void>;
  onOrderUpdated: (order: OrderRecord) => void;
  onShowToast: (msg: string) => void;
}

export function OrdersView({
  orders,
  onRefreshOrders,
  onOrderUpdated,
  onShowToast,
}: OrdersViewProps) {
  const [filterRail, setFilterRail] = useState<'ALL' | 'rapid' | 'paypal' | 'manual'>('ALL');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const visibleOrders = orders.filter((o) => (filterRail === 'ALL' ? true : o.paymentRail === filterRail));

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefreshOrders();
    setRefreshing(false);
    onShowToast('Orders desk refreshed.');
  };

  const handleApproveManual = async (orderId: string) => {
    setBusyOrderId(orderId);
    try {
      const res = await adminFetch(`/api/orders/${encodeURIComponent(orderId)}/approve-manual`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approval failed');
      onOrderUpdated(data.order);
      onShowToast(`Order ${orderId} approved & Worldwide keys dispatched.`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Approval error');
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleVerifyRapid = async (order: OrderRecord) => {
    if (!order.rapidSessionId) return;
    setBusyOrderId(order.orderId);
    try {
      const res = await fetch(`/api/rapid/session-status/${encodeURIComponent(order.rapidSessionId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rapid verification failed');
      onOrderUpdated(data.order);
      onShowToast(`Rapid session verified: ${data.gatewayStatus}`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Verification error');
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleSimulateWebhook = async (order: OrderRecord) => {
    if (!order.rapidSessionId) return;
    setBusyOrderId(order.orderId);
    try {
      const res = await fetch('/api/rapid/simulate-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: order.rapidSessionId,
          eventType: 'transaction.completed',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Webhook delivery failed');
      await onRefreshOrders();
      onShowToast(`Signed Rapid webhook processed for ${order.orderId}.`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Webhook failed');
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleCapturePayPal = async (order: OrderRecord) => {
    if (!order.paypalOrderId) return;
    setBusyOrderId(order.orderId);
    try {
      const res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paypalOrderId: order.paypalOrderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PayPal capture failed');
      onOrderUpdated(data.order);
      onShowToast(`PayPal order ${order.paypalOrderId} captured & keys issued.`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Capture error');
    } finally {
      setBusyOrderId(null);
    }
  };

  const copyKey = (key: string) => {
    void navigator.clipboard?.writeText(key);
    onShowToast('Digital key copied to clipboard.');
  };

  return (
    <main className="max-w-[1180px] mx-auto px-4 sm:px-6 py-8 space-y-5">
      <div className="edge rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-[#ffc928] text-[11px] font-bold tracking-wider uppercase">
            Playbeat Digital · Merchant Operations
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold mt-1">
            Orders &amp; <span className="text-[#1ea0ff]">Key Fulfillment Desk</span>
          </h1>
          <p className="text-xs text-[#c8d3ea] mt-1">
            Approve Manual transfers, verify Rapid Gateway PKR sessions, capture PayPal USD orders, and dispatch ElectronicFirst Partner API keys.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', 'rapid', 'paypal', 'manual'] as const).map((rail) => (
            <button
              key={rail}
              type="button"
              onClick={() => setFilterRail(rail)}
              className={`rounded-full px-3.5 h-8 text-[11px] font-bold uppercase cursor-pointer transition-colors ${
                filterRail === rail
                  ? 'bg-[#1ea0ff] text-[#030a1f]'
                  : 'border border-[#2154d4] bg-[#061236] text-[#c8d3ea] hover:text-white'
              }`}
            >
              {rail}
            </button>
          ))}
          <button
            type="button"
            disabled={refreshing}
            onClick={handleRefresh}
            className="yb rounded-full px-4 h-8 text-[11px] font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {visibleOrders.length === 0 ? (
        <div className="edge rounded-2xl p-10 text-center">
          <KeyRound className="w-10 h-10 mx-auto text-[#ffd958] mb-3" />
          <h2 className="text-base font-extrabold text-[#f2f6ff]">No orders recorded yet</h2>
          <p className="text-xs text-[#c8d3ea] mt-1.5 max-w-md mx-auto">
            Add any ElectronicFirst Worldwide key to your cart and check out via Rapid Gateway PKR, PayPal USD, or Manual payment to manage fulfillment here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleOrders.map((order) => {
            const isFulfilled = order.status === 'PAID_FULFILLED';
            const isFailed = order.status === 'FAILED' || order.status === 'EXPIRED';
            const isBusy = busyOrderId === order.orderId;

            return (
              <article key={order.orderId} className="edge rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1d4ed855] pb-3.5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-extrabold text-sm text-[#ffd958]">
                        {order.orderId}
                      </span>
                      <span className="rounded-full bg-[#0b2a8a] border border-[#2f8bff] px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#f2f6ff]">
                        {order.paymentRail === 'rapid'
                          ? `Rapid Gateway PKR (${order.rapidEnvironment || 'TEST'})`
                          : order.paymentRail === 'paypal'
                            ? 'PayPal USD'
                            : `Manual · ${order.manualChannel || 'Transfer'}`}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          isFulfilled
                            ? 'bg-emerald-500/15 border border-emerald-400/50 text-emerald-300'
                            : isFailed
                              ? 'bg-rose-500/15 border border-rose-400/50 text-rose-300'
                              : 'bg-[#ffd958]/15 border border-[#ffd958]/50 text-[#ffd958]'
                        }`}
                      >
                        {isFulfilled ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : isFailed ? (
                          <XCircle className="w-3 h-3" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        {order.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#c8d3ea] mt-1.5">
                      Buyer: <b className="text-[#f2f6ff]">{order.customerEmail}</b>
                      {order.customerMobile ? ` · ${order.customerMobile}` : ''} ·{' '}
                      {new Date(order.createdAt).toLocaleString()}
                    </p>
                    <p className="text-[11.5px] text-[#9eb2db] mt-1">{order.statusDetail}</p>
                  </div>

                  <div className="text-right font-mono tabular-nums">
                    <div className="text-lg font-extrabold text-[#ffd958]">
                      ₨{order.totalPkr.toLocaleString()} PKR
                    </div>
                    <div className="text-xs text-[#c8d3ea]">${order.totalUsd.toFixed(2)} USD</div>
                  </div>
                </div>

                {/* Items */}
                <div className="grid sm:grid-cols-2 gap-2">
                  {order.items.map((item) => (
                    <div
                      key={`${order.orderId}-${item.sku}`}
                      className="rounded-xl bg-[#040d29aa] border border-[#1d4ed855] px-3 py-2 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[#f2f6ff] truncate">{item.name}</p>
                        <p className="text-[10.5px] text-[#9eb2db] font-mono">
                          {item.sku} · Qty {item.quantity} · {item.platform}
                        </p>
                      </div>
                      <span className="font-mono font-bold text-[#ffd958] ml-2">
                        ${(item.unitPriceUsd * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Issued Digital Keys */}
                {order.issuedKeys.length > 0 && (
                  <div className="rounded-xl bg-[#040d29] border border-emerald-500/40 p-3.5 space-y-2">
                    <p className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5" />
                      Delivered Digital Keys ({order.issuedKeys.length})
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {order.issuedKeys.map((k, idx) => (
                        <div
                          key={`${k.keyCode}-${idx}`}
                          className="rounded-lg bg-[#071640] border border-[#2154d4] px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-[#f2f6ff] truncate">
                              {k.productName}
                            </p>
                            <p className="font-mono text-xs font-bold text-[#ffd958] select-all">
                              {k.keyCode}
                            </p>
                            <p className="text-[10px] text-[#c8d3ea]">{k.source}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyKey(k.keyCode)}
                            className="ob rounded-lg p-1.5 text-[#1ea0ff] hover:bg-[#0b2a8a] cursor-pointer"
                            aria-label="Copy key"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Merchant Actions */}
                {!isFulfilled && (
                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    {order.paymentRail === 'manual' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleApproveManual(order.orderId)}
                        className="yb rounded-full px-5 h-8 text-xs font-bold inline-flex items-center gap-1.5"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                        Verify Manual Transfer &amp; Dispatch Keys
                      </button>
                    )}

                    {order.paymentRail === 'rapid' && order.rapidSessionId && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleVerifyRapid(order)}
                          className="yb rounded-full px-5 h-8 text-xs font-bold inline-flex items-center gap-1.5"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          Verify Rapid Session
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleSimulateWebhook(order)}
                          className="ob rounded-full px-4 h-8 text-xs font-bold bg-[#061236] hover:bg-[#0b2a8a] inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-[#1ea0ff]" />
                          Simulate Signed Webhook
                        </button>
                      </>
                    )}

                    {order.paymentRail === 'paypal' && order.paypalOrderId && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleCapturePayPal(order)}
                        className="yb rounded-full px-5 h-8 text-xs font-bold inline-flex items-center gap-1.5"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Capture PayPal Order ({order.paypalOrderId})
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
