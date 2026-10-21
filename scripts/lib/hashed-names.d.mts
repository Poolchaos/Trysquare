export interface HashedName {
  /** Zero-based line the run starts on. */
  line: number;
  why: string;
  digest: string;
  /** How many words the run is. */
  words: number;
}

export function hashedNamesIn(
  contents: string,
  forbidden: ReadonlyMap<string, string>,
  answers?: Map<string, string | null>,
): HashedName[];
