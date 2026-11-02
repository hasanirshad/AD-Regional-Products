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
  options: { name: string; values: string[]; id?: string; valueIds?: string[] }[];
  templateSuffix: string;
  /** Publications (sales channels and market catalogues) the product is published to. */
  publicationIds: string[];
  variants: FakeVariant[];
  metafields: Record<string, { id: string; type: string; value: string }>;
};

const levelId = (itemId: string, locationId: string) => `level:${itemId}:${locationId}`;
const levelNodes = (v: FakeVariant) => Object.entries(v.levels).map(([loc, q]) => ({ id: levelId(v.itemId, loc), location: { id: loc }, quantities: [{ name: "available", quantity: q }] }));

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
  metaobjectDefinitions: { id: string; type: string; name: string }[] = [];
  metaobjects: { id: string; type: string; displayName: string | null; handle: string }[] = [];
  files: { __typename: string; id: string; alt?: string | null; image?: { url: string } | null; url?: string | null; mimeType?: string | null; filename?: string | null }[] = [];
  /** Page size of the metaobject and file lists (small, so tests can page). */
  pageSize = 50;
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
    const key = { ProductCreate: "productCreate", OptionsCreate: "productOptionsCreate", SaveSetting: "metafieldsSet", ProductUpdate: "productUpdate", VariantsUpdate: "productVariantsBulkUpdate", MetafieldsSet: "metafieldsSet", MetafieldsDelete: "metafieldsDelete", StockSet: "inventorySetQuantities", OptionUpdate: "productOptionUpdate", OptionsReorder: "productOptionsReorder", StockActivate: "inventoryActivate", StockDeactivate: "inventoryDeactivate", Publish: "publishablePublish", Unpublish: "publishableUnpublish", TranslationsRegister: "translationsRegister", TranslationsRemove: "translationsRemove" }[root] ?? root;
    return { [key]: { userErrors: [{ field: ["x"], message }] } };
  }

  /** Gives every option and value a stable id (once), then lists them the way Shopify does. */
  private optionNodes(p: FakeProduct) {
    for (const o of p.options) {
      o.id ??= `gid://shopify/ProductOption/${this.nextId++}`;
      o.valueIds ??= [];
      while (o.valueIds.length < o.values.length) o.valueIds.push(`gid://shopify/ProductOptionValue/${this.nextId++}`);
      this.setSource(o.id, "name", o.name);
      o.values.forEach((v, i) => this.setSource(o.valueIds![i]!, "name", v));
    }
    return p.options.map((o, i) => ({ id: o.id!, name: o.name, position: i + 1, optionValues: o.values.map((name, j) => ({ id: o.valueIds![j]!, name })) }));
  }

  /** Variants for every combination of the current options; variants that already exist keep their data. */
  private rebuildVariants(p: FakeProduct): void {
    const combos = p.options.reduce<string[][]>((acc, o) => acc.flatMap((row) => o.values.map((v) => [...row, v])), [[]]);
    const old = p.variants;
    p.variants = combos.map((combo, i) => {
      const title = combo.join(" / ");
      const keep = old.find((v) => v.title === title);
      if (keep) return { ...keep, position: i + 1 };
      return fakeVariant(`${p.id}-v${this.nextId++}`, { position: i + 1, price: "0.00", sku: null, title, selectedOptions: combo.map((value, n) => ({ name: p.options[n]!.name, value })) });
    });
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
            templateSuffix: p.templateSuffix || null,
            onlineStorePreviewUrl: `https://shop.example/products/${p.handle}?preview_key=abc`,
            options: this.optionNodes(p),
            resourcePublicationsV2: { nodes: p.publicationIds.map((id) => ({ publication: { id } })) },
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
                  inventoryLevels: { nodes: levelNodes(v) },
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
      case "BulkVariantRows":
      case "BulkVariantRowsMore": {
        const shape = (v: FakeVariant) => ({ id: v.id, title: v.title, position: v.position, price: v.price, compareAtPrice: v.compareAtPrice, barcode: v.barcode, inventoryPolicy: v.inventoryPolicy, inventoryItem: { tracked: v.tracked, sku: v.sku } });
        const page = (list: FakeVariant[], after: string | null) => {
          const start = after ? Number(after) : 0;
          const slice = list.slice(start, start + 100);
          const end = start + slice.length;
          return { pageInfo: { hasNextPage: end < list.length, endCursor: String(end) }, nodes: slice.map(shape) };
        };
        if (op === "BulkVariantRowsMore") {
          const p = this.products.get(vars.id as string);
          return { product: p ? { variants: page(p.variants, (vars.after as string | null) ?? null) } : null };
        }
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const p = this.products.get(id);
            return p ? { id, title: p.title, handle: p.handle, variants: page(p.variants, null) } : null;
          }),
        };
      }
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
              ? { id, title: p.title, handle: p.handle, descriptionHtml: p.descriptionHtml, vendor: p.vendor, status: p.status, productType: p.productType, tags: p.tags, seo: { title: p.seoTitle, description: p.seoDescription }, category: p.category, templateSuffix: p.templateSuffix || null }
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
            return f ? { id, inventoryItem: { inventoryLevels: { nodes: levelNodes(f.v) } } } : null;
          }),
        };
      case "EditorMetaobjectDefinition":
        return { metaobjectDefinition: this.metaobjectDefinitions.find((d) => d.id === vars.id) ?? null };
      case "EditorMetaobjects": {
        const all = this.metaobjects.filter((m) => m.type === vars.type);
        const start = vars.after ? Number(vars.after) : 0;
        const page = all.slice(start, start + Math.min(this.pageSize, Number(vars.first)));
        const end = start + page.length;
        return { metaobjects: { pageInfo: { hasNextPage: end < all.length, endCursor: String(end) }, nodes: page.map((m) => ({ id: m.id, displayName: m.displayName, handle: m.handle })) } };
      }
      case "EditorFiles": {
        const start = vars.after ? Number(vars.after) : 0;
        const page = this.files.slice(start, start + Math.min(this.pageSize, Number(vars.first)));
        const end = start + page.length;
        return { files: { pageInfo: { hasNextPage: end < this.files.length, endCursor: String(end) }, nodes: page } };
      }
      case "EditorMetaobjectLabels":
        return { nodes: (vars.ids as string[]).map((id) => this.metaobjects.find((m) => m.id === id)).map((m) => (m ? { id: m.id, displayName: m.displayName, handle: m.handle } : null)) };
      case "EditorFileLabels":
        return { nodes: (vars.ids as string[]).map((id) => this.files.find((f) => f.id === id) ?? null) };
      case "EditorStockLevels":
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const f = this.variantById(id);
            return f ? { id, inventoryItem: { inventoryLevels: { nodes: levelNodes(f.v).map((l) => ({ id: l.id, location: l.location })) } } } : null;
          }),
        };
      case "ReadPublicationIds":
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const p = this.products.get(id);
            return p ? { id, resourcePublicationsV2: { nodes: p.publicationIds.map((x) => ({ publication: { id: x } })) } } : null;
          }),
        };
      case "ReadMetafieldIds": {
        const wanted = [...query.matchAll(/m(\d+): metafield\(namespace: "([^"]*)", key: "([^"]*)"\)/g)].map((m) => ({ alias: `m${m[1]}`, namespace: m[2]!, key: m[3]! }));
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const owner = this.ownerMetafields(id);
            if (!owner) return null;
            const node: Record<string, unknown> = { id };
            for (const w of wanted) {
              const m = owner[`${w.namespace}.${w.key}`];
              node[w.alias] = m ? { id: m.id, value: m.value } : null;
            }
            return node;
          }),
        };
      }
      case "EditorStockActivate": {
        const f = [...this.products.values()].flatMap((p) => p.variants).find((v) => v.itemId === vars.itemId);
        if (!f) return { inventoryActivate: { inventoryLevel: null, userErrors: [{ field: ["inventoryItemId"], message: "Inventory item not found" }] } };
        if (!this.locations.some((l) => l.id === vars.locationId) && vars.locationId !== LOC_B) return { inventoryActivate: { inventoryLevel: null, userErrors: [{ field: ["locationId"], message: "Location not found" }] } };
        if (!this.ignore.has(op) && !((vars.locationId as string) in f.levels)) f.levels[vars.locationId as string] = 0;
        return { inventoryActivate: { inventoryLevel: { id: levelId(f.itemId, vars.locationId as string) }, userErrors: [] } };
      }
      case "EditorStockDeactivate": {
        const id = vars.id as string;
        for (const v of [...this.products.values()].flatMap((p) => p.variants)) {
          for (const loc of Object.keys(v.levels)) {
            if (levelId(v.itemId, loc) !== id) continue;
            if (Object.keys(v.levels).length === 1) return { inventoryDeactivate: { userErrors: [{ message: "The inventory level can't be deactivated because it is the only one this item has." }] } };
            if (!this.ignore.has(op)) delete v.levels[loc];
            return { inventoryDeactivate: { userErrors: [] } };
          }
        }
        return { inventoryDeactivate: { userErrors: [{ message: "Inventory level not found" }] } };
      }
      case "EditorPublish":
      case "EditorUnpublish": {
        const p = this.products.get(vars.id as string);
        const key = op === "EditorPublish" ? "publishablePublish" : "publishableUnpublish";
        if (!p) return { [key]: { userErrors: [{ field: ["id"], message: "Product not found" }] } };
        const ids = (vars.input as { publicationId: string }[]).map((x) => x.publicationId);
        if (!this.ignore.has(op)) p.publicationIds = op === "EditorPublish" ? [...new Set([...p.publicationIds, ...ids])] : p.publicationIds.filter((x) => !ids.includes(x));
        return { [key]: { userErrors: [] } };
      }
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
        if ("templateSuffix" in input) p.templateSuffix = (input.templateSuffix as string | null) ?? "";
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
        return { currentAppInstallation: { id: this.installationId, sets: mf("editor_sets"), bookmarks: mf("editor_bookmarks"), undo: mf("editor_undo"), blocks: mf("block_settings") } };
      }
      case "BlockSettingsRead": {
        const value = this.appData.get(this.installationId)?.get("block_settings");
        return { currentAppInstallation: { id: this.installationId, blocks: value === undefined ? null : { value } } };
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
        const onlyDefault = p.options.length === 0 || (p.options.length === 1 && p.options[0]!.name === "Title");
        if (onlyDefault) p.options = [];
        if (p.options.length + options.length > 3) return { productOptionsCreate: { product: null, userErrors: [{ field: ["options"], message: "Options count is over the limit of 3" }] } };
        for (const o of options) {
          if (p.options.some((x) => x.name.toLowerCase() === o.name.toLowerCase())) return { productOptionsCreate: { product: null, userErrors: [{ field: ["options"], message: `Option '${o.name}' already exists` }] } };
          p.options.push({ name: o.name, values: o.values.map((v) => v.name) });
        }
        if (onlyDefault) p.variants = [];
        this.optionNodes(p);
        if (onlyDefault) this.rebuildVariants(p);
        else {
          // A new option on a product that has variants: every existing variant takes the new option's first value.
          for (const o of options) for (const v of p.variants) {
            v.selectedOptions.push({ name: o.name, value: o.values[0]!.name });
            v.title = `${v.title} / ${o.values[0]!.name}`;
          }
          this.rebuildVariants(p);
        }
        return { productOptionsCreate: { product: { id: p.id }, userErrors: [] } };
      }
      case "EditorOptionUpdate": {
        const p = this.products.get(vars.productId as string);
        const input = vars.option as { id: string; name?: string };
        if (!p) return { productOptionUpdate: { product: null, userErrors: [{ field: ["productId"], message: "Product not found" }] } };
        this.optionNodes(p);
        const idx = p.options.findIndex((o) => o.id === input.id);
        if (idx < 0) return { productOptionUpdate: { product: null, userErrors: [{ field: ["option"], message: "Option not found" }] } };
        if (this.ignore.has(op)) return { productOptionUpdate: { product: { id: p.id }, userErrors: [] } };
        const o = p.options[idx]!;
        const outdate = (id: string) => {
          for (const bySlot of this.translations.get(id)?.get("name")?.values() ?? []) bySlot.outdated = true;
        };
        for (const u of (vars.update as { id: string; name: string }[] | undefined) ?? []) {
          const j = o.valueIds!.indexOf(u.id);
          if (j < 0) return { productOptionUpdate: { product: null, userErrors: [{ field: ["optionValuesToUpdate"], message: "Option value not found" }] } };
          const from = o.values[j]!;
          o.values[j] = u.name;
          for (const v of p.variants) if (v.selectedOptions[idx]?.value === from) {
            v.selectedOptions[idx]!.value = u.name;
            v.title = v.selectedOptions.map((x) => x.value).join(" / ");
          }
          this.setSource(u.id, "name", u.name);
          outdate(u.id);
        }
        for (const a of (vars.add as { name: string }[] | undefined) ?? []) {
          if (o.values.some((x) => x.toLowerCase() === a.name.toLowerCase())) return { productOptionUpdate: { product: null, userErrors: [{ field: ["optionValuesToAdd"], message: `Option value '${a.name}' already exists` }] } };
          o.values.push(a.name);
        }
        if (input.name !== undefined && input.name !== o.name) {
          o.name = input.name;
          for (const v of p.variants) v.selectedOptions[idx]!.name = input.name;
          this.setSource(o.id!, "name", input.name);
          outdate(o.id!);
        }
        this.optionNodes(p);
        this.rebuildVariants(p);
        return { productOptionUpdate: { product: { id: p.id }, userErrors: [] } };
      }
      case "EditorOptionsReorder": {
        const p = this.products.get(vars.productId as string);
        if (!p) return { productOptionsReorder: { product: null, userErrors: [{ field: ["productId"], message: "Product not found" }] } };
        this.optionNodes(p);
        const want = vars.options as { id: string; values: { id: string }[] }[];
        if (this.ignore.has(op)) return { productOptionsReorder: { product: { id: p.id }, userErrors: [] } };
        const next = want.map((w) => p.options.find((o) => o.id === w.id));
        if (next.some((o) => !o) || next.length !== p.options.length) return { productOptionsReorder: { product: null, userErrors: [{ field: ["options"], message: "Every option must be listed" }] } };
        // Variants keep the order of their option columns, so rebuild after reordering.
        const colOf = new Map(p.options.map((o, i) => [o.id!, i]));
        for (const v of p.variants) {
          v.selectedOptions = want.map((w) => v.selectedOptions[colOf.get(w.id)!]!);
          v.title = v.selectedOptions.map((x) => x.value).join(" / ");
        }
        p.options = want.map((w) => {
          const o = p.options.find((x) => x.id === w.id)!;
          const order = w.values.map((x) => o.valueIds!.indexOf(x.id));
          return { ...o, values: order.map((i) => o.values[i]!), valueIds: order.map((i) => o.valueIds![i]!) };
        });
        this.rebuildVariants(p);
        return { productOptionsReorder: { product: { id: p.id }, userErrors: [] } };
      }
      case "EditorOptionsRead": {
        const p = this.products.get(vars.id as string);
        if (!p) return { product: null };
        return { product: { variantsCount: { count: p.variants.length }, options: this.optionNodes(p) } };
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
    templateSuffix: "",
    publicationIds: [],
    variants: [fakeVariant(`${id}-v1`)],
    metafields: {},
    ...extra,
  };
}
