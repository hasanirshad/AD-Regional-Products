// Options and their values (the "Variants" step): what the person types, what it means for Shopify, and the engine that
// saves it in a safe order. Pure plan + one engine, with its own review through RunFlow, because creating options
// creates variants and gives new ids that the translations need.
//
// Order of a save:
//   1. structure   new product: productOptionsCreate (all options at once); existing product: productOptionUpdate per
//                  option (rename, add values, rename values) and productOptionsCreate for a new option
//   2. read back   the option and value ids (new ones only exist now)
//   3. order       productOptionsReorder, only when the order on screen differs from Shopify's
//   4. translations option and value names, registered with the digest of the source as it is now
//   5. read back   names, order and translations are read again and compared
//
// Removing options or values is not offered here (it deletes variants); it stays in the Shopify admin.

import type { RunEngine } from "../engine";
import type { ReportRow } from "../report";
import { applyBundle } from "./apply";
import { normText } from "./canon";
import type { OptionDoc, ProductDoc, TranslationRes } from "./doc";
import { formatUserErrors, messageOf, type Gql, type UserError } from "./gql";
import { loadTranslations } from "./load";
import { targetKey, type Bundle, type Change, type Target } from "./model";
import { readValues } from "./read";

export const MAX_OPTIONS = 3;
/** Variants this flow will create or grow to. Shopify allows 2,048; a furniture product rarely needs more than a few dozen. */
export const MAX_VARIANTS = 100;

export type ValueDraft = { id?: string; name: string; /** slot -> text */ tr: Record<string, string> };
export type OptionDraft = { id?: string; name: string; tr: Record<string, string>; values: ValueDraft[] };

const DEFAULT_OPTION = "Title";
const DEFAULT_VALUE = "Default Title";

/** A product that has never had options of its own: just the one "Title / Default Title" option, or none. */
export function hasOnlyDefaultOption(options: { name: string; values: string[] }[]): boolean {
  return options.length === 0 || (options.length === 1 && options[0]!.name === DEFAULT_OPTION && options[0]!.values.length === 1 && options[0]!.values[0] === DEFAULT_VALUE);
}

const translationsOf = (res: TranslationRes | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [slot, t] of Object.entries(res?.values.name ?? {})) out[slot] = t.value;
  return out;
};

/** The saved options of a product as drafts, with their saved translations. A default-only product gives an empty list. */
export function draftFromDoc(options: OptionDoc[], translations: Record<string, TranslationRes>): OptionDraft[] {
  if (hasOnlyDefaultOption(options)) return [];
  return [...options]
    .sort((a, b) => a.position - b.position)
    .map((o) => ({
      id: o.id,
      name: o.name,
      tr: translationsOf(translations[o.id]),
      values: o.values.map((name, i) => ({ id: o.valueIds[i], name, tr: translationsOf(o.valueIds[i] ? translations[o.valueIds[i]!] : undefined) })),
    }));
}

/** Loads the translations of every option and value of a product (for the slots given). */
export async function loadOptionDrafts(gql: Gql, doc: ProductDoc, slots: string[]): Promise<OptionDraft[]> {
  if (hasOnlyDefaultOption(doc.options)) return [];
  const ids = doc.options.flatMap((o) => [o.id, ...o.valueIds]).filter(Boolean);
  return draftFromDoc(doc.options, await loadTranslations(gql, ids, slots));
}

export const cleanName = (s: string): string => normText(s);
const live = (values: ValueDraft[]) => values.filter((v) => cleanName(v.name) !== "");
export const variantCountOf = (options: OptionDraft[]): number => options.reduce((n, o) => n * Math.max(1, live(o.values).length), 1);

/** Everything that stops a save, in plain words. `saved` is what Shopify has now. */
export function optionProblems(draft: OptionDraft[], saved: OptionDraft[]): string[] {
  const out: string[] = [];
  if (draft.length > MAX_OPTIONS) out.push(`A product can have ${MAX_OPTIONS} options at most.`);
  const names = new Set<string>();
  for (const [i, o] of draft.entries()) {
    const name = cleanName(o.name);
    const label = name || `Option ${i + 1}`;
    if (!name) out.push(`Option ${i + 1} needs a name, for example Size.`);
    else if (names.has(name.toLowerCase())) out.push(`The option "${name}" is listed twice.`);
    names.add(name.toLowerCase());
    const values = live(o.values);
    if (values.length === 0) out.push(`Add at least one value to "${label}".`);
    const seen = new Set<string>();
    for (const v of values) {
      const k = cleanName(v.name).toLowerCase();
      if (seen.has(k)) out.push(`"${label}" has the value "${cleanName(v.name)}" twice.`);
      seen.add(k);
    }
  }
  // Removing is not supported: every saved option and value must still be there.
  for (const s of saved) {
    const now = draft.find((o) => o.id === s.id);
    if (!now) {
      out.push(`The option "${s.name}" was removed. Removing an option deletes variants, so do that in the Shopify admin.`);
      continue;
    }
    for (const v of s.values) if (!now.values.some((x) => x.id === v.id)) out.push(`The value "${v.name}" of "${s.name}" was removed. Removing a value deletes variants, so do that in the Shopify admin.`);
  }
  if (out.length === 0) {
    const count = variantCountOf(draft);
    if (count > MAX_VARIANTS) out.push(`That makes ${count} variants. This app handles up to ${MAX_VARIANTS}.`);
  }
  return out;
}

// ---------------------------------------------------------------- the plan

export type OptionPlan = {
  /** The product has no options yet: create them all in one call. */
  createAll: boolean;
  /** Existing options with a rename, new values, or renamed values. */
  updates: { option: OptionDraft; rename: string | null; addValues: string[]; renameValues: { id: string; name: string; from: string }[] }[];
  /** Options that did not exist. */
  creates: OptionDraft[];
  /** The order of options or of values changed. */
  reorder: boolean;
  /** Translations to write: key is a stable id of the thing ("o:<id|name>" / "v:<optionId|name>|<id|name>"), then the slot. */
  translations: { thing: string; kind: "option" | "optionValue"; optionName: string; valueName?: string; id?: string; slot: string; before: string; after: string }[];
  /** Variants after the save. */
  variantsAfter: number;
  lines: string[];
};

export function planOptions(saved: OptionDraft[], draft: OptionDraft[]): OptionPlan {
  const createAll = saved.length === 0 && draft.length > 0;
  const plan: OptionPlan = { createAll, updates: [], creates: [], reorder: false, translations: [], variantsAfter: variantCountOf(draft), lines: [] };

  const trChanges = (kind: "option" | "optionValue", thing: string, optionName: string, valueName: string | undefined, id: string | undefined, before: Record<string, string>, after: Record<string, string>) => {
    for (const slot of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const b = normText(before[slot] ?? "");
      const a = normText(after[slot] ?? "");
      if (a !== b) plan.translations.push({ thing, kind, optionName, valueName, id, slot, before: b, after: a });
    }
  };

  draft.forEach((o, oi) => {
    const name = cleanName(o.name);
    const s = o.id ? saved.find((x) => x.id === o.id) : undefined;
    const values = live(o.values);
    if (!s) {
      plan.creates.push({ ...o, name, values });
      if (!createAll) plan.lines.push(`Add the option "${name}" with ${values.length} value${values.length === 1 ? "" : "s"}: ${values.map((v) => cleanName(v.name)).join(", ")}.`);
    } else {
      const rename = name !== s.name ? name : null;
      const addValues = values.filter((v) => !v.id).map((v) => cleanName(v.name));
      const renameValues = values.flatMap((v) => {
        const sv = s.values.find((x) => x.id === v.id);
        return sv && cleanName(v.name) !== sv.name ? [{ id: v.id!, name: cleanName(v.name), from: sv.name }] : [];
      });
      if (rename || addValues.length || renameValues.length) {
        plan.updates.push({ option: o, rename, addValues, renameValues });
        if (rename) plan.lines.push(`Rename the option "${s.name}" to "${name}".`);
        if (addValues.length) plan.lines.push(`Add to "${name}": ${addValues.join(", ")}.`);
        for (const r of renameValues) plan.lines.push(`Rename the value "${r.from}" to "${r.name}" in "${name}".`);
      }
      if (oi !== saved.findIndex((x) => x.id === o.id)) plan.reorder = true;
      // Value order: compare the saved values (that still exist) with the draft's order of them.
      const savedOrder = s.values.map((v) => v.id);
      const draftOrder = values.filter((v) => v.id).map((v) => v.id);
      if (savedOrder.join("|") !== draftOrder.join("|")) plan.reorder = true;
      // A new value placed before an old one also changes the order.
      if (values.some((v, i) => !v.id && values.slice(i + 1).some((w) => w.id))) plan.reorder = true;
    }
    const key = o.id ?? name;
    trChanges("option", `o:${key}`, name, undefined, o.id, s?.tr ?? {}, o.tr);
    for (const v of values) {
      const sv = s?.values.find((x) => x.id === v.id);
      trChanges("optionValue", `v:${key}|${v.id ?? cleanName(v.name)}`, name, cleanName(v.name), v.id, sv?.tr ?? {}, v.tr);
    }
  });
  if (createAll) plan.lines.unshift(`Create ${draft.length} option${draft.length === 1 ? "" : "s"} (${draft.map((o) => cleanName(o.name)).join(", ")}) and ${plan.variantsAfter} variant${plan.variantsAfter === 1 ? "" : "s"}.`);
  if (plan.reorder) plan.lines.push("Put the options and values in the order set on screen. This is the order on the product page.");
  if (plan.translations.length) plan.lines.push(`Save ${plan.translations.length} translation${plan.translations.length === 1 ? "" : "s"} of option and value names.`);
  return plan;
}

export const planIsEmpty = (p: OptionPlan): boolean => !p.createAll && p.updates.length === 0 && p.creates.length === 0 && !p.reorder && p.translations.length === 0;

// ---------------------------------------------------------------- Shopify calls

export const OPTIONS_CREATE_ALL = `#graphql
  mutation EditorOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
    productOptionsCreate(productId: $productId, options: $options, variantStrategy: CREATE) {
      product { id }
      userErrors { field message code }
    }
  }`;

export const OPTION_UPDATE = `#graphql
  mutation EditorOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $add: [OptionValueCreateInput!], $update: [OptionValueUpdateInput!]) {
    productOptionUpdate(productId: $productId, option: $option, optionValuesToAdd: $add, optionValuesToUpdate: $update, variantStrategy: MANAGE) {
      product { id }
      userErrors { field message code }
    }
  }`;

export const OPTIONS_REORDER = `#graphql
  mutation EditorOptionsReorder($productId: ID!, $options: [OptionReorderInput!]!) {
    productOptionsReorder(productId: $productId, options: $options) {
      product { id }
      userErrors { field message code }
    }
  }`;

export const OPTIONS_READ = `#graphql
  query EditorOptionsRead($id: ID!) {
    product(id: $id) {
      variantsCount { count }
      options { id name position optionValues { id name } }
    }
  }`;

export type SavedOption = { id: string; name: string; position: number; values: { id: string; name: string }[] };

export async function readOptions(gql: Gql, productId: string): Promise<{ options: SavedOption[]; variants: number }> {
  const data = await gql<{ product: { variantsCount: { count: number }; options: { id: string; name: string; position: number; optionValues: { id: string; name: string }[] }[] } | null }>(OPTIONS_READ, { id: productId });
  if (!data.product) throw new Error("The product was not found in Shopify.");
  return {
    variants: data.product.variantsCount.count,
    options: [...data.product.options].sort((a, b) => a.position - b.position).map((o) => ({ id: o.id, name: o.name, position: o.position, values: o.optionValues.map((v) => ({ id: v.id, name: v.name })) })),
  };
}

const lc = (s: string) => s.toLowerCase();

/** The order Shopify should have, as the reorder call wants it. Values are matched by id, or by name for new ones. */
export function reorderInput(draft: OptionDraft[], seen: SavedOption[]): { id: string; values: { id: string }[] }[] {
  return draft.flatMap((o) => {
    const so = (o.id ? seen.find((x) => x.id === o.id) : undefined) ?? seen.find((x) => lc(x.name) === lc(cleanName(o.name)));
    if (!so) return [];
    return [{
      id: so.id,
      values: live(o.values).flatMap((v) => {
        const sv = (v.id ? so.values.find((x) => x.id === v.id) : undefined) ?? so.values.find((x) => lc(x.name) === lc(cleanName(v.name)));
        return sv ? [{ id: sv.id }] : [];
      }),
    }];
  });
}

/** True when Shopify's order (options and values) already equals the draft's. */
export function sameOrder(draft: OptionDraft[], seen: SavedOption[]): boolean {
  const want = reorderInput(draft, seen);
  if (want.length !== seen.length) return false;
  return want.every((o, i) => o.id === seen[i]!.id && o.values.map((v) => v.id).join("|") === seen[i]!.values.map((v) => v.id).join("|"));
}

// ---------------------------------------------------------------- the engine

export type OptionsLine = { productId: string; title: string; handle: string; saved: OptionDraft[]; draft: OptionDraft[]; plan: OptionPlan };

const rowBase = (l: OptionsLine) => ({ productId: l.productId, handle: l.handle, added: [] as string[], removed: [] as string[] });

const describeOptions = (o: OptionDraft[]): string => (o.length === 0 ? "No options" : o.map((x) => `${x.name}: ${live(x.values).map((v) => v.name).join(", ")}`).join(" · "));

/** Finds the saved id of each thing that has a translation to write, after the structure is saved. */
function resolveTargets(plan: OptionPlan, seen: SavedOption[]): { change: Change; resourceId: string }[] {
  const out: { change: Change; resourceId: string }[] = [];
  for (const t of plan.translations) {
    // After the save the option carries the name on screen, so its name finds it (new options have no id yet).
    const so = (t.kind === "option" && t.id ? seen.find((o) => o.id === t.id) : undefined) ?? seen.find((o) => lc(o.name) === lc(t.optionName));
    if (!so) continue;
    let resourceId = so.id;
    if (t.kind === "optionValue") {
      const sv = (t.id ? so.values.find((v) => v.id === t.id) : undefined) ?? so.values.find((v) => lc(v.name) === lc(t.valueName ?? ""));
      if (!sv) continue;
      resourceId = sv.id;
    }
    const target: Target = { kind: "translation", productId: "", resourceId, resource: t.kind, field: "name", slot: t.slot };
    out.push({ resourceId, change: { id: `${targetKey(target)}`, target, productId: "", productTitle: "", label: "", tab: "basic", before: t.before || null, after: t.after || null } });
  }
  return out;
}

export function optionsEngine(gql: Gql, line: OptionsLine, onDone: () => void): RunEngine<OptionsLine> {
  return {
    lines: [line],
    recheck: async () => {
      const now = await readOptions(gql, line.productId);
      const same = line.saved.length === 0 ? hasOnlyDefaultOption(now.options.map((o) => ({ name: o.name, values: o.values.map((v) => v.name) }))) : line.saved.every((s) => now.options.some((o) => o.id === s.id && o.name === s.name && s.values.every((v) => o.values.some((x) => x.id === v.id && x.name === v.name))));
      return same ? [] : [{ productId: line.productId, title: line.title, message: "The options changed in Shopify since the review. Reload the product and review again." }];
    },
    run: async () => {
      const rows: ReportRow[] = [];
      const row = (title: string, before: string, after: string, status: ReportRow["status"], message = ""): ReportRow => ({ ...rowBase(line), title: `${line.title} · ${title}`, before, after, status, message });
      const stopped = (why: string) => rows.push(row("Rest of the options", "", "", "not applied", `Not tried: ${why}`));
      const plan = line.plan;

      // 1. structure
      try {
        if (plan.createAll) {
          const data = await gql<{ productOptionsCreate: { userErrors: UserError[] } }>(OPTIONS_CREATE_ALL, { productId: line.productId, options: line.draft.map((o) => ({ name: cleanName(o.name), values: live(o.values).map((v) => ({ name: cleanName(v.name) })) })) });
          const message = formatUserErrors(data.productOptionsCreate.userErrors);
          if (message) return { rows: [row("Options", "No options", describeOptions(line.draft), "failed", message)] };
          rows.push(row("Options", "No options", describeOptions(line.draft), "done"));
        } else {
          for (const u of plan.updates) {
            const data = await gql<{ productOptionUpdate: { userErrors: UserError[] } }>(OPTION_UPDATE, {
              productId: line.productId,
              option: { id: u.option.id, ...(u.rename ? { name: u.rename } : {}) },
              add: u.addValues.map((name) => ({ name })),
              update: u.renameValues.map((r) => ({ id: r.id, name: r.name })),
            });
            const message = formatUserErrors(data.productOptionUpdate.userErrors);
            const was = line.saved.find((s) => s.id === u.option.id)!;
            rows.push(row(`Option ${was.name}`, `${was.name}: ${was.values.map((v) => v.name).join(", ")}`, `${cleanName(u.option.name)}: ${live(u.option.values).map((v) => v.name).join(", ")}`, message ? "failed" : "done", message));
            if (message) {
              stopped(`"${was.name}" did not save.`);
              return { rows };
            }
          }
          for (const c of plan.creates) {
            const data = await gql<{ productOptionsCreate: { userErrors: UserError[] } }>(OPTIONS_CREATE_ALL, { productId: line.productId, options: [{ name: c.name, values: c.values.map((v) => ({ name: cleanName(v.name) })) }] });
            const message = formatUserErrors(data.productOptionsCreate.userErrors);
            rows.push(row(`New option ${c.name}`, "", describeOptions([c]), message ? "failed" : "done", message));
            if (message) {
              stopped(`"${c.name}" did not save.`);
              return { rows };
            }
          }
        }
      } catch (e) {
        rows.push(row("Options", describeOptions(line.saved), describeOptions(line.draft), "failed", messageOf(e)));
        return { rows };
      }

      // 2 + 3. read back the ids, then put things in order
      let seen: { options: SavedOption[]; variants: number };
      try {
        seen = await readOptions(gql, line.productId);
        if (!sameOrder(line.draft, seen.options)) {
          const data = await gql<{ productOptionsReorder: { userErrors: UserError[] } }>(OPTIONS_REORDER, { productId: line.productId, options: reorderInput(line.draft, seen.options) });
          const message = formatUserErrors(data.productOptionsReorder.userErrors);
          rows.push(row("Order of options and values", seen.options.map((o) => o.name).join(" · "), line.draft.map((o) => cleanName(o.name)).join(" · "), message ? "failed" : "done", message));
          seen = await readOptions(gql, line.productId);
        }
      } catch (e) {
        rows.push(row("Order of options and values", "", "", "failed", messageOf(e)));
        return { rows };
      }

      // 4. translations (a failed structure never gets here)
      const targets = resolveTargets(plan, seen.options);
      if (targets.length > 0) {
        const bundle: Bundle = { productId: line.productId, title: line.title, handle: line.handle, changes: targets.map((t) => t.change) };
        const outcomes = await applyBundle(gql, bundle);
        const shown = await readValues(gql, targets.map((t) => t.change.target)).catch(() => new Map());
        for (const { change } of targets) {
          const t = change.target as Extract<Target, { kind: "translation" }>;
          const o = outcomes.get(change.id);
          const label = `${t.slot} · ${describeThing(seen.options, t.resourceId)}`;
          const wrong = o?.status === "done" && shown.size > 0 && normText(String(shown.get(change.id) ?? "")) !== normText(change.after ?? "");
          rows.push(row(`Translation ${label}`, change.before ?? "", change.after ?? "", !o ? "not applied" : o.status === "failed" ? "failed" : o.status === "not applied" ? "not applied" : wrong ? "not verified" : "done", o && o.status !== "done" ? o.message : wrong ? "Shopify said ok but still shows a different value." : ""));
        }
      }

      // 5. verify the structure
      const final = seen;
      const expected = plan.variantsAfter;
      if (plan.createAll || plan.creates.length > 0 || plan.updates.some((u) => u.addValues.length > 0)) {
        const ok = final.variants === expected;
        rows.push(row("Variants", "", `${final.variants} variant${final.variants === 1 ? "" : "s"}`, ok ? "done" : "not verified", ok ? "" : `Expected ${expected} variants, Shopify shows ${final.variants}.`));
      }
      onDone();
      return { rows };
    },
    describe: (l) => ({ productId: l.productId, title: l.title, handle: l.handle }),
  };
}

function describeThing(options: SavedOption[], id: string): string {
  for (const o of options) {
    if (o.id === id) return o.name;
    const v = o.values.find((x) => x.id === id);
    if (v) return `${o.name} / ${v.name}`;
  }
  return id;
}


// ---------------------------------------------------------------- editing helpers (pure)

/** A new list with the item at `from` moved to `to` (both clamped). The list is returned as it was when nothing moves. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item!);
  return next;
}

/** Values typed in one box: separated by commas, semicolons or new lines. Empty and repeated ones are left out. */
export function parseValues(text: string, existing: string[] = []): string[] {
  const seen = new Set(existing.map((v) => cleanName(v).toLowerCase()));
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const v = cleanName(raw);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

/** The variants the options make, as names ("Oak / 180 cm"), in the order Shopify lists them. */
export function variantNames(options: OptionDraft[]): string[] {
  return options
    .filter((o) => cleanName(o.name) !== "" && live(o.values).length > 0)
    .reduce<string[][]>((acc, o) => acc.flatMap((row) => live(o.values).map((v) => [...row, cleanName(v.name)])), [[]])
    .map((row) => row.join(" / "));
}
