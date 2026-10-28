import { defineBlock, ExternalLink, Muted, Pill, Section, Table, plural } from "../../shared/index";
import { load, type Data } from "./logic";

export function View({ data }: { data: Data }) {
  return (
    <s-stack direction="block" gap="base">
      <Section title={`Collections (${data.collections.length})`}>
        {data.collections.length ? (
          <Table
            headers={data.show.type ? ["Collection", "Type"] : ["Collection"]}
            rows={data.collections.map((c) => ({
              key: c.id,
              cells: data.show.type ? [<ExternalLink href={c.url}>{c.title}</ExternalLink>, <Pill tone={c.automated ? "info" : "neutral"}>{c.automated ? "Automated" : "Manual"}</Pill>] : [<ExternalLink href={c.url}>{c.title}</ExternalLink>],
            }))}
          />
        ) : (
          <Muted>Not in any collection.</Muted>
        )}
        {data.complete ? null : <Muted>More collections exist than were read.</Muted>}
      </Section>
      {data.show.tags ? (
      <Section title={`Tags (${data.tags.length})`}>
        {data.tags.length ? (
          <s-stack direction="inline" gap="small-300">
            {data.tags.map((t) => (
              <Pill key={t} tone="neutral">
                {t}
              </Pill>
            ))}
          </s-stack>
        ) : (
          <Muted>No tags.</Muted>
        )}
      </Section>
      ) : null}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Collections and tags",
  load,
  summary: (d) => (d.show.tags ? `${plural(d.collections.length, "collection")}, ${plural(d.tags.length, "tag")}` : plural(d.collections.length, "collection")),
  View,
});
