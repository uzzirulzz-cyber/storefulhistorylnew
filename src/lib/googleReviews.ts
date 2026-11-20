/**
 * Google Customer Reviews — survey opt-in (Merchant Center program).
 *
 * Merchant Center snippet integrated with real order data. The survey
 * opt-in module MUST be rendered on the order confirmation page only,
 * AFTER the customer completes checkout (Google program policy).
 *
 * Rendered dynamically on the SPA confirmation screen:
 *   renderGoogleSurveyOptIn(order)  →  injects platform.js once, then calls
 *   gapi.surveyoptin.render() with the live order fields.
 */

import type { OrderRecord } from '../types/store';

const GOOGLE_MERCHANT_ID = 5847422419;
const PLATFORM_JS_URL = 'https://apis.google.com/js/platform.js?onload=pbRenderGoogleOptIn';

let platformScriptRequested = false;
let pendingOrder: OrderRecord | null = null;

declare global {
  interface Window {
    gapi?: {
      load: (apiName: string, callback: () => void) => void;
      surveyoptin?: { render: (config: Record<string, unknown>) => void };
    };
    pbRenderGoogleOptIn?: () => void;
  }
}

interface SurveyOptInConfig {
  merchant_id: number;
  order_id: string;
  email: string;
  delivery_country: string;
  estimated_delivery_date: string;
  [key: string]: unknown;
  // Optional GTIN list omitted: Playbeat catalog items carry no GTINs
  // (feed items ship with identifier_exists=no).
}

/** Best-available delivery country proxy: mobile country code, else order currency. */
function deliveryCountryFor(order: OrderRecord): string {
  const mobile = (order.customerMobile || '').replace(/[\s()-]/g, '');
  if (mobile.startsWith('+92') || mobile.startsWith('92')) return 'PK';
  return order.currency === 'PKR' ? 'PK' : 'US';
}

/** Digital keys are delivered instantly — ETA = fulfillment time + 2-day safety margin. */
function estimatedDeliveryDate(order: OrderRecord): string {
  const baseMs = Date.parse(order.updatedAt || order.createdAt) || Date.now();
  const eta = new Date(baseMs + 2 * 24 * 60 * 60 * 1000);
  return eta.toISOString().slice(0, 10);
}

function renderOptIn(order: OrderRecord): void {
  const config: SurveyOptInConfig = {
    merchant_id: GOOGLE_MERCHANT_ID,
    order_id: order.orderId,
    email: order.customerEmail,
    delivery_country: deliveryCountryFor(order),
    estimated_delivery_date: estimatedDeliveryDate(order),
  };
  window.gapi?.load('surveyoptin', () => {
    window.gapi?.surveyoptin?.render(config);
  });
}

/**
 * Call once the order confirmation screen is shown for a PAID_FULFILLED order.
 * Safe to call repeatedly: platform.js is injected at most once, and the
 * pending order is replaced by the most recent checkout confirmation.
 */
export function renderGoogleSurveyOptIn(order: OrderRecord): void {
  if (!order || !order.customerEmail || !order.orderId) return;

  if (window.gapi) {
    renderOptIn(order);
    return;
  }

  pendingOrder = order;
  if (!platformScriptRequested) {
    platformScriptRequested = true;
    window.pbRenderGoogleOptIn = () => {
      if (pendingOrder) renderOptIn(pendingOrder);
    };
    const script = document.createElement('script');
    script.src = PLATFORM_JS_URL;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }
}
