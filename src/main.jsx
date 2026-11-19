import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  controlTypeLabel,
  generateRibbonDiffXml,
  parseRibbonSurfaces,
  parseRibbonXml,
  surfaceLabel,
  surfaceSummary
} from "./ribbon";
import { sampleRibbonXml } from "./sampleRibbon";
import {
  addTableToSolution,
  createUnmanagedSolution,
  exportUnmanagedSolution,
  importUnmanagedSolution,
  isDataverseHost,
  listPublishers,
  listTables,
  listUnmanagedSolutions,
  publishTable,
  retrieveEntityRibbonBySurface,
  retrieveImportJob,
  retrieveStoredChangeManifest,
  storeChangeManifest
} from "./dataverse";
import { buildPatchedSolutionZip, buildRollbackSolutionZip, parseChangeManifest } from "./solutionBuilder";
import { createChangeManifest, manifestFilename } from "./changeManifest";
import { describeImportJob, summarizeImportJob } from "./importJob";
import { loadSession, saveSession } from "./persistence";
import "./styles.css";

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const MAX_SOLUTION_UNIQUE_NAME_LENGTH = 65;
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

function solutionUniqueName(displayName, prefix) {
  const normalized = displayName
    .trim()
    .replace(/^Dynamics Ribbon Designer\s*-\s*/i, "DRD ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safePrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!normalized) return "";
  return `${safePrefix || "solution"}_${normalized}`.replace(/^([0-9])/, "solution_$1");
}

const defaultSession = {
  tableName: "account",
  publisher: "brg",
  surface: "all",
  newSolutionName: "Dynamics Ribbon Designer - Account ribbon customisation"
};

function App() {
  const restored = useMemo(() => loadSession(defaultSession), []);
  const environmentLabel = isDataverseHost() ? window.location.hostname : "Local preview";
  const [tableName, setTableName] = useState(restored.tableName);
  const [publisher, setPublisher] = useState(restored.publisher);
  const [buttons, setButtons] = useState(() => parseRibbonXml(sampleRibbonXml));
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [surface, setSurface] = useState(restored.surface);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loaded the sample Account ribbon.");
  const [ribbonLoaded, setRibbonLoaded] = useState(false);
  const [applyComplete, setApplyComplete] = useState(false);
  const [newSolutionName, setNewSolutionName] = useState(restored.newSolutionName);
  const [solutions, setSolutions] = useState([]);
  const [selectedSolution, setSelectedSolution] = useState("");
  const [preparedSolution, setPreparedSolution] = useState(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [solutionBusy, setSolutionBusy] = useState(false);
  const [rollbackManifest, setRollbackManifest] = useState(null);
  const [preparedRollback, setPreparedRollback] = useState(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [tables, setTables] = useState([]);
  const [publishers, setPublishers] = useState([]);
  const fileRef = useRef(null);
  const solutionRef = useRef(null);
  const rollbackManifestRef = useRef(null);
  const rollbackSolutionRef = useRef(null);

  useEffect(() => {
    saveSession({ tableName, publisher, surface, newSolutionName });
  }, [tableName, publisher, surface, newSolutionName]);

  useEffect(() => {
    if (!isDataverseHost()) return;
    listTables().then(setTables).catch(() => setTables([]));
    listPublishers().then(setPublishers).catch(() => setPublishers([]));
  }, []);

  const compareButtons = (left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id);

  const visibleButtons = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return buttons.filter((button) => {
      const surfaceMatch = surface === "all" || button.surfaces.includes(surface);
      const textMatch =
        !needle ||
        [button.label, button.id, button.command].some((value) => value.toLowerCase().includes(needle));
      return surfaceMatch && textMatch;
    }).sort(compareButtons);
  }, [buttons, query, surface]);

  const hiddenButtons = buttons.filter((button) => hiddenIds.has(button.id)).sort(compareButtons);
  const output = generateRibbonDiffXml(hiddenButtons, publisher);
  const newSolutionUniqueName = solutionUniqueName(newSolutionName, publisher);
  const selectedSolutionDetails = solutions.find((solution) => solution.uniquename === selectedSolution) || null;
  const compatibilityWarnings = hiddenButtons.filter((button) => button.compatibilityWarning);
  const unselectedVisible = visibleButtons.filter((button) => !hiddenIds.has(button.id));
  const solutionNameError = !newSolutionName.trim() || !newSolutionUniqueName
    ? "Enter a name for the new customisation solution."
    : newSolutionUniqueName.length > MAX_SOLUTION_UNIQUE_NAME_LENGTH
      ? `The generated solution name is ${newSolutionUniqueName.length} characters; Dataverse allows a maximum of ${MAX_SOLUTION_UNIQUE_NAME_LENGTH}.`
      : "";
  const workflowStep = applyComplete
    ? 5
    : preparedSolution
      ? 5
      : hiddenButtons.length
        ? 4
        : selectedSolution
          ? 3
          : ribbonLoaded
            ? 2
            : 1;
  const workflowSteps = [
    { title: "Load ribbon", detail: "Enter the table logical name, then load from Dataverse or import XML." },
    { title: "Create solution", detail: "Create a new unmanaged customisation solution, or choose an existing one." },
    { title: "Make changes", detail: "Select the form, grid or subgrid controls that should be hidden." },
    { title: "Prepare", detail: "Export the solution, download its backup and review the patched preview." },
    { title: "Apply", detail: "Approve the guarded import and publish the selected table." }
  ];

  function invalidatePreparedWork() {
    setPreparedSolution(null);
    setConfirmApply(false);
    setPreparedRollback(null);
    setConfirmRollback(false);
    setApplyComplete(false);
  }

  function toggle(button) {
    invalidatePreparedWork();
    setHiddenIds((current) => {
      const next = new Set(current);
      next.has(button.id) ? next.delete(button.id) : next.add(button.id);
      return next;
    });
  }

  function selectAllVisible() {
    invalidatePreparedWork();
    setHiddenIds((current) => new Set([...current, ...visibleButtons.map((button) => button.id)]));
    setStatus(`Selected ${unselectedVisible.length} additional command(s) from the current view.`);
  }

  function clearSelection() {
    invalidatePreparedWork();
    setHiddenIds(new Set());
    setStatus("Cleared the selection.");
  }

  function resetSolutionContext() {
    setSolutions([]);
    setSelectedSolution("");
    setTableMissing(false);
    invalidatePreparedWork();
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const xml = await file.text();
      const parsed = parseRibbonXml(xml);
      setButtons(parsed);
      setHiddenIds(new Set());
      setRibbonLoaded(true);
      resetSolutionContext();
      setStatus(`Loaded ${parsed.length} controls from ${file.name}.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadFromDataverse() {
    if (!tableName.trim()) {
      setStatus("Enter a table logical name first.");
      return;
    }
    try {
      setStatus(`Loading the ${tableName} ribbon from Dataverse…`);
      const { sources, failures } = await retrieveEntityRibbonBySurface(tableName.trim());
      const parsed = parseRibbonSurfaces(sources);
      setButtons(parsed);
      setHiddenIds(new Set());
      setRibbonLoaded(true);
      resetSolutionContext();
      const skipped = failures.length ? ` The ${failures.join(" and ")} surface(s) could not be retrieved.` : "";
      setStatus(`Loaded ${parsed.length} effective controls across ${sources.length} surface(s).${skipped}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output);
      setStatus("RibbonDiffXml copied to the clipboard.");
    } catch {
      setStatus("Could not copy RibbonDiffXml. Select it below and copy it manually.");
    }
  }

  function downloadOutput() {
    const blob = new Blob([output], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${tableName || "table"}-RibbonDiffXml.xml`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Downloaded the RibbonDiffXml fragment.");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadBytes(bytes, filename) {
    downloadBlob(new Blob([bytes], { type: "application/zip" }), filename);
  }

  function currentManifest() {
    return createChangeManifest({
      tableName,
      publisherPrefix: publisher,
      solution: selectedSolutionDetails,
      buttons: hiddenButtons,
      ribbonDiffXml: output
    });
  }

  function downloadManifest() {
    downloadBlob(
      new Blob([JSON.stringify(currentManifest(), null, 2)], { type: "application/json" }),
      manifestFilename(tableName)
    );
    setStatus("Downloaded the ribbon change manifest.");
  }

  async function inspectImportJob(importJobId) {
    try {
      const job = await retrieveImportJob(importJobId);
      const summary = summarizeImportJob(job.data);
      return { failed: summary.parsed && !summary.succeeded, message: describeImportJob(summary) };
    } catch (error) {
      return { failed: false, message: `The import job result could not be read (${error.message}).` };
    }
  }

  async function buildSolution(file) {
    if (!file) return;
    if (file.size > MAX_PACKAGE_BYTES) {
      setStatus("The solution ZIP is larger than the 50 MB browser-processing limit.");
      return;
    }
    try {
      setStatus(`Patching ${file.name}…`);
      const result = buildPatchedSolutionZip(new Uint8Array(await file.arrayBuffer()), tableName, output);
      downloadBytes(result.bytes, `${file.name.replace(/\.zip$/i, "")}-ribbon-patched.zip`);
      const skipped = result.skipped ? ` ${result.skipped} existing action(s) were left unchanged.` : "";
      setStatus(`Built patched solution with ${result.added} new hide action(s).${skipped}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      if (solutionRef.current) solutionRef.current.value = "";
    }
  }

  function acceptRollbackManifest(json, source) {
    const manifest = parseChangeManifest(json);
    setRollbackManifest(manifest);
    setPreparedRollback(null);
    setConfirmRollback(false);
    setStatus(`Loaded rollback manifest for ${manifest.tableLogicalName} with ${manifest.hideActionIds.size} hide action(s) from ${source}.`);
  }

  async function loadRollbackManifest(file) {
    if (!file) return;
    try {
      acceptRollbackManifest(await file.text(), file.name);
    } catch (error) {
      setRollbackManifest(null);
      setStatus(error.message);
    } finally {
      if (rollbackManifestRef.current) rollbackManifestRef.current.value = "";
    }
  }

  async function loadStoredRollbackManifest() {
    try {
      setSolutionBusy(true);
      setStatus("Looking for a stored change manifest…");
      const stored = await retrieveStoredChangeManifest(publisher, tableName);
      if (!stored) {
        setStatus(`No stored change manifest was found for ${tableName}. Load a downloaded manifest file instead.`);
        return;
      }
      acceptRollbackManifest(stored, "this environment");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSolutionBusy(false);
    }
  }

  async function buildRollbackSolution(file) {
    if (!file || !rollbackManifest) return;
    if (file.size > MAX_PACKAGE_BYTES) {
      setStatus("The solution ZIP is larger than the 50 MB browser-processing limit.");
      return;
    }
    try {
      setStatus(`Building rollback package from ${file.name}…`);
      const result = buildRollbackSolutionZip(new Uint8Array(await file.arrayBuffer()), rollbackManifest);
      downloadBytes(result.bytes, `${file.name.replace(/\.zip$/i, "")}-ribbon-rollback.zip`);
      setStatus(`Built rollback package that removes ${result.removed} hide action(s) from ${result.tableName}. Import it into a development environment, then publish.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      if (rollbackSolutionRef.current) rollbackSolutionRef.current.value = "";
    }
  }

  async function loadSolutions() {
    try {
      setSolutionBusy(true);
      setStatus("Loading unmanaged solutions…");
      const available = await listUnmanagedSolutions();
      setSolutions(available);
      setSelectedSolution((current) => current || available[0]?.uniquename || "");
      setStatus(`Loaded ${available.length} unmanaged solution(s).`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSolutionBusy(false);
    }
  }

  async function createSolution() {
    if (solutionNameError) {
      setStatus(solutionNameError);
      return;
    }
    try {
      setSolutionBusy(true);
      setStatus(`Creating ${newSolutionName.trim()}…`);
      const created = await createUnmanagedSolution({
        uniqueName: newSolutionUniqueName,
        displayName: newSolutionName.trim(),
        publisherPrefix: publisher.trim()
      });
      setSolutions((current) => [...current.filter((item) => item.uniquename !== created.uniquename), created]
        .sort((left, right) => left.friendlyname.localeCompare(right.friendlyname)));
      setSelectedSolution(created.uniquename);
      invalidatePreparedWork();
      setStatus(created.alreadyExists
        ? `Selected the existing unmanaged solution '${created.friendlyname}'. Select controls to hide next.`
        : `Created the empty unmanaged solution '${created.friendlyname}'. Select controls to hide next.`);
    } catch (error) {
      setStatus(`Could not create the solution: ${error.message}`);
    } finally {
      setSolutionBusy(false);
    }
  }

  async function prepareExistingSolution() {
    if (!selectedSolution || !hiddenButtons.length) return;
    try {
      setSolutionBusy(true);
      setTableMissing(false);
      invalidatePreparedWork();
      setStatus(`Exporting ${selectedSolution} synchronously…`);
      const original = await exportUnmanagedSolution(selectedSolution);
      if (original.length > MAX_PACKAGE_BYTES) {
        throw new Error("The exported solution is larger than the 50 MB browser-processing limit.");
      }
      const patched = buildPatchedSolutionZip(original, tableName, output);
      const solution = solutions.find((item) => item.uniquename === selectedSolution);
      const backupName = `${selectedSolution}_${solution?.version || "backup"}_before-ribbon.zip`;
      downloadBytes(original, backupName);
      setPreparedSolution({ bytes: patched.bytes, added: patched.added, skipped: patched.skipped, backupName });
      setStatus(`Backup downloaded. Preview ready with ${patched.added} new hide action(s).`);
    } catch (error) {
      if (error.message.includes("does not contain")) setTableMissing(true);
      setStatus(error.message);
    } finally {
      setSolutionBusy(false);
    }
  }

  async function addCurrentTable() {
    const approved = window.confirm(
      `Add only the '${tableName}' table root component to the unmanaged solution '${selectedSolution}'? No table subcomponents will be added.`
    );
    if (!approved) return;
    try {
      setSolutionBusy(true);
      setStatus(`Adding ${tableName} to ${selectedSolution}…`);
      await addTableToSolution(selectedSolution, tableName.trim());
      setTableMissing(false);
      setStatus(`Added ${tableName} without subcomponents. Choose Prepare again to export and preview.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSolutionBusy(false);
    }
  }

  async function applyExistingSolution() {
    if (!preparedSolution || !confirmApply) return;
    const approved = window.confirm(
      `Import the patched unmanaged solution '${selectedSolution}' and publish only the '${tableName}' table?`
    );
    if (!approved) return;
    try {
      setSolutionBusy(true);
      setStatus(`Importing the patched ${selectedSolution} solution…`);
      const importJobId = await importUnmanagedSolution(preparedSolution.bytes);
      setStatus("Checking the import job result…");
      const diagnostics = await inspectImportJob(importJobId);
      if (diagnostics.failed) {
        setStatus(`Import failed and ${tableName} was not published. ${diagnostics.message} Your downloaded backup was not changed.`);
        return;
      }
      setStatus(`Publishing ${tableName}…`);
      await publishTable(tableName.trim());

      let manifestNote = "";
      try {
        const storedName = await storeChangeManifest({
          solutionName: selectedSolution,
          publisherPrefix: publisher,
          tableName,
          manifest: currentManifest()
        });
        manifestNote = ` The change manifest was saved into the solution as ${storedName}.`;
      } catch (error) {
        manifestNote = ` The change manifest could not be saved into the solution (${error.message}); download it and keep it for rollback.`;
      }

      const warning = diagnostics.message ? ` ${diagnostics.message}` : "";
      setPreparedSolution(null);
      setConfirmApply(false);
      setApplyComplete(true);
      setStatus(`Applied ${hiddenButtons.length} ribbon hide action(s) and published ${tableName}.${manifestNote}${warning}`);
    } catch (error) {
      setStatus(`Apply failed: ${error.message} Your downloaded backup was not changed.`);
    } finally {
      setSolutionBusy(false);
    }
  }

  async function prepareRollbackInEnvironment() {
    if (!selectedSolution || !rollbackManifest) return;
    try {
      setSolutionBusy(true);
      setPreparedRollback(null);
      setConfirmRollback(false);
      setStatus(`Exporting ${selectedSolution} for rollback…`);
      const original = await exportUnmanagedSolution(selectedSolution);
      if (original.length > MAX_PACKAGE_BYTES) {
        throw new Error("The exported solution is larger than the 50 MB browser-processing limit.");
      }
      const result = buildRollbackSolutionZip(original, rollbackManifest);
      const solution = solutions.find((item) => item.uniquename === selectedSolution);
      const backupName = `${selectedSolution}_${solution?.version || "backup"}_before-rollback.zip`;
      downloadBytes(original, backupName);
      setPreparedRollback({ bytes: result.bytes, removed: result.removed, tableName: result.tableName, backupName });
      setStatus(`Backup downloaded. Rollback preview ready; ${result.removed} hide action(s) will be removed.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSolutionBusy(false);
    }
  }

  async function applyRollbackInEnvironment() {
    if (!preparedRollback || !confirmRollback) return;
    const approved = window.confirm(
      `Import the rollback of '${selectedSolution}' and publish only the '${preparedRollback.tableName}' table? This removes ${preparedRollback.removed} hide action(s).`
    );
    if (!approved) return;
    try {
      setSolutionBusy(true);
      setStatus(`Importing the rollback of ${selectedSolution}…`);
      const importJobId = await importUnmanagedSolution(preparedRollback.bytes);
      setStatus("Checking the import job result…");
      const diagnostics = await inspectImportJob(importJobId);
      if (diagnostics.failed) {
        setStatus(`Rollback import failed and ${preparedRollback.tableName} was not published. ${diagnostics.message} Your downloaded backup was not changed.`);
        return;
      }
      setStatus(`Publishing ${preparedRollback.tableName}…`);
      await publishTable(preparedRollback.tableName);
      const warning = diagnostics.message ? ` ${diagnostics.message}` : "";
      const removed = preparedRollback.removed;
      const rolledBackTable = preparedRollback.tableName;
      setPreparedRollback(null);
      setConfirmRollback(false);
      setApplyComplete(false);
      setStatus(`Rolled back ${removed} hide action(s) and published ${rolledBackTable}.${warning}`);
    } catch (error) {
      setStatus(`Rollback failed: ${error.message} Your downloaded backup was not changed.`);
    } finally {
      setSolutionBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">RD</div>
        <div className="topbar-copy">
          <h1>Dynamics Ribbon Designer</h1>
          <p>{environmentLabel} <span>·</span> v{APP_VERSION}</p>
        </div>
      </header>

      <div className="app-status" role="status"><span className="status-dot" />{status}</div>

      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">COMMAND BAR CUSTOMIZATION</p>
            <h2>Remove the noise. Keep the actions that matter.</h2>
            <p>Load an effective Dataverse ribbon definition, choose the controls to hide, and generate a solution-ready XML fragment.</p>
          </div>
          <input ref={fileRef} type="file" accept=".xml,text/xml" hidden onChange={(event) => importFile(event.target.files?.[0])} />
          <input ref={solutionRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => buildSolution(event.target.files?.[0])} />
          <input ref={rollbackManifestRef} type="file" accept=".json,application/json" hidden onChange={(event) => loadRollbackManifest(event.target.files?.[0])} />
          <input ref={rollbackSolutionRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => buildRollbackSolution(event.target.files?.[0])} />
          <datalist id="table-options">
            {tables.map((table) => <option key={table.logicalName} value={table.logicalName}>{table.displayName}</option>)}
          </datalist>
        </section>

        <section className="process-panel" aria-labelledby="process-title">
          <div className="process-heading">
            <div><p className="eyebrow">GUIDED WORKFLOW</p><h2 id="process-title">Complete your command-bar customisation</h2></div>
            <span>Step {workflowStep} of {workflowSteps.length}</span>
          </div>
          <ol className="process-steps">
            {workflowSteps.map((step, index) => {
              const number = index + 1;
              const completed = number < workflowStep || (applyComplete && number === 5);
              const current = number === workflowStep && !applyComplete;
              return <li key={step.title} className={`${completed ? "complete" : ""} ${current ? "current" : ""}`} aria-current={current ? "step" : undefined}>
                <span className="step-number">{completed ? "✓" : number}</span>
                <span className="step-copy"><strong>{step.title}</strong><small>{step.detail}</small></span>
              </li>;
            })}
          </ol>
          <div className={`next-action ${applyComplete ? "done" : ""}`}>
            <div className="next-action-copy">
              <strong>{applyComplete ? "Customisation complete" : `Next: ${workflowSteps[workflowStep - 1].title}`}</strong>
              <span>{applyComplete ? `The ${tableName} ribbon changes were imported and published.` : workflowSteps[workflowStep - 1].detail}</span>
            </div>
            {workflowStep === 1 && <div className="workflow-actions">
              <label className="workflow-table">Table logical name
                <input list="table-options" value={tableName} onChange={(event) => { setTableName(event.target.value); setRibbonLoaded(false); setHiddenIds(new Set()); resetSolutionContext(); }} />
                {tables.length > 0 && <small className="field-hint">{tables.length} customisable tables available</small>}
              </label>
              <button className="primary" disabled={!isDataverseHost()} onClick={loadFromDataverse}>Load from Dataverse</button>
              <button className="secondary" onClick={() => fileRef.current?.click()}>Import ribbon XML</button>
            </div>}
            {workflowStep === 2 && <div className="workflow-actions">
              <label className="workflow-table">New solution name
                <input value={newSolutionName} onChange={(event) => setNewSolutionName(event.target.value)} />
              </label>
              <button className="primary" disabled={!isDataverseHost() || solutionBusy || Boolean(solutionNameError)} onClick={createSolution}>{solutionBusy ? "Creating…" : "Create new solution"}</button>
            </div>}
          </div>
        </section>

        <section className="workspace">
          <aside className="sidebar">
            <label>Publisher prefix
              {publishers.length > 0
                ? <select value={publisher} onChange={(event) => { setPublisher(event.target.value); invalidatePreparedWork(); }}>
                    {!publishers.some((item) => item.customizationprefix === publisher) && <option value={publisher}>{publisher} (not a publisher here)</option>}
                    {publishers.map((item) => <option key={item.publisherid} value={item.customizationprefix}>{item.customizationprefix} · {item.friendlyname}</option>)}
                  </select>
                : <input value={publisher} onChange={(event) => { setPublisher(event.target.value); invalidatePreparedWork(); }} />}
            </label>
            <div className="divider" />
            <p className="field-label">Command surface</p>
            {[
              ["all", "All surfaces"], ["form", "Main form"], ["grid", "Main grid"], ["subgrid", "Subgrid"], ["other", "Other"]
            ].map(([value, label]) => (
              <button key={value} className={`nav-item ${surface === value ? "active" : ""}`} onClick={() => setSurface(value)}>
                <span>{label}</span><b>{value === "all" ? buttons.length : buttons.filter((item) => item.surfaces.includes(value)).length}</b>
              </button>
            ))}
            <div className="summary-card"><strong>{hiddenButtons.length}</strong><span>commands selected to hide</span></div>
          </aside>

          <section className="content">
            <section className="solution-choice">
              <div className="environment-heading">
                <div><p className="eyebrow">ALTERNATIVE · EXISTING DEVELOPMENT SOLUTION</p><h3>Continue with an existing unmanaged solution</h3></div>
              </div>
              <p className="environment-note">The usual route is to create a fresh ribbon-customisation solution above. Use this only when you are continuing work in an existing unmanaged solution.</p>
              <button className="secondary existing-solution-button" disabled={!isDataverseHost() || !ribbonLoaded || solutionBusy} onClick={loadSolutions}>{solutionBusy ? "Loading…" : "Load existing solutions"}</button>
              <label className="solution-select">Unmanaged solution
                <select value={selectedSolution} disabled={!solutions.length || solutionBusy} onChange={(event) => { setSelectedSolution(event.target.value); setTableMissing(false); invalidatePreparedWork(); }}>
                  {!solutions.length && <option value="">Create a solution or load existing solutions</option>}
                  {solutions.map((solution) => <option key={solution.solutionid} value={solution.uniquename}>{solution.friendlyname} · {solution.version}</option>)}
                </select>
              </label>
            </section>

            <div className="content-header">
              <div><p className="eyebrow">STEP 3 · {tableName || "TABLE"}</p><h3>{surface === "all" ? "All command surfaces" : surfaceLabel(surface)}</h3></div>
              <input className="search" placeholder="Search label, ID or command…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>

            <div className="bulk-actions">
              <span>{visibleButtons.length} control(s) shown · {hiddenButtons.length} selected</span>
              <div>
                <button className="secondary small" disabled={!unselectedVisible.length} onClick={selectAllVisible}>Select all shown</button>
                <button className="secondary small" disabled={!hiddenButtons.length} onClick={clearSelection}>Clear selection</button>
              </div>
            </div>

            <div className="command-list">
              {visibleButtons.map((button) => {
                const hidden = hiddenIds.has(button.id);
                return <article className={`command ${hidden ? "selected" : ""}`} key={button.id}>
                  <div className="command-icon">{button.label.slice(0, 1).toUpperCase()}</div>
                  <div className="command-copy">
                    <div>
                      <h4>{button.label}</h4>
                      <span className="pill">{surfaceSummary(button.surfaces)}</span>
                      {button.type !== "Button" && <span className="pill subtle">{controlTypeLabel(button.type)}</span>}
                    </div>
                    <code>{button.id}</code>
                    {button.description && <p>{button.description}</p>}
                  </div>
                  <label className="switch"><input type="checkbox" checked={hidden} onChange={() => toggle(button)} /><span /><em>{hidden ? "Hidden" : "Visible"}</em></label>
                </article>;
              })}
              {!visibleButtons.length && <div className="empty">No matching ribbon controls were found.</div>}
            </div>

            {hiddenButtons.length > 0 && <section className="change-review" aria-labelledby="review-title">
              <div className="change-review-heading">
                <div>
                  <p className="eyebrow">REVIEW BEFORE PREPARE</p>
                  <h3 id="review-title">Confirm the customisation</h3>
                </div>
                <button className="secondary" onClick={downloadManifest}>Download change manifest</button>
              </div>
              <dl className="change-facts">
                <div><dt>Table</dt><dd>{tableName}</dd></div>
                <div><dt>Development solution</dt><dd>{selectedSolutionDetails?.friendlyname || "Choose or create a solution in Step 2"}</dd></div>
                <div><dt>Commands to hide</dt><dd>{hiddenButtons.length}</dd></div>
              </dl>
              <ul className="change-list">
                {hiddenButtons.map((button) => <li key={button.id}>
                  <strong>{button.label}</strong><span>{surfaceSummary(button.surfaces)} · <code>{button.id}</code></span>
                </li>)}
              </ul>
              {compatibilityWarnings.length > 0 && <div className="compatibility-warning">
                <strong>Compatibility check</strong>
                <span>{compatibilityWarnings.length} selected control(s) need verification in a test environment before production deployment.</span>
                <ul>{compatibilityWarnings.map((button) => <li key={button.id}><b>{button.label}:</b> {button.compatibilityWarning}</li>)}</ul>
              </div>}
            </section>}

            <section className="output-panel">
              <div className="output-heading"><div><p className="eyebrow">GENERATED OUTPUT</p><h3>RibbonDiffXml</h3></div><div><button onClick={copyOutput}>Copy XML</button><button className="primary small" onClick={downloadOutput}>Download</button></div></div>
              <pre><code>{output}</code></pre>
            </section>

            <section className="solution-builder">
              <div>
                <p className="eyebrow">SAFE SOLUTION WORKFLOW</p>
                <h3>Build a patched unmanaged solution</h3>
                <p>Upload an unmanaged solution ZIP that already contains the <code>{tableName || "target"}</code> table. The designer merges these hide actions into its existing RibbonDiffXml and downloads a new ZIP. Nothing is written directly to this environment.</p>
              </div>
              <button className="primary" disabled={!hiddenButtons.length} onClick={() => solutionRef.current?.click()}>Choose solution ZIP</button>
            </section>

            <section className="rollback-builder">
              <div>
                <p className="eyebrow">SAFE ROLLBACK</p>
                <h3>Roll back a previous customisation</h3>
                <p>Load a change manifest created by this designer, then either download a rollback ZIP or apply the rollback here under the same backup-and-confirm guard. Only the hide actions recorded in that manifest are removed.</p>
                {rollbackManifest && <p className="rollback-loaded">Loaded: <strong>{rollbackManifest.tableLogicalName}</strong> · {rollbackManifest.hideActionIds.size} hide action(s)</p>}
              </div>
              <div className="rollback-actions">
                <button className="secondary" onClick={() => rollbackManifestRef.current?.click()}>Load manifest file</button>
                <button className="secondary" disabled={!isDataverseHost() || solutionBusy} onClick={loadStoredRollbackManifest}>Load stored manifest</button>
                <button className="secondary" disabled={!rollbackManifest} onClick={() => rollbackSolutionRef.current?.click()}>Download rollback ZIP</button>
                <button className="primary" disabled={!isDataverseHost() || !rollbackManifest || !selectedSolution || solutionBusy} onClick={prepareRollbackInEnvironment}>{solutionBusy ? "Working…" : "Prepare rollback here"}</button>
              </div>
              {preparedRollback && <div className="apply-gate">
                <p><strong>Rollback ready:</strong> {preparedRollback.removed} hide action(s) will be removed from {preparedRollback.tableName}. Backup: <code>{preparedRollback.backupName}</code></p>
                <label><input type="checkbox" checked={confirmRollback} onChange={(event) => setConfirmRollback(event.target.checked)} /> I have saved the backup and approve importing this rollback.</label>
                <button className="primary" disabled={!confirmRollback || solutionBusy} onClick={applyRollbackInEnvironment}>Apply rollback and publish {preparedRollback.tableName}</button>
              </div>}
            </section>

            <section className="environment-editor">
              <div className="environment-heading">
                <div><p className="eyebrow">STEPS 4–5 · PREPARE AND APPLY</p><h3>Back up, review and publish the customisation</h3></div>
              </div>
              <p className="environment-note">The designer exports and patches the selected solution synchronously. A backup ZIP downloads before Apply becomes available. The import job result is checked before anything is published, and the change manifest is saved into the solution for later rollback.</p>
              <p className="selected-solution"><span>Selected solution</span><strong>{selectedSolution || "Complete step 2 first"}</strong></p>
              <div className="environment-actions">
                <button className="secondary" disabled={!selectedSolution || !hiddenButtons.length || solutionBusy} onClick={prepareExistingSolution}>{solutionBusy ? "Working…" : "Prepare backup & preview"}</button>
                {tableMissing && <button className="secondary warning" disabled={solutionBusy} onClick={addCurrentTable}>Add {tableName} without assets</button>}
              </div>
              {preparedSolution && <div className="apply-gate">
                <p><strong>Preview ready:</strong> {preparedSolution.added} action(s) added, {preparedSolution.skipped} already present. Backup: <code>{preparedSolution.backupName}</code></p>
                <label><input type="checkbox" checked={confirmApply} onChange={(event) => setConfirmApply(event.target.checked)} /> I have saved the backup and approve importing this unmanaged change.</label>
                <button className="primary" disabled={!confirmApply || solutionBusy} onClick={applyExistingSolution}>Apply and publish {tableName}</button>
              </div>}
            </section>
          </section>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
