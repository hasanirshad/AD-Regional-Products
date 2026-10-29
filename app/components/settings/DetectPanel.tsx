import { useState } from "react";
import { applyProposals, proposeFromStore, readStoreExtras, type Detected, type StoreFacts } from "../../lib/editor/detect";
import { liveGql, messageOf } from "../../lib/editor/gql";
import { Loading } from "../Loading";
import { Switch, type PanelProps } from "./widgets";

/**
 * "Detect from this store": reads the store and proposes settings as a review list (Add or Skip for each). Adding changes the
 * DRAFT only. Nothing is saved until the changes are reviewed and the password is given.
 */
export function DetectPanel({ draft, set, productDefs, variantDefs, info, markets, first }: PanelProps & { first: boolean }) {
  const [status, setStatus] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [found, setFound] = useState<Detected | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  const run = async () => {
    setStatus("reading");
    setError("");
    setAdded("");
    try {
      const extras = await readStoreExtras(liveGql);
      const facts: StoreFacts = {
        productDefs: productDefs.data ?? null,
        variantDefs: variantDefs.data ?? null,
        metaobjectDefs: extras.metaobjectDefs,
        productTypes: extras.productTypes,
        locales: info ? info.locales.map((l) => ({ locale: l.locale, name: l.name, primary: l.primary, published: l.published })) : null,
        markets: markets.map((m) => ({ id: m.id, name: m.name, countries: m.countries.map((c) => c.code) })),
      };
      const d = proposeFromStore(draft, facts);
      setFound({ proposals: d.proposals, notes: [...extras.notes, ...d.notes] });
      setSkipped(new Set());
      setStatus("done");
    } catch (e) {
      setError(messageOf(e));
      setStatus("error");
    }
  };

  const chosen = found?.proposals.filter((p) => !skipped.has(p.id)) ?? [];

  return (
    <s-section heading="Detect from this store">
      <s-stack gap="base">
        <s-text color="subdued">
          {first
            ? "Nothing is saved yet, so the blocks use the Hardman defaults. Read your store to see what fits it: metafield definitions, metaobject definitions, markets, languages and product Types."
            : "Read your store again and see which settings no longer fit it."}{" "}
          Reading is free. You choose what to add; it only changes the settings below, and nothing is saved until you review the changes and give the password.
        </s-text>
        <div>
          <s-button onClick={run} disabled={status === "reading" || undefined}>
            {status === "done" ? "Read the store again" : "Detect from this store"}
          </s-button>
        </div>
        {status === "reading" ? <Loading message="Reading metafield and metaobject definitions and product Types…" /> : null}
        {status === "error" ? <s-text tone="critical">{`The store could not be read: ${error}`}</s-text> : null}
        {found?.notes.map((n) => (
          <s-text key={n} color="subdued">
            {n}
          </s-text>
        ))}
        {status === "done" && found && found.proposals.length === 0 ? <s-text>Nothing to change: the settings already fit what was found.</s-text> : null}
        {found?.proposals.map((p) => (
          <div key={p.id} style={{ border: "1px solid var(--p-color-border, #e3e3e3)", borderRadius: 12, padding: "8px 12px" }}>
            <s-stack gap="small-200">
              <Switch label={`Add: ${p.title}`} checked={!skipped.has(p.id)} onChange={(on) => setSkipped((prev) => { const next = new Set(prev); if (on) next.delete(p.id); else next.add(p.id); return next; })} />
              {p.lines.map((l, i) => (
                <s-text key={i} color="subdued">
                  {l}
                </s-text>
              ))}
            </s-stack>
          </div>
        ))}
        {found && found.proposals.length > 0 ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-button
              variant="primary"
              disabled={chosen.length === 0 || undefined}
              onClick={() => {
                set(applyProposals(draft, chosen));
                setAdded(`${chosen.length} group${chosen.length === 1 ? "" : "s"} added to the settings below. Not saved yet.`);
                setFound({ ...found, proposals: found.proposals.filter((p) => skipped.has(p.id)) });
                setSkipped(new Set(found.proposals.filter((p) => skipped.has(p.id)).map((p) => p.id)));
              }}
            >
              {`Add ${chosen.length} to the settings`}
            </s-button>
            <s-text color="subdued">Skipped groups stay as they are.</s-text>
          </s-stack>
        ) : null}
        {added ? <s-text tone="success">{added}</s-text> : null}
      </s-stack>
    </s-section>
  );
}
