import { beforeAll, describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { compatibilityWarning, escapeXml, generateRibbonDiffXml, inferSurface, parseRibbonSurfaces, parseRibbonXml, safeId, surfaceSummary } from "./ribbon";

beforeAll(() => {
  globalThis.DOMParser = DOMParser;
});

describe("ribbon helpers", () => {
  it("identifies supported command surfaces", () => {
    expect(inferSurface("Mscrm.Form.account.Save")).toBe("form");
    expect(inferSurface("Mscrm.HomepageGrid.account.New")).toBe("grid");
    expect(inferSurface("Mscrm.SubGrid.account.AddExisting")).toBe("subgrid");
  });

  it("flags controls that need test-environment verification", () => {
    expect(compatibilityWarning({ surface: "other", command: "Mscrm.Command" })).toContain("Outside");
    expect(compatibilityWarning({ surface: "form", command: "" })).toContain("did not expose");
    expect(compatibilityWarning({ surface: "form", command: "Mscrm.Save" })).toBe("");
  });

  it("escapes values included in XML", () => {
    expect(escapeXml('A&B"<>')).toBe("A&amp;B&quot;&lt;&gt;");
    expect(safeId("my prefix!")).toBe("my_prefix_");
  });

  it("generates deterministic, de-duplicated hide actions", () => {
    const button = { id: "Mscrm.Form.account.Delete" };
    const xml = generateRibbonDiffXml([button, button], "brg");
    expect(xml.match(/HideCustomAction/g)).toHaveLength(1);
    expect(xml).toContain('Location="Mscrm.Form.account.Delete"');
    expect(xml).toContain('HideActionId="brg.Mscrm.Form.account.Delete.Hide"');
  });

  it("resolves ribbon resource labels and omits unresolved resource tooltips", () => {
    const buttons = parseRibbonXml(`<Ribbon>
      <LocLabels><LocLabel Id="$Resources:Ribbon.Form.Save"><Titles><Title languagecode="1033" description="Save record" /></Titles></LocLabel></LocLabels>
      <Button Id="Mscrm.Form.account.Save" LabelText="$Resources:Ribbon.Form.Save" ToolTipDescription="$Resources:Ribbon.Tooltip.Save" />
      <Button Id="Mscrm.HomepageGrid.account.StaticWorksheet" LabelText="$Resources:Ribbon.HomepageGrid.Data.Export.StaticExcelExport" />
    </Ribbon>`);

    expect(buttons[0]).toMatchObject({ label: "Save record", description: "" });
    expect(buttons[1]).toMatchObject({ label: "Export to Excel" });
  });

  it("reads every hideable control type, not only Button", () => {
    const controls = parseRibbonXml(`<Ribbon><CommandUIDefinition Id="Mscrm.Form.account.MainTab">
      <Button Id="Mscrm.Form.account.Save" Command="Mscrm.Save" LabelText="Save" />
      <ToggleButton Id="Mscrm.Form.account.Follow" Command="Mscrm.Follow" LabelText="Follow" />
      <SplitButton Id="Mscrm.Form.account.Assign" Command="Mscrm.Assign" LabelText="Assign" />
      <FlyoutAnchor Id="Mscrm.Form.account.Export" Command="Mscrm.Export" LabelText="Export" />
      <CheckBox Id="Mscrm.Form.account.Flag" Command="Mscrm.Flag" LabelText="Flag" />
    </CommandUIDefinition></Ribbon>`);

    expect(controls.map((control) => control.type).sort()).toEqual([
      "Button", "CheckBox", "FlyoutAnchor", "SplitButton", "ToggleButton"
    ]);
    expect(controls).toHaveLength(5);
  });

  it("reports a control that appears on several surfaces once", () => {
    const controls = parseRibbonXml(`<Ribbon>
      <CommandUIDefinition Id="Mscrm.Form.account.MainTab"><Button Id="Mscrm.account.Delete" Command="Mscrm.Delete" LabelText="Delete" /></CommandUIDefinition>
      <CommandUIDefinition Id="Mscrm.HomepageGrid.account.MainTab"><Button Id="Mscrm.account.Delete" LabelText="Delete" /></CommandUIDefinition>
    </Ribbon>`);

    expect(controls).toHaveLength(1);
    expect(controls[0].surfaces).toEqual(["form", "grid"]);
    expect(controls[0].command).toBe("Mscrm.Delete");
    expect(surfaceSummary(controls[0].surfaces)).toBe("Main form · Main grid");
  });

  it("takes the surface from the retrieval location rather than the control ID", () => {
    const controls = parseRibbonSurfaces([
      { surface: "subgrid", xml: `<Ribbon><Button Id="contoso.MyFormLikeControl" Command="contoso.Run" LabelText="Run" /></Ribbon>` }
    ]);

    expect(controls[0].surfaces).toEqual(["subgrid"]);
    expect(controls[0].compatibilityWarning).toBe("");
  });

  it("only warns about an unsupported surface when no surface is supported", () => {
    expect(compatibilityWarning({ surfaces: ["other", "form"], command: "Mscrm.Run" })).toBe("");
    expect(compatibilityWarning({ surfaces: ["other"], command: "Mscrm.Run" })).toContain("Outside");
  });
});
