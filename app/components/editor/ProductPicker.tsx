// Choose the product to edit: search by title, handle or SKU (Shopify does the searching, so it is fast with any number
// of products), or pick one of the pinned products. Pins are saved inside Shopify and need the password.

import { useEffect, useRef, useState } from "react";
import { liveGql, messageOf } from "../../lib/editor/gql";
import { searchProducts, type FoundProduct } from "../../lib/editor/load";
import { saveBookmarks, type Bookmark } from "../../lib/editor/settings";
import { STATUS_LABEL } from "../../lib/editor/model";
import type { EditorShared } from "../../views/editor-state";
import { Loading } from "../Loading";
import { useGuard } from "../PasswordGate";
import { TextBox } from "./TextBox";

const tone = (status: string) => (status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "neutral");

export function ProductPicker({ shared, onPick, current, pendingIds }: { shared: EditorShared; onPick: (id: string) => void; current: string | null; pendingIds: Set<string> }) {
  const guard = useGuard();
  const [text, setText] = useState("");
  const [found, setFound] = useState<FoundProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const seq = useRef(0);
  const settings = shared.settings.data;
  const bookmarks = settings?.bookmarks ?? [];
  const pinned = new Set(bookmarks.map((b) => b.id));

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setFound([]);
      setBusy(false);
      setError("");
      return;
    }
    const id = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      searchProducts(liveGql, q)
        .then((list) => id === seq.current && (setFound(list), setError("")))
        .catch((e) => id === seq.current && setError(messageOf(e)))
        .finally(() => id === seq.current && setBusy(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [text]);

  const toggle = (p: { id: string; title: string; handle: string }) => {
    if (!settings) return;
    const next: Bookmark[] = pinned.has(p.id) ? bookmarks.filter((b) => b.id !== p.id) : [...bookmarks, { id: p.id, title: p.title, handle: p.handle }];
    guard.ask(async () => {
      setNote("");
      try {
        await saveBookmarks(liveGql, settings.installationId, next);
        shared.settings.set({ ...settings, bookmarks: next });
      } catch (e) {
        setNote(`Not saved: ${messageOf(e)}`);
      }
    });
  };

  const row = (p: { id: string; title: string; handle: string; status?: string }) => (
    <s-stack key={p.id} direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-button variant={p.id === current ? "secondary" : "tertiary"} onClick={() => onPick(p.id)}>
          {p.title}
        </s-button>
        <s-text color="subdued">{p.handle}</s-text>
        {p.status ? <s-badge tone={tone(p.status)}>{STATUS_LABEL[p.status] ?? p.status}</s-badge> : null}
        {pendingIds.has(p.id) ? <s-badge tone="info">Unsaved changes</s-badge> : null}
      </s-stack>
      <s-button variant="tertiary" disabled={!settings || undefined} accessibilityLabel={pinned.has(p.id) ? `Unpin ${p.title}` : `Pin ${p.title}`} onClick={() => toggle(p)}>
        {pinned.has(p.id) ? "Unpin" : "Pin"}
      </s-button>
    </s-stack>
  );

  return (
    <s-section heading="Product">
      {guard.modal}
      <s-stack gap="base">
        <TextBox label="Find a product" value={text} onChange={setText} placeholder="Title, handle or SKU" />
        {busy ? <Loading message="Searching…" /> : null}
        {error ? <s-text tone="critical">{error}</s-text> : null}
        {!busy && !error && text.trim().length >= 2 && found.length === 0 ? <s-text color="subdued">No product matches. Try fewer letters.</s-text> : null}
        {found.length > 0 ? <s-stack gap="small-100">{found.map(row)}</s-stack> : null}
        {bookmarks.length > 0 ? (
          <s-stack gap="small-100">
            <s-text type="strong">Pinned</s-text>
            {bookmarks.map((b) => row(b))}
          </s-stack>
        ) : null}
        {note ? <s-text tone="critical">{note}</s-text> : null}
        {shared.settings.status === "error" ? <s-text color="subdued">{`Pins could not be read: ${shared.settings.error}`}</s-text> : null}
      </s-stack>
    </s-section>
  );
}
