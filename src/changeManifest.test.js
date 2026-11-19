import { describe, expect, it } from "vitest";
import { createChangeManifest, manifestFilename } from "./changeManifest";

describe("change manifest", () => {
  it("records the selected solution and commands without hidden UI state", () => {
    const manifest = createChangeManifest({
      tableName: " account ",
      publisherPrefix: " brg ",
      solution: { uniquename: "brg_account_ribbon", friendlyname: "Account ribbon", version: "1.0.0.0" },
      buttons: [{ label: "Delete", id: "Mscrm.Form.account.Delete", command: "Mscrm.Delete", surface: "form" }],
      ribbonDiffXml: "<RibbonDiffXml />",
      generatedAt: "2026-08-15T12:00:00.000Z"
    });

    expect(manifest).toMatchObject({
      tableLogicalName: "account",
      publisherPrefix: "brg",
      solution: { uniqueName: "brg_account_ribbon", displayName: "Account ribbon" },
      hiddenCommands: [{ label: "Delete", surface: "form" }]
    });
  });

  it("uses a safe, predictable filename", () => {
    expect(manifestFilename("new account/2026")).toBe("new_account_2026-ribbon-change-manifest.json");
  });
});
