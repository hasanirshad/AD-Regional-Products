// Create product. The first step makes a DRAFT product in Shopify (title, description, vendor). From then on the new
// product is edited with the same tabs, review and password as any other, so "save at any step" is a normal save, and
// "Continue where I left off" is a list of draft products that carry a `draft_state` metafield (the step reached and
// the metafield rows chosen). A product becomes ACTIVE only on the last step, after review, confirmation and password.

import { formatUserErrors, messageOf, type Gql, type UserError } from "./gql";
import { normText } from "./canon";
import type { RunEngine } from "../engine";
import type { ReportRow } from "../report";
import { DRAFT_KEY, NAMESPACE, saveDraftState, type CreateStep, type DraftState } from "./settings";
import { loadProduct } from "./load";
import { DELETE_SETTING } from "./settings";

export type NewProduct = { title: string; descriptionHtml: string; vendor: string };

export function newProductProblem(p: NewProduct): string | null {
  if (normText(p.title) === "") return "Give the product a title.";
  if (normText(p.title).length > 255) return "The title can be 255 characters at most.";
  if (normText(p.vendor).length > 255) return "The vendor can be 255 characters at most.";
  return null;
}

export const PRODUCT_CREATE = `#graphql
  mutation EditorProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { id title handle }
      userErrors { field message }
    }
  }`;

/** Makes the draft product. Always status DRAFT: it cannot be live before the last step. */
export async function createDraftProduct(gql: Gql, p: NewProduct): Promise<{ id: string; title: string; handle: string }> {
  const input: Record<string, unknown> = { title: normText(p.title), status: "DRAFT" };
  if (normText(p.descriptionHtml)) input.descriptionHtml = p.descriptionHtml;
  if (normText(p.vendor)) input.vendor = normText(p.vendor);
  const data = await gql<{ productCreate: { product: { id: string; title: string; handle: string } | null; userErrors: UserError[] } }>(PRODUCT_CREATE, { product: input });
  const message = formatUserErrors(data.productCreate.userErrors);
  if (message) throw new Error(message);
  if (!data.productCreate.product) throw new Error("Shopify did not return the new product.");
  return data.productCreate.product;
}

/** The step to open after the one just saved. */
export function nextStep(steps: { id: CreateStep }[], current: CreateStep): CreateStep {
  const i = steps.findIndex((s) => s.id === current);
  return steps[Math.min(steps.length - 1, i + 1)]?.id ?? current;
}

/** The engine for the first save: one line, the new product. */
export function createEngine(input: {
  gql: Gql;
  product: NewProduct;
  /** The metafield rows chosen so far, saved with the draft. */
  rows: { product: string[]; variant: string[] };
  onCreated: (id: string) => void;
}): RunEngine<NewProduct> {
  return {
    lines: [input.product],
    recheck: async () => [],
    run: async (lines) => {
      const p = lines[0]!;
      const base = { productId: "", title: normText(p.title), handle: "", before: "—", after: normText(p.title), added: [] as string[], removed: [] as string[] };
      try {
        const made = await createDraftProduct(input.gql, p);
        const state: DraftState = { step: "seo", product: input.rows.product, variant: input.rows.variant, savedAt: new Date().toISOString() };
        let note = "";
        try {
          await saveDraftState(input.gql, made.id, state);
        } catch (e) {
          note = `The draft was made, but "continue where I left off" could not be saved: ${messageOf(e)}`;
        }
        // Read it back: the product must exist, as a draft, with the title asked for.
        const seen = await loadProduct(input.gql, made.id);
        const ok = seen.status === "DRAFT" && normText(seen.title) === normText(p.title);
        input.onCreated(made.id);
        const row: ReportRow = {
          ...base,
          productId: made.id,
          handle: made.handle,
          status: ok ? "done" : "not verified",
          message: ok ? note : `Shopify shows the product as ${seen.status.toLowerCase()} with the title "${seen.title}". ${note}`.trim(),
        };
        return { rows: [row] };
      } catch (e) {
        return { rows: [{ ...base, status: "failed", message: messageOf(e) }] };
      }
    },
    describe: (p) => ({ productId: "new", title: normText(p.title), handle: "" }),
  };
}

// ---------------------------------------------------------------- options and variants

export type OptionInput = { name: string; values: string[] };

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 100;

/** Problems with the options typed for a new product. */
export function optionsProblem(options: OptionInput[]): string | null {
  if (options.length === 0) return "Add at least one option, or keep the single default variant.";
  if (options.length > MAX_OPTIONS) return `A product can have ${MAX_OPTIONS} options at most.`;
  const names = new Set<string>();
  for (const o of options) {
    const name = normText(o.name);
    if (!name) return "Every option needs a name, for example Size.";
    if (names.has(name.toLowerCase())) return `The option "${name}" is listed twice.`;
    names.add(name.toLowerCase());
    const values = cleanValues(o.values);
    if (values.length === 0) return `Add at least one value to "${name}".`;
    if (values.length !== new Set(values.map((v) => v.toLowerCase())).size) return `"${name}" has the same value twice.`;
  }
  const count = variantCount(options);
  if (count > MAX_VARIANTS) return `That makes ${count} variants. This app creates up to ${MAX_VARIANTS} at once.`;
  return null;
}

export const cleanValues = (values: string[]): string[] => values.map((v) => normText(v)).filter(Boolean);

export const variantCount = (options: OptionInput[]): number => options.reduce((n, o) => n * Math.max(1, cleanValues(o.values).length), 1);

/** Every combination of option values, in the order Shopify lists variants. */
export function combinations(options: OptionInput[]): string[][] {
  return options.reduce<string[][]>((acc, o) => acc.flatMap((row) => cleanValues(o.values).map((v) => [...row, v])), [[]]);
}

export const OPTIONS_CREATE = `#graphql
  mutation EditorOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
    productOptionsCreate(productId: $productId, options: $options, variantStrategy: CREATE) {
      product { id }
      userErrors { field message code }
    }
  }`;

export type OptionsLine = { productId: string; title: string; handle: string; options: OptionInput[] };

/** Adds options to a draft product that still has only the default variant. Shopify creates a variant for each combination. */
export function optionsEngine(gql: Gql, line: OptionsLine, onDone: () => void): RunEngine<OptionsLine> {
  const expected = variantCount(line.options);
  return {
    lines: [line],
    recheck: async () => {
      const p = await loadProduct(gql, line.productId);
      const has = p.options.some((o) => o.name !== "Title");
      return has ? [{ productId: line.productId, title: line.title, message: "The product already has options. Reload it and review again." }] : [];
    },
    run: async () => {
      const base = { productId: line.productId, title: line.title, handle: line.handle, before: "Default variant", after: `${expected} variant${expected === 1 ? "" : "s"}`, added: line.options.map((o) => `${o.name}: ${cleanValues(o.values).join(", ")}`), removed: [] as string[] };
      try {
        const data = await gql<{ productOptionsCreate: { userErrors: UserError[] } }>(OPTIONS_CREATE, {
          productId: line.productId,
          options: line.options.map((o) => ({ name: normText(o.name), values: cleanValues(o.values).map((name) => ({ name })) })),
        });
        const message = formatUserErrors(data.productOptionsCreate.userErrors);
        if (message) return { rows: [{ ...base, status: "failed", message }] };
        const seen = await loadProduct(gql, line.productId);
        onDone();
        const ok = seen.variants.length === expected;
        return { rows: [{ ...base, after: `${seen.variants.length} variant${seen.variants.length === 1 ? "" : "s"}`, status: ok ? "done" : "not verified", message: ok ? "" : `Expected ${expected} variants, Shopify shows ${seen.variants.length}.` }] };
      } catch (e) {
        return { rows: [{ ...base, status: "failed", message: messageOf(e) }] };
      }
    },
    describe: (l) => ({ productId: l.productId, title: l.title, handle: l.handle }),
  };
}

// ---------------------------------------------------------------- finishing

/** Removes the draft_state metafield once the product is live. */
export async function clearDraftState(gql: Gql, productId: string): Promise<void> {
  const data = await gql<{ metafieldsDelete: { userErrors: UserError[] } }>(DELETE_SETTING, { metafields: [{ ownerId: productId, namespace: NAMESPACE, key: DRAFT_KEY }] });
  const message = formatUserErrors(data.metafieldsDelete.userErrors);
  if (message) throw new Error(message);
}
