// A picker for metaobject entries and files. Shopify's own picker only covers products, variants and collections, so
// this one reads the list itself: pages of 50, searched on screen, with thumbnails for images. Nothing is written here;
// the choice goes back to the metafield, which is saved with the rest through the usual review.

import { useCallback, useEffect, useMemo, useState } from "react";
import { liveGql, messageOf } from "../../lib/editor/gql";
import type { Validation } from "../../lib/editor/mfRules";
import type { PickedRef } from "../../lib/editor/mfTypes";
import { acceptedFileKinds, filterItems, KIND_WORD, loadFilePage, loadMetaobjectPage, loadMetaobjectType, metaobjectDefinitionId, type PickItem } from "../../lib/editor/refs";
import { onChecked } from "../../lib/dom";
import { Loading } from "../Loading";
import { Dialog } from "./Dialog";
import { TextBox } from "./TextBox";

type Props = {
  kind: "metaobject" | "file";
  validations: Validation[];
  multiple: boolean;
  current: PickedRef[];
  name: string;
  onCancel: () => void;
  onDone: (refs: PickedRef[]) => void;
};

const NO_FILES_SCOPE = "The app has no permission to read Files yet. Run the app deploy and approve the new permission (read_files) in the store, then try again.";

export function ReferenceDialog({ kind, validations, multiple, current, name, onCancel, onDone }: Props) {
  const [items, setItems] = useState<PickItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [typeName, setTypeName] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedRef[]>(current);
  const kinds = useMemo(() => (kind === "file" ? acceptedFileKinds(validations) : null), [kind, validations]);
  const definitionId = metaobjectDefinitionId(validations);
  const [type, setType] = useState<string | null>(null);

  const explain = (e: unknown) => {
    const m = messageOf(e);
    return kind === "file" && /access|scope|permission|denied/i.test(m) ? NO_FILES_SCOPE : m;
  };

  // The metaobject type comes from the definition's rule.
  useEffect(() => {
    if (kind !== "metaobject") return;
    if (!definitionId) {
      setBusy(false);
      setError("This metafield does not say which kind of entry it holds, so entries cannot be listed. Change it in Shopify.");
      return;
    }
    let cancelled = false;
    loadMetaobjectType(liveGql, definitionId)
      .then((t) => {
        if (cancelled) return;
        if (!t) {
          setBusy(false);
          setError("The entry type of this metafield was not found.");
          return;
        }
        setType(t.type);
        setTypeName(t.name);
      })
      .catch((e) => !cancelled && (setBusy(false), setError(explain(e))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, definitionId]);

  const loadMore = useCallback(
    async (after: string | null) => {
      setBusy(true);
      setError("");
      try {
        const page = kind === "file" ? await loadFilePage(liveGql, after) : await loadMetaobjectPage(liveGql, type!, after);
        setItems((old) => (after ? [...old, ...page.items] : page.items));
        setNext(page.next);
      } catch (e) {
        setError(explain(e));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, type],
  );

  useEffect(() => {
    if (kind === "file" || type) void loadMore(null);
  }, [kind, type, loadMore]);

  const shown = filterItems(items, text, kinds);
  const has = (id: string) => picked.some((p) => p.id === id);
  const toggle = (i: PickItem, on: boolean) => {
    if (!multiple) return setPicked(on ? [{ id: i.id, label: i.label }] : []);
    setPicked((p) => (on ? (p.some((x) => x.id === i.id) ? p : [...p, { id: i.id, label: i.label }]) : p.filter((x) => x.id !== i.id)));
  };
  const what = kind === "file" ? "files" : (typeName ?? "entries").toLowerCase();

  return (
    <Dialog
      heading={`${multiple ? "Pick" : "Pick one of the"} ${what} for ${name}`}
      onClose={onCancel}
      maxWidth={720}
      footer={
        <s-stack direction="inline" gap="small-200" justifyContent="end">
          <s-button onClick={onCancel}>Cancel</s-button>
          <s-button variant="primary" onClick={() => onDone(picked)}>
            {picked.length === 0 ? "Use no selection" : multiple ? `Use ${picked.length} selected` : "Use this one"}
          </s-button>
        </s-stack>
      }
    >
      <s-stack gap="small-200">
        <TextBox label="Search" hideLabel value={text} onChange={setText} placeholder={kind === "file" ? "Search by file name" : "Search by name"} />
        {kind === "file" ? <s-text color="subdued">{`Showing ${kinds!.map((k) => KIND_WORD[k].toLowerCase()).join(", ")} files, newest first. Files are added in Shopify under Content, Files.`}</s-text> : null}
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        {busy && items.length === 0 ? <Loading message="Loading…" /> : null}
        {!busy && !error && shown.length === 0 ? <s-text color="subdued">{items.length === 0 ? "Nothing to pick yet." : "Nothing matches. Load more to search further back."}</s-text> : null}
        <s-stack gap="small-100">
          {shown.map((i) => (
            <s-stack key={i.id} direction="inline" gap="small-200" alignItems="center">
              {i.thumb ? <img src={`${i.thumb}${i.thumb.includes("?") ? "&" : "?"}width=64`} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 6 }} /> : <s-badge>{KIND_WORD[i.kind]}</s-badge>}
              <s-checkbox label={i.label} details={i.detail || undefined} checked={has(i.id) || undefined} ref={onChecked((on) => toggle(i, on))} />
            </s-stack>
          ))}
        </s-stack>
        {next ? (
          <div>
            <s-button disabled={busy || undefined} onClick={() => loadMore(next)}>
              {busy ? "Loading…" : "Load more"}
            </s-button>
          </div>
        ) : null}
      </s-stack>
    </Dialog>
  );
}
