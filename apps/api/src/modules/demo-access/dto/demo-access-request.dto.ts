/**
 * Request body for POST /demo/access.
 *
 * Intentionally empty: the caller controls NOTHING about the temporary
 * account (no email, name, role, password, expiry, or redirect). The global
 * ValidationPipe (whitelist + forbidNonWhitelisted) rejects any supplied
 * property with a 400, so this class must stay property-free.
 */
export class DemoAccessRequestDto {}
