import { describe, expect, it } from "vitest";
import { parseGroupsFile, profileNameFor, validateDraft } from "./groups";
import { summarizeCodes, toOptions } from "./countries";
import type { Group } from "./types";

const group = (over: Partial<Group> = {}): Group => ({
  id: "g1",
  name: "UK",
  countries: ["GB"],
  profileId: null,
  ...over,
});

describe("parseGroupsFile", () => {
  it("returns an empty list for missing or broken data", () => {
    expect(parseGroupsFile(null).groups).toEqual([]);
    expect(parseGroupsFile("x").groups).toEqual([]);
    expect(parseGroupsFile({ groups: "nope" }).groups).toEqual([]);
  });

  it("keeps valid groups, upper-cases and de-duplicates countries, drops bad rows", () => {
    const file = parseGroupsFile({
      version: 1,
      groups: [
        { id: "a", name: "DHL", countries: ["de", "AT", "DE"], profileId: "gid://p/1" },
        { id: 5, name: "bad" },
        null,
        { id: "b", name: "UK", countries: ["GB", 7] },
      ],
    });
    expect(file.groups).toEqual([
      { id: "a", name: "DHL", countries: ["DE", "AT"], profileId: "gid://p/1" },
      { id: "b", name: "UK", countries: ["GB"], profileId: null },
    ]);
  });
});

describe("validateDraft", () => {
  it("accepts a good draft", () => {
    expect(validateDraft({ id: null, name: "Froede", countries: ["DE"] }, [group()])).toBeNull();
  });
  it("explains each problem", () => {
    expect(validateDraft({ id: null, name: "  ", countries: ["DE"] }, [])).toMatch(/group name/);
    expect(validateDraft({ id: null, name: "x".repeat(61), countries: ["DE"] }, [])).toMatch(/shorter/);
    expect(validateDraft({ id: null, name: "Froede", countries: [] }, [])).toMatch(/at least one country/);
  });
  it("rejects a name used by another group but allows keeping your own", () => {
    expect(validateDraft({ id: null, name: "uk", countries: ["GB"] }, [group()])).toMatch(/already uses/);
    expect(validateDraft({ id: "g1", name: "UK", countries: ["GB"] }, [group()])).toBeNull();
  });
});

describe("helpers", () => {
  it("builds the profile name", () => {
    expect(profileNameFor("  Froede ")).toBe("Group: Froede");
  });
  it("summarizes codes", () => {
    expect(summarizeCodes([])).toBe("—");
    expect(summarizeCodes(["DE", "AT"])).toBe("DE, AT");
    expect(summarizeCodes(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C, D (+2)");
  });
  it("sorts and de-duplicates country options by name", () => {
    const opts = toOptions(["DE", "AT", "DE", ""], (c) => ({ DE: "Germany", AT: "Austria" })[c] ?? c);
    expect(opts.map((o) => o.name)).toEqual(["Austria", "Germany"]);
  });
});
