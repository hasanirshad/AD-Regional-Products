import type { MarketDef } from "../../shared/constants";
import { adminBase, shopHandle } from "../../shared/admin";
import { numericId } from "../../shared/pure";
import type { LoadContext } from "../../shared/query";
import { defaultSettings, marketDefs, settingsOf } from "../../shared/settings";

export type Link = { key: string; label: string; url: string };
export type Data = { status: string; storefront: Link[]; preview: Link | null; orders: Link; adminProduct: string };

const QUERY = `query QuickLinks($id: ID!) {
  shop { myshopifyDomain }
  product(id: $id) { id handle status }
}`;

export function storefrontUrl(def: Pick<MarketDef, "domain" | "stayUs">, handle: string, extra: string[] = []): string {
  const params = [...extra, ...(def.stayUs ? ["stay_us=1"] : [])];
  return `https://${def.domain}/products/${handle}${params.length ? `?${params.join("&")}` : ""}`;
}

export function buildLinks(input: { handle: string; status: string; shop: string; productId: string; themeId?: string; markets?: MarketDef[]; previewKey?: string }): Data {
  const defaults = defaultSettings();
  const markets = input.markets ?? marketDefs(defaults);
  const themeId = input.themeId ?? defaults.links.previewThemeId;
  const previewDef = markets.find((m) => m.key === (input.previewKey ?? defaults.links.previewMarket)) ?? markets[0];
  const base = adminBase(input.shop);
  const id = numericId(input.productId);
  return {
    status: input.status,
    storefront: markets.map((m) => ({ key: m.key, label: m.label, url: storefrontUrl(m, input.handle) })),
    preview: themeId && previewDef ? { key: "preview", label: `Preview theme (${previewDef.key} domain)`, url: storefrontUrl(previewDef, input.handle, [`preview_theme_id=${encodeURIComponent(themeId)}`]) } : null,
    orders: { key: "orders", label: "Orders containing this product", url: `${base}/orders?query=${encodeURIComponent(`product_id:${id}`)}` },
    adminProduct: `${base}/products/${id}`,
  };
}

export async function load(ctx: LoadContext): Promise<Data> {
  const { productId, q } = ctx;
  const settings = settingsOf(ctx);
  const d = await q<{ shop: { myshopifyDomain: string }; product: { handle: string; status: string } | null }>(QUERY, { id: productId });
  if (!d.product) throw new Error("Product not found");
  return buildLinks({ handle: d.product.handle, status: d.product.status, shop: shopHandle(d.shop.myshopifyDomain), productId, themeId: settings.links.previewThemeId, markets: marketDefs(settings), previewKey: settings.links.previewMarket });
}
