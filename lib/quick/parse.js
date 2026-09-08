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

/** Does `getParcelDetails/{code}` indicate the parcel actually exists? */
export function quickParcelExists(body, httpStatus) {
  if (httpStatus === 404) return false;
  if (body == null) return false;
  if (body.success === false) return false;
  const status = String(body.status ?? body.situation ?? "").toLowerCase();
  if (FALSE_TOKENS.has(status) || status === "not_found" || status === "notfound") return false;
  // Any recognizable content at all counts as "found" — see module comment.
  return Boolean(
    body.situation || body.status || body.receiver || body.name || body.phone || body.tracking_number
  );
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
