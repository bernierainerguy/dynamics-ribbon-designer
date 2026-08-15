const SURFACES = {
  form: "Main form",
  grid: "Main grid",
  subgrid: "Subgrid",
  other: "Other"
};

export function inferSurface(id = "") {
  const value = id.toLowerCase();
  if (value.includes("homepagegrid")) return "grid";
  if (value.includes("subgrid")) return "subgrid";
  if (value.includes("form")) return "form";
  return "other";
}

export function surfaceLabel(surface) {
  return SURFACES[surface] ?? SURFACES.other;
}

function isResourceReference(value = "") {
  return value.startsWith("$Resources:");
}

function humanize(value = "") {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[._:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function friendlyResourceLabel(value = "") {
  const resource = value.replace(/^\$Resources:/, "");
  const leaf = resource.split(".").at(-1) || resource;
  const known = {
    StaticExcelExportAll: "Export all data to Excel",
    StaticExcelExport: "Export to Excel",
    DynamicExcelExport: "Export dynamic worksheet",
    DynamicPivotTable: "Export dynamic PivotTable",
    SaveAsComplete: "Save as complete",
    SaveAndClose: "Save and close",
    SaveAndNew: "Save and new"
  };
  return known[leaf] || humanize(leaf);
}

function resourceLabels(document) {
  const labels = new Map();
  for (const locLabel of document.getElementsByTagName("LocLabel")) {
    const id = locLabel.getAttribute("Id");
    const titles = [...locLabel.getElementsByTagName("Title")];
    const title = titles.find((item) => item.getAttribute("languagecode") === "1033") || titles[0];
    const description = title?.getAttribute("description")?.trim();
    if (id && description) labels.set(id, description);
  }
  return labels;
}

function resolveLabel(value, labels) {
  if (!value) return "";
  if (labels.has(value)) return labels.get(value);
  return isResourceReference(value) ? friendlyResourceLabel(value) : value;
}

export function parseRibbonXml(xml) {
  if (!xml?.trim()) throw new Error("The ribbon XML is empty.");
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  const parseError = document.getElementsByTagName("parsererror")[0];
  if (parseError) throw new Error("The file is not valid XML.");
  const labels = resourceLabels(document);

  return [...document.getElementsByTagName("Button")]
    .map((button) => {
      const ancestors = [];
      let node = button.parentElement || button.parentNode;
      while (node) {
        if (node.getAttribute?.("Id")) ancestors.push(node.getAttribute("Id"));
        node = node.parentElement;
      }
      const id = button.getAttribute("Id") || "";
      const context = [id, ...ancestors].join(" ");
      return {
        id,
        command: button.getAttribute("Command") || "",
        label: resolveLabel(
          button.getAttribute("LabelText") || button.getAttribute("Alt") || id.split(".").at(-1) || "Unnamed button",
          labels
        ),
        description: (() => {
          const tooltip = button.getAttribute("ToolTipDescription") || button.getAttribute("ToolTipTitle") || "";
          return isResourceReference(tooltip) ? "" : resolveLabel(tooltip, labels);
        })(),
        surface: inferSurface(context)
      };
    })
    .filter((button) => button.id);
}

export function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function safeId(value = "") {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}

export function generateRibbonDiffXml(buttons, publisherPrefix = "brg") {
  const prefix = safeId(publisherPrefix.trim() || "brg");
  const unique = [...new Map(buttons.map((button) => [button.id, button])).values()];
  const actions = unique
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (button, index) =>
        `    <HideCustomAction HideActionId="${prefix}.${safeId(button.id)}.Hide" Location="${escapeXml(button.id)}" Sequence="${1000 + index}" />`
    )
    .join("\n");

  return `<RibbonDiffXml>
  <CustomActions>${actions ? `\n${actions}\n  ` : ""}</CustomActions>
  <Templates>
    <RibbonTemplates Id="Mscrm.Templates" />
  </Templates>
  <CommandDefinitions />
  <RuleDefinitions>
    <TabDisplayRules />
    <DisplayRules />
    <EnableRules />
  </RuleDefinitions>
  <LocLabels />
</RibbonDiffXml>`;
}
