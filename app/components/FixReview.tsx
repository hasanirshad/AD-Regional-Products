import { useMemo, useState } from "react";
import { onChecked } from "../lib/dom";
import { countryName, summarizeCodes } from "../lib/countries";
import {
  defaultZoneId,
  planCountryFix,
  planUnpublishFix,
  ratedZones,
  runCountryFix,
  type CountryFixOutcome,
  type FixRequest,
} from "../lib/fix";
import type { ProductLine, Shipper } from "../lib/overview";
import { moveEngine } from "../lib/runPlan";
import { downloadCsv, reportCsv, reportFileName, type ReportRow } from "../lib/report";
import type { Market, Membership, Parts } from "../lib/types";
import { Loading } from "./Loading";
import { MoveReview } from "./MoveReview";
import { useGuard } from "./PasswordGate";
import { RunFlow } from "./RunFlow";
import { SelectField } from "./SelectField";

const SHOWN = 30;

type Props = {
  request: FixRequest;
  /** The affected products. */
  lines: ProductLine[];
  shippers: Shipper[];
  markets: Market[];
  membership: Membership;
  parts?: Parts;
  onBack: () => void;
  /** Called when the person leaves the result, so the app can reload. */
  onFinished: () => void;
};

// Review step: nothing is written. Apply: only after the box is ticked and the password is given.
export function FixReview(props: Props) {
  const { request, shippers, markets } = props;
  if (request.kind === "unify") return <UnifyFix {...props} />;
  const target = shippers.find((s) => s.key === request.profileKey);
  const market = markets.find((m) => m.id === request.marketId);
  if (!target || !market) {
    return (
      <s-section heading="Fix">
        <s-stack gap="base">
          <s-banner tone="critical" heading="The profile or market was not found. Reload and try again." />
          <div>
            <s-button onClick={props.onBack}>Back</s-button>
          </div>
        </s-stack>
      </s-section>
    );
  }
  return request.kind === "unpublish" ? (
    <UnpublishFix {...props} target={target} market={market} />
  ) : (
    <CountriesFix {...props} target={target} market={market} partial={request.state === "partial"} />
  );
}

function ProductList({ lines }: { lines: ProductLine[] }) {
  const shown = lines.slice(0, SHOWN);
  return (
    <s-section heading={`Products${lines.length > SHOWN ? ` (first ${SHOWN} of ${lines.length})` : ` (${lines.length})`}`}>
      <s-table>
        <s-table-header-row>
          <s-table-header>Product</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {shown.map((l) => (
            <s-table-row key={l.product.id}>
              <s-table-cell>{l.product.title}</s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  );
}

// ---- Fix 1: unpublish ---------------------------------------------------

function UnpublishFix({ lines, target, shippers, market, markets, membership, parts, onBack, onFinished }: Props & { target: Shipper; market: Market }) {
  const plan = useMemo(
    () =>
      planUnpublishFix({
        products: lines.map((l) => l.product),
        membership,
        parts,
        target,
        shippers,
        markets,
        marketId: market.id,
      }),
    [lines, membership, parts, target, shippers, markets, market.id],
  );
  const engine = useMemo(() => moveEngine(plan), [plan]);

  return (
    <RunFlow
      engine={engine}
      action={`Unpublish from ${market.name}`}
      applyLabel={`Unpublish ${plan.totals.unpublish} from ${market.name}`}
      blocker={plan.blocker}
      onBack={onBack}
      onFinished={onFinished}
      finishLabel="Back to overview"
    >
      <s-section heading={`Review · Unpublish from ${market.name}. Nothing has changed yet.`}>
        <s-stack gap="base">
          <s-paragraph>
            {`${target.name} does not ship to any country in ${market.name} (${summarizeCodes(market.countries.map((c) => c.code), 6)}), so customers there cannot check out these products.`}
          </s-paragraph>
          <s-paragraph>
            {`What will happen: ${plan.totals.unpublish} product${plan.totals.unpublish === 1 ? "" : "s"} will be removed from the ${market.name} catalogue${market.catalogs.length === 1 ? "" : "s"} (${market.catalogs.map((c) => c.title).join(", ") || "none"}).`}
          </s-paragraph>
          <s-paragraph color="subdued">
            Nothing else changes: shipping profiles, prices, other markets and the products themselves stay as they are. You can publish them again later.
          </s-paragraph>
          {plan.blocker ? <s-banner tone="critical" heading={plan.blocker} /> : null}
          {plan.warnings.map((w, i) => (
            <s-banner key={i} tone="warning" heading={w} />
          ))}
        </s-stack>
      </s-section>
      <ProductList lines={lines} />
    </RunFlow>
  );
}

// ---- Fix 2: add countries to the profile ---------------------------------

type Step = "review" | "applying" | "done";

function CountriesFix({ lines, target, market, partial, onBack, onFinished }: Props & { target: Shipper; market: Market; partial: boolean }) {
  const profile = target.profile;
  const zones = profile?.zones ?? [];
  const usable = ratedZones(zones);
  const [zoneId, setZoneId] = useState(() => defaultZoneId(zones, market));
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState<Step>("review");
  const [outcome, setOutcome] = useState<CountryFixOutcome | null>(null);
  const [crash, setCrash] = useState("");
  const guard = useGuard();

  const fix = useMemo(
    () =>
      planCountryFix({
        zones,
        zoneId,
        market,
        shipsAlready: profile?.countries ?? [],
        unrated: profile?.unratedCountries ?? [],
      }),
    [zones, zoneId, market, profile],
  );

  let blocker = fix?.blocker ?? null;
  if (!profile) blocker = `${target.name} has no shipping profile in Shopify.`;
  else if (!fix) blocker = `None of the zones in ${target.name} has shipping rates. Add rates in Shopify first; the app only adds countries to a zone that already has them.`;
  else if (profile.zonesTruncated) blocker = "This profile has too many zones to edit safely here. Add the countries in Shopify.";

  const rowOf = (status: ReportRow["status"], message: string): ReportRow[] =>
    fix && profile
      ? [
          {
            productId: fix.zone.id,
            title: `Zone "${fix.zone.name}" of ${profile.name}`,
            handle: "",
            before: fix.zone.countries.join(" "),
            after: fix.after.join(" "),
            added: fix.add,
            removed: [],
            status,
            message,
          },
        ]
      : [];

  const run = async () => {
    if (!profile || !fix) return;
    setStep("applying");
    setCrash("");
    try {
      setOutcome(await runCountryFix(profile.id, fix));
    } catch (err) {
      setCrash(err instanceof Error ? err.message : String(err));
    }
    setStep("done");
  };

  const action = `Add ${market.name} countries to ${target.name}`;
  const download = () => {
    const rows = outcome ? rowOf(outcome.status, outcome.message) : rowOf("failed", crash);
    downloadCsv(reportFileName(action), reportCsv(action, rows));
  };

  if (step === "applying") {
    return (
      <s-section heading="Updating the shipping profile">
        <Loading message={`Checking the zone, adding countries to ${target.name}, then reading it back…`} />
      </s-section>
    );
  }

  if (step === "done") {
    return (
      <s-section heading="Result">
        <s-stack gap="base">
          {crash ? (
            <s-banner tone="critical" heading="The profile was not changed">
              <s-paragraph>{crash}</s-paragraph>
              <s-paragraph>You can add the countries in Settings → Shipping and delivery instead.</s-paragraph>
            </s-banner>
          ) : outcome?.status === "done" ? (
            <s-banner tone="success" heading="Done and confirmed">
              <s-paragraph>{`Shopify now shows ${fix ? summarizeCodes(fix.add, 8) : ""} in the zone. The overview will update.`}</s-paragraph>
            </s-banner>
          ) : (
            <s-banner tone="critical" heading="Not confirmed">
              <s-paragraph>{outcome?.message}</s-paragraph>
              <s-paragraph>Check the zone in Settings → Shipping and delivery.</s-paragraph>
            </s-banner>
          )}
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={onFinished}>
              Back to overview
            </s-button>
            <s-button onClick={download}>Download report (CSV)</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-stack gap="large-100">
      {guard.modal}
      <s-section heading={`Review · Add ${market.name} countries to ${target.name}. Nothing has changed yet.`}>
        <s-stack gap="base">
          <s-paragraph>
            {partial
              ? `${target.name} ships to only some of ${market.name}'s countries, so ${lines.length} published product${lines.length === 1 ? "" : "s"} cannot be bought in the rest.`
              : `${target.name} ships to none of ${market.name}'s countries, so ${lines.length} published product${lines.length === 1 ? "" : "s"} cannot be bought there.`}
          </s-paragraph>

          {usable.length > 1 ? (
            <SelectField
              label="Add the countries to this zone"
              value={fix?.zone.id ?? zoneId}
              onChange={(v) => {
                setZoneId(v);
                setConfirmed(false);
              }}
              options={usable.map((z) => ({ value: z.id, label: `${z.name} (${summarizeCodes(z.countries, 4)})` }))}
            />
          ) : null}

          {fix ? (
            <>
              <s-paragraph>
                {`What will happen: ${fix.add.map((c) => countryName(c)).join(", ") || "nothing"} ${fix.add.length === 1 ? "is" : "are"} added to the zone "${fix.zone.name}" of ${target.name}. The zone then covers ${summarizeCodes(fix.after, 8)}.`}
              </s-paragraph>
              <s-banner tone="warning" heading="Rates come with the zone">
                <s-paragraph>
                  {`Customers in the new countries will pay the rates that already exist in "${fix.zone.name}". No rates are created or changed. If those rates do not suit ${market.name}, set up a separate zone in Shopify instead.`}
                </s-paragraph>
              </s-banner>
              {fix.needRates.length > 0 ? (
                <s-banner tone="warning" heading={`${summarizeCodes(fix.needRates, 6)} cannot be added here`}>
                  <s-paragraph>
                    They are already in a zone that has no rates. Add a rate to that zone in Shopify; adding them here would put them in two zones.
                  </s-paragraph>
                </s-banner>
              ) : null}
              <s-paragraph color="subdued">
                After the change the app reads the zone back from Shopify to confirm. The zone name stays the same. Countries already in the zone stay, and their provinces are set to "all provinces".
              </s-paragraph>
            </>
          ) : null}
          {blocker ? <s-banner tone="critical" heading={blocker} /> : null}
        </s-stack>
      </s-section>
      <ProductList lines={lines} />
      <s-section heading="Confirm">
        <s-stack gap="base">
          <s-checkbox
            label="I have read this. It changes the live store."
            checked={confirmed || undefined}
            disabled={blocker ? true : undefined}
            ref={onChecked(setConfirmed)}
          />
          <s-stack direction="inline" gap="base">
            <s-button onClick={onBack}>Back</s-button>
            <s-button variant="primary" disabled={!confirmed || blocker ? true : undefined} onClick={() => guard.ask(run)}>
              {`Add countries to ${target.name}`}
            </s-button>
          </s-stack>
          {blocker ? null : !confirmed ? <s-text color="subdued">Tick the box to enable the button. The password is asked next.</s-text> : null}
        </s-stack>
      </s-section>
    </s-stack>
  );
}

// ---- Fix 3: put a split product in one profile ---------------------------

function UnifyFix({ lines, shippers, markets, membership, parts, onBack, onFinished }: Props) {
  const choices = shippers.filter((s) => s.kind === "profile" || s.profile);
  // Default: the profile that holds the most split products' variants.
  const initial = useMemo(() => {
    const score = new Map<string, number>();
    for (const l of lines) for (const p of l.parts) score.set(p.key, (score.get(p.key) ?? 0) + p.variants + 1);
    return [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [lines]);
  const [key, setKey] = useState(initial);
  const [reviewing, setReviewing] = useState(false);
  const target = choices.find((s) => s.key === key);

  if (reviewing && target) {
    return (
      <MoveReview
        products={lines.map((l) => l.product)}
        membership={membership}
        parts={parts}
        target={target}
        shippers={shippers}
        markets={markets}
        onBack={() => setReviewing(false)}
        onFinished={onFinished}
      />
    );
  }
  return (
    <s-section heading="Review · Put split products in one profile. Nothing has changed yet.">
      <s-stack gap="base">
        <s-paragraph>
          {`${lines.length} product${lines.length === 1 ? " has" : "s have"} variants in different shipping profiles. Choose one profile to hold all variants of these products. You review the exact changes next.`}
        </s-paragraph>
        <SelectField
          label="Move all their variants into"
          value={key}
          onChange={setKey}
          options={[{ value: "", label: "Choose a shipping profile" }, ...choices.map((s) => ({ value: s.key, label: s.name }))]}
        />
        <s-stack direction="inline" gap="base">
          <s-button onClick={onBack}>Back</s-button>
          <s-button variant="primary" disabled={!target || undefined} onClick={() => setReviewing(true)}>
            Review move
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}
