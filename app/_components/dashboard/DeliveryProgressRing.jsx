"use client";

import { useLocale } from "@/app/_components/i18n/LocaleProvider";

/**
 * Green/red donut showing the Livré vs. Retour split. Plain SVG + a little
 * geometry — no charting library, since two arcs is well within what SVG
 * handles on its own.
 *
 * Colors reuse the same semantic emerald/red already used by
 * app/_components/orders/StatusBadge.jsx (green = delivered, red =
 * returned) rather than introducing a new palette.
 */

const SIZE = 160;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function DeliveryProgressRing({ delivered, returned }) {
  const { t } = useLocale();
  const resolved = delivered + returned;

  if (resolved === 0) {
    return (
      <div
        role="img"
        aria-label={t("dashboard.noData")}
        className="relative mx-auto flex h-40 w-40 items-center justify-center"
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-zinc-100 dark:stroke-zinc-800"
          />
        </svg>
        <span className="absolute text-xs font-medium text-zinc-400 dark:text-zinc-500">
          {t("dashboard.noData")}
        </span>
      </div>
    );
  }

  const deliveredRate = delivered / resolved;
  const deliveredLength = deliveredRate * CIRCUMFERENCE;
  const returnedLength = CIRCUMFERENCE - deliveredLength;
  const deliveredPercent = Math.round(deliveredRate * 100);

  return (
    <div
      role="img"
      aria-label={`${deliveredPercent}% delivered, ${100 - deliveredPercent}% returned`}
      className="relative mx-auto flex h-40 w-40 items-center justify-center"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        {/* Track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-zinc-100 dark:stroke-zinc-800"
        />
        {/* Returned (red) — drawn first, covers the full remainder */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${returnedLength} ${CIRCUMFERENCE - returnedLength}`}
          strokeDashoffset={-deliveredLength}
          className="stroke-red-500"
        />
        {/* Delivered (green) — drawn on top, starting at the top of the circle */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${deliveredLength} ${CIRCUMFERENCE - deliveredLength}`}
          className="stroke-emerald-500"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {deliveredPercent}%
        </span>
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("dashboard.delivered")}</span>
      </div>
    </div>
  );
}
