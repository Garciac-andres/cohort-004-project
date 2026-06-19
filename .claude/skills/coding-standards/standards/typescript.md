# TypeScript Standards

Each standard has its own heading so the relevant rule is easy to locate.

## Object parameters for same-typed arguments

When a function has more than one parameter of the same type, use a single object
parameter instead of positional parameters. This prevents call sites from silently
transposing arguments.

```ts
// BAD
const addUserToPost = (userId: string, postId: string) => {};

// GOOD
const addUserToPost = (opts: { userId: string; postId: string }) => {};
```

A single parameter — or multiple parameters of distinct types — may stay positional.

## No `any` types

Never use `any`. The codebase already has some, but do not add more, and prefer to
replace `any` with a proper type whenever you touch surrounding code. Reach for a
specific type, a generic, or `unknown` (narrowed before use) instead:

```ts
// BAD
function parse(input: any) {}
const items: any[] = [];

// GOOD
function parse(input: unknown) {}
const items: Item[] = [];
```