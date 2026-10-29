import path from "node:path"
import chalk from "chalk"
import {
  MissingHostError,
  SonarQubeClient,
  SonarQubeHttpError,
  resolveConfig,
  type SonarQubeConfig,
} from "@kud/sonarqube"
import type { ConnectionOptions } from "./options.js"

/** An expected failure: printed as-is, without a stack. */
export class CliError extends Error {}

const MISSING_HOST_MESSAGE =
  "No SonarQube host configured. Pass --host (-H), set SONARQUBE_DASH_HOST or SONAR_HOST_URL, or run `sonarqube config set host=https://sonarqube.example.com`."

const MISSING_PROJECT_HINT =
  "No project key. Pass --project (-p), set SONARQUBE_DASH_PROJECT, run `sonarqube config set project=<key>`, or run from a directory with a sonar-project.properties."

export const resolveConfigPath = (explicit?: string): string | undefined =>
  explicit ? path.resolve(explicit) : undefined

export const loadRuntimeConfig = (opts: ConnectionOptions): SonarQubeConfig =>
  resolveConfig({
    configPath: resolveConfigPath(opts.config),
    token: opts.token,
    host: opts.host,
    project: opts.project,
    branch: opts.branch,
  })

export const createClient = (config: SonarQubeConfig): SonarQubeClient => {
  try {
    return new SonarQubeClient(config)
  } catch (err) {
    if (err instanceof MissingHostError)
      throw new CliError(MISSING_HOST_MESSAGE)
    throw err
  }
}

export const requireProject = (config: SonarQubeConfig): string => {
  if (!config.project) throw new CliError(MISSING_PROJECT_HINT)
  return config.project
}

export const connect = (opts: ConnectionOptions) => {
  const config = loadRuntimeConfig(opts)
  return { config, client: createClient(config) }
}

const hintFor = (err: SonarQubeHttpError): string | undefined => {
  if (err.status === 401)
    return "Check the token (--token, SONARQUBE_DASH_TOKEN or `sonarqube config set token=...`)."
  if (err.status === 403) return "The token lacks permission for this project."
  if (err.status === 404) return "Check the project, branch or key."
  return undefined
}

const reportError = (label: string, err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof CliError) {
    console.error(chalk.red(message))
    return
  }
  console.error(chalk.red(`✖ ${label}:`), message)
  if (err instanceof SonarQubeHttpError) {
    const hint = hintFor(err)
    if (hint) console.error(chalk.gray(hint))
  }
}

/** Wraps a command action: errors become one readable line and exit code 1. */
export const action =
  <A extends unknown[]>(
    label: string,
    run: (...args: A) => Promise<void> | void,
  ) =>
  async (...args: A): Promise<void> => {
    try {
      await run(...args)
    } catch (err) {
      reportError(label, err)
      process.exitCode = 1
    }
  }

export const printJson = (value: unknown) =>
  console.log(JSON.stringify(value, null, 2))
