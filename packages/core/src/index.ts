/**
 * The domain, with no framework attached.
 *
 * Everything that decides what is true about a registration lives under this
 * package: the schema, the transactions, the money, the notifications and the
 * rules. It imports nothing from Next and nothing from React, which is the
 * whole point. Two processes consume it, the web app and the API service, and
 * a third could tomorrow.
 *
 * Prefer the deep imports (`@keiki/core/registration`) in application code, so
 * it is obvious at the top of a file what part of the domain it reaches into.
 * This barrel exists for the handful of places that genuinely want several.
 */
export * from "./db";
export * from "./identity";
export * from "./money";
export * from "./uuid";
