import { useRef, useState } from "react";
import { normalizeThemeId, type MarketSetting } from "../../../extensions/shared/settings";
import { SelectField } from "../SelectField";
import { Loading } from "../Loading";
import { TextBox } from "../editor/TextBox";
import { edited, errorAt, ErrorLine, ListRow, moved, Switch, type PanelProps } from "./widgets";

/** Quick links: the preview theme, and the storefront domain of each market. */
export function LinksPanel({ draft, set, problems }: PanelProps) {
  const enabled = draft.markets.filter((m) => m.enabled);
  return (
    <s-stack gap="large-100">
      <s-stack gap="small-200">
        <s-heading>Preview theme</s-heading>
        <TextBox
          label="Preview theme id"
          value={draft.links.previewThemeId}
          onChange={(v) => set(edited(draft, (d) => void (d.links.previewThemeId = normalizeThemeId(v))))}
          placeholder="For example 143918219507"
          details="Digits only. In Shopify admin open the theme and copy the number at the end of its address; pasting the whole address works too. Leave empty to hide the preview link."
          error={errorAt(problems, "links.previewThemeId")}
        />
        {enabled.length > 0 ? (
          <SelectField
            label="Open the preview on the domain of"
            value={enabled.some((m) => m.key === draft.links.previewMarket) ? draft.links.previewMarket : (enabled[0]?.key ?? "")}
            options={enabled.map((m) => ({ value: m.key, label: `${m.key} · ${m.label} (${m.domain || "no domain"})` }))}
            onChange={(v) => set(edited(draft, (d) => void (d.links.previewMarket = v)))}
          />
        ) : null}
        <ErrorLine message={errorAt(problems, "links.previewMarket")} />
      </s-stack>

      <s-stack gap="small-200">
        <s-heading>Storefront domain of each market</s-heading>
        <s-text color="subdued">The block builds each storefront link from this domain and the product handle. Use the domain only, for example hardmandesign.fr, or a domain with a folder such as example.com/fr.</s-text>
        {draft.markets.length === 0 ? <s-text color="subdued">No markets. Add one on the Market availability tab.</s-text> : null}
        {draft.markets.map((m, i) => (
          <ListRow key={`row${i}`} title={m.key} detail={m.label} badge={m.enabled ? undefined : "Hidden in the blocks"} index={i} count={draft.markets.length}>
            <s-stack direction="inline" gap="base" alignItems="end">
              <TextBox
                label={`${m.key} storefront domain`}
                value={m.domain}
                onChange={(v) => set(edited(draft, (d) => void (d.markets[i]!.domain = v.trim().replace(/^https?:\/\//i, "").toLowerCase())))}
                placeholder="hardmandesign.fr"
                error={errorAt(problems, `markets.${i}.domain`)}
              />
              <Switch label="Add ?stay_us=1 to links" checked={m.stayUs} onChange={(on) => set(edited(draft, (d) => void (d.markets[i]!.stayUs = on)))} details="For a storefront that sends visitors from other countries away." />
            </s-stack>
          </ListRow>
        ))}
      </s-stack>
    </s-stack>
  );
}

const uniqueKey = (base: string, taken: string[]) => {
  let key = base.slice(0, 12) || "M";
  let n = 2;
  while (taken.includes(key)) key = `${base.slice(0, 10)}${n++}`;
  return key;
};

/** Market availability (and Sale and badge): which markets the blocks list. */
export function MarketsPanel({ draft, set, problems, markets }: PanelProps) {
  const [counter, setCounter] = useState(0);
  const have = new Set(draft.markets.map((m) => `${m.label}|${m.country}`));
  const candidates = markets.filter((m) => m.countries.length > 0 && !have.has(`${m.name}|${m.countries[0]!.code}`));

  const addFromStore = (id: string) => {
    const m = markets.find((x) => x.id === id);
    const country = m?.countries[0]?.code;
    if (!m || !country) return;
    set(edited(draft, (d) => void d.markets.push({ key: uniqueKey(country, d.markets.map((x) => x.key)), label: m.name, country, domain: "", stayUs: false, marketHandle: "", enabled: true } satisfies MarketSetting)));
    setCounter((n) => n + 1);
  };

  const remove = (i: number) =>
    set(
      edited(draft, (d) => {
        const [gone] = d.markets.splice(i, 1);
        if (gone && d.links.previewMarket === gone.key) d.links.previewMarket = d.markets[0]?.key ?? "";
      }),
    );

  return (
    <s-stack gap="small-200">
      <s-text color="subdued">The Market availability and Sale and badge blocks list these markets, in this order. Switch a market off to hide it without losing its settings.</s-text>
      {draft.markets.length === 0 ? <s-text color="subdued">No markets. Add one below.</s-text> : null}
      {draft.markets.map((m, i) => (
        <ListRow
          key={`row${i}`}
          title={m.key}
          detail={m.label}
          badge={m.enabled ? undefined : "Hidden"}
          index={i}
          count={draft.markets.length}
          lead={<Switch label={`${m.key} shown in the blocks`} checked={m.enabled} onChange={(on) => set(edited(draft, (d) => void (d.markets[i]!.enabled = on)))} />}
          onMove={(delta) => set(edited(draft, (d) => void (d.markets = moved(d.markets, i, delta))))}
          onRemove={() => remove(i)}
        >
          <s-stack direction="inline" gap="base">
            <TextBox label="Short code" value={m.key} onChange={(v) =>
                set(
                  edited(draft, (d) => {
                    if (d.links.previewMarket === m.key) d.links.previewMarket = v.trim();
                    d.markets[i]!.key = v.trim();
                  }),
                )
              } error={errorAt(problems, `markets.${i}.key`)} />
            <TextBox label="Name" value={m.label} onChange={(v) => set(edited(draft, (d) => void (d.markets[i]!.label = v)))} error={errorAt(problems, `markets.${i}.label`)} />
            <TextBox label="Country code" value={m.country} onChange={(v) => set(edited(draft, (d) => void (d.markets[i]!.country = v.trim().toUpperCase())))} details="Two letters, for example GB." error={errorAt(problems, `markets.${i}.country`)} />
            <TextBox
              label="Market handle (only if two markets share the country)"
              value={m.marketHandle}
              onChange={(v) => set(edited(draft, (d) => void (d.markets[i]!.marketHandle = v.trim())))}
              error={errorAt(problems, `markets.${i}.marketHandle`)}
            />
          </s-stack>
          {m.domain === "" ? <s-text tone="critical">{`${m.key} has no storefront domain yet. Add it on the Quick links tab.`}</s-text> : null}
        </ListRow>
      ))}
      <ErrorLine message={errorAt(problems, "markets")} />
      {candidates.length > 0 ? (
        <SelectField key={counter} label="Add a market of your store" value="" options={[{ value: "", label: "Choose a market…" }, ...candidates.map((m) => ({ value: m.id, label: `${m.name} (${m.countries.map((c) => c.code).join(", ")})` }))]} onChange={addFromStore} />
      ) : (
        <s-text color="subdued">Every market of your store is already in the list.</s-text>
      )}
    </s-stack>
  );
}

/** Sale and badge: the badge metafield and the sale collection. */
export function SalePanel({ draft, set, problems, productDefs }: PanelProps) {
  const current = `${draft.sale.badgeNamespace}|${draft.sale.badgeKey}`;
  const defs = productDefs.data ?? [];
  const inList = defs.some((d) => `${d.namespace}|${d.key}` === current);
  return (
    <s-stack gap="base">
      <s-stack gap="small-200">
        <s-heading>Badge</s-heading>
        {productDefs.status === "loading" || productDefs.status === "idle" ? <Loading message="Reading your metafield definitions…" /> : null}
        {productDefs.status === "error" ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text tone="critical">{`Metafield definitions could not be read: ${productDefs.error}`}</s-text>
            <s-button onClick={productDefs.reload}>Try again</s-button>
          </s-stack>
        ) : null}
        {productDefs.status === "ready" && defs.length === 0 ? <s-text color="subdued">Your store has no product metafield definitions yet. Create the badge metafield in Shopify first.</s-text> : null}
        {productDefs.status === "ready" && defs.length > 0 ? (
          <SelectField
            label="Badge metafield (a product metafield with the badge text)"
            value={current}
            options={[
              ...(inList ? [] : [{ value: current, label: `${draft.sale.badgeNamespace}.${draft.sale.badgeKey} (not a definition of this store)` }]),
              ...defs.map((d) => ({ value: `${d.namespace}|${d.key}`, label: `${d.namespace}.${d.key} (${d.name})` })),
            ]}
            onChange={(v) => {
              const bar = v.indexOf("|");
              set(
                edited(draft, (d) => {
                  d.sale.badgeNamespace = v.slice(0, bar);
                  d.sale.badgeKey = v.slice(bar + 1);
                }),
              );
            }}
          />
        ) : null}
        <ErrorLine message={errorAt(problems, "sale.badgeKey")} />
      </s-stack>
      <TextBox
        label="Sale collection handle"
        value={draft.sale.collectionHandle}
        onChange={(v) => set(edited(draft, (d) => void (d.sale.collectionHandle = v.trim())))}
        placeholder="sale"
        details="The handle is the last part of the collection's address. Leave it empty to skip the sale collection check."
        error={errorAt(problems, "sale.collectionHandle")}
      />
    </s-stack>
  );
}

/** Collections and tags. */
export function CollectionsPanel({ draft, set }: PanelProps) {
  return (
    <s-stack gap="small-200">
      <Switch label="Show the type of each collection (manual or automated)" checked={draft.collections.showType} onChange={(on) => set(edited(draft, (d) => void (d.collections.showType = on)))} />
      <Switch label="Show the product's tags" checked={draft.collections.showTags} onChange={(on) => set(edited(draft, (d) => void (d.collections.showTags = on)))} />
    </s-stack>
  );
}

/** Recent activity: how many events. */
export function ActivityPanel({ draft, set, problems }: PanelProps) {
  const limit = draft.activity.eventsLimit;
  const typed = useRef(String(limit));
  const shown = Number.isInteger(limit) ? String(limit) : typed.current;
  return (
    <TextBox
      label="Events to list"
      value={shown}
      onChange={(v) => {
        typed.current = v;
        set(edited(draft, (d) => void (d.activity.eventsLimit = /^\d{1,3}$/.test(v.trim()) ? Number(v.trim()) : Number.NaN)));
      }}
      details="A whole number from 1 to 50. The newest events come first."
      error={errorAt(problems, "activity.eventsLimit")}
    />
  );
}

/** Market adaptations: which languages can be adapted for a market. Each adds a translation box in Edit product and Bulk edit. */
export function AdaptationsPanel({ draft, set, problems, info, markets }: PanelProps) {
  const [locale, setLocale] = useState("");
  const [marketId, setMarketId] = useState("");
  const [counter, setCounter] = useState(0);
  const locales = info?.locales ?? [];
  const exists = draft.adaptations.some((a) => a.locale === locale && a.marketId === marketId);
  const market = markets.find((m) => m.id === marketId);

  return (
    <s-stack gap="base">
      <s-text color="subdued">Choose which languages can be adapted for a market. Each one adds a translation box next to the language boxes, for every translatable field.</s-text>
      {info === null ? <Loading message="Reading your store's languages…" /> : null}
      <s-stack direction="inline" gap="base" alignItems="end">
        <SelectField key={`l${counter}`} label="Language" value={locale} options={[{ value: "", label: "Choose a language…" }, ...locales.map((l) => ({ value: l.locale, label: `${l.name}${l.primary ? " (main language)" : ""}` }))]} onChange={setLocale} />
        <SelectField key={`m${counter}`} label="Market" value={marketId} options={[{ value: "", label: "Choose a market…" }, ...markets.map((m) => ({ value: m.id, label: m.name }))]} onChange={setMarketId} />
        <s-button
          disabled={!locale || !market || exists || undefined}
          onClick={() => {
            if (!market) return;
            set(edited(draft, (d) => void d.adaptations.push({ locale, marketId: market.id, marketName: market.name })));
            setLocale("");
            setMarketId("");
            setCounter((n) => n + 1);
          }}
        >
          Add adaptation
        </s-button>
      </s-stack>
      {exists ? <s-text color="subdued">That adaptation is already in the list.</s-text> : null}
      {draft.adaptations.length === 0 ? <s-text color="subdued">No adaptations yet.</s-text> : null}
      {draft.adaptations.map((a, i) => {
        const language = locales.find((l) => l.locale === a.locale);
        const marketGone = markets.length > 0 && !markets.some((m) => m.id === a.marketId);
        return (
          <ListRow
            key={`${a.locale}|${a.marketId}`}
            title={language?.name ?? a.locale}
            detail={a.marketName}
            badge={!language ? "Language not on the store" : marketGone ? "Market not found" : undefined}
            index={i}
            count={draft.adaptations.length}
            onRemove={() => set(edited(draft, (d) => void d.adaptations.splice(i, 1)))}
            error={errorAt(problems, `adaptations.${i}`) ?? errorAt(problems, `adaptations.${i}.marketId`) ?? errorAt(problems, `adaptations.${i}.locale`)}
          />
        );
      })}
      <ErrorLine message={errorAt(problems, "adaptations")} />
      <s-text color="subdued">Removing an adaptation only hides its boxes. Texts already saved in Shopify for that market stay there. Saving asks for the password, like every other write.</s-text>
    </s-stack>
  );
}
