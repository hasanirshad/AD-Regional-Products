// Step 8, SEO: the search title and description with their translations, and the URL handle (not translated).

import { slugify } from "../../../lib/editor/canon";
import { productTarget, TranslatableField, type TabProps } from "../EditTabs";
import { TextBox } from "../TextBox";
import { StepHeading } from "./StepStrip";

export function SeoStep(props: TabProps) {
  const { edit, doc } = props;
  const title = edit.effectiveValue(productTarget(doc.id, "seoTitle")) ?? "";
  const description = edit.effectiveValue(productTarget(doc.id, "seoDescription")) ?? "";
  const handleTarget = productTarget(doc.id, "handle");
  const handle = edit.effectiveValue(handleTarget) ?? "";
  const problem = edit.built.errors.find((e) => e.id === `p|${doc.id}|handle`);
  return (
    <s-stack gap="base">
      <StepHeading step="seo" />
      <TranslatableField {...props} field="seoTitle" hint={`${title.length} characters. Search engines show about 60 to 70.`} />
      <TranslatableField {...props} field="seoDescription" multiline rows={3} hint={`${description.length} characters. Search engines show about 150 to 160.`} />
      <s-section heading="URL handle">
        <s-stack gap="small-200">
          <s-text color="subdued">The end of the product address. It is not translated. Changing it makes the old address redirect to the new one (you can turn that off in the review).</s-text>
          <TextBox label="URL handle" hideLabel value={handle} onChange={(text) => edit.put(handleTarget, text)} error={problem ? "The handle cannot be empty" : null} details={handle && slugify(handle) !== handle ? `Shopify will save this as "${slugify(handle)}".` : undefined} />
        </s-stack>
      </s-section>
    </s-stack>
  );
}
