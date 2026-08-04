# Example Review Protocol

A public sample protocol. It is the fixture the importer's fidelity gate runs
against, and it doubles as a starter ruleset, so it deliberately exercises
every structural feature the importer supports: process directives, numbered
and lettered rules, violation and correct-pattern code fences, detection
hints, severities, notes, and a mechanical sweep table.

## Purpose

This document defines the rules a review checks against. A reviewer applies
every rule to every changed hunk and accounts for each one.

## The Prime Directive

Understand the change before judging it.

- Read every file in the execution chain, not only the changed lines.
- Read the implementation of anything the changed code calls.
- Trace each value from where it is created to where it is used.
- Report nothing you have not traced.

A finding without a traced path is a guess wearing a finding's clothes.

## Review Scope

Review only what the change touched.

- New files: the whole file.
- Modified files: the changed lines and the code they interact with.
- Untouched code: out of scope, however tempting.

## Severity Levels

| Level | Label    | Meaning                                     |
| ----- | -------- | ------------------------------------------- |
| 1     | CRITICAL | Security risk, data loss, or lost correctness |
| 2     | WARNING  | Defect risk, or a pattern that invites one  |
| 3     | NITPICK  | Preference. Not reported by default.        |

## Finding Format

Every finding is reported in this structure.

```
File: <path from the repository root>
Lines: <verified line numbers>
Issue: <one sentence naming the problem>
Comment: <what is wrong and what it breaks, in plain language>
```

## Mandatory Mechanical Sweeps

Run these searches over every added line and account for each hit.

| Sweep for                     | What a hit means         |
| ----------------------------- | ------------------------ |
| `as `                         | Rule 3: unchecked cast   |
| `any`                         | Rule 3: loose typing     |
| `console\.`                   | Rule 6: left-in logging  |
| `TODO`                        | Rule 7: unfinished work  |
| `setTimeout`                  | Rule 5: missing cleanup  |
| `toFixed`                     | Rule 8: money in floats  |

## Correctness Anti-Patterns

### 1. Unawaited Promise

**Rule:** Flag a call that returns a promise and is neither awaited nor
explicitly handled.

**Violation Example:**

```ts
function save(order: Order) {
  persist(order); // returns a promise
  return "saved";
}
```

**Correct Pattern:**

```ts
async function save(order: Order) {
  await persist(order);
  return "saved";
}
```

**Detection:** A call to a known async function with no await and no .then or
.catch, in a function that returns before it settles.

**Why This Matters:** The caller is told the work finished when it has not.
Failures surface as unhandled rejections far from their cause.

**Severity:** CRITICAL

### 2. Swallowed Error

**Rule:** Flag a catch block that discards the error without handling it.

**Violation Example:**

```ts
try {
  await refresh();
} catch {
  // ignore
}
```

**Correct Pattern:**

```ts
try {
  await refresh();
} catch (error) {
  reportFailure(error);
  throw error;
}
```

**Detection:** An empty catch, or one whose body only logs at debug level.

**Severity:** WARNING

### 2a. Silent Fallback

**Rule:** Flag a fallback that hides a failure by substituting a plausible
value.

**Violation Example:**

```ts
const rate = (await fetchRate()) ?? 1;
```

**Detection:** A nullish or logical fallback applied to the result of an
operation that can fail, where the fallback is a real-looking value.

**Severity:** WARNING

## Typing Anti-Patterns

### 3. Unchecked Cast

**Rule:** Flag a type assertion that claims more than the code proves.

**Violation Example:**

```ts
const user = payload as User;
```

**Correct Pattern:**

```ts
const user = userSchema.parse(payload);
```

**Detection:** An `as` assertion applied to data from outside the program:
a request body, a database row, a parsed file.

**Why This Matters:** An assertion is a claim the compiler stops checking. If
it is wrong, the failure appears somewhere else entirely.

**Severity:** CRITICAL

### 4. Index Signature Hiding a Typo

**Rule:** Flag property access on a type carrying an index signature, where a
misspelled property would compile.

**Violation Example:**

```ts
interface Row {
  [key: string]: unknown;
  id: string;
}
const value = row._id; // compiles, always undefined
```

**Detection:** Access to a property not named in the interface, on a type with
an index signature.

**Severity:** CRITICAL

## Lifecycle Anti-Patterns

### 5. Missing Cleanup

**Rule:** Flag a subscription, listener, or timer that is created without a
matching teardown.

**Violation Example:**

```ts
useEffect(() => {
  const id = setInterval(poll, 1000);
}, []);
```

**Correct Pattern:**

```ts
useEffect(() => {
  const id = setInterval(poll, 1000);
  return () => clearInterval(id);
}, []);
```

**Severity:** WARNING

## Hygiene Anti-Patterns

### 6. Left-In Logging

**Rule:** Flag logging added for debugging that was not removed.

**Detection:** A `console.` call added by the change in code that is not a
command-line tool.

**Severity:** NITPICK

### 7. Unfinished Work

**Rule:** Flag a marker admitting the change is incomplete.

**Detection:** TODO, FIXME, or HACK added by the change.

**Severity:** NITPICK

## Numeric Anti-Patterns

### 8. Money in Floating Point

**Rule:** Flag money represented or summed as a floating point number.

**Violation Example:**

```ts
const total = items.reduce((sum, item) => sum + item.price, 0);
```

**Correct Pattern:**

```ts
const totalCents = items.reduce((sum, item) => sum + item.priceCents, 0);
```

**Why This Matters:** Amounts drift by fractions of a unit and the error
compounds over a large enough basket.

**Severity:** CRITICAL

## Temporal Anti-Patterns

### 9. Date Boundary Ignores Timezone

**Rule:** Flag a comparison of a date-only boundary that is computed in the
machine's local timezone rather than the one the data belongs to.

**Violation Example:**

```ts
const startOfDay = new Date(year, month, day);
return records.filter((record) => record.at >= startOfDay);
```

**Correct Pattern:**

```ts
const startOfDay = zonedStartOfDay(year, month, day, account.timeZone);
return records.filter((record) => record.at >= startOfDay);
```

**Detection:** A Date built from parts, or a midnight boundary, used to filter
or bucket records that belong to a user or account with its own timezone.

**Why This Matters:** The report is correct on the machine that wrote it and
wrong by a day for anyone else, which is the hardest kind of bug to see.

**Severity:** CRITICAL

## Testing Anti-Patterns

### 10. Weakened Test Assertion

**Rule:** Flag an assertion that was made less specific, or a test that was
skipped, in the same change that altered the behaviour it covers.

**Violation Example:**

```ts
expect(total).toBeDefined();
```

**Correct Pattern:**

```ts
expect(total).toBe(1025);
```

**Detection:** An assertion changed from an exact comparison to an existence
check, a removed expectation, or a test marked skipped or exclusive.

**Why This Matters:** A test that no longer fails on the old bug is not
evidence the bug is fixed. It is evidence that nobody will notice next time.

**Severity:** WARNING

## Deletion Anti-Patterns

### 11. Removed Guard

**Rule:** Flag the removal of a check that prevented an unsafe path: a
permission test, a null check, an early return, or a cleanup.

**Violation Example:**

```ts
export function open(document: Document, user: User) {
  return document.contents;
}
```

**Detection:** A deleted conditional that threw, returned early, or refused an
action. Read the removed code, not only the code that replaced it.

**Why This Matters:** The diff shows what is gone but not who relied on it.
A removed guard is the classic regression that no test covers, because the
test was written for the behaviour that remains.

**Severity:** CRITICAL

### 12. Deleted File With a Live Caller

**Rule:** Flag the deletion of a whole file while code elsewhere still
imports or calls what it exported.

**Violation Example:**

```ts
// deleted: src/orders/retry.ts, which exported retryOnce
// unchanged elsewhere: import { retryOnce } from "./retry";
```

**Detection:** A file removed in its entirety. Search the rest of the tree
for imports of it; the caller usually does not appear in the diff at all,
because deleting a module does not touch the files that depend on it.

**Why This Matters:** The diff lists the deletion but never the breakage.
Every surviving import now resolves to nothing, and the failure surfaces at
build or run time in a file the review never showed.

**Severity:** CRITICAL

## Duplication Anti-Patterns

### 13. Duplicated Helper

**Rule:** Flag a new function that re-implements an existing helper's job
instead of calling it, especially when the new copy drops a guard or an edge
case the original handles.

**Violation Example:**

```ts
// existing: mergePrefs, which skips undefined overrides
export function applyPrefOverrides(base: PrefValues, override: PrefValues) {
  return { ...base, ...override };
}
```

**Detection:** An added function whose name or shape mirrors one already in
the tree. Search for the existing helper before accepting the new one; the
original does not appear in the diff, because nothing changed it.

**Why This Matters:** Two implementations of one job drift. The copy that
skipped the guard is the one the next caller reaches for, and the behaviour
divergence surfaces as a bug that reads like it was always there.

**Severity:** WARNING

## Dependency Anti-Patterns

### 14. Changed Default Nobody Opted Into

**Rule:** Flag a change to an exported default value when consumers in other
code take it implicitly and the change is not the stated purpose of the work.

**Violation Example:**

```ts
export const DEFAULT_TIMEOUT_SECONDS = 5; // was 30
```

**Detection:** A changed initialiser on an exported constant that other code
imports without overriding. The consumers keep compiling, which is why the
diff looks harmless: nothing names the files whose behaviour just changed.

**Why This Matters:** A default is a promise consumers built on without
writing it down. Tightening a timeout, a limit, or a threshold under them
changes behaviour at a distance, and the operations that no longer fit the
new value fail in code the change never touched.

**Severity:** WARNING

## Review Output

Report confirmed findings grouped by severity, most severe first. State what
was reviewed and what was found clean, so the reader can tell the difference
between nothing wrong and nothing looked at.
