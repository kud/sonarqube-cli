#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import chalk from "chalk"
import { Command } from "commander"
import {
  configFilePath,
  readConfigFile,
  redactConfig,
  writeConfig,
  type IssuesQuery,
} from "@kud/sonarqube"
import {
  parseLimit,
  withConnectionOptions,
  type ConnectionOptions,
} from "../src/options.js"
import {
  CliError,
  action,
  connect,
  loadRuntimeConfig,
  printJson,
  requireProject,
  resolveConfigPath,
} from "../src/runtime.js"
import {
  printComponentTree,
  printDuplications,
  printGateExplanation,
  printHotspot,
  printHotspots,
  printIssue,
  printIssues,
  printIssuesSummary,
  printMeasures,
  printMeasuresHistory,
  printProjectStatus,
  printQualityProfiles,
  printRule,
  printRules,
} from "../src/output.js"
import {
  fileUrl,
  hotspotUrl,
  issueUrl,
  ruleUrl,
  showOrOpen,
} from "../src/urls.js"

if (process.env.NO_COLOR) chalk.level = 0

const resolveVersion = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    try {
      return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version
    } catch {
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return "0.0.0"
}

const DEFAULT_METRICS = "coverage,bugs,vulnerabilities,code_smells"

const STATUS_METRICS = [
  "bugs",
  "vulnerabilities",
  "code_smells",
  "coverage",
  "duplicated_lines_density",
]

type LinkOptions = { url?: boolean; open?: boolean }

const withLinkOptions = (command: Command, what: string) =>
  command
    .option("--url", `Print the SonarQube web URL for the ${what}`)
    .option("--open", `Open the ${what} in the default browser`)

const program = new Command()

program
  .name("sonarqube")
  .description(
    "SonarQube from the terminal. Run with no command to open the issues dashboard.",
  )
  .version(resolveVersion())
  .showHelpAfterError()

withConnectionOptions(
  program
    .command("metrics")
    .alias("m")
    .description("Project metrics and quality gate status")
    .option("--print-config", "Print resolved configuration and exit"),
  { project: true, branch: true },
).action(
  action(
    "Error fetching project status",
    async (opts: ConnectionOptions & { printConfig?: boolean }) => {
      if (opts.printConfig)
        return printJson(redactConfig(loadRuntimeConfig(opts)))
      const { config, client } = connect(opts)
      const project = requireProject(config)
      const [qualityGate, component] = await Promise.all([
        client.getProjectStatus({ project, branch: config.branch }),
        client.getMeasures({
          project,
          branch: config.branch,
          metricKeys: STATUS_METRICS,
        }),
      ])
      // Display only: re-fetching metrics per branch hits edition limits on some servers.
      const branch =
        config.branch ??
        (await client
          .getBranches(project)
          .then(
            (branches) => (branches.find((b) => b.isMain) ?? branches[0])?.name,
          )
          .catch(() => undefined))
      const result = {
        projectKey: project,
        branch,
        qualityGate,
        metrics: component?.measures ?? [],
      }
      if (opts.json) printJson(result)
      else printProjectStatus(result)
    },
  ),
)

withConnectionOptions(
  program
    .command("quality-gate")
    .alias("gate")
    .description(
      "Why the quality gate is red: status, new-code period, failing conditions first",
    )
    .option("--fail", "Exit with code 1 when the gate is failing"),
  { project: true, branch: true },
).action(
  action(
    "Error fetching quality gate",
    async (opts: ConnectionOptions & { fail?: boolean }) => {
      const { config, client } = connect(opts)
      const project = requireProject(config)
      const gate = await client.explainGate({ project, branch: config.branch })
      if (opts.json)
        printJson({ projectKey: project, branch: config.branch, ...gate })
      else
        printGateExplanation({
          projectKey: project,
          branch: config.branch,
          gate,
        })
      if (opts.fail && gate.rawStatus === "ERROR") process.exitCode = 1
    },
  ),
)

type IssuesOptions = ConnectionOptions & {
  severities?: string
  types?: string
  statuses?: string
  limit?: number
  newCode?: boolean
  interactive?: boolean
}

const issuesQuery = (
  project: string,
  branch: string | undefined,
  opts: IssuesOptions,
): IssuesQuery => ({
  project,
  branch,
  severities: opts.severities,
  types: opts.types,
  statuses: opts.statuses,
  limit: opts.limit ?? 10,
  newCode: opts.newCode,
})

const openDashboard = async (opts: IssuesOptions) => {
  const { config, client } = connect(opts)
  const project = requireProject(config)
  const { runDashboard } = await import("../src/dashboard.js")
  await runDashboard(client, issuesQuery(project, config.branch, opts))
}

const withIssueFilters = (command: Command) =>
  command
    .option(
      "--severities <list>",
      "Comma list: BLOCKER,CRITICAL,MAJOR,MINOR,INFO",
    )
    .option(
      "--types <list>",
      "Comma list: BUG,VULNERABILITY,CODE_SMELL,SECURITY_HOTSPOT",
    )
    .option(
      "--statuses <list>",
      "Comma list: OPEN,CONFIRMED,REOPENED,RESOLVED,CLOSED (default: unresolved only)",
    )
    .option("--new-code", "Only issues in the new-code period")
    .option("-l, --limit <n>", "Max issues to show (default 10)", parseLimit)

withConnectionOptions(
  withIssueFilters(
    program
      .command("issues")
      .description("List issues for a project")
      .option(
        "-i, --interactive",
        "Open the issues dashboard (same as running `sonarqube` alone)",
      ),
  ),
  { project: true, branch: true },
).action(
  action("Error fetching issues", async (opts: IssuesOptions) => {
    if (opts.interactive) return openDashboard(opts)
    const { config, client } = connect(opts)
    const project = requireProject(config)
    const result = await client.getIssues(
      issuesQuery(project, config.branch, opts),
    )
    if (opts.json) printJson(result)
    else printIssues({ ...result, newCode: opts.newCode })
  }),
)

withConnectionOptions(
  program
    .command("issues:summary")
    .description("Aggregated issue counts (facets)")
    .option(
      "--facets <list>",
      "Comma list of facets (default severities,types,statuses)",
    ),
  { project: true, branch: true },
).action(
  action(
    "Error fetching issues summary",
    async (opts: ConnectionOptions & { facets?: string }) => {
      const { config, client } = connect(opts)
      const project = requireProject(config)
      const summary = await client.getIssuesSummary({
        project,
        branch: config.branch,
        facets: opts.facets,
      })
      if (opts.json) printJson(summary)
      else printIssuesSummary(summary)
    },
  ),
)

withConnectionOptions(
  withLinkOptions(
    program
      .command("issue")
      .description("Show a single issue by key")
      .argument("<key>", "Issue key"),
    "issue",
  ),
).action(
  action(
    "Error fetching issue",
    async (key: string, opts: ConnectionOptions & LinkOptions) => {
      const { client } = connect(opts)
      const issue = await client.getIssue(key)
      if (!issue) throw new CliError(`Issue not found: ${key}`)
      if (opts.json) return printJson(issue)
      printIssue(issue)
      showOrOpen(issueUrl(client.host, issue.key, issue.project), opts)
    },
  ),
)

withConnectionOptions(
  program
    .command("hotspots")
    .description("List security hotspots")
    .option("--status <status>", "Hotspot status (TO_REVIEW or REVIEWED)")
    .option("--severity <severity>", "Severity (LOW, MEDIUM, HIGH)")
    .option("-l, --limit <n>", "Max hotspots (default 50)", parseLimit),
  { project: true, branch: true },
).action(
  action(
    "Error fetching hotspots",
    async (
      opts: ConnectionOptions & {
        status?: string
        severity?: string
        limit?: number
      },
    ) => {
      const { config, client } = connect(opts)
      const project = requireProject(config)
      const result = await client.searchHotspots({
        project,
        branch: config.branch,
        status: opts.status,
        severity: opts.severity,
        limit: opts.limit ?? 50,
      })
      if (opts.json) printJson(result)
      else printHotspots(result)
    },
  ),
)

withConnectionOptions(
  withLinkOptions(
    program
      .command("hotspot")
      .description("Show a single hotspot by key")
      .argument("<key>", "Hotspot key"),
    "hotspot",
  ),
).action(
  action(
    "Error fetching hotspot",
    async (key: string, opts: ConnectionOptions & LinkOptions) => {
      const { client } = connect(opts)
      const hotspot = await client.getHotspot(key)
      if (!hotspot) throw new CliError(`Hotspot not found: ${key}`)
      if (opts.json) return printJson(hotspot)
      printHotspot(hotspot)
      showOrOpen(
        hotspotUrl(
          client.host,
          hotspot.key,
          typeof hotspot.project === "string"
            ? hotspot.project
            : hotspot.project?.key,
        ),
        opts,
      )
    },
  ),
)

withConnectionOptions(
  program
    .command("rules")
    .description("Search rules")
    .option("-q, --query <text>", "Search text")
    .option("--languages <list>", "Comma list of languages")
    .option("--tags <list>", "Comma list of tags")
    .option("--repository <repo>", "Repository key")
    .option(
      "--severities <list>",
      "Comma list of severities (BLOCKER,CRITICAL,...)",
    )
    .option("-l, --limit <n>", "Max rules (default 50)", parseLimit),
).action(
  action(
    "Error searching rules",
    async (
      opts: ConnectionOptions & {
        query?: string
        languages?: string
        tags?: string
        repository?: string
        severities?: string
        limit?: number
      },
    ) => {
      const { client } = connect(opts)
      const result = await client.searchRules({
        query: opts.query,
        languages: opts.languages,
        tags: opts.tags,
        repositories: opts.repository,
        severities: opts.severities,
        limit: opts.limit ?? 50,
      })
      if (opts.json) printJson(result)
      else printRules(result)
    },
  ),
)

withConnectionOptions(
  withLinkOptions(
    program
      .command("rule")
      .description("Show a single rule")
      .argument("<key>", "Rule key"),
    "rule",
  ),
).action(
  action(
    "Error fetching rule",
    async (key: string, opts: ConnectionOptions & LinkOptions) => {
      const { client } = connect(opts)
      const rule = await client.getRule(key)
      if (!rule) throw new CliError(`Rule not found: ${key}`)
      if (opts.json) return printJson(rule)
      printRule(rule)
      showOrOpen(ruleUrl(client.host, rule.key), opts)
    },
  ),
)

type ComponentOptions = ConnectionOptions & {
  component: string
  metrics?: string
}

withConnectionOptions(
  program
    .command("measures")
    .description("Measures for a component")
    .requiredOption("-C, --component <key>", "Component key (project or file)")
    .option(
      "-m, --metrics <list>",
      "Comma list of metric keys",
      DEFAULT_METRICS,
    ),
  { branch: true },
).action(
  action("Error fetching measures", async (opts: ComponentOptions) => {
    const { config, client } = connect(opts)
    const component = await client.getMeasures({
      project: opts.component,
      metricKeys: opts.metrics,
      branch: config.branch,
    })
    if (!component) throw new CliError("No measures returned")
    if (opts.json) printJson(component)
    else printMeasures(component)
  }),
)

withConnectionOptions(
  program
    .command("measures:history")
    .description("Historical measures for a component")
    .requiredOption("-C, --component <key>", "Component key")
    .option(
      "-m, --metrics <list>",
      "Comma list of metric keys",
      DEFAULT_METRICS,
    )
    .option("--from <date>", "From date (YYYY-MM-DD)")
    .option("--to <date>", "To date (YYYY-MM-DD)"),
  { branch: true },
).action(
  action(
    "Error fetching measures history",
    async (opts: ComponentOptions & { from?: string; to?: string }) => {
      const { config, client } = connect(opts)
      const history = await client.getMeasuresHistory({
        component: opts.component,
        metrics: opts.metrics,
        branch: config.branch,
        from: opts.from,
        to: opts.to,
      })
      if (opts.json) printJson(history)
      else printMeasuresHistory(history)
    },
  ),
)

withConnectionOptions(
  program
    .command("component-tree")
    .description("Browse the component tree (files)")
    .requiredOption(
      "-C, --component <key>",
      "Component key (project or module)",
    )
    .option("-q, --qualifiers <codes>", "Qualifier codes", "FIL")
    .option("-m, --metrics <list>", "Comma list of metric keys")
    .option(
      "--strategy <strategy>",
      "Tree strategy (leaves|children)",
      "leaves",
    ),
  { branch: true },
).action(
  action(
    "Error fetching component tree",
    async (
      opts: ComponentOptions & { qualifiers: string; strategy: string },
    ) => {
      const { config, client } = connect(opts)
      const tree = await client.getComponentTree({
        component: opts.component,
        branch: config.branch,
        qualifiers: opts.qualifiers,
        metricKeys: opts.metrics,
        strategy: opts.strategy,
      })
      if (opts.json) printJson(tree)
      else printComponentTree(tree)
    },
  ),
)

withConnectionOptions(
  withLinkOptions(
    program
      .command("duplications")
      .description("Duplications for a file")
      .requiredOption("-f, --file <key>", "File component key"),
    "file",
  ),
  { project: true, branch: true },
).action(
  action(
    "Error fetching duplications",
    async (opts: ConnectionOptions & LinkOptions & { file: string }) => {
      const { config, client } = connect(opts)
      const duplications = await client.getDuplications({
        key: opts.file,
        branch: config.branch,
      })
      if (opts.json) return printJson(duplications)
      printDuplications(duplications)
      showOrOpen(fileUrl(client.host, opts.file, config.branch), opts)
    },
  ),
)

withConnectionOptions(
  program
    .command("quality-profiles")
    .description("List quality profiles")
    .option("--language <lang>", "Language key"),
  { project: true },
).action(
  action(
    "Error fetching quality profiles",
    async (opts: ConnectionOptions & { language?: string }) => {
      const { config, client } = connect(opts)
      const profiles = await client.searchQualityProfiles({
        language: opts.language,
        project: config.project,
      })
      if (opts.json) printJson(profiles)
      else printQualityProfiles(profiles)
    },
  ),
)

withConnectionOptions(
  program
    .command("print-config")
    .description("Print the resolved configuration (token redacted)"),
  { project: true, branch: true, json: false },
).action(
  action("Error resolving configuration", (opts: ConnectionOptions) => {
    printJson(redactConfig(loadRuntimeConfig(opts)))
  }),
)

const configCommand = program
  .command("config")
  .description("Manage configuration file values")
  .option("-c, --config <path>", "Path to config file (overrides default)")

const configFile = (command: Command) =>
  resolveConfigPath(command.parent?.opts().config) ?? configFilePath()

configCommand
  .command("set")
  .description("Set one or more key=value pairs")
  .argument("<pairs...>", "key=value pairs (token, project, host, branch)")
  .action(
    action(
      "Error writing config",
      (pairs: string[], _opts: unknown, command: Command) => {
        const updates: Record<string, string> = {}
        for (const pair of pairs) {
          const idx = pair.indexOf("=")
          if (idx === -1)
            throw new CliError(`Invalid format (expected key=value): ${pair}`)
          updates[pair.slice(0, idx)] = pair.slice(idx + 1)
        }
        console.log(`Updated ${writeConfig(updates, configFile(command)).path}`)
      },
    ),
  )

configCommand
  .command("get")
  .description("Get a single key value")
  .argument("<key>", "token | project | host | branch")
  .action((key: string, _opts: unknown, command: Command) => {
    const stored = readConfigFile(configFile(command)) as Record<
      string,
      unknown
    >
    if (!Object.prototype.hasOwnProperty.call(stored, key)) {
      process.exitCode = 1
      return
    }
    console.log(key === "token" ? "***" : stored[key])
  })

configCommand
  .command("path")
  .description("Print the config file path")
  .action((_opts: unknown, command: Command) =>
    console.log(configFile(command)),
  )

configCommand
  .command("show")
  .description("Show the stored config (token redacted)")
  .action((_opts: unknown, command: Command) =>
    printJson(redactConfig(readConfigFile(configFile(command)))),
  )

program.addHelpText(
  "after",
  `
Examples:
  sonarqube                                   open the issues dashboard
  sonarqube quality-gate --fail               why is the gate red; exit 1 if it is
  sonarqube metrics -p my-project -H https://sonarqube.example.com
  sonarqube issues --new-code --severities CRITICAL,MAJOR -l 20
  sonarqube config set token=abc project=my-project host=https://sonarqube.example.com
  sonarqube print-config
`,
)

// Bare `sonarqube` opens the dashboard; outside a terminal there is nothing to draw.
program.allowExcessArguments().action(
  action("Error opening dashboard", async () => {
    if (program.args.length)
      program.error(`error: unknown command '${program.args[0]}'`)
    if (!process.stdout.isTTY) return program.outputHelp()
    await openDashboard({})
  }),
)

await program.parseAsync(process.argv)
