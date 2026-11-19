import { beforeAll, describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { describeImportJob, summarizeImportJob } from "./importJob";

beforeAll(() => {
  globalThis.DOMParser = DOMParser;
});

describe("import job diagnostics", () => {
  it("treats a job without failures as successful", () => {
    const summary = summarizeImportJob(`<importexportxml>
      <solutionManifests><solutionManifest><result result="success" errorcode="0" errortext="" /></solutionManifest></solutionManifests>
    </importexportxml>`);

    expect(summary).toMatchObject({ parsed: true, succeeded: true, errors: [] });
    expect(describeImportJob(summary)).toBe("");
  });

  it("reports component failures with their error text", () => {
    const summary = summarizeImportJob(`<importexportxml>
      <entities>
        <entity LocalizedName="Account"><result result="failure" errorcode="0x80048403" errortext="Ribbon location is invalid." /></entity>
        <entity LocalizedName="Account"><result result="failure" errorcode="0x80048403" errortext="Ribbon location is invalid." /></entity>
      </entities>
    </importexportxml>`);

    expect(summary.succeeded).toBe(false);
    expect(summary.errors).toEqual([{ component: "Account", text: "Ribbon location is invalid." }]);
    expect(describeImportJob(summary)).toContain("Ribbon location is invalid.");
  });

  it("does not claim success when the job payload cannot be read", () => {
    const summary = summarizeImportJob("");
    expect(summary).toMatchObject({ parsed: false, succeeded: false });
    expect(describeImportJob(summary)).toContain("could not be read");
  });
});
