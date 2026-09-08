"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { FIELD, LABEL } from "@/app/_components/orders/shared";

/**
 * Quick Livraison's city/district combobox. Like Ozon Express, Quick's
 * `deliveries/store` API expects `district_id` — a provider-specific
 * numeric identifier, not a free-text name — so this shows district names
 * but submits the matching id through a hidden input, fetched live from our
 * `/api/orders/quick/cities` proxy (never Quick directly). Mirrors
 * OzonCitySelect.jsx; kept as its own component since the two providers'
 * city lists/ids are unrelated to each other.
 */
export default function QuickDistrictSelect({
  id = "city",
  name = "city",
  label = "City",
  required,
  disabled,
}) {
  const [cities, setCities] = useState([]); // [{ id, name }]
  const [loadState, setLoadState] = useState("loading"); // loading | ready | error
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/orders/quick/cities", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load cities.");
        return res.json();
      })
      .then((data) => {
        setCities(Array.isArray(data?.cities) ? data.cities : []);
        setLoadState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setLoadState("error");
      });
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cities;
    return cities.filter((city) => city.name.toLowerCase().includes(q));
  }, [cities, query]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const isDisabled = disabled || loadState === "loading";

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>

      {/* The value Quick actually needs — the district's id, not its name. */}
      <input type="hidden" name={name} value={selectedId} />

      <div className="relative mt-1">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          autoComplete="off"
          required={required}
          disabled={isDisabled}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedId("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && open && filtered.length > 0) {
              event.preventDefault();
              setQuery(filtered[0].name);
              setSelectedId(filtered[0].id);
              setOpen(false);
            }
          }}
          className={`${FIELD} pr-9`}
          placeholder={loadState === "loading" ? "Loading cities…" : "Search city"}
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

      {loadState === "error" ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          Could not load the city list. Please try again.
        </p>
      ) : null}

      {open && filtered.length > 0 ? (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {filtered.map((city) => (
            <li key={city.id} role="option" aria-selected={city.id === selectedId}>
              <button
                type="button"
                onClick={() => {
                  setQuery(city.name);
                  setSelectedId(city.id);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {city.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
