import { useState } from "preact/hooks";
import { defineBlock, Muted, Note, Pill, Section, Table } from "../../shared/index";
import { issueSummary, load, type Data, type ValueRow } from "./logic";

const swatchCell = (r: ValueRow, recordsRead: boolean) => {
  if (!recordsRead) return <Muted>Not read</Muted>;
  if (r.swatches.length === 0) return <Muted>—</Muted>;
  return (
    <s-stack direction="block" gap="small-300">
      {r.swatches.map((s) => (
        <s-stack key={s.id} direction="inline" gap="small-200" alignItems="center">
          <s-link href={s.href} target="_blank">
            {s.name}
          </s-link>
          {s.status === "DRAFT" ? <Pill tone="caution">Draft</Pill> : null}
        </s-stack>
      ))}
    </s-stack>
  );
};

export function View({ data }: { data: Data }) {
  const [allVariants, setAllVariants] = useState(false);
  const issues = allVariants ? data.variantIssues : data.variantIssues.slice(0, 10);
  const showSwatches = data.swatchType !== "";
  return (
    <s-stack direction="block" gap="base">
      {data.hiddenMarkets.length ? (
        <Note tone="warning" heading={`Hidden in ${data.hiddenMarkets.join(", ")}`}>
          Every variant is hidden from {data.hiddenMarkets.length === 1 ? "this market" : "these markets"}, so the product page would show no options there.
        </Note>
      ) : null}
      {data.values.length === 0 ? (
        <Muted>This product has no options.</Muted>
      ) : (
        <Table
          headers={["Option", "Value", ...(showSwatches ? ["Swatch", "Group", "Key", "Priority", "3D"] : []), "Check"]}
          rows={data.values.map((r, i) => {
            const sw = r.swatches[0];
            return {
              key: `${r.option}:${i}`,
              cells: [
                r.option,
                <s-text type="strong">{r.value}</s-text>,
                ...(showSwatches ? [swatchCell(r, data.recordsRead), sw?.group || <Muted>—</Muted>, sw?.groupKey || <Muted>—</Muted>, sw?.priority || <Muted>—</Muted>, sw ? (sw.hasModel ? "Yes" : <Muted>No</Muted>) : <Muted>—</Muted>] : []),
                r.flags.length ? (
                  <s-stack direction="block" gap="small-300">
                    {r.flags.map((f) => (
                      <Pill key={f} tone="warning">
                        {f}
                      </Pill>
                    ))}
                  </s-stack>
                ) : (
                  <Pill tone="success">OK</Pill>
                ),
              ],
            };
          })}
        />
      )}
      {data.variantExtras && data.variantIssues.length ? (
        <Section title={`Variants to complete (${data.variantIssues.length} of ${data.variantCount})`}>
          <Table headers={["Variant", "Missing"]} rows={issues.map((v) => ({ key: v.id, cells: [v.title, v.issues.join(", ")] }))} />
          {data.variantIssues.length > 10 ? (
            <s-button variant="tertiary" onClick={() => setAllVariants(!allVariants)}>
              {allVariants ? "Show fewer" : `Show all ${data.variantIssues.length}`}
            </s-button>
          ) : null}
        </Section>
      ) : null}
      {data.notes.map((n) => (
        <Muted key={n}>{n}</Muted>
      ))}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Options and swatches",
  load,
  summary: issueSummary,
  View,
});
