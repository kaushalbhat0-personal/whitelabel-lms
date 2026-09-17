/**
 * Generate a secure temporary password for student onboarding.
 * - 10 random hex chars from crypto.randomUUID + "Aa1!" suffix ensures upper/lower/number/symbol
 * - Total length 13, satisfies CreateUserDto @MinLength8 and complexity
 */
export function generateTempPassword(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10) + 'Aa1!';
}
