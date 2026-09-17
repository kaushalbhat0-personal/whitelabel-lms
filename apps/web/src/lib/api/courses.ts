import { fetchApi } from '@/lib/api-client';
import { API_ROUTES } from '@/lib/constants';

export interface Course {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  start_date?: string;
  end_date?: string;
  created_at: string;
  batchCount?: number;
  batches?: Batch[];
}

export interface CourseWithBatches extends Course {
  batches: Batch[];
}

export interface Batch {
  id: string;
  name: string;
  course_id: string;
  schedule_type: string;
  is_active: boolean;
  start_date?: string;
  end_date?: string;
  created_at: string;
  course?: { id: string; name: string };
  studentCount?: number;
  teacherCount?: number;
}

export interface CourseStats {
  batchCount: number;
  studentCount: number;
  upcomingSessions: number;
}

/**
 * Fetch all courses with pagination.
 */
export async function getCourses() {
  return fetchApi<{ items: Course[]; total: number; page: number; limit: number }>(
    API_ROUTES.COURSES,
  );
}

/**
 * Fetch a single course by ID, including its nested batches.
 */
export async function getCourse(id: string) {
  return fetchApi<CourseWithBatches>(`${API_ROUTES.COURSES}/${id}`);
}

/**
 * Fetch stats for a single course.
 */
export async function getCourseStats(courseId: string) {
  return fetchApi<CourseStats>(`${API_ROUTES.COURSES}/${courseId}/stats`);
}

export interface StudentCourse extends Course {
  batches?: Batch[];
  enrolledBatches?: { id: string; name: string; course_id: string }[];
}

/**
 * Fetch courses for the currently logged-in student.
 * GET /courses/my
 */
export async function getMyCourses() {
  return fetchApi<StudentCourse[]>(`${API_ROUTES.COURSES}/my`);
}

export async function getMyDashboardCourses() {
  return fetchApi<{ courses: StudentCourse[]; name: string | null }>(`${API_ROUTES.COURSES}/my/dashboard`);
}

/**
 * Fetch a single course by ID with enrolled batches (student classroom).
 * GET /courses/:id
 */
export async function getStudentCourse(id: string) {
  return fetchApi<StudentCourse>(`${API_ROUTES.COURSES}/${id}`);
}

/**
 * Fetch all batches belonging to a specific course.
 */
export async function getCourseBatches(courseId: string) {
  return fetchApi<Batch[]>(`${API_ROUTES.COURSES}/${courseId}/batches`);
}

/**
 * Create a new course.
 */
export async function createCourse(
  data: { name: string; description?: string },
) {
  return fetchApi<Course>(API_ROUTES.COURSES, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Update a course by ID.
 * PATCH /courses/:id
 */
export async function updateCourse(
  id: string,
  data: { name?: string; description?: string },
) {
  return fetchApi<Course>(`${API_ROUTES.COURSES}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Duplicate a course (copies name, description, batches as inactive).
 * POST /courses/:id/duplicate
 */
export async function duplicateCourse(id: string) {
  return fetchApi<Course>(`${API_ROUTES.COURSES}/${id}/duplicate`, {
    method: 'POST',
  });
}

/**
 * Soft-delete a course (archive).
 * DELETE /courses/:id
 */
export async function deleteCourse(id: string) {
  return fetchApi<Course>(`${API_ROUTES.COURSES}/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Activate a previously archived course.
 * PATCH /courses/:id/activate
 */
export async function activateCourse(id: string) {
  return fetchApi<Course>(`${API_ROUTES.COURSES}/${id}/activate`, {
    method: 'PATCH',
  });
}

/**
 * Create a batch under a course.
 */
export async function createBatch(
  courseId: string,
  data: { name: string; scheduleType: string },
) {
  return fetchApi<Batch>(API_ROUTES.BATCHES, {
    method: 'POST',
    body: JSON.stringify({ courseId, ...data }),
  });
}

export interface StudentProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

/**
 * Fetch a single batch by ID.
 * GET /batches/:id
 */
export async function getBatch(id: string) {
  return fetchApi<Batch>(`${API_ROUTES.BATCHES}/${id}`);
}

/**
 * Fetch all batches (paginated, optionally filtered by active status).
 */
export async function getAllBatches(
  params: { isActive?: boolean; page?: number; limit?: number } = {},
) {
  const qp = new URLSearchParams();
  if (params.isActive !== undefined) qp.set('isActive', String(params.isActive));
  if (params.page) qp.set('page', String(params.page));
  if (params.limit) qp.set('limit', String(params.limit));
  const qs = qp.toString();
  return fetchApi<{ items: Batch[]; total: number }>(
    `${API_ROUTES.BATCHES}${qs ? `?${qs}` : ''}`,
  );
}

/**
 * Assign one or more existing students to a batch.
 * POST /batches/:batchId/students  { studentIds: string[] }
 */
export async function assignStudentsToBatch(
  batchId: string,
  studentIds: string[],
) {
  return fetchApi<{ enrolledCount: number }>(
    `${API_ROUTES.BATCHES}/${batchId}/students`,
    {
      method: 'POST',
      body: JSON.stringify({ studentIds }),
    },
  );
}

export interface AddStudentResponse {
  id: string;
  name: string;
  email: string;
  alreadyExisted: boolean;
}

/**
 * Add a single student to a batch — creates auth user + profile if needed.
 * POST /batches/:id/add-student
 */
export async function addStudentToBatch(
  batchId: string,
  data: { firstName: string; lastName: string; email: string; phone?: string },
) {
  return fetchApi<AddStudentResponse>(`${API_ROUTES.BATCHES}/${batchId}/add-student`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Fetch the student roster for a batch.
 * GET /batches/:id/students
 */
export async function getBatchStudents(
  batchId: string,
  page?: number,
  limit?: number,
) {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return fetchApi<{ items: StudentProfile[]; total: number; page: number; limit: number }>(
    `${API_ROUTES.BATCHES}/${batchId}/students${qs ? `?${qs}` : ''}`,
  );
}

/**
 * Remove students from a batch.
 * DELETE /batches/:batchId/students  { studentIds: string[] }
 */
export async function removeStudentsFromBatch(
  batchId: string,
  studentIds: string[],
) {
  return fetchApi<{ removedCount: number }>(
    `${API_ROUTES.BATCHES}/${batchId}/students`,
    {
      method: 'DELETE',
      body: JSON.stringify({ studentIds }),
    },
  );
}

/**
 * Update a batch's name and/or schedule type.
 * PATCH /batches/:id
 */
export async function updateBatch(
  batchId: string,
  data: { name?: string; scheduleType?: string },
) {
  return fetchApi<Batch>(`${API_ROUTES.BATCHES}/${batchId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Delete a batch.
 * DELETE /batches/:id
 */
export async function deleteBatch(
  batchId: string,
) {
  return fetchApi<{ deleted: boolean }>(`${API_ROUTES.BATCHES}/${batchId}`, {
    method: 'DELETE',
  });
}

/**
 * Reassign a batch to a different course.
 * PATCH /batches/:batchId/reassign-course { courseId }
 */
export async function reassignBatch(
  batchId: string,
  targetCourseId: string,
) {
  return fetchApi<Batch>(`${API_ROUTES.BATCHES}/${batchId}/reassign-course`, {
    method: 'PATCH',
    body: JSON.stringify({ courseId: targetCourseId }),
  });
}
