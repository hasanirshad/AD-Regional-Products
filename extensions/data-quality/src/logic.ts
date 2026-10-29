// Data quality checklist: the detailed view behind Product health. Same facts, same rules (shared/rules.ts).

import { fieldAlias } from "../../shared/facts";
import { loadHealth, type HealthData } from "../../shared/healthLoad";
import { evaluateHealth, type HealthReport } from "../../shared/rules";
import type { ProfileId } from "../../shared/settings";
import type { LoadContext } from "../../shared/query";

export { fieldAlias };
export type Data = HealthData;
export const load = (ctx: LoadContext): Promise<Data> => loadHealth(ctx);
export const reportOf = (data: Data, profile: ProfileId | null = null): HealthReport => evaluateHealth({ facts: data.facts, settings: data.settings, profile: profile ?? undefined, markets: data.markets, records: data.records });
