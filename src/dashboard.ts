import chalk from "chalk"
import { highlight } from "cli-highlight"
import type { Issue, IssuesQuery, SonarQubeClient } from "@kud/sonarqube"

const HELP =
  "q:quit  ↑/↓:navigate  enter:view  r:refresh code  b:branches  h:help"

const STATUS_TAGS: Record<string, string> = {
  OPEN: "{green-fg}OPEN{/green-fg}",
  CONFIRMED: "{green-fg}CONFIRMED{/green-fg}",
  REOPENED: "{yellow-fg}REOPENED{/yellow-fg}",
  RESOLVED: "{cyan-fg}RESOLVED{/cyan-fg}",
  CLOSED: "{gray-fg}CLOSED{/gray-fg}",
}

const SEVERITY_TAGS: Record<string, string> = {
  BLOCKER: "{red-fg}BLOCKER{/red-fg}",
  CRITICAL: "{magenta-fg}CRITICAL{/magenta-fg}",
  MAJOR: "{yellow-fg}MAJOR{/yellow-fg}",
  MINOR: "{green-fg}MINOR{/green-fg}",
  INFO: "{blue-fg}INFO{/blue-fg}",
}

const LANGUAGES: [RegExp, string][] = [
  [/\.jsx?$/, "javascript"],
  [/\.tsx?$/, "typescript"],
  [/\.java$/, "java"],
  [/\.py$/, "python"],
  [/\.cs$/, "csharp"],
  [/\.(cpp|cc|hpp)$/, "cpp"],
  [/\.rb$/, "ruby"],
  [/\.go$/, "go"],
  [/\.php$/, "php"],
  [/\.xml$/, "xml"],
  [/\.json$/, "json"],
]

const truncate = (text: string, n: number) =>
  text.length > n ? text.slice(0, n - 1) + "…" : text

const escapeTags = (text: string) =>
  text.replace(/\{/g, "<").replace(/\}/g, ">")

const guessLanguage = (component = "") =>
  LANGUAGES.find(([pattern]) => pattern.test(component.toLowerCase()))?.[1] ??
  "plaintext"

const colouriseSnippet = (text: string, issue: Issue): string => {
  try {
    return (
      highlight(text, {
        language: guessLanguage(issue.component),
        ignoreIllegals: true,
      })
        // blessed cannot parse SGR 58/59 (underline colour)
        .replace(/\x1b\[58:[0-9:;]*m/g, "")
        .replace(/\x1b\[59m/g, "")
    )
  } catch {
    return text
  }
}

const listItem = (issue: Issue) =>
  `${SEVERITY_TAGS[issue.severity] ?? issue.severity} ${issue.type.padEnd(11)} ${truncate(
    issue.message || "(no message)",
    50,
  )}`

const describeFlow = (issue: any): string => {
  if (!issue.flows?.length && !issue.flow?.length) return ""
  const flows: any[] = issue.flows ?? issue.flow
  const steps = flows
    .map((flow, i) => {
      const loc = flow.locations?.[0]
      if (!loc) return ""
      return `  ${i + 1}. ${escapeTags(loc.msg || "")} {gray-fg}(${loc.component}:${
        loc.textRange?.startLine ?? "?"
      }){/gray-fg}`
    })
    .filter(Boolean)
  return steps.length ? `{cyan-fg}Flow:{/cyan-fg}\n${steps.join("\n")}` : ""
}

const describeIssue = (issue: Issue, branch?: string): string => {
  const meta = [
    `{bold}${SEVERITY_TAGS[issue.severity] ?? issue.severity}{/bold}`,
    `{magenta-fg}${issue.type}{/magenta-fg}`,
    STATUS_TAGS[issue.status] ?? issue.status ?? "",
    branch ? `{gray-fg}[${branch}]{/gray-fg}` : "",
    `{cyan-fg}${issue.key}{/cyan-fg}`,
  ]
    .filter(Boolean)
    .join("  ")
  const lines = [meta]
  if (issue.component)
    lines.push(
      `{blue-fg}${issue.component}{/blue-fg}${issue.line ? ":" + issue.line : ""}`,
    )
  if (issue.textRange)
    lines.push(
      `{gray-fg}Lines: ${issue.textRange.startLine}-${issue.textRange.endLine}{/gray-fg}`,
    )
  const flow = describeFlow(issue)
  if (flow) lines.push(flow)
  lines.push(`{gray-fg}${"─".repeat(50)}{/gray-fg}`)
  lines.push(
    `{bold}{yellow-fg}${escapeTags(issue.message || "(no message)")}{/yellow-fg}{/bold}`,
  )
  return lines.join("\n")
}

/**
 * blessed 0.1.81 cannot parse the modern xterm-256color terminfo (Setulc) and
 * prints noise, so run under plain `xterm` and restore TERM on the way out.
 */
const downgradeTerm = (): (() => void) => {
  const original = process.env.TERM
  if (!original || !/xterm-256color/i.test(original)) return () => {}
  process.env.TERM = "xterm"
  return () => {
    process.env.TERM = original
  }
}

/** Full-screen issues dashboard: list, detail and live code snippet. */
export const runDashboard = async (
  client: SonarQubeClient,
  initialQuery: IssuesQuery,
): Promise<void> => {
  let query = { ...initialQuery }
  let { issues } = await client.getIssues(query)
  if (!issues.length) {
    console.log(chalk.green("No issues found with provided filters."))
    return
  }

  const restoreTerm = downgradeTerm()
  const { default: blessed } = await import("blessed")
  const screen = blessed.screen({
    smartCSR: true,
    title: `Issues - ${query.project}`,
  })

  const list = blessed.list({
    parent: screen,
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    width: "40%",
    height: "100%-1",
    border: { type: "line" },
    style: { selected: { bg: "blue" }, scrollbar: { bg: "white" } },
    scrollbar: { ch: " " } as any,
  })

  const paneOptions = {
    parent: screen,
    tags: true,
    left: "40%",
    width: "60%",
    border: { type: "line" as const },
    scrollable: true,
    keys: true,
    mouse: true,
    alwaysScroll: true,
    scrollbar: { ch: " " } as any,
  }
  const detail = blessed.box({
    ...paneOptions,
    label: " {bold}Detail{/bold} ",
    height: "50%",
  })
  const code = blessed.box({
    ...paneOptions,
    label: " {bold}Code{/bold} ",
    top: "50%",
    height: "50%-1",
  })
  const status = blessed.box({
    parent: screen,
    bottom: 0,
    height: 1,
    width: "100%",
    tags: true,
    style: { bg: "gray" },
    content: HELP,
  })

  const showIssues = () => {
    list.setLabel(
      ` {bold}Issues (${issues.length})${query.branch ? ` [${query.branch}]` : ""}{/bold} `,
    )
    list.setItems(issues.map(listItem) as any)
    list.select(0)
    lastRendered = -1
    if (!issues.length) {
      detail.setContent(
        "{green-fg}No issues found with provided filters.{/green-fg}",
      )
      code.setContent("")
    }
  }

  let renderSeq = 0
  let lastRendered = -1
  const render = async (idx: number, force = false) => {
    if (idx === lastRendered && !force) return
    lastRendered = idx
    const seq = ++renderSeq
    const issue = issues[idx]
    if (!issue) return
    detail.setContent(describeIssue(issue, query.branch))
    code.setContent("Loading code snippet...")
    screen.render()
    const source = await client.getIssueSource(issue)
    if (seq !== renderSeq) return
    code.setContent(
      source?.snippet
        ? colouriseSnippet(source.snippet, issue)
        : "(no snippet)",
    )
    screen.render()
  }

  const selectedIndex = () => (list as any).selected as number

  list.on("select", (_item, idx) => void render(idx))
  list.on("keypress", (_ch, key) => {
    if (["up", "down", "k", "j"].includes(key.name))
      void render(selectedIndex())
  })

  screen.on("destroy", restoreTerm)
  screen.key(["q", "C-c"], () => {
    screen.destroy()
    process.exit(0)
  })
  screen.key(["r"], async () => {
    status.setContent(HELP + "  refreshing code...")
    await render(selectedIndex(), true)
    status.setContent(HELP)
    screen.render()
  })
  screen.key(["?", "h"], () => {
    status.setContent(HELP)
    screen.render()
  })
  screen.key(["b"], async () => {
    status.setContent(HELP + "  loading branches...")
    screen.render()
    const branches = await client.getBranches(query.project).catch(() => [])
    if (!branches.length) {
      status.setContent(HELP + "  no branches")
      screen.render()
      return
    }
    const picker = blessed.list({
      parent: screen,
      label: " {bold}Branches{/bold} ",
      width: "30%",
      height: "50%",
      left: "center",
      top: "center",
      border: { type: "line" },
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      items: branches.map((b) => b.name + (b.isMain ? " *" : "")),
      style: { selected: { bg: "blue" } },
    })
    const closePicker = () => {
      picker.destroy()
      status.setContent(HELP)
      list.focus()
      screen.render()
    }
    picker.key(["escape"], closePicker)
    picker.on("select", async (_item, idx) => {
      // Same filters and limit as the launch; only the branch changes.
      const nextQuery = { ...query, branch: branches[idx].name }
      try {
        issues = (await client.getIssues(nextQuery)).issues
        query = nextQuery
        showIssues()
        await render(0, true)
        closePicker()
      } catch {
        closePicker()
        status.setContent(HELP + "  branch load failed")
        screen.render()
      }
    })
    picker.focus()
    screen.render()
  })

  showIssues()
  list.focus()
  await render(0)
  screen.render()
}
