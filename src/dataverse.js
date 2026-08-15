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
  await webApi("ImportSolution", {
    method: "POST",
    body: JSON.stringify({
      OverwriteUnmanagedCustomizations: false,
      PublishWorkflows: false,
      CustomizationFile: asBase64(bytes),
      ImportJobId: crypto.randomUUID()
    })
  });
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
