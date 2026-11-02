// Step 1, Product info: title, description and type (each with its translations), vendor and page template (not
// translated), and whether the product is kept in stock or made to order.

import { useEffect, useState } from "react";
import { liveGql, messageOf } from "../../../lib/editor/gql";
import { STATUS_LABEL } from "../../../lib/editor/model";
import { loadProductTemplates, templateLabel } from "../../../lib/editor/templates";
import { SelectField } from "../../SelectField";
import { CategorySection, productTarget, TagsTab, TranslatableField, type TabProps } from "../EditTabs";
import { TextBox } from "../TextBox";
import { StepHeading } from "./StepStrip";
import { StockKindToggle } from "./StockKindToggle";

export const DEFAULT_VENDOR = "Hardman Design";

function TemplatePicker({ edit, doc }: TabProps) {
  const target = productTarget(doc.id, "templateSuffix");
  const value = edit.effectiveValue(target) ?? "";
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; suffixes: string[]; theme: string; error: string }>({ status: "loading", suffixes: [], theme: "", error: "" });
  useEffect(() => {
    let cancelled = false;
    loadProductTemplates(liveGql)
      .then((r) => !cancelled && setState({ status: "ready", suffixes: r.suffixes, theme: r.theme, error: "" }))
      .catch((e) => !cancelled && setState({ status: "error", suffixes: [], theme: "", error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "ready") {
    const options = state.suffixes.map((s) => ({ value: s, label: templateLabel(s) }));
    if (!options.some((o) => o.value === value)) options.push({ value, label: `${templateLabel(value)} (not in the live theme)` });
    return <SelectField label="PDP template" value={value} options={options} onChange={(v) => edit.put(target, v)} />;
  }
  return (
    <TextBox
      label="PDP template"
      value={value}
      onChange={(text) => edit.put(target, text)}
      placeholder="Leave empty for the default product page"
      details={state.status === "error" ? `The theme's templates could not be read (${state.error}). Type the suffix of the template, for example made-to-order.` : "Reading the theme's templates…"}
    />
  );
}

export function InfoStep(props: TabProps & { knownTags?: string[] }) {
  const { edit, shared, doc } = props;
  const status = edit.effectiveValue(productTarget(doc.id, "status")) ?? doc.status;
  const vendorTarget = productTarget(doc.id, "vendor");

  // A product with no vendor gets the house vendor, as an edit that is reviewed like any other.
  useEffect(() => {
    if (doc.vendor === "" && doc.status === "DRAFT" && !(`p|${doc.id}|vendor` in edit.edits)) edit.put(vendorTarget, DEFAULT_VENDOR);
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <s-stack gap="base">
      <StepHeading step="info" />
      <TranslatableField {...props} field="title" />
      <TranslatableField {...props} field="descriptionHtml" label="Description" rich hint="Format the text with the toolbar. Use HTML to see the code. Copy the main text into a language, then translate it in place." />
      <TranslatableField {...props} field="productType" label="Product type" hint="Your own label for the kind of product, for example Dining table." />
      <s-section heading="Vendor and page template">
        <s-stack gap="small-200">
          <s-text color="subdued">These two are not translated.</s-text>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16, alignItems: "start" }}>
            <TextBox label="Vendor" value={edit.effectiveValue(vendorTarget) ?? ""} onChange={(text) => edit.put(vendorTarget, text)} placeholder={DEFAULT_VENDOR} />
            <TemplatePicker {...props} />
          </div>
        </s-stack>
      </s-section>
      <s-section heading="How is it sold?">
        <StockKindToggle edit={edit} shared={shared} doc={doc} applyNow={false} />
      </s-section>
      <s-section heading="More">
        <details>
          <summary style={{ cursor: "pointer" }}>
            <s-text>Category, tags and status</s-text>
          </summary>
          <s-stack gap="base">
            <CategorySection {...props} />
            <TagsTab {...props} />
            <s-section heading="Status">
              <s-stack gap="small-200">
                <SelectField
                  label="Status"
                  value={status}
                  options={Object.entries(STATUS_LABEL)
                    .filter(([value]) => value !== "ACTIVE" || doc.status === "ACTIVE")
                    .map(([value, label]) => ({ value, label }))}
                  onChange={(v) => edit.put(productTarget(doc.id, "status"), v)}
                />
                <s-text color="subdued">This app never makes a product active. Review the draft with the links at the top, then make it active in Shopify.</s-text>
              </s-stack>
            </s-section>
          </s-stack>
        </details>
      </s-section>
    </s-stack>
  );
}
