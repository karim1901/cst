/**
 * Auth constants that are safe to import from anywhere — including the
 * Edge middleware. Keep this file free of Node-only imports
 * (no `next/headers`, no mongoose).
 */
export const SESSION_COOKIE = "session";

// Keep the cookie and the JWT lifetime in sync.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const JWT_EXPIRES_IN = "7d";
export const JWT_ALG = "HS256";
