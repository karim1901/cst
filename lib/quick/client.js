/**
 * Server-only Quick Livraison integration.
 *
 * This is the ONLY place in the codebase allowed to talk to
 * clients.quicklivraison.ma. It receives `credentials` (`{ apiKey }`)
 * already looked up and decrypted server-side — the browser never sees it,
 * and this module never logs it.
 *
 * Request shape (endpoint, fields, content-type) is exactly what was
 * specified for this integration. Response parsing is best-effort — see
 * lib/quick/parse.js for why, and its module comment for the one place to
 * fix once Quick's real response shape is confirmed.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/quick/client.js is server-only and must not be imported in client code");
}

import { isQuickCreateSuccess, quickErrorMessage } from "@/lib/quick/parse";

const QUICK_BASE = process.env.QUICK_API_BASE || "https://clients.quicklivraison.ma/api";

function networkError() {
  return Object.assign(new Error("Could not reach Quick Livraison. Please try again."), {
    statusCode: 502,
  });
}

function badResponseError(status) {
  return Object.assign(new Error(`Quick Livraison request failed (${status}).`), {
    statusCode: 502,
  });
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Create a delivery. `fields` are the documented `deliveries/store`
 * parameters EXCEPT `api_key`, which is added here from `credentials` so it
 * can never be supplied (or overridden) by a caller.
 */
export async function createParcel(credentials, fields, signal) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value != null) body.set(key, String(value));
  }
  body.set("api_key", String(credentials.apiKey));

  let res;
  try {
    res = await fetch(`${QUICK_BASE}/deliveries/store`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw networkError();
  }

  // A 4xx/5xx is unambiguous — no need to guess at the body shape.
  if (!res.ok) {
    return { result: "ERROR", message: `Quick Livraison request failed (${res.status}).`, raw: null };
  }

  const data = await readJson(res);
  if (!isQuickCreateSuccess(data)) {
    return { result: "ERROR", message: quickErrorMessage(data), raw: data };
  }
  return { result: "SUCCESS", raw: data };
}

/** GET getParcelDetails/{trackingCode}. Returns `{ httpStatus, body }` — parsing is the caller's job (lib/quick/parse.js). */
export async function fetchParcelDetails(credentials, trackingCode, signal) {
  let res;
  try {
    res = await fetch(
      `${QUICK_BASE}/getParcelDetails/${encodeURIComponent(trackingCode)}?api_key=${encodeURIComponent(credentials.apiKey)}`,
      { signal, cache: "no-store" }
    );
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw networkError();
  }
  const body = await readJson(res);
  return { httpStatus: res.status, body };
}

/** GET getCityIDs. No credentials involved — proxied so the browser never calls Quick directly. */
export async function fetchCities(signal) {
  let res;
  try {
    res = await fetch(`${QUICK_BASE}/getCityIDs`, { signal, cache: "no-store" });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw networkError();
  }
  if (!res.ok) throw badResponseError(res.status);
  return readJson(res);
}
