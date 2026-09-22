import { fetchApi } from '@/lib/api-client';

export async function getReceipts(studentId?: string) {
  const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
  return fetchApi<any[]>(`/receipts${qs}`);
}

export async function getInvoices(studentId?: string) {
  const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
  return fetchApi<any[]>(`/invoices${qs}`);
}

export async function getReceiptByPayment(paymentId: string) {
  return fetchApi<any>(`/receipts/by-payment/${paymentId}`);
}

export async function getInvoiceByPayment(paymentId: string) {
  return fetchApi<any>(`/invoices/by-payment/${paymentId}`);
}

export async function sendReceipt(id: string) {
  return fetchApi<{ email_sent_to: string; email_sent_at: string }>(`/receipts/${id}/send`, {
    method: 'POST',
  });
}

export async function sendInvoice(id: string) {
  return fetchApi<{ email_sent_to: string; email_sent_at: string }>(`/invoices/${id}/send`, {
    method: 'POST',
  });
}

export async function getDownloadUrl(id: string) {
  return fetchApi<{ url: string; fileName: string }>(`/invoices/${id}/download`);
}
