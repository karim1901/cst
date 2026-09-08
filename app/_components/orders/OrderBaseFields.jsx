import CitySelect from "@/app/_components/orders/CitySelect";
import { FIELD, LABEL } from "@/app/_components/orders/shared";

/**
 * The fields every order needs regardless of shipping provider — modelled
 * after the reference design (client name, phone, city, address, price,
 * product). Rendered inside each provider's own `<form>`, so it stays a
 * plain, uncontrolled set of inputs read via `FormData` on submit, same as
 * the rest of the app's forms.
 *
 * `citySlot` lets a provider swap in its own city field — Ozon Express needs
 * a live, ID-based combobox (see OzonCitySelect) instead of the generic
 * free-text `CitySelect` used here by default, since its API expects a
 * provider-specific numeric city id, not a name. Omitting it keeps the
 * original behaviour exactly (used by Quick Livraison, unchanged).
 */
export default function OrderBaseFields({ disabled, citySlot }) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="customerName" className={LABEL}>
          Client name
        </label>
        <input
          id="customerName"
          name="customerName"
          type="text"
          required
          disabled={disabled}
          className={FIELD}
          placeholder="Name Client"
        />
      </div>

      <div>
        <label htmlFor="phone" className={LABEL}>
          Phone
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          disabled={disabled}
          className={FIELD}
          placeholder="Phone"
        />
      </div>

      {citySlot ?? <CitySelect id="city" name="city" label="City" required disabled={disabled} />}

      <div>
        <label htmlFor="address" className={LABEL}>
          Address
        </label>
        <input
          id="address"
          name="address"
          type="text"
          required
          disabled={disabled}
          className={FIELD}
          placeholder="Address"
        />
      </div>

      <div>
        <label htmlFor="price" className={LABEL}>
          Price (DH)
        </label>
        <input
          id="price"
          name="price"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          required
          disabled={disabled}
          className={FIELD}
          placeholder="Price"
        />
      </div>

      <div>
        <label htmlFor="productName" className={LABEL}>
          Product name
        </label>
        <input
          id="productName"
          name="productName"
          type="text"
          required
          disabled={disabled}
          className={FIELD}
          placeholder="Name Product"
        />
      </div>
    </div>
  );
}
