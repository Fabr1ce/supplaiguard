import optimist from "optimist";

export interface CliOptions {
  port: number;
  config: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const args = optimist(argv).default({ port: 8080, config: "config/tools.yaml" }).argv;
  return { port: Number(args.port), config: String(args.config) };
}
