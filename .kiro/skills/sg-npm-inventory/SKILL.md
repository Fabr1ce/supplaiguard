---
name: sg-npm-inventory
description: Parse npm package.json and package-lock.json to produce a SupplAIGuard dependency inventory. Use when discovering Node.js/npm dependencies, reading lockfiles, or building the component inventory for a scan.
---

# npm Dependency Inventory

Produces the dependency portion of the SupplAIGuard inventory. Read-only.

## Inputs

- `package-lock.json` (preferred — gives exact resolved versions, incl. transitive)
- `package.json` (fallback — declared ranges only; mark inventory as unlocked)

## Procedure

1. Locate manifests: read `package.json` and `package-lock.json` in the repo
   root (and nested workspaces if present).
2. **If `package-lock.json` exists**, extract exact versions:
   - **lockfileVersion 2 or 3**: iterate the top-level `packages` object. Keys
     are paths like `node_modules/<name>` (nested for transitive). For each entry
     with a `version`, record `{ name, version, path, direct: <true if key is a
     top-level node_modules/<name> with no nested segment> }`. The `""` key is
     the root project — skip it.
   - **lockfileVersion 1**: recurse the `dependencies` object; each key is a
     package name with a `version`, and may contain a nested `dependencies`.
3. **Else if only `package.json` exists**: read `dependencies` and
   `devDependencies`. Record `{ name, version_range, direct: true }` and set the
   inventory flag `locked: false` / approximate.
4. Normalize scoped names (`@scope/name`) correctly.
5. De-duplicate on `(name, version)` but keep every distinct version present.

## Output (inventory fragment)

```json
{
  "locked": true,
  "dependencies": [
    { "name": "example-package", "version": "1.2.0", "path": "node_modules/example-package", "direct": true }
  ]
}
```

For the unlocked fallback, emit `version_range` instead of `version` and set
`locked: false`.

## Error handling

- If a manifest is present but cannot be parsed as JSON, DO NOT abort the whole
  scan. Record a `ScanError` (`stage: "discovery"`, `source: <file>`) per the
  findings schema and continue with whatever else parsed.
- Never fabricate versions. If a version is missing, omit the entry and note it
  in `errors`.

## Handing off

Pass the dependency list to `sg-osv-dependency-scan`. Pass the full inventory
(deps + MCP + agent defs) up to the Threat Analysis stage.
