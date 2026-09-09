/**
 * Decimal-safe money helpers for the Finance system (item 29's explicit
 * requirement: no floating-point rounding error in a financial system).
 *
 * EVERY monetary value this system stores in MongoDB is an INTEGER number
 * of centimes (1 DH = 100 centimes) — `amountCents`, `costPerUnitCents`,
 * `deliveredPriceCents`, etc. Every calculation in lib/finance/calculate.js
 * operates on these integers with plain integer arithmetic (which never
 * loses precision, unlike floating-point DH amounts). Conversion to/from
 * the human-facing DH amount happens ONLY at the two edges: parsing a
 * form input into `amountCents` (here), and formatting `amountCents` back
 * into a display string (here) — nowhere else.
 */

/**
 * Parse a user-entered DH amount (string or number, e.g. "12.5", 12.5,
 * "220") into an integer number of centimes. Rounds to the nearest
 * centime (never truncates) so a value like "12.505" resolves predictably.
 * Returns `null` for anything that is not a finite, non-negative number —
 * the caller must reject the input rather than silently coercing it.
 */
export function dhToCents(value) {
  const num = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

/** Integer centimes -> a DH number (e.g. 12050 -> 120.5) — for calculations that still need a plain number (e.g. dividing by an order count for display). */
export function centsToDh(cents) {
  return Math.round(cents) / 100;
}

/** Integer centimes -> a fixed-2-decimal DH string for display, e.g. 12050 -> "120.50". */
export function formatDh(cents) {
  return (Math.round(cents) / 100).toFixed(2);
}

/** Sum an array of integer-centime values safely (plain integer addition). */
export function sumCents(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}
