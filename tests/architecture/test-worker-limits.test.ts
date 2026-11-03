/**
 * The unit suite cannot take a machine down with it: a bounded number of
 * workers, each with a bounded heap. Run inside a worker, so the heap check
 * reads the limit the worker really has, not the one the config asks for.
 */

import { getHeapStatistics } from "node:v8";
import { describe, expect, it } from "vitest";
import { testWorkerCount } from "../../vitest.config";

describe("the unit suite's workers", () => {
  it("are at most 4, and at least 1, whatever the machine", () => {
    expect(testWorkerCount(16)).toBe(4);
    expect(testWorkerCount(5)).toBe(4);
    expect(testWorkerCount(4)).toBe(3);
    expect(testWorkerCount(2)).toBe(1);
    expect(testWorkerCount(1)).toBe(1);
  });

  it("each stop at a 1 GB heap", () => {
    expect(process.execArgv).toContain("--max-old-space-size=1024");
    // 1024 MB of old space plus V8's young generation: 1048 MB measured on Node
    // 22.17. Without the flag a machine with 16 GB or more gets about 4 GB.
    expect(getHeapStatistics().heap_size_limit).toBeLessThanOrEqual(1100 * 1024 * 1024);
  });
});
