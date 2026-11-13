#!/usr/bin/env node
// Crypt Keeper MCP server (stdio). Halloween-themed tools for story generation.
import minimist from "minimist";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clampFright, hauntedLocation, randomCurse, storySeed } from "./crypt.js";

// minimist parses --fright=<1-5> (the seeded vulnerable dependency lives here).
const argv = minimist(process.argv.slice(2), { default: { fright: 3 } });
const defaultFright = clampFright(Number(argv.fright));

const server = new McpServer({ name: "crypt-keeper", version: "1.0.0" });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

server.tool(
  "story_seed",
  "Get a Halloween story seed: a haunted location, a monster, a curse and a tone for the chosen fright level (1 cozy - 5 nightmare).",
  { fright: z.number().int().min(1).max(5).optional().describe("Fright level 1-5") },
  async ({ fright }) => text(JSON.stringify(storySeed(clampFright(fright ?? defaultFright)), null, 2)),
);

server.tool("random_curse", "Utter a random spooky curse.", {}, async () => text(randomCurse()));

server.tool("haunted_location", "Pick a haunted location for a story.", {}, async () => text(hauntedLocation()));

await server.connect(new StdioServerTransport());
