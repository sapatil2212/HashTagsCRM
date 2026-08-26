/**
 * Recognising a Prisma `Decimal` without asking it what it is called.
 *
 * `@prisma/client` ships its runtime minified, so the Decimal class name is
 * mangled — `new Prisma.Decimal('1499.50').constructor.name` is `'i'`, not
 * `'Decimal'`. Every guard written as `constructor.name === 'Decimal'` therefore
 * never fired, and Decimals fell through to the generic object branch of the
 * snake_case/camelCase converters. Those copy own keys, so a money column
 * arrived in the browser as decimal.js internals:
 *
 *   { s: 1, e: 3, d: [1499, 5000000] }
 *
 * React then threw "Objects are not valid as a React child (found: object with
 * keys {s, e, d})". (`constructor` is an own property too, but it holds a
 * function, so `JSON.stringify` drops it on the way out.)
 *
 * Duck typing is used instead of `instanceof` / `Prisma.Decimal.isDecimal` so
 * this module stays importable from client bundles, which must not pull in the
 * Prisma runtime.
 */

/** A decimal.js instance, as far as anything here needs to care. */
export type DecimalLike = { toString(): string; toNumber(): number };

/**
 * True for decimal.js instances (`Decimal`, `Prisma.Decimal`). The `s`/`e`/`d`
 * triple is decimal.js' internal sign/exponent/digits representation; requiring
 * `toNumber` alongside it keeps plain data objects that happen to use those key
 * names from matching.
 */
export function isDecimalLike(value: unknown): value is DecimalLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.toNumber === 'function' &&
    typeof candidate.toString === 'function' &&
    's' in candidate &&
    'e' in candidate &&
    'd' in candidate
  );
}

/**
 * Decimal → number, for JSON payloads. Goes via `toString` rather than
 * `toNumber` so the value is read the way the database wrote it.
 */
export function decimalToNumber(value: DecimalLike): number {
  return Number(value.toString());
}
