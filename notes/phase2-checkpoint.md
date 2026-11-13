# SupplAIGuard — Phase 2 checkpoint

Saved: 2026-11-12. Nothing is committed yet (`git status` shows modified agents + new dirs).
Repo root: `/home/nulledgenerd/Documents/Practice/agentic-ai/hackathons/supplaiguard`

## Goals (from the user)
1. Decide AI vs traditional tooling → hybrid: deterministic scanner for exact rules, LLM for SKL-* semantics, triage, remediation.
2. README: shields.io banner, diagram of discover → analyze → remediate (with your approval) → verify → discover (loop), and a repo structure with a one-line description per file.
3. Make the agents runnable from any repo (Kiro only finds workspace agents in the cwd's `.kiro/agents`).
4. Update configs for Kiro CLI v3.
5. Halloween demos: a full Strands Agents app and an MCP server (scary stories).
6. All of this is "Phase 2".

## DONE
- **v3 config**: ran `kiro-cli agent upgrade .kiro/agents --no-backup`. All 6 agents now carry `permissions.rules`, and `kiro-cli agent validate --path <file>` is clean. Warning: `delegate` is reported as an "unmapped-allowed-tool" (harmless; the subagent rule was mapped).
- **Global install**: `./install.sh` (`--dry-run`, `--uninstall`).
  - Agents go to `~/.kiro/agents`, prompts to `~/.kiro/agents/prompts`.
  - Policies and skills go to `~/.kiro/supplaiguard/{steering,skills}`. They are NOT put in `~/.kiro/steering` because that would load into every chat.
  - Agent `resources` now use `file://~/.kiro/supplaiguard/...`.
  - The reviewer's spec paths are rewritten to the absolute checkout path at install time.
  - Already run once: `kiro-cli agent list` from /tmp shows all 6 as Global.
  - Re-run `./install.sh` after editing anything in `.kiro/`.
- **Deterministic scanner**: `scanner/sg_scan.py` (stdlib only).
  - Rules: MCP-001..005, AGT-001..004, SKL-001..005.
  - Dependencies: npm `package-lock.json` and PyPI `requirements*.txt` (`==` pins) via OSV.
  - Flags major-version fixes. Exits 0 clean, 1 findings, 2 errors, and never reports a false all-clear (`--offline` records an error).
  - Verified results:
    - `demo/vulnerable-ai-app`: 8 findings. lodash recommends 4.18.0, not 4.17.21; newer advisories GHSA-r5fr-rjxr-66jc and GHSA-xxjr-mmjv-4gpg need it.
    - `demo/haunted-storyteller`: 10 findings.
    - `demo/crypt-keeper-mcp`: 1 finding (minimist 1.2.0 → 1.2.6).
- **Demo: `demo/crypt-keeper-mcp`** (TypeScript MCP server). Tools: `story_seed`, `random_curse`, `haunted_location`.
  - `npm install && npm run build && npm test` gives 3 passing tests.
  - Smoke-tested over JSON-RPC.
  - Pins: SDK 1.32.2, zod 4.6.6 (3.25.76 had GHSA-mrhx-c7xc-m3w5), seeded minimist 1.2.0.
- **Demo: `demo/haunted-storyteller`** (Python Strands app, `python -m storyteller`).
  - `.venv` created with uv (Python 3.11). `.venv/bin/python -m pytest -q` gives 5 passing tests, including a real MCP-wiring test against crypt-keeper.
  - Seeds: `jinja2==3.1.2` in `requirements.txt`, plus `.kiro/settings/mcp.json` (MCP-001/003/004/005) and `.kiro/agents/ghostwriter.json` (AGT-001/004, SKL-002/004).
  - The LLM chat itself is NOT tested (needs AWS Bedrock creds; model id via `STORYTELLER_MODEL_ID`).

## TODO (in order)
1. **README.md rewrite** (the steering asked for all of these):
   - shields.io banner/badges
   - mermaid loop diagram: discover → analyze → remediate (with your approval) → verify → back to discover
   - a repo structure tree with ONE LINE per file (use `find` output; skip node_modules/.venv/dist)
   - a Phase 2 section: v3 config, global install, scanner, hybrid design, demos
   - change "kiro-cli 1.21.0" to v3 and update the run instructions (`./install.sh`, then run from any repo)
2. Append a **Phase 2** section to `.kiro/specs/supplaiguard/tasks.md` (and requirements/design if desired).
3. Add short READMEs to `demo/crypt-keeper-mcp` and `demo/haunted-storyteller` (run steps, which findings are seeded on purpose).
4. Wire the scanner into the agents: the threat-analysis and verification prompts/skills should run `python3 ~/.kiro/supplaiguard/scanner/sg_scan.py` first (install.sh must copy `scanner/` and the shell allow-list must permit it), then use the LLM only for SKL semantics and triage.
5. Run the interactive end-to-end test from a demo dir: `kiro-cli chat --agent supplaiguard-coordinator "Run a full SupplAIGuard scan."` This also closes the open tasks 13.3, 13.4 and 13.7. Verify the remediation approval prompt works.
6. Cleanup and commit (ask first): decide whether to keep `demo/vulnerable-ai-app/.kiro/agents/overprivileged.json.bak`. Fix any README claims that turn out wrong. Do not commit `.venv`, `node_modules` or `dist` (the demo `.gitignore` files cover them).

## Known caveats
- Editing agent JSON after `agent upgrade` may make a later upgrade report "out-of-sync".
- The `jinja2==3.1.2` / `minimist` / `lodash` pins are intentionally vulnerable. Do not "fix" them except through the SupplAIGuard remediation demo.
- The first attempt to use `install.sh` raced with its creation (parallel tool calls); it works now.

## Resume
```bash
cd /home/nulledgenerd/Documents/Practice/agentic-ai/hackathons/supplaiguard
cat notes/phase2-checkpoint.md
git status --short
python3 scanner/sg_scan.py demo/haunted-storyteller | jq '.findings|length'   # expect 10
./install.sh && kiro-cli agent list | grep supplaiguard
```
