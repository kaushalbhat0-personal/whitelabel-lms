'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { verifyCertificate } from '@/lib/api/certificates';
import { getPublicBusinessConfig } from '@/lib/api/business-config';
import { formatDate } from '@/lib/utils';
import { CheckCircle2, BadgeCheck, AlertTriangle, XCircle, Loader2 } from 'lucide-react';

type VerifyStatus = 'verified' | 'already_verified' | 'expired' | 'invalid';

interface VerifyResponse {
  status: VerifyStatus;
  certificate?: {
    id: string;
    number?: string;
    studentName: string;
    courseName: string;
    issueDate: string;
  };
  verifiedAt?: string;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'verified'; data: VerifyResponse }
  | { kind: 'already_verified'; data: VerifyResponse }
  | { kind: 'expired' }
  | { kind: 'invalid' | 'error' };

function VerifyCertificateContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [businessName, setBusinessName] = useState('LMS Platform');
  const [view, setView] = useState<ViewState>({ kind: 'loading' });

  useEffect(() => {
    getPublicBusinessConfig()
      .then((cfg) => {
        if (cfg.business_name) setBusinessName(cfg.business_name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) {
      setView({ kind: 'invalid' });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const data = (await verifyCertificate(token)) as unknown as VerifyResponse;

        if (cancelled) return;

        switch (data.status) {
          case 'verified':
            setView({ kind: 'verified', data });
            break;
          case 'already_verified':
            setView({ kind: 'already_verified', data });
            break;
          case 'expired':
            setView({ kind: 'expired' });
            break;
          default:
            setView({ kind: 'invalid' });
        }
      } catch {
        if (!cancelled) {
          setView({ kind: 'error' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-card border border-surface-border bg-surface-card p-8 shadow-card text-center">

          {view.kind === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-10 w-10 animate-spin" style={{ color: 'var(--brand-sidebar)' }} />
              <p className="text-sm text-text-secondary">Verifying certificate...</p>
            </div>
          )}

          {view.kind === 'verified' && view.data.certificate && (
            <div className="flex flex-col items-center gap-3 animate-fade-in">
              <CheckCircle2 className="h-14 w-14 text-green-500" />
              <h1 className="text-xl font-bold text-text-primary">Certificate Verified</h1>
              <div className="w-full mt-3 space-y-2 text-left">
                <DetailRow
                  label="Certificate Number"
                  value={view.data.certificate.number || view.data.certificate.id}
                />
                <DetailRow label="Student Name" value={view.data.certificate.studentName} />
                <DetailRow label="Course" value={view.data.certificate.courseName} />
                <DetailRow label="Issue Date" value={formatDate(view.data.certificate.issueDate)} />
              </div>
              <p className="mt-4 text-sm text-text-secondary">
                This certificate has been verified as authentic.
              </p>
            </div>
          )}

          {view.kind === 'already_verified' && view.data.certificate && (
            <div className="flex flex-col items-center gap-3 animate-fade-in">
              <BadgeCheck className="h-14 w-14 text-blue-500" />
              <h1 className="text-xl font-bold text-text-primary">Certificate Previously Verified</h1>
              <div className="w-full mt-3 space-y-2 text-left">
                <DetailRow
                  label="Certificate Number"
                  value={view.data.certificate.number || view.data.certificate.id}
                />
                <DetailRow label="Student Name" value={view.data.certificate.studentName} />
                <DetailRow label="Course" value={view.data.certificate.courseName} />
                <DetailRow label="Issue Date" value={formatDate(view.data.certificate.issueDate)} />
              </div>
              {view.data.verifiedAt && (
                <p className="text-xs text-text-muted">
                  First verified: {formatDate(view.data.verifiedAt)}
                </p>
              )}
            </div>
          )}

          {view.kind === 'expired' && (
            <div className="flex flex-col items-center gap-3 animate-fade-in">
              <AlertTriangle className="h-14 w-14 text-amber-500" />
              <h1 className="text-xl font-bold text-text-primary">Verification Link Expired</h1>
              <p className="text-sm text-text-secondary">
                This verification link is no longer valid. The certificate may have expired or
                the link has been used.
              </p>
            </div>
          )}

          {(view.kind === 'invalid' || view.kind === 'error') && (
            <div className="flex flex-col items-center gap-3 animate-fade-in">
              <XCircle className="h-14 w-14 text-red-500" />
              <h1 className="text-xl font-bold text-text-primary">Invalid Verification Link</h1>
              <p className="text-sm text-text-secondary">
                This link does not appear to be valid. Please check the URL and try again.
              </p>
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-surface-border">
            <p className="text-xs text-text-muted">
              Powered by{' '}
              <span className="font-semibold" style={{ color: 'var(--brand-sidebar)' }}>
                {businessName}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-4 py-2.5">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-text-primary mt-0.5">{value}</p>
    </div>
  );
}

export default function VerifyCertificatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
          <div className="w-full max-w-md">
            <div className="rounded-card border border-surface-border bg-surface-card p-8 shadow-card text-center">
              <div className="flex flex-col items-center gap-4 py-8">
                <Loader2 className="h-10 w-10 animate-spin" style={{ color: 'var(--brand-sidebar)' }} />
                <p className="text-sm text-text-secondary">Loading...</p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <VerifyCertificateContent />
    </Suspense>
  );
}
