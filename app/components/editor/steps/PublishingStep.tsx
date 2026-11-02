// Step 10, Publishing: the sales channels and market catalogues the product is published to. Every switch is an edit
// (published or not), reviewed and saved like any other. A draft product can be published to a catalogue here, but it is
// not visible in the store until it is made active in Shopify.

import { useEffect, useMemo, useState } from "react";
import { buildTargets, type Channel, type Target as PubTarget } from "../../../lib/channels";
import { onChecked } from "../../../lib/dom";
import type { Target } from "../../../lib/editor/model";
import { messageOf } from "../../../lib/editor/gql";
import { loadChannels } from "../../../lib/shopify-data";
import { useAppState } from "../../../views/state";
import { Loading } from "../../Loading";
import type { TabProps } from "../EditTabs";
import { StepHeading } from "./StepStrip";

const publishTarget = (productId: string, publicationId: string): Target => ({ kind: "publish", productId, publicationId });

export function PublishingStep({ edit, doc }: TabProps) {
  const { markets } = useAppState();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadChannels()
      .then((c) => !cancelled && setChannels(c))
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const { targets, unavailable } = useMemo(() => buildTargets({ channels: channels ?? [], markets, hiddenMarkets: [] }), [channels, markets]);
  const groups = useMemo(() => {
    const map = new Map<string, PubTarget[]>();
    for (const t of targets) map.set(t.group, [...(map.get(t.group) ?? []), t]);
    return [...map.entries()];
  }, [targets]);

  const on = (t: PubTarget) => (edit.effectiveValue(publishTarget(doc.id, t.id)) ?? "false") === "true";
  const set = (t: PubTarget, value: boolean) => edit.put(publishTarget(doc.id, t.id), String(value));

  return (
    <s-stack gap="base">
      <StepHeading step="publishing" />
      {doc.status !== "ACTIVE" ? <s-banner tone="info">{`This product is ${doc.status === "DRAFT" ? "a draft" : "archived"}. Publishing it to a catalogue now only prepares it: it is not visible in the store until it is made active in Shopify. If Shopify refuses to publish a draft, the review says so and nothing else is affected.`}</s-banner> : null}
      {error ? <s-banner tone="critical" heading="Could not read the sales channels">{error}</s-banner> : null}
      {channels === null && !error ? <Loading message="Reading sales channels and catalogues…" /> : null}
      {groups.map(([group, list]) => {
        const all = list.every(on);
        return (
          <s-section key={group} heading={group}>
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small-200">
                <s-button variant="tertiary" disabled={all || undefined} onClick={() => list.forEach((t) => set(t, true))}>
                  Publish to all
                </s-button>
                <s-button variant="tertiary" disabled={list.every((t) => !on(t)) || undefined} onClick={() => list.forEach((t) => set(t, false))}>
                  Unpublish from all
                </s-button>
              </s-stack>
              {list.map((t) => {
                const saved = doc.publicationIds.includes(t.id);
                const changed = on(t) !== saved;
                return (
                  <s-stack key={t.id} direction="inline" gap="small-200" alignItems="center">
                    <s-checkbox label={t.label} checked={on(t) || undefined} ref={onChecked((v) => set(t, v))} />
                    {changed ? <s-badge tone="info">{on(t) ? "Will publish" : "Will unpublish"}</s-badge> : saved ? <s-badge tone="success">Published</s-badge> : <s-badge>Not published</s-badge>}
                  </s-stack>
                );
              })}
            </s-stack>
          </s-section>
        );
      })}
      {unavailable.length > 0 ? <s-text color="subdued">{`Not shown, because Shopify gives them no publication to change: ${unavailable.map((u) => `${u.label} (${u.group})`).join(", ")}.`}</s-text> : null}
    </s-stack>
  );
}
