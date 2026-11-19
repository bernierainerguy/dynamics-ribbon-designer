const MAX_REPORTED_ERRORS = 5;

function elementsWithResult(document) {
  return [...document.getElementsByTagName("*")].filter((node) => node.getAttribute?.("result"));
}

function componentName(node) {
  return (
    node.getAttribute("LocalizedName") ||
    node.getAttribute("name") ||
    node.parentNode?.getAttribute?.("LocalizedName") ||
    node.parentNode?.getAttribute?.("name") ||
    node.parentNode?.nodeName ||
    node.nodeName
  );
}

/**
 * Reads the `data` XML of a Dataverse import job and reports any component failures.
 * An unreadable or empty payload is reported as `parsed: false` so callers can say the
 * import result could not be verified rather than claiming success.
 */
export function summarizeImportJob(dataXml) {
  if (!dataXml?.trim()) return { parsed: false, succeeded: false, errors: [] };

  let document;
  try {
    document = new DOMParser().parseFromString(dataXml, "application/xml");
  } catch {
    return { parsed: false, succeeded: false, errors: [] };
  }
  if (document.getElementsByTagName("parsererror").length) {
    return { parsed: false, succeeded: false, errors: [] };
  }

  const seen = new Set();
  const errors = [];
  for (const node of elementsWithResult(document)) {
    if (node.getAttribute("result").toLowerCase() !== "failure") continue;
    const text = (node.getAttribute("errortext") || "").trim();
    const code = (node.getAttribute("errorcode") || "").trim();
    const entry = {
      component: componentName(node),
      text: text || (code ? `Error code ${code}` : "Dataverse reported a failure without detail.")
    };
    const key = `${entry.component}|${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push(entry);
  }

  return {
    parsed: true,
    succeeded: errors.length === 0,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    truncated: Math.max(0, errors.length - MAX_REPORTED_ERRORS)
  };
}

export function describeImportJob(summary) {
  if (!summary.parsed) return "The import job result could not be read; verify the solution in Dataverse.";
  if (summary.succeeded) return "";
  const detail = summary.errors.map((error) => `${error.component}: ${error.text}`).join(" | ");
  const more = summary.truncated ? ` (+${summary.truncated} more)` : "";
  return `The import job reported ${summary.errors.length + (summary.truncated || 0)} failure(s): ${detail}${more}`;
}
