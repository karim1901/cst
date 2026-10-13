/**
 * Regression tests for lib/sync/deadline-batch.js#runBatched — the shared,
 * pure batching/deadline primitive the Finance recurring-refresh fix relies
 * on (lib/returns/sync.js#syncOneProviderPeriodForMerchant /
 * lib/sync/period-sync.js, and also lib/ozon/auto-reconcile.js's own
 * once-daily cron budget, now consolidated onto this one implementation
 * instead of two independently-maintained copies).
 *
 * Pure/dependency-free — `lib/sync/deadline-batch.js` has zero imports — so
 * this runs with plain `node`, no DB, no network, no timers library beyond
 * real (short) `setTimeout` delays to simulate work taking real time.
 *
 * Run with:  node scripts/verify-deadline-batch.mjs
 */

import { runBatched } from "../lib/sync/deadline-batch.js";

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${ok ? "" : ` - got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log("== no deadline: every item is attempted, nothing skipped ==");
{
  const processed = [];
  const skipped = await runBatched([1, 2, 3, 4, 5], async (item) => {
    processed.push(item);
  }, 2);
  eq("all 5 processed", processed.sort(), [1, 2, 3, 4, 5]);
  eq("skipped is empty", skipped, []);
}

console.log("\n== deadline already passed before the first batch: nothing is attempted ==");
{
  const processed = [];
  const skipped = await runBatched(
    ["a", "b", "c"],
    async (item) => {
      processed.push(item);
    },
    1,
    { deadline: Date.now() - 1000 }
  );
  eq("nothing processed", processed, []);
  eq("everything skipped", skipped, ["a", "b", "c"]);
}

console.log("\n== deadline expires BETWEEN batches: already-started batches still finish, the rest is skipped ==");
{
  const processed = [];
  // batchSize=1, each item takes 30ms; deadline set to expire after ~45ms —
  // enough for item 1 (and the deadline check before item 2) but item 2's
  // own batch should still be allowed to finish once started, and
  // everything after the deadline check fails should be skipped.
  const deadline = Date.now() + 45;
  const skipped = await runBatched(
    [1, 2, 3, 4, 5],
    async (item) => {
      await delay(30);
      processed.push(item);
    },
    1,
    { deadline }
  );
  eq("at least the first item was processed before the deadline stopped new batches", processed[0], 1);
  eq("not everything ran — the deadline genuinely stopped some", processed.length < 5, true);
  eq("processed + skipped covers every original item exactly once", [...processed, ...skipped].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
}

console.log("\n== a worker's own error never stops the batch — later items still run ==");
{
  const processed = [];
  const originalConsoleError = console.error;
  console.error = () => {}; // expected failure log — keep test output clean
  const skipped = await runBatched(
    [1, 2, 3],
    async (item) => {
      if (item === 2) throw new Error("simulated failure for item 2");
      processed.push(item);
    },
    1
  );
  console.error = originalConsoleError;
  eq("item 1 and 3 still processed despite item 2 throwing", processed.sort(), [1, 3]);
  eq("nothing skipped — every item was still attempted", skipped, []);
}

console.log("\n== onlyActorIds-style resumption: skipped items from one call feed the next call's input unchanged ==");
{
  const processed = [];
  const firstSkipped = await runBatched(
    ["m", "e1", "e2", "e3"],
    async (item) => {
      await delay(10);
      processed.push(item);
    },
    1,
    { deadline: Date.now() + 15 } // enough for ~1 item
  );
  eq("first call made some progress and left the rest for resumption", firstSkipped.length > 0 && firstSkipped.length < 4, true);

  const secondSkipped = await runBatched(
    firstSkipped,
    async (item) => {
      processed.push(item);
    },
    1
  );
  eq("the resumed call (no deadline) finishes everything left over", secondSkipped, []);
  eq("every original item was processed exactly once across both calls, nothing duplicated", [...new Set(processed)].length, processed.length);
  eq("every original item is accounted for", processed.sort(), ["e1", "e2", "e3", "m"]);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
