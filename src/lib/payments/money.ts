function isAsciiDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

/**
 * Parses a user-entered rupee amount into the integer paise used at every
 * payment trust boundary. Keeping the original string avoids IEEE-754
 * surprises and rejects fractions smaller than one paise instead of rounding
 * them into a different financial instruction.
 */
export function parseRupeesToPaise(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;

  const separator = value.indexOf('.');
  if (separator !== -1 && value.indexOf('.', separator + 1) !== -1) return null;
  const rupees = separator === -1 ? value : value.slice(0, separator);
  const fraction = separator === -1 ? '' : value.slice(separator + 1);
  if (rupees.length > 6 || !isAsciiDigits(rupees)) return null;
  if (separator !== -1 && (fraction.length > 2 || !isAsciiDigits(fraction))) return null;

  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paise) && paise > 0 && paise <= 50_000_000
    ? paise
    : null;
}

export function paiseToRupees(paise: number): number {
  if (!Number.isSafeInteger(paise)) throw new Error('Payment amount must be integer paise');
  return paise / 100;
}

export function isWholePaise(value: number): boolean {
  return Number.isFinite(value)
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}
