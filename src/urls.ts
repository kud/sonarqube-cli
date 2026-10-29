import { spawn } from "node:child_process"
import chalk from "chalk"

const base = (host: string) => host.replace(/\/+$/, "")
const enc = encodeURIComponent

export const issueUrl = (host: string, issueKey: string, projectKey?: string) =>
  `${base(host)}/project/issues?${projectKey ? `id=${enc(projectKey)}&` : ""}open=${enc(issueKey)}&issues=${enc(issueKey)}`

export const hotspotUrl = (
  host: string,
  hotspotKey: string,
  projectKey?: string,
) =>
  `${base(host)}/security_hotspots?${projectKey ? `id=${enc(projectKey)}&` : ""}hotspots=${enc(hotspotKey)}&open=${enc(hotspotKey)}`

export const ruleUrl = (host: string, ruleKey: string) =>
  `${base(host)}/coding_rules?open=${enc(ruleKey)}&rule_key=${enc(ruleKey)}`

export const fileUrl = (host: string, componentKey: string, branch?: string) =>
  `${base(host)}/code?id=${enc(componentKey)}${branch ? `&branch=${enc(branch)}` : ""}`

export const openUrl = (url: string) => {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open"
  try {
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref()
  } catch (err) {
    console.error(chalk.red("Failed to open browser:"), (err as Error).message)
  }
}

/** Handles the shared `--url` / `--open` flags. */
export const showOrOpen = (
  url: string,
  opts: { url?: boolean; open?: boolean },
) => {
  if (opts.url) console.log(url)
  if (opts.open) {
    console.log(chalk.gray("Opening: ") + url)
    openUrl(url)
  }
}
