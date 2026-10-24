import { useMemo, useRef, useState } from "react";
import { applyMove, type MoveResult, type Progress } from "../lib/applyMove";
import { countryName, summarizeCodes } from "../lib/countries";
import { onChecked } from "../lib/dom";
import { applyCountryFix, planCountryFix, planUnpublishFix, type FixRequest } from "../lib/fix";
import type { ProductLine, Shipper } from "../lib/overview";
import type { Market, Membership } from "../lib/types";
import { Loading } from "./Loading";
import { useGuard } from "./PasswordGate";
import { SelectField } from "./SelectField";

type Step = "review" | "applying" | "done";
const SHOWN = 30;

type Props = {
  request: FixRequest;
  /** The affected products (active, published in the market, blocked there). */
  lines: ProductLine[];
  target: Shipper;
  shippers: Shipper[];
  market: Market;
  markets: Market[];
  membership: Membership;
  onBack: () => void;
  /** Called when the person leaves the result, so the app can reload. */
  onFinished: () => void;
};

// Review step: nothing is written. Apply: only after the box is ticked and the
// password is given.
export function FixReview(props: Props) {
  return props.request.kind === "unpublish" ? <UnpublishFix {...props} /> : <CountriesFix {...props} />;
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

function ApplyBar({
  confirmed,
  setConfirmed,
  blocker,
  onBack,
  onApply,
  label,
}: {
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  blocker: string | null;
  onBack: () => void;
  onApply: () => void;
  label: string;
}) {
  return (
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
          <s-button variant="primary" disabled={!confirmed || blocker ? true : undefined} onClick={onApply}>
            {label}
          </s-button>
        </s-stack>
        {blocker ? null : !confirmed ? <s-text color="subdued">Tick the box to enable the button. The password is asked next.</s-text> : null}
      </s-stack>
    </s-section>
  );
}

// ---- Fix 1: unpublish ---------------------------------------------------

function UnpublishFix({ lines, target, shippers, market, markets, membership, onBack, onFinished }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState<Step>("review");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<MoveResult | null>(null);
  const [crash, setCrash] = useState("");
  const stop = useRef(false);
  const guard = useGuard();

  const plan = useMemo(
    () =>
      planUnpublishFix({
        products: lines.map((l) => l.product),
        membership,
        target,
        shippers,
        markets,
        marketId: market.id,
      }),
    [lines, membership, target, shippers, markets, market.id],
  );

  const run = async () => {
    stop.current = false;
    setStep("applying");
    setCrash("");
    try {
      setResult(await applyMove(plan, { onProgress: setProgress, shouldStop: () => stop.current }));
    } catch (err) {
      setCrash(err instanceof Error ? err.message : String(err));
    }
    setStep("done");
  };

  if (step === "applying") {
    return (
      <s-section heading="Unpublishing">
        <s-stack gap="base">
          <Loading message={progress ? `Unpublishing… ${progress.done} of ${progress.total} products` : "Starting…"} />
          <div>
            <s-button onClick={() => (stop.current = true)}>Stop after this product</s-button>
          </div>
        </s-stack>
      </s-section>
    );
  }

  if (step === "done") {
    const failures = result?.failures ?? [];
    return (
      <s-section heading="Result">
        <s-stack gap="base">
          {crash ? (
            <s-banner tone="critical" heading="The fix stopped with an error">
              <s-paragraph>{crash}</s-paragraph>
              <s-paragraph>Some changes may already be applied. Check the Overview.</s-paragraph>
            </s-banner>
          ) : result ? (
            <s-banner
              tone={failures.length > 0 || result.stopped ? "warning" : "success"}
              heading={result.stopped ? "Stopped before finishing" : failures.length > 0 ? "Finished with problems" : "Done"}
            >
              <s-paragraph>{`${result.unpublished} catalogue unpublish${result.unpublished === 1 ? "" : "es"} in ${market.name}.`}</s-paragraph>
            </s-banner>
          ) : null}
          {failures.map((f) => (
            <s-banner key={f.productId} tone="critical" heading={f.title}>
              <s-paragraph>{f.message}</s-paragraph>
            </s-banner>
          ))}
          <div>
            <s-button variant="primary" onClick={onFinished}>
              Back to overview
            </s-button>
          </div>
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-stack gap="large-100">
      {guard.modal}
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
      <ApplyBar
        confirmed={confirmed}
        setConfirmed={setConfirmed}
        blocker={plan.blocker}
        onBack={onBack}
        onApply={() => guard.ask(run)}
        label={`Unpublish ${plan.totals.unpublish} from ${market.name}`}
      />
    </s-stack>
  );
}

// ---- Fix 2: add countries to the profile ---------------------------------

function CountriesFix({ lines, target, market, onBack, onFinished }: Props) {
  const profile = target.profile;
  const zones = profile?.zones ?? [];
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState<Step>("review");
  const [crash, setCrash] = useState("");
  const guard = useGuard();

  const fix = useMemo(
    () => planCountryFix({ zones, zoneId, market, shipsAlready: profile?.countries ?? [] }),
    [zones, zoneId, market, profile],
  );

  let blocker = fix?.blocker ?? null;
  if (!profile || !fix) blocker = `${target.name} has no shipping zone to add countries to. Create one in Shopify first.`;
  else if (profile.zonesTruncated) blocker = "This profile has too many zones to edit safely here. Add the countries in Shopify.";

  const run = async () => {
    if (!profile || !fix) return;
    setStep("applying");
    setCrash("");
    try {
      await applyCountryFix(profile.id, fix);
    } catch (err) {
      setCrash(err instanceof Error ? err.message : String(err));
    }
    setStep("done");
  };

  if (step === "applying") {
    return (
      <s-section heading="Updating the shipping profile">
        <Loading message={`Adding countries to ${target.name}…`} />
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
              <s-paragraph>Shopify may not allow this edit. You can add the countries in Settings → Shipping and delivery instead.</s-paragraph>
            </s-banner>
          ) : (
            <s-banner tone="success" heading="Done">
              <s-paragraph>{`${target.name} now ships to ${fix ? summarizeCodes(fix.add, 8) : ""}. The overview will update.`}</s-paragraph>
            </s-banner>
          )}
          <div>
            <s-button variant="primary" onClick={onFinished}>
              Back to overview
            </s-button>
          </div>
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
            {`${target.name} ships to none of ${market.name}'s countries, so ${lines.length} published product${lines.length === 1 ? "" : "s"} cannot be bought there.`}
          </s-paragraph>

          {zones.length > 1 ? (
            <SelectField
              label="Add the countries to this zone"
              value={zoneId}
              onChange={(v) => {
                setZoneId(v);
                setConfirmed(false);
              }}
              options={zones.map((z) => ({ value: z.id, label: `${z.name} (${summarizeCodes(z.countries, 4)})` }))}
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
              <s-paragraph color="subdued">
                The zone name stays the same. Countries already in the zone stay, and their provinces are set to "all provinces". Products stay published, and they become buyable in {market.name} once this is done.
              </s-paragraph>
            </>
          ) : null}
          {blocker ? <s-banner tone="critical" heading={blocker} /> : null}
        </s-stack>
      </s-section>
      <ProductList lines={lines} />
      <ApplyBar
        confirmed={confirmed}
        setConfirmed={setConfirmed}
        blocker={blocker}
        onBack={onBack}
        onApply={() => guard.ask(run)}
        label={`Add countries to ${target.name}`}
      />
    </s-stack>
  );
}
