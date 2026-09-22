'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, ChevronDown, ChevronUp, CheckCircle, Clock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { MarkPaidModal } from './mark-paid-modal';
import { getStudentPlans, type PaymentPlan } from '@/lib/api/payments';

interface StudentLedgerProps {
  students: { id: string; name: string; email: string }[];
}

export function StudentLedger({ students }: StudentLedgerProps) {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [markPaidTarget, setMarkPaidTarget] = useState<{
    id: string;
    number: number;
    amount: number;
  } | null>(null);

  const fetchPlans = useCallback(async () => {
    if (!selectedStudentId) {
      setPlans([]);
      return;
    }
    setLoading(true);
    try {
      const result = await getStudentPlans(selectedStudentId);
      setPlans(result);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [selectedStudentId]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const selectedStudent = students.find((s) => s.id === selectedStudentId);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Student Ledger</h2>
      </div>

      <div className="border-b border-gray-100 px-6 py-4">
        <label className="block text-sm font-medium text-gray-700">
          Select Student
        </label>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select
            value={selectedStudentId}
            onChange={(e) => {
              setSelectedStudentId(e.target.value);
              setExpandedPlanId(null);
            }}
            className="block w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Choose a student...</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedStudentId && (
        <div className="px-6 py-12 text-center text-sm text-gray-400">
          Select a student above to view their payment plans.
        </div>
      )}

      {selectedStudentId && loading && (
        <div className="px-6 py-12 text-center text-sm text-gray-400">
          Loading plans...
        </div>
      )}

      {selectedStudentId && !loading && plans.length === 0 && (
        <div className="px-6 py-12 text-center text-sm text-gray-400">
          No payment plans found for{' '}
          <strong>{selectedStudent?.name}</strong>.
        </div>
      )}

      {selectedStudentId && !loading && plans.length > 0 && (
        <div className="divide-y divide-gray-100">
          {plans.map((plan) => {
            const isExpanded = expandedPlanId === plan.id;
            const totalPaid = plan.installments
              .filter((i) => i.status === 'paid')
              .reduce((sum, i) => sum + i.amount, 0);

            const booking = (plan as any).booking_amount;
            const hasBooking = booking !== null && booking !== undefined;
            const remaining = hasBooking ? (plan.total_amount - booking) : plan.total_amount;
            const stdFee = (plan as any).standard_course_fee;
            const disc = (plan as any).discount_amount ?? 0;

            return (
              <div key={plan.id}>
                {/* Plan summary header */}
                <button
                  onClick={() =>
                    setExpandedPlanId(isExpanded ? null : plan.id)
                  }
                  className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {(plan as any).course?.name ?? 'Course'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {stdFee != null ? (
                        <>Std ₹{Number(stdFee).toFixed(0)} − Disc ₹{Number(disc).toFixed(0)} = </>
                      ) : null}
                      Final ₹{plan.total_amount.toFixed(2)} —{' '}
                      {hasBooking ? (
                        <>Booking ₹{Number(booking).toFixed(2)} · Remaining ₹{remaining.toFixed(2)} · </>
                      ) : null}
                      {plan.installment_count} EMI(s) after booking — Paid EMIs: ₹{totalPaid.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        plan.status === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : plan.status === 'active'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {plan.status}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                </button>

                {/* Expanded booking + EMI schedule (P2: booking independent) */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-6 py-3 space-y-3">
                    {/* Booking summary */}
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-gray-500">Booking Amount</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {hasBooking
                            ? `₹${Number(booking).toFixed(2)} ${Number(booking) === 0 ? '(No booking required)' : ''}`
                            : 'Not configured (legacy plan)'}
                        </p>
                        <p className="text-xs text-gray-400">
                          Independent payment — not EMI #1 · {hasBooking ? `Remaining for EMIs: ₹${remaining.toFixed(2)}` : `Full fee in EMIs: ₹${plan.total_amount.toFixed(2)}`}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400">
                        {hasBooking ? 'Record via API: POST /payments/plans/:id/booking' : '—'}
                      </span>
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs font-medium uppercase text-gray-500">
                          <th className="py-2 pr-4">#</th>
                          <th className="py-2 pr-4">Due Date</th>
                          <th className="py-2 pr-4">Amount</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.installments.map((inst) => (
                          <tr key={inst.id} className="border-t border-gray-200">
                            <td className="py-2 pr-4 text-gray-500">
                              {inst.installment_number}
                            </td>
                            <td className="py-2 pr-4 text-gray-700">
                              {new Date(inst.due_date).toLocaleDateString(
                                'en-IN',
                                {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                },
                              )}
                            </td>
                            <td className="py-2 pr-4 font-medium text-gray-900">
                              &#x20B9; {inst.amount.toFixed(2)}
                            </td>
                            <td className="py-2 pr-4">
                              {inst.status === 'paid' ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                  <CheckCircle className="h-3 w-3" />
                                  Paid
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                                  <Clock className="h-3 w-3" />
                                  {inst.status}
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-right">
                              {inst.status === 'pending' && (
                                <button
                                  onClick={() =>
                                    setMarkPaidTarget({
                                      id: inst.id,
                                      number: inst.installment_number,
                                      amount: inst.amount,
                                    })
                                  }
                                  className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                                >
                                  Mark Paid
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mark Paid Modal */}
      <Modal
        isOpen={!!markPaidTarget}
        onClose={() => setMarkPaidTarget(null)}
        title="Confirm Payment"
      >
        {markPaidTarget && (
          <MarkPaidModal
            installmentId={markPaidTarget.id}
            installmentNumber={markPaidTarget.number}
            amount={markPaidTarget.amount}
            onClose={() => setMarkPaidTarget(null)}
            onConfirm={() => {
              setMarkPaidTarget(null);
              fetchPlans();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
