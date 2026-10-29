import { loadHealth, type HealthData } from "../../shared/healthLoad";
import { evaluateHealth, type HealthReport } from "../../shared/rules";
import type { ProfileId } from "../../shared/settings";
import type { LoadContext } from "../../shared/query";

export type Data = HealthData;
export const load = (ctx: LoadContext): Promise<Data> => loadHealth(ctx);

/** The report for the kind of product chosen in the view (null = the guess). Pure, so choosing another kind needs no new request. */
export const reportOf = (data: Data, profile: ProfileId | null = null): HealthReport => evaluateHealth({ facts: data.facts, settings: data.settings, profile: profile ?? undefined, markets: data.markets, records: data.records });

export const summaryOf = (r: HealthReport): string => {
  if (r.score === null) return "Nothing to check";
  const toFix = r.counts.blocks + r.counts.hurts;
  return toFix > 0 ? `${r.score}/100 · ${toFix} to fix` : `${r.score}/100 · Ready`;
};
