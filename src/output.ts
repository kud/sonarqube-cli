import chalk from "chalk"
import {
  formatDate,
  formatIssueAuthor,
  gateStatusWord,
  type GateConditionExplanation,
  type GateExplanation,
  type Issue,
  type Measure,
  type ProjectStatus,
} from "@kud/sonarqube"

const titleCase = (name: string): string =>
  name
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

const withBranch = (name: string, branch?: string) =>
  `${chalk.bold(name)}${branch ? ` (${branch})` : ""}`

/** Strips the `project:` prefix SonarQube puts on component keys. */
const componentPath = (component?: string) =>
  component?.split(":").slice(1).join(":") || component

const colourGateWord = (rawStatus?: string): string => {
  const word = gateStatusWord(rawStatus)
  if (rawStatus === "OK") return chalk.green(word)
  if (rawStatus === "ERROR") return chalk.red(word)
  if (rawStatus === "WARN") return chalk.yellow(word)
  return chalk.gray(word)
}

export const printProjectStatus = ({
  projectKey,
  branch,
  qualityGate,
  metrics,
}: {
  projectKey: string
  branch?: string
  qualityGate: ProjectStatus
  metrics: Measure[]
}) => {
  console.log(`\n📊 Project: ${withBranch(projectKey, branch)}\n`)
  console.log(`🚦 Quality gate: ${colourGateWord(qualityGate?.status)}`)
  if (qualityGate?.status === "ERROR")
    console.log(
      chalk.gray(
        `   Run \`sonarqube quality-gate${branch ? ` -b ${branch}` : ""}\` to see why.`,
      ),
    )
  console.log("")

  if (!metrics.length) {
    console.log(chalk.yellow("No metrics returned.\n"))
    return
  }
  const pad = Math.max(...metrics.map((m) => titleCase(m.metric).length)) + 2
  for (const metric of metrics)
    console.log(
      `• ${titleCase(metric.metric).padEnd(pad)} ${chalk.cyan(metric.value ?? "—")}`,
    )
  console.log("")
}

const isRating = (metric: string) => metric.endsWith("_rating")

/** "62.1, needs ≥ 80": the comparator says when the condition errors, so invert it. */
const describeCondition = (c: GateConditionExplanation): string => {
  const actual = c.actual ?? "—"
  if (c.threshold === undefined) return actual
  if (isRating(c.metric))
    return `${actual}, needs ${c.threshold}${c.threshold === "A" ? "" : " or better"}`
  const need =
    c.comparator === "LT"
      ? "≥"
      : c.comparator === "GT"
        ? "≤"
        : (c.comparator ?? "")
  return `${actual}, needs ${need} ${c.threshold}`.replace(/\s+/g, " ")
}

const describePeriod = (period: GateExplanation["newCodePeriod"]): string => {
  const parts = [period.mode, period.parameter].filter(Boolean).join(" ")
  const since = formatDate(period.date)
  return [parts || undefined, since ? `since ${since}` : undefined]
    .filter(Boolean)
    .join(", ")
}

export const printGateExplanation = ({
  projectKey,
  branch,
  gate,
}: {
  projectKey: string
  branch?: string
  gate: GateExplanation
}) => {
  console.log(
    `\n🚦 Quality gate: ${colourGateWord(gate.rawStatus)}  ${withBranch(projectKey, branch)}`,
  )
  if (gate.newCodePeriod) {
    const period = describePeriod(gate.newCodePeriod)
    if (period) console.log(chalk.gray(`   New code: ${period}`))
  }
  console.log("")
  if (!gate.conditions.length) {
    console.log(chalk.gray("No conditions reported.\n"))
    return
  }
  const pad = Math.max(...gate.conditions.map((c) => c.metric.length)) + 2
  for (const c of gate.conditions) {
    const mark = c.failing ? chalk.red("✖") : chalk.green("✔")
    const label = c.failing
      ? chalk.bold(c.metric.padEnd(pad))
      : c.metric.padEnd(pad)
    console.log(`  ${mark} ${label} ${describeCondition(c)}`)
  }
  const failing = gate.conditions.filter((c) => c.failing).length
  if (failing)
    console.log(
      `\n${chalk.red(`${failing} failing condition${failing === 1 ? "" : "s"}`)}`,
    )
  console.log("")
}

const severityColour = (severity: string) =>
  severity === "BLOCKER"
    ? chalk.bgRed.white
    : severity === "CRITICAL"
      ? chalk.red
      : severity === "MAJOR"
        ? chalk.yellow
        : severity === "MINOR"
          ? chalk.cyan
          : chalk.gray

const issueByline = (issue: Issue): string =>
  [formatIssueAuthor(issue.author), formatDate(issue.creationDate)]
    .filter(Boolean)
    .join(" · ")

export const printIssues = ({
  projectKey,
  branch,
  issues,
  paging,
  newCode,
}: {
  projectKey: string
  branch?: string
  issues: Issue[]
  paging?: { total: number }
  newCode?: boolean
}) => {
  const total = paging?.total !== undefined ? ` of ${paging.total}` : ""
  const scope = newCode ? " in new code" : ""
  console.log(
    `\n📝 Issues${scope} for: ${withBranch(projectKey, branch)} (showing ${issues.length}${total})\n`,
  )
  if (!issues.length) {
    console.log(chalk.green("No issues found with provided filters.") + "\n")
    return
  }
  for (const issue of issues) {
    const severity = severityColour(issue.severity)(issue.severity.padEnd(8))
    console.log(
      `${severity} ${chalk.magenta(issue.type.padEnd(10))} ${issue.message || "(no message)"}`,
    )
    const byline = issueByline(issue)
    console.log(
      `  ${chalk.dim(issue.key)} ${chalk.gray(issue.rule)}${byline ? `  ${byline}` : ""}`,
    )
    const comp = componentPath(issue.component)
    if (comp)
      console.log(`  ${chalk.blue(comp)}${issue.line ? ":" + issue.line : ""}`)
    console.log("")
  }
}

export const printIssuesSummary = ({
  projectKey,
  branch,
  total,
  facets,
}: {
  projectKey: string
  branch?: string
  total: number
  facets: Record<string, Record<string, number>>
}) => {
  console.log(`\n🧮 Issues summary: ${withBranch(projectKey, branch)}`)
  console.log(`Total issues: ${chalk.cyan(total)}`)
  const order = ["severities", "types", "statuses"]
  const names = [
    ...order.filter((name) => facets[name]),
    ...Object.keys(facets).filter((name) => !order.includes(name)),
  ]
  for (const name of names) {
    console.log(`\n${chalk.bold(titleCase(name))}:`)
    const entries = Object.entries(facets[name]).sort((a, b) => b[1] - a[1])
    const pad = Math.max(...entries.map(([k]) => k.length), 0) + 2
    for (const [key, count] of entries)
      console.log(`  ${key.padEnd(pad)} ${chalk.green(count)}`)
  }
  console.log("")
}

export const printIssue = (issue: Issue) => {
  console.log(`\n🔎 Issue ${chalk.dim(issue.key)}\n`)
  console.log(
    `${chalk.bold(issue.severity)} ${chalk.magenta(issue.type)} ${issue.status || ""}`,
  )
  console.log(issue.message || "(no message)")
  console.log(chalk.gray(issue.rule || ""))
  const byline = issueByline(issue)
  if (byline) console.log(byline)
  const comp = componentPath(issue.component)
  if (comp) console.log(chalk.blue(comp) + (issue.line ? ":" + issue.line : ""))
  if (issue.textRange)
    console.log(`Lines ${issue.textRange.startLine}-${issue.textRange.endLine}`)
  console.log("")
}

const hotspotSeverity = (h: any): string =>
  h.vulnerabilityProbability || h.severity || "UNKNOWN"

export const printHotspots = ({
  projectKey,
  branch,
  hotspots,
}: {
  projectKey: string
  branch?: string
  hotspots: any[]
}) => {
  console.log(
    `\n🔥 Hotspots for: ${withBranch(projectKey || "", branch)} (showing ${hotspots.length})\n`,
  )
  if (!hotspots.length) {
    console.log(chalk.green("No hotspots.\n"))
    return
  }
  for (const h of hotspots) {
    const sev = hotspotSeverity(h)
    const colour =
      sev === "HIGH" ? chalk.red : sev === "MEDIUM" ? chalk.yellow : chalk.gray
    console.log(
      `${colour(sev.padEnd(6))} ${h.securityCategory || ""} ${h.message}`,
    )
    console.log(`  ${chalk.dim(h.key)}`)
    const comp = componentPath(h.component)
    if (comp) console.log(`  ${chalk.blue(comp)}${h.line ? ":" + h.line : ""}`)
    console.log("")
  }
}

export const printHotspot = (h: any) => {
  console.log(`\n🔥 Hotspot ${chalk.dim(h.key)}\n`)
  console.log(`${hotspotSeverity(h)} ${h.securityCategory || ""}`)
  console.log(h.message || "")
  const comp = componentPath(h.component?.key ?? h.component)
  if (comp) console.log(chalk.blue(comp) + (h.line ? ":" + h.line : ""))
  console.log("")
}

export const printRules = ({ rules }: { rules: any[] }) => {
  console.log(`\n📐 Rules (showing ${rules.length})\n`)
  if (!rules.length) {
    console.log(chalk.yellow("No rules matched.\n"))
    return
  }
  for (const r of rules) {
    console.log(
      `${(r.severity || "").padEnd(8)} ${chalk.magenta(r.key)} ${r.name}`,
    )
    console.log(
      `  ${chalk.gray(r.lang || "")} ${(r.tags || []).map((t: string) => "#" + t).join(" ")}`,
    )
  }
  console.log("")
}

export const printRule = (rule: any) => {
  console.log(`\n📐 Rule ${chalk.magenta(rule.key)}\n`)
  console.log(rule.name)
  console.log(chalk.gray(rule.lang || ""))
  if (rule.htmlDesc) {
    const text = rule.htmlDesc
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    console.log("\n" + text)
  }
  console.log("")
}

export const printMeasures = (component: {
  key?: string
  measures?: Measure[]
}) => {
  console.log(`\n📏 Measures for ${chalk.bold(component.key || "component")}\n`)
  const measures = component.measures || []
  const pad = Math.max(10, ...measures.map((m) => (m.metric || "").length)) + 2
  for (const m of measures)
    console.log(`${(m.metric || "").padEnd(pad)} ${chalk.cyan(m.value ?? "—")}`)
  console.log("")
}

const SPARK_CHARS = "▁▂▃▄▅▆▇█"

const sparkline = (values: number[]): string => {
  const min = Math.min(...values)
  const range = Math.max(...values) - min || 1
  return values
    .map(
      (v) =>
        SPARK_CHARS[Math.round(((v - min) / range) * (SPARK_CHARS.length - 1))],
    )
    .join("")
}

export const printMeasuresHistory = (history: {
  measures?: { metric: string; history?: { date: string; value?: string }[] }[]
}) => {
  console.log(`\n🕒 Measures history\n`)
  for (const m of history.measures || []) {
    console.log(`Metric: ${chalk.bold(m.metric)}`)
    const points = m.history || []
    if (!points.length) {
      console.log("  (no data)")
      continue
    }
    const numeric = points
      .map((p) => parseFloat(p.value))
      .filter((v) => !isNaN(v))
    if (numeric.length === points.length) console.log(`  ${sparkline(numeric)}`)
    const last = points[points.length - 1]
    console.log(
      `  Latest: ${chalk.cyan(last.value)} at ${formatDate(last.date) || last.date}`,
    )
  }
  console.log("")
}

export const printComponentTree = (tree: {
  baseComponent?: { key?: string }
  components?: any[]
}) => {
  console.log(
    `\n🌳 Component tree: ${chalk.bold(tree.baseComponent?.key || "")}\n`,
  )
  for (const c of tree.components || []) {
    const metrics = (c.measures || [])
      .map((m: Measure) => `${m.metric}=${m.value}`)
      .join(" ")
    console.log(
      `${c.qualifier || ""} ${chalk.blue(c.key || c.id || "")} ${metrics}`,
    )
  }
  console.log("")
}

export const printDuplications = (dups: {
  duplications?: { blocks?: { _ref?: string; from: number; size: number }[] }[]
  files?: Record<string, { key?: string; name?: string }>
}) => {
  console.log(`\n🧬 Duplications\n`)
  const segments = dups.duplications || []
  if (!segments.length) {
    console.log("No duplicated segments.\n")
    return
  }
  for (const segment of segments) {
    const blocks = segment.blocks || []
    console.log(`Segment (${blocks.length} blocks)`)
    for (const b of blocks) {
      const file = (b._ref && dups.files?.[b._ref]) || undefined
      const name = file?.name || file?.key || b._ref || "?"
      console.log(
        `  ${chalk.blue(name)} lines ${b.from}-${b.from + b.size - 1}`,
      )
    }
  }
  console.log("")
}

export const printQualityProfiles = (profiles: any[]) => {
  console.log(`\n🛠️ Quality profiles (${profiles.length})\n`)
  for (const p of profiles)
    console.log(
      [
        chalk.bold(p.language || ""),
        chalk.green(p.name),
        p.isDefault ? "[default]" : "",
        p.isInherited ? "[inherited]" : "",
      ]
        .filter(Boolean)
        .join(" "),
    )
  console.log("")
}
