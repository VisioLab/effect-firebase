# PROTOTYPE - throwaway, never merged

Wayfinder ticket "Readable errors for field-object queries" (#127) on map "Queries in Firestore" (#117).

The same refused cases in three styles, type-checked with tsc 7:

- `dotted.cases.ts`: dotted paths, the lookup form from the #126 bench (`dottedLookup.ts`).
- `fields.cases.ts`: field objects as #125/#126 built them (`fields.ts`).
- `branded.cases.ts`: field objects reworked for readable errors (`branded.ts`). Owners are collection names, fields carry a path and kind label, refusals are a `"~refused": "<why>"` property. Also covers the overload layout and the callback form.

`tsc-output.txt` holds every message. To regenerate it: `../node_modules/.bin/tsc -p . --pretty false > tsc-output.txt`.
