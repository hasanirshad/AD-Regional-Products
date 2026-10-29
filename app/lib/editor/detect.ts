// "Detect from this store": reads what the store has (metafield definitions, metaobject definitions, markets, languages,
// product Types) and proposes settings. The proposals only change the DRAFT on the Settings page; nothing is saved until
// the person reviews the changes and gives the password.
//
// Reading is free. The two reads that are new here (metaobject definitions and product Types) never throw: a refused
// read gives null and a plain note, and the proposals that need it are left out.

import { WOOD_NAMES, type BlockSettings, type MarketSetting } from "../../../extensions/shared/settings";
import { messageOf, type Gql } from "./gql";

export type StoreFacts = {
  productDefs: { namespace: string; key: string; name: string }[] | null;
  variantDefs: { namespace: string; key: string; name: string }[] | null;
  /** null = could not be read (the metaobject permissions are missing, or the read failed). */
  metaobjectDefs: { type: string; name: string; fieldKeys: string[] }[] | null;
  productTypes: string[] | null;
  locales: { locale: string; name: string; primary: boolean; published: boolean }[] | null;
  markets: { id: string; name: string; countries: string[] }[];
};

export type Proposal = {
  id: string;
  title: string;
  /** Plain lines: what will change, one per line. */
  lines: string[];
  /** The draft with this proposal applied. Pure. */
  apply: (s: BlockSettings) => BlockSettings;
};

export type Detected = { proposals: Proposal[]; notes: string[] };

// ---------------------------------------------------------------- the two new reads

const METAOBJECT_DEFS = `#graphql
  query DetectMetaobjectDefinitions { metaobjectDefinitions(first: 100) { nodes { type name fieldDefinitions { key } } } }`;

const PRODUCT_TYPES = `#graphql
  query DetectProductTypes { productTypes(first: 250) { nodes } }`;

export type StoreExtras = { metaobjectDefs: StoreFacts["metaobjectDefs"]; productTypes: StoreFacts["productTypes"]; notes: string[] };

export async function readStoreExtras(gql: Gql): Promise<StoreExtras> {
  const notes: string[] = [];
  let metaobjectDefs: StoreFacts["metaobjectDefs"] = null;
  let productTypes: StoreFacts["productTypes"] = null;
  try {
    const d = await gql<{ metaobjectDefinitions: { nodes: { type: string; name: string; fieldDefinitions: { key: string }[] }[] } }>(METAOBJECT_DEFS);
    metaobjectDefs = d.metaobjectDefinitions.nodes.map((n) => ({ type: n.type, name: n.name, fieldKeys: n.fieldDefinitions.map((f) => f.key) }));
  } catch (e) {
    notes.push(`The metaobject definitions could not be read (${messageOf(e)}). The linked-record settings are left as they are. They need the permission read_metaobject_definitions.`);
  }
  try {
    const d = await gql<{ productTypes: { nodes: string[] } }>(PRODUCT_TYPES);
    productTypes = d.productTypes.nodes.filter((t) => typeof t === "string");
  } catch (e) {
    notes.push(`The product Types could not be read (${messageOf(e)}). The expected Types are left as they are.`);
  }
  return { metaobjectDefs, productTypes, notes };
}

// ---------------------------------------------------------------- the proposals

const lower = (x: string) => x.trim().toLowerCase();
const has = (list: string[], v: string) => list.some((x) => lower(x) === lower(v));
const ref = (d: { namespace: string; key: string }) => `${d.namespace}.${d.key}`;
const HELPER_WORDS = /^(finish(es)?|edges?|legs?|services?|options?|extras?)$/i;
const COUNTRY_LOCALE: Record<string, string> = { GB: "en", US: "en", DE: "de", FR: "fr", NL: "nl", CH: "de", AT: "de", IT: "it", ES: "es", IE: "en" };

export function proposeFromStore(s: BlockSettings, f: StoreFacts): Detected {
  const proposals: Proposal[] = [];
  const notes: string[] = [];

  // ---- theme fields: switch off those whose metafield the store does not have
  if (f.productDefs && f.variantDefs) {
    const exists = (t: { owner: "product" | "variant"; namespace: string; key: string }) => (t.owner === "variant" ? f.variantDefs! : f.productDefs!).some((d) => d.namespace === t.namespace && d.key === t.key);
    // seo.hidden is a built-in metafield of Shopify, not a definition of the store.
    const builtIn = (t: { namespace: string }) => t.namespace === "seo" || t.namespace === "shopify";
    const missing = s.themeFields.filter((t) => t.on && !builtIn(t) && !exists(t));
    if (missing.length) {
      const ids = new Set(missing.map((t) => t.id));
      proposals.push({
        id: "themeFields",
        title: `Switch off ${missing.length} theme field${missing.length === 1 ? "" : "s"} your store does not have`,
        lines: missing.map((t) => `${t.label} (${ref(t)}, ${t.owner}) is not a metafield definition of this store.`),
        apply: (d) => ({ ...d, themeFields: d.themeFields.map((t) => (ids.has(t.id) ? { ...t, on: false } : t)) }),
      });
    }
  } else notes.push("The metafield definitions are not read yet, so the theme fields could not be checked.");

  // ---- linked records
  if (f.metaobjectDefs) {
    const find = (re: RegExp) => f.metaobjectDefs!.find((d) => re.test(d.type) || re.test(d.name));
    const wanted: [keyof BlockSettings["records"] & ("swatchType" | "deliveryType" | "designType"), RegExp, string][] = [
      ["swatchType", /swatch/i, "Swatches"],
      ["deliveryType", /deliver/i, "Build and delivery time"],
      ["designType", /design/i, "Design and customisation"],
    ];
    const lines: string[] = [];
    const set: Partial<Record<"swatchType" | "deliveryType" | "designType", string>> = {};
    for (const [key, re, label] of wanted) {
      const found = find(re);
      if (!found) {
        if (s.records[key] !== "" && !f.metaobjectDefs.some((d) => d.type === s.records[key])) {
          set[key] = "";
          lines.push(`${label}: no metaobject definition looks like it, so its checks are switched off (type now empty).`);
        }
      } else if (found.type !== s.records[key]) {
        set[key] = found.type;
        lines.push(`${label}: use the type “${found.type}” (${found.name}${s.records[key] ? `, instead of “${s.records[key]}”` : ""}).`);
      }
    }
    if (lines.length) proposals.push({ id: "recordTypes", title: "Linked record types", lines, apply: (d) => ({ ...d, records: { ...d.records, ...set } }) });
  } else notes.push("Metaobjects were not read, so the linked-record types are left as they are.");

  if (f.variantDefs) {
    const lines: string[] = [];
    let swatch = s.records.swatchField;
    let hide = s.records.hideField;
    const there = (r: { namespace: string; key: string }) => f.variantDefs!.some((d) => d.namespace === r.namespace && d.key === r.key);
    if (!there(swatch)) {
      const c = f.variantDefs.find((d) => /swatch/i.test(d.key));
      if (c) {
        swatch = { label: c.name || c.key, namespace: c.namespace, key: c.key, owner: "variant" };
        lines.push(`Swatch field: use ${ref(c)} (${c.name}); ${ref(s.records.swatchField)} is not a variant metafield of this store.`);
      }
    }
    if (!there(hide)) {
      const c = f.variantDefs.find((d) => /hide/i.test(d.key));
      if (c) {
        hide = { label: c.name || c.key, namespace: c.namespace, key: c.key, owner: "variant" };
        lines.push(`Hide-from-markets field: use ${ref(c)} (${c.name}); ${ref(s.records.hideField)} is not a variant metafield of this store.`);
      }
    }
    if (lines.length) proposals.push({ id: "recordFields", title: "Variant metafields for swatches and hiding", lines, apply: (d) => ({ ...d, records: { ...d.records, swatchField: swatch, hideField: hide } }) });
  }

  // ---- product Types
  if (f.productTypes) {
    const wood = new Set([...s.helpers.woodNames, ...WOOD_NAMES].map(lower));
    const used = [...new Set(f.productTypes.map((t) => t.trim()).filter(Boolean))];
    const helper = used.filter((t) => HELPER_WORDS.test(t) && !has(s.helpers.types, t));
    const categories = used.filter((t) => !wood.has(lower(t)) && !HELPER_WORDS.test(t) && !has(s.helpers.expectedCategories, t));
    const woodTypes = used.filter((t) => wood.has(lower(t)));
    if (helper.length) {
      proposals.push({ id: "helperTypes", title: "Types that look like option products", lines: helper.map((t) => `“${t}” is added to the Option product Types.`), apply: (d) => ({ ...d, helpers: { ...d.helpers, types: [...d.helpers.types, ...helper] } }) });
    }
    if (categories.length) {
      proposals.push({
        id: "categories",
        title: `${categories.length} product Type${categories.length === 1 ? "" : "s"} as the expected categories`,
        lines: [`Added to the expected Types: ${categories.join(", ")}.`, ...(woodTypes.length ? [`Left out because they are wood names: ${woodTypes.join(", ")}. Products with these Types will be flagged.`] : [])],
        apply: (d) => ({ ...d, helpers: { ...d.helpers, expectedCategories: [...d.helpers.expectedCategories, ...categories] } }),
      });
    }
  } else notes.push("The product Types were not read, so the expected Types are left as they are.");

  // ---- markets
  const have = new Set(s.markets.map((m) => `${m.label}|${m.country}`));
  const newMarkets = f.markets.filter((m) => m.countries.length > 0 && !have.has(`${m.name}|${m.countries[0]}`) && !s.markets.some((x) => x.country === m.countries[0]));
  if (newMarkets.length) {
    proposals.push({
      id: "markets",
      title: `${newMarkets.length} market${newMarkets.length === 1 ? "" : "s"} of the store that the blocks do not list`,
      lines: newMarkets.map((m) => `${m.name} (${m.countries.join(", ")}) is added. Its storefront domain stays empty: set it on the Quick links tab.`),
      apply: (d) => {
        const taken = d.markets.map((m) => m.key);
        const added: MarketSetting[] = newMarkets.map((m) => {
          const country = m.countries[0]!;
          let key = country;
          for (let n = 2; taken.includes(key); n++) key = `${country}${n}`;
          taken.push(key);
          return { key, label: m.name, country, domain: "", stayUs: false, marketHandle: "", enabled: true, locale: "" };
        });
        return { ...d, markets: [...d.markets, ...added] };
      },
    });
  }

  // ---- languages of the markets
  if (f.locales) {
    const codes = new Set(f.locales.map((l) => l.locale));
    const wrong = s.markets.filter((m) => m.locale !== "" && !codes.has(m.locale));
    if (wrong.length) {
      proposals.push({
        id: "marketLocales",
        title: "Markets whose language is not a language of the store",
        lines: wrong.map((m) => `${m.key}: “${m.locale}” is not published on the store, so the language is cleared (the store's main language is used).`),
        apply: (d) => ({ ...d, markets: d.markets.map((m) => (m.locale !== "" && !codes.has(m.locale) ? { ...m, locale: "" } : m)) }),
      });
    }
    const empty = s.markets.filter((m) => m.locale === "" && COUNTRY_LOCALE[m.country] && COUNTRY_LOCALE[m.country] !== f.locales!.find((l) => l.primary)?.locale && codes.has(COUNTRY_LOCALE[m.country]!));
    if (empty.length) {
      proposals.push({
        id: "marketLanguage",
        title: "Set the language of markets that sell in another language",
        lines: empty.map((m) => `${m.key}: ${COUNTRY_LOCALE[m.country]}.`),
        apply: (d) => ({ ...d, markets: d.markets.map((m) => (empty.some((e) => e.key === m.key) ? { ...m, locale: COUNTRY_LOCALE[m.country]! } : m)) }),
      });
    }
    const secondary = f.locales.filter((l) => !l.primary && l.published);
    const now = s.languages.map((l) => l.code).sort().join(",");
    const next = secondary.map((l) => l.locale).sort().join(",");
    if (secondary.length && now !== next) {
      proposals.push({
        id: "languages",
        title: "Languages of the Translation status block",
        lines: [`Now: ${s.languages.map((l) => l.label).join(", ")}. Store: ${secondary.map((l) => l.name).join(", ")}.`],
        apply: (d) => ({ ...d, languages: secondary.map((l) => ({ code: l.locale, label: l.name })) }),
      });
    }
  }
  return { proposals, notes };
}

/** Applies the chosen proposals in order. */
export function applyProposals(s: BlockSettings, chosen: Proposal[]): BlockSettings {
  return chosen.reduce((acc, p) => p.apply(acc), s);
}
