# Dynamics Ribbon Designer

A browser-based first attempt at a focused Dynamics 365 / Dataverse command-bar designer. It reads effective ribbon XML, presents buttons by command surface, and produces a `RibbonDiffXml` fragment with deterministic, publisher-owned `HideCustomAction` entries.

## Run locally

```bash
npm install
npm run dev
```

The local version starts with a representative Account ribbon. Use **Import ribbon XML** to test a real export.

## Test and build

```bash
npm run test
npm run build
```

Deployable static files are written to `dist/webresource`. They use relative asset paths and no externally hosted fonts or scripts.

## Dataverse-hosted mode

When the built page is installed as an HTML web resource and opened inside a model-driven app, **Load from Dataverse** uses `Xrm.WebApi.online.execute` with `RetrieveEntityRibbon`. The returned ZIP package is decompressed in the browser. The user must have the necessary customization privileges.

This prototype generates XML and can merge it into an exported unmanaged solution ZIP. It can also update a selected unmanaged development solution in place through a guarded backup, confirmation, synchronous import and targeted publish workflow. The safe production design is:

1. Install this designer as its own managed solution.
2. Generate ribbon changes into a separate unmanaged development solution.
3. Export that customization solution as managed for test and production.

## Build a ribbon customization solution

Prepare a source package in a separate build environment:

1. Create an unmanaged customization solution using your publisher.
2. Add the target table, clearing **Include table metadata** and **Add all assets**.
3. Export the solution as unmanaged.
4. In Dynamics Ribbon Designer, load the table ribbon and select the commands to hide.
5. Under **Build a patched unmanaged solution**, choose the exported ZIP.
6. Import the downloaded `-ribbon-patched.zip` into the build environment and publish.
7. Export that solution as managed for deployment to test or production.

The builder runs entirely in the browser. It rejects managed ZIPs, requires the named table to be present, preserves existing `RibbonDiffXml`, and skips duplicate hide actions. It does not write directly to Dataverse.

## Edit an existing unmanaged solution

Version 0.3 adds a guarded in-environment workflow when the designer is opened as a Dataverse web resource:

1. Select commands to hide and choose **Load solutions**.
2. Select a visible unmanaged development solution. System, default, managed and designer solutions are excluded.
3. Choose **Prepare backup & preview**. The solution is exported synchronously and an untouched backup ZIP downloads before Apply is available.
4. If the table is missing, explicitly approve adding only its table root component. Subcomponents and required components are not added.
5. Review the number of new and existing hide actions, save the backup and check the approval box.
6. Choose **Apply and publish** and accept the final confirmation. The patched unmanaged solution is imported synchronously and only the selected table is published.

Changing the table, publisher prefix, selected solution or button selection invalidates a prepared package so stale changes cannot be applied.

Version 0.3.1 fixes Dataverse detection for directly opened web resources and solution pages nested through multiple same-origin frames. It falls back to the current `/WebResources/` origin and the Dataverse Web API when `Xrm.WebApi.online.execute` is not exposed to the page.

Version 0.3.3 aligns the interface with the shared Bernier Power Platform visual language: navy gradient masthead, monogram tile, environment/version subtitle, action buttons, status band and card-based workspace.

Version 0.3.4 adds a responsive five-stage progress bar and reorders the solution controls so the intended workflow is explicit: load the ribbon, choose an unmanaged solution, select changes, prepare and back up, then approve and apply.

Version 0.3.5 makes Step 1 actionable: the table name, **Load from Dataverse** and **Import ribbon XML** controls are embedded in the active workflow instruction rather than the page header.

Version 0.3.6 corrects the package environment-schema marker to `Standard`. It contains the same three web resources as 0.3.5 and is intended for Standard Dataverse environments.

Version 0.3.7 makes the normal Step 2 route create a new, empty unmanaged ribbon-customisation solution using the chosen publisher prefix. Selecting an existing unmanaged solution remains available as an alternative for continuing prior work.

Version 0.3.8 restores a clean button designer view for live Dataverse ribbons: it resolves ribbon localisation labels, turns common resource keys into readable button names, suppresses unresolved technical tooltips and uses compact button cards.

Version 0.3.10 reuses an existing unmanaged solution when its generated name already exists, rather than failing to create a duplicate. New display names begin with `Dynamics Ribbon Designer -`; their short generated unique names use `drd`.

Version 0.3.12 removes the direct-launch URL from the managed solution description. Launch the designer from the solution's Configuration page instead.

## Portable solution packages

The supported Dataverse-native managed package is:

- `release/portable/DynamicsRibbonDesigner_0_3_12_0_managed.zip` — Standard-environment managed update. Its checksum is recorded in `release/portable/SHA256SUMS.txt`.

For new deployments or upgrades, use the managed `0.3.12.0` package. It retains the same solution unique name, publisher, component IDs and Configuration Page as its prior releases, so Dataverse recognizes it as an upgrade.

After importing `0.3.12.0`, open **Power Apps > Solutions > Dynamics Ribbon Designer > Configuration** to launch the designer without storing an environment-specific URL.

The package contains no source-environment URL, connection reference, tenant ID, or environment-specific dependency.

The package contains three fixed-name solution components: the HTML page, compiled application script and compiled stylesheet. Importing the managed package installs those components independently in each target environment. The HTML web resource is registered as the solution Configuration Page.

## Prototype boundaries

- Supported now: XML import, Dataverse retrieval, Form/Main Grid/Subgrid classification, filtering, hide/unhide selection, XML preview, copy/download, safe merge into an uploaded unmanaged ZIP, and guarded editing of an existing unmanaged solution with backup and targeted publish.
- Next: table metadata picker, command inheritance detail, rollback automation, import-job diagnostics and managed build-environment integration.
- Some Unified Interface controls are injected or hardcoded and cannot be changed through `RibbonDiffXml`.
- Removing a button is not a security boundary; privileges must enforce restricted operations.

## Generated XML lifecycle

The generated `HideActionId` values are deterministic and owned by the chosen publisher prefix. Unselecting a button removes its node from the next full solution update. Do not rely on a solution patch to remove an existing `HideCustomAction`.
