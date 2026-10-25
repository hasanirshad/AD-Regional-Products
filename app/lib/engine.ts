// What the shared apply screen (RunFlow) needs from a kind of change. A move and a channel change look the same
// to the screen: lines to apply, a recheck before, and a run that applies and reads back.

import type { Progress } from "./applyMove";
import type { Finding } from "./readback";
import type { ReportRow } from "./report";

export type RunHooks = {
  onProgress: (p: Progress) => void;
  shouldStop: () => boolean;
  onStage?: (s: "applying" | "verifying") => void;
  retryWaitMs?: number;
};

export type RunEngine<L> = {
  lines: L[];
  /** Reads the store again. Findings = the store no longer matches the review. Writes nothing. */
  recheck: (lines: L[]) => Promise<Finding[]>;
  /** Applies, reads back, and reports one row per line. */
  run: (lines: L[], hooks: RunHooks) => Promise<{ rows: ReportRow[] }>;
  /** Identifies a line in the report. */
  describe: (line: L) => { productId: string; title: string; handle: string };
};
