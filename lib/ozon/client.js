/**
 * Server-only Ozon Express integration.
 *
 * This is the ONLY place in the codebase allowed to talk to
 * api.ozonexpress.ma. It receives `credentials` (`{ ozonId, apiKey }`)
 * already looked up and decrypted server-side — the browser never sees
 * them, and this module never logs them.
 *
 * Endpoints, request shape and response parsing are preserved exactly from
 * the old working implementation — see app/api/orders/ozon/route.js and the
 * project README for the mapping. Do not invent a different Ozon API here.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/ozon/client.js is server-only and must not be imported in client code");
}

const OZON_BASE = process.env.OZON_API_BASE || "https://api.ozonexpress.ma";

const customerUrl = (credentials, action) =>
  `${OZON_BASE}/customers/${credentials.ozonId}/${credentials.apiKey}/${action}`;

function formOf(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value == null ? "" : String(value));
  }
  return form;
}

async function postForm(url, fields, signal) {
  let res;
  try {
    res = await fetch(url, { method: "POST", body: formOf(fields), signal, cache: "no-store" });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw Object.assign(new Error("Could not reach Ozon Express. Please try again."), {
      statusCode: 502,
    });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`Ozon Express request failed (${res.status}).`), {
      statusCode: 502,
    });
  }
  try {
    return await res.json();
  } catch {
    // Defensive: an external API can return malformed/non-JSON output.
    throw Object.assign(new Error("Ozon Express returned an unexpected response."), {
      statusCode: 502,
    });
  }
}

/**
 * Create a parcel. `parcelFields` are the raw `parcel-*` form fields (see
 * app/api/orders/ozon/route.js for exactly which ones). Does NOT assume
 * success from an HTTP 200 — inspects `ADD-PARCEL.RESULT`, defensively
 * treating anything unexpected as an error.
 */
export async function addParcel(credentials, fullTrackingNumber, parcelFields, signal) {
  const data = await postForm(
    customerUrl(credentials, "add-parcel"),
    { ...parcelFields, "tracking-number": fullTrackingNumber },
    signal
  );
  const addParcelResult = data?.["ADD-PARCEL"] ?? null;
  return {
    result: addParcelResult?.RESULT ?? "ERROR",
    addParcel: addParcelResult,
  };
}

/**
 * Fetch tracking + parcel-info for one tracking number and merge them
 * exactly like the old implementation did. Returns the merged object, or
 * null when the parcel does not exist / tracking reports an error.
 */
export async function fetchMergedOrder(credentials, fullTrackingNumber, signal) {
  const trackingRes = await postForm(
    customerUrl(credentials, "tracking"),
    { "tracking-number": fullTrackingNumber },
    signal
  );

  const tracking = trackingRes?.TRACKING;
  if (!tracking || tracking.RESULT === "ERROR") return null;

  const infoRes = await postForm(
    customerUrl(credentials, "parcel-info"),
    { "tracking-number": fullTrackingNumber },
    signal
  );

  return {
    ...tracking.LAST_TRACKING,
    ...tracking.HISTORY,
    ...infoRes?.["PARCEL-INFO"],
  };
}

/** Public city list — no credentials involved. Proxied so the browser never calls Ozon directly. */
export async function fetchCities(signal) {
  let res;
  try {
    res = await fetch(`${OZON_BASE}/cities`, { signal, cache: "no-store" });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw Object.assign(new Error("Could not reach Ozon Express."), { statusCode: 502 });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`Ozon Express cities request failed (${res.status}).`), {
      statusCode: 502,
    });
  }
  return res.json();
}
