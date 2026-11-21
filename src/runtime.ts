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
import { envSettings, existingConfigFilePath, tokenEnvName } from "./settings.js"

/** An expected failure: printed as-is, without a stack. */
export class CliError extends Error {}

const MISSING_HOST_MESSAGE =
  "No SonarQube host configured. Pass --host (-H), set SONARQUBE_HOST, or run `sonarqube config set host=https://sonarqube.example.com`."

const MISSING_PROJECT_HINT =
  "No project key. Pass --project (-p), set SONARQUBE_PROJECT, run `sonarqube config set project=<key>`, or run from a directory with a sonar-project.properties."

export const resolveConfigPath = (explicit?: string): string | undefined =>
  explicit ? path.resolve(explicit) : undefined

/** Where the token in use came from: an env var name, "flag", "file", or none. */
let tokenSource: string | undefined

/**
 * Layered: config file < environment < flags. The environment is read here,
 * new names before legacy ones, and handed to the core as explicit values.
 */
export const loadRuntimeConfig = (opts: ConnectionOptions): SonarQubeConfig => {
  const env = envSettings()
  const config = resolveConfig({
    configPath: resolveConfigPath(opts.config) ?? existingConfigFilePath(),
    token: opts.token || env.token,
    host: opts.host || env.host,
    project: opts.project || env.project,
    branch: opts.branch || env.branch,
  })
  tokenSource = opts.token
    ? "flag"
    : env.token
      ? tokenEnvName()
      : config.token
        ? "file"
        : undefined
  return config
}

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

const tokenHint = (): string => {
  if (!tokenSource)
    return "No token was sent. Set SONARQUBE_TOKEN, pass --token, or run `sonarqube config set token=...`."
  if (tokenSource === "flag") return "The token passed with --token was rejected."
  if (tokenSource === "file")
    return "The token in the config file was rejected. Run `sonarqube config set token=...` or set SONARQUBE_TOKEN."
  return `The token from ${tokenSource} was rejected. Set ${tokenSource} to a valid user token.`
}

const hintFor = (err: SonarQubeHttpError): string | undefined => {
  if (err.status === 401) return tokenHint()
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
