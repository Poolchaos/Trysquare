/**
 * The leak gate's matcher for names it may not write down (D-156, D-157).
 * Made-up names only: the gate's own are the maintainer's private ones.
 *
 * Its forms were proven once by a probe file staged and then removed, which
 * no one could run again, and which missed a Windows path (review of the
 * D-157 fixes); these are the probe, kept.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashedNamesIn } from "../../scripts/lib/hashed-names.mjs";

const sha = (words: string) => createHash("sha256").update(words).digest("hex");
const FORBIDDEN = new Map([
  [sha("kettle orbit"), "made-up tree"],
  [sha("nimbus vault"), "made-up tree"],
  [sha("tarn gable 9"), "made-up tree"],
]);
const found = (text: string) => hashedNamesIn(text, FORBIDDEN).length > 0;

describe("the leak gate's hashed names", () => {
  it.each([
    ["plain", "the kettle orbit tree"],
    ["hyphenated", "the kettle-orbit tree"],
    ["a numbered copy", "checked out as kettle-orbit-2"],
    ["a Claude Code project folder", "c--Workspace-kettle-orbit-2 as a folder"],
    ["upper case", "KETTLE-ORBIT"],
    ["underscore and dot", "kettle_orbit and kettle.orbit"],
    ["a URL's %20", "file:///C:/x/kettle%20orbit/y"],
    ["three words with a digit", "tarn-gable-9 on disk"],
  ])("finds a name %s", (_, text) => {
    expect(found(text)).toBe(true);
  });

  it.each([
    ["after a JSON escape", String.raw`{"log": "\nkettle-orbit was cloned"}`],
    ["inside a pattern's word boundaries", String.raw`/\bkettle-orbit\b/`],
    ["joined by a pattern's whitespace class", String.raw`/kettle\s+orbit/`],
    ["joined as the gate's own product pattern is", String.raw`/kettle[-\s]?orbit/`],
  ])("finds a name %s", (_, text) => {
    expect(found(text)).toBe(true);
  });

  it.each([
    // A path's backslash before a name starting with n, r, t, b, f or v was
    // read as an escape and ate the name's first letter (review of the D-157
    // fixes).
    ["in a Windows path", String.raw`C:\Workspace\nimbus-vault\src`],
    ["in a Windows path in another case", String.raw`C:\Workspace\Nimbus-Vault`],
    ["in a JSON-escaped Windows path", String.raw`"C:\\Workspace\\tarn-gable-9"`],
  ])("finds a name %s", (_, text) => {
    expect(found(text)).toBe(true);
  });

  it("finds a name a line wrap splits, on the line it starts on", () => {
    const hits = hashedNamesIn("first line\nends with the kettle\n\norbit at last\n", FORBIDDEN);
    expect(hits.map((hit) => hit.line)).toEqual([1]);
  });

  it("says how many words each name it found is", () => {
    expect(hashedNamesIn("tarn gable 9", FORBIDDEN).map((hit) => hit.words)).toEqual([3]);
  });

  it.each([
    ["a longer word", "cloned repos-kettle-orbiting here"],
    ["one of its words alone", "a kettle on the hob"],
    ["its words apart", "the kettle, then an orbit"],
  ])("does not take %s for a name", (_, text) => {
    expect(found(text)).toBe(false);
  });
});
