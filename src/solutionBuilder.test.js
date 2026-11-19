import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPatchedSolutionZip, buildRollbackSolutionZip, parseChangeManifest } from "./solutionBuilder";
import { createChangeManifest } from "./changeManifest";

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

  it("builds a rollback package that removes only manifest-owned hide actions", () => {
    const patched = buildPatchedSolutionZip(solutionZip(), "account", ribbon);
    const rollback = buildRollbackSolutionZip(patched.bytes, {
      tableLogicalName: "account",
      ribbonDiffXml: ribbon
    });
    const files = unzipSync(rollback.bytes);
    const xml = strFromU8(files["customizations.xml"]);

    expect(rollback.removed).toBe(1);
    expect(xml).toContain('Location="Mscrm.Form.account.Save"');
    expect(xml).not.toContain('Location="Mscrm.Form.account.Delete"');
  });

  it("round-trips a generated manifest into a rollback of exactly its own actions", () => {
    const patched = buildPatchedSolutionZip(solutionZip(), "account", ribbon);
    const manifestJson = JSON.stringify(createChangeManifest({
      tableName: "account",
      publisherPrefix: "brg",
      solution: { uniquename: "brg_account_ribbon", friendlyname: "Account ribbon", version: "1.0.0.0" },
      buttons: [{ label: "Delete", id: "Mscrm.Form.account.Delete", command: "Mscrm.Delete", surface: "form" }],
      ribbonDiffXml: ribbon
    }));

    const rollback = buildRollbackSolutionZip(patched.bytes, parseChangeManifest(manifestJson));
    const xml = strFromU8(unzipSync(rollback.bytes)["customizations.xml"]);

    expect(rollback.removed).toBe(1);
    expect(rollback.tableName).toBe("account");
    expect(xml).not.toContain('Location="Mscrm.Form.account.Delete"');
    expect(xml).toContain('Location="Mscrm.Form.account.Save"');
  });

  it("refuses a rollback whose manifest targets a different table", () => {
    const patched = buildPatchedSolutionZip(solutionZip(), "account", ribbon);
    expect(() => buildRollbackSolutionZip(patched.bytes, { tableLogicalName: "contact", ribbonDiffXml: ribbon })).toThrow(
      "does not contain the 'contact' table from the manifest"
    );
  });

  it("refuses a rollback when none of the manifest actions are present", () => {
    const otherRibbon = ribbon.replace("brg.Mscrm.Form.account.Delete.Hide", "brg.Mscrm.Form.account.Unrelated.Hide");
    expect(() => buildRollbackSolutionZip(solutionZip(), { tableLogicalName: "account", ribbonDiffXml: otherRibbon })).toThrow(
      "None of this manifest's hide actions were found"
    );
  });
});
