/**
 * Presentation helpers — currency / date locale/timezone
 * Verifies Client #2 (AED/en-AE/Asia/Dubai) vs India (INR/en-IN/Asia/Kolkata)
 * without importing web files directly (pure Intl).
 */

function formatCurrency(amount: number, currency = 'INR', locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

function formatDate(iso: string, locale = 'en-IN', timezone = 'Asia/Kolkata'): string {
  return new Date(iso).toLocaleString(locale, {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

describe('Presentation — currency / locale / timezone', () => {
  it('INR en-IN', () => {
    const s = formatCurrency(100, 'INR', 'en-IN');
    expect(s).toContain('₹');
    expect(s).toContain('100');
  });

  it('AED en-AE', () => {
    const s = formatCurrency(100, 'AED', 'en-AE');
    expect(s).toContain('AED');
    // Should NOT be hardcoded INR
    expect(s).not.toContain('₹');
  });

  it('USD en-US', () => {
    const s = formatCurrency(100, 'USD', 'en-US');
    expect(s).toContain('$');
  });

  it('EUR en-DE', () => {
    const s = formatCurrency(100, 'EUR', 'de-DE');
    // EUR symbol or EUR code
    expect(s).toMatch(/€|EUR/);
  });

  it('same UTC instant formats differently per locale/timezone', () => {
    const iso = '2027-05-12T10:00:00.000Z'; // 10:00 UTC
    const india = formatDate(iso, 'en-IN', 'Asia/Kolkata'); // 15:30 IST
    const dubai = formatDate(iso, 'en-AE', 'Asia/Dubai'); // 14:00 GST (+04)
    expect(india).not.toBe(dubai);
    expect(india).toContain('2027');
    expect(dubai).toContain('2027');
    // Dubai is 1.5h behind India for this instant, not equal
  });

  it('Client #2 AED/en-AE/Asia/Dubai vs India INR/en-IN/Asia/Kolkata', () => {
    const amountAED = formatCurrency(105, 'AED', 'en-AE');
    expect(amountAED).toContain('AED');
    const amountINR = formatCurrency(105, 'INR', 'en-IN');
    expect(amountINR).toContain('₹');
    expect(amountAED).not.toBe(amountINR);
  });
});
