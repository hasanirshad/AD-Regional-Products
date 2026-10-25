// Small builders shared by the tests. Not used by the app.
import type { Market, ProductRow, ProfileSummary, ProfileZone } from "./types";

export const zone = (id: string, countries: string[], rateCount: number | null = 1, extra: Partial<ProfileZone> = {}): ProfileZone => ({
  id,
  name: id,
  locationGroupId: "lg1",
  countries,
  restOfWorld: false,
  rateCount,
  ...extra,
});

export const profile = (id: string, countries: string[], extra: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id,
  name: id,
  isDefault: false,
  variantCount: 1,
  locationGroupIds: ["lg1"],
  zoneIds: [],
  zones: [],
  countries,
  restOfWorld: false,
  unratedCountries: [],
  ratesKnown: true,
  rateCount: 2,
  zonesTruncated: false,
  ...extra,
});

export const market = (id: string, codes: string[], catalogIds: string[] = [`c-${id}`], status = "ACTIVE"): Market => ({
  id,
  name: id,
  status,
  countries: codes.map((code) => ({ code, name: code })),
  catalogs: catalogIds.map((c) => ({ id: c, title: c, publicationId: `pub-${c}` })),
});

export const product = (id: string, catalogIds: string[] = [], status = "ACTIVE", variantCount = 1): ProductRow => ({
  id,
  numericId: id,
  title: `Title ${id}`,
  handle: `handle-${id}`,
  vendor: "",
  productType: "",
  status,
  tags: [],
  catalogs: catalogIds.map((c) => ({ id: c, title: c })),
  variantCount,
});
