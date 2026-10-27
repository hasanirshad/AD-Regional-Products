import { defineBlock, Muted, Pill, Table } from "../../shared/index";
import { TranslationPill } from "../../shared/translations";
import { load, type Data } from "./logic";

export function View({ data }: { data: Data }) {
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="small" alignItems="center">
        {data.languages.map((l) => {
          const t = data.totals[l.code]!;
          const gaps = t.missing + t.same;
          return (
            <Pill key={l.code} tone={gaps ? "warning" : "success"}>
              {l.label}: {t.translated} of {t.total}
            </Pill>
          );
        })}
      </s-stack>
      <Table
        headers={["Field", ...data.languages.map((l) => l.code.toUpperCase())]}
        rows={data.rows.map((r) => ({ key: r.key, cells: [r.label, ...data.languages.map((l) => <TranslationPill cell={r.cells[l.code]!} />)] }))}
      />
      <Muted>"Same as source" means the translation is identical to the original, so it was probably never translated.</Muted>
      {data.notes.map((n) => (
        <Muted key={n}>{n}</Muted>
      ))}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Translation status",
  load,
  empty: (d) => (d.rows.length ? null : "Nothing to translate yet."),
  summary: (d) => {
    const gaps = Object.values(d.totals).reduce((n, t) => n + t.missing + t.same, 0);
    return gaps ? `${gaps} to fix` : "All translated";
  },
  View,
});
