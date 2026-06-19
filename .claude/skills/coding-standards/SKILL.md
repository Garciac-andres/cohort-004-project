---
name: coding-standards
description: This repository's coding standards (TypeScript conventions, and more as they grow). Use when writing, editing, or reviewing code in this repo — before adding functions, parameters, type annotations, or other code, load the relevant standards file below and follow it.
---

# Coding Standards

The actual rules live in topic files under `standards/`, so only the section you
need loads into context. Find your topic, then read that file before writing code.

## Standards by topic

| Topic | File | Covers |
| --- | --- | --- |
| TypeScript | [standards/typescript.md](standards/typescript.md) | Function parameter shape (object vs positional), no `any` types |

## How to use

1. Identify what you're about to write or review (a function signature, a type, etc.).
2. Open the matching topic file above and read the relevant section.
3. Apply the rule. When touching existing code that violates a standard, prefer to
   bring it into line rather than matching the old style.

When you add a new standard, put it in the matching topic file (create a new one if
no topic fits), then add a row to the table above. Keep each rule findable under its
own heading with a BAD/GOOD example.