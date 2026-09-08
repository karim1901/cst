"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import NoteModal from "@/app/_components/orders/NoteModal";
import StatusBadge from "@/app/_components/orders/StatusBadge";
import { Spinner, ErrorBanner } from "@/app/_components/orders/shared";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";

const PROVIDER_LABEL = {
  ozon_express: "Ozon Express",
  quick_livraison: "Quick Livraison",
};

/**
 * Follow-up — the merchant's own manual reminder list, entirely
 * client-driven (fetch + local state) like Commission/Orders already are in
 * this app, for the same reason: the list needs interactive edit/delete
 * actions right on the page. Reads/writes GET|POST /api/order-followups and
 * PATCH|DELETE /api/order-followups/[id] — see those routes' own comments
 * for the security model (merchant-only, ownership-scoped, IDOR-safe).
 */
export default function FollowUpList() {
  const [state, setState] = useState("loading"); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/order-followups", { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Could not load your follow-up list.");
        setItems(data.followUps ?? []);
        setState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setErrorMessage(error?.message || "Could not load your follow-up list.");
        setState("error");
      });
    return () => controller.abort();
  }, []);

  async function handleSaveNote(id, note) {
    const res = await fetch(`/api/order-followups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Could not save the note.");
    }
    setItems((current) => current.map((item) => (item.id === id ? data.followUp : item)));
    setEditingId(null);
  }

  async function handleDelete(id) {
    if (!window.confirm("Remove this order from Follow-up?")) return;
    // Optimistic — the request below is the real source of truth; a
    // failure restores the item so the UI never silently disagrees with
    // the server. Deleting here ONLY ever removes the OrderFollowUp
    // record (see the DELETE route) — the underlying order is untouched.
    const removed = items.find((item) => item.id === id);
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      const res = await fetch(`/api/order-followups/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Could not remove this item.");
      }
    } catch (error) {
      if (removed) setItems((current) => [...current, removed].sort(sortByCreatedDesc));
      window.alert(error?.message || "Could not remove this item.");
    }
  }

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <Spinner />
        Loading…
      </div>
    );
  }

  if (state === "error") {
    return <ErrorBanner>{errorMessage}</ErrorBanner>;
  }

  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No orders in Follow-up
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <FollowUpCard
          key={item.id}
          item={item}
          onEdit={() => setEditingId(item.id)}
          onDelete={() => handleDelete(item.id)}
        />
      ))}

      {editingId ? (
        <NoteModal
          title="Edit Follow-up"
          saveLabel="Save Changes"
          initialNote={items.find((item) => item.id === editingId)?.note ?? ""}
          onSave={(note) => handleSaveNote(editingId, note)}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </div>
  );
}

function sortByCreatedDesc(a, b) {
  return new Date(b.createdAt) - new Date(a.createdAt);
}

function Row({ label, children }) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 flex-1 break-words font-medium text-zinc-900 dark:text-zinc-100">
        {children}
      </span>
    </div>
  );
}

function FollowUpCard({ item, onEdit, onDelete }) {
  const order = item.order;
  const providerLabel = PROVIDER_LABEL[item.provider] ?? item.provider;

  // "Open Order" reuses the Orders page's own existing provider/employee/
  // phone-search filters (see app/_components/orders/OrdersPageClient.jsx)
  // instead of a second order-details view.
  const openOrderHref = order
    ? `/dashboard/orders?${new URLSearchParams({
        provider: item.provider,
        ...(item.employee ? { employee: item.employee.id } : {}),
        ...(order.phone ? { phone: order.phone } : {}),
      }).toString()}`
    : "/dashboard/orders";

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {order?.receiverName ?? "—"}
          </p>
          {order?.phone ? (
            <a
              href={`tel:${order.phone}`}
              className="truncate text-xs text-blue-600 dark:text-blue-400"
            >
              {order.phone}
            </a>
          ) : null}
        </div>
        {item.provider === SHIPPING_PROVIDERS.OZON_EXPRESS ? (
          <StatusBadge status={order?.status} />
        ) : (
          <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {order?.status || "Unknown"}
          </span>
        )}
      </div>

      <div className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        <Row label="Provider">{providerLabel}</Row>
        <Row label="Tracking">
          <span className="break-all font-mono text-xs">{order?.trackingNumber ?? "—"}</span>
        </Row>
        <Row label="Price">{order?.price != null ? `${order.price} DH` : "—"}</Row>
        {item.employee ? <Row label="Employee">{item.employee.name}</Row> : null}
      </div>

      <div className="mt-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Note</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200" dir="auto">
          {item.note || "—"}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={openOrderHref}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Open Order
        </Link>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Edit Follow-up
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Remove from Follow-up
        </button>
      </div>
    </div>
  );
}
