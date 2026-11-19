# Feasibility notes (task 1): checked against OSV.dev and the npm registry on 2026-11-19

Only package names and versions were sent to `api.osv.dev/v1/query` and the npm registry. Fixed versions are the
`fixed` events in the OSV records. Anything not listed here was not checked.

| Scenario | Seed | Evidence | Status |
|---|---|---|---|
| S1 breaking major | `jsonwebtoken@8.5.1` | GHSA-8cf7-32gw-wr33, GHSA-hjrf-2m68-5959, GHSA-qwph-4952-7xr6, all fixed only in `9.0.0`. `jsonwebtoken@9.0.0`: 0 advisories | Shape confirmed. Still to confirm in task 4: which 9.x behavior changes break our call sites (run the tests on both) |
| S2 transitive, parent cannot move | `optimist@0.6.1` -> `minimist ~0.0.1` -> resolves `0.0.10` | `optimist` latest is 0.6.1, last modified 2023-04-12, so no release updates it. `minimist@0.0.10`: GHSA-vh95-rmgr-6w4m (fixed 0.2.1, 1.2.3), GHSA-xvch-5gv4-984h (fixed 0.2.4, 1.2.6). All fixes are outside `~0.0.1` | Shape confirmed. Correct fix is an `overrides` entry (>=0.2.4 or >=1.2.6) with tests green |
| S3 reachability | `lodash@4.17.20` | GHSA-29mw-wpgm-hmr9 (ReDoS, fixed 4.17.21), GHSA-35jh-r3h4-6jhm (command injection, 4.17.21), GHSA-r5fr-rjxr-66jc (`_.template` imports code injection, 4.18.0), GHSA-xxjr-mmjv-4gpg (`_.unset`/`_.omit` prototype pollution, 4.17.23) | Shape confirmed, but see "Spec change" below |
| S4 constraint keeps the vulnerable copy alive | `passport-jwt@4.0.0` (depends on `jsonwebtoken ^8.2.0`) with a direct `jsonwebtoken@9.x` | `passport-jwt@4.0.0` has 0 advisories itself and pulls `jsonwebtoken ^8.2.0`; `passport-jwt@4.0.1` pulls `^9.0.0` | Shape confirmed on the registry. Still to confirm: that `sg_scan.py` reads the nested lockfile entry under `passport-jwt` |
| S5 chain | `js-yaml@3.14.1` as the parser the MCP server uses | 5 advisories (merge-key DoS, prototype pollution in merge), fixed in 3.14.2 to 3.15.2 or 4.x | Seed confirmed. Chain config files are authored in task 4 |
| S6, S7 | no dependency | n/a | Authored in task 4 |

## Spec changes forced by this data

1. **S3.** One bump to `lodash@4.18.0` clears all four advisories, so "fix only the reachable one" is not a real choice.
   S3 is now scored on the agent's reachability analysis (which advisories are reachable from user input, with
   file evidence), and on the fix still clearing all four. A suppression is proposed only if a fix cannot be applied.
2. **S4.** It is a dependency-range conflict, not a peer-range conflict. Bumping `jsonwebtoken` to 9 clears the
   top-level finding while `passport-jwt@4.0.0` keeps a nested vulnerable 8.x copy. The correct fix bumps `passport-jwt`
   to 4.0.1 as well (a compatible set), and leaves no `jsonwebtoken` 8.x anywhere in the lockfile.

## Reference projects (inspiration only, no code copied)

Deliberately vulnerable MCP and Node projects exist: OWASP NodeGoat, `harishsg993010/damn-vulnerable-MCP-server`,
`appsecco/vulnerable-mcp-servers-lab`, `JoyGhoshs/vulnerable-mcp-server`, `IntegSec/VulnerableMCP`. They teach exploitation
of a running server. Our demo differs: the vulnerabilities are in dependencies and configs, and the question is how well
an agent fixes them. We write original seeds (S6 follows the common tool-poisoning pattern in a description field).
