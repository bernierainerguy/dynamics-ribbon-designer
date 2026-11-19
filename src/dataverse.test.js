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
  listPublishers,
  listTables,
  listUnmanagedSolutions,
  manifestWebResourceName,
  publishTable,
  retrieveEntityRibbonBySurface,
  retrieveEntityRibbonXml,
  retrieveImportJob,
  storeChangeManifest
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

  it("retrieves each ribbon surface separately and reports partial failures", async () => {
    const ribbon = (label) => new Response(
      JSON.stringify({ CompressedEntityXml: asBase64(zipSync({ "RibbonXml.xml": strToU8(`<Ribbon Id="${label}" />`) })) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    window = {
      location: { origin: "https://direct.crm.dynamics.com", pathname: "/WebResources/brg_/DynamicsRibbonDesigner/index.html" }
    };
    window.parent = window;
    fetch
      .mockResolvedValueOnce(ribbon("form"))
      .mockResolvedValueOnce(ribbon("grid"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Subgrid unavailable." } }), { status: 400, headers: { "Content-Type": "application/json" } }));

    const { sources, failures } = await retrieveEntityRibbonBySurface("account");
    expect(sources.map((source) => source.surface)).toEqual(["form", "grid"]);
    expect(failures).toEqual(["subgrid"]);
    expect(fetch.mock.calls[0][0]).toContain("RibbonLocationFilters'Form'");
    expect(fetch.mock.calls[1][0]).toContain("RibbonLocationFilters'HomepageGrid'");
    expect(fetch.mock.calls[2][0]).toContain("RibbonLocationFilters'SubGrid'");
  });

  it("returns the import job id so the result can be verified", async () => {
    fetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: "<importexportxml />", progress: 100 }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const importJobId = await importUnmanagedSolution(Uint8Array.from([1]));
    expect(JSON.parse(fetch.mock.calls[0][1].body).ImportJobId).toBe(importJobId);

    const job = await retrieveImportJob(importJobId);
    expect(fetch.mock.calls[1][0]).toContain(`importjobs(${importJobId})`);
    expect(job.data).toBe("<importexportxml />");
  });

  it("lists customisable tables and publishers for the pickers", async () => {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ value: [
      { LogicalName: "contact", DisplayName: { UserLocalizedLabel: { Label: "Contact" } } },
      { LogicalName: "account", DisplayName: { UserLocalizedLabel: { Label: "Account" } } }
    ] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const tables = await listTables();
    expect(tables.map((table) => table.logicalName)).toEqual(["account", "contact"]);
    expect(fetch.mock.calls[0][0]).toContain("IsCustomizable/Value eq true");

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ value: [
      { publisherid: "1", customizationprefix: "brg", friendlyname: "Bernier" },
      { publisherid: "2", customizationprefix: "", friendlyname: "No prefix" }
    ] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect((await listPublishers()).map((item) => item.customizationprefix)).toEqual(["brg"]);
  });

  it("stores the change manifest as a solution-owned web resource", async () => {
    expect(manifestWebResourceName("BRG", "New_Account")).toBe("brg_/ribbonmanifests/new_account.js");

    fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [{ webresourceid: "44444444-4444-4444-4444-444444444444" }] }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const name = await storeChangeManifest({
      solutionName: "brg_account_ribbon",
      publisherPrefix: "brg",
      tableName: "account",
      manifest: { tableLogicalName: "account" }
    });

    expect(name).toBe("brg_/ribbonmanifests/account.js");
    const created = JSON.parse(fetch.mock.calls[1][1].body);
    expect(created).toMatchObject({ name, webresourcetype: 3 });
    expect(JSON.parse(atob(created.content))).toEqual({ tableLogicalName: "account" });
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toMatchObject({
      ComponentType: 61,
      SolutionUniqueName: "brg_account_ribbon",
      AddRequiredComponents: false
    });
    expect(JSON.parse(fetch.mock.calls[4][1].body).ParameterXml).toContain("<webresource>44444444-4444-4444-4444-444444444444</webresource>");
  });
});
