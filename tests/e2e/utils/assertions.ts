import { expect, APIResponse } from '@playwright/test';

export async function expectOk(response: APIResponse): Promise<{ success: boolean; data: unknown }> {
  if (!response.ok()) {
    console.error('=== expectOk FAILED === Status:', response.status(), 'Body:', await response.text());
  }
  expect(response.ok()).toBe(true);
  const wrapper: { success: boolean; data: unknown } = await response.json();
  expect(wrapper.success).toBe(true);
  expect(wrapper.data).toBeDefined();
  return wrapper;
}

export async function expectCreated(
  response: APIResponse,
  expectedStatus = 201,
): Promise<{ success: boolean; data: unknown }> {
  expect(response.status()).toBe(expectedStatus);
  const wrapper: { success: boolean; data: unknown } = await response.json();
  expect(wrapper.success).toBe(true);
  expect(wrapper.data).toBeDefined();
  return wrapper;
}

export async function expectForbidden(response: APIResponse): Promise<void> {
  expect(response.ok()).toBe(false);
  expect(response.status()).toBe(403);
}

export async function expectBadRequest(response: APIResponse): Promise<void> {
  expect(response.ok()).toBe(false);
  expect(response.status()).toBe(400);
}

export async function expectNotFound(response: APIResponse): Promise<void> {
  expect(response.ok()).toBe(false);
  expect(response.status()).toBe(404);
}

export function expectSuccessfulResponse(wrapper: { success: boolean; data: unknown }): void {
  expect(wrapper.success).toBe(true);
  expect(wrapper.data).toBeTruthy();
}
