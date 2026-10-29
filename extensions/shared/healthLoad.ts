// What Product health and Data quality load: the facts, the markets and the linked records, read once.

import { healthNeed, loadFacts, type ProductFacts } from "./facts";
import { readMarketStates, type MarketState } from "./markets";
import { EMPTY_RECORDS, loadRecords, type RecordsFacts } from "./records";
import type { LoadContext } from "./query";
import { marketDefs, settingsOf, type BlockSettings } from "./settings";

export type HealthData = { facts: ProductFacts; settings: BlockSettings; markets: MarketState[] | null; records: RecordsFacts; notes: string[] };

export async function loadHealth(ctx: LoadContext): Promise<HealthData> {
  const settings = settingsOf(ctx);
  const facts = await loadFacts(ctx, healthNeed(settings));
  const wantRecords = settings.groups.groups.linked && (settings.records.swatchType !== "" || settings.records.deliveryType !== "" || settings.records.designType !== "");
  const [markets, records] = await Promise.all([
    settings.groups.groups.markets ? readMarketStates(ctx.soft, marketDefs(settings), facts.publishedCatalogIds) : Promise.resolve(null),
    wantRecords ? loadRecords(ctx, facts, settings, { linked: true, delivery: settings.records.deliveryType !== "" }) : Promise.resolve(EMPTY_RECORDS),
  ]);
  const notes = [...facts.notes];
  if (settings.groups.groups.markets && !markets) notes.push("The market list could not be read, so the market spread check is left out.");
  if (records.state === "failed") notes.push(`Linked records could not be read (${records.message}). They need the metaobject permission.`);
  return { facts, settings, markets, records, notes };
}
