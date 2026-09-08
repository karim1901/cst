/**
 * Shipping-provider ids — kept independent of the Mongoose model (same
 * reason as lib/auth/roles.js) so client components can import them without
 * pulling in mongoose/mongodb's Node-only dependency graph.
 * models/ShippingCompany.js re-exports these as its single source of truth;
 * nothing here is redefined anywhere else.
 */
export const SHIPPING_PROVIDERS = Object.freeze({
  OZON_EXPRESS: "ozon_express",
  QUICK_LIVRAISON: "quick_livraison",
});

export const SHIPPING_PROVIDER_VALUES = Object.freeze(Object.values(SHIPPING_PROVIDERS));
