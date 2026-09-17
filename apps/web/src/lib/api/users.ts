import { fetchApi } from '@/lib/api-client';
import { API_ROUTES } from '@/lib/constants';

export interface BatchRef {
  id: string;
  name: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  is_active: boolean;
  created_at: string;
  batches?: BatchRef[];
}

/**
 * Fetch users filtered by role (e.g. 'student'), with pagination.
 */
export async function getUsers(
  params: { role?: string; page?: number; limit?: number; includeInactive?: boolean } = {},
) {
  const query = new URLSearchParams();
  if (params.role) query.set('role', params.role);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.includeInactive) query.set('includeInactive', 'true');

  const qs = query.toString();
  const endpoint = `${API_ROUTES.USERS}${qs ? `?${qs}` : ''}`;

  return fetchApi<{ items: User[]; total: number; page: number; limit: number }>(
    endpoint,
  );
}

/**
 * Soft-delete a user — sets is_active = false.
 * DELETE /users/:id
 */
export async function deleteUser(id: string) {
  return fetchApi<{ deleted: boolean }>(`${API_ROUTES.USERS}/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Convenience wrapper to get only student users.
 */
export async function getStudents(params: { includeInactive?: boolean } = {}) {
  return getUsers({ role: 'student', limit: 200, includeInactive: params.includeInactive });
}

export async function permanentDeleteUser(id: string) {
  return fetchApi<{ deleted: boolean; freedEmail: string }>(`${API_ROUTES.USERS}/${id}/permanent`, {
    method: 'DELETE',
  });
}

export async function restoreUser(id: string) {
  return fetchApi<User>(`${API_ROUTES.USERS}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: true }),
  });
}

export async function updateUser(id: string, data: { isActive?: boolean; name?: string; email?: string }) {
  return fetchApi<User>(`${API_ROUTES.USERS}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Create a single user (admin-only). Password is generated server-side.
 * POST /users
 */
export async function createUser(
  data: { name: string; email: string; role: string; phone?: string },
) {
  return fetchApi<User>(API_ROUTES.USERS, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
