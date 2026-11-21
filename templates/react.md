# React rules

What a change to React components is held to: hooks called where React
cannot keep track of them, effects that go stale or leave something
running, state that disagrees with itself, and controls some people cannot
use. Each rule names something visible in the change and the files around
it.

## Purpose

React keeps a component's state by the order its hooks are called in and
decides what to redraw from what the code tells it changed. Every rule here
is a way a change tells React less than is true, or leaves a person unable
to use what was drawn.

Report a finding only when the code shows it. Where the project's lint
rules already fail the build on the pattern, say so and report nothing.

## Review scope

Judge what the change introduced.

- Added and modified lines, and the components and hooks they call.
- A prop or a piece of state the change adds: every effect, memo and
  callback that reads it.
- Code the change did not touch is read to understand the change. It is not
  reported on.

## Severity levels

| Level    | Meaning                                                        |
| -------- | -------------------------------------------------------------- |
| CRITICAL | State lost or wrong on screen, or a control a person cannot use |
| WARNING  | A fault waiting for an order of events or a slow reply         |
| NITPICK  | Worth saying once. No rule here uses it.                       |

## Mechanical sweeps

Each pattern is searched for in every added line. A hit is a line to read
under the rule named, not a finding.

| Sweep for                         | What a hit means                            |
| --------------------------------- | ------------------------------------------- |
| `react-hooks/exhaustive-deps`     | Rule 2: the dependency check switched off   |
| `key=\{index\}`                   | Rule 7: a position used as a key            |
| `key=\{Math\.random\(\)\}`        | Rule 7: a key made while rendering          |
| `<div[^>]*onClick=`               | Rule 8: a click handler on a div            |
| `<span[^>]*onClick=`              | Rule 8: a click handler on a span           |

## Hooks

React tells one hook from the next by the order they are called in, and
runs an effect again only when told what it read.

### 1. Hook called where React cannot count on it

**Rule:** A hook is called at the top level of a component or of another
hook, on every render, in the same order: never inside a condition, a loop,
a nested function, an event handler or a try block, and never after a
return that some renders take.

**Violation Example:**

```tsx
function Profile({ userId }: { userId: string | null }) {
  if (userId === null) return <SignIn />;
  const [draft, setDraft] = useState("");
  const user = useUser(userId);
  return <ProfileForm user={user} draft={draft} onDraft={setDraft} />;
}
```

**Correct Pattern:**

```tsx
function Profile({ userId }: { userId: string | null }) {
  if (userId === null) return <SignIn />;
  return <SignedInProfile userId={userId} />;
}

function SignedInProfile({ userId }: { userId: string }) {
  const [draft, setDraft] = useState("");
  const user = useUser(userId);
  return <ProfileForm user={user} draft={draft} onDraft={setDraft} />;
}
```

**Detection:** For each hook call the change adds or moves, read from the
top of the function down to it: any return, condition, loop or callback
between the two is the finding. A function named `use...` is a hook and is
held to this in its own body.

**Severity:** CRITICAL

**Why This Matters:** React tells one hook's state from the next by the
order they are called in, which has to be the same on every render. A
render that returns early calls neither of these two, and the order React
kept no longer fits. Sources:
[React: Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks)
and
[React: State, A Component's Memory](https://react.dev/learn/state-a-components-memory),
read 2026-11-21.

### 2. Effect that reads what it does not declare

**Rule:** An effect's dependency list names every prop, state value and
value declared in the component that its code reads. The list is not the
place to choose when the effect runs, and the lint rule that checks it is
not switched off.

**Violation Example:**

```tsx
useEffect(() => {
  const socket = connect(roomId, { onMessage: (message) => notify(userName, message) });
  return () => socket.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**Correct Pattern:**

```tsx
useEffect(() => {
  const socket = connect(roomId, { onMessage: (message) => notify(userName, message) });
  return () => socket.close();
}, [roomId, userName]);
```

**Detection:** For each effect, memo and callback the change adds or edits,
list what its body reads from the component and hold that against its
dependency list. Read every comment that switches the dependency check off:
the values it hides are the finding.

**Severity:** CRITICAL

**Why This Matters:** When the room changes the effect does not run again,
so the component goes on listening to the room it was first given. Source:
[React: useEffect](https://react.dev/reference/react/useEffect),
read 2026-11-21.

### 3. Effect that leaves something running

**Rule:** An effect that starts something (a subscription, a listener, a
timer, a connection) returns a function that stops it.

**Violation Example:**

```tsx
useEffect(() => {
  const timer = setInterval(() => setNow(Date.now()), 1000);
  window.addEventListener("resize", onResize);
}, [onResize]);
```

**Correct Pattern:**

```tsx
useEffect(() => {
  const timer = setInterval(() => setNow(Date.now()), 1000);
  window.addEventListener("resize", onResize);
  return () => {
    clearInterval(timer);
    window.removeEventListener("resize", onResize);
  };
}, [onResize]);
```

**Detection:** For each effect the change adds or edits, list what it
starts, then find each one stopped in the function it returns. An effect
that returns nothing stops nothing.

**Severity:** WARNING

**Why This Matters:** Each time the effect runs again, and when the
component is taken away, the timer and the listener it started before go on
running and set state on what is no longer there. Source:
[React: useEffect](https://react.dev/reference/react/useEffect),
read 2026-11-21.

### 4. Effect that takes a late reply for the current one

**Rule:** An effect that asks for data and sets state from the reply
ignores a reply that arrives after the effect has been cleaned up.

**Violation Example:**

```tsx
useEffect(() => {
  fetchBio(person).then((result) => setBio(result));
}, [person]);
```

**Correct Pattern:**

```tsx
useEffect(() => {
  let ignore = false;
  fetchBio(person).then((result) => {
    if (!ignore) setBio(result);
  });
  return () => {
    ignore = true;
  };
}, [person]);
```

**Detection:** For each effect the change adds that awaits something and
then sets state, ask what happens when its dependencies change before the
reply comes. Where nothing marks the old request as stale, the old reply
can land last.

**Severity:** WARNING

**Why This Matters:** Replies can arrive in another order than they were
asked for, and the screen then shows the person picked before. Source:
[React: useEffect](https://react.dev/reference/react/useEffect),
read 2026-11-21.

## Component state

State is what React is told. What it is not told, it does not draw.

### 5. Derived value kept in state

**Rule:** A value that can be worked out from props or other state is
worked out while rendering. It is not kept in state of its own and brought
up to date by an effect.

**Violation Example:**

```tsx
const [firstName, setFirstName] = useState("");
const [lastName, setLastName] = useState("");
const [fullName, setFullName] = useState("");

useEffect(() => {
  setFullName(firstName + " " + lastName);
}, [firstName, lastName]);
```

**Correct Pattern:**

```tsx
const [firstName, setFirstName] = useState("");
const [lastName, setLastName] = useState("");
const fullName = firstName + " " + lastName;
```

**Detection:** For each piece of state the change adds, find where it is
set. Where every setter call sits in an effect that copies from props or
other state, the value is derived.

**Severity:** WARNING

**Why This Matters:** The component renders once with the old value before
the effect corrects it, and the two copies are free to disagree. Source:
[React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect),
read 2026-11-21.

### 6. State changed in place

**Rule:** An object or an array held in state is replaced through its
setter, never changed in place.

**Violation Example:**

```tsx
function addItem(item: Item) {
  cart.items.push(item);
  cart.total += item.price;
  setCart(cart);
}
```

**Correct Pattern:**

```tsx
function addItem(item: Item) {
  setCart({ items: [...cart.items, item], total: cart.total + item.price });
}
```

**Detection:** For each value that comes from `useState`, `useReducer` or
props, read the change for an assignment to one of its fields and for a
call that alters it (push, splice, sort, an index assignment). A setter
handed the same object back tells React nothing changed.

**Severity:** CRITICAL

**Why This Matters:** React compares the object it is given with the one it
had, finds the same object, and ignores the update: the new item is not
drawn. Sources:
[React: Updating Objects in State](https://react.dev/learn/updating-objects-in-state)
and
[React: useState](https://react.dev/reference/react/useState),
read 2026-11-21.

## Components people use

What is drawn has to stay the right item, and be reachable without a mouse.

### 7. Key that does not name the item

**Rule:** Each item of a list is keyed by something that belongs to the
item and does not change. Its position in the array is not that, and
neither is a value made while rendering.

**Violation Example:**

```tsx
<ul>
  {todos.map((todo, index) => (
    <TodoRow key={index} todo={todo} />
  ))}
  {suggestions.map((text) => (
    <li key={Math.random()}>{text}</li>
  ))}
</ul>
```

**Correct Pattern:**

```tsx
<ul>
  {todos.map((todo) => (
    <TodoRow key={todo.id} todo={todo} />
  ))}
  {suggestions.map((suggestion) => (
    <li key={suggestion.id}>{suggestion.text}</li>
  ))}
</ul>
```

**Detection:** For each list the change renders, read where the key comes
from. Then ask whether the list can be reordered, filtered, or have an item
put in or taken out: a list that never changes its order is the one case
where a position is a sound key.

**Severity:** WARNING

**Why This Matters:** When a row is removed, each row after it takes the
key of the one before, so React keeps their state (a typed value, an open
menu) on the wrong rows. Source:
[React: Rendering Lists](https://react.dev/learn/rendering-lists),
read 2026-11-21.

### 8. Control a keyboard cannot reach

**Rule:** Anything a person can click can be reached and worked from the
keyboard. A click handler goes on a button or a link, or on an element
given a role, a place in the tab order and a key handler.

**Violation Example:**

```tsx
<div className="row" onClick={() => onOpen(order.id)}>
  {order.name}
  <span className="remove" onClick={() => onRemove(order.id)}>
    Remove
  </span>
</div>
```

**Correct Pattern:**

```tsx
<div className="row">
  <button type="button" className="row-open" onClick={() => onOpen(order.id)}>
    {order.name}
  </button>
  <button type="button" className="remove" onClick={() => onRemove(order.id)}>
    Remove
  </button>
</div>
```

**Detection:** For each click handler the change adds, read the element it
is on. A div, a span, an image or a table row takes no focus and answers
neither Enter nor Space unless the code gives it both.

**Severity:** CRITICAL

**Why This Matters:** A person who uses the keyboard, a switch or a screen
reader cannot open the order or remove it at all. Source:
[W3C: Understanding Success Criterion 2.1.1, Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html),
read 2026-11-21.
