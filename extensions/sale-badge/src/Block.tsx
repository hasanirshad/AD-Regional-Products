import { defineBlock, formatPercentRange, formatRange, LANGUAGES, Muted, Note, Pill, SALE_BADGE, SALE_COLLECTION_HANDLE, Section, Table, TranslationPill, plural } from "../../shared/index";
import { load, type Data } from "./logic";

export function View({ data }: { data: Data }) {
  const salesIn = data.rows.filter((r) => r.onSale);
  const anySale = salesIn.length > 0;
  const warnings: string[] = [];
  if (anySale && salesIn.length < data.rows.length) warnings.push(`Sale prices exist in ${salesIn.map((r) => r.def.key).join(", ")} only.`);
  if (anySale && !data.inSaleCollection && data.collectionsComplete) warnings.push(`On sale, but not in the "${SALE_COLLECTION_HANDLE}" collection.`);
  if (!anySale && data.inSaleCollection) warnings.push(`In the "${SALE_COLLECTION_HANDLE}" collection, but no market has a compare-at price.`);
  if (anySale && !data.badge.value) warnings.push(`On sale, but the ${SALE_BADGE.namespace}.${SALE_BADGE.key} badge is empty.`);
  if (!anySale && data.badge.value) warnings.push(`Badge "${data.badge.value}" is set, but no market is on sale.`);

  return (
    <s-stack direction="block" gap="base">
      {warnings.length ? (
        <Note tone="warning" heading="Check this">
          {warnings.join(" ")}
        </Note>
      ) : null}
      <Table
        headers={["Market", "Price", "Compare-at", "Discount"]}
        rows={data.rows.map((r) => ({
          key: r.def.key,
          cells: [
            <s-text type="strong">{r.def.key}</s-text>,
            r.price ? formatRange(r.price.low.price, r.price.high.price) : <Muted>No price</Muted>,
            r.price && (r.price.low.compareAt || r.price.high.compareAt) ? formatRange(r.price.low.compareAt, r.price.high.compareAt) : <Muted>—</Muted>,
            r.onSale ? <Pill tone="success">{formatPercentRange(r.discounts)} off</Pill> : <Muted>No sale</Muted>,
          ],
        }))}
      />
      <Section title="Sale collection">
        {data.inSaleCollection ? (
          <Pill tone="success">In "{SALE_COLLECTION_HANDLE}"</Pill>
        ) : (
          <Pill tone="neutral">Not in "{SALE_COLLECTION_HANDLE}"{data.collectionsComplete ? "" : " (more collections not read)"}</Pill>
        )}
      </Section>
      <Section title={`Badge (${SALE_BADGE.namespace}.${SALE_BADGE.key})`}>
        {data.badge.value ? <s-text type="strong">{data.badge.value}</s-text> : <Muted>No badge set.</Muted>}
        {data.badge.value && data.badge.translations ? (
          <Table headers={["Language", "Translation"]} rows={LANGUAGES.map((l) => ({ key: l.code, cells: [l.label, <TranslationPill cell={data.badge.translations![l.code]!} />] }))} />
        ) : null}
        {data.badge.value && data.badge.translationError ? <Muted>Translations could not be read: {data.badge.translationError.message}</Muted> : null}
      </Section>
      {data.note ? <Muted>{data.note}</Muted> : null}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Sale and badge",
  load,
  summary: (d) => {
    const n = d.rows.filter((r) => r.onSale).length;
    return n ? `On sale in ${plural(n, "market")}` : "No sale";
  },
  View,
});
