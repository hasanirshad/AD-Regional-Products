import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { SearchFilterBar } from "../components/filters/SearchFilterBar";
import { SelectionLine } from "../components/filters/SelectionLine";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { PublishReview } from "../components/PublishReview";
import { ScopeBanner } from "../components/ScopeBanner";
import { SelectField } from "../components/SelectField";
import { buildTargets, planPublish, type Channel, type Choice, type Pick, type PubPlan } from "../lib/channels";
import { onChecked } from "../lib/dom";
import type { SectionId } from "../lib/filters/filterModel";
import { matchingSelected, selectMatching } from "../lib/filters/selection";
import { readPublications } from "../lib/readback";
import { loadChannels } from "../lib/shopify-data";
import type { ProductRow } from "../lib/types";
import { useListFilters } from "./filter-state";
import { useStartProducts } from "./products-state";
import { useAppState } from "./state";

const PAGE_SIZE = 40;
/** Reviewing reads every selected product once, so the number is capped. */
const MAX_SELECTED = 1000;
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };
const SECTIONS: SectionId[] = ["status", "vendor", "productType", "collection", "tag", "tagNot", "catalog", "market", "variants"];

type Stage = "choose" | "reading" | "review";

// Four steps: 1 choose products, 2 choose what to change, 3 review (nothing written), 4 apply.
// Unlike the other pages, this one includes the Global market and its catalogue.
export default function Channels() {
  const { shop, markets, hiddenMarkets, profiles, products, channelsUi: ui, collections, refresh } = useAppState();
  useStartProducts(products);
  const { filters, setFilters, selected, setSelected, page, setPage } = ui;

  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelError, setChannelError] = useState("");
  const [choice, setChoice] = useState<Choice>({});
  const [stage, setStage] = useState<Stage>("choose");
  const [plan, setPlan] = useState<PubPlan | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadChannels()
      .then((c) => !cancelled && setChannels(c))
      .catch((err) => !cancelled && setChannelError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Rows with the Global catalogue added back (the shared rows leave it out).
  const rows = useMemo<ProductRow[]>(
    () => products.rows.map((p) => (products.hiddenCatalogs[p.id] ? { ...p, catalogs: [...p.catalogs, ...products.hiddenCatalogs[p.id]!] } : p)),
    [products.rows, products.hiddenCatalogs],
  );
  // This page includes the Global market, so its catalogue is a market here too.
  const allMarkets = useMemo(() => [...markets, ...hiddenMarkets], [markets, hiddenMarkets]);
  const found = useListFilters({ rows, ui, markets: allMarkets, collections, sections: SECTIONS });
  const filtered = found.list;
  const { targets, unavailable } = useMemo(
    () => buildTargets({ channels: channels ?? [], markets, hiddenMarkets }),
    [channels, markets, hiddenMarkets],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pageAllSelected = pageRows.length > 0 && pageRows.every((p) => selected.has(p.id));
  const picked = Object.keys(choice).length;

  const toggleOne = useCallback(
    (id: string, on: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    [setSelected],
  );
  const togglePage = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of pageRows) {
        if (on) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  const setPick = (id: string, value: string) =>
    setChoice((prev) => {
      const next = { ...prev };
      if (value === "publish" || value === "unpublish") next[id] = value as Pick;
      else delete next[id];
      return next;
    });

  const review = async () => {
    setError("");
    setStage("reading");
    try {
      const chosen = rows.filter((p) => selected.has(p.id));
      const states = await readPublications(chosen.map((p) => p.id));
      setPlan(
        planPublish({ products: chosen, states, targets, choice, markets, profiles, membership: products.membership, parts: products.parts }),
      );
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("choose");
    }
  };

  const heading = `Channels & catalogues · ${shop.name}`;

  if (products.status === "idle" || products.status === "loading") {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-section heading="Products">
            <Loading message={products.loaded > 0 ? `Loading products… ${products.loaded} so far` : "Loading products…"} />
          </s-section>
        </PageBody>
      </s-page>
    );
  }
  if (products.status === "error") {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-banner tone="critical" heading="Could not load products">
            <s-paragraph>{products.error}</s-paragraph>
            <s-button slot="secondary-actions" onClick={products.reload}>
              Try again
            </s-button>
          </s-banner>
        </PageBody>
      </s-page>
    );
  }

  if (stage === "reading") {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-section heading="Reading the selected products">
            <Loading message={`Reading ${selected.size} product${selected.size === 1 ? "" : "s"} from Shopify…`} />
          </s-section>
        </PageBody>
      </s-page>
    );
  }

  if (stage === "review" && plan) {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <PublishReview
            plan={plan}
            onBack={() => setStage("choose")}
            onFinished={() => {
              setStage("choose");
              setPlan(null);
              setChoice({});
              setSelected(() => new Set());
              void refresh();
              products.reload();
            }}
          />
        </PageBody>
      </s-page>
    );
  }

  const channelTargets = targets.filter((t) => t.kind === "channel");
  const catalogTargets = targets.filter((t) => t.kind === "catalog");
  const tooMany = selected.size > MAX_SELECTED;

  return (
    <s-page heading={heading} inlineSize="large">
      <PageBody>
        <s-stack gap="large-100">
          <ScopeBanner scope={products.scope} count={products.rows.length} onChange={products.setScope} />
          {error ? <s-banner tone="critical" heading="Could not read the products">{error}</s-banner> : null}

          <s-section heading="Step 1 · Choose products">
            <s-stack gap="base">
              <SearchFilterBar filters={filters} onChange={setFilters} sections={SECTIONS} options={found.options} notes={found.notes} onOpen={found.onOpen} />
              <SelectionLine count={selected.size} onlySelected={found.onlySelected} onOnlySelected={ui.setOnlySelected} onClear={ui.clearSelection}>
                {selected.size > MAX_SELECTED ? <s-text tone="critical">{`most ${MAX_SELECTED} at a time`}</s-text> : null}
              </SelectionLine>

              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text color="subdued">
                  {filtered.length} of {rows.length} products · {selected.size} selected
                </s-text>
                {!found.onlySelected && found.matching.length > 0 && matchingSelected(selected, found.matching) < found.matching.length ? (
                  <s-button variant="tertiary" onClick={() => setSelected((prev) => selectMatching(prev, found.matching))}>
                    {`Select all ${found.matching.length} matching`}
                  </s-button>
                ) : null}
                <s-button variant="tertiary" onClick={products.reload}>
                  Refresh products
                </s-button>
              </s-stack>

              {filtered.length === 0 ? (
                <s-stack gap="small-100">
                  <s-paragraph>{found.waiting > 0 ? "No products to show yet." : "No products match these filters."}</s-paragraph>
                  <div>
                    <s-button onClick={ui.clearFilters}>Clear filters</s-button>
                  </div>
                </s-stack>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>
                      <s-checkbox
                        label="Select this page"
                        labelAccessibilityVisibility="exclusive"
                        checked={pageAllSelected || undefined}
                        ref={onChecked(togglePage)}
                      />
                    </s-table-header>
                    <s-table-header>Product</s-table-header>
                    <s-table-header>Status</s-table-header>
                    <s-table-header>Catalogues</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {pageRows.map((p) => (
                      <ChannelRow key={p.id} p={p} checked={selected.has(p.id)} onToggle={toggleOne} />
                    ))}
                  </s-table-body>
                </s-table>
              )}

              {filtered.length > PAGE_SIZE ? (
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-button disabled={safePage === 0 || undefined} onClick={() => setPage(safePage - 1)}>
                    Previous
                  </s-button>
                  <s-text color="subdued">
                    Page {safePage + 1} of {pages}
                  </s-text>
                  <s-button disabled={safePage >= pages - 1 || undefined} onClick={() => setPage(safePage + 1)}>
                    Next
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          </s-section>

          <s-section heading="Step 2 · Choose what to change">
            {channels === null && !channelError ? (
              <Loading message="Reading sales channels…" />
            ) : (
              <s-stack gap="base">
                {channelError ? (
                  <s-banner tone="warning" heading="Sales channels could not be read">
                    <s-paragraph>{channelError}</s-paragraph>
                    <s-paragraph>Catalogues can still be changed.</s-paragraph>
                  </s-banner>
                ) : null}
                <s-text color="subdued">
                  Leave a row on "No change" to skip it. The same choice is applied to every selected product. Only active products are changed.
                </s-text>
                <TargetTable title="Sales channels" kind="channel" rows={channelTargets} choice={choice} onPick={setPick} />
                <TargetTable title="Catalogues" kind="catalog" rows={catalogTargets} choice={choice} onPick={setPick} />
                {unavailable.length > 0 ? (
                  <s-text color="subdued">
                    {`Not changeable (no publication): ${unavailable.map((u) => `${u.label} (${u.group})`).join(", ")}.`}
                  </s-text>
                ) : null}
                {tooMany ? <s-banner tone="critical" heading={`Select ${MAX_SELECTED} products or fewer at a time (you have ${selected.size}).`} /> : null}
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-button variant="primary" disabled={selected.size === 0 || picked === 0 || tooMany || undefined} onClick={() => void review()}>
                    {`Review changes for ${selected.size} product${selected.size === 1 ? "" : "s"}`}
                  </s-button>
                  {selected.size === 0 ? <s-text color="subdued">Select products first.</s-text> : picked === 0 ? <s-text color="subdued">Choose at least one change.</s-text> : null}
                </s-stack>
              </s-stack>
            )}
          </s-section>
        </s-stack>
      </PageBody>
    </s-page>
  );
}

function TargetTable({
  title,
  kind,
  rows,
  choice,
  onPick,
}: {
  title: string;
  kind: "channel" | "catalog";
  rows: ReturnType<typeof buildTargets>["targets"];
  choice: Choice;
  onPick: (id: string, value: string) => void;
}) {
  if (rows.length === 0) return null;
  const yes = kind === "channel" ? "Enable" : "Add";
  const no = kind === "channel" ? "Disable" : "Remove";
  return (
    <s-stack gap="small-200">
      <s-heading>{title}</s-heading>
      <s-table>
        <s-table-header-row>
          <s-table-header>{kind === "channel" ? "Channel" : "Catalogue"}</s-table-header>
          {kind === "catalog" ? <s-table-header>Market</s-table-header> : null}
          <s-table-header>Change</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {rows.map((t) => (
            <s-table-row key={t.id}>
              <s-table-cell>{t.label}</s-table-cell>
              {kind === "catalog" ? <s-table-cell>{t.group}</s-table-cell> : null}
              <s-table-cell>
                <SelectField
                  label={`Change for ${t.label}`}
                  hideLabel
                  value={choice[t.id] ?? ""}
                  onChange={(v) => onPick(t.id, v)}
                  options={[
                    { value: "", label: "No change" },
                    { value: "publish", label: yes },
                    { value: "unpublish", label: no },
                  ]}
                />
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-stack>
  );
}

const ChannelRow = memo(function ChannelRow({ p, checked, onToggle }: { p: ProductRow; checked: boolean; onToggle: (id: string, on: boolean) => void }) {
  return (
    <s-table-row>
      <s-table-cell>
        <s-checkbox label={`Select ${p.title}`} labelAccessibilityVisibility="exclusive" checked={checked || undefined} ref={onChecked((on) => onToggle(p.id, on))} />
      </s-table-cell>
      <s-table-cell>{p.title}</s-table-cell>
      <s-table-cell>
        <s-badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{STATUS_LABEL[p.status] ?? p.status}</s-badge>
      </s-table-cell>
      <s-table-cell>
        {p.catalogs.length === 0 ? (
          <s-badge tone="warning">None</s-badge>
        ) : (
          <s-stack direction="inline" gap="small-300">
            {p.catalogs.map((c) => (
              <s-badge key={c.id} tone="neutral">
                {c.title}
              </s-badge>
            ))}
          </s-stack>
        )}
      </s-table-cell>
    </s-table-row>
  );
});
