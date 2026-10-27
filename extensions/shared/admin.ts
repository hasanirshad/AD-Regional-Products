// Addresses for links. Built from the shop's myshopify domain (asked for inside each block's own query).
import { numericId } from "./graphql";

export const shopHandle = (myshopifyDomain: string) => myshopifyDomain.replace(/\.myshopify\.com$/, "");
export const adminBase = (handle: string) => `https://admin.shopify.com/store/${handle}`;
export const adminCollectionUrl = (handle: string, gid: string) => `${adminBase(handle)}/collections/${numericId(gid)}`;
export const adminProductUrl = (handle: string, gid: string) => `${adminBase(handle)}/products/${numericId(gid)}`;
