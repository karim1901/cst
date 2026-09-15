import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Force a genuine per-request invocation — never a cached/edge-served
// response — so this is real proof the request actually reached THIS
// running instance, not a stale CDN/ISR copy (see the deployment
// investigation's own "prove it, don't assume it" requirement).
export const dynamic = "force-dynamic";

/**
 * Production-safe deployment/version diagnostic.
 *
 * THE reason this exists: "the new deployment exists in Vercel" is not
 * proof the Production domain is actually serving it — the only real proof
 * is comparing the latest GitHub commit SHA against what THIS endpoint
 * reports when hit on the real production domain. Every field below comes
 * from Vercel's own automatically-injected "System Environment Variables"
 * (https://vercel.com/docs/projects/environment-variables/system-environment-variables)
 * — no configuration needed on Vercel's side, and nothing here is a secret:
 * commit SHA/branch/deployment id/url are already public in the GitHub
 * history and the Vercel dashboard. Locally (`next dev`/no Vercel context)
 * every Vercel-sourced field is simply `null` — never fabricated.
 *
 * NEVER add anything here that isn't already public (no API keys, no
 * MONGODB_URI, no JWT/encryption secrets, no decrypted credentials).
 */

// Evaluated once when this route's module is first loaded (module scope,
// not per-request) — see the response field's own comment below for what
// this timestamp actually means and why.
const INSTANCE_STARTED_AT = new Date().toISOString();

export async function GET() {
  return NextResponse.json({
    environment: process.env.VERCEL_ENV ?? "development",
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    commitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
    repo: process.env.VERCEL_GIT_REPO_SLUG ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    deploymentUrl: process.env.VERCEL_URL ?? null,
    // When this specific running server instance came up (a cold start) —
    // NOT the literal `next build` timestamp (Vercel does not expose one as
    // a runtime env var). For the first requests after a fresh deployment
    // this closely tracks the real deploy time; on a long-lived warm
    // instance it stays fixed at that instance's own start, which is still
    // exactly what you want when confirming "is this still an old,
    // never-replaced instance still answering requests".
    instanceStartedAt: INSTANCE_STARTED_AT,
  });
}
