import { unzipSync } from "fflate";

function frameChain() {
  const frames = [];
  let frame = window;
  for (let depth = 0; depth < 10 && frame; depth += 1) {
    frames.push(frame);
    try {
      if (!frame.parent || frame.parent === frame) break;
      frame = frame.parent;
    } catch {
      break;
    }
  }
  return frames;
}

export function getXrm() {
  for (const frame of frameChain()) {
    try {
      if (frame.Xrm) return frame.Xrm;
    } catch {
      // A cross-origin parent cannot be inspected; continue with same-origin fallbacks.
    }
  }
  return null;
}

function globalContext() {
  const xrmContext = getXrm()?.Utility?.getGlobalContext?.();
  if (xrmContext) return xrmContext;
  for (const frame of frameChain()) {
    try {
      const context = frame.GetGlobalContext?.();
      if (context) return context;
    } catch {
      // Ignore inaccessible parent frames.
    }
  }
  return null;
}

export function asBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function asBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function clientUrl() {
  const contextUrl = globalContext()?.getClientUrl?.();
  const locationUrl = window.location?.pathname?.toLowerCase().includes("/webresources/")
    ? window.location.origin
    : null;
  const url = contextUrl || locationUrl;
  if (!url) throw new Error("Open this page as a Dataverse web resource to edit solutions.");
  return url.replace(/\/$/, "");
}

async function webApi(path, options = {}) {
  const response = await fetch(`${clientUrl()}/api/data/v9.2/${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `Dataverse request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

function unzipRibbon(base64) {
  const files = unzipSync(asBytes(base64));
  const entry = Object.entries(files).find(([name]) => name.toLowerCase().endsWith("ribbonxml.xml"));
  if (!entry) throw new Error("Dataverse returned a ribbon package without RibbonXml.xml.");
  return new TextDecoder().decode(entry[1]);
}

export function isDataverseHost() {
  try {
    return Boolean(clientUrl());
  } catch {
    return false;
  }
}

export async function retrieveEntityRibbonXml(entityName, location = 7) {
  const xrm = getXrm();
  let body;
  if (xrm?.WebApi?.online?.execute) {
    const request = {
      EntityName: entityName,
      RibbonLocationFilter: location,
      getMetadata() {
        return {
          boundParameter: null,
          operationName: "RetrieveEntityRibbon",
          operationType: 1,
          parameterTypes: {
            EntityName: { typeName: "Edm.String", structuralProperty: 1 },
            RibbonLocationFilter: {
              typeName: "Microsoft.Dynamics.CRM.RibbonLocationFilters",
              structuralProperty: 3,
              enumProperties: [
                { name: "Form", value: 1 },
                { name: "HomepageGrid", value: 2 },
                { name: "SubGrid", value: 4 },
                { name: "All", value: 7 }
              ]
            }
          }
        };
      }
    };
    const response = await xrm.WebApi.online.execute(request);
    if (!response.ok) throw new Error(`Dataverse ribbon request failed (${response.status}).`);
    body = await response.json();
  } else {
    const filterNames = { 1: "Form", 2: "HomepageGrid", 4: "SubGrid", 7: "All" };
    const filter = filterNames[location] ?? "All";
    const safeEntityName = entityName.replaceAll("'", "''");
    body = await webApi(
      `RetrieveEntityRibbon(EntityName='${safeEntityName}',RibbonLocationFilter=Microsoft.Dynamics.CRM.RibbonLocationFilters'${filter}')`
    );
  }
  const compressed = body.CompressedEntityXml ?? body.compressedEntityXml;
  if (!compressed) throw new Error("Dataverse returned no compressed ribbon definition.");
  return unzipRibbon(compressed);
}

export async function listUnmanagedSolutions() {
  const query = "solutions?$select=solutionid,uniquename,friendlyname,version&$filter=ismanaged eq false and isvisible eq true&$orderby=friendlyname asc";
  const body = await webApi(query);
  const excluded = new Set(["Default", "Active", "Basic", "System"]);
  return (body?.value ?? []).filter(
    (solution) => !excluded.has(solution.uniquename) && solution.uniquename !== "DynamicsRibbonDesigner"
  );
}

export async function createUnmanagedSolution({ uniqueName, displayName, publisherPrefix, version = "1.0.0.0" }) {
  const escapedName = uniqueName.replaceAll("'", "''");
  const existingBody = await webApi(
    `solutions?$select=solutionid,uniquename,friendlyname,version,ismanaged&$filter=uniquename eq '${escapedName}'&$top=1`
  );
  const existing = existingBody?.value?.[0];
  if (existing) {
    if (existing.ismanaged) {
      throw new Error(`A managed solution already uses the name '${uniqueName}'. Choose a different name.`);
    }
    return { ...existing, alreadyExists: true };
  }

  const safePrefix = publisherPrefix.replaceAll("'", "''");
  const publishers = await webApi(
    `publishers?$select=publisherid,uniquename,friendlyname,customizationprefix&$filter=customizationprefix eq '${safePrefix}'`
  );
  const publisher = (publishers?.value ?? [])[0];
  if (!publisher?.publisherid) {
    throw new Error(`No publisher with prefix '${publisherPrefix}' was found. Create or choose a publisher with that prefix first.`);
  }
  await webApi("solutions", {
    method: "POST",
    body: JSON.stringify({
      uniquename: uniqueName,
      friendlyname: displayName,
      version,
      "publisherid@odata.bind": `/publishers(${publisher.publisherid})`
    })
  });
  return {
    solutionid: uniqueName,
    uniquename: uniqueName,
    friendlyname: displayName,
    version,
    alreadyExists: false
  };
}

export async function exportUnmanagedSolution(solutionName) {
  const body = await webApi("ExportSolution", {
    method: "POST",
    body: JSON.stringify({ SolutionName: solutionName, Managed: false })
  });
  if (!body?.ExportSolutionFile) throw new Error("Dataverse returned no solution file.");
  return asBytes(body.ExportSolutionFile);
}

export async function addTableToSolution(solutionName, logicalName) {
  const escapedName = logicalName.replaceAll("'", "''");
  const metadata = await webApi(`EntityDefinitions(LogicalName='${escapedName}')?$select=MetadataId`);
  if (!metadata?.MetadataId) throw new Error(`Table '${logicalName}' was not found.`);
  await webApi("AddSolutionComponent", {
    method: "POST",
    body: JSON.stringify({
      ComponentId: metadata.MetadataId,
      ComponentType: 1,
      SolutionUniqueName: solutionName,
      AddRequiredComponents: false,
      DoNotIncludeSubcomponents: true,
      IncludedComponentSettingsValues: []
    })
  });
}

export async function importUnmanagedSolution(bytes) {
  const importJobId = crypto.randomUUID();
  await webApi("ImportSolution", {
    method: "POST",
    body: JSON.stringify({
      OverwriteUnmanagedCustomizations: false,
      PublishWorkflows: false,
      CustomizationFile: asBase64(bytes),
      ImportJobId: importJobId
    })
  });
  return importJobId;
}

export async function retrieveImportJob(importJobId) {
  const body = await webApi(`importjobs(${importJobId})?$select=data,progress,completedon`);
  return {
    data: body?.data ?? "",
    progress: body?.progress ?? null,
    completedOn: body?.completedon ?? null
  };
}

export async function publishTable(logicalName) {
  const safeName = logicalName.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  await webApi("PublishXml", {
    method: "POST",
    body: JSON.stringify({
      ParameterXml: `<importexportxml><entities><entity>${safeName}</entity></entities></importexportxml>`
    })
  });
}

const RIBBON_SURFACE_LOCATIONS = [
  [1, "form"],
  [2, "grid"],
  [4, "subgrid"]
];

/**
 * Retrieves the ribbon once per location filter so each control's surface comes from
 * Dataverse rather than from pattern matching on the control ID.
 */
export async function retrieveEntityRibbonBySurface(entityName) {
  const results = await Promise.allSettled(
    RIBBON_SURFACE_LOCATIONS.map(([location]) => retrieveEntityRibbonXml(entityName, location))
  );
  const sources = [];
  const failures = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") sources.push({ surface: RIBBON_SURFACE_LOCATIONS[index][1], xml: result.value });
    else failures.push(RIBBON_SURFACE_LOCATIONS[index][1]);
  });
  if (!sources.length) {
    const reason = results.find((result) => result.status === "rejected")?.reason;
    throw reason instanceof Error ? reason : new Error("Dataverse returned no ribbon definitions.");
  }
  return { sources, failures };
}

export async function listTables() {
  const body = await webApi(
    "EntityDefinitions?$select=LogicalName,DisplayName&$filter=IsCustomizable/Value eq true"
  );
  return (body?.value ?? [])
    .map((table) => ({
      logicalName: table.LogicalName,
      displayName: table.DisplayName?.UserLocalizedLabel?.Label || table.LogicalName
    }))
    .filter((table) => table.logicalName)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function listPublishers() {
  const body = await webApi(
    "publishers?$select=publisherid,uniquename,friendlyname,customizationprefix&$orderby=friendlyname asc"
  );
  return (body?.value ?? []).filter((publisher) => publisher.customizationprefix);
}

/**
 * Dataverse validates a web resource extension against its type, and JSON is not one of the
 * supported types, so the manifest is stored as a `.js` JScript resource holding JSON text.
 * Nothing loads it as a script; it is read back and parsed by this designer only.
 */
export function manifestWebResourceName(publisherPrefix, tableName) {
  const prefix = publisherPrefix.trim().toLowerCase().replace(/[^a-z0-9]/g, "") || "brg";
  const table = tableName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_") || "table";
  return `${prefix}_/ribbonmanifests/${table}.js`;
}

async function findWebResourceId(name) {
  const escapedName = name.replaceAll("'", "''");
  const body = await webApi(`webresourceset?$select=webresourceid&$filter=name eq '${escapedName}'&$top=1`);
  return body?.value?.[0]?.webresourceid ?? null;
}

/**
 * Stores the change manifest in the customisation solution itself so a later rollback does
 * not depend on the operator still holding the downloaded JSON file.
 */
export async function storeChangeManifest({ solutionName, publisherPrefix, tableName, manifest }) {
  const name = manifestWebResourceName(publisherPrefix, tableName);
  const content = asBase64(new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  const existingId = await findWebResourceId(name);

  if (existingId) {
    await webApi(`webresourceset(${existingId})`, { method: "PATCH", body: JSON.stringify({ content }) });
  } else {
    await webApi("webresourceset", {
      method: "POST",
      body: JSON.stringify({
        name,
        displayname: `Ribbon change manifest - ${tableName.trim()}`,
        description: "Change manifest written by Dynamics Ribbon Designer. Used to roll back its hide actions.",
        webresourcetype: 3,
        content
      })
    });
  }

  const webResourceId = existingId || (await findWebResourceId(name));
  if (!webResourceId) throw new Error("The manifest web resource could not be located after saving.");

  await webApi("AddSolutionComponent", {
    method: "POST",
    body: JSON.stringify({
      ComponentId: webResourceId,
      ComponentType: 61,
      SolutionUniqueName: solutionName,
      AddRequiredComponents: false
    })
  });
  await webApi("PublishXml", {
    method: "POST",
    body: JSON.stringify({
      ParameterXml: `<importexportxml><webresources><webresource>${webResourceId}</webresource></webresources></importexportxml>`
    })
  });
  return name;
}

export async function retrieveStoredChangeManifest(publisherPrefix, tableName) {
  const name = manifestWebResourceName(publisherPrefix, tableName);
  const escapedName = name.replaceAll("'", "''");
  const body = await webApi(`webresourceset?$select=content&$filter=name eq '${escapedName}'&$top=1`);
  const content = body?.value?.[0]?.content;
  if (!content) return null;
  return new TextDecoder().decode(asBytes(content));
}
