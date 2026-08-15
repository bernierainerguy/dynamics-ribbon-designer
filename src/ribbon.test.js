import { beforeAll, describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { escapeXml, generateRibbonDiffXml, inferSurface, parseRibbonXml, safeId } from "./ribbon";

beforeAll(() => {
  globalThis.DOMParser = DOMParser;
});

describe("ribbon helpers", () => {
  it("identifies supported command surfaces", () => {
    expect(inferSurface("Mscrm.Form.account.Save")).toBe("form");
    expect(inferSurface("Mscrm.HomepageGrid.account.New")).toBe("grid");
    expect(inferSurface("Mscrm.SubGrid.account.AddExisting")).toBe("subgrid");
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
});
