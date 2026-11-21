# General rules

What any change is held to, whatever it is written in. The examples are
TypeScript. Each rule names something visible in the change and in the files
around it, so a finding under it can be proven from the code.

## Purpose

Find the defects a change introduces that do not depend on its language or
framework: a failure hidden, input trusted, a credential or personal data
exposed, a resource left open, behaviour changed with nothing to prove it,
and work left unfinished.

Report a finding only when the code shows it. Nothing here is a matter of
taste. A finding that cannot be traced to lines of the change, or to code
those lines call or remove, is not reported.

## Review scope

Judge what the change introduced.

- Added and modified lines, and the code they call or are called by.
- Removed lines: what they did, and what depended on it.
- Code the change did not touch is read to understand the change. It is not
  reported on.

## Severity levels

| Level    | Meaning                                                        |
| -------- | -------------------------------------------------------------- |
| CRITICAL | Data lost or exposed, a failure hidden, or behaviour now wrong |
| WARNING  | A defect waiting for its conditions, or proof that is missing  |
| NITPICK  | Worth saying once. No rule here uses it.                       |

## Mechanical sweeps

Each pattern is searched for in every added line. A hit is a line to read
under the rule named, not a finding.

| Sweep for                                         | What a hit means                    |
| ------------------------------------------------- | ----------------------------------- |
| `catch\s*(\([^)]*\))?\s*\{\s*\}`                  | Rule 1: a catch that does nothing   |
| `[Pp]assword\w*\s*[:=]\s*["'][^"']{8,}["']`       | Rule 5: a password written in       |
| `[Ss]ecret\w*\s*[:=]\s*["'][^"']{8,}["']`         | Rule 5: a secret written in         |
| `[Aa]pi_?[Kk]ey\w*\s*[:=]\s*["'][^"']{8,}["']`    | Rule 5: a key written in            |
| `[Tt]oken\w*\s*[:=]\s*["'][^"']{8,}["']`          | Rule 5: a token written in          |
| `[Ll]og\S*\(.*[Pp]assword`                        | Rule 6: a password in a log line    |
| `[Ll]og\S*\(.*[Tt]oken`                           | Rule 6: a token in a log line       |
| `\.only\(`                                        | Rule 9: one test focused            |
| `\.skip\(`                                        | Rule 9: a test switched off         |
| `\bdebugger\b`                                    | Rule 10: a breakpoint left in       |
| `console\.log\(`                                  | Rule 10: a print left in            |
| `\bTODO\b`                                        | Rule 11: work marked as not done    |
| `\bFIXME\b`                                       | Rule 11: a fault marked and left    |

## Failures

A failure that nobody is told about is found later, by a person, in data.

### 1. Swallowed error

**Rule:** An error that is caught is handled, passed on or recorded. A catch
that does none of the three hides the failure from everyone who could act on
it.

**Violation Example:**

```ts
async function saveOrder(order: Order): Promise<void> {
  try {
    await db.orders.insert(order);
  } catch (error) {}
}
```

**Correct Pattern:**

```ts
async function saveOrder(order: Order): Promise<void> {
  try {
    await db.orders.insert(order);
  } catch (error) {
    throw new OrderNotSavedError(order.id, { cause: error });
  }
}
```

**Detection:** Read every catch block, rejection handler and error callback
the change adds or edits, and say what it does with the error. A block that
holds only a comment does nothing.

**Severity:** CRITICAL

**Why This Matters:** The caller goes on as if the work was done, and the
first sign of the failure is whatever the missing work was for. Source:
[CWE-390: Detection of Error Condition Without Action](https://cwe.mitre.org/data/definitions/390.html),
CWE 5.0, read 2026-11-21.

### 2. Failure reported as success

**Rule:** A path that fails does not return what success returns. An empty
list, a default or `false` in place of an error tells the caller that
nothing went wrong.

**Violation Example:**

```ts
async function loadPermissions(userId: string): Promise<string[]> {
  try {
    return await api.get(`/users/${userId}/permissions`);
  } catch (error) {
    logger.warn("permissions unavailable", { userId, error });
    return [];
  }
}
```

**Correct Pattern:**

```ts
async function loadPermissions(userId: string): Promise<string[]> {
  try {
    return await api.get(`/users/${userId}/permissions`);
  } catch (error) {
    throw new PermissionsUnavailableError(userId, { cause: error });
  }
}
```

**Detection:** In each failure path the change adds (a catch, an error
branch, a timeout), compare what is returned with what the success path
returns. Where a caller cannot tell the two apart, read the callers: one that
acts on the value as real is the finding.

**Severity:** CRITICAL

**Why This Matters:** A user with no permissions and a user whose
permissions could not be read are different facts, and the code after the
call can no longer tell which it has. Source:
[CWE-392: Missing Report of Error Condition](https://cwe.mitre.org/data/definitions/392.html),
CWE 5.0, read 2026-11-21.

### 3. Unchecked result

**Rule:** Where a call reports failure through what it returns (a status, an
error field, a null, a boolean), that result is read before the work goes
on.

**Violation Example:**

```ts
async function fetchInvoice(id: string): Promise<Invoice> {
  const response = await fetch(`${BILLING_URL}/invoices/${id}`);
  return parseInvoice(await response.json());
}
```

**Correct Pattern:**

```ts
async function fetchInvoice(id: string): Promise<Invoice> {
  const response = await fetch(`${BILLING_URL}/invoices/${id}`);
  if (!response.ok) throw new InvoiceRequestError(id, response.status);
  return parseInvoice(await response.json());
}
```

**Detection:** For each call the change adds, find how the callee reports
failure, from its signature or its documentation. Where failure comes back
as a value, find the line that reads it. In the example, `fetch` resolves
for a 404 or a 500 and only `response.ok` or `response.status` says so.

**Severity:** WARNING

**Why This Matters:** The error body of a failed request is parsed as if it
were the invoice. Source:
[CWE-252: Unchecked Return Value](https://cwe.mitre.org/data/definitions/252.html),
CWE 5.0, read 2026-11-21; for the example,
[MDN: Window.fetch()](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch),
read 2026-11-21.

## Boundaries

Where data crosses into the program, or out of it to somewhere it is kept.

### 4. Unvalidated input at a boundary

**Rule:** Data that arrives from outside the program (a request, a file, an
environment variable, a message, another service's reply) is checked for the
shape and range the code relies on before it is used.

**Violation Example:**

```ts
app.post("/transfers", async (request, response) => {
  const { fromAccount, toAccount, amount } = request.body;
  await ledger.transfer(fromAccount, toAccount, amount);
  response.status(201).end();
});
```

**Correct Pattern:**

```ts
app.post("/transfers", async (request, response) => {
  const { fromAccount, toAccount, amount } = request.body ?? {};
  const accountsNamed = typeof fromAccount === "string" && typeof toAccount === "string";
  if (!accountsNamed || !Number.isInteger(amount) || amount <= 0) {
    response.status(400).json({ error: "A transfer names two accounts and a whole amount above 0." });
    return;
  }
  await ledger.transfer(fromAccount, toAccount, amount);
  response.status(201).end();
});
```

**Detection:** Find where the change reads from outside: a request's body,
query or headers, a file, the environment, a queue, another service's reply.
Follow each value to its first use. A type annotation or a cast is not a
check: it holds when the code is compiled and says nothing of what arrives.

**Severity:** CRITICAL

**Why This Matters:** A negative amount, a missing account or a string where
a number is expected reaches the ledger as if it had been asked for. Source:
[CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html),
CWE 5.0, read 2026-11-21.

### 5. Credential in code

**Rule:** A password, key, token or other credential is never written into a
file the repository holds: not in source, not in configuration, not in a
test, not in a comment.

**Violation Example:**

```ts
export const config = {
  dbPassword: "hunter2-not-real",
  sessionSecret: "change-me-not-real",
  paymentsApiKey: "k3y-not-a-real-one",
  webhookToken: "t0ken-not-real-000",
};
```

**Correct Pattern:**

```ts
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set.`);
  return value;
}

export const config = {
  dbPassword: required("DB_PASSWORD"),
  sessionSecret: required("SESSION_SECRET"),
  paymentsApiKey: required("PAYMENTS_API_KEY"),
  webhookToken: required("WEBHOOK_TOKEN"),
};
```

**Detection:** Read every string literal the change assigns to a name or
passes where a credential goes: a connection string with a password in it,
an authorization header, a private key. A value that reads as a placeholder
still counts when the code would run with it.

**Severity:** CRITICAL

**Why This Matters:** Everyone who can read the repository, and every copy
and backup of it, holds the credential, and changing it means changing the
code. Source:
[CWE-798: Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html),
CWE 5.0, read 2026-11-21.

### 6. Sensitive data in a log

**Rule:** Nothing written to a log is a password, a token, a key, or
personal data beyond the identifier needed to find the record.

**Violation Example:**

```ts
logger.info(`login attempt for ${email} with password ${password}`);
logger.debug("issued session", { token: session.token });
```

**Correct Pattern:**

```ts
logger.info("login attempt", { userId: user.id });
logger.debug("issued session", { sessionId: session.id });
```

**Detection:** Read each value a logging call the change adds or edits is
given, and follow an object to its fields. A whole request, a whole user
record or a whole error from an HTTP client often carries a header or a
field that must not be written.

**Severity:** CRITICAL

**Why This Matters:** Everyone and everything the log is given to (support
staff, a log service, a backup) now holds the password too. Source:
[CWE-532: Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html),
CWE 5.0, read 2026-11-21.

## Resources

What the program holds open costs something until it is let go.

### 7. Resource not released on every path

**Rule:** Whatever the code opens, acquires or starts (a file, a connection,
a lock, a timer, a subscription, a temporary file) is released on every path
out, the failing ones included.

**Violation Example:**

```ts
async function exportReport(path: string, rows: Row[]): Promise<void> {
  const file = await open(path, "w");
  for (const row of rows) {
    await file.write(format(row));
  }
  await file.close();
}
```

**Correct Pattern:**

```ts
async function exportReport(path: string, rows: Row[]): Promise<void> {
  const file = await open(path, "w");
  try {
    for (const row of rows) {
      await file.write(format(row));
    }
  } finally {
    await file.close();
  }
}
```

**Detection:** For each acquisition the change adds, list the ways out of
the code after it: a return, a throw, an awaited call that can reject, a
loop left early. Find the release on each.

**Severity:** WARNING

**Why This Matters:** One failed write leaves the file open, and enough of
them leave the process with none to open. Source:
[CWE-772: Missing Release of Resource after Effective Lifetime](https://cwe.mitre.org/data/definitions/772.html),
CWE 5.0, read 2026-11-21.

## Proof

What shows that the change does what it says.

### 8. Behaviour changed with nothing to prove it

**Rule:** A change to what the code does comes with a test that would fail
without it, in the same change.

**Violation Example:**

```text
src/pricing/discount.ts          changed: orders over 500 get 10% off, was 5%
tests/pricing/                   not changed
```

**Correct Pattern:**

```text
src/pricing/discount.ts          changed: orders over 500 get 10% off, was 5%
tests/pricing/discount.test.ts   changed: asserts 10% at 501 and none at 500
```

**Detection:** List what the change alters in behaviour: a branch, a
condition, a default, a returned value. For each, look for a test that
exercises it, first in the change and then among the tests already there. A
test that passes with the change taken out proves nothing about it. A
rename, a comment or formatting has no behaviour to prove.

**Severity:** WARNING

**Why This Matters:** The next change to the same lines has nothing to tell
it that it broke this one. Source:
[Google Engineering Practices: What to look for in a code review, Tests](https://google.github.io/eng-practices/review/reviewer/looking-for.html#tests),
read 2026-11-21.

### 9. Test weakened or switched off

**Rule:** A change does not make a test pass by asking less of it: an
assertion removed or loosened, an expected value edited to match new output,
a test skipped, or one test focused so that the others do not run.

**Violation Example:**

```ts
it.skip("refuses a transfer larger than the balance", async () => {
  await expect(transfer(account, 600)).rejects.toThrow(InsufficientFunds);
});

it.only("applies the daily limit", async () => {
  const result = await transfer(account, 400);
  expect(result).toBeDefined();
});
```

**Correct Pattern:**

```ts
it("refuses a transfer larger than the balance", async () => {
  await expect(transfer(account, 600)).rejects.toThrow(InsufficientFunds);
});

it("applies the daily limit", async () => {
  const result = await transfer(account, 400);
  expect(result).toEqual({ status: "refused", reason: "daily-limit" });
});
```

**Detection:** In every test file the change touches, read what was removed
and what replaced it. An exact assertion made loose, an expectation deleted,
a skip, a focus, a longer timeout and a retry all count. Then find what made
the old test fail: that is the defect the change is hiding.

**Severity:** CRITICAL

**Why This Matters:** The suite still passes and now proves less, and the
behaviour the old assertion held is free to break. Source:
[Google Engineering Practices: What to look for in a code review, Tests](https://google.github.io/eng-practices/review/reviewer/looking-for.html#tests),
read 2026-11-21.

## Leftovers

What was written to build the change and is not part of it.

### 10. Debugging left in

**Rule:** Code written to watch the program while it was being built does
not ship: a breakpoint, a print of a value, a condition forced true, a block
commented out to try something.

**Violation Example:**

```ts
function applyDiscount(order: Order): number {
  debugger;
  console.log("order", order);
  const rate = order.total > 500 ? 0.1 : 0;
  return order.total * (1 - rate);
}
```

**Correct Pattern:**

```ts
function applyDiscount(order: Order): number {
  const rate = order.total > 500 ? 0.1 : 0;
  return order.total * (1 - rate);
}
```

**Detection:** Read added lines that print, pause or dump a value, and
conditions made constant. A line written through the project's logger, at a
level it runs with in production, is not this rule.

**Severity:** WARNING

**Why This Matters:** A print of a whole order is a log line nobody chose to
keep, and a breakpoint stops the program wherever a debugger is attached.
Source:
[CWE-489: Active Debug Code](https://cwe.mitre.org/data/definitions/489.html),
CWE 5.0, read 2026-11-21.

### 11. Unfinished work shipped

**Rule:** A change does not add a marker saying that part of what it does is
missing. A TODO or FIXME the change introduces is done in the change, or
names where the work is tracked.

**Violation Example:**

```ts
function canRefund(order: Order, user: User): boolean {
  // TODO: check the user owns the order
  // FIXME: refunds over the limit need approval
  return order.status === "paid";
}
```

**Correct Pattern:**

```ts
function canRefund(order: Order, user: User): boolean {
  if (order.ownerId !== user.id) return false;
  if (order.total > REFUND_LIMIT) return user.canApproveRefunds;
  return order.status === "paid";
}
```

**Detection:** Read the comments the change adds that say something is not
done, not handled or wrong, and hold what each names against what the change
does. A check the marker says is missing is a finding under this rule, and
under the rule for that check.

**Severity:** WARNING

**Why This Matters:** The comment is the only record that the check is
missing, and it is read by nobody who is deciding whether the change is
safe. Source:
[CWE-546: Suspicious Comment](https://cwe.mitre.org/data/definitions/546.html),
CWE 5.0, read 2026-11-21.

## Removals

What the change takes away did something, for someone.

### 12. Removed guard

**Rule:** A check the change removes or loosens (a validation, a permission
check, a null or bounds check, an error handler) is replaced by something
that holds the same condition, or the condition is shown to be impossible
now.

**Violation Example:**

```diff
 async function deleteProject(user: User, projectId: string): Promise<void> {
-  if (!user.roles.includes("admin")) throw new Forbidden();
   await projects.delete(projectId);
 }
```

**Correct Pattern:**

```diff
 async function deleteProject(user: User, projectId: string): Promise<void> {
-  if (!user.roles.includes("admin")) throw new Forbidden();
+  await requirePermission(user, "project:delete", projectId);
   await projects.delete(projectId);
 }
```

**Detection:** Read every removed line that tests a condition, and every
condition made weaker. Name what it stopped, then find where that is stopped
now. Read the callers that relied on the check.

**Severity:** CRITICAL

**Why This Matters:** The code reads as simpler and does the same on every
path a test walks, and the one case the check existed for now goes through.
Source:
[CWE-754: Improper Check for Unusual or Exceptional Conditions](https://cwe.mitre.org/data/definitions/754.html),
CWE 5.0, read 2026-11-21.
