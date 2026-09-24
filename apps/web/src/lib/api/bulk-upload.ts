import { fetchApi } from '@/lib/api-client';
import { API_ROUTES } from '@/lib/constants';

export interface RowResult {
  rowNumber: number;
  email: string;
  name?: string;
  status: 'success' | 'failure';
  error?: string;
  warning?: string;
  batchAssigned?: boolean;
  emailStatus?: 'sent' | 'failed' | 'not_attempted' | 'suppressed';
}

export interface JobStatus {
  status: 'processing' | 'completed' | 'failed';
  totalRows: number;
  successCount: number;
  failureCount: number;
  results: RowResult[];
  failures: { email: string; error: string }[];
}

export interface BulkUploadJob {
  id: string;
  job_type: string;
  uploaded_by: string;
  file_name: string;
  total_rows: number;
  success_count: number;
  failure_count: number;
  status: 'processing' | 'completed' | 'failed';
  failures: { email: string; error: string }[];
  results: RowResult[];
  created_at: string;
  completed_at?: string;
}

/**
 * Fetch the 50 most recent bulk upload jobs.
 */
export async function getBulkUploadJobs() {
  return fetchApi<BulkUploadJob[]>(`${API_ROUTES.BULK_UPLOAD}/jobs`);
}

/**
 * Poll a single job's status after upload has been started.
 */
export async function getJobStatus(jobId: string) {
  return fetchApi<JobStatus>(`${API_ROUTES.BULK_UPLOAD}/jobs/${jobId}`);
}

/**
 * Upload a CSV/Excel file to bulk-create student accounts.
 * Sends multipart/form-data so no Content-Type header is set manually.
 * Returns immediately with a jobId — poll getJobStatus() for results.
 */
export async function uploadStudentsCsv(
  formData: FormData,
  token?: string,
) {
  return fetchApi<{
    jobId: string;
    fileName: string;
    totalRows: number;
  }  >(`${API_ROUTES.BULK_UPLOAD}/students`, {
    method: 'POST',
    body: formData,
  });
}
