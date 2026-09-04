/**
 * Is this string shaped like a uuid?
 *
 * Postgres raises "invalid input syntax for type uuid" when a query compares a
 * uuid column against something that is not one, which surfaces as a 500. A
 * mistyped or truncated URL is a wrong address, not a server fault, so route
 * handlers check the shape first and answer 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
