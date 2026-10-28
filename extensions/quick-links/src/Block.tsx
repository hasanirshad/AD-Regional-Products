import { defineBlock, ExternalLink, Muted, Note, Section } from "../../shared/index";
import { load, type Data } from "./logic";

export function View({ data }: { data: Data }) {
  return (
    <s-stack direction="block" gap="base">
      {data.status !== "ACTIVE" ? (
        <Note tone="warning" heading={`Product is ${data.status.toLowerCase()}`}>
          Storefront links will not open a product that is not active.
        </Note>
      ) : null}
      <Section title="On the storefront">
        <s-stack direction="block" gap="small-300">
          {data.storefront.map((l) => (
            <ExternalLink key={l.key} href={l.url}>
              {l.key} · {l.label}
            </ExternalLink>
          ))}
        </s-stack>
      </Section>
      <Section title="Preview theme">
        {data.preview ? <ExternalLink href={data.preview.url}>{data.preview.label}</ExternalLink> : <Muted>No preview theme set. Add the theme id on the Settings page of the app.</Muted>}
      </Section>
      <Section title="Admin">
        <ExternalLink href={data.orders.url}>{data.orders.label}</ExternalLink>
      </Section>
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Quick links",
  load,
  summary: (d) => `${d.storefront.length} storefront links`,
  View,
});
