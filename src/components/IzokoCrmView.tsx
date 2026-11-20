/**
 * Izoko CRM Console — merged into the Playbeat admin panel.
 *
 * Port of the izoko admin dashboard (KPI metrics + CRM lead pipeline +
 * digital catalog browser) bound to the live Playbeat KV catalog and the
 * /api/admin/inquiries PATCH pipeline. Admin-only: rendered exclusively
 * inside AdminPanelView at /admin — never on the buyer storefront.
 */

import { BadgeCheck, Bot, Briefcase, ExternalLink, Flame, Gamepad2, Inbox, LayoutGrid, Package, Search, Tv } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BusinessService, LiveTvChannel, LiveTvPlan, Product, ServiceInquiry } from '../types/store';

const PIPELINE: ServiceInquiry['status'][] = ['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'];

const PIPELINE_LABEL: Record<ServiceInquiry['status'], string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUOTED: 'Quoted',
  WON: 'Won',
  LOST: 'Lost',
};

const STATUS_STYLE: Record<ServiceInquiry['status'], string> = {
  NEW: 'bg-[#1ea0ff]/15 border-[#1ea0ff]/50 text-[#7fb8ff]',
  CONTACTED: 'bg-[#ffd958]/15 border-[#ffd958]/50 text-[#ffd958]',
  QUOTED: 'bg-[#a78bfa]/15 border-[#a78bfa]/50 text-[#c4b5fd]',
  WON: 'bg-[#22c55e]/15 border-[#22c55e]/50 text-[#86efac]',
  LOST: 'bg-[#ef4444]/15 border-[#ef4444]/50 text-[#fca5a5]',
};

const BROWSER_PAGE_SIZE = 40;

interface IzokoCrmViewProps {
  digitalProducts: Product[];
  businessServices: BusinessService[];
  liveTvChannels: LiveTvChannel[];
  liveTvPlans: LiveTvPlan[];
  serviceInquiries: ServiceInquiry[];
  onInquiryStatusChange: (id: string, status: ServiceInquiry['status']) => Promise<void>;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function stockBadge(status: Product['stockStatus']): string {
  if (status === 'In Stock') return 'bg-[#22c55e]/10 border-[#22c55e]/40 text-[#86efac]';
  if (status === 'Low Stock') return 'bg-[#ffd958]/10 border-[#ffd958]/40 text-[#ffd958]';
  return 'bg-[#ef4444]/10 border-[#ef4444]/40 text-[#fca5a5]';
}

export function IzokoCrmView({
  digitalProducts,
  businessServices,
  liveTvChannels,
  liveTvPlans,
  serviceInquiries,
  onInquiryStatusChange,
}: IzokoCrmViewProps) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const published = useMemo(() => digitalProducts.filter((p) => p.published !== false), [digitalProducts]);
  const inStock = useMemo(() => published.filter((p) => p.stockStatus === 'In Stock').length, [published]);
  const under25 = useMemo(() => published.filter((p) => p.priceUsd > 0 && p.priceUsd <= 25).length, [published]);
  const deals40plus = useMemo(() => published.filter((p) => p.discountPercent >= 40).length, [published]);
  const openLeads = useMemo(
    () => serviceInquiries.filter((i) => i.status === 'NEW' || i.status === 'CONTACTED').length,
    [serviceInquiries],
  );

  const kpis = [
    { icon: Gamepad2, label: 'Digital products', value: digitalProducts.length.toLocaleString(), sub: `${published.length.toLocaleString()} published live` },
    { icon: Package, label: 'In stock now', value: inStock.toLocaleString(), sub: `${under25.toLocaleString()} keys under $25` },
    { icon: Flame, label: 'Deals 40%+', value: deals40plus.toLocaleString(), sub: 'heavy-discount catalog' },
    { icon: Briefcase, label: 'Business services', value: String(businessServices.length), sub: 'Section 2 packages' },
    { icon: Tv, label: 'Live TV channels', value: String(liveTvChannels.length), sub: `${liveTvPlans.length} Xtream plans` },
    { icon: Inbox, label: 'CRM leads', value: String(serviceInquiries.length), sub: `${openLeads} open` },
  ];

  const leads = useMemo(
    () => [...serviceInquiries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [serviceInquiries],
  );

  const matches = useMemo(() => {
    if (!search) return [];
    return digitalProducts.filter((p) => {
      const haystack = `${p.name} ${p.sku} ${p.publicCode || ''} ${p.platform} ${p.region} ${p.category}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [digitalProducts, search]);
  const visibleMatches = matches.slice(0, BROWSER_PAGE_SIZE);

  const updateStatus = async (inquiry: ServiceInquiry, status: ServiceInquiry['status']) => {
    if (status === inquiry.status) return;
    setPendingId(inquiry.id);
    try {
      await onInquiryStatusChange(inquiry.id, status);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── KPI cards ── */}
      <section aria-label="Izoko key metrics" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="edge rounded-xl p-4">
            <Icon className="w-4 h-4 text-[#1ea0ff]" />
            <p className="text-xl font-extrabold text-[#f2f6ff] tabular-nums mt-2">{value}</p>
            <p className="text-[10.5px] font-bold text-[#c8d3ea] mt-0.5">{label}</p>
            <p className="text-[9.5px] text-[#9eb2db] mt-0.5 truncate">{sub}</p>
          </div>
        ))}
      </section>

      {/* ── CRM · lead pipeline ── */}
      <section aria-label="CRM leads">
        <h2 className="text-base font-extrabold text-[#f2f6ff] flex items-center gap-2">
          <Inbox className="w-4 h-4 text-[#ffd958]" />
          Izoko CRM · Service quote requests
          <span className="text-[11px] font-mono text-[#9eb2db]">({leads.length})</span>
        </h2>
        {leads.length === 0 ? (
          <div className="edge rounded-xl p-6 mt-3 text-center">
            <Bot className="w-8 h-8 text-[#1ea0ff55] mx-auto" />
            <p className="text-[12.5px] text-[#c8d3ea] mt-2">
              No leads yet. Quote requests from Section 2 business services land here automatically.
            </p>
          </div>
        ) : (
          <div className="edge rounded-xl mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12px] min-w-[720px]">
              <thead>
                <tr className="border-b border-[#1d4ed855] text-[10px] uppercase tracking-wide text-[#9eb2db]">
                  <th className="px-3 py-2.5 font-bold">Received</th>
                  <th className="px-3 py-2.5 font-bold">Lead</th>
                  <th className="px-3 py-2.5 font-bold">Service</th>
                  <th className="px-3 py-2.5 font-bold">Message</th>
                  <th className="px-3 py-2.5 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((i) => (
                  <tr key={i.id} className="border-b border-[#1d4ed833] last:border-0 align-top">
                    <td className="px-3 py-2.5 text-[#9eb2db] font-mono text-[10.5px] whitespace-nowrap">
                      {new Date(i.createdAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-[#f2f6ff]">{i.customerName}</p>
                      <p className="text-[11px] text-[#1ea0ff]">{i.customerEmail}</p>
                      {i.customerPhone && <p className="text-[10.5px] text-[#9eb2db]">{i.customerPhone}</p>}
                      {i.companyName && <p className="text-[10.5px] text-[#9eb2db]">{i.companyName}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-[#f2f6ff] font-semibold">{i.serviceName}</p>
                      <span className="text-[10px] font-mono text-[#9eb2db]">{i.id}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[#c8d3ea] max-w-[260px]">
                      {i.notes || <span className="text-[#5a6f9b]">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={i.status}
                        disabled={pendingId === i.id}
                        onChange={(e) => void updateStatus(i, e.target.value as ServiceInquiry['status'])}
                        aria-label={`Pipeline status for lead from ${i.customerName}`}
                        className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold border cursor-pointer focus:outline-2 focus:outline-[#ffc928] disabled:opacity-60 ${STATUS_STYLE[i.status] || 'border-[#1d4ed888] text-[#f2f6ff] bg-[#030a1fe6]'}`}
                      >
                        {PIPELINE.map((s) => (
                          <option key={s} value={s} className="bg-[#09194b] text-[#f2f6ff]">
                            {PIPELINE_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Digital catalog browser ── */}
      <section aria-label="Digital catalog browser">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-[#f2f6ff] flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-[#ffd958]" />
            Digital catalog browser
            <span className="text-[11px] font-mono text-[#9eb2db]">({matches.length.toLocaleString()} matches)</span>
          </h2>
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#7fa3d9]" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={`Search ${(digitalProducts.length || 0).toLocaleString()}+ products…`}
              aria-label="Search digital products"
              className="w-full h-9 rounded-full bg-[#030a1fe6] border border-[#1d4ed888] pl-8 pr-3 text-[12.5px] text-[#f2f6ff] placeholder:text-[#7fa3d9] focus:outline-2 focus:outline-[#ffc928]"
            />
          </div>
        </div>

        {search && (
          <div className="edge rounded-xl mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12px] min-w-[760px]">
              <thead>
                <tr className="border-b border-[#1d4ed855] text-[10px] uppercase tracking-wide text-[#9eb2db]">
                  <th className="px-3 py-2.5 font-bold">Code</th>
                  <th className="px-3 py-2.5 font-bold">Product</th>
                  <th className="px-3 py-2.5 font-bold">Group</th>
                  <th className="px-3 py-2.5 font-bold">Price</th>
                  <th className="px-3 py-2.5 font-bold">Stock</th>
                  <th className="px-3 py-2.5 font-bold">Supplier</th>
                </tr>
              </thead>
              <tbody>
                {visibleMatches.map((p) => (
                  <tr key={p.sku} className="border-b border-[#1d4ed833] last:border-0">
                    <td className="px-3 py-2 font-mono text-[10.5px] text-[#9eb2db] whitespace-nowrap">
                      {p.publicCode || p.sku.slice(0, 12)}
                    </td>
                    <td className="px-3 py-2 text-[#f2f6ff] font-semibold max-w-[320px] truncate">{p.name}</td>
                    <td className="px-3 py-2 text-[#c8d3ea] text-[11px]">
                      {p.category}
                      <span className="text-[#5a6f9b]"> · {p.platform}</span>
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap">
                      <span className="text-[#ffd958] font-bold">{usd(p.priceUsd)}</span>
                      {p.discountPercent > 0 && (
                        <span className="text-[10px] text-[#9eb2db] ml-1.5">-{p.discountPercent}%</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${stockBadge(p.stockStatus)}`}>
                        {p.stockStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={p.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#1ea0ff] font-bold inline-flex items-center gap-1 hover:underline"
                      >
                        EF
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
                {visibleMatches.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-[#9eb2db]">
                      No products match &ldquo;{search}&rdquo;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {matches.length > visibleMatches.length && (
              <p className="px-3 py-2.5 text-[10.5px] text-[#9eb2db] border-t border-[#1d4ed855]">
                Showing first {BROWSER_PAGE_SIZE} of {matches.length.toLocaleString()} matches — refine the search to narrow down.
              </p>
            )}
          </div>
        )}
        <p className="text-[10.5px] text-[#9eb2db] mt-2 flex items-center gap-1.5">
          <BadgeCheck className="w-3.5 h-3.5 text-[#1ea0ff]" />
          Supplier prices mirrored from ElectronicFirst at extraction time — re-sync through the Worldwide Extraction tab for live rates.
        </p>
      </section>
    </div>
  );
}
