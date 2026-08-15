import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

function parseXml(xml, label) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error(`${label} is not valid XML.`);
  }
  return document;
}

function elementChildren(node) {
  return [...node.childNodes].filter((child) => child.nodeType === 1);
}

function directChild(node, name) {
  return elementChildren(node).find((child) => child.localName === name || child.nodeName === name);
}

function descendants(node, name) {
  return [...node.getElementsByTagName("*")].filter(
    (child) => child.localName === name || child.nodeName === name
  );
}

function findEntry(files, expectedName) {
  const expected = expectedName.toLowerCase();
  return Object.keys(files).find((name) => name.toLowerCase().replace(/^\/+/, "") === expected);
}

function findTableEntity(document, logicalName) {
  const expected = logicalName.trim().toLowerCase();
  return [...document.getElementsByTagName("Entity")].find((entity) => {
    const directName = directChild(entity, "Name")?.textContent?.trim().toLowerCase();
    const metadataName = descendants(entity, "entity")
      .map((item) => item.getAttribute("Name")?.trim().toLowerCase())
      .find(Boolean);
    return directName === expected || metadataName === expected;
  });
}

export function patchCustomizationsXml(customizationsXml, tableName, ribbonDiffXml) {
  const customizations = parseXml(customizationsXml, "customizations.xml");
  const generated = parseXml(ribbonDiffXml, "Generated RibbonDiffXml");
  const entity = findTableEntity(customizations, tableName);
  if (!entity) {
    throw new Error(`The uploaded solution does not contain the '${tableName}' table.`);
  }

  const generatedRibbon = generated.documentElement;
  const generatedActions = descendants(generatedRibbon, "HideCustomAction");
  if (!generatedActions.length) {
    throw new Error("Select at least one command to hide before building a solution.");
  }

  let targetRibbon = directChild(entity, "RibbonDiffXml");
  if (!targetRibbon || !elementChildren(targetRibbon).length) {
    const replacement = customizations.importNode(generatedRibbon, true);
    if (targetRibbon) entity.replaceChild(replacement, targetRibbon);
    else entity.appendChild(replacement);
    return {
      xml: new XMLSerializer().serializeToString(customizations),
      added: generatedActions.length,
      skipped: 0
    };
  }

  let customActions = directChild(targetRibbon, "CustomActions");
  if (!customActions) {
    customActions = customizations.createElement("CustomActions");
    targetRibbon.insertBefore(customActions, targetRibbon.firstChild);
  }

  const existing = descendants(customActions, "HideCustomAction");
  let added = 0;
  let skipped = 0;
  for (const action of generatedActions) {
    const id = action.getAttribute("HideActionId");
    const location = action.getAttribute("Location");
    const duplicate = existing.some(
      (item) => item.getAttribute("HideActionId") === id || item.getAttribute("Location") === location
    );
    if (duplicate) {
      skipped += 1;
      continue;
    }
    const imported = customizations.importNode(action, true);
    customActions.appendChild(imported);
    existing.push(imported);
    added += 1;
  }

  return {
    xml: new XMLSerializer().serializeToString(customizations),
    added,
    skipped
  };
}

export function buildPatchedSolutionZip(solutionBytes, tableName, ribbonDiffXml) {
  if (!tableName?.trim()) throw new Error("Enter the table logical name first.");

  let files;
  try {
    files = unzipSync(solutionBytes);
  } catch {
    throw new Error("The selected file is not a valid solution ZIP.");
  }

  const solutionKey = findEntry(files, "solution.xml");
  const customizationsKey = findEntry(files, "customizations.xml");
  if (!solutionKey || !customizationsKey) {
    throw new Error("The ZIP does not contain solution.xml and customizations.xml.");
  }

  const solution = parseXml(strFromU8(files[solutionKey]), "solution.xml");
  const managed = [...solution.getElementsByTagName("Managed")][0]?.textContent?.trim();
  if (managed !== "0") {
    throw new Error("Upload an unmanaged solution ZIP. Managed packages cannot be edited.");
  }

  const patched = patchCustomizationsXml(
    strFromU8(files[customizationsKey]),
    tableName.trim(),
    ribbonDiffXml
  );
  files[customizationsKey] = strToU8(patched.xml);

  return {
    bytes: zipSync(files, { level: 6 }),
    added: patched.added,
    skipped: patched.skipped
  };
}
