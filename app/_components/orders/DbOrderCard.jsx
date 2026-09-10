"use client";

import StatusBadge from "@/app/_components/orders/StatusBadge";
import AddToFollowUpButton from "@/app/_components/orders/AddToFollowUpButton";
import { SHIPPING_PROVIDERS } from "@/lib/shipping/providers";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

/**
 * One order card rendered from the LOCAL DB shape (the flat
 * `{ trackingNumber, receiver, phone, city, address, product, price,
 * status, employee, createdAt, updatedAt }` object returned by
 * app/api/orders and app/api/orders/search). Shared by the "All employees"
 * browser (OrdersBrowser) and the Orders-page search results
 * (OrdersSearchResults) so both use ONE card, identical to the rest of the
 * Orders page — not a second order UI.
 *
 * Every value shown is real business data, rendered verbatim: customer /
 * employee names, phone, address, product, provider name, tracking number.
 * Only the row LABELS and the empty-status fallback are static UI text.
 */
function Row({ label, children }) {
  return (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="w-24 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 flex-1 break-words font-medium text-zinc-900 dark:text-zinc-100">
        {children}
      </span>
    </div>
  );
}

export default function DbOrderCard({ order, provider, isFollowedUp, onFollowUpAdded }) {
  const { t, locale } = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const fmtDate = (value) => (value ? dateFormatter.format(new Date(value)) : "—");
  // Company name — shown verbatim, never translated / transliterated.
  const providerName = provider === SHIPPING_PROVIDERS.OZON_EXPRESS ? "Ozon Express" : "Quick Livraison";

  return (
    <div className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-start justify-between gap-3">
        {/* tracking number — real data, verbatim */}
        <span className="min-w-0 break-all font-mono text-sm text-zinc-700 dark:text-zinc-300">
          {order.trackingNumber}
        </span>
        {provider === SHIPPING_PROVIDERS.OZON_EXPRESS ? (
          <StatusBadge status={order.status} />
        ) : (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {order.status || t("returns.unknown")}
          </span>
        )}
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {order.employee ? <Row label={t("common.employee")}>{order.employee.name}</Row> : null}
        <Row label={t("providers.shippingCompany")}>{providerName}</Row>
        <Row label={t("orderForm.clientName")}>{order.receiver}</Row>
        <Row label={t("orderForm.phone")}>
          <a href={`tel:${order.phone ?? ""}`} className="text-blue-600 dark:text-blue-400">
            {order.phone}
          </a>
        </Row>
        {order.city ? <Row label={t("orderForm.city")}>{order.city}</Row> : null}
        {order.address ? <Row label={t("orderForm.address")}>{order.address}</Row> : null}
        <Row label={t("orderForm.productName")}>
          {order.product}
          {order.quantity != null ? ` × ${order.quantity}` : ""}
        </Row>
        <Row label={t("orderForm.price")}>{order.price != null ? `${order.price} DH` : "—"}</Row>
        {order.note ? <Row label={t("followUp.note")}>{order.note}</Row> : null}
        <Row label={t("returns.created")}>{fmtDate(order.createdAt)}</Row>
        {order.updatedAt ? (
          <Row label={t("returns.lastUpdated")}>{fmtDate(order.updatedAt)}</Row>
        ) : null}
      </div>

      {isFollowedUp ? (
        <div className="mt-3">
          <AddToFollowUpButton
            provider={provider}
            trackingNumber={order.trackingNumber}
            isFollowedUp={isFollowedUp(order.trackingNumber)}
            onAdded={onFollowUpAdded}
          />
        </div>
      ) : null}
    </div>
  );
}
