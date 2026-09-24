'use client';

import { useState } from 'react';
import { markInstallmentPaid } from '@/lib/api/payments';
import { formatCurrency } from '@/lib/format-currency';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

interface MarkPaidModalProps {
  installmentId: string;
  installmentNumber: number;
  amount: number;
  onClose: () => void;
  onConfirm: () => void;
}

export function MarkPaidModal({
  installmentId,
  installmentNumber,
  amount,
  onClose,
  onConfirm,
}: MarkPaidModalProps) {
  const { currency, locale } = useBusinessConfig();
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [transactionId, setTransactionId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await markInstallmentPaid(
        installmentId,
        { paymentMethod, transactionId: transactionId || undefined },
      );
      onConfirm();
    } catch (err: any) {
      setError(err.message || 'Failed to mark installment as paid');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg bg-gray-50 p-3 text-sm">
        <p>
          Installment <strong>#{installmentNumber}</strong> —{' '}
          <strong>{formatCurrency(amount, currency, locale)}</strong>
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Payment Method
        </label>
        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Transaction ID (optional)
        </label>
        <input
          type="text"
          value={transactionId}
          onChange={(e) => setTransactionId(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="e.g. UPI123456"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {submitting ? 'Processing...' : 'Confirm Payment'}
        </button>
      </div>
    </form>
  );
}
