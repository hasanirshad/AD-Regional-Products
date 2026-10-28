// Small pieces the Settings tabs share: a row that can move and be removed, a switch, an inline error, and a picker of
// the store's metafield definitions (so a key can only be one that exists).

import type { ReactNode } from "react";
import type { BlockSettings, Problem } from "../../../extensions/shared/settings";
import { onChecked } from "../../lib/dom";
import type { Definition, ShopInfo } from "../../lib/editor/load";
import type { Market } from "../../lib/types";
import type { Lazy } from "../../views/editor-state";
import { Loading } from "../Loading";
import { SelectField } from "../SelectField";

export type PanelProps = {
  draft: BlockSettings;
  /** Replaces the draft. */
  set: (next: BlockSettings) => void;
  /** Every problem of the draft; a tab shows the ones at its own paths. */
  problems: Problem[];
  productDefs: Lazy<Definition[]>;
  variantDefs: Lazy<Definition[]>;
  info: ShopInfo | null;
  markets: Market[];
};

/** A changed copy of the draft. */
export function edited(draft: BlockSettings, change: (copy: BlockSettings) => void): BlockSettings {
  const copy = structuredClone(draft);
  change(copy);
  return copy;
}

export const errorAt = (problems: Problem[], path: string): string | undefined => problems.find((p) => p.path === path)?.message;
export const errorsUnder = (problems: Problem[], prefix: string): Problem[] => problems.filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`));

/** Moves item `i` by `delta` places. */
export function moved<T>(list: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(i, 1);
  copy.splice(j, 0, item as T);
  return copy;
}

export function Switch({ label, checked, onChange, details, disabled }: { label: string; checked: boolean; onChange: (on: boolean) => void; details?: string; disabled?: boolean }) {
  return <s-switch label={label} details={details} checked={checked || undefined} disabled={disabled || undefined} ref={onChecked(onChange)} />;
}

export function ErrorLine({ message }: { message?: string }) {
  return message ? <s-text tone="critical">{message}</s-text> : null;
}

/** One list item with Move up / Move down / Remove. */
export function ListRow({
  title,
  detail,
  badge,
  index,
  count,
  onMove,
  onRemove,
  error,
  lead,
  children,
}: {
  title: string;
  detail?: string;
  badge?: string;
  index: number;
  count: number;
  onMove?: (delta: number) => void;
  onRemove?: () => void;
  error?: string;
  /** A control before the title (the on/off switch of a check). */
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={{ border: "1px solid var(--p-color-border, #e3e3e3)", borderRadius: 12, padding: "8px 12px" }}>
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {lead}
            <s-text type="strong">{title}</s-text>
            {badge ? <s-badge>{badge}</s-badge> : null}
            {detail ? <s-text color="subdued">{detail}</s-text> : null}
          </s-stack>
          <s-stack direction="inline" gap="small-100">
            {onMove ? (
              <>
                <s-button variant="tertiary" accessibilityLabel={`Move ${title} up`} disabled={index === 0 || undefined} onClick={() => onMove(-1)}>
                  Move up
                </s-button>
                <s-button variant="tertiary" accessibilityLabel={`Move ${title} down`} disabled={index >= count - 1 || undefined} onClick={() => onMove(1)}>
                  Move down
                </s-button>
              </>
            ) : null}
            {onRemove ? (
              <s-button variant="tertiary" tone="critical" accessibilityLabel={`Remove ${title}`} onClick={onRemove}>
                Remove
              </s-button>
            ) : null}
          </s-stack>
        </s-stack>
        {children}
        <ErrorLine message={error} />
      </s-stack>
    </div>
  );
}

export type DefChoice = { owner: "product" | "variant"; def: Definition };

/**
 * A list of the store's metafield definitions to pick from. It is the only way to add a metafield key, so a key that
 * does not exist cannot be typed. Remounts after each pick so it shows "Choose…" again.
 */
export function MetafieldPicker({
  label,
  owners,
  productDefs,
  variantDefs,
  exclude,
  filter,
  onPick,
  counter,
}: {
  label: string;
  owners: ("product" | "variant")[];
  productDefs: Lazy<Definition[]>;
  variantDefs: Lazy<Definition[]>;
  /** Choices already used, as "owner.namespace.key". */
  exclude?: Set<string>;
  filter?: (d: Definition) => boolean;
  onPick: (choice: DefChoice) => void;
  /** Changes after each pick, so the select starts again from "Choose…". */
  counter: number;
}) {
  const wanted = owners.map((o) => ({ owner: o, lazy: o === "product" ? productDefs : variantDefs }));
  if (wanted.some((w) => w.lazy.status === "loading" || w.lazy.status === "idle")) return <Loading message="Reading your metafield definitions…" />;
  const failed = wanted.find((w) => w.lazy.status === "error");
  if (failed) {
    return (
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-text tone="critical">{`Metafield definitions could not be read: ${failed.lazy.error}`}</s-text>
        <s-button onClick={failed.lazy.reload}>Try again</s-button>
      </s-stack>
    );
  }
  const choices: DefChoice[] = wanted.flatMap((w) => (w.lazy.data ?? []).filter((d) => !filter || filter(d)).map((def) => ({ owner: w.owner, def })));
  const free = choices.filter((c) => !exclude?.has(`${c.owner}.${c.def.namespace}.${c.def.key}`));
  if (choices.length === 0) return <s-text color="subdued">Your store has no metafield definitions of this kind yet. Create one in Shopify first.</s-text>;
  if (free.length === 0) return <s-text color="subdued">Every metafield definition is already in the list.</s-text>;
  const value = (c: DefChoice) => `${c.owner}|${c.def.namespace}|${c.def.key}`;
  const text = (c: DefChoice) => `${owners.length > 1 ? `${c.owner === "variant" ? "Variant" : "Product"}: ` : ""}${c.def.namespace}.${c.def.key} (${c.def.name})`;
  return (
    <SelectField
      key={counter}
      label={label}
      value=""
      options={[{ value: "", label: "Choose a metafield…" }, ...free.map((c) => ({ value: value(c), label: text(c) }))]}
      onChange={(v) => {
        const found = free.find((c) => value(c) === v);
        if (found) onPick(found);
      }}
    />
  );
}

/** Says when a metafield used by the draft is not among the store's definitions (the check in the model reports it too). */
export const nameOf = (defs: Definition[] | null, namespace: string, key: string): string | undefined => defs?.find((d) => d.namespace === namespace && d.key === key)?.name;
