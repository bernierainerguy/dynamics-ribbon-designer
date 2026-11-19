export function createChangeManifest({
  tableName,
  publisherPrefix,
  solution,
  buttons,
  ribbonDiffXml,
  generatedAt = new Date().toISOString()
}) {
  return {
    schemaVersion: "1.0",
    generatedAt,
    tableLogicalName: tableName.trim(),
    publisherPrefix: publisherPrefix.trim(),
    solution: solution
      ? {
          uniqueName: solution.uniquename,
          displayName: solution.friendlyname,
          version: solution.version
        }
      : null,
    hiddenCommands: buttons.map((button) => ({
      label: button.label,
      id: button.id,
      command: button.command,
      surface: button.surface
    })),
    ribbonDiffXml
  };
}

export function manifestFilename(tableName = "table") {
  const safeTableName = tableName.trim().replace(/[^A-Za-z0-9_.-]/g, "_") || "table";
  return `${safeTableName}-ribbon-change-manifest.json`;
}
