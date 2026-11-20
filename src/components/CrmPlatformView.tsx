/**
 * CRM Platform launcher — the proper PlayBeat CRM platform
 * (playbeat-crm-platform: leads, campaigns, WhatsApp, telephony, inbox,
 * licensing, users, audit logs) running as a dedicated Cloudflare Worker
 * with a D1 database. This tab links to the console and shows live health.
 */

import { CheckCircle2, ExternalLink, KeyRound, PhoneCall, RefreshCw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const CRM_BASE = 'https://playbeat-crm.uzzirulzz.workers.dev';
const CRM_URL = `${CRM_BASE}/crm`;

interface CrmHealth {
  server: string;
  database: string;
  whatsapp?: string;
  email?: string;
  time?: string;
}

interface CrmPlatformViewProps {
  onShowToast: (msg: string) => void;
}

const FEATURES = [
  'Dashboard · real-time communication analytics',
  'Inbox · unified WhatsApp / email / calls conversations',
  'WhatsApp & Email campaigns with segments + suppression',
  'Leads & Customers · duplicate-checked, scored, assignment',
  'Calls, Dialer, Tasks & Follow-ups for agents',
  'Templates, Messages, Reports, Employees & Users',
  'Integrations (WhatsApp Cloud API, SMTP, telephony) + Audit Logs',
  'Storefront · products, orders, payments, licenses & subscriptions',
];

export function CrmPlatformView({ onShowToast }: CrmPlatformViewProps) {
  const [health, setHealth] = useState<CrmHealth | null>(null);
  const [busy, setBusy] = useState(false);

  const loadHealth = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`${CRM_BASE}/api/health`);
      if (res.ok) setHealth(await res.json());
      else setHealth(null);
    } catch {
      setHealth(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const statusPill = (label: string, value?: string) => {
    const up = value === 'ok' || value === 'CONNECTED' || value === 'DISCONNECTED' || value === 'MOCK';
    const ok = value === 'ok' || value === 'CONNECTED';
    return (
      <div key={label} className="flex items-center justify-between rounded-xl border border-[#1d4ed855] bg-[#06123699] px-3 py-2.5">
        <span className="text-xs font-bold text-[#c8d3ea]">{label}</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${
            ok
              ? 'border-[#22c55e]/50 bg-[#22c55e]/10 text-[#86efac]'
              : up
                ? 'border-[#ffd958]/50 bg-[#ffd958]/10 text-[#ffd958]'
                : 'border-[#ef4444]/50 bg-[#ef4444]/10 text-[#fca5a5]'
          }`}
        >
          {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {value || 'OFFLINE'}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* ── Launch card ── */}
      <div className="edge rounded-2xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl yb grid place-items-center shrink-0">
              <PhoneCall className="w-5 h-5" />
            </span>
            <div>
              <p className="text-lg font-extrabold text-[#f2f6ff] leading-tight">
                PlayBeat <span className="text-[#1ea0ff]">CRM Platform</span>
              </p>
              <p className="text-xs text-[#9eb2db] font-mono mt-0.5">
                playbeat-crm.uzzirulzz.workers.dev · Cloudflare Worker + D1 · admin &amp; communication center
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void loadHealth()}
              disabled={busy}
              className="ob rounded-full px-4 h-9 text-xs font-bold bg-[#061236] hover:bg-[#0b2a8a] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Check Health
            </button>
            <a
              href={CRM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="yb rounded-full px-4 h-9 text-xs font-bold inline-flex items-center gap-1.5"
            >
              Open CRM Console
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {statusPill('Server', health?.server || (busy ? 'checking…' : undefined))}
          {statusPill('D1 Database', health?.database || (busy ? 'checking…' : undefined))}
          {statusPill('WhatsApp Cloud API', health?.whatsapp || 'DISCONNECTED')}
          {statusPill('Email / SMTP', health?.email || undefined)}
        </div>
      </div>

      {/* ── Access ── */}
      <div className="edge rounded-2xl p-5 space-y-3">
        <h2 className="text-base font-extrabold text-[#f2f6ff] flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[#ffd958]" />
          Platform access
        </h2>
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-[#1d4ed855] bg-[#06123699] p-3.5">
            <p className="text-[10px] uppercase tracking-wide text-[#9eb2db] font-bold">Console URL</p>
            <a href={CRM_URL} target="_blank" rel="noopener noreferrer" className="text-[#1ea0ff] font-mono text-[12px] hover:underline break-all">
              {CRM_URL}
            </a>
            <p className="text-[10px] uppercase tracking-wide text-[#9eb2db] font-bold mt-2.5">Storefront module</p>
            <a href={`${CRM_BASE}/storefront`} target="_blank" rel="noopener noreferrer" className="text-[#1ea0ff] font-mono text-[12px] hover:underline break-all">
              {CRM_BASE}/storefront
            </a>
          </div>
          <div className="rounded-xl border border-[#1d4ed855] bg-[#06123699] p-3.5">
            <p className="text-[10px] uppercase tracking-wide text-[#9eb2db] font-bold">Super admin</p>
            <p className="text-[#f2f6ff] font-mono text-[12px]">admin@playbeat.digital</p>
            <p className="text-[10px] uppercase tracking-wide text-[#9eb2db] font-bold mt-2.5">Role</p>
            <p className="text-[#ffd958] font-mono text-[12px]">SUPER_ADMIN · full platform control</p>
          </div>
        </div>
        <p className="text-[10.5px] text-[#9eb2db]">
          Sessions are independent from this admin gate: the platform uses its own JWT cookie (7-day). Sign in once per browser.
        </p>
      </div>

      {/* ── What's inside ── */}
      <div className="edge rounded-2xl p-5">
        <h2 className="text-base font-extrabold text-[#f2f6ff] mb-3">Inside the platform (21 modules)</h2>
        <ul className="grid sm:grid-cols-2 gap-2 text-xs text-[#c8d3ea]">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#22c55e] mt-0.5 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            onShowToast('Opening PlayBeat CRM platform…');
            window.open(CRM_URL, '_blank', 'noopener,noreferrer');
          }}
          className="yb rounded-full px-4 h-9 text-xs font-bold inline-flex items-center gap-1.5 mt-4"
        >
          Launch CRM →
        </button>
      </div>
    </div>
  );
}
