"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { FIELD, LABEL } from "@/app/_components/orders/shared";
import { useLocale } from "@/app/_components/i18n/LocaleProvider";

// A plain list for now — no geo API. Enough for the UI demo; swap for a real
// source (or the shipping provider's own city list) in the backend phase.
const CITIES = [
  "Agadir",
  "Al Hoceima",
  "Béni Mellal",
  "Berrechid",
  "Casablanca",
  "El Jadida",
  "Essaouira",
  "Fès",
  "Fquih Ben Salah",
  "Guelmim",
  "Kénitra",
  "Khemisset",
  "Khouribga",
  "Ksar El Kébir",
  "Larache",
  "Marrakech",
  "Meknès",
  "Mohammedia",
  "Nador",
  "Ouarzazate",
  "Oujda",
  "Rabat",
  "Safi",
  "Salé",
  "Settat",
  "Tanger",
  "Taza",
  "Tétouan",
  "Tiznit",
];

/**
 * A searchable "city" combobox that behaves like a normal form field — it
 * renders a real `<input name={name}>`, so it participates in the
 * surrounding `<form>`'s `FormData` exactly like any other input.
 */
export default function CitySelect({ id, name, label, required, disabled, defaultValue = "" }) {
  const { t } = useLocale();
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return CITIES;
    return CITIES.filter((city) => city.toLowerCase().includes(query));
  }, [value]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && open && filtered.length > 0) {
              event.preventDefault();
              setValue(filtered[0]);
              setOpen(false);
            }
          }}
          className={`${FIELD} pr-9`}
          placeholder={t("orderForm.searchCity")}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 8 5 5 5-5" />
        </svg>
      </div>

      {open && filtered.length > 0 ? (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {filtered.map((city) => (
            <li key={city} role="option" aria-selected={city === value}>
              <button
                type="button"
                onClick={() => {
                  setValue(city);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {city}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
