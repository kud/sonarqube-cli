import type { Command } from "commander"

export interface ConnectionOptions {
  token?: string
  host?: string
  config?: string
  project?: string
  branch?: string
  json?: boolean
}

interface ConnectionScope {
  project?: boolean
  branch?: boolean
  json?: boolean
}

/**
 * The one place connection flags are declared. `-H` is the short form of
 * `--host` so that `-h` stays help on every command.
 */
export const withConnectionOptions = (
  command: Command,
  scope: ConnectionScope = {},
): Command => {
  if (scope.project)
    command.option(
      "-p, --project <key>",
      "Project key (or config, env, sonar-project.properties)",
    )
  if (scope.branch) command.option("-b, --branch <name>", "Branch name")
  command
    .option("-t, --token <token>", "SonarQube auth token (or config, env)")
    .option("-H, --host <url>", "SonarQube host URL (or config, env)")
    .option("-c, --config <path>", "Path to config file (JSON)")
  if (scope.json !== false) command.option("-j, --json", "Output as JSON")
  return command
}

export const parseLimit = (value: string): number => {
  const limit = Number.parseInt(value, 10)
  if (!Number.isFinite(limit) || limit < 1)
    throw new Error(`Invalid limit: ${value}`)
  return limit
}
