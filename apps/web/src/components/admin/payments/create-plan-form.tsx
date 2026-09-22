'use client';

import { useState } from 'react';
import { createPaymentPlan } from '@/lib/api/payments';

interface CreatePlanFormProps {
  students: { id: string; name: string; email: string }[];
  courses: { id: string; name: string }[];
  onSuccess: () => void;
}

export function CreatePlanForm({
  students,
  courses,
  onSuccess,
}: CreatePlanFormProps) {
  const [studentId, setStudentId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [standardCourseFee, setStandardCourseFee] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [bookingAmount, setBookingAmount] = useState('');
  const [numberOfInstallments, setNumberOfInstallments] = useState('');
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Live preview (UX only, server is authoritative)
  const std = parseFloat(standardCourseFee) || 0;
  const disc = parseFloat(discountAmount) || 0;
  const total = parseFloat(totalAmount) || 0;
  const booking = parseFloat(bookingAmount) || 0;
  const hasStd = standardCourseFee.trim() !== '';
  const hasDisc = discountAmount.trim() !== '';
  const hasBooking = bookingAmount.trim() !== '';
  const expectedFinal = hasStd ? std - disc : null;
  const remaining = total - (hasBooking ? booking : 0);
  const count = parseInt(numberOfInstallments, 10) || 0;
  const mismatch = hasStd && expectedFinal !== null && Math.round(expectedFinal * 100) !== Math.round(total * 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const payload: any = {
        studentId,
        courseId,
        totalAmount: parseFloat(totalAmount),
        numberOfInstallments: parseInt(numberOfInstallments, 10),
        startDate: startDate || undefined,
      };
      if (standardCourseFee.trim() !== '') payload.standardCourseFee = parseFloat(standardCourseFee);
      if (discountAmount.trim() !== '') payload.discountAmount = parseFloat(discountAmount);
      if (discountReason.trim() !== '') payload.discountReason = discountReason.trim();
      if (bookingAmount.trim() !== '') payload.bookingAmount = parseFloat(bookingAmount);
      await createPaymentPlan(payload);
      setStudentId('');
      setCourseId('');
      setStandardCourseFee('');
      setDiscountAmount('');
      setDiscountReason('');
      setTotalAmount('');
      setBookingAmount('');
      setNumberOfInstallments('');
      setStartDate('');
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to create payment plan');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">Student</label>
        <select
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          required
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Select a student...</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.email})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Course</label>
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          required
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Select a course...</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Standard Course Fee (₹) <span className="text-gray-400 font-normal">optional</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={standardCourseFee}
            onChange={(e) => setStandardCourseFee(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="e.g. 72705"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Discount Amount (₹) <span className="text-gray-400 font-normal">optional</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={discountAmount}
            onChange={(e) => setDiscountAmount(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="e.g. 10000"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Discount Reason</label>
        <input
          type="text"
          value={discountReason}
          onChange={(e) => setDiscountReason(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="e.g. Scholarship, Early bird"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Final Agreed Fee (₹) <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">GST inclusive</span>
        </label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          required
          value={totalAmount}
          onChange={(e) => setTotalAmount(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="e.g. 62705"
        />
        {hasStd && (
          <p className={`mt-1 text-xs ${mismatch ? 'text-red-600' : 'text-gray-500'}`}>
            {mismatch
              ? `Standard (₹${std.toFixed(2)}) − Discount (₹${disc.toFixed(2)}) = ₹${expectedFinal!.toFixed(2)} — must equal Final Agreed Fee`
              : `Standard ₹${std.toFixed(2)} − Discount ₹${disc.toFixed(2)} = Final ₹${expectedFinal!.toFixed(2)} ✓`}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Booking Amount (₹) <span className="text-gray-400 font-normal">optional — independent, not EMI #1</span>
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={bookingAmount}
          onChange={(e) => setBookingAmount(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="e.g. 5163"
        />
        {hasBooking && total > 0 && (
          <p className="mt-1 text-xs text-gray-500">
            Final ₹{total.toFixed(2)} − Booking ₹{booking.toFixed(2)} = Remaining ₹{remaining.toFixed(2)} for EMIs
          </p>
        )}
        {hasBooking && parseFloat(bookingAmount) > total && total > 0 && (
          <p className="mt-1 text-xs text-red-600">Booking cannot exceed Final Agreed Fee</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Number of EMIs (after booking)
        </label>
        <input
          type="number"
          min="1"
          required
          value={numberOfInstallments}
          onChange={(e) => setNumberOfInstallments(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="e.g. 6"
        />
        {count > 0 && remaining > 0 && (
          <p className="mt-1 text-xs text-gray-500">
            {count} EMIs from ₹{remaining.toFixed(2)} — last EMI absorbs rounding
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Start Date (optional)
        </label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        {submitting ? 'Creating Plan...' : 'Create Payment Plan'}
      </button>
    </form>
  );
}
