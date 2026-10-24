import { useMemo, useState } from "react";
import { CountryPicker } from "../components/CountryPicker";
import { PageBody } from "../components/PageBody";
import { PlanPreview } from "../components/PlanPreview";
import { summarizeCodes, toOptions } from "../lib/countries";
import { onChecked, onInput } from "../lib/dom";
import { profileNameFor, validateDraft, type Draft } from "../lib/groups";
import { classifyMarkets, planProfile } from "../lib/plan";
import { saveGroup } from "../lib/saveGroup";
import type { Group } from "../lib/types";
import { useAppState } from "./state";

const EMPTY: Draft = { id: null, name: "", countries: [] };

export default function Groups() {
  const app = useAppState();
  const { shop, general, groups, profiles, markets } = app;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Countries we can offer: where markets sell, plus where General ships.
  const options = useMemo(() => {
    const codes = new Set<string>();
    for (const m of markets) for (const c of m.countries) codes.add(c.code);
    for (const lg of general?.locationGroups ?? [])
      for (const z of lg.zones) for (const c of z.countries) if (c.code) codes.add(c.code);
    return toOptions(codes);
  }, [markets, general]);

  const editingGroup = draft?.id ? groups.find((g) => g.id === draft.id) : undefined;
  const editingProfile = editingGroup?.profileId
    ? profiles.find((p) => p.id === editingGroup.profileId)
    : undefined;
  const liveVariants = editingProfile?.variantCount ?? 0;

  const plan = useMemo(
    () => (draft && general ? planProfile(general, draft.countries) : null),
    [draft, general],
  );
  const marketResults = useMemo(
    () => (draft ? classifyMarkets(draft.countries, markets) : []),
    [draft, markets],
  );

  // Why Save is disabled (shown under the button).
  const blocker = (() => {
    if (!draft) return null;
    if (!general) return "The General shipping profile could not be found, so there are no rates to copy.";
    const rule = validateDraft(draft, groups);
    if (rule) return rule;
    if (plan && plan.locationGroups.length === 0)
      return "General has no shipping rate that can be copied for these countries.";
    if (liveVariants > 0 && !confirmed) return "Tick the box above to confirm the change.";
    return null;
  })();

  const open = (g?: Group) => {
    setError(null);
    setNotice(null);
    setConfirmed(false);
    setDraft(g ? { id: g.id, name: g.name, countries: [...g.countries] } : { ...EMPTY });
  };
  const close = () => {
    setDraft(null);
    setConfirmed(false);
    setError(null);
  };

  const save = async () => {
    if (!draft || !general || blocker) return;
    setSaving(true);
    setError(null);
    try {
      await saveGroup({ draft, groups, general, profiles });
      await app.refresh();
      setNotice(`Saved "${draft.name.trim()}". Its shipping profile is "${profileNameFor(draft.name)}".`);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // The group may have been saved even if the profile step failed.
      void app.refresh().catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const origin = general?.locationGroups.flatMap((lg) => lg.locations.map((l) => l.name)).join(", ");

  return (
    <s-page heading={`Groups · ${shop.name}`} inlineSize="large">
      <PageBody>
        <s-stack gap="large-100">
          {notice ? (
            <s-banner tone="success" dismissible onDismiss={() => setNotice(null)}>
              <s-paragraph>{notice}</s-paragraph>
            </s-banner>
          ) : null}

          {!general ? (
            <s-banner tone="critical" heading="General shipping profile not found">
              <s-paragraph>
                The app copies shipping rates from your General profile and could not find it.
              </s-paragraph>
            </s-banner>
          ) : null}

          {!draft ? (
            <s-section heading="Groups">
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  A group is a list of countries. Each group gets its own shipping profile, with rates copied from
                  General{origin ? ` (shipping from ${origin})` : ""}. Saving a group does not change any product yet.
                </s-paragraph>

                {groups.length === 0 ? (
                  <s-paragraph>No groups yet. Create one to choose the countries its products can be sold in.</s-paragraph>
                ) : (
                  <s-table>
                    <s-table-header-row>
                      <s-table-header>Group</s-table-header>
                      <s-table-header>Allowed countries</s-table-header>
                      <s-table-header>Shipping profile</s-table-header>
                      <s-table-header>Variants</s-table-header>
                      <s-table-header>{""}</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {groups.map((g) => {
                        const profile = g.profileId ? profiles.find((p) => p.id === g.profileId) : undefined;
                        return (
                          <s-table-row key={g.id}>
                            <s-table-cell>
                              <s-text type="strong">{g.name}</s-text>
                            </s-table-cell>
                            <s-table-cell>{summarizeCodes(g.countries, 6)}</s-table-cell>
                            <s-table-cell>
                              {profile ? (
                                <s-badge tone="success">Created</s-badge>
                              ) : g.profileId ? (
                                <s-badge tone="critical">Missing in Shopify</s-badge>
                              ) : (
                                <s-badge tone="warning">No profile yet</s-badge>
                              )}
                            </s-table-cell>
                            <s-table-cell>{profile ? profile.variantCount : "—"}</s-table-cell>
                            <s-table-cell>
                              <s-button variant="tertiary" onClick={() => open(g)}>
                                Edit
                              </s-button>
                            </s-table-cell>
                          </s-table-row>
                        );
                      })}
                    </s-table-body>
                  </s-table>
                )}

                <div>
                  <s-button variant="primary" onClick={() => open()} disabled={!general || undefined}>
                    New group
                  </s-button>
                </div>
                {!general ? (
                  <s-text color="subdued">New groups need the General shipping profile.</s-text>
                ) : null}
              </s-stack>
            </s-section>
          ) : (
            <>
              <s-section heading={draft.id ? "Edit group" : "New group"}>
                <s-stack gap="base">
                  <s-text-field
                    label="Group name"
                    value={draft.name}
                    details={draft.name.trim() ? `Shipping profile name: ${profileNameFor(draft.name)}` : "For example: Froede"}
                    ref={onInput((name) => setDraft((d) => (d ? { ...d, name } : d)))}
                  />
                  <s-heading>Allowed countries</s-heading>
                  <CountryPicker
                    options={options}
                    selected={draft.countries}
                    onChange={(countries) => setDraft((d) => (d ? { ...d, countries } : d))}
                  />
                </s-stack>
              </s-section>

              {plan ? <PlanPreview plan={plan} markets={marketResults} /> : null}

              {liveVariants > 0 ? (
                <s-banner tone="warning" heading={`${liveVariants} variants already use this profile`}>
                  <s-paragraph>
                    Saving rebuilds this profile's shipping zones. Do it at a quiet time, and check the preview first.
                  </s-paragraph>
                  <s-checkbox
                    label="I checked the preview and want to change this profile"
                    checked={confirmed || undefined}
                    ref={onChecked(setConfirmed)}
                  />
                </s-banner>
              ) : null}

              {error ? (
                <s-banner tone="critical" heading="Could not save the group">
                  <s-paragraph>{error}</s-paragraph>
                  <s-button slot="secondary-actions" onClick={() => void save()}>
                    Try again
                  </s-button>
                </s-banner>
              ) : null}

              <s-stack gap="small-100">
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="primary"
                    loading={saving || undefined}
                    disabled={Boolean(blocker) || saving || undefined}
                    onClick={() => void save()}
                  >
                    Save group
                  </s-button>
                  <s-button onClick={close} disabled={saving || undefined}>
                    Cancel
                  </s-button>
                </s-stack>
                {blocker ? <s-text color="subdued">{blocker}</s-text> : null}
              </s-stack>
            </>
          )}
        </s-stack>
      </PageBody>
    </s-page>
  );
}
