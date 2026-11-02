import { describe, expect, it } from "vitest";
import type { Gql } from "./gql";
import { loadProductTemplates, suffixesFrom, templateLabel } from "./templates";

describe("suffixesFrom", () => {
  it("turns template file names into suffixes, default first", () => {
    expect(suffixesFrom(["templates/product.made-to-order.json", "templates/product.json", "templates/product.stock.liquid", "templates/collection.json", "templates/product.json.bak", "templates/product.a.b.json"])).toEqual(["", "made-to-order", "stock"]);
  });
  it("labels them", () => {
    expect(templateLabel("")).toBe("Default product page");
    expect(templateLabel("made-to-order")).toBe("product.made-to-order");
  });
});

describe("loadProductTemplates", () => {
  it("reads the live theme's product templates", async () => {
    const gql = (async () => ({ themes: { nodes: [{ name: "Dawn", files: { nodes: [{ filename: "templates/product.json" }, { filename: "templates/product.x.json" }] } }] } })) as Gql;
    expect(await loadProductTemplates(gql)).toEqual({ theme: "Dawn", suffixes: ["", "x"] });
  });
  it("says so when there is no live theme", async () => {
    const gql = (async () => ({ themes: { nodes: [] } })) as Gql;
    await expect(loadProductTemplates(gql)).rejects.toThrow("live theme");
  });
});
