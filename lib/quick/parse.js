/**
 * Response parsing for Quick Livraison.
 *
 * IMPORTANT / HONEST LIMITATION: unlike Ozon Express (where an old, proven
 * implementation's exact response shapes — `ADD-PARCEL.RESULT`,
 * `TRACKING.LAST_TRACKING`, ... — were available as ground truth), no such
 * reference exists for Quick Livraison in this project. Only the REQUEST
 * shape is documented/given (see lib/quick/client.js). The functions below
 * are therefore a best-effort, defensive guess at Quick's response shape —
 * checking a handful of plausible key names rather than assuming one exact
 * schema — and MUST be verified (and likely adjusted) against the real
 * Quick Livraison API before this integration is trusted with real orders.
 * This file is the one place to fix once that shape is confirmed.
 */

const TRUE_TOKENS = new Set(["success", "true", "1", "ok", "created"]);
const FALSE_TOKENS = new Set(["error", "failed", "false", "0", "fail"]);

/**
 * Did `deliveries/store` actually create the parcel? Conservative on
 * purpose: an unrecognized shape is treated as NOT confirmed successful
 * (never silently assume success from HTTP 200 alone), so a genuine success
 * in a shape this hasn't seen yet would be reported as a failure rather than
 * risk marking a failed order as successful. See module comment.
 */
export function isQuickCreateSuccess(body) {
  if (body == null) return false;
  if (body.success === true) return true;
  if (body.success === false) return false;

  const status = String(body.status ?? body.situation ?? body.state ?? "").toLowerCase();
  if (TRUE_TOKENS.has(status)) return true;
  if (FALSE_TOKENS.has(status)) return false;

  // A tracking/parcel identifier echoed back is a reasonable success signal
  // when no explicit status field is present.
  if (body.tracking_number || body.code || body.parcel_id) return true;

  return false;
}

/** Best-effort error message to surface (never the raw body verbatim to avoid leaking internals). */
export function quickErrorMessage(body) {
  return (
    (typeof body?.message === "string" && body.message) ||
    (typeof body?.error === "string" && body.error) ||
    "Quick Livraison rejected this order."
  );
}

// Explicit, unambiguous "this tracking number does not exist" signals only
// — never a generic wrapper flag. `FALSE_TOKENS` used to also gate on
// `status`/`situation` alone (see git history), which incorrectly treated
// real, existing orders whose own status/situation happened to read like a
// failure word (or whose response simply used a generic
// `success: false` envelope unrelated to whether THIS parcel was found) as
// "not found" — see classifyQuickParcelLookup's own comment for the full
// story. Kept narrow on purpose: only an explicit not-found phrase counts.
const NOT_FOUND_TOKENS = new Set(["not_found", "notfound", "not found"]);

/**
 * Three-way classification of a `getParcelDetails` response — deliberately
 * NOT a boolean, because "this response didn't clearly confirm existence"
 * is NOT the same fact as "Quick told us this tracking number definitely
 * does not exist". A prior version conflated those two (a response with a
 * generic `success: false` wrapper flag — for reasons entirely unrelated to
 * whether THIS specific parcel was found — was treated exactly like a
 * confirmed 404), which silently lost real, existing historical orders
 * during month discovery and logged them as an indistinguishable "harmless
 * gap". See lib/quick/lookup.js, which retries an "unknown" result a few
 * times before ever giving up on it, and NEVER folds "unknown" into
 * "not_found".
 *
 * @returns {"exists"|"not_found"|"unknown"}
 *   "exists"    — the response clearly identifies a real parcel record
 *                 (a recognizable field is present AND there is no
 *                 explicit not-found signal).
 *   "not_found" — Quick clearly confirms this tracking number does NOT
 *                 exist: HTTP 404, or an explicit "not found" status/
 *                 situation phrase.
 *   "unknown"   — inconclusive (no body at all, or a body that carries
 *                 none of the fields recognized as "this is a real parcel
 *                 record" and no explicit not-found signal either — e.g. an
 *                 unrecognized error envelope, a transient/rate-limited
 *                 response). Callers MUST NOT treat this as a confirmed
 *                 absence.
 */
export function classifyQuickParcelLookup(body, httpStatus) {
  if (httpStatus === 404) return "not_found";
  if (body == null) return "unknown";

  const status = String(body.status ?? body.situation ?? "").toLowerCase();
  if (NOT_FOUND_TOKENS.has(status)) return "not_found";

  const hasParcelField = Boolean(
    body.tracking_number ||
      body.status ||
      body.situation ||
      body.receiver ||
      body.name ||
      body.phone
  );
  if (hasParcelField) return "exists";

  // No explicit not-found signal, but also nothing recognizable as a real
  // parcel record — genuinely ambiguous (e.g. a bare `{success:false}`
  // error envelope with no further detail), not a confirmed absence.
  return "unknown";
}

/** Does `getParcelDetails/{code}` indicate the parcel actually exists?
 * Thin boolean wrapper over `classifyQuickParcelLookup` — kept for callers
 * that only need a yes/no and already treat "not confirmed" as "no" on
 * their own terms (e.g. the Orders page's live per-order status refresh,
 * which already falls back to the last known status either way). The
 * discovery/backfill walk (lib/quick/lookup.js) uses the 3-way
 * classification directly instead, specifically so it never confuses
 * "unknown" with "not_found". */
export function quickParcelExists(body, httpStatus) {
  return classifyQuickParcelLookup(body, httpStatus) === "exists";
}

/**
 * Best-effort status string for display/storage — raw, not reinterpreted
 * into invented buckets.
 *
 * MUST come from `status` (e.g. "DELIVERED"), never from `situation` (a
 * separate, distinct Quick field — e.g. "INVOICED", a billing/invoicing
 * state, not a delivery status). `situation` is deliberately excluded from
 * this chain, not just de-prioritized — it is never a legitimate substitute
 * for `status`. `status_second` is kept as a fallback for when `status`
 * itself is absent, same as before.
 */
export function quickDisplayStatus(body) {
  return body?.status ?? body?.status_second ?? null;
}

/**
 * Best-effort, display-only field extraction for `getParcelDetails` — same
 * "guess a few plausible key names" caution as the rest of this file. Always
 * keep `raw` alongside this for anything the guesses miss.
 */
export function quickOrderSummary(body) {
  return {
    receiver: body?.name ?? body?.receiver ?? null,
    phone: body?.phone ?? body?.receiver_phone ?? null,
    address: body?.address ?? null,
    product: body?.prd_name ?? body?.product ?? null,
    price: body?.amount ?? body?.price ?? null,
    status: quickDisplayStatus(body),
  };
}

/**
 * The REAL moment Quick recorded this parcel as delivered — parsed from
 * `date_livraison` ("YYYY-MM-DD HH:MM:SS", per Quick's documented response
 * fields), interpreted in this app's LOCAL timezone (same convention as
 * lib/tracking/counter.js / lib/returns/delivery-date.js — never UTC-parsed
 * via a bare `new Date(string)`, whose behavior for a non-ISO string like
 * this varies by JS engine). Used by lib/commission/sync-status.js exactly
 * like Ozon's own lib/ozon/history.js#findDeliveredAt: "the real event time
 * when known", never "whenever this app happened to check". Returns `null`
 * when absent/unparseable — a delivery date is never invented.
 */
const QUICK_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

export function quickDeliveredAt(body) {
  const raw = body?.date_livraison;
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(QUICK_DATETIME_RE);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Normalize `getCityIDs`'s response into `[{ id, name }]`, tolerating a few plausible shapes. */
export function normalizeQuickCities(raw) {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.cities)
        ? raw.cities
        : raw && typeof raw === "object"
          ? Object.values(raw)
          : [];

  return rows
    .map((row) => ({
      id: String(row?.city_id ?? row?.id ?? row?.ID ?? "").trim(),
      name: String(row?.city_name ?? row?.name ?? row?.NAME ?? "").trim(),
    }))
    .filter((city) => city.id && city.name);
}
