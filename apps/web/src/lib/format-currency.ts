/**
 * Currency formatting — pure, locale/currency aware
 *
 * No FX conversion — amounts are denominated in the client's currency and
 * formatted per BusinessConfig currency/locale.
 */

export function formatCurrency(
  amount: number,
  currency: string = 'INR',
  locale: string = 'en-IN',
  options?: { maximumFractionDigits?: number },
): string {
  const { maximumFractionDigits } = options ?? {};
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    ...(maximumFractionDigits !== undefined ? { maximumFractionDigits } : {}),
  }).format(amount);
}
