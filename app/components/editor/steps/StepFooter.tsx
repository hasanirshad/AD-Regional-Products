import { stepAfter, stepIndex, type StepId } from "../../../lib/editor/productSteps";

/**
 * Back and "Save and next". With changes waiting in the product, "Save and next" opens the review, then saves, then moves
 * on; with none it just moves on. Nothing is written before the review, the confirmation and the password.
 */
export function StepFooter({
  step,
  waiting,
  blocked,
  onBack,
  onSaveNext,
  nextLabel,
  note,
}: {
  step: StepId;
  /** Changes waiting for this product. */
  waiting: number;
  /** Problems that block the review. */
  blocked: boolean;
  onBack: () => void;
  onSaveNext: () => void;
  nextLabel?: string;
  note?: string;
}) {
  const first = stepIndex(step) === 0;
  const last = stepAfter(step) === step;
  return (
    <s-section>
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200">
          <s-button disabled={first || undefined} onClick={onBack}>
            Back
          </s-button>
          {last ? null : (
            <s-button variant="primary" disabled={blocked || undefined} onClick={onSaveNext}>
              {nextLabel ?? (waiting > 0 ? `Save and next (${waiting} change${waiting === 1 ? "" : "s"})` : "Next")}
            </s-button>
          )}
        </s-stack>
        <s-text color="subdued">{note ?? (waiting > 0 ? "Saving shows a review first, then asks for the password. The product stays a draft." : "Nothing to save on this step.")}</s-text>
      </s-stack>
    </s-section>
  );
}
