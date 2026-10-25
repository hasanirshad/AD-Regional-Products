import { useMemo, useState, type ReactNode } from "react";
import { FilterBar } from "../components/FilterBar";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { FixReview } from "../components/FixReview";
import { ScopeBanner } from "../components/ScopeBanner";
import { SelectField } from "../components/SelectField";
import { summarizeCodes } from "../lib/countries";
import { affectedLines, type FixRequest } from "../lib/fix";
import {
  buildOverview,
  countryMatrix,
  focusOf,
  matchFocus,
  NO_FOCUS,
  type CellState,
  type Focus,
  type ProfileRow,
  type Issue,
  type ProductLine,
} from "../lib/overview";
import { useStartProducts } from "./products-state";
import { useAppState } from "./state";

const PAGE_SIZE = 40;

const CELL: Record<CellState, { label: string; tone: "success" | "warning" | "critical" | "neutral" }> = {
  sellable: { label: "Sells", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  blocked: { label: "Blocked", tone: "critical" },
  unpublished: { label: "Not published", tone: "neutral" },
};

const ISSUE_TONE = { critical: "critical", warning: "warning", info: "info" } as const;

type Open = (focus: Focus) => void;

/** A number or label that opens the matching products. A zero stays plain text. */
function Go({
  n,
  focus,
  open,
  children,
  label,
}: {
  n?: number;
  focus: Focus;
  open: Open;
  children: ReactNode;
  label: string;
}) {
  if (n === 0) return <>{children}</>;
  return (
    <s-clickable accessibilityLabel={label} onClick={() => open(focus)}>
      {children}
    </s-clickable>
  );
}

function Tile({
  label,
  value,
  hint,
  focus,
  open,
}: {
  label: string;
  value: number | string;
  hint?: string;
  focus: Focus;
  open: Open;
}) {
  return (
    <s-clickable accessibilityLabel={`Show products: ${label}`} onClick={() => open(focus)} border="base" borderRadius="base">
      <s-box padding="base">
        <s-stack gap="small-300">
          <s-text color="subdued">{label}</s-text>
          <s-heading>{String(value)}</s-heading>
          {hint ? <s-text color="subdued">{hint}</s-text> : null}
        </s-stack>
      </s-box>
    </s-clickable>
  );
}

type StartFix = (r: FixRequest) => void;

function IssueBanner({ issue, open, startFix, marketName }: { issue: Issue; open: Open; startFix: StartFix; marketName: (id: string) => string }) {
  const focus = issue.focus;
  const fix = issue.fix;
  return (
    <s-banner tone={ISSUE_TONE[issue.level]} heading={issue.title}>
      <s-paragraph>{issue.detail}</s-paragraph>
      {focus ? (
        <s-button slot="secondary-actions" onClick={() => open(focus)}>
          Show products
        </s-button>
      ) : null}
      {fix?.kind === "unify" ? (
        <s-button slot="secondary-actions" onClick={() => startFix({ kind: "unify" })}>
          Put each in one profile
        </s-button>
      ) : fix ? (
        <>
          {fix.actions.includes("unpublish") ? (
            <s-button
              slot="secondary-actions"
              onClick={() => startFix({ kind: "unpublish", profileKey: fix.profileKey, marketId: fix.marketId, state: fix.state })}
            >
              {`Unpublish from ${marketName(fix.marketId)}`}
            </s-button>
          ) : null}
          {fix.actions.includes("countries") ? (
            <s-button
              slot="secondary-actions"
              onClick={() => startFix({ kind: "countries", profileKey: fix.profileKey, marketId: fix.marketId, state: fix.state })}
            >
              Add countries to profile
            </s-button>
          ) : null}
        </>
      ) : null}
    </s-banner>
  );
}

function CountsCell({
  counts,
  open,
  base,
}: {
  counts: Record<CellState, number>;
  open: Open;
  base: Partial<Focus>;
}) {
  const total = counts.sellable + counts.partial + counts.blocked + counts.unpublished;
  if (total === 0) return <s-text color="subdued">—</s-text>;
  const states: CellState[] = ["sellable", "partial", "blocked", "unpublished"];
  return (
    <s-stack gap="small-300">
      {states.map((st) =>
        counts[st] > 0 ? (
          <Go
            key={st}
            focus={focusOf({ ...base, state: st, activeOnly: true })}
            open={open}
            label={`Show ${counts[st]} products: ${CELL[st].label}`}
          >
            {st === "unpublished" ? (
              <s-text color="subdued">{`${counts[st]} not published`}</s-text>
            ) : (
              <s-badge tone={CELL[st].tone}>{`${counts[st]} ${st === "sellable" ? "sell" : st}`}</s-badge>
            )}
          </Go>
        ) : null,
      )}
    </s-stack>
  );
}

function ProfileBadge({ g }: { g: ProfileRow }) {
  if (!g.profile) return <s-badge tone="warning">No profile</s-badge>;
  if (g.profile.rateCount === 0) return <s-badge tone="critical">No rates</s-badge>;
  return <s-badge tone="success">Active</s-badge>;
}

export default function Overview() {
  const { shop, markets, profiles, products, refresh } = useAppState();
  useStartProducts(products);

  const [tab, setTab] = useState<"overview" | "products" | "fix">("overview");
  const [fixRequest, setFixRequest] = useState<FixRequest | null>(null);
  const [focus, setFocus] = useState<Focus>(NO_FOCUS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const overview = useMemo(
    () =>
      products.status === "ready"
        ? buildOverview({ markets, profiles, rows: products.rows, membership: products.membership, parts: products.parts, notes: products.notes })
        : null,
    [markets, profiles, products.status, products.rows, products.membership, products.parts, products.notes],
  );

  const heading = `Overview · ${shop.name}`;

  if (products.status === "idle" || products.status === "loading") {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-section heading="Overview">
            <Loading message={products.loaded > 0 ? `Reading products… ${products.loaded} so far` : "Reading your setup…"} />
          </s-section>
        </PageBody>
      </s-page>
    );
  }
  if (products.status === "error" || !overview) {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-banner tone="critical" heading="Could not read products">
            <s-paragraph>{products.error}</s-paragraph>
            <s-button slot="secondary-actions" onClick={products.reload}>
              Try again
            </s-button>
          </s-banner>
        </PageBody>
      </s-page>
    );
  }

  const open: Open = (f) => {
    setFocus(f);
    setSearch("");
    setPage(0);
    setTab("products");
    window.scrollTo?.({ top: 0 });
  };

  const { totals, issues } = overview;
  const sellMarkets = overview.markets.map((m) => m.market);
  const countries = countryMatrix(markets, overview.shippers);
  const profileName = (key: string) => overview.shippers.find((s) => s.key === key)?.name ?? key;
  const marketName = (id: string) => sellMarkets.find((m) => m.id === id)?.name ?? id;
  const catalogName = (id: string) => overview.catalogs.find((c) => c.id === id)?.title ?? id;

  const startFix: StartFix = (r) => {
    setFixRequest(r);
    setTab("fix");
    window.scrollTo?.({ top: 0 });
  };

  const tabs = (
    <s-stack direction="inline" gap="small-100">
      <s-button variant={tab === "overview" ? "primary" : "secondary"} onClick={() => setTab("overview")}>
        Overview
      </s-button>
      <s-button variant={tab === "products" ? "primary" : "secondary"} onClick={() => setTab("products")}>
        {`Products (${overview.lines.filter((l) => matchFocus(l, focus)).length})`}
      </s-button>
      {fixRequest ? (
        <s-button variant={tab === "fix" ? "primary" : "secondary"} onClick={() => setTab("fix")}>
          Review fix
        </s-button>
      ) : null}
    </s-stack>
  );

  // ---- Review fix tab ----------------------------------------------------
  if (tab === "fix" && fixRequest) {
    const unify = fixRequest.kind === "unify";
    const target = unify ? undefined : overview.shippers.find((s) => s.key === fixRequest.profileKey);
    const market = unify ? undefined : sellMarkets.find((m) => m.id === fixRequest.marketId);
    const lines = unify
      ? overview.lines.filter((l) => l.split && l.product.status === "ACTIVE")
      : affectedLines(overview.lines, fixRequest.profileKey, fixRequest.marketId, fixRequest.state);
    const leave = () => {
      setFixRequest(null);
      setTab("overview");
    };
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-stack gap="large-100">
            {tabs}
            {unify || (target && market) ? (
              <FixReview
                request={fixRequest}
                lines={lines}
                shippers={overview.shippers}
                markets={markets}
                membership={products.membership}
                parts={products.parts}
                onBack={leave}
                onFinished={() => {
                  leave();
                  void refresh();
                  products.reload();
                }}
              />
            ) : (
              <s-banner tone="warning" heading="This problem no longer exists">
                <s-button slot="secondary-actions" onClick={leave}>
                  Back to overview
                </s-button>
              </s-banner>
            )}
          </s-stack>
        </PageBody>
      </s-page>
    );
  }

  // ---- Products tab ------------------------------------------------------
  if (tab === "products") {
    const q = search.trim().toLowerCase();
    const lines = overview.lines.filter((l) => {
      if (!matchFocus(l, focus)) return false;
      if (!q) return true;
      const p = l.product;
      return [p.title, p.handle, p.vendor, p.productType, ...p.tags].some((v) => v.toLowerCase().includes(q));
    });
    const pages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
    const safePage = Math.min(page, pages - 1);
    const pageLines = lines.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    const set = (patch: Partial<Focus>) => {
      setFocus({ ...focus, ...patch });
      setPage(0);
    };

    const showLabel = { nocat: "In no catalogue", problem: "Cannot be bought somewhere", ok: "No problems", split: "Variants in different profiles" } as const;
    const chips = [
      ...(focus.activeOnly ? [{ key: "activeOnly", label: "Active only" }] : []),
      ...(focus.show ? [{ key: "show", label: showLabel[focus.show] }] : []),
      ...(focus.profileKey ? [{ key: "profileKey", label: `Profile: ${profileName(focus.profileKey)}` }] : []),
      ...(focus.inProfile ? [{ key: "inProfile", label: "In a profile" }] : []),
      ...(focus.marketId ? [{ key: "marketId", label: `Market: ${marketName(focus.marketId)}` }] : []),
      ...(focus.state ? [{ key: "state", label: focus.state === "published" ? "Published" : CELL[focus.state].label }] : []),
      ...(focus.catalogId ? [{ key: "catalogId", label: `Catalogue: ${catalogName(focus.catalogId)}` }] : []),
    ];
    const removeChip = (key: string) => {
      const reset: Partial<Focus> = { [key]: NO_FOCUS[key as keyof Focus] };
      if (key === "marketId") reset.state = "";
      set(reset);
    };

    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-stack gap="large-100">
            {tabs}
          <ScopeBanner scope={products.scope} count={totals.products} onChange={products.setScope} />
            <s-section heading="Products">
              <s-stack gap="base">
                <FilterBar
                  search={search}
                  onSearch={(v) => {
                    setSearch(v);
                    setPage(0);
                  }}
                  placeholder="Search by title, handle, vendor, type or tag"
                  activeCount={chips.length}
                  chips={chips}
                  onRemoveChip={removeChip}
                  onClear={() => {
                    setFocus(NO_FOCUS);
                    setSearch("");
                    setPage(0);
                  }}
                >
                  <SelectField
                    label="Show"
                    value={focus.show}
                    onChange={(v) => set({ show: v as Focus["show"] })}
                    options={[
                      { value: "", label: "All products" },
                      { value: "problem", label: "Cannot be bought somewhere" },
                      { value: "nocat", label: "In no catalogue" },
                      { value: "ok", label: "No problems" },
                      { value: "split", label: "Variants in different profiles" },
                    ]}
                  />
                  <SelectField
                    label="Profile"
                    value={focus.profileKey}
                    onChange={(v) => set({ profileKey: v, inProfile: false })}
                    options={[{ value: "", label: "Any" }, ...overview.shippers.map((s) => ({ value: s.key, label: s.name }))]}
                  />
                  <SelectField
                    label="Market"
                    value={focus.marketId}
                    onChange={(v) => set({ marketId: v, state: v ? focus.state : "" })}
                    options={[{ value: "", label: "Any" }, ...sellMarkets.map((m) => ({ value: m.id, label: m.name }))]}
                  />
                  <SelectField
                    label="In that market"
                    value={focus.state}
                    onChange={(v) => set({ state: v as Focus["state"] })}
                    options={[
                      { value: "", label: "Any" },
                      { value: "published", label: "Published" },
                      { value: "sellable", label: "Sells" },
                      { value: "partial", label: "Partial" },
                      { value: "blocked", label: "Blocked" },
                      { value: "unpublished", label: "Not published" },
                    ]}
                  />
                </FilterBar>
                <s-text color="subdued">{`${lines.length} of ${overview.lines.length} products`}</s-text>
                {lines.length === 0 ? (
                  <s-paragraph>No products match.</s-paragraph>
                ) : (
                  <s-table>
                    <s-table-header-row>
                      <s-table-header>Product</s-table-header>
                      <s-table-header>Profile</s-table-header>
                      <s-table-header>Catalogues</s-table-header>
                      {sellMarkets.map((m) => (
                        <s-table-header key={m.id}>{m.name}</s-table-header>
                      ))}
                    </s-table-header-row>
                    <s-table-body>
                      {pageLines.map((l) => (
                        <ProductLineRow key={l.product.id} line={l} marketIds={sellMarkets.map((m) => m.id)} />
                      ))}
                    </s-table-body>
                  </s-table>
                )}
                {lines.length > PAGE_SIZE ? (
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <s-button disabled={safePage === 0 || undefined} onClick={() => setPage(safePage - 1)}>
                      Previous
                    </s-button>
                    <s-text color="subdued">{`Page ${safePage + 1} of ${pages}`}</s-text>
                    <s-button disabled={safePage >= pages - 1 || undefined} onClick={() => setPage(safePage + 1)}>
                      Next
                    </s-button>
                  </s-stack>
                ) : null}
              </s-stack>
            </s-section>
          </s-stack>
        </PageBody>
      </s-page>
    );
  }

  // ---- Overview tab ------------------------------------------------------
  return (
    <s-page heading={heading} inlineSize="large">
      <PageBody>
        <s-stack gap="large-100">
          {tabs}
          <ScopeBanner scope={products.scope} count={totals.products} onChange={products.setScope} />

          <s-section heading="Needs attention">
            <s-stack gap="base">
              {issues.length === 0 ? (
                <s-banner tone="success" heading="No problems found">
                  <s-paragraph>Every shipping profile has rates and every published product can be bought where it is published.</s-paragraph>
                </s-banner>
              ) : (
                issues.map((i, n) => <IssueBanner key={n} issue={i} open={open} startFix={startFix} marketName={marketName} />)
              )}
            </s-stack>
          </s-section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Tile label="Active products" value={totals.active} hint={products.scope === "all" ? `${totals.products} with drafts and archived` : "active products only"} focus={focusOf({ activeOnly: true })} open={open} />
            <Tile label="In a profile" value={totals.inProfiles} hint={`${totals.products - totals.inProfiles} in General`} focus={focusOf({ inProfile: true })} open={open} />
            <Tile label="In no catalogue" value={totals.noCatalogue} hint="active, not sold anywhere" focus={focusOf({ show: "nocat" })} open={open} />
            <Tile label="Shipping profiles" value={totals.profiles} hint="besides General" focus={focusOf({ inProfile: true })} open={open} />
            {totals.split > 0 ? (
              <Tile label="Split products" value={totals.split} hint="variants in different profiles" focus={focusOf({ show: "split", activeOnly: true })} open={open} />
            ) : null}
            <Tile label="Selling markets" value={totals.markets} hint="show published products" focus={focusOf({ state: "published", activeOnly: true })} open={open} />
          </div>

          <s-section heading="Markets">
            <s-stack gap="base">
              <s-text color="subdued">Active products only. "Sells" means published and every country of the market can check out. Click a number to see the products.</s-text>
              <s-table>
                <s-table-header-row>
                  <s-table-header>Market</s-table-header>
                  <s-table-header>Countries</s-table-header>
                  <s-table-header>Catalogues</s-table-header>
                  <s-table-header>Sells</s-table-header>
                  <s-table-header>Partial</s-table-header>
                  <s-table-header>Blocked</s-table-header>
                  <s-table-header>Not published</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {overview.markets.map((m) => {
                    const id = m.market.id;
                    const cell = (st: CellState) => (
                      <s-table-cell>
                        <Go n={m.counts[st]} focus={focusOf({ marketId: id, state: st, activeOnly: true })} open={open} label={`Show ${m.counts[st]} products: ${CELL[st].label} in ${m.market.name}`}>
                          {st === "blocked" && m.counts[st] > 0 ? <s-badge tone="critical">{String(m.counts[st])}</s-badge> : m.counts[st]}
                        </Go>
                      </s-table-cell>
                    );
                    return (
                      <s-table-row key={id}>
                        <s-table-cell>
                          <Go focus={focusOf({ marketId: id, state: "published", activeOnly: true })} open={open} label={`Show products published in ${m.market.name}`}>
                            {m.market.name}
                          </Go>
                        </s-table-cell>
                        <s-table-cell>{summarizeCodes(m.market.countries.map((c) => c.code), 5)}</s-table-cell>
                        <s-table-cell>{m.catalogs.length ? m.catalogs.join(", ") : <s-badge tone="warning">None</s-badge>}</s-table-cell>
                        {cell("sellable")}
                        {cell("partial")}
                        {cell("blocked")}
                        {cell("unpublished")}
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            </s-stack>
          </s-section>

          <s-section heading="Shipping profiles">
            <s-table>
              <s-table-header-row>
                <s-table-header>Profile</s-table-header>
                <s-table-header>Type</s-table-header>
                <s-table-header>Ships to</s-table-header>
                <s-table-header>Profile</s-table-header>
                <s-table-header>Rates</s-table-header>
                <s-table-header>Active products</s-table-header>
                <s-table-header>Variants</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {overview.profiles.map((g) => (
                  <s-table-row key={g.key}>
                    <s-table-cell>
                      <Go focus={focusOf({ profileKey: g.key })} open={open} label={`Show products in ${g.name}`}>
                        {g.name}
                      </Go>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone="neutral">
                        {g.kind === "general" ? "Default" : "Profile"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {g.profile
                        ? g.profile.restOfWorld
                          ? `${summarizeCodes(g.profile.countries, 4)} + rest of world`
                          : summarizeCodes(g.profile.countries, 6)
                        : "—"}
                    </s-table-cell>
                    <s-table-cell><ProfileBadge g={g} /></s-table-cell>
                    <s-table-cell>{g.profile?.rateCount ?? "—"}</s-table-cell>
                    <s-table-cell>
                      <Go n={g.products} focus={focusOf({ profileKey: g.key, activeOnly: true })} open={open} label={`Show ${g.products} active products in ${g.name}`}>
                        {g.products}
                      </Go>
                      {g.splitProducts > 0 ? <s-text color="subdued">{` + ${g.splitProducts} split`}</s-text> : null}
                    </s-table-cell>
                    <s-table-cell>{g.profile?.variantCount ?? "—"}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>

          <s-section heading="Products by profile and market">
            <s-stack gap="base">
              <s-text color="subdued">Where the products of each profile are published and whether the market's countries can check out.</s-text>
              <s-table>
                <s-table-header-row>
                  <s-table-header>Profile</s-table-header>
                  {sellMarkets.map((m) => (
                    <s-table-header key={m.id}>{m.name}</s-table-header>
                  ))}
                </s-table-header-row>
                <s-table-body>
                  {overview.profiles.map((g) => (
                    <s-table-row key={g.key}>
                      <s-table-cell>{g.name}</s-table-cell>
                      {g.perMarket.map((pm) => (
                        <s-table-cell key={pm.coverage.market.id}>
                          <CountsCell counts={pm.counts} open={open} base={{ profileKey: g.key, marketId: pm.coverage.market.id }} />
                          {pm.coverage.state === "mixed" ? (
                            <s-text color="subdued">{`checkout blocks ${summarizeCodes(pm.coverage.blocked, 3)}`}</s-text>
                          ) : pm.coverage.state === "none" ? (
                            <s-text color="subdued">no checkout</s-text>
                          ) : null}
                        </s-table-cell>
                      ))}
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-stack>
          </s-section>

          <s-section heading="Checkout by country">
            <s-stack gap="base">
              <s-text color="subdued">Which shipping profile can check out to which country. A dash means checkout is blocked.</s-text>
              <s-table>
                <s-table-header-row>
                  <s-table-header>Country</s-table-header>
                  <s-table-header>Market</s-table-header>
                  {overview.shippers.map((s) => (
                    <s-table-header key={s.key}>{s.name}</s-table-header>
                  ))}
                </s-table-header-row>
                <s-table-body>
                  {countries.map((c) => (
                    <s-table-row key={c.code}>
                      <s-table-cell>{`${c.name} (${c.code})`}</s-table-cell>
                      <s-table-cell>{c.markets.join(", ")}</s-table-cell>
                      {overview.shippers.map((s) => (
                        <s-table-cell key={s.key}>
                          {c.ships[s.key] ? <s-badge tone="success">Yes</s-badge> : <s-text color="subdued">—</s-text>}
                        </s-table-cell>
                      ))}
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-stack>
          </s-section>

          <s-section heading="Catalogues">
            <s-table>
              <s-table-header-row>
                <s-table-header>Catalogue</s-table-header>
                <s-table-header>Market</s-table-header>
                <s-table-header>Active products</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {overview.catalogs.map((c) => (
                  <s-table-row key={c.id}>
                    <s-table-cell>{c.title}</s-table-cell>
                    <s-table-cell>{c.markets.join(", ")}</s-table-cell>
                    <s-table-cell>
                      <Go n={c.products} focus={focusOf({ catalogId: c.id, activeOnly: true })} open={open} label={`Show ${c.products} products in ${c.title}`}>
                        {c.products}
                      </Go>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        </s-stack>
      </PageBody>
    </s-page>
  );
}

function ProductLineRow({ line, marketIds }: { line: ProductLine; marketIds: string[] }) {
  const p = line.product;
  return (
    <s-table-row>
      <s-table-cell>
        <s-link href={`shopify://admin/products/${p.numericId}`} target="_blank">
          {p.title}
        </s-link>
        {p.status !== "ACTIVE" ? (
          <>
            <br />
            <s-badge tone="neutral">{p.status === "DRAFT" ? "Draft" : "Archived"}</s-badge>
          </>
        ) : null}
      </s-table-cell>
      <s-table-cell>
        {line.split ? (
          <s-badge tone="warning">{`Split: ${line.parts.map((p) => `${p.name}${p.variants > 0 ? ` (${p.variants})` : ""}`).join(" + ")}`}</s-badge>
        ) : (
          line.profileName
        )}
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
      {marketIds.map((id) => {
        const state = line.cells[id];
        return (
          <s-table-cell key={id}>
            {state && state !== "unpublished" ? (
              <s-badge tone={CELL[state].tone}>{CELL[state].label}</s-badge>
            ) : (
              <s-text color="subdued">—</s-text>
            )}
          </s-table-cell>
        );
      })}
    </s-table-row>
  );
}
