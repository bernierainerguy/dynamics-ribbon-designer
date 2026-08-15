import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPatchedSolutionZip } from "./solutionBuilder";

beforeAll(() => {
  globalThis.DOMParser = DOMParser;
  globalThis.XMLSerializer = XMLSerializer;
});

const ribbon = `<RibbonDiffXml>
  <CustomActions>
    <HideCustomAction HideActionId="brg.Mscrm.Form.account.Delete.Hide" Location="Mscrm.Form.account.Delete" Sequence="1000" />
  </CustomActions>
  <Templates><RibbonTemplates Id="Mscrm.Templates" /></Templates>
  <CommandDefinitions />
  <RuleDefinitions><TabDisplayRules /><DisplayRules /><EnableRules /></RuleDefinitions>
  <LocLabels />
</RibbonDiffXml>`;

function solutionZip(managed = "0") {
  const solution = `<ImportExportXml><SolutionManifest><Managed>${managed}</Managed></SolutionManifest></ImportExportXml>`;
  const customizations = `<ImportExportXml><Entities><Entity><Name>account</Name><RibbonDiffXml><CustomActions><HideCustomAction HideActionId="abc.Save.Hide" Location="Mscrm.Form.account.Save" Sequence="900" /></CustomActions><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml></Entity></Entities></ImportExportXml>`;
  return zipSync({
    "solution.xml": strToU8(solution),
    "customizations.xml": strToU8(customizations)
  });
}

describe("solution ZIP builder", () => {
  it("adds generated hide actions while preserving existing ribbon actions", () => {
    const result = buildPatchedSolutionZip(solutionZip(), "account", ribbon);
    const files = unzipSync(result.bytes);
    const xml = strFromU8(files["customizations.xml"]);

    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
    expect(xml).toContain('Location="Mscrm.Form.account.Save"');
    expect(xml).toContain('Location="Mscrm.Form.account.Delete"');
  });

  it("does not duplicate an existing hide location", () => {
    const first = buildPatchedSolutionZip(solutionZip(), "account", ribbon);
    const second = buildPatchedSolutionZip(first.bytes, "account", ribbon);

    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("refuses to edit a managed package", () => {
    expect(() => buildPatchedSolutionZip(solutionZip("1"), "account", ribbon)).toThrow(
      "Managed packages cannot be edited"
    );
  });

  it("requires the target table to be present", () => {
    expect(() => buildPatchedSolutionZip(solutionZip(), "contact", ribbon)).toThrow(
      "does not contain the 'contact' table"
    );
  });
});
