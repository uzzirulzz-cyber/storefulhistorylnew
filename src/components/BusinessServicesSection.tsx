import {
  Briefcase,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Send,
  ShoppingCart,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BusinessService, ServiceCategory, ServicePackageLevel } from '../types/store';
import type { ActiveView } from './Navbar';
import { ResilientImage } from './ResilientImage';

interface BusinessServicesSectionProps {
  services: BusinessService[];
  globalSearch: string;
  onAddToCart: (sku: string) => void;
  onSelectView: (view: ActiveView) => void;
  onShowToast: (msg: string) => void;
}

const SERVICE_CATEGORIES: Array<'All' | ServiceCategory> = [
  'All',
  'Business Websites',
  'E-Commerce',
  'CRM & Operations',
  'Lead Generation',
  'Real Estate',
  'Education',
  'FinTech / Dashboards',
  'Admin Systems',
  'Automation',
  'Custom Development',
];

const PACKAGE_LEVELS: Array<'All' | ServicePackageLevel> = [
  'All',
  'Basic',
  'Professional',
  'Enterprise',
];

export function BusinessServicesSection({
  services,
  globalSearch,
  onAddToCart,
  onSelectView,
  onShowToast,
}: BusinessServicesSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<'All' | ServiceCategory>('All');
  const [selectedLevel, setSelectedLevel] = useState<'All' | ServicePackageLevel>('All');
  const [showAllServices, setShowAllServices] = useState(true);
  const [inspectedService, setInspectedService] = useState<BusinessService | null>(null);
  const [inquiryService, setInquiryService] = useState<BusinessService | null>(null);

  // Proposal Inquiry Form state
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredServices = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    return services.filter((s) => {
      if (selectedCategory !== 'All' && s.category !== selectedCategory) return false;
      if (selectedLevel !== 'All' && s.packageLevel !== selectedLevel) return false;
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.category.toLowerCase().includes(q) &&
        !s.shortDescription.toLowerCase().includes(q) &&
        !s.deliverables.some((d) => d.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [services, selectedCategory, selectedLevel, globalSearch]);

  const displayedServices = useMemo(() => {
    if (showAllServices || selectedCategory !== 'All' || selectedLevel !== 'All' || globalSearch.trim()) {
      return filteredServices;
    }
    const featured = filteredServices.filter((s) => s.featured);
    return featured.length >= 6 ? featured.slice(0, 6) : filteredServices.slice(0, 6);
  }, [filteredServices, showAllServices, selectedCategory, selectedLevel, globalSearch]);

  // /product/<sku> deep links resolve services too (Google Shopping + shared links)
  useEffect(() => {
    const onInspectService = (e: Event) => {
      const sku = (e as CustomEvent<string>).detail;
      const svc = services.find((x) => x.sku === sku || x.id === sku);
      if (svc) {
        setInspectedService(svc);
        window.requestAnimationFrame(() => {
          document.getElementById('section2-services')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    };
    window.addEventListener('pb-inspect-service', onInspectService);
    return () => window.removeEventListener('pb-inspect-service', onInspectService);
  }, [services]);

  const handleOpenInquiry = (svc: BusinessService) => {
    setInquiryService(svc);
    setInspectedService(null);
  };

  const handleSubmitInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inquiryService) return;
    if (!customerName.trim() || !customerEmail.includes('@')) {
      onShowToast('Please provide your name and a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/services/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: inquiryService.id,
          serviceName: inquiryService.name,
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerPhone: customerPhone.trim(),
          companyName: companyName.trim(),
          notes: notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit proposal request.');

      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setCompanyName('');
      setNotes('');
      setInquiryService(null);
      onShowToast(`Proposal request logged (${data.inquiry.id}). Our team will contact you shortly.`);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Proposal request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    <main className="max-w-[1180px] mx-auto px-4 sm:px-6 pt-6 pb-4">
    <section id="section2-services" className="scroll-mt-20">
      {/* Header Row */}
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="text-[#ffc928] text-[12px] font-bold tracking-wider uppercase flex items-center gap-1.5">
            <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
            PLAYBEAT.DIGITAL/SERVICES · ENTERPRISE AGENCY CATALOG
          </p>
          <h1 className="text-[clamp(1.8rem,5vw,2.6rem)] font-extrabold leading-tight mt-1">
            Business &amp; <span className="text-[#1ea0ff]">Enterprise Solutions</span>
          </h1>
          <p className="mt-1 text-sm font-medium text-[#c8d3ea] max-w-2xl">
            Done-for-you websites, e-commerce platforms, CRM operations, real estate portals, FinTech dashboards, and AI automation systems engineered by Playbeat Digital.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-[#2154d4] bg-[#040d29] p-0.5">
            {PACKAGE_LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setSelectedLevel(lvl)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
                  selectedLevel === lvl
                    ? 'bg-[#1ea0ff] text-[#030a1f]'
                    : 'text-[#c8d3ea] hover:text-white'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowAllServices((v) => !v)}
            className="text-[#1ea0ff] hover:text-[#ffd958] text-[12px] font-bold whitespace-nowrap transition-colors cursor-pointer ml-1"
          >
            {showAllServices && selectedCategory === 'All' && selectedLevel === 'All'
              ? 'Show Top 6 Featured'
              : `View All ${services.length} Services →`}
          </button>
        </div>
      </div>

      {/* Category Filter Strip */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {SERVICE_CATEGORIES.map((cat) => {
          const isActive = selectedCategory === cat;
          const count =
            cat === 'All' ? services.length : services.filter((s) => s.category === cat).length;
          if (cat !== 'All' && count === 0) return null;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setSelectedCategory(cat);
                if (cat !== 'All') setShowAllServices(true);
              }}
              className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold transition-all cursor-pointer ${
                isActive
                  ? 'cat-active text-white border border-[#2f8bff]'
                  : 'border border-[#1d4ed888] bg-[#051239cc] text-[#c8d3ea] hover:border-[#2f8bff] hover:text-white'
              }`}
            >
              {cat}{' '}
              <span className="font-mono text-[10px] opacity-80 ml-0.5">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Services Grid */}
      {displayedServices.length === 0 ? (
        <div className="edge rounded-2xl p-8 mt-5 text-center text-sm">
          <p className="text-[#c8d3ea]">No Playbeat business services match the current filter.</p>
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('All');
              setSelectedLevel('All');
            }}
            className="mt-3 text-[#1ea0ff] font-bold underline cursor-pointer"
          >
            Reset service filters
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
          {displayedServices.map((svc) => (
            <article
              key={svc.id}
              className="edge rounded-2xl overflow-hidden flex flex-col hover:border-[#2f8bff] hover:shadow-[0_0_28px_-6px_rgba(30,160,255,0.45)] transition-all group"
            >
              {/* Visual hero — image-first so the eye lands on the work, not the words */}
              <button
                type="button"
                onClick={() => setInspectedService(svc)}
                className="relative block w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-[#ffc928]"
                aria-label={`Inspect ${svc.name}`}
              >
                <ResilientImage
                  src={svc.imageUrl || ''}
                  alt={`${svc.category} — ${svc.name}`}
                  fallbackLabel={svc.category}
                  className="w-full aspect-[16/10] object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#04102ef2] via-[#04102e2e] to-transparent" />
                <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between gap-2 text-[10.5px] font-bold">
                  <span className="rounded-full bg-[#030a1fb8] backdrop-blur px-2.5 py-1 border border-white/10 text-[#a9dbff] uppercase tracking-wide truncate">
                    {svc.category}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 backdrop-blur border font-mono shrink-0 ${
                      svc.packageLevel === 'Enterprise'
                        ? 'bg-[#ffd958]/25 border-[#ffd958]/60 text-[#ffd958]'
                        : svc.packageLevel === 'Professional'
                          ? 'bg-[#1ea0ff]/25 border-[#1ea0ff]/60 text-[#d6efff]'
                          : 'bg-[#030a1fb8] border-white/10 text-[#c8d3ea]'
                    }`}
                  >
                    {svc.packageLevel}
                  </span>
                </div>
                <div className="absolute bottom-2.5 left-3 right-3">
                  <span className="block text-left font-extrabold text-[15px] text-white leading-snug drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
                    {svc.name}
                  </span>
                </div>
              </button>

              <div className="p-4 flex flex-col flex-1 justify-between">
              <div>
                <p className="text-[12px] text-[#c8d3ea] leading-relaxed line-clamp-2 mt-1">
                  {svc.shortDescription}
                </p>

                {svc.quantifiedOutcome && (
                  <p className="mt-2.5 text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 text-[#ffd958]" />
                    <span>{svc.quantifiedOutcome}</span>
                  </p>
                )}

                <ul className="mt-3 space-y-1.5 border-t border-[#1d4ed844] pt-3">
                  {svc.deliverables.slice(0, 2).map((d) => (
                    <li key={d} className="flex items-start gap-2 text-[11.5px] text-[#d6e1f7]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#ffc928] shrink-0 mt-0.5" />
                      <span className="line-clamp-1">{d}</span>
                    </li>
                  ))}
                  {svc.deliverables.length > 2 && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setInspectedService(svc)}
                        className="text-[11px] font-bold text-[#1ea0ff] hover:underline cursor-pointer"
                      >
                        +{svc.deliverables.length - 2} more deliverables · Inspect scope
                      </button>
                    </li>
                  )}
                </ul>
              </div>

              <div className="mt-4 pt-3.5 border-t border-[#1d4ed855] space-y-3">
                <div className="flex items-end justify-between gap-2">
                  <div className="font-mono tabular-nums">
                    <span className="block text-[10px] uppercase text-[#9eb2db]">
                      {svc.isStartingFrom ? 'Starting from' : 'Fixed Package'}
                    </span>
                    <span className="text-lg font-extrabold text-[#ffd958]">
                      ₨{svc.recommendedPkr.toLocaleString()} PKR
                    </span>
                    <span className="block text-[11px] text-[#c8d3ea]">
                      ≈ ${svc.optionalUsd.toLocaleString()} USD
                    </span>
                  </div>
                  <div className="text-right text-[11px] text-[#c8d3ea] flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#1ea0ff]" />
                    <span>{svc.deliveryTime}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onAddToCart(svc.sku)}
                    className="yb rounded-full h-9 text-[11.5px] font-bold inline-flex items-center justify-center gap-1.5"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Book Now
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenInquiry(svc)}
                    className="ob rounded-full h-9 text-[11.5px] font-bold bg-[#040d29aa] hover:bg-[#0b2a8a] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3 h-3 text-[#1ea0ff]" />
                    Proposal
                  </button>
                </div>
              </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Service Scope Inspection Modal */}
      {inspectedService && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={inspectedService.name}
        >
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setInspectedService(null)}
          />
          <div className="edge-solid relative z-10 w-full max-w-xl rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setInspectedService(null)}
              aria-label="Close scope"
              className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full border border-[#2154d4] grid place-items-center text-[#f2f6ff] hover:text-[#ffd958] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-[11px] font-bold">
              <span className="text-[#1ea0ff] uppercase">{inspectedService.category}</span>
              <span className="rounded-full bg-[#ffd958]/15 border border-[#ffd958]/40 px-2 py-0.5 text-[#ffd958] font-mono">
                {inspectedService.packageLevel}
              </span>
              <span className="text-[#9eb2db] font-mono">{inspectedService.deliveryTime}</span>
            </div>

            {inspectedService.imageUrl && (
              <div className="relative -m-6 mb-4 h-44 overflow-hidden rounded-t-2xl">
                <img
                  src={inspectedService.imageUrl}
                  alt={inspectedService.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#04102e] via-transparent to-transparent" />
              </div>
            )}

            <h3 className="text-xl font-extrabold text-[#f2f6ff] mt-2 pr-8">
              {inspectedService.name}
            </h3>
            <p className="text-xs text-[#c8d3ea] mt-2 leading-relaxed">
              {inspectedService.shortDescription}
            </p>

            {inspectedService.quantifiedOutcome && (
              <div className="mt-3 rounded-xl bg-emerald-500/10 border border-emerald-400/40 px-3.5 py-2.5 text-xs text-emerald-200 font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#ffd958] shrink-0" />
                {inspectedService.quantifiedOutcome}
              </div>
            )}

            <div className="mt-4 rounded-xl bg-[#040d29aa] border border-[#1d4ed866] p-4">
              <p className="text-[11px] font-bold text-[#ffc928] uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                <Layers className="w-3.5 h-3.5" />
                Full Deliverables Included ({inspectedService.deliverables.length})
              </p>
              <ul className="space-y-2">
                {inspectedService.deliverables.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-xs text-[#e6eeff]">
                    <CheckCircle2 className="w-4 h-4 text-[#ffd958] shrink-0 mt-0.5" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-5 pt-4 border-t border-[#1d4ed855] flex flex-wrap items-center justify-between gap-4">
              <div className="font-mono tabular-nums">
                <span className="text-xl font-extrabold text-[#ffd958]">
                  ₨{inspectedService.recommendedPkr.toLocaleString()} PKR
                </span>
                <span className="block text-xs text-[#c8d3ea]">
                  ≈ ${inspectedService.optionalUsd.toLocaleString()} USD
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenInquiry(inspectedService)}
                  className="ob rounded-full px-4 h-9 text-xs font-bold bg-[#061236] hover:bg-[#0b2a8a] cursor-pointer"
                >
                  Request Custom Proposal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAddToCart(inspectedService.sku);
                    setInspectedService(null);
                  }}
                  className="yb rounded-full px-5 h-9 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Book Package
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Proposal Inquiry Modal */}
      {inquiryService && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Request Business Service Proposal"
        >
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-xs"
            onClick={() => setInquiryService(null)}
          />
          <form
            onSubmit={handleSubmitInquiry}
            className="edge-solid relative z-10 w-full max-w-md rounded-2xl p-6 space-y-3.5"
          >
            <button
              type="button"
              onClick={() => setInquiryService(null)}
              aria-label="Close proposal modal"
              className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full border border-[#2154d4] grid place-items-center text-[#f2f6ff] hover:text-[#ffd958] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div>
              <p className="text-[11px] font-bold text-[#ffc928] uppercase tracking-wider">
                Playbeat Digital Business Desk
              </p>
              <h3 className="text-lg font-extrabold text-[#f2f6ff] mt-0.5 pr-8">
                Request Proposal: {inquiryService.name}
              </h3>
              <p className="text-xs text-[#c8d3ea] mt-1 font-mono">
                Estimated Budget: ₨{inquiryService.recommendedPkr.toLocaleString()} PKR ·{' '}
                {inquiryService.deliveryTime}
              </p>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                  Your Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Ayesha Khan"
                  className="pb-input px-3 py-2 text-xs"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                    Business Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="pb-input px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                    WhatsApp / Phone
                  </label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+92 300 1234567"
                    className="pb-input px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                  Company / Brand Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Company or Agency"
                  className="pb-input px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#c8d3ea] mb-1">
                  Project Requirements &amp; Timeline
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Share target launch date, integrations, or custom workflows..."
                  className="pb-input px-3 py-2 text-xs resize-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="yb rounded-full h-10 w-full text-xs font-bold inline-flex items-center justify-center gap-2"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Submit Proposal Inquiry
            </button>
          </form>
        </div>
      )}
    </section>
    </main>

    </>
  );
}
