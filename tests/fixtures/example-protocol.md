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

## Review Output

Report confirmed findings grouped by severity, most severe first. State what
was reviewed and what was found clean, so the reader can tell the difference
between nothing wrong and nothing looked at.
