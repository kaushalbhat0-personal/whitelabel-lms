import { fetchApi } from '@/lib/api-client';

// ─── Tests ────────────────────────────────────────────────────
export interface CreateTestData {
  title: string;
  description?: string;
  durationMinutes?: number;
  totalMarks: number;
  passingMarks?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  showResultImmediately?: boolean;
  negativeMarking?: boolean;
  negativePerQuestion?: number;
  maxAttempts?: number;
  instructions?: string;
  startTime?: string;
  endTime?: string;
  sections?: { title: string; description?: string; instructions?: string; sortOrder?: number }[];
  questions?: { questionBankId: string; marks?: number; negativeMark?: number; sortOrder?: number; sectionId?: string; isCompulsory?: boolean }[];
  batches?: { batchId: string }[];
}

export interface TestResponse {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number | null;
  total_marks: number;
  passing_marks: number;
  status: string;
  start_time: string | null;
  end_time: string | null;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  show_result_immediately: boolean;
  negative_marking: boolean;
  negative_per_question: number;
  max_attempts: number;
  instructions: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  test_batches: { batch_id: string; batches: { name: string } }[];
  test_sections: any[];
  test_question_bank: any[];
}

export async function createTest(data: CreateTestData) {
  return fetchApi<TestResponse>('/tests', { method: 'POST', body: JSON.stringify(data) });
}

export async function duplicateTest(id: string) {
  return fetchApi<TestResponse>(`/tests/${id}/duplicate`, { method: 'POST' });
}

export async function getTests(params?: { status?: string; batchId?: string; search?: string; page?: number; limit?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.batchId) searchParams.set('batchId', params.batchId);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return fetchApi<{ items: TestResponse[]; total: number; page: number; limit: number }>(
    `/tests${query ? `?${query}` : ''}`,
  );
}

export async function getMyDashboardTests() {
  return fetchApi<{ items: Array<{ id: string; title: string; status: string; end_time: string | null; max_attempts: number | null; start_time: string | null }>; total: number; page: number; limit: number }>('/tests/my/dashboard');
}

export async function getMyTests(params?: { page?: number; limit?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return fetchApi<{ items: TestResponse[]; total: number; page: number; limit: number }>(
    `/tests/my${query ? `?${query}` : ''}`,
  );
}

export async function getTest(id: string) {
  return fetchApi<TestResponse>(`/tests/${id}`);
}

export async function updateTest(id: string, data: Partial<CreateTestData>) {
  return fetchApi<TestResponse>(`/tests/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function updateTestStatus(id: string, status: string) {
  return fetchApi<TestResponse>(`/tests/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export async function archiveTest(id: string) {
  return fetchApi<TestResponse>(`/tests/${id}/archive`, { method: 'POST' });
}

export async function deleteTest(id: string) {
  return fetchApi<{ deleted: boolean }>(`/tests/${id}`, { method: 'DELETE' });
}

// ─── Questions ────────────────────────────────────────────────
export interface CreateQuestionData {
  questionText: string;
  questionType: string;
  options?: Record<string, any>;
  correctAnswer?: string;
  explanation?: string;
  difficulty?: string;
  topicId?: string;
  imageUrl?: string;
}

export interface QuestionResponse {
  id: string;
  question_text: string;
  question_type: string;
  options: Record<string, any> | null;
  correct_answer: string | null;
  explanation: string | null;
  difficulty: string;
  topic_id: string | null;
  topics: { name: string } | null;
  image_url: string | null;
  created_by: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export async function createQuestion(data: CreateQuestionData) {
  return fetchApi<QuestionResponse>('/questions', { method: 'POST', body: JSON.stringify(data) });
}

export async function bulkImportQuestions(data: { questions: CreateQuestionData[] }) {
  return fetchApi<QuestionResponse[]>('/questions/bulk-import', { method: 'POST', body: JSON.stringify(data) });
}

export async function getQuestions(params?: { topicId?: string; difficulty?: string; questionType?: string; search?: string; page?: number; limit?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.topicId) searchParams.set('topicId', params.topicId);
  if (params?.difficulty) searchParams.set('difficulty', params.difficulty);
  if (params?.questionType) searchParams.set('questionType', params.questionType);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return fetchApi<{ items: QuestionResponse[]; total: number; page: number; limit: number }>(
    `/questions${query ? `?${query}` : ''}`,
  );
}

export async function getQuestion(id: string) {
  return fetchApi<QuestionResponse>(`/questions/${id}`);
}

export async function updateQuestion(id: string, data: Partial<CreateQuestionData & { isArchived?: boolean }>) {
  return fetchApi<QuestionResponse>(`/questions/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function archiveQuestion(id: string) {
  return fetchApi<QuestionResponse>(`/questions/${id}/archive`, { method: 'POST' });
}

export async function unarchiveQuestion(id: string) {
  return fetchApi<QuestionResponse>(`/questions/${id}/unarchive`, { method: 'POST' });
}

export async function deleteQuestion(id: string) {
  return fetchApi<{ deleted: boolean }>(`/questions/${id}`, { method: 'DELETE' });
}

export async function getTopics() {
  return fetchApi<{ id: string; name: string }[]>('/questions/topics');
}

// ─── Attempts ────────────────────────────────────────────────
export interface StartAttemptResponse {
  attempt?: any;
  questions: any[];
  test?: any;
  test_answers?: any[];
  [key: string]: any;
}

export interface AttemptAnswer {
  questionId: string;
  questionType: string;
  answer: any;
}

export async function startAttempt(testId: string, deviceFingerprint?: string) {
  return fetchApi<StartAttemptResponse>(`/attempts/tests/${testId}/start`, {
    method: 'POST',
    body: JSON.stringify({ deviceFingerprint }),
  });
}

export async function getAttempt(attemptId: string) {
  return fetchApi<any>(`/attempts/${attemptId}`);
}

export async function saveAnswer(attemptId: string, data: AttemptAnswer & { currentQuestionIndex?: number; timeRemainingSeconds?: number }) {
  return fetchApi<any>(`/attempts/${attemptId}/answer`, { method: 'PATCH', body: JSON.stringify(data), skipAuthRedirect: true } as any);
}

export async function saveAllAnswers(attemptId: string, data: { answers: AttemptAnswer[]; currentQuestionIndex?: number; timeRemainingSeconds?: number }) {
  return fetchApi<any>(`/attempts/${attemptId}/answers`, { method: 'PATCH', body: JSON.stringify(data), skipAuthRedirect: true } as any);
}

export async function submitAttempt(attemptId: string, data: { answers: AttemptAnswer[]; timeRemainingSeconds?: number }) {
  return fetchApi<any>(`/attempts/${attemptId}/submit`, { method: 'POST', body: JSON.stringify(data), skipAuthRedirect: true } as any);
}

export async function getMyAttempts(page?: number, limit?: number) {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  return fetchApi<{ items: Array<{ id: string; testId: string; status: string }>; total: number; page: number; limit: number }>(
    `/attempts/my${query ? `?${query}` : ''}`,
  );
}

export async function getAttemptTimer(attemptId: string) {
  return fetchApi<{ remainingSeconds: number }>(`/attempts/${attemptId}/timer`);
}

// ─── Evaluation ──────────────────────────────────────────────
export async function autoGradeAttempt(attemptId: string) {
  return fetchApi<any>(`/evaluation/${attemptId}/auto-grade`, { method: 'POST' });
}

export async function getReviewQueue(params?: { status?: string; assignedTo?: string; testId?: string; page?: number; limit?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.assignedTo) searchParams.set('assignedTo', params.assignedTo);
  if (params?.testId) searchParams.set('testId', params.testId);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return fetchApi<{ items: any[]; page: number; limit: number }>(`/evaluation/review-queue${query ? `?${query}` : ''}`);
}

export async function assignForReview(reviewId: string) {
  return fetchApi<any>(`/evaluation/review-queue/${reviewId}/assign`, { method: 'PATCH' });
}

export async function submitReview(reviewId: string, data: { marksAwarded: number; feedback?: string }) {
  return fetchApi<any>(`/evaluation/review-queue/${reviewId}/review`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function publishResults(attemptId: string) {
  return fetchApi<any>(`/evaluation/${attemptId}/publish`, { method: 'POST' });
}

export async function calculateAnalytics(testId: string) {
  return fetchApi<any>(`/evaluation/tests/${testId}/analytics`, { method: 'POST' });
}

// ─── Uploads ──────────────────────────────────────────────────
export async function uploadQuestionImage(file: File): Promise<{ url: string; fileName: string }> {
  const formData = new FormData();
  formData.append('file', file);
  return fetchApi<{ url: string; fileName: string }>('/uploads/question-image', {
    method: 'POST',
    body: formData,
  });
}

// ─── Results ──────────────────────────────────────────────────
export async function getStudentResult(attemptId: string) {
  return fetchApi<any>(`/results/${attemptId}`);
}

export async function getMyDashboardResults(): Promise<{ items: any[]; total: number; page: number; limit: number }> {
  const result = await fetchApi<{ items: any[]; total: number; page: number; limit: number }>('/results/my/dashboard');
  return result;
}

export async function getMyResults(page?: number, limit?: number): Promise<any[]> {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  const result = await fetchApi<{ items: any[]; total: number; page: number; limit: number }>(
    `/results/my${query ? `?${query}` : ''}`,
  );
  return result?.items ?? [];
}

export async function getTestResults(testId: string) {
  return fetchApi<any[]>(`/results/test/${testId}`);
}

export async function getTestAnalytics(testId: string) {
  return fetchApi<any>(`/results/test/${testId}/analytics`);
}

export async function getStudentAnalytics(userId: string) {
  return fetchApi<any>(`/results/student/${userId}/analytics`);
}

export async function getOverallAnalytics() {
  return fetchApi<any>('/results/admin/overall');
}
