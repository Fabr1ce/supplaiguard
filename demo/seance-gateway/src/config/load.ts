import fs from "node:fs";
import yaml from "js-yaml";

export interface ToolSpec {
  name: string;
  description: string;
}

// Tool manifests can be supplied by tool authors, so this parses data we do not fully control.
export function loadToolManifest(path: string): ToolSpec[] {
  const doc = yaml.safeLoad(fs.readFileSync(path, "utf8")) as { tools?: ToolSpec[] } | undefined;
  return doc?.tools ?? [];
}
