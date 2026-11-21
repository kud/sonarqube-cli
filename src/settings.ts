import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/*
 * Setting names and config location, mirroring @kud/sonarqube main
 * (src/config.ts). The published core (0.1.0) still reads the legacy names
 * first; once a core release carries this resolution, drop this module and
 * use its exports instead.
 */

const CONFIG_DIR_NAME = "sonarqube"
const LEGACY_CONFIG_DIR_NAME = "sonarqube-dash-cli"

export const TOKEN_ENV = ["SONARQUBE_TOKEN", "SONAR_TOKEN", "SONARQUBE_DASH_TOKEN"]
export const HOST_ENV = ["SONARQUBE_HOST", "SONARQUBE_DASH_HOST", "SONAR_HOST_URL"]
export const PROJECT_ENV = ["SONARQUBE_PROJECT", "SONARQUBE_DASH_PROJECT"]
export const BRANCH_ENV = ["SONARQUBE_BRANCH", "SONARQUBE_DASH_BRANCH"]

const configDirFile = (dir: string, env: NodeJS.ProcessEnv): string => {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(base, dir, "config.json")
}

export const configFilePath = (env: NodeJS.ProcessEnv = process.env): string =>
  configDirFile(CONFIG_DIR_NAME, env)

export const legacyConfigFilePath = (
  env: NodeJS.ProcessEnv = process.env,
): string => configDirFile(LEGACY_CONFIG_DIR_NAME, env)

/** The file that holds the config: the new one, else the legacy one, else the new path. */
export const existingConfigFilePath = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const current = configFilePath(env)
  if (fs.existsSync(current)) return current
  const legacy = legacyConfigFilePath(env)
  if (fs.existsSync(legacy)) return legacy
  return current
}

const firstSet = (env: NodeJS.ProcessEnv, names: string[]) =>
  names.map((name) => env[name]).find((value) => value)

/** The name of the variable the token is read from, if any. */
export const tokenEnvName = (
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => TOKEN_ENV.find((name) => env[name])

export const envSettings = (env: NodeJS.ProcessEnv = process.env) => ({
  token: firstSet(env, TOKEN_ENV),
  host: firstSet(env, HOST_ENV),
  project: firstSet(env, PROJECT_ENV),
  branch: firstSet(env, BRANCH_ENV),
})
