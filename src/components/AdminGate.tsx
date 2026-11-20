import { AlertCircle, ArrowLeft, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { adminLogin, setAdminToken } from '../lib/adminAuth';

interface AdminGateProps {
  onUnlocked: () => void;
  onBackToStorefront: () => void;
}

/**
 * Password gate rendered at /admin before the admin panel mounts.
 * Verifies the password against POST /api/admin/login and stores the
 * signed session token for subsequent admin API calls.
 */
export function AdminGate({ onUnlocked, onBackToStorefront }: AdminGateProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const { token } = await adminLogin(password.trim());
      setAdminToken(token);
      setPassword('');
      onUnlocked();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Admin sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-16 bg-[#030a1f]">
      <div className="w-full max-w-sm">
        <div className="edge-solid rounded-2xl bg-[#040d29]/90 p-7">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-[#07163f] border border-[#1ea0ff] grid place-items-center text-[#ffd958]">
              <LockKeyhole className="w-7 h-7" />
            </div>
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-[#ffc928]">
                Playbeat Digital
              </p>
              <h1 className="text-xl font-extrabold text-[#f2f6ff] leading-tight mt-1">
                Admin Control Room
              </h1>
              <p className="text-[11px] text-[#9eb2db] mt-1.5 leading-relaxed">
                This area is password protected. Enter the admin password to manage products,
                services, LIVE TV and orders.
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-5 rounded-xl bg-rose-500/15 border border-rose-500/50 p-3 text-xs text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <label htmlFor="pb-admin-password" className="block text-[11px] font-semibold text-[#c8d3ea]">
              Admin Password
            </label>
            <input
              id="pb-admin-password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password"
              className="pb-input w-full px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !password.trim()}
              className="yb w-full h-10 rounded-full text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  Unlock Admin Panel
                </>
              )}
            </button>
          </form>

          <button
            type="button"
            onClick={onBackToStorefront}
            className="mt-5 w-full text-[11px] font-semibold text-[#9eb2db] hover:text-[#ffd958] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Playbeat Storefront
          </button>
        </div>

        <p className="mt-4 text-[10px] text-center text-[#55688f] leading-relaxed">
          Sessions expire automatically after 12 hours. Failed attempts are rate limited.
        </p>
      </div>
    </div>
  );
}
