// Shared look and the loading / error / empty handling for every block.

import { render, type ComponentChildren, type VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import { BlockError, makeQueries, selectedProductId, type LoadContext } from "./graphql";

export type BlockConfig<T> = {
  heading: string;
  load: (ctx: LoadContext) => Promise<T>;
  /** Short text shown when the card is collapsed (30 characters at most). */
  summary?: (data: T) => string;
  /** A message when there is nothing to show; the view is skipped. */
  empty?: (data: T) => string | null;
  View: (props: { data: T }) => VNode;
};

export type LoadState<T> = { kind: "loading" } | { kind: "error"; error: BlockError } | { kind: "ready"; data: T };

export function Loading() {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-spinner size="base" accessibilityLabel="Loading" />
      <s-text color="subdued">Loading…</s-text>
    </s-stack>
  );
}

export function ErrorNote({ error }: { error: BlockError }) {
  return (
    <s-banner tone={error.kind === "access" ? "warning" : "critical"} heading="This block could not load">
      <s-paragraph>{error.message}</s-paragraph>
    </s-banner>
  );
}

export function EmptyNote({ message }: { message: string }) {
  return <s-text color="subdued">{message}</s-text>;
}

export type Tone = "success" | "warning" | "critical" | "neutral" | "info" | "caution";

export function Pill({ tone, children }: { tone: Tone; children: ComponentChildren }) {
  return <s-badge tone={tone}>{children}</s-badge>;
}

export function Note({ tone = "info", heading, children }: { tone?: "info" | "warning" | "critical" | "success"; heading?: string; children: ComponentChildren }) {
  return (
    <s-banner tone={tone} heading={heading}>
      <s-paragraph>{children}</s-paragraph>
    </s-banner>
  );
}

export function Muted({ children }: { children: ComponentChildren }) {
  return <s-text color="subdued">{children}</s-text>;
}

export function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <s-stack direction="block" gap="small">
      <s-heading>{title}</s-heading>
      {children}
    </s-stack>
  );
}

export type Row = { key: string; cells: ComponentChildren[] };

export function Table({ headers, rows }: { headers: string[]; rows: Row[] }) {
  return (
    <s-table>
      <s-table-header-row>
        {headers.map((h) => (
          <s-table-header key={h}>{h}</s-table-header>
        ))}
      </s-table-header-row>
      <s-table-body>
        {rows.map((r) => (
          <s-table-row key={r.key}>
            {r.cells.map((c, i) => (
              <s-table-cell key={i}>{c}</s-table-cell>
            ))}
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ComponentChildren }) {
  return (
    <s-link href={href} target="_blank">
      {children}
    </s-link>
  );
}

/** What a block shows for each state. Kept separate from the hooks so it can be tested. */
export function BlockView<T>({ cfg, state }: { cfg: BlockConfig<T>; state: LoadState<T> }) {
  let body: VNode;
  let summary: string | undefined;
  if (state.kind === "loading") body = <Loading />;
  else if (state.kind === "error") {
    body = <ErrorNote error={state.error} />;
    summary = "Could not load";
  } else {
    const message = cfg.empty?.(state.data) ?? null;
    summary = cfg.summary?.(state.data);
    body = message ? <EmptyNote message={message} /> : <cfg.View data={state.data} />;
  }
  return (
    <s-admin-block heading={cfg.heading} collapsedSummary={summary}>
      {body}
    </s-admin-block>
  );
}

function Root<T>({ cfg }: { cfg: BlockConfig<T> }) {
  const [state, setState] = useState<LoadState<T>>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    const productId = selectedProductId();
    if (!productId) {
      setState({ kind: "error", error: new BlockError("missing", "Open this block on a product page.") });
      return;
    }
    const { q, soft } = makeQueries((query, variables) => shopify.query(query, { variables }));
    cfg
      .load({ productId, q, soft })
      .then((data) => live && setState({ kind: "ready", data }))
      .catch((e: unknown) => {
        if (!live) return;
        const error = e instanceof BlockError ? e : new BlockError("graphql", "Something went wrong while building this block.", e instanceof Error ? e.message : String(e));
        setState({ kind: "error", error });
      });
    return () => {
      live = false;
    };
  }, []);
  return <BlockView cfg={cfg} state={state} />;
}

/** The default export of every block extension. */
export function defineBlock<T>(cfg: BlockConfig<T>): () => void {
  return () => {
    render(<Root cfg={cfg} />, document.body);
  };
}
