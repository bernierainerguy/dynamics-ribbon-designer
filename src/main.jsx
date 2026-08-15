import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { generateRibbonDiffXml, parseRibbonXml, surfaceLabel } from "./ribbon";
import { sampleRibbonXml } from "./sampleRibbon";
import {
  addTableToSolution,
  createUnmanagedSolution,
  exportUnmanagedSolution,
  importUnmanagedSolution,
  isDataverseHost,
  listUnmanagedSolutions,
  publishTable,
  retrieveEntityRibbonXml
} from "./dataverse";
import { buildPatchedSolutionZip } from "./solutionBuilder";
import "./styles.css";

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

function App() {
  const environmentLabel = isDataverseHost() ? window.location.hostname : "Local preview";
  const [tableName, setTableName] = useState("account");
  const [publisher, setPublisher] = useState("brg");
  const [buttons, setButtons] = useState(() => parseRibbonXml(sampleRibbonXml));
  const [hiddenIds, setHiddenIds] = useState(new Set());
  const [surface, setSurface] = useState("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loaded the sample Account ribbon.");
  const [ribbonLoaded, setRibbonLoaded] = useState(false);
  const [applyComplete, setApplyComplete] = useState(false);
  const [newSolutionName, setNewSolutionName] = useState("Dynamics Ribbon Designer - Account ribbon customisation");
  const [solutions, setSolutions] = useState([]);
  const [selectedSolution, setSelectedSolution] = useState("");
  const [preparedSolution, setPreparedSolution] = useState(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [solutionBusy, setSolutionBusy] = useState(false);
  const fileRef = useRef(null);
  const solutionRef = useRef(null);

  const visibleButtons = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return buttons.filter((button) => {
      const surfaceMatch = surface === "all" || button.surface === surface;
      const textMatch =
        !needle ||
        [button.label, button.id, button.command].some((value) => value.toLowerCase().includes(needle));
      return surfaceMatch && textMatch;
    });
  }, [buttons, query, surface]);

  const hiddenButtons = buttons.filter((button) => hiddenIds.has(button.id));
  const output = generateRibbonDiffXml(hiddenButtons, publisher);
  const newSolutionUniqueName = solutionUniqueName(newSolutionName, publisher);
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
    { title: "Make changes", detail: "Select the form, grid or subgrid buttons that should be hidden." },
    { title: "Prepare", detail: "Export the solution, download its backup and review the patched preview." },
    { title: "Apply", detail: "Approve the guarded import and publish the selected table." }
  ];

  function toggle(button) {
    setPreparedSolution(null);
    setConfirmApply(false);
    setApplyComplete(false);
    setHiddenIds((current) => {
      const next = new Set(current);
      next.has(button.id) ? next.delete(button.id) : next.add(button.id);
      return next;
    });
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const xml = await file.text();
      const parsed = parseRibbonXml(xml);
      setButtons(parsed);
      setHiddenIds(new Set());
      setRibbonLoaded(true);
      setPreparedSolution(null);
      setApplyComplete(false);
      setStatus(`Loaded ${parsed.length} buttons from ${file.name}.`);
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
      const xml = await retrieveEntityRibbonXml(tableName.trim(), 7);
      const parsed = parseRibbonXml(xml);
      setButtons(parsed);
      setHiddenIds(new Set());
      setRibbonLoaded(true);
      setPreparedSolution(null);
      setApplyComplete(false);
      setStatus(`Loaded ${parsed.length} effective buttons from Dataverse.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function copyOutput() {
    await navigator.clipboard.writeText(output);
    setStatus("RibbonDiffXml copied to the clipboard.");
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

  function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function buildSolution(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
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
    if (!newSolutionName.trim() || !newSolutionUniqueName) {
      setStatus("Enter a name for the new customisation solution.");
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
      setPreparedSolution(null);
      setConfirmApply(false);
      setApplyComplete(false);
      setStatus(created.alreadyExists
        ? `Selected the existing unmanaged solution '${created.friendlyname}'. Select buttons to hide next.`
        : `Created the empty unmanaged solution '${created.friendlyname}'. Select buttons to hide next.`);
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
      setPreparedSolution(null);
      setConfirmApply(false);
      setApplyComplete(false);
      setTableMissing(false);
      setStatus(`Exporting ${selectedSolution} synchronously…`);
      const original = await exportUnmanagedSolution(selectedSolution);
      if (original.length > 50 * 1024 * 1024) {
        throw new Error("The exported solution is larger than the 50 MB browser-processing limit.");
      }
      const patched = buildPatchedSolutionZip(original, tableName, output);
      const solution = solutions.find((item) => item.uniquename === selectedSolution);
      const backupName = `${selectedSolution}_${solution?.version || "backup"}_before-ribbon.zip`;
      downloadBytes(original, backupName);
      setPreparedSolution({ bytes: patched.bytes, added: patched.added, skipped: patched.skipped, backupName });
      setApplyComplete(false);
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
      await importUnmanagedSolution(preparedSolution.bytes);
      setStatus(`Publishing ${tableName}…`);
      await publishTable(tableName.trim());
      setPreparedSolution(null);
      setConfirmApply(false);
      setApplyComplete(true);
      setStatus(`Applied ${hiddenButtons.length} ribbon hide action(s) and published ${tableName}.`);
    } catch (error) {
      setStatus(`Apply failed: ${error.message} Your downloaded backup was not changed.`);
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
          <p>{environmentLabel} <span>·</span> v0.3.12</p>
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
                <input value={tableName} onChange={(event) => { setTableName(event.target.value); setRibbonLoaded(false); setHiddenIds(new Set()); setPreparedSolution(null); setConfirmApply(false); setApplyComplete(false); }} />
              </label>
              <button className="primary" disabled={!isDataverseHost()} onClick={loadFromDataverse}>Load from Dataverse</button>
              <button className="secondary" onClick={() => fileRef.current?.click()}>Import ribbon XML</button>
            </div>}
            {workflowStep === 2 && <div className="workflow-actions">
              <label className="workflow-table">New solution name
                <input value={newSolutionName} onChange={(event) => setNewSolutionName(event.target.value)} />
              </label>
              <button className="primary" disabled={!isDataverseHost() || solutionBusy} onClick={createSolution}>{solutionBusy ? "Creating…" : "Create new solution"}</button>
            </div>}
          </div>
        </section>

        <section className="workspace">
          <aside className="sidebar">
            <label>Publisher prefix<input value={publisher} onChange={(event) => { setPublisher(event.target.value); setPreparedSolution(null); setConfirmApply(false); setApplyComplete(false); }} /></label>
            <div className="divider" />
            <p className="field-label">Command surface</p>
            {[
              ["all", "All surfaces"], ["form", "Main form"], ["grid", "Main grid"], ["subgrid", "Subgrid"], ["other", "Other"]
            ].map(([value, label]) => (
              <button key={value} className={`nav-item ${surface === value ? "active" : ""}`} onClick={() => setSurface(value)}>
                <span>{label}</span><b>{value === "all" ? buttons.length : buttons.filter((item) => item.surface === value).length}</b>
              </button>
            ))}
            <div className="summary-card"><strong>{hiddenIds.size}</strong><span>commands selected to hide</span></div>
          </aside>

          <section className="content">
            <section className="solution-choice">
              <div className="environment-heading">
                <div><p className="eyebrow">ALTERNATIVE · EXISTING DEVELOPMENT SOLUTION</p><h3>Continue with an existing unmanaged solution</h3></div>
              </div>
              <p className="environment-note">The usual route is to create a fresh ribbon-customisation solution above. Use this only when you are continuing work in an existing unmanaged solution.</p>
              <button className="secondary existing-solution-button" disabled={!isDataverseHost() || !ribbonLoaded || solutionBusy} onClick={loadSolutions}>{solutionBusy ? "Loading…" : "Load existing solutions"}</button>
              <label className="solution-select">Unmanaged solution
                <select value={selectedSolution} disabled={!solutions.length || solutionBusy} onChange={(event) => { setSelectedSolution(event.target.value); setPreparedSolution(null); setConfirmApply(false); setTableMissing(false); setApplyComplete(false); }}>
                  {!solutions.length && <option value="">Create a solution or load existing solutions</option>}
                  {solutions.map((solution) => <option key={solution.solutionid} value={solution.uniquename}>{solution.friendlyname} · {solution.version}</option>)}
                </select>
              </label>
            </section>

            <div className="content-header">
              <div><p className="eyebrow">STEP 3 · {tableName || "TABLE"}</p><h3>{surface === "all" ? "All command surfaces" : surfaceLabel(surface)}</h3></div>
              <input className="search" placeholder="Search label, ID or command…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>

            <div className="command-list">
              {visibleButtons.map((button) => {
                const hidden = hiddenIds.has(button.id);
                return <article className={`command ${hidden ? "selected" : ""}`} key={button.id}>
                  <div className="command-icon">{button.label.slice(0, 1).toUpperCase()}</div>
                  <div className="command-copy"><div><h4>{button.label}</h4><span className="pill">{surfaceLabel(button.surface)}</span></div><code>{button.id}</code>{button.description && <p>{button.description}</p>}</div>
                  <label className="switch"><input type="checkbox" checked={hidden} onChange={() => toggle(button)} /><span /><em>{hidden ? "Hidden" : "Visible"}</em></label>
                </article>;
              })}
              {!visibleButtons.length && <div className="empty">No matching ribbon buttons were found.</div>}
            </div>

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

            <section className="environment-editor">
              <div className="environment-heading">
                <div><p className="eyebrow">STEPS 4–5 · PREPARE AND APPLY</p><h3>Back up, review and publish the customisation</h3></div>
              </div>
              <p className="environment-note">The designer exports and patches the selected solution synchronously. A backup ZIP downloads before Apply becomes available. Import requires the approval checkbox and final confirmation; adding a missing table is a separate confirmed action.</p>
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
