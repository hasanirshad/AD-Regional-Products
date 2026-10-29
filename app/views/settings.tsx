import { useMemo, useState } from "react";
import { parseSettings, problemsAgainstDefinitions, problemsOf, type BlockSettings } from "../../extensions/shared/settings";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { useGuard } from "../components/PasswordGate";
import { PreviewPanel } from "../components/settings/PreviewPanel";
import { DetectPanel } from "../components/settings/DetectPanel";
import { GroupsPanel, HelpersPanel, RecordsPanel, ThemeFieldsPanel, ThresholdsPanel } from "../components/settings/HealthPanels";
import { QualityPanel } from "../components/settings/QualityPanel";
import { ActivityPanel, AdaptationsPanel, CollectionsPanel, LinksPanel, MarketsPanel, SalePanel } from "../components/settings/SimplePanels";
import { TranslationPanel } from "../components/settings/TranslationPanel";
import type { PanelProps } from "../components/settings/widgets";
import { diffSettings, problemsOfTab, resetTab, saveBlockSettings, SETTINGS_TABS, tabIsDefault, tabLabel, type TabId } from "../lib/editor/blockSettings";
import { previewOf, type Preview } from "../lib/editor/blockPreview";
import { liveGql, messageOf } from "../lib/editor/gql";
import { slotsWithAdaptations } from "../lib/editor/locales";
import { onChecked } from "../lib/dom";
import { useStartEditor } from "./editor-state";
import { useAppState } from "./state";

const PANELS: Record<TabId, (p: PanelProps) => React.ReactNode> = {
  translation: TranslationPanel,
  quality: QualityPanel,
  groups: GroupsPanel,
  thresholds: ThresholdsPanel,
  themeFields: ThemeFieldsPanel,
  helpers: HelpersPanel,
  records: RecordsPanel,
  links: LinksPanel,
  markets: MarketsPanel,
  sale: SalePanel,
  collections: CollectionsPanel,
  activity: ActivityPanel,
  adaptations: AdaptationsPanel,
};

// Block settings: where the seven Product Insights blocks (and the market adaptations of the editor) are configured.
// Reading is free. Saving shows what changes, asks for a tick and the password, checks that nobody else saved,
// writes one app-owned metafield, and reads it back. The blocks use the new settings the next time they load.
export default function BlockSettingsPage() {
  const { editor: shared, markets, blockDraft } = useAppState();
  useStartEditor(shared, ["info", "productDefs", "variantDefs", "settings"]);
  const guard = useGuard();
  const [tab, setTab] = useState<TabId>("translation");
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const stored = shared.settings.data;
  const base: BlockSettings | null = stored ? stored.blocks.settings : null;
  const draft: BlockSettings | null = blockDraft.value ?? base;

  const setDraft = (next: BlockSettings) => {
    setNotice("");
    blockDraft.set(base && JSON.stringify(next) === JSON.stringify(base) ? null : next);
  };

  const defs = useMemo(() => ({ product: shared.productDefs.data ?? null, variant: shared.variantDefs.data ?? null }), [shared.productDefs.data, shared.variantDefs.data]);
  // A metafield key that is not a definition of the store blocks the save only when the person set it now. One that was
  // already saved (or is a default) is shown as a warning, so a stale default never stops an unrelated change.
  const { problems, warnings } = useMemo(() => {
    if (!draft) return { problems: [], warnings: [] };
    const found = problemsAgainstDefinitions(draft, defs);
    const before = base ? problemsAgainstDefinitions(base, defs) : [];
    const old = (p: { message: string }) => before.some((b) => b.message === p.message);
    return { problems: [...problemsOf(draft), ...found.filter((p) => !old(p))], warnings: found.filter(old) };
  }, [draft, base, defs]);
  const changes = useMemo(() => (base && draft ? diffSettings(base, draft) : []), [base, draft]);

  const shell = (children: React.ReactNode) => (
    <s-page heading="Block settings" inlineSize="large">
      <PageBody maxWidth={1100}>
        <s-stack gap="large-100">{children}</s-stack>
      </PageBody>
      {guard.modal}
    </s-page>
  );

  if (shared.settings.status === "error") {
    return shell(
      <s-banner tone="critical" heading="Could not read the saved settings">
        <s-paragraph>{shared.settings.error}</s-paragraph>
        <s-button slot="secondary-actions" onClick={shared.settings.reload}>
          Try again
        </s-button>
      </s-banner>,
    );
  }
  if (!stored || !base || !draft) return shell(<Loading message="Reading the saved settings…" />);

  // ---- review and save
  if (reviewing) {
    const grouped = SETTINGS_TABS.map((t) => ({ tab: t, lines: changes.filter((c) => c.tab === t.id) })).filter((g) => g.lines.length > 0);
    const save = () =>
      guard.ask(async () => {
        setSaving(true);
        setError("");
        try {
          const result = await saveBlockSettings(liveGql, { installationId: stored.installationId, expectedRaw: stored.blocksRaw, next: draft });
          shared.settings.set({ ...stored, blocks: parseSettings(result.raw), blocksRaw: result.raw });
          blockDraft.set(null);
          setReviewing(false);
          setConfirmed(false);
          setNotice("Saved and checked. The blocks use the new settings the next time a product page loads.");
        } catch (e) {
          setError(messageOf(e));
        } finally {
          setSaving(false);
        }
      });
    return shell(
      <>
        <s-section heading={`Review ${changes.length} change${changes.length === 1 ? "" : "s"}`}>
          <s-stack gap="base">
            <s-text color="subdued">Only the settings of the blocks and the market adaptations are saved, inside this app in Shopify. No product, price or translation is changed.</s-text>
            {grouped.map((g) => (
              <s-stack key={g.tab.id} gap="small-200">
                <s-heading>{g.tab.label}</s-heading>
                {g.lines.map((l, i) => (
                  <s-stack key={i} gap="small-300">
                    <s-text type="strong">{l.label}</s-text>
                    <s-text color="subdued">{`Now: ${l.from}`}</s-text>
                    <s-text>{`After saving: ${l.to}`}</s-text>
                  </s-stack>
                ))}
              </s-stack>
            ))}
          </s-stack>
        </s-section>
        {error ? (
          <s-banner tone="critical" heading="Not saved">
            <s-paragraph>{error}</s-paragraph>
          </s-banner>
        ) : null}
        <s-section>
          <s-stack gap="base">
            <s-checkbox label="I have checked these changes" checked={confirmed || undefined} ref={onChecked(setConfirmed)} />
            {saving ? <Loading message="Saving, then reading back what Shopify stored…" /> : null}
            <s-stack direction="inline" gap="small-200">
              <s-button variant="primary" disabled={!confirmed || saving || changes.length === 0 || undefined} onClick={save}>
                Save changes
              </s-button>
              <s-button disabled={saving || undefined} onClick={() => {
                  setReviewing(false);
                  setConfirmed(false);
                  setError("");
                }}>
                Back to settings
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </>,
    );
  }

  // ---- the editor
  const panelProps: PanelProps = { draft, set: setDraft, problems, productDefs: shared.productDefs, variantDefs: shared.variantDefs, info: shared.info.data, markets };
  const Panel = PANELS[tab];
  const tabProblems = problemsOfTab(problems, tab);
  const tabWarnings = problemsOfTab(warnings, tab);
  const bad = stored.blocks.source === "invalid" || stored.blocks.source === "unreadable";

  let preview: Preview | null = null;
  try {
    preview = tabProblems.length > 0 ? null : previewOf(tab, draft, { known: (shared.productDefs.data ?? []).map((d) => ({ namespace: d.namespace, key: d.key })), slots: shared.info.data ? slotsWithAdaptations(shared.info.data.locales, draft.adaptations, new Set(markets.map((m) => m.id))) : [] });
  } catch {
    preview = null;
  }

  const changeCount = (id: TabId) => changes.filter((c) => c.tab === id).length;

  return shell(
    <>
      <s-text color="subdued">Choose what each Product Insights block shows. Reading is free. Saving asks for the password, after a review of what changes. The blocks use the saved settings the next time a product page loads.</s-text>
      {notice ? (
        <s-banner tone="success" heading="Done">
          <s-paragraph>{notice}</s-paragraph>
        </s-banner>
      ) : null}
      {bad ? (
        <s-banner tone="warning" heading="Some saved settings could not be used">
          <s-paragraph>{`The blocks use the default settings for these parts: ${stored.blocks.problems.join(" ")} Saving replaces them with what you see here.`}</s-paragraph>
        </s-banner>
      ) : null}
      {stored.blocks.source === "default" && blockDraft.value === null ? <s-text color="subdued">Nothing is saved yet, so the blocks use their default settings. The values below are those defaults.</s-text> : null}

      <DetectPanel {...panelProps} first={stored.blocks.source === "default" && blockDraft.value === null} />

      <s-section>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200">
            {SETTINGS_TABS.map((t) => {
              const n = changeCount(t.id);
              const errors = problemsOfTab(problems, t.id).length;
              return (
                <s-button key={t.id} variant={tab === t.id ? "secondary" : "tertiary"} onClick={() => setTab(t.id)}>
                  {`${t.label}${n ? ` (${n})` : ""}${errors ? " · fix" : ""}`}
                </s-button>
              );
            })}
          </s-stack>
          <s-text color="subdued">{SETTINGS_TABS.find((t) => t.id === tab)?.about}</s-text>
        </s-stack>
      </s-section>

      <s-section heading={tabLabel(tab)}>
        <s-stack gap="large-100">
          {tabProblems.length > 0 ? (
            <s-banner tone="critical" heading={`${tabProblems.length} problem${tabProblems.length === 1 ? "" : "s"} on this tab`}>
              <s-paragraph>{tabProblems.slice(0, 3).map((p) => p.message).join(" ")}</s-paragraph>
            </s-banner>
          ) : null}
          {tabWarnings.length > 0 ? (
            <s-banner tone="warning" heading="Not a metafield definition of your store">
              <s-paragraph>{`${tabWarnings.map((p) => p.message).join(" ")} The block keeps working with them as they are; change them here when you are ready.`}</s-paragraph>
            </s-banner>
          ) : null}
          <Panel {...panelProps} />
          <div>
            <s-button disabled={tabIsDefault(draft, tab) || undefined} onClick={() => setDraft(resetTab(draft, tab))}>
              Reset to defaults
            </s-button>
          </div>
        </s-stack>
      </s-section>

      <PreviewPanel heading={tab === "adaptations" ? "Translation boxes in Edit product" : tabLabel(tab)} preview={preview} unavailable="The preview is not available until the problems on this tab are fixed." />

      <s-section>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-button
            variant="primary"
            disabled={changes.length === 0 || problems.length > 0 || undefined}
            onClick={() => {
              setNotice("");
              setError("");
              setReviewing(true);
            }}
          >
            Review changes
          </s-button>
          <s-button disabled={blockDraft.value === null || undefined} onClick={() => blockDraft.set(null)}>
            Discard changes
          </s-button>
          <s-text color="subdued">
            {problems.length > 0
              ? `Fix ${problems.length} problem${problems.length === 1 ? "" : "s"} first (on: ${SETTINGS_TABS.filter((t) => problemsOfTab(problems, t.id).length > 0).map((t) => t.label).join(", ")}).`
              : changes.length === 0
                ? "No changes."
                : `${changes.length} change${changes.length === 1 ? "" : "s"} waiting, not saved.`}
          </s-text>
        </s-stack>
      </s-section>
    </>,
  );
}
