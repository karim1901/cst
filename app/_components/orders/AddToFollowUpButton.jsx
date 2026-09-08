"use client";

import { useState } from "react";

import NoteModal from "@/app/_components/orders/NoteModal";

/**
 * "Add to Follow-up" / "Added to Follow-up" — every order card's entry
 * point into Follow-up, merchant-only (see
 * app/api/order-followups/route.js's module comment for why). Identifies
 * the order by `{provider,
 * trackingNumber}` — see that route for why, not a raw database id — so
 * this works uniformly on a card from any of the three Orders-page listing
 * surfaces (live Ozon/Quick streams, or the local-DB "all employees"
 * browser) without each needing to know an internal Order id.
 *
 * `isFollowedUp` comes from the parent (built once from GET
 * /api/order-followups — see OrdersPageClient.jsx), so this never makes an
 * extra "is this followed up" request per card.
 */
export default function AddToFollowUpButton({ provider, trackingNumber, isFollowedUp, onAdded }) {
  const [open, setOpen] = useState(false);

  if (isFollowedUp) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        Added to Follow-up
      </span>
    );
  }

  async function handleSave(note) {
    const res = await fetch("/api/order-followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, trackingNumber, note }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Could not add this order to follow-up.");
    }
    setOpen(false);
    onAdded?.(trackingNumber, data.followUp);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 active:bg-zinc-200 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Add to Follow-up
      </button>
      {open ? (
        <NoteModal
          title="Add to Follow-up"
          description={trackingNumber}
          saveLabel="Save"
          onSave={handleSave}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
