import { fetchApi } from '@/lib/api-client';
import { API_ROUTES } from '@/lib/constants';

export interface PaymentPlan {
  id: string;
  student_id: string;
  course_id: string;
  total_amount: number;
  installment_count: number;
  status: string;
  notes?: string;
  created_at: string;
  course?: { id: string; name: string };
  installments: PaymentInstallment[];
  standard_course_fee?: number | null;
  discount_amount?: number | null;
  discount_reason?: string | null;
  booking_amount?: number | null;
}

export interface PaymentInstallment {
  id: string;
  payment_plan_id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  status: 'pending' | 'paid' | 'overdue' | 'waived';
  paid_at?: string;
  payment_id?: string;
}

export async function getMyPaymentPlans() {
  return fetchApi<PaymentPlan[]>(`${API_ROUTES.PAYMENTS.MY}`);
}

export async function createPaymentPlan(
  data: {
    studentId: string;
    courseId: string;
    totalAmount: number;
    numberOfInstallments: number;
    startDate?: string;
    standardCourseFee?: number;
    discountAmount?: number;
    discountReason?: string;
    bookingAmount?: number;
  },
) {
  return fetchApi<PaymentPlan>(`${API_ROUTES.PAYMENTS.PLANS}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function recordBookingPayment(
  planId: string,
  data: { paymentMethod: string; transactionId?: string; paymentDate?: string },
) {
  return fetchApi<any>(`${API_ROUTES.PAYMENTS.PLANS}/${planId}/booking`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getStudentPlans(studentId: string) {
  return fetchApi<PaymentPlan[]>(
    `${API_ROUTES.PAYMENTS.PLANS}/student/${studentId}`,
  );
}

export async function markInstallmentPaid(
  installmentId: string,
  data: { paymentMethod: string; transactionId?: string },
) {
  return fetchApi<any>(
    `${API_ROUTES.PAYMENTS.INSTALLMENTS}/${installmentId}/pay`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  );
}
