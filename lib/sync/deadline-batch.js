/**
 * Shared, pure, dependency-free batching helper — process `items` in
 * concurrent groups of `batchSize`, optionally stopping before starting a
 * new group once `deadline` (a `Date.now()`-comparable timestamp) has
 * passed. Used by lib/ozon/auto-reconcile.js (the once-daily cron's own
 * per-merchant time budget) and lib/returns/sync.js (the on-demand
 * Finance-period sync's own per-invocation work budget — see
 * lib/sync/period-sync.js for why that one needs to be resumable across
 * several short calls instead of one long one) — ONE implementation, not
 * two independently-maintained copies of the same deadline logic.
 *
 * A worker's own failure is caught, logged, and never stops the batch —
 * the caller gets no signal that a specific item failed unless its own
 * `worker` tracks that itself (e.g. by incrementing a counter before
 * re-throwing, which this still lets propagate into the catch below for
 * logging).
 *
 * @param {Array<T>} items
 * @param {(item: T) => Promise<void>} worker
 * @param {number} batchSize
 * @param {{deadline?: number}} [options] `deadline` — a `Date.now()`-style
 *   timestamp; once reached, no further batch is STARTED (an
 *   already-in-flight batch always finishes) and every remaining item is
 *   returned in `skipped`, untouched.
 * @returns {Promise<Array<T>>} `skipped` — items never attempted because
 *   the deadline was reached first; empty if every item was attempted.
 * @template T
 */
export async function runBatched(items, worker, batchSize, { deadline } = {}) {
  const skipped = [];
  for (let i = 0; i < items.length; i += batchSize) {
    if (deadline != null && Date.now() >= deadline) {
      skipped.push(...items.slice(i));
      break;
    }
    const batch = items.slice(i, i + batchSize);
    await Promise.all(
      batch.map((item) =>
        Promise.resolve(worker(item)).catch((err) => {
          console.error("[runBatched]", item, "-", err?.message);
        })
      )
    );
  }
  return skipped;
}
