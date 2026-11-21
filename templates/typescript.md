# TypeScript rules

What a change to TypeScript is held to: the places where the code tells
the compiler to stop checking, and the places where the compiler was never
checking what the code relies on. Each rule names something visible in the
change and the files around it.

## Purpose

The compiler proves a great deal, and every rule here is a way a change
makes it prove less than the code now assumes: a type switched off, a value
asserted to be what nothing checked, a promise nobody waits for, a union
grown past the code that handles it.

Report a finding only when the code shows it. Where the compiler's own
configuration already refuses the pattern (a strict flag, a lint rule that
fails the build), say so and report nothing.

## Review scope

Judge what the change introduced.

- Added and modified lines, and the declarations they rely on.
- A type the change widens or a union it adds a member to: every place that
  reads it, changed or not.
- Code the change did not touch is read to understand the change. It is not
  reported on.

## Severity levels

| Level    | Meaning                                                         |
| -------- | --------------------------------------------------------------- |
| CRITICAL | A wrong value or a lost failure the compiler can no longer see  |
| WARNING  | A check given up that the code still leans on                   |
| NITPICK  | Worth saying once. No rule here uses it.                        |

## Mechanical sweeps

Each pattern is searched for in every added line. A hit is a line to read
under the rule named, not a finding.

| Sweep for                       | What a hit means                            |
| ------------------------------- | ------------------------------------------- |
| `:\s*any\b`                     | Rule 1: a value declared as any             |
| `\bas any\b`                    | Rule 1: a value asserted to any             |
| `JSON\.parse\(.*\)\s+as\s`      | Rule 2: parsed data asserted to a type      |
| `\bas unknown as\b`             | Rule 2: an assertion made through unknown   |
| `[\w\])]!\.`                    | Rule 3: a non-null assertion before a member |
| `[\w\])]![;)]`                  | Rule 3: a non-null assertion on a value     |
| `@ts-ignore`                    | Rule 4: the next line's errors switched off |
| `@ts-expect-error\s*$`          | Rule 4: an expected error with no reason    |
| `\.forEach\(async\b`            | Rule 6: async work nothing waits for        |

## Escapes from the type checker

Each of these compiles, and each is the code telling the compiler not to
look.

### 1. Explicit any

**Rule:** A change does not declare or assert a value as `any`. A value
whose shape is not known is `unknown`, and is narrowed before it is used.

**Violation Example:**

```ts
export function totalOf(payload: any): number {
  const lines = payload.lines as any;
  return lines.reduce((sum: number, line: { price: number }) => sum + line.price, 0);
}
```

**Correct Pattern:**

```ts
interface Line {
  price: number;
}

export function totalOf(payload: { lines: Line[] }): number {
  return payload.lines.reduce((sum, line) => sum + line.price, 0);
}
```

**Detection:** Read every annotation, assertion and generic argument the
change adds for `any`, and every value that then flows from it: a property
of an `any` is an `any`, so the hole is as wide as the code that touches
the value.

**Severity:** WARNING

**Why This Matters:** Nothing done with the value is checked from there on,
so a renamed field or a missing one is found when the code runs. Source:
[TypeScript Handbook: Everyday Types, any](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#any),
read 2026-11-21.

### 2. Assertion on a value nothing checked

**Rule:** A type assertion is made only where the code has already
established what it asserts. Data from outside (parsed JSON, a reply, a
file, a message) is checked into its type, not asserted into it, and an
assertion is never forced through `unknown` or `any`.

**Violation Example:**

```ts
export async function loadSettings(path: string): Promise<Settings> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as Settings;
}

const legacy = oldSettings as unknown as Settings;
```

**Correct Pattern:**

```ts
export async function loadSettings(path: string): Promise<Settings> {
  const text = await readFile(path, "utf8");
  return parseSettings(JSON.parse(text));
}

function parseSettings(value: unknown): Settings {
  if (typeof value !== "object" || value === null) {
    throw new Error("Settings must be an object.");
  }
  const { theme, pageSize } = value as { theme?: unknown; pageSize?: unknown };
  if (theme !== "light" && theme !== "dark") {
    throw new Error('Settings need a theme of "light" or "dark".');
  }
  if (typeof pageSize !== "number") throw new Error("Settings need a numeric pageSize.");
  return { theme, pageSize };
}
```

**Detection:** For each assertion the change adds, find the line that makes
it true: a check of the value's shape, or a declaration that already says
it. Where there is none, the assertion is the only thing saying so. An
assertion that had to go through `unknown` is one the compiler refused.

**Severity:** CRITICAL

**Why This Matters:** An assertion is removed when the code is compiled and
nothing checks it when the code runs, so a settings file with a field
missing is handed on as complete. Source:
[TypeScript Handbook: Everyday Types, Type Assertions](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions),
read 2026-11-21.

### 3. Non-null assertion on a value that can be null

**Rule:** A `!` after a value is written only where the lines around it
show the value cannot be null or undefined. Where it can be, the code
checks and says what happens when it is.

**Violation Example:**

```ts
const user = users.find((entry) => entry.id === id)!;
sendWelcome(user.email!.toLowerCase());
```

**Correct Pattern:**

```ts
const user = users.find((entry) => entry.id === id);
if (user === undefined) throw new UserNotFoundError(id);
if (user.email === null) return;
sendWelcome(user.email.toLowerCase());
```

**Detection:** For each `!` the change adds, read the declared type of the
value and ask what makes the null case impossible here: a check a few lines
up, or a guarantee of the call. A search that can find nothing, a map
lookup and an optional field all can be empty.

**Severity:** WARNING

**Why This Matters:** The assertion changes nothing when the code runs: the
value is still undefined when it is, and the failure moves to wherever it
is next used. Source:
[TypeScript Handbook: Everyday Types, Non-null Assertion Operator](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#non-null-assertion-operator-postfix-),
read 2026-11-21.

### 4. Checker silenced by a comment

**Rule:** A change does not switch the compiler off with a comment:
`@ts-ignore`, `@ts-nocheck`, or an `@ts-expect-error` that does not say
what error it expects and why it cannot be fixed here.

**Violation Example:**

```ts
// @ts-ignore
order.total = computeTotal(order.lines, discount);

// @ts-expect-error
legacyClient.send(order);
```

**Correct Pattern:**

```ts
order.total = computeTotal(order.lines, discount ?? 0);

// @ts-expect-error legacy-client 2.x types send() as taking no argument; it takes one.
legacyClient.send(order);
```

**Detection:** Read each directive comment the change adds, then the error
it hides: take the comment out in your head and name what the compiler
would say. An error that names a real mismatch is the finding, and the
comment is how it was hidden.

**Severity:** WARNING

**Why This Matters:** The comment hides every error on the line under it,
the one it was written for and any that a later change puts there. Sources:
[typescript-eslint: ban-ts-comment](https://typescript-eslint.io/rules/ban-ts-comment/)
and
[TypeScript 2.6 release notes: @ts-ignore comments](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-6.html),
read 2026-11-21.

## Promises

Work the code starts and does not wait for can fail with no code told of it.

### 5. Promise left floating

**Rule:** A promise the change creates is awaited, returned, or given a
handler for its failure. A call whose promise is dropped runs after the
code that depended on it, and its rejection reaches nobody.

**Violation Example:**

```ts
export async function checkout(order: Order): Promise<Receipt> {
  const receipt = await charge(order);
  sendReceiptEmail(order.customer, receipt);
  audit.record("checkout", order.id);
  return receipt;
}
```

**Correct Pattern:**

```ts
export async function checkout(order: Order): Promise<Receipt> {
  const receipt = await charge(order);
  await sendReceiptEmail(order.customer, receipt);
  audit.record("checkout", order.id).catch(reportAuditFailure);
  return receipt;
}
```

**Detection:** For each call the change adds, read what the callee returns.
Where it is a promise, find the `await`, the `return`, or the handler. A
`void` in front of the call silences a linter and handles nothing.

**Severity:** CRITICAL

**Why This Matters:** The customer is told the order is placed before the
receipt is sent, and when sending fails nothing records that it did.
Source:
[typescript-eslint: no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/),
read 2026-11-21.

### 6. Async function where nothing waits for it

**Rule:** An async function is not handed to code that ignores what it
returns (`forEach`, an event listener, a callback typed to return nothing),
and a promise is not used as a condition.

**Violation Example:**

```ts
orders.forEach(async (order) => {
  await archive(order);
});
logger.info("archived", { count: orders.length });
```

**Correct Pattern:**

```ts
for (const order of orders) {
  await archive(order);
}
logger.info("archived", { count: orders.length });
```

**Detection:** Read where each async function the change adds is passed.
Where the receiver's type says the callback returns nothing, nothing waits.
Read each condition the change adds for a call that returns a promise: a
promise is always truthy.

**Severity:** CRITICAL

**Why This Matters:** The log line is written before any order is archived,
and an archive that fails is a rejection no code is waiting for. Source:
[typescript-eslint: no-misused-promises](https://typescript-eslint.io/rules/no-misused-promises/),
read 2026-11-21.

## Types the code does not check

The type says more than the code has made sure of.

### 7. Switch that does not cover its union

**Rule:** A switch over a union handles every member by name and ends in a
default that the compiler refuses when a member is missing. A default that
answers for whatever is left answers for members not yet written.

**Violation Example:**

```ts
type PaymentState = "pending" | "paid" | "refunded" | "disputed";

function label(state: PaymentState): string {
  switch (state) {
    case "pending":
      return "Waiting for payment";
    case "paid":
      return "Paid";
    default:
      return "Refunded";
  }
}
```

**Correct Pattern:**

```ts
type PaymentState = "pending" | "paid" | "refunded" | "disputed";

function label(state: PaymentState): string {
  switch (state) {
    case "pending":
      return "Waiting for payment";
    case "paid":
      return "Paid";
    case "refunded":
      return "Refunded";
    case "disputed":
      return "In dispute";
    default: {
      const unhandled: never = state;
      throw new Error(`No label for payment state ${String(unhandled)}`);
    }
  }
}
```

**Detection:** Where the change adds a member to a union, find every switch
and chain of comparisons over it, changed or not. Where the change adds a
switch, list the union's members against its cases. A default that returns
a value is read as a case for every member not named.

**Severity:** WARNING

**Why This Matters:** A disputed payment is shown as refunded, and the
compiler had no way to object. Source:
[TypeScript Handbook: Narrowing, Exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking),
read 2026-11-21.

### 8. Indexed value taken as present

**Rule:** A value read by key or by index from a record, a map or an array
is checked before it is used, unless the lines around it show the key is
there.

**Violation Example:**

```ts
const rates: Record<string, number> = { ZA: 0.15, BW: 0.14 };

export function taxFor(order: Order): number {
  return order.total * rates[order.region];
}
```

**Correct Pattern:**

```ts
const rates: Record<string, number> = { ZA: 0.15, BW: 0.14 };

export function taxFor(order: Order): number {
  const rate = rates[order.region];
  if (rate === undefined) throw new Error(`No tax rate is set for region ${order.region}.`);
  return order.total * rate;
}
```

**Detection:** Read each indexed read the change adds whose key comes from
data: a field, a parameter, a loop over another collection. Then read the
project's compiler options: with `noUncheckedIndexedAccess` on, the
compiler already refuses the violation and there is nothing to report.

**Severity:** WARNING

**Why This Matters:** For a region with no rate the type says number and
the value is undefined, so the tax comes out as NaN. Source:
[TSConfig Reference: noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html),
read 2026-11-21.

### 9. Type predicate that does not check what it claims

**Rule:** A function that returns `value is T` checks, in its body,
everything about `T` that its callers go on to use.

**Violation Example:**

```ts
function isInvoice(value: unknown): value is Invoice {
  return typeof value === "object" && value !== null;
}
```

**Correct Pattern:**

```ts
function isInvoice(value: unknown): value is Invoice {
  if (typeof value !== "object" || value === null) return false;
  const { id, total } = value as { id?: unknown; total?: unknown };
  return typeof id === "string" && typeof total === "number";
}
```

**Detection:** For each type predicate the change adds or edits, list the
fields of the type it claims and find the check of each in the body. Then
read one caller: what it uses after the predicate passes is what the body
must have checked.

**Severity:** CRITICAL

**Why This Matters:** Every caller treats the value as an invoice from the
moment the function returns true, and the compiler takes the function's
word for it. Source:
[TypeScript 5.5 release notes: Inferred Type Predicates](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#inferred-type-predicates),
read 2026-11-21.
