import { loadToolManifest, type ToolSpec } from "../config/load";

// Minimal stand-in for an MCP tools/list response.
export function listTools(manifestPath: string): ToolSpec[] {
  return loadToolManifest(manifestPath);
}
