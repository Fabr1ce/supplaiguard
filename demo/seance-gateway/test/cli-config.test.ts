import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli";
import { listTools } from "../src/mcp/server";

test("cli reads --port and defaults config", () => {
  assert.deepEqual(parseArgs(["--port", "9000"]), { port: 9000, config: "config/tools.yaml" });
});

test("tool manifest loads", () => {
  const names = listTools("config/tools.yaml").map((t) => t.name);
  assert.deepEqual(names, ["summarize_ticket", "lookup_order"]);
});
