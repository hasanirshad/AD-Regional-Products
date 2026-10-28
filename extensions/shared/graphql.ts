// Re-exports the query code and adds the one thing that needs the `shopify` global.
export * from "./query";

/** The product the merchant is looking at. */
export function selectedProductId(): string | null {
  try {
    const id = shopify.data.selected?.[0]?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

export { aliasOf, countryEnum, gqlString, localeLiteral, numericId } from "./pure";
