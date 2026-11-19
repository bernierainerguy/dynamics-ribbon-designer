const SURFACES = {
  form: "Main form",
  grid: "Main grid",
  subgrid: "Subgrid",
  other: "Other"
};

const SURFACE_ORDER = ["form", "grid", "subgrid", "other"];

const CONTROL_ELEMENTS = ["Button", "ToggleButton", "SplitButton", "FlyoutAnchor", "CheckBox"];

const CONTROL_TYPE_LABELS = {
  Button: "Button",
  ToggleButton: "Toggle",
  SplitButton: "Split button",
  FlyoutAnchor: "Flyout",
  CheckBox: "Check box"
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

export function surfaceSummary(surfaces = []) {
  const list = surfaces.length ? surfaces : ["other"];
  return list.map(surfaceLabel).join(" · ");
}

export function controlTypeLabel(type = "Button") {
  return CONTROL_TYPE_LABELS[type] ?? type;
}

export function compatibilityWarning({ surface, surfaces, command }) {
  const list = surfaces?.length ? surfaces : [surface];
  if (list.every((item) => !item || item === "other")) {
    return "Outside the supported form, main-grid and subgrid surfaces; verify in a test environment.";
  }
  if (!command) return "Dataverse did not expose a command mapping; verify this control in a test environment.";
  return "";
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

function parseDocument(xml) {
  if (!xml?.trim()) throw new Error("The ribbon XML is empty.");
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror")[0]) throw new Error("The file is not valid XML.");
  return document;
}

function controlElements(document) {
  return CONTROL_ELEMENTS.flatMap((name) => [...document.getElementsByTagName(name)]);
}

function readControls(xml, forcedSurface) {
  const document = parseDocument(xml);
  const labels = resourceLabels(document);

  return controlElements(document)
    .map((control) => {
      const ancestors = [];
      let node = control.parentElement || control.parentNode;
      while (node) {
        if (node.getAttribute?.("Id")) ancestors.push(node.getAttribute("Id"));
        node = node.parentElement;
      }
      const id = control.getAttribute("Id") || "";
      const context = [id, ...ancestors].join(" ");
      const command = control.getAttribute("Command") || "";
      const tooltip = control.getAttribute("ToolTipDescription") || control.getAttribute("ToolTipTitle") || "";
      return {
        id,
        command,
        type: control.localName || control.nodeName,
        label: resolveLabel(
          control.getAttribute("LabelText") || control.getAttribute("Alt") || id.split(".").at(-1) || "Unnamed control",
          labels
        ),
        description: isResourceReference(tooltip) ? "" : resolveLabel(tooltip, labels),
        surfaces: [forcedSurface || inferSurface(context)]
      };
    })
    .filter((control) => control.id);
}

function mergeControls(controls) {
  const merged = new Map();
  for (const control of controls) {
    const existing = merged.get(control.id);
    if (!existing) {
      merged.set(control.id, { ...control, surfaces: [...control.surfaces] });
      continue;
    }
    for (const surface of control.surfaces) {
      if (!existing.surfaces.includes(surface)) existing.surfaces.push(surface);
    }
    if (!existing.command) existing.command = control.command;
    if (!existing.description) existing.description = control.description;
  }

  return [...merged.values()].map((control) => {
    const surfaces = [...control.surfaces].sort(
      (left, right) => SURFACE_ORDER.indexOf(left) - SURFACE_ORDER.indexOf(right)
    );
    return {
      ...control,
      surfaces,
      surface: surfaces[0],
      compatibilityWarning: compatibilityWarning({ surfaces, command: control.command })
    };
  });
}

export function parseRibbonXml(xml, { surface } = {}) {
  return mergeControls(readControls(xml, surface));
}

export function parseRibbonSurfaces(sources) {
  const controls = sources.flatMap(({ surface, xml }) => readControls(xml, surface));
  if (!controls.length && !sources.length) throw new Error("The ribbon XML is empty.");
  return mergeControls(controls);
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
