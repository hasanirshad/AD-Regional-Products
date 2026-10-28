import { useState } from "react";
import { CHECK_CATALOGUE, customCheckId, type CheckKind, type CheckSetting, type FieldRef } from "../../../extensions/shared/settings";
import { SelectField } from "../SelectField";
import { TextBox } from "../editor/TextBox";
import { edited, errorAt, ErrorLine, ListRow, MetafieldPicker, moved, Switch, type DefChoice, type PanelProps } from "./widgets";

type Group = "length" | "seater" | "leadTime";
const GROUPS: { id: Group; title: string; hint: string }[] = [
  { id: "length", title: "Length metafields", hint: "Used by the check “Length and seater filled”." },
  { id: "seater", title: "Seater metafields", hint: "Used by the check “Length and seater filled”." },
  { id: "leadTime", title: "Lead-time metafields", hint: "Used by the check “Lead time set”. Until you add one, that check shows “Not configured” and is left out of the count." },
];

const refOf = (c: DefChoice): FieldRef => ({ label: c.def.name || c.def.key, namespace: c.def.namespace, key: c.def.key, owner: c.owner });
const refKey = (f: Pick<FieldRef, "owner" | "namespace" | "key">) => `${f.owner}.${f.namespace}.${f.key}`;

/** Data quality checklist: which checks run, and which metafields they look at. */
export function QualityPanel(p: PanelProps) {
  const { draft, set, problems } = p;
  const [counter, setCounter] = useState(0);
  const checks = draft.quality.checks;
  const bump = () => setCounter((n) => n + 1);

  const present = new Set(checks.map((c) => c.kind));
  const addable = CHECK_CATALOGUE.filter((c) => c.repeatable || !present.has(c.kind));
  const addCheck = (kind: string) => {
    const entry = CHECK_CATALOGUE.find((c) => c.kind === kind);
    if (!entry || kind === "metafield") return; // a metafield check is added with its metafield, below
    set(edited(draft, (d) => void d.quality.checks.push({ id: kind, kind: kind as CheckKind, label: entry.label, on: true })));
    bump();
  };
  const addCustom = (c: DefChoice) => {
    const field = refOf(c);
    const check: CheckSetting = { id: customCheckId(field), kind: "metafield", label: `${field.label} filled`, on: true, field };
    if (checks.some((x) => x.id === check.id)) return;
    set(edited(draft, (d) => void d.quality.checks.push(check)));
    bump();
  };
  const addField = (group: Group, c: DefChoice) => {
    set(edited(draft, (d) => void d.quality.fields[group].push(refOf(c))));
    bump();
  };

  const usedCustom = new Set(checks.flatMap((c) => (c.field ? [refKey(c.field)] : [])));

  return (
    <s-stack gap="large-100">
      <s-stack gap="small-200">
        <s-heading>Checks</s-heading>
        <s-text color="subdued">Switch a check off to hide it and leave it out of the count. Remove it to take it out of the list; you can add it back from the list below.</s-text>
        {checks.length === 0 ? <s-text color="subdued">No checks. The block will say so. Add one below.</s-text> : null}
        {checks.map((c, i) => {
          const entry = CHECK_CATALOGUE.find((x) => x.kind === c.kind);
          return (
            <ListRow
              key={c.id}
              title={c.kind === "metafield" ? "Metafield filled" : c.label}
              badge={c.kind === "metafield" ? "Custom" : undefined}
              detail={c.on ? undefined : "Off"}
              index={i}
              count={checks.length}
              lead={<Switch label={`${c.label} on or off`} checked={c.on} onChange={(on) => set(edited(draft, (d) => void (d.quality.checks[i]!.on = on)))} />}
              onMove={(delta) => set(edited(draft, (d) => void (d.quality.checks = moved(d.quality.checks, i, delta))))}
              onRemove={() => set(edited(draft, (d) => void d.quality.checks.splice(i, 1)))}
              error={errorAt(problems, `quality.checks.${i}`) ?? errorAt(problems, `quality.checks.${i}.field`) ?? errorAt(problems, `quality.checks.${i}.label`)}
            >
              <s-text color="subdued">{c.field ? `${c.field.owner === "variant" ? "Every variant" : "The product"} must have a value in ${c.field.namespace}.${c.field.key}.` : (entry?.about ?? "")}</s-text>
              {c.kind === "metafield" ? <TextBox label="Name of the check" value={c.label} onChange={(label) => set(edited(draft, (d) => void (d.quality.checks[i]!.label = label)))} error={errorAt(problems, `quality.checks.${i}.label`)} /> : null}
            </ListRow>
          );
        })}
        <ErrorLine message={errorAt(problems, "quality.checks")} />
        {addable.some((c) => !c.repeatable) ? (
          <SelectField
            key={`catalogue-${counter}`}
            label="Add a check from the catalogue"
            value=""
            options={[{ value: "", label: "Choose a check…" }, ...addable.filter((c) => !c.repeatable).map((c) => ({ value: c.kind, label: `${c.label} · ${c.about}` }))]}
            onChange={addCheck}
          />
        ) : (
          <s-text color="subdued">Every check in the catalogue is already in the list.</s-text>
        )}
      </s-stack>

      <s-stack gap="small-200">
        <s-heading>Custom check: a metafield must not be empty</s-heading>
        <s-text color="subdued">Pick a product or variant metafield. The block fails the check when it is empty (a variant metafield must be filled on every variant).</s-text>
        <MetafieldPicker label="Add a “metafield must not be empty” check" owners={["product", "variant"]} productDefs={p.productDefs} variantDefs={p.variantDefs} exclude={usedCustom} onPick={addCustom} counter={counter} />
      </s-stack>

      {GROUPS.map((g) => {
        const list = draft.quality.fields[g.id];
        return (
          <s-stack key={g.id} gap="small-200">
            <s-heading>{g.title}</s-heading>
            <s-text color="subdued">{g.hint}</s-text>
            {list.length === 0 ? <s-text color="subdued">None chosen.</s-text> : null}
            {list.map((f, i) => (
              <ListRow
                key={refKey(f)}
                title={`${f.namespace}.${f.key}`}
                detail={`${f.owner === "variant" ? "Variant" : "Product"} · ${f.label}`}
                index={i}
                count={list.length}
                onRemove={() => set(edited(draft, (d) => void d.quality.fields[g.id].splice(i, 1)))}
                error={errorAt(problems, `quality.fields.${g.id}.${i}`) ?? errorAt(problems, `quality.fields.${g.id}.${i}.key`) ?? errorAt(problems, `quality.fields.${g.id}.${i}.label`)}
              />
            ))}
            <ErrorLine message={errorAt(problems, `quality.fields.${g.id}`)} />
            <MetafieldPicker
              label={`Add to ${g.title.toLowerCase()}`}
              owners={["product", "variant"]}
              productDefs={p.productDefs}
              variantDefs={p.variantDefs}
              exclude={new Set(list.map(refKey))}
              onPick={(c) => addField(g.id, c)}
              counter={counter}
            />
          </s-stack>
        );
      })}
    </s-stack>
  );
}
