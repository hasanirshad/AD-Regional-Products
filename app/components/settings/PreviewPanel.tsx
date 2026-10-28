import type { Preview, Tone } from "../../lib/editor/blockPreview";

const Pill = ({ text, tone }: { text: string; tone?: Tone }) => (tone ? <s-badge tone={tone}>{text}</s-badge> : <s-text>{text}</s-text>);

/** "Preview how the block will look": the block's own code run on sample data, drawn here. */
export function PreviewPanel({ heading, preview, unavailable }: { heading: string; preview: Preview | null; unavailable?: string }) {
  return (
    <s-section heading="Preview how the block will look">
      <s-stack gap="base">
        <s-text color="subdued">{`This is the “${heading}” block with your settings, on a made-up product. The real block shows this product's data.`}</s-text>
        {preview === null ? (
          <s-text color="subdued">{unavailable ?? "The preview is not available until the problems above are fixed."}</s-text>
        ) : (
          <div style={{ border: "1px solid var(--p-color-border, #e3e3e3)", borderRadius: 12, padding: 16 }}>
            <s-stack gap="base">
              <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                <s-heading>{heading}</s-heading>
                {preview.summary ? <s-text color="subdued">{preview.summary}</s-text> : null}
              </s-stack>
              {preview.empty ? <s-text color="subdued">{preview.empty}</s-text> : null}
              {preview.pills.length > 0 ? (
                <s-stack direction="inline" gap="small-200">
                  {preview.pills.map((p, i) => (
                    <Pill key={i} text={p.text} tone={p.tone} />
                  ))}
                </s-stack>
              ) : null}
              {preview.links.length > 0 ? (
                <s-stack gap="small-300">
                  {preview.links.map((l) => (
                    <s-text key={l.url}>{`${l.label}: ${l.url}`}</s-text>
                  ))}
                </s-stack>
              ) : null}
              {preview.tables.map((t, ti) => (
                <s-stack key={ti} gap="small-200">
                  {t.title ? <s-heading>{t.title}</s-heading> : null}
                  <s-table>
                    <s-table-header-row>
                      {t.headers.map((h) => (
                        <s-table-header key={h}>{h}</s-table-header>
                      ))}
                    </s-table-header-row>
                    <s-table-body>
                      {t.rows.map((row, ri) => (
                        <s-table-row key={ri}>
                          {row.map((c, ci) => (
                            <s-table-cell key={ci}>
                              <Pill text={c.text} tone={c.tone} />
                            </s-table-cell>
                          ))}
                        </s-table-row>
                      ))}
                    </s-table-body>
                  </s-table>
                </s-stack>
              ))}
              {preview.notes.map((n) => (
                <s-text key={n} color="subdued">
                  {n}
                </s-text>
              ))}
            </s-stack>
          </div>
        )}
      </s-stack>
    </s-section>
  );
}
