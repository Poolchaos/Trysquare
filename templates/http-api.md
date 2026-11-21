# HTTP API and database rules

What a change to an endpoint and the data behind it is held to: who may
ask, what a request is trusted to carry, what a failure tells the caller,
and how the store is read and written. The examples are TypeScript with a
SQL store. Each rule names something visible in the change and the files
around it.

## Purpose

An endpoint answers anyone who can reach it, with whatever they chose to
send. Every rule here is a way a change lets a caller do, read or break
more than the code's author had in mind.

Report a finding only when the code shows it. A check that lives in the
client is no check: read the server's code for it.

## Review scope

Judge what the change introduced.

- Added and modified routes, handlers and queries, and the middleware and
  helpers they rely on.
- For a new route, how the router it is added to is mounted: what runs
  before the handler is part of the handler.
- Code the change did not touch is read to understand the change. It is not
  reported on.

## Severity levels

| Level    | Meaning                                                       |
| -------- | ------------------------------------------------------------- |
| CRITICAL | Another person's data read or changed, or the store left wrong |
| WARNING  | A caller told too much, or work with no bound on its size     |
| NITPICK  | Worth saying once. No rule here uses it.                      |

## Mechanical sweeps

Each pattern is searched for in every added line. A hit is a line to read
under the rule named, not a finding.

| Sweep for                        | What a hit means                              |
| -------------------------------- | --------------------------------------------- |
| `Object\.assign\(.*\.body\b`     | Rule 4: a request body copied onto a record   |
| `\.stack\b`                      | Rule 5: a stack trace read, perhaps sent      |
| `\bWHERE\b.*\$\{`                | Rule 6: a value written into a statement      |
| `\bWHERE\b.*["']\s*\+`           | Rule 6: a statement joined to a value         |

## Who is asking

The server decides what a caller may do, on every request.

### 1. Endpoint that does not check who asks

**Rule:** Every endpoint that reads or changes something decides, on the
server, whether this caller may: who they are, and that they may do this to
this thing.

**Violation Example:**

```ts
router.delete("/projects/:id", async (request, response) => {
  await projects.remove(request.params.id);
  response.status(204).end();
});
```

**Correct Pattern:**

```ts
router.delete("/projects/:id", requireSignIn, async (request, response) => {
  const project = await projects.find(request.params.id);
  if (project === null) return response.status(404).end();
  if (!request.user.can("project:delete", project)) return response.status(403).end();
  await projects.remove(project.id);
  response.status(204).end();
});
```

**Detection:** For each route the change adds or edits, find where the
caller is identified and where what they may do is decided. Read how the
router is mounted: a check on a sibling route, or in the client, does not
cover this one.

**Severity:** CRITICAL

**Why This Matters:** Anyone who can send the request deletes the project.
Source:
[CWE-862: Missing Authorization](https://cwe.mitre.org/data/definitions/862.html),
CWE 5.0, read 2026-11-21.

### 2. Record reached by an id the caller chose

**Rule:** A record looked up by an id from the request is looked up as the
caller's: the lookup itself, or a check straight after it, holds the record
to the person asking.

**Violation Example:**

```ts
router.get("/invoices/:id", requireSignIn, async (request, response) => {
  const invoice = await invoices.find(request.params.id);
  response.json(invoice);
});
```

**Correct Pattern:**

```ts
router.get("/invoices/:id", requireSignIn, async (request, response) => {
  const invoice = await invoices.findForCustomer(request.params.id, request.user.customerId);
  if (invoice === null) return response.status(404).end();
  response.json(invoice);
});
```

**Detection:** For each id the change reads from a path, a query or a body,
follow it to the lookup. Being signed in says who the caller is, not which
records are theirs: find the line that ties the record to them.

**Severity:** CRITICAL

**Why This Matters:** A signed-in customer reads any invoice by changing
the number in the address. Source:
[CWE-639: Authorization Bypass Through User-Controlled Key](https://cwe.mitre.org/data/definitions/639.html),
CWE 5.0, read 2026-11-21.

## What the request carries

A request holds what its sender chose to put in it.

### 3. Body used without being checked

**Rule:** What a request carries (its body, its query, its headers) is
checked for the shape and range the handler relies on before any of it is
used, and a request that fails is refused with a 400 that says why.

**Violation Example:**

```ts
router.post("/transfers", requireSignIn, async (request, response) => {
  const { toAccount, amount } = request.body;
  await ledger.transfer(request.user.accountId, toAccount, amount);
  response.status(201).end();
});
```

**Correct Pattern:**

```ts
router.post("/transfers", requireSignIn, async (request, response) => {
  const { toAccount, amount } = request.body ?? {};
  if (typeof toAccount !== "string" || !Number.isInteger(amount) || amount <= 0) {
    return response.status(400).json({ error: "A transfer names an account and a whole amount above 0." });
  }
  await ledger.transfer(request.user.accountId, toAccount, amount);
  response.status(201).end();
});
```

**Detection:** Follow each value the handler takes from the request to its
first use. A type annotation or a cast on the body is not a check: it holds
when the code is compiled and says nothing of what arrives.

**Severity:** CRITICAL

**Why This Matters:** A negative amount moves money the other way, and a
missing one reaches the ledger as undefined. Source:
[CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html),
CWE 5.0, read 2026-11-21.

### 4. Body copied onto a record whole

**Rule:** A handler names the fields a caller may set and takes those. It
does not copy the request's body onto a stored record, or hand the body to
the code that writes one.

**Violation Example:**

```ts
router.patch("/users/:id", requireSignIn, async (request, response) => {
  const user = await users.findOwned(request.params.id, request.user.id);
  if (user === null) return response.status(404).end();
  Object.assign(user, request.body);
  await users.save(user);
  response.json(user);
});
```

**Correct Pattern:**

```ts
router.patch("/users/:id", requireSignIn, async (request, response) => {
  const user = await users.findOwned(request.params.id, request.user.id);
  if (user === null) return response.status(404).end();
  const { displayName, email } = request.body ?? {};
  if (typeof displayName !== "string" || typeof email !== "string") {
    return response.status(400).json({ error: "A profile has a displayName and an email." });
  }
  const saved = await users.save({ ...user, displayName, email });
  response.json(saved);
});
```

**Detection:** Read each place the change passes a body, or a spread of
one, to an update, a create or an assign. Then read the record's fields for
one a caller must not set: a role, an owner, a balance, a verified flag.

**Severity:** CRITICAL

**Why This Matters:** A caller who adds a role to the body they send is
saved with it. Source:
[CWE-915: Improperly Controlled Modification of Dynamically-Determined Object Attributes](https://cwe.mitre.org/data/definitions/915.html),
CWE 5.0, read 2026-11-21.

### 5. Failure's detail sent to the caller

**Rule:** A reply to a failed request says what the caller can act on and
nothing of how the server is built: no stack trace, no statement, no path,
no message passed through from a library.

**Violation Example:**

```ts
try {
  response.json(await orders.find(request.params.id));
} catch (error) {
  response.status(500).json({ error: error.message, stack: error.stack });
}
```

**Correct Pattern:**

```ts
try {
  response.json(await orders.find(request.params.id));
} catch (error) {
  const reference = randomUUID();
  logger.error("order lookup failed", { reference, error });
  response.status(500).json({ error: "The order could not be read.", reference });
}
```

**Detection:** Read each reply the change sends from a catch or an error
handler, and follow each field back to where its value comes from. An
error's own message is written for the server's log, by a library that does
not know who will read it.

**Severity:** WARNING

**Why This Matters:** The reply tells a stranger which library failed, on
which line, and often the statement and the table it ran against. Source:
[CWE-209: Generation of Error Message Containing Sensitive Information](https://cwe.mitre.org/data/definitions/209.html),
CWE 5.0, read 2026-11-21.

## Reads and writes

The store does what the statement says, to as many rows as it names.

### 6. Statement built from input

**Rule:** A value from a request reaches the store as a parameter, never as
part of the statement's text.

**Violation Example:**

```ts
const rows = await db.query(`SELECT id, total FROM orders WHERE customer = '${customer}'`);
const found = await db.query("SELECT id FROM users WHERE email = '" + email + "'");
```

**Correct Pattern:**

```ts
const rows = await db.query("SELECT id, total FROM orders WHERE customer = $1", [customer]);
const found = await db.query("SELECT id FROM users WHERE email = $1", [email]);
```

**Detection:** Read every statement the change builds for a value joined or
written into its text, and follow that value back: one that started in a
request, a file or another service is the finding. A column or table name
that must vary is picked from a list in the code, never passed through.

**Severity:** CRITICAL

**Why This Matters:** The value is read as part of the statement, so a
caller who sends a quote and a statement of their own has it run. Source:
[CWE-89: Improper Neutralization of Special Elements used in an SQL Command](https://cwe.mitre.org/data/definitions/89.html),
CWE 5.0, read 2026-11-21.

### 7. List with no limit

**Rule:** A read that returns a list has a limit the server sets, however
many rows match, and a caller asks for the rest by page.

**Violation Example:**

```ts
router.get("/orders", requireSignIn, async (request, response) => {
  const rows = await db.query("SELECT id, total FROM orders WHERE customer = $1", [
    request.user.customerId,
  ]);
  response.json(rows);
});
```

**Correct Pattern:**

```ts
const PAGE_SIZE = 100;

router.get("/orders", requireSignIn, async (request, response) => {
  const page = Number(request.query.page ?? 0);
  if (!Number.isInteger(page) || page < 0) {
    return response.status(400).json({ error: "page is a whole number from 0." });
  }
  const rows = await db.query(
    "SELECT id, total FROM orders WHERE customer = $1 ORDER BY id LIMIT $2 OFFSET $3",
    [request.user.customerId, PAGE_SIZE, page * PAGE_SIZE],
  );
  response.json(rows);
});
```

**Detection:** For each read the change adds that can match many rows, find
the limit in the statement and where its value comes from. A limit taken
from the request with no ceiling is the caller's limit, not the server's.

**Severity:** WARNING

**Why This Matters:** The reply, the memory it is built in and the time it
takes all grow with the table, and nothing in the code stops them. Source:
[CWE-770: Allocation of Resources Without Limits or Throttling](https://cwe.mitre.org/data/definitions/770.html),
CWE 5.0, read 2026-11-21.

### 8. Writes that stand together, made apart

**Rule:** Writes that are only right together are made in one transaction,
so a failure between them leaves none of them.

**Violation Example:**

```ts
await db.query("UPDATE accounts SET balance = balance - $1 WHERE id = $2", [amount, from]);
await db.query("UPDATE accounts SET balance = balance + $1 WHERE id = $2", [amount, to]);
```

**Correct Pattern:**

```ts
await db.transaction(async (tx) => {
  await tx.query("UPDATE accounts SET balance = balance - $1 WHERE id = $2", [amount, from]);
  await tx.query("UPDATE accounts SET balance = balance + $1 WHERE id = $2", [amount, to]);
});
```

**Detection:** Where the change makes more than one write in a handler, ask
what the store holds if the second fails or the process stops between them.
Where that state is wrong, find the transaction around both.

**Severity:** CRITICAL

**Why This Matters:** When the second write fails, the money has left one
account and reached no other. Source:
[PostgreSQL Documentation: Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html),
read 2026-11-21.
