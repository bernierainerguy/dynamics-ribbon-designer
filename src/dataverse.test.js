import { beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  addTableToSolution,
  asBase64,
  asBytes,
  clientUrl,
  createUnmanagedSolution,
  getXrm,
  importUnmanagedSolution,
  isDataverseHost,
  listUnmanagedSolutions,
  publishTable,
  retrieveEntityRibbonXml
} from "./dataverse";

beforeEach(() => {
  globalThis.window = {
    Xrm: {
      Utility: {
        getGlobalContext: () => ({ getClientUrl: () => "https://example.crm.dynamics.com" })
      }
    },
    location: { origin: "https://example.crm.dynamics.com", pathname: "/main.aspx" }
  };
  window.parent = window;
  globalThis.fetch = vi.fn();
});

describe("Dataverse solution operations", () => {
  it("round-trips solution bytes through base64", () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 254, 255]);
    expect(asBytes(asBase64(bytes))).toEqual(bytes);
  });

  it("finds Xrm through multiple same-origin parent frames", () => {
    const topFrame = { Xrm: window.Xrm };
    topFrame.parent = topFrame;
    const middleFrame = { parent: topFrame };
    window = {
      parent: middleFrame,
      location: { origin: "https://example.crm.dynamics.com", pathname: "/WebResources/designer/index.html" }
    };

    expect(getXrm()).toBe(topFrame.Xrm);
    expect(clientUrl()).toBe("https://example.crm.dynamics.com");
    expect(isDataverseHost()).toBe(true);
  });

  it("recognizes a directly opened Dataverse web resource without Xrm", async () => {
    window = {
      location: { origin: "https://direct.crm.dynamics.com", pathname: "/WebResources/brg_/DynamicsRibbonDesigner/index.html" }
    };
    window.parent = window;
    fetch.mockResolvedValue(new Response(JSON.stringify({ value: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    expect(isDataverseHost()).toBe(true);
    await listUnmanagedSolutions();
    expect(fetch.mock.calls[0][0]).toContain("https://direct.crm.dynamics.com/api/data/v9.2/solutions");
  });

  it("retrieves ribbon XML through the Web API when Xrm.execute is unavailable", async () => {
    window = {
      location: { origin: "https://direct.crm.dynamics.com", pathname: "/WebResources/brg_/DynamicsRibbonDesigner/index.html" }
    };
    window.parent = window;
    const compressed = asBase64(zipSync({ "RibbonXml.xml": strToU8("<Ribbon />") }));
    fetch.mockResolvedValue(new Response(JSON.stringify({ CompressedEntityXml: compressed }), { status: 200, headers: { "Content-Type": "application/json" } }));

    expect(await retrieveEntityRibbonXml("account", 7)).toBe("<Ribbon />");
    expect(fetch.mock.calls[0][0]).toContain("RetrieveEntityRibbon(EntityName='account'");
    expect(fetch.mock.calls[0][0]).toContain("RibbonLocationFilters'All'");
  });

  it("lists visible unmanaged solutions while excluding system and designer solutions", async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ value: [
      { solutionid: "1", uniquename: "Default", friendlyname: "Default" },
      { solutionid: "2", uniquename: "DynamicsRibbonDesigner", friendlyname: "Designer" },
      { solutionid: "3", uniquename: "RibbonChanges", friendlyname: "Ribbon Changes", version: "1.0.0.0" }
    ] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const solutions = await listUnmanagedSolutions();
    expect(solutions.map((item) => item.uniquename)).toEqual(["RibbonChanges"]);
    expect(fetch.mock.calls[0][0]).toContain("ismanaged eq false");
  });

  it("creates an empty unmanaged solution with the publisher matching the chosen prefix", async () => {
    fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [
      ] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [
        { publisherid: "22222222-2222-2222-2222-222222222222", customizationprefix: "brg" }
      ] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const created = await createUnmanagedSolution({
      uniqueName: "brg_account_ribbon_customisation",
      displayName: "Account ribbon customisation",
      publisherPrefix: "brg"
    });

    expect(fetch.mock.calls[0][0]).toContain("solutions?");
    expect(fetch.mock.calls[1][0]).toContain("publishers?");
    expect(fetch.mock.calls[1][0]).toContain("customizationprefix eq 'brg'");
    const request = JSON.parse(fetch.mock.calls[2][1].body);
    expect(request).toMatchObject({
      uniquename: "brg_account_ribbon_customisation",
      friendlyname: "Account ribbon customisation",
      version: "1.0.0.0",
      "publisherid@odata.bind": "/publishers(22222222-2222-2222-2222-222222222222)"
    });
    expect(created.uniquename).toBe("brg_account_ribbon_customisation");
    expect(created.alreadyExists).toBe(false);
  });

  it("reuses an existing unmanaged solution instead of creating a duplicate", async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ value: [
      { solutionid: "33333333-3333-3333-3333-333333333333", uniquename: "brg_account_ribbon_customisation", friendlyname: "Account ribbon customisation", version: "1.0.0.0", ismanaged: false }
    ] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const solution = await createUnmanagedSolution({
      uniqueName: "brg_account_ribbon_customisation",
      displayName: "Account ribbon customisation",
      publisherPrefix: "brg"
    });

    expect(solution.alreadyExists).toBe(true);
    expect(solution.solutionid).toBe("33333333-3333-3333-3333-333333333333");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("adds only a table root component without assets", async () => {
    fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ MetadataId: "11111111-1111-1111-1111-111111111111" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await addTableToSolution("RibbonChanges", "account");
    const request = JSON.parse(fetch.mock.calls[1][1].body);
    expect(request).toMatchObject({
      ComponentType: 1,
      SolutionUniqueName: "RibbonChanges",
      AddRequiredComponents: false,
      DoNotIncludeSubcomponents: true
    });
  });

  it("imports synchronously and publishes only the selected table", async () => {
    fetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await importUnmanagedSolution(Uint8Array.from([1, 2, 3]));
    await publishTable("account");

    const importBody = JSON.parse(fetch.mock.calls[0][1].body);
    const publishBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(importBody.CustomizationFile).toBe("AQID");
    expect(importBody.OverwriteUnmanagedCustomizations).toBe(false);
    expect(publishBody.ParameterXml).toBe("<importexportxml><entities><entity>account</entity></entities></importexportxml>");
  });
});
