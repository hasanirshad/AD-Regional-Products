// The `shopify` global that Shopify provides to every product-details block.
import type { Api } from "@shopify/ui-extensions/admin.product-details.block.render";

declare global {
  const shopify: Api;
}

export {};
