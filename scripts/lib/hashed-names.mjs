/**
 * Finding names that must not be published without writing them down: each is
 * kept as the sha256 of its words, lowercased and joined by one space, and a
 * file's runs of one to three words are hashed and looked up.
 *
 * A file is read as one stream of words, split at anything but a letter or
 * digit, so hyphens, slashes, backslashes, underscores, dots and spaces all
 * read alike, a name inside a longer hyphenated word is still found, and a
 * name a line wrap splits is found across it; a URL's %20 and the like are
 * separators (reviews of the D-156 fixes).
 *
 * It is read twice, because a backslash means two things. In a string or a
 * pattern, \n, \t, \b, \s, \d, \w and their kind are escapes, which read as
 * letters glued themselves to the word after them; in a Windows path the
 * backslash is a separator and the letter after it begins a name. Read only
 * the first way, a path to a folder whose name began with one of those
 * letters lost it (review of the D-157 fixes).
 */

import { hash } from "node:crypto";

const RUN = 3;
// The escapes the first reading takes as separators: a string's or a
// pattern's backslash escapes, \u and \x with their digits among them, and a
// URL's %XX. In the second reading a backslash and a % are separators
// alone, so a name after a Windows path's \ or inside a %VARIABLE% keeps the
// letters an escape would have taken (reviews of the D-157 and 6.3 changes).
const ESCAPES = /\\u[0-9a-f]{4}|\\x[0-9a-f]{2}|\\[nrtbfvsdw]|%[0-9a-f]{2}/g;

function wordsOf(contents, escapesAreSeparators) {
  const words = [];
  contents.split("\n").forEach((line, index) => {
    let text = line.toLowerCase();
    if (escapesAreSeparators) text = text.replace(ESCAPES, " ");
    for (const word of text.split(/[^a-z0-9]+/)) if (word !== "") words.push({ word, line: index });
  });
  return words;
}

/**
 * Every run of words in `contents` whose hash `forbidden` holds, with the
 * line it starts on and how many words it is.
 *
 * @param {string} contents
 * @param {ReadonlyMap<string, string>} forbidden sha256 of the words, to why
 * @param {Map<string, string | null>} [answers] each run's matching hash, kept
 *   across files: most runs recur across a tree
 */
export function hashedNamesIn(contents, forbidden, answers = new Map()) {
  const found = new Map();
  for (const escapesAreSeparators of [true, false]) {
    const words = wordsOf(contents, escapesAreSeparators);
    for (let start = 0; start < words.length; start += 1) {
      let run = "";
      for (let length = 1; length <= RUN && start + length <= words.length; length += 1) {
        run = length === 1 ? words[start].word : `${run} ${words[start + length - 1].word}`;
        let digest = answers.get(run);
        if (digest === undefined) {
          const candidate = hash("sha256", run);
          digest = forbidden.has(candidate) ? candidate : null;
          answers.set(run, digest);
        }
        if (digest !== null) {
          const line = words[start].line;
          found.set(`${line} ${digest}`, {
            line,
            why: forbidden.get(digest),
            digest,
            words: length,
          });
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line);
}
