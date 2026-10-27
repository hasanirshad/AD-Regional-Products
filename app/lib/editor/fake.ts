// A fake Shopify for the tests (not used by the app). It answers the editor's queries and mutations from an in-memory
// store, so the real load, read, apply and run code can be tested without a network. It can also misbehave on purpose:
// refuse an operation (`failOn`) or say "ok" and change nothing (`ignore`), which is what read-back must catch.

import type { Gql } from "./gql";

export type FakeVariant = {
  id: string;
  title: string;
  position: number;
  price: string;
  compareAtPrice: string | null;
  barcode: string | null;
  inventoryPolicy: "DENY" | "CONTINUE";
  selectedOptions: { name: string; value: string }[];
  itemId: string;
  sku: string | null;
  tracked: boolean;
  /** location id -> available */
  levels: Record<string, number>;
  metafields: Record<string, { id: string; type: string; value: string }>;
};

export type FakeProduct = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string;
  status: string;
  productType: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  category: { id: string; name: string } | null;
  options: { name: string; values: string[] }[];
  variants: FakeVariant[];
  metafields: Record<string, { id: string; type: string; value: string }>;
};

export type FakeTranslation = { value: string; outdated: boolean };

export class FakeShopify {
  products = new Map<string, FakeProduct>();
  /** resource id -> key -> locale/market -> translation */
  translations = new Map<string, Map<string, Map<string, FakeTranslation>>>();
  /** resource id -> key -> source text */
  sources = new Map<string, Map<string, string>>();
  calls: { op: string; variables: Record<string, unknown> }[] = [];
  /** owner id -> key -> value, for the app-owned metafields ("$app"). */
  appData = new Map<string, Map<string, string>>();
  installationId = "gid://shopify/AppInstallation/1";
  failOn = new Map<string, string>();
  ignore = new Set<string>();
  collections = new Map<string, { title: string; productIds: string[] }>();
  locales = [
    { locale: "en", name: "English", primary: true, published: true },
    { locale: "fr", name: "French", primary: false, published: true },
    { locale: "de", name: "German", primary: false, published: true },
  ];
  locations = [{ id: "gid://shopify/Location/1", name: "Lahore warehouse" }];
  definitions: { id: string; ownerType: string; namespace: string; key: string; name: string; description?: string; type: { name: string }; validations?: { name: string; value: string | null }[] }[] = [];
  categories = [{ id: "gid://shopify/TaxonomyCategory/hg-3-1", name: "Dining Tables", fullName: "Home & Garden > Furniture > Tables > Dining Tables", isLeaf: true }];
  private nextId = 1000;

  constructor(products: FakeProduct[] = []) {
    for (const p of products) this.add(p);
  }

  add(p: FakeProduct): void {
    this.products.set(p.id, p);
    this.setSource(p.id, "title", p.title);
    if (p.descriptionHtml) this.setSource(p.id, "body_html", p.descriptionHtml);
    if (p.seoTitle) this.setSource(p.id, "meta_title", p.seoTitle);
    if (p.seoDescription) this.setSource(p.id, "meta_description", p.seoDescription);
    this.setSource(p.id, "handle", p.handle);
    if (p.productType) this.setSource(p.id, "product_type", p.productType);
    for (const m of Object.values(p.metafields)) this.setSource(m.id, "value", m.value);
    for (const v of p.variants) for (const m of Object.values(v.metafields)) this.setSource(m.id, "value", m.value);
  }

  setSource(resourceId: string, key: string, value: string): void {
    if (!this.sources.has(resourceId)) this.sources.set(resourceId, new Map());
    this.sources.get(resourceId)!.set(key, value);
  }

  setTranslation(resourceId: string, key: string, slot: string, value: string, outdated = false): void {
    const byKey = this.translations.get(resourceId) ?? new Map();
    this.translations.set(resourceId, byKey);
    const bySlot = byKey.get(key) ?? new Map();
    byKey.set(key, bySlot);
    bySlot.set(slot, { value, outdated });
  }

  translation(resourceId: string, key: string, slot: string): string | undefined {
    return this.translations.get(resourceId)?.get(key)?.get(slot)?.value;
  }

  private digestOf(resourceId: string, key: string): string {
    return `digest:${this.sources.get(resourceId)?.get(key) ?? ""}`;
  }

  count(op: string): number {
    return this.calls.filter((c) => c.op === op).length;
  }

  gql: Gql = async <T,>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "Unknown";
    this.calls.push({ op, variables });
    const failure = this.failOn.get(op);
    if (failure) {
      if (failure.startsWith("throw:")) throw new Error(failure.slice(6));
      return this.userError(op, failure) as T;
    }
    return this.answer(op, query, variables) as T;
  };

  private userError(op: string, message: string): unknown {
    const root = op.replace("Editor", "");
    const key = { ProductCreate: "productCreate", OptionsCreate: "productOptionsCreate", SaveSetting: "metafieldsSet", ProductUpdate: "productUpdate", VariantsUpdate: "productVariantsBulkUpdate", MetafieldsSet: "metafieldsSet", MetafieldsDelete: "metafieldsDelete", StockSet: "inventorySetQuantities", TranslationsRegister: "translationsRegister", TranslationsRemove: "translationsRemove" }[root] ?? root;
    return { [key]: { userErrors: [{ field: ["x"], message }] } };
  }

  private variantById(id: string): { p: FakeProduct; v: FakeVariant } | undefined {
    for (const p of this.products.values()) {
      const v = p.variants.find((x) => x.id === id);
      if (v) return { p, v };
    }
    return undefined;
  }

  private ownerMetafields(ownerId: string): Record<string, { id: string; type: string; value: string }> | undefined {
    return this.products.get(ownerId)?.metafields ?? this.variantById(ownerId)?.v.metafields;
  }

  private answer(op: string, query: string, vars: Record<string, unknown>): unknown {
    switch (op) {
      case "EditorProduct": {
        const p = this.products.get(vars.id as string);
        if (!p) return { product: null };
        return {
          product: {
            id: p.id,
            title: p.title,
            handle: p.handle,
            descriptionHtml: p.descriptionHtml,
            vendor: p.vendor,
            status: p.status,
            productType: p.productType,
            tags: p.tags,
            seo: { title: p.seoTitle, description: p.seoDescription },
            category: p.category,
            options: p.options.map((o) => ({ name: o.name, optionValues: o.values.map((n) => ({ name: n })) })),
            variantsCount: { count: p.variants.length },
            metafields: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: Object.entries(p.metafields).map(([k, m]) => ({ id: m.id, namespace: k.split(".")[0], key: k.split(".").slice(1).join("."), type: m.type, value: m.value, compareDigest: `cd:${m.value}` })) },
          },
        };
      }
      case "EditorVariants": {
        const p = this.products.get(vars.id as string);
        if (!p) return { product: null };
        return {
          product: {
            variants: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: p.variants.map((v) => ({
                id: v.id,
                title: v.title,
                position: v.position,
                price: v.price,
                compareAtPrice: v.compareAtPrice,
                barcode: v.barcode,
                inventoryPolicy: v.inventoryPolicy,
                selectedOptions: v.selectedOptions,
                inventoryItem: {
                  id: v.itemId,
                  tracked: v.tracked,
                  sku: v.sku,
                  inventoryLevels: { nodes: Object.entries(v.levels).map(([loc, q]) => ({ location: { id: loc }, quantities: [{ name: "available", quantity: q }] })) },
                },
              })),
            },
          },
        };
      }
      case "EditorVariantMetafields":
      case "ReadMetafields": {
        const aliases = [...query.matchAll(/m(\d+): metafield\(namespace: ("(?:[^"\\]|\\.)*"), key: ("(?:[^"\\]|\\.)*")\)/g)].map((m) => ({ alias: `m${m[1]}`, ns: JSON.parse(m[2]!) as string, key: JSON.parse(m[3]!) as string }));
        const nodes = (vars.ids as string[]).map((id) => {
          const mfs = this.ownerMetafields(id);
          if (!mfs) return null;
          const node: Record<string, unknown> = { id };
          for (const a of aliases) {
            const m = mfs[`${a.ns}.${a.key}`];
            node[a.alias] = m ? { id: m.id, type: m.type, value: m.value, compareDigest: `cd:${m.value}` } : null;
          }
          return node;
        });
        return { nodes };
      }
      case "EditorShop":
        return { shop: { name: "Hardman", myshopifyDomain: "hardman.myshopify.com", currencyCode: "GBP" }, shopLocales: this.locales, locations: { nodes: this.locations } };
      case "EditorDefinitions":
        return { metafieldDefinitions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: this.definitions.filter((d) => d.ownerType === vars.ownerType) } };
      case "EditorSearch": {
        const q = String(vars.query).toLowerCase();
        const words = [...q.matchAll(/title:([^*]+)\*/g)].map((m) => m[1]!.trim());
        const nodes = [...this.products.values()]
          .filter((p) => words.some((w) => p.title.toLowerCase().includes(w)) || [...q.matchAll(/sku:([^*)]+)\*/g)].some((m) => p.variants.some((v) => (v.sku ?? "").toLowerCase().startsWith(m[1]!))))
          .map((p) => ({ id: p.id, title: p.title, handle: p.handle, status: p.status, vendor: p.vendor, productType: p.productType }));
        return { products: { nodes } };
      }
      case "EditorCategories":
        return { taxonomy: { categories: { nodes: this.categories.filter((c) => c.fullName.toLowerCase().includes(String(vars.search).toLowerCase())) } } };
      case "BulkSingleVariants":
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const p = this.products.get(id);
            return p ? { id, variants: { nodes: p.variants.slice(0, 2).map((v) => ({ id: v.id })) } } : null;
          }),
        };
      case "BulkCollections":
        return { collections: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [...this.collections.entries()].map(([id, c]) => ({ id, title: c.title })) } };
      case "BulkCollectionProducts": {
        const c = this.collections.get(vars.id as string);
        return { collection: c ? { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: c.productIds.map((id) => ({ id })) } } : null };
      }
      case "ReadProductFields":
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const p = this.products.get(id);
            return p
              ? { id, title: p.title, handle: p.handle, descriptionHtml: p.descriptionHtml, vendor: p.vendor, status: p.status, productType: p.productType, tags: p.tags, seo: { title: p.seoTitle, description: p.seoDescription }, category: p.category }
              : null;
          }),
        };
      case "ReadVariantFields":
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const f = this.variantById(id);
            return f ? { id, price: f.v.price, compareAtPrice: f.v.compareAtPrice, barcode: f.v.barcode, inventoryPolicy: f.v.inventoryPolicy, inventoryItem: { tracked: f.v.tracked, sku: f.v.sku } } : null;
          }),
        };
      case "ReadStock":
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const f = this.variantById(id);
            return f ? { id, inventoryItem: { inventoryLevels: { nodes: Object.entries(f.v.levels).map(([loc, q]) => ({ location: { id: loc }, quantities: [{ name: "available", quantity: q }] })) } } } : null;
          }),
        };
      case "EditorTranslations":
      case "EditorDigests": {
        const slots = [...query.matchAll(/t(\d+): translations\(locale: \$l\d+(?:, marketId: \$m\d+)?\)/g)].map((m) => Number(m[1]));
        const nodes = (vars.ids as string[])
          .filter((id) => this.sources.has(id))
          .map((id) => {
            const node: Record<string, unknown> = {
              resourceId: id,
              translatableContent: [...this.sources.get(id)!.entries()].map(([key, value]) => ({ key, value, digest: this.digestOf(id, key), locale: "en" })),
            };
            for (const i of slots) {
              const locale = vars[`l${i}`] as string;
              const market = (vars[`m${i}`] as string | undefined) ?? null;
              const slot = market ? `${locale}@${market}` : locale;
              const list: unknown[] = [];
              for (const [key, bySlot] of this.translations.get(id) ?? []) {
                const t = bySlot.get(slot);
                if (t) list.push({ key, value: t.value, outdated: t.outdated, market: market ? { id: market } : null });
              }
              node[`t${i}`] = list;
            }
            return node;
          });
        return { translatableResourcesByIds: { nodes } };
      }
      case "EditorProductUpdate": {
        const input = vars.product as Record<string, unknown>;
        const p = this.products.get(input.id as string);
        if (!p) return { productUpdate: { product: null, userErrors: [{ field: ["id"], message: "Product not found" }] } };
        if (this.ignore.has(op)) return { productUpdate: { product: { id: p.id }, userErrors: [] } };
        const outdate = (key: string) => {
          for (const bySlot of this.translations.get(p.id)?.get(key)?.values() ?? []) bySlot.outdated = true;
        };
        if ("title" in input && input.title !== p.title) {
          p.title = input.title as string;
          this.setSource(p.id, "title", p.title);
          outdate("title");
        }
        if ("descriptionHtml" in input) {
          p.descriptionHtml = input.descriptionHtml as string;
          if (p.descriptionHtml) this.setSource(p.id, "body_html", p.descriptionHtml);
          else this.sources.get(p.id)?.delete("body_html");
          outdate("body_html");
        }
        if ("vendor" in input) p.vendor = input.vendor as string;
        if ("status" in input) p.status = input.status as string;
        if ("productType" in input) {
          p.productType = input.productType as string;
          if (p.productType) this.setSource(p.id, "product_type", p.productType);
        }
        if ("category" in input) p.category = input.category ? { id: input.category as string, name: "Category" } : null;
        if ("tags" in input) p.tags = input.tags as string[];
        if (input.seo) {
          const seo = input.seo as { title?: string; description?: string };
          if (seo.title !== undefined) {
            p.seoTitle = seo.title;
            if (seo.title) this.setSource(p.id, "meta_title", seo.title);
            else this.sources.get(p.id)?.delete("meta_title");
          }
          if (seo.description !== undefined) {
            p.seoDescription = seo.description;
            if (seo.description) this.setSource(p.id, "meta_description", seo.description);
            else this.sources.get(p.id)?.delete("meta_description");
          }
        }
        if ("handle" in input) {
          p.handle = String(input.handle).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
          this.setSource(p.id, "handle", p.handle);
        }
        return { productUpdate: { product: { id: p.id }, userErrors: [] } };
      }
      case "EditorVariantsUpdate": {
        if (this.ignore.has(op)) return { productVariantsBulkUpdate: { productVariants: [], userErrors: [] } };
        for (const input of vars.variants as Record<string, unknown>[]) {
          const f = this.variantById(input.id as string);
          if (!f) return { productVariantsBulkUpdate: { productVariants: null, userErrors: [{ field: ["variants"], message: "Variant not found" }] } };
          const v = f.v;
          if ("price" in input) v.price = String(input.price);
          if ("compareAtPrice" in input) v.compareAtPrice = (input.compareAtPrice as string | null) ?? null;
          if ("barcode" in input) v.barcode = (input.barcode as string) || null;
          if ("inventoryPolicy" in input) v.inventoryPolicy = input.inventoryPolicy as "DENY" | "CONTINUE";
          const item = input.inventoryItem as { sku?: string; tracked?: boolean } | undefined;
          if (item && "sku" in item) v.sku = item.sku || null;
          if (item && "tracked" in item) v.tracked = Boolean(item.tracked);
        }
        return { productVariantsBulkUpdate: { productVariants: [], userErrors: [] } };
      }
      case "EditorMetafieldsSet": {
        const list = vars.metafields as { ownerId: string; namespace: string; key: string; type: string; value: string }[];
        const bad = list.find((m) => m.value === "BAD");
        if (bad) return { metafieldsSet: { metafields: null, userErrors: [{ field: ["metafields", String(list.indexOf(bad)), "value"], message: "Value is invalid" }] } };
        if (this.ignore.has(op)) return { metafieldsSet: { metafields: [], userErrors: [] } };
        const out = [];
        for (const m of list) {
          const mfs = this.ownerMetafields(m.ownerId);
          if (!mfs) return { metafieldsSet: { metafields: null, userErrors: [{ field: ["ownerId"], message: "Owner not found" }] } };
          const k = `${m.namespace}.${m.key}`;
          const id = mfs[k]?.id ?? `gid://shopify/Metafield/${this.nextId++}`;
          mfs[k] = { id, type: m.type, value: m.value };
          this.setSource(id, "value", m.value);
          out.push({ id, namespace: m.namespace, key: m.key });
        }
        return { metafieldsSet: { metafields: out, userErrors: [] } };
      }
      case "EditorMetafieldsDelete": {
        for (const m of vars.metafields as { ownerId: string; namespace: string; key: string }[]) {
          const mfs = this.ownerMetafields(m.ownerId);
          if (mfs) delete mfs[`${m.namespace}.${m.key}`];
        }
        return { metafieldsDelete: { deletedMetafields: [], userErrors: [] } };
      }
      case "EditorStockSet": {
        const input = vars.input as { quantities: { inventoryItemId: string; locationId: string; quantity: number; changeFromQuantity: number | null }[] };
        for (const q of input.quantities) {
          const f = [...this.products.values()].flatMap((p) => p.variants).find((v) => v.itemId === q.inventoryItemId);
          if (!f || !(q.locationId in f.levels)) return { inventorySetQuantities: { userErrors: [{ field: ["input"], message: "Not stocked at that location" }] } };
          if (q.changeFromQuantity !== null && f.levels[q.locationId] !== q.changeFromQuantity) {
            return { inventorySetQuantities: { userErrors: [{ field: ["input"], message: "The quantity changed" }] } };
          }
          if (!this.ignore.has(op)) f.levels[q.locationId] = q.quantity;
        }
        return { inventorySetQuantities: { userErrors: [] } };
      }
      case "EditorTranslationsRegister": {
        const resourceId = vars.resourceId as string;
        const list = vars.translations as { key: string; locale: string; value: string; translatableContentDigest: string; marketId?: string }[];
        for (const t of list) {
          if (t.translatableContentDigest !== this.digestOf(resourceId, t.key)) {
            return { translationsRegister: { translations: null, userErrors: [{ field: ["translations"], message: "Translatable content hash is invalid" }] } };
          }
          if (!this.ignore.has(op)) this.setTranslation(resourceId, t.key, t.marketId ? `${t.locale}@${t.marketId}` : t.locale, t.value);
        }
        return { translationsRegister: { translations: [], userErrors: [] } };
      }
      case "EditorTranslationsRemove": {
        const resourceId = vars.resourceId as string;
        const keys = vars.translationKeys as string[];
        const locales = vars.locales as string[];
        const markets = (vars.marketIds as string[] | undefined) ?? [null as unknown as string];
        for (const key of keys) for (const l of locales) for (const m of markets) this.translations.get(resourceId)?.get(key)?.delete(m ? `${l}@${m}` : l);
        return { translationsRemove: { translations: [], userErrors: [] } };
      }
      case "EditorSettings": {
        const mf = (key: string) => {
          const value = this.appData.get(this.installationId)?.get(key);
          return value === undefined ? null : { value };
        };
        return { currentAppInstallation: { id: this.installationId, sets: mf("editor_sets"), bookmarks: mf("editor_bookmarks"), undo: mf("editor_undo") } };
      }
      case "EditorSaveSetting": {
        for (const m of vars.metafields as { ownerId: string; namespace: string; key: string; value: string }[]) {
          if (m.namespace !== "$app") return { metafieldsSet: { metafields: null, userErrors: [{ field: ["namespace"], message: "Wrong namespace" }] } };
          const row = this.appData.get(m.ownerId) ?? new Map<string, string>();
          this.appData.set(m.ownerId, row);
          row.set(m.key, m.value);
        }
        return { metafieldsSet: { metafields: [{ id: "x" }], userErrors: [] } };
      }
      case "EditorDeleteSetting": {
        for (const m of vars.metafields as { ownerId: string; key: string }[]) this.appData.get(m.ownerId)?.delete(m.key);
        return { metafieldsDelete: { userErrors: [] } };
      }
      case "EditorDrafts": {
        const nodes = [...this.products.values()]
          .filter((p) => p.status === "DRAFT")
          .map((p) => {
            const value = this.appData.get(p.id)?.get("draft_state");
            return { id: p.id, title: p.title, handle: p.handle, updatedAt: "2026-10-27T10:00:00Z", state: value === undefined ? null : { value } };
          });
        return { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } };
      }
      case "EditorProductCreate": {
        const input = vars.product as { title: string; descriptionHtml?: string; vendor?: string; status?: string };
        if (!input.title) return { productCreate: { product: null, userErrors: [{ field: ["title"], message: "Title can't be blank" }] } };
        const id = `gid://shopify/Product/${this.nextId++}`;
        const handle = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        this.add(fakeProduct(id, { title: input.title, handle, descriptionHtml: input.descriptionHtml ?? "", vendor: input.vendor ?? "", status: input.status ?? "DRAFT", productType: "", tags: [], variants: [fakeVariant(`${id}-v1`, { price: "0.00", sku: null })] }));
        return { productCreate: { product: { id, title: input.title, handle }, userErrors: [] } };
      }
      case "EditorOptionsCreate": {
        const p = this.products.get(vars.productId as string);
        if (!p) return { productOptionsCreate: { product: null, userErrors: [{ field: ["productId"], message: "Product not found" }] } };
        const options = vars.options as { name: string; values: { name: string }[] }[];
        if (this.ignore.has(op)) return { productOptionsCreate: { product: { id: p.id }, userErrors: [] } };
        p.options = options.map((o) => ({ name: o.name, values: o.values.map((v) => v.name) }));
        const combos = p.options.reduce<string[][]>((acc, o) => acc.flatMap((row) => o.values.map((v) => [...row, v])), [[]]);
        p.variants = combos.map((combo, i) =>
          fakeVariant(`${p.id}-v${i + 1}`, { position: i + 1, price: "0.00", sku: null, title: combo.join(" / "), selectedOptions: combo.map((value, n) => ({ name: p.options[n]!.name, value })) }),
        );
        return { productOptionsCreate: { product: { id: p.id }, userErrors: [] } };
      }
      default:
        throw new Error(`FakeShopify: no answer for ${op}`);
    }
  }
}

export const LOC_A = "gid://shopify/Location/1";
export const LOC_B = "gid://shopify/Location/2";

export function fakeVariant(id: string, extra: Partial<FakeVariant> = {}): FakeVariant {
  return {
    id,
    title: "Default Title",
    position: 1,
    price: "100.00",
    compareAtPrice: null,
    barcode: null,
    inventoryPolicy: "DENY",
    selectedOptions: [{ name: "Title", value: "Default Title" }],
    itemId: `item-${id}`,
    sku: `SKU-${id}`,
    tracked: true,
    levels: { [LOC_A]: 5 },
    metafields: {},
    ...extra,
  };
}

export function fakeProduct(id: string, extra: Partial<FakeProduct> = {}): FakeProduct {
  return {
    id,
    title: `Product ${id}`,
    handle: `product-${id}`,
    descriptionHtml: `<p>Description ${id}</p>`,
    vendor: "Hardman",
    status: "ACTIVE",
    productType: "Table",
    tags: ["oak"],
    seoTitle: "",
    seoDescription: "",
    category: null,
    options: [],
    variants: [fakeVariant(`${id}-v1`)],
    metafields: {},
    ...extra,
  };
}
