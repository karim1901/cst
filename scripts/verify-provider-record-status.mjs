/**
 * Regression tests for provider-deletion reconciliation — the "an order
 * deleted at Ozon/Quick keeps charging Finance forever" bug.
 *
 * Pure logic: `lib/orders/provider-record-status.js#reconciliationAction`
 * is the single shared rule lib/orders/reconcile-stale-orders.js,
 * lib/quick/reconcile-current-month.js, lib/commission/sync-historical-orders.js
 * and lib/quick/sync-order.js all defer to — zero `@/` imports, zero
 * mongoose, runs with plain `node`.
 *
 * Run with:  node scripts/verify-provider-record-status.mjs
 */

import {
  PROVIDER_RECORD_STATUSES,
  PROVIDER_RECORD_STATUS_VALUES,
  ACTIVE_PROVIDER_ORDER_FILTER,
  reconciliationAction,
} from "../lib/orders/provider-record-status.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

console.log("== constants ==");
eq("PROVIDER_RECORD_STATUSES has exactly active/deleted", [...PROVIDER_RECORD_STATUS_VALUES].sort(), ["active", "deleted"]);
eq("ACTIVE_PROVIDER_ORDER_FILTER is a $ne (matches missing field too)", ACTIVE_PROVIDER_ORDER_FILTER, { $ne: "deleted" });

console.log("\n== a provider CONFIRMS the order does not exist (\"not_found\") ==");
eq(
  "currently active -> markDeleted",
  reconciliationAction({ classification: "not_found", currentStatus: PROVIDER_RECORD_STATUSES.ACTIVE }),
  { action: "markDeleted" }
);
eq(
  "legacy row, no value at all (undefined) -> markDeleted (treated as active, same as ACTIVE_PROVIDER_ORDER_FILTER)",
  reconciliationAction({ classification: "not_found", currentStatus: undefined }),
  { action: "markDeleted" }
);
eq(
  "null -> markDeleted (same reason)",
  reconciliationAction({ classification: "not_found", currentStatus: null }),
  { action: "markDeleted" }
);
eq(
  "already deleted -> none (nothing changes, no redundant write)",
  reconciliationAction({ classification: "not_found", currentStatus: PROVIDER_RECORD_STATUSES.DELETED }),
  { action: "none" }
);

console.log("\n== a provider CONFIRMS the order still exists (\"exists\") ==");
eq(
  "already active -> none (status/price refresh is a separate concern)",
  reconciliationAction({ classification: "exists", currentStatus: PROVIDER_RECORD_STATUSES.ACTIVE }),
  { action: "none" }
);
eq(
  "legacy/undefined -> none",
  reconciliationAction({ classification: "exists", currentStatus: undefined }),
  { action: "none" }
);
eq(
  "previously marked deleted, now rediscovered -> revive",
  reconciliationAction({ classification: "exists", currentStatus: PROVIDER_RECORD_STATUSES.DELETED }),
  { action: "revive" }
);

console.log("\n== a TEMPORARY API/network failure (\"unknown\") NEVER changes anything ==");
eq(
  "unknown + active -> none (never a false deletion)",
  reconciliationAction({ classification: "unknown", currentStatus: PROVIDER_RECORD_STATUSES.ACTIVE }),
  { action: "none" }
);
eq(
  "unknown + deleted -> none (never a false revival either)",
  reconciliationAction({ classification: "unknown", currentStatus: PROVIDER_RECORD_STATUSES.DELETED }),
  { action: "none" }
);
eq(
  "unknown + legacy/undefined -> none",
  reconciliationAction({ classification: "unknown", currentStatus: undefined }),
  { action: "none" }
);

console.log("\n== full lifecycle: active -> deleted -> revived -> deleted again ==");
{
  let status = PROVIDER_RECORD_STATUSES.ACTIVE;
  const apply = (classification) => {
    const { action } = reconciliationAction({ classification, currentStatus: status });
    if (action === "markDeleted") status = PROVIDER_RECORD_STATUSES.DELETED;
    else if (action === "revive") status = PROVIDER_RECORD_STATUSES.ACTIVE;
    return action;
  };

  eq("order deleted at provider -> markDeleted", apply("not_found"), "markDeleted");
  eq("status is now deleted", status, "deleted");

  eq("a temporary failure while deleted -> none, stays deleted", apply("unknown"), "none");
  eq("still deleted after a transient failure", status, "deleted");

  eq("provider re-confirms it later (recreated) -> revive", apply("exists"), "revive");
  eq("status is active again", status, "active");

  eq("deleted a second time -> markDeleted again", apply("not_found"), "markDeleted");
  eq("deleted again", status, "deleted");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
