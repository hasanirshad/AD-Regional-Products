// The settings tabs of the health checks: groups and profiles, thresholds, theme fields, helper products, linked records.

import { useState } from "react";
import {
  GROUPS,
  GROUP_ABOUT,
  GROUP_LABEL,
  PROFILES,
  PROFILE_LABEL,
  RULE_CATALOGUE,
  SEVERITIES,
  SEVERITY_LABEL,
  THEME_RULES,
  THEME_RULE_LABEL,
  type FieldRef,
  type ProfileId,
  type Severity,
  type ThemeField,
  type ThemeRule,
} from "../../../extensions/shared/settings";
import { SelectField } from "../SelectField";
import { TextBox } from "../editor/TextBox";
import { edited, errorAt, errorsUnder, ChipList, ErrorLine, ListRow, MetafieldPicker, moved, NumberBox, Switch, type DefChoice, type PanelProps } from "./widgets";

const refOf = (c: DefChoice): FieldRef => ({ label: c.def.name || c.def.key, namespace: c.def.namespace, key: c.def.key, owner: c.owner });

// ---------------------------------------------------------------- groups and profiles

/** A switch per group, a table of which groups apply to which kind of product, and the single checks in an Advanced fold. */
export function GroupsPanel({ draft, set }: PanelProps) {
  const [advanced, setAdvanced] = useState(false);
  const g = draft.groups;
  const off = new Set(g.disabledRules);
  return (
    <s-stack gap="large-100">
      <s-stack gap="small-200">
        <s-heading>Groups of checks</s-heading>
        <s-text color="subdued">Switch a whole group off to hide it from Product health and Data quality and leave it out of the score.</s-text>
        {GROUPS.map((id) => (
          <Switch key={id} label={GROUP_LABEL[id]} details={GROUP_ABOUT[id]} checked={g.groups[id]} onChange={(on) => set(edited(draft, (d) => void (d.groups.groups[id] = on)))} />
        ))}
      </s-stack>

      <s-stack gap="small-200">
        <s-heading>Which groups apply to which kind of product</s-heading>
        <s-text color="subdued">Option products (finishes, edges, legs, services) are used by the theme as choices, so SEO, images and theme fields are off for them by default. A check that does not apply is not shown at all.</s-text>
        <s-table>
          <s-table-header-row>
            <s-table-header>Group</s-table-header>
            {PROFILES.map((p) => (
              <s-table-header key={p}>{PROFILE_LABEL[p]}</s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            {GROUPS.map((id) => (
              <s-table-row key={id}>
                <s-table-cell>{g.groups[id] ? GROUP_LABEL[id] : `${GROUP_LABEL[id]} (group is off)`}</s-table-cell>
                {PROFILES.map((p) => (
                  <s-table-cell key={p}>
                    <Switch label={`${GROUP_LABEL[id]} for ${PROFILE_LABEL[p]}`} checked={g.profiles[p][id]} disabled={!g.groups[id]} onChange={(on) => set(edited(draft, (d) => void (d.groups.profiles[p][id] = on)))} />
                  </s-table-cell>
                ))}
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-stack>

      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-heading>Advanced: single checks</s-heading>
          <s-button variant="tertiary" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? "Hide" : `Show (${RULE_CATALOGUE.length - off.size} of ${RULE_CATALOGUE.length} on)`}
          </s-button>
        </s-stack>
        {advanced ? (
          <s-stack gap="base">
            <s-text color="subdued">Switch one check off without turning off its group. The level (blocks storefront, hurts SEO or sales, nice to have) is fixed for each check; the theme fields have their own level.</s-text>
            {GROUPS.map((id) => (
              <s-stack key={id} gap="small-200">
                <s-text type="strong">{GROUP_LABEL[id]}</s-text>
                {RULE_CATALOGUE.filter((r) => r.group === id).map((r) => (
                  <Switch
                    key={r.id}
                    label={r.label}
                    details={`${SEVERITY_LABEL[r.severity]}${r.only ? ` · only for ${r.only.map((p) => PROFILE_LABEL[p].toLowerCase()).join(" and ")}` : ""}`}
                    checked={!off.has(r.id)}
                    onChange={(on) =>
                      set(
                        edited(draft, (d) => {
                          d.groups.disabledRules = on ? d.groups.disabledRules.filter((x) => x !== r.id) : [...new Set([...d.groups.disabledRules, r.id])];
                        }),
                      )
                    }
                  />
                ))}
              </s-stack>
            ))}
          </s-stack>
        ) : null}
      </s-stack>
    </s-stack>
  );
}

// ---------------------------------------------------------------- thresholds

export function ThresholdsPanel({ draft, set, problems }: PanelProps) {
  const t = draft.thresholds;
  const num = (label: string, path: string, get: () => number, put: (d: typeof draft, n: number) => void, details?: string) => (
    <NumberBox label={label} value={get()} details={details} error={errorAt(problems, `thresholds.${path}`)} onChange={(n) => set(edited(draft, (d) => put(d, n)))} />
  );
  return (
    <s-stack gap="large-100">
      <s-stack gap="small-200">
        <s-heading>SEO</s-heading>
        <s-stack direction="inline" gap="base">
          {num("SEO title, longest (characters)", "seoTitleMax", () => t.seoTitleMax, (d, n) => void (d.thresholds.seoTitleMax = n), "Default 60.")}
          {num("SEO description, shortest", "seoDescMin", () => t.seoDescMin, (d, n) => void (d.thresholds.seoDescMin = n), "Default 50.")}
          {num("SEO description, longest", "seoDescMax", () => t.seoDescMax, (d, n) => void (d.thresholds.seoDescMax = n), "Default 160.")}
        </s-stack>
      </s-stack>
      <s-stack gap="small-200">
        <s-heading>Images</s-heading>
        <s-stack direction="inline" gap="base">
          {num("Minimum images", "minImages", () => t.minImages, (d, n) => void (d.thresholds.minImages = n), "Default 1.")}
          {num("Alt text target (percent of images)", "altTarget", () => t.altTarget, (d, n) => void (d.thresholds.altTarget = n), "Default 100.")}
        </s-stack>
      </s-stack>
      <s-stack gap="small-200">
        <s-heading>Score weights</s-heading>
        <s-text color="subdued">The score is the weight of the checks that pass divided by the weight of all checks that apply. A weight of 0 leaves that level out of the score (it still shows in the list).</s-text>
        <s-stack direction="inline" gap="base">
          {SEVERITIES.map((sev: Severity) => (
            <div key={sev}>{num(SEVERITY_LABEL[sev], `weights.${sev}`, () => t.weights[sev], (d, n) => void (d.thresholds.weights[sev] = n), `Default ${{ blocks: 3, hurts: 2, nice: 1 }[sev]}.`)}</div>
          ))}
        </s-stack>
      </s-stack>
      <s-stack gap="small-200">
        <s-heading>Main market</s-heading>
        <s-text color="subdued">A product in the main market but missing in another market is a warning; otherwise a market spread is only a hint.</s-text>
        <SelectField
          label="Main market"
          value={t.primaryMarket}
          options={[{ value: "", label: "None" }, ...draft.markets.map((m) => ({ value: m.key, label: `${m.key} · ${m.label}` }))]}
          onChange={(v) => set(edited(draft, (d) => void (d.thresholds.primaryMarket = v)))}
        />
        <ErrorLine message={errorAt(problems, "thresholds.primaryMarket")} />
      </s-stack>
    </s-stack>
  );
}

// ---------------------------------------------------------------- theme fields

const SEVERITY_OPTIONS = SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }));
const RULE_OPTIONS = THEME_RULES.map((r) => ({ value: r, label: THEME_RULE_LABEL[r] }));

export function ThemeFieldsPanel(p: PanelProps) {
  const { draft, set, problems } = p;
  const [counter, setCounter] = useState(0);
  const fields = draft.themeFields;
  const productChoices = (p.productDefs.data ?? []).map((d) => ({ value: `${d.namespace}|${d.key}`, label: `${d.namespace}.${d.key} (${d.name})` }));

  const add = (c: DefChoice) => {
    const f = refOf(c);
    let id = `tf:${f.namespace}.${f.key}`;
    for (let n = 2; fields.some((x) => x.id === id); n++) id = `tf:${f.namespace}.${f.key}~${n}`;
    const item: ThemeField = { id, label: f.label, namespace: f.namespace, key: f.key, owner: f.owner, rule: "filled", profiles: ["real"], severity: "hurts", on: true };
    set(edited(draft, (d) => void d.themeFields.push(item)));
    setCounter((n) => n + 1);
  };

  return (
    <s-stack gap="small-200">
      <s-text color="subdued">The metafields your storefront theme reads. Pre-filled from the Hardman store export; change, switch off, remove or add as the theme changes. A field is checked for the kinds of product ticked on its row.</s-text>
      {fields.length === 0 ? <s-text color="subdued">No theme fields. Add one below.</s-text> : null}
      {fields.map((f, i) => {
        const base = `themeFields.${i}`;
        return (
          <ListRow
            key={f.id}
            title={f.label}
            detail={`${f.namespace}.${f.key} · ${f.owner === "variant" ? "variant" : "product"}`}
            badge={f.on ? undefined : "Off"}
            index={i}
            count={fields.length}
            lead={<Switch label={`${f.label} on or off`} checked={f.on} onChange={(on) => set(edited(draft, (d) => void (d.themeFields[i]!.on = on)))} />}
            onMove={(delta) => set(edited(draft, (d) => void (d.themeFields = moved(d.themeFields, i, delta))))}
            onRemove={() => set(edited(draft, (d) => void d.themeFields.splice(i, 1)))}
            error={errorAt(problems, base) ?? errorsUnder(problems, base)[0]?.message}
          >
            <s-stack direction="inline" gap="base" alignItems="end">
              <TextBox label="Name" value={f.label} onChange={(v) => set(edited(draft, (d) => void (d.themeFields[i]!.label = v)))} error={errorAt(problems, `${base}.label`)} />
              <SelectField label="Rule" value={f.rule} options={RULE_OPTIONS} onChange={(v) => set(edited(draft, (d) => void (d.themeFields[i]!.rule = v as ThemeRule)))} />
              <SelectField label="Level when it fails" value={f.severity} options={SEVERITY_OPTIONS} onChange={(v) => set(edited(draft, (d) => void (d.themeFields[i]!.severity = v as Severity)))} />
            </s-stack>
            {f.rule === "sameAs" ? (
              <SelectField
                label="Compare with (a product metafield)"
                value={f.other ? `${f.other.namespace}|${f.other.key}` : ""}
                options={[{ value: "", label: "Choose a metafield…" }, ...(f.other && !productChoices.some((c) => c.value === `${f.other!.namespace}|${f.other!.key}`) ? [{ value: `${f.other.namespace}|${f.other.key}`, label: `${f.other.namespace}.${f.other.key}` }] : []), ...productChoices]}
                onChange={(v) => {
                  const bar = v.indexOf("|");
                  set(edited(draft, (d) => void (d.themeFields[i]!.other = bar < 0 ? undefined : { namespace: v.slice(0, bar), key: v.slice(bar + 1) })));
                }}
              />
            ) : null}
            <s-stack direction="inline" gap="base">
              {PROFILES.map((pr: ProfileId) => (
                <Switch
                  key={pr}
                  label={`Required for: ${PROFILE_LABEL[pr].toLowerCase()}`}
                  checked={f.profiles.includes(pr)}
                  onChange={(on) => set(edited(draft, (d) => void (d.themeFields[i]!.profiles = on ? [...new Set([...d.themeFields[i]!.profiles, pr])] : d.themeFields[i]!.profiles.filter((x) => x !== pr))))}
                />
              ))}
            </s-stack>
          </ListRow>
        );
      })}
      <ErrorLine message={errorAt(problems, "themeFields")} />
      <MetafieldPicker label="Add a theme field" owners={["product", "variant"]} productDefs={p.productDefs} variantDefs={p.variantDefs} counter={counter} onPick={add} />
    </s-stack>
  );
}

// ---------------------------------------------------------------- helper products

export function HelpersPanel({ draft, set, problems }: PanelProps) {
  const list = (key: "types" | "tags" | "titlePatterns" | "bundleTypes" | "bundleTags" | "expectedCategories" | "woodNames", label: string, hint: string, placeholder?: string) => (
    <ChipList label={label} hint={hint} items={draft.helpers[key]} errors={errorsUnder(problems, `helpers.${key}`)} placeholder={placeholder} onChange={(next) => set(edited(draft, (d) => void (d.helpers[key] = next)))} />
  );
  return (
    <s-stack gap="large-100">
      <s-text color="subdued">Product Insights decides if a product is a Real product, an Option product (a finish, edge, leg or service the theme uses as a choice) or a Bundle. Content checks do not nag Option products. Case does not matter.</s-text>
      {list("types", "Option product: Types", "A product whose Type (or category) is in this list is an Option product.", "Finishes")}
      {list("tags", "Option product: tags", "Any of these tags makes it an Option product.", "option")}
      {list("titlePatterns", "Option product: title patterns", "A word or phrase in the title; use * for anything, for example “* finish”.", "* finish")}
      {list("bundleTypes", "Bundle: Types", "Types that mean a Bundle.", "Set")}
      {list("bundleTags", "Bundle: tags", "Tags that mean a Bundle.", "bundle")}
      {list("expectedCategories", "Expected product Types", "The names a real product's Type should be one of, for example Tables, Chairs. Empty = this check does not apply. “Detect from this store” can fill it from the Types in use.", "Tables")}
      {list("woodNames", "Wood and material names", "A Type that is one of these is flagged, because it names a material and not a category.", "Oak")}
    </s-stack>
  );
}

// ---------------------------------------------------------------- linked records

export function RecordsPanel(p: PanelProps) {
  const { draft, set, problems } = p;
  const r = draft.records;
  const [counter, setCounter] = useState(0);
  const pick = (which: "swatchField" | "hideField", c: DefChoice) => {
    set(edited(draft, (d) => void (d.records[which] = refOf(c))));
    setCounter((n) => n + 1);
  };
  const type = (key: "swatchType" | "deliveryType" | "designType", label: string, about: string) => (
    <TextBox label={label} value={r[key]} details={about} error={errorAt(problems, `records.${key}`)} onChange={(v) => set(edited(draft, (d) => void (d.records[key] = v.trim())))} />
  );
  return (
    <s-stack gap="large-100">
      <s-stack gap="small-200">
        <s-heading>Metaobject types</s-heading>
        <s-text color="subdued">The type is the handle of the metaobject definition, shown in its address in Shopify. Leave one empty to skip its checks. Reading metaobjects needs the permissions read_metaobjects and read_metaobject_definitions (deploy the app, then approve in the store).</s-text>
        <s-stack direction="inline" gap="base">
          {type("swatchType", "Swatches", "Default swatches.")}
          {type("deliveryType", "Build and delivery time", "Default build_and_delivery_time.")}
          {type("designType", "Design and customisation", "Default design_customisation.")}
        </s-stack>
      </s-stack>
      <s-stack gap="small-200">
        <s-heading>Variant metafields</s-heading>
        <s-text color="subdued">{`Swatch: ${r.swatchField.namespace}.${r.swatchField.key}. Hide from markets: ${r.hideField.namespace}.${r.hideField.key}. These two are not seen in the export of the store, so check them on one product first.`}</s-text>
        <ErrorLine message={errorAt(problems, "records.swatchField") ?? errorAt(problems, "records.hideField")} />
        <MetafieldPicker label="Variant metafield that points to the swatch" owners={["variant"]} productDefs={p.productDefs} variantDefs={p.variantDefs} counter={counter} onPick={(c) => pick("swatchField", c)} />
        <MetafieldPicker label="Variant metafield that lists the markets a variant is hidden in" owners={["variant"]} productDefs={p.productDefs} variantDefs={p.variantDefs} counter={counter + 1000} onPick={(c) => pick("hideField", c)} />
      </s-stack>
    </s-stack>
  );
}
