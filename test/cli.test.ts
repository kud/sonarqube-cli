import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { startFakeSonarQube, type Handler } from "./fake-sonarqube.js"

const BIN = fileURLToPath(new URL("../bin/sonarqube.ts", import.meta.url))
const TSX = import.meta.resolve("tsx")

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

const makeHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sonarqube-cli-"))
  const xdg = path.join(home, ".config")
  fs.mkdirSync(xdg)
  return {
    home,
    xdg,
    configFile: path.join(xdg, "sonarqube-dash-cli", "config.json"),
  }
}

const cleanEnv = (extra: Record<string, string>) => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env))
    if (!/^SONAR/.test(key) && value !== undefined) env[key] = value
  return { ...env, NO_COLOR: "1", ...extra }
}

const run = (
  args: string[],
  {
    env = {},
    cwd,
    home = makeHome(),
  }: {
    env?: Record<string, string>
    cwd?: string
    home?: ReturnType<typeof makeHome>
  } = {},
): Promise<RunResult> =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", TSX, BIN, ...args],
      {
        cwd: cwd ?? home.home,
        env: cleanEnv({ HOME: home.home, XDG_CONFIG_HOME: home.xdg, ...env }),
      },
      (err, stdout, stderr) =>
        resolve({
          code: err ? ((err as any).code ?? 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        }),
    )
  })

const withFake = async (
  handler: Handler,
  body: (fake: Awaited<ReturnType<typeof startFakeSonarQube>>) => Promise<void>,
) => {
  const fake = await startFakeSonarQube(handler)
  try {
    await body(fake)
  } finally {
    await fake.close()
  }
}

const FAILING_GATE = {
  projectStatus: {
    status: "ERROR",
    period: {
      mode: "PREVIOUS_VERSION",
      parameter: "1.2.0",
      date: "2026-10-01T10:00:00+0000",
    },
    conditions: [
      {
        status: "OK",
        metricKey: "new_duplicated_lines_density",
        comparator: "GT",
        errorThreshold: "3",
        actualValue: "0.5",
      },
      {
        status: "ERROR",
        metricKey: "new_coverage",
        comparator: "LT",
        errorThreshold: "80",
        actualValue: "62.1",
      },
      {
        status: "ERROR",
        metricKey: "new_reliability_rating",
        comparator: "GT",
        errorThreshold: "1",
        actualValue: "3",
      },
    ],
  },
}

test("--help and <cmd> -h print help, -h is never host", async () => {
  const root = await run(["--help"])
  assert.equal(root.code, 0)
  assert.match(root.stdout, /quality-gate/)
  const sub = await run(["quality-gate", "-h"])
  assert.equal(sub.code, 0)
  assert.match(sub.stdout, /-H, --host <url>/)
  assert.match(sub.stdout, /-h, --help/)
})

test("bare command outside a terminal prints help instead of drawing", async () => {
  const result = await run([])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /Usage: sonarqube/)
})

test("an unknown command is an error", async () => {
  const result = await run(["nope"])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /unknown command 'nope'/)
})

test("missing host names --host, the env vars and config set", async () => {
  const result = await run(["quality-gate", "-p", "my-project"])
  assert.equal(result.code, 1)
  assert.match(result.stderr, /--host/)
  assert.match(result.stderr, /SONARQUBE_DASH_HOST/)
  assert.match(result.stderr, /SONAR_HOST_URL/)
  assert.match(result.stderr, /config set/)
})

test("print-config keeps file values, layers env over them and redacts the token", async () => {
  const home = makeHome()
  fs.mkdirSync(path.dirname(home.configFile), { recursive: true })
  fs.writeFileSync(
    home.configFile,
    JSON.stringify({
      host: "https://sonarqube.example.com",
      project: "from-file",
      branch: "develop",
    }),
  )
  const result = await run(["print-config"], {
    home,
    env: { SONAR_TOKEN: "secret-token", SONARQUBE_DASH_PROJECT: "from-env" },
  })
  assert.equal(result.code, 0)
  assert.deepEqual(JSON.parse(result.stdout), {
    host: "https://sonarqube.example.com",
    project: "from-env",
    branch: "develop",
    token: "***",
  })
  assert.doesNotMatch(result.stdout, /secret-token/)
})

test("env fallbacks: SONAR_HOST_URL and SONAR_TOKEN reach the server", async () => {
  await withFake(
    () => ({ body: { projectStatus: { status: "OK", conditions: [] } } }),
    async (fake) => {
      const result = await run(["quality-gate", "-p", "my-project"], {
        env: { SONAR_HOST_URL: fake.host, SONAR_TOKEN: "tok" },
      })
      assert.equal(result.code, 0, result.stderr)
      assert.equal(
        fake.requests[0].authorization,
        "Basic " + Buffer.from("tok:").toString("base64"),
      )
    },
  )
})

test("-H overrides the host from env", async () => {
  await withFake(
    () => ({ body: { projectStatus: { status: "OK", conditions: [] } } }),
    async (fake) => {
      const result = await run(
        ["quality-gate", "-p", "my-project", "-H", fake.host],
        {
          env: { SONARQUBE_DASH_HOST: "http://127.0.0.1:9" },
        },
      )
      assert.equal(result.code, 0, result.stderr)
      assert.equal(fake.requests.length, 1)
    },
  )
})

test("quality-gate explains a red gate, failing conditions first", async () => {
  await withFake(
    () => ({ body: FAILING_GATE }),
    async (fake) => {
      const result = await run([
        "quality-gate",
        "-p",
        "my-project",
        "-b",
        "main",
        "-H",
        fake.host,
      ])
      assert.equal(result.code, 0, result.stderr)
      assert.deepEqual(fake.requests[0].query, {
        projectKey: "my-project",
        branch: "main",
      })
      assert.match(result.stdout, /Quality gate: FAILED\s+my-project \(main\)/)
      assert.match(
        result.stdout,
        /New code: PREVIOUS_VERSION 1\.2\.0, since 2026-10-01/,
      )
      assert.match(result.stdout, /new_coverage\s+62\.1, needs ≥ 80/)
      assert.match(result.stdout, /new_reliability_rating\s+C, needs A/)
      const lines = result.stdout.split("\n").filter((l) => /[✖✔]/.test(l))
      assert.deepEqual(
        lines.map((l) => l.trim().split(/\s+/)[1]),
        [
          "new_coverage",
          "new_reliability_rating",
          "new_duplicated_lines_density",
        ],
      )
      assert.match(result.stdout, /2 failing conditions/)
    },
  )
})

test("quality-gate --fail exits 1 on ERROR and 0 on OK", async () => {
  await withFake(
    () => ({ body: FAILING_GATE }),
    async (fake) => {
      const red = await run([
        "quality-gate",
        "--fail",
        "-p",
        "my-project",
        "-H",
        fake.host,
      ])
      assert.equal(red.code, 1)
      const plain = await run([
        "quality-gate",
        "-p",
        "my-project",
        "-H",
        fake.host,
      ])
      assert.equal(plain.code, 0)
    },
  )
  await withFake(
    () => ({ body: { projectStatus: { status: "OK", conditions: [] } } }),
    async (fake) => {
      const green = await run([
        "quality-gate",
        "--fail",
        "-p",
        "my-project",
        "-H",
        fake.host,
      ])
      assert.equal(green.code, 0)
      assert.match(green.stdout, /Quality gate: OK/)
    },
  )
})

test("quality-gate --json carries the explanation", async () => {
  await withFake(
    () => ({ body: FAILING_GATE }),
    async (fake) => {
      const result = await run([
        "quality-gate",
        "--json",
        "-p",
        "my-project",
        "-H",
        fake.host,
      ])
      const json = JSON.parse(result.stdout)
      assert.equal(json.status, "FAILED")
      assert.equal(json.rawStatus, "ERROR")
      assert.equal(json.conditions[0].metric, "new_coverage")
    },
  )
})

test("metrics words a missing gate result honestly and hints at quality-gate when red", async () => {
  const measures = {
    component: {
      key: "my-project",
      measures: [{ metric: "bugs", value: "2" }],
    },
  }
  await withFake(
    (req) =>
      req.path === "/api/qualitygates/project_status"
        ? { body: { projectStatus: { status: "NONE" } } }
        : req.path === "/api/project_branches/list"
          ? { body: { branches: [{ name: "main", isMain: true }] } }
          : { body: measures },
    async (fake) => {
      const result = await run(["metrics", "-p", "my-project", "-H", fake.host])
      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /Quality gate: no gate result/)
      assert.doesNotMatch(result.stdout, /FAILED|Gate Name/)
      assert.match(result.stdout, /my-project \(main\)/)
    },
  )
  await withFake(
    (req) =>
      req.path === "/api/qualitygates/project_status"
        ? { body: { projectStatus: { status: "ERROR" } } }
        : { body: measures },
    async (fake) => {
      const result = await run([
        "metrics",
        "-p",
        "my-project",
        "-b",
        "develop",
        "-H",
        fake.host,
      ])
      assert.match(result.stdout, /Quality gate: FAILED/)
      assert.match(result.stdout, /sonarqube quality-gate -b develop/)
    },
  )
})

test("project key falls back to sonar-project.properties", async () => {
  const home = makeHome()
  const projectDir = path.join(home.home, "repo")
  fs.mkdirSync(projectDir)
  fs.writeFileSync(
    path.join(projectDir, "sonar-project.properties"),
    "# analysis\nsonar.projectKey=props-project\nsonar.sources=src\n",
  )
  await withFake(
    () => ({ body: { projectStatus: { status: "OK", conditions: [] } } }),
    async (fake) => {
      const result = await run(["quality-gate", "-H", fake.host], {
        home,
        cwd: projectDir,
      })
      assert.equal(result.code, 0, result.stderr)
      assert.equal(fake.requests[0].query.projectKey, "props-project")
    },
  )
})

const ISSUES = {
  paging: { pageIndex: 1, pageSize: 10, total: 1 },
  issues: [
    {
      key: "AX1",
      rule: "typescript:S1854",
      severity: "MAJOR",
      type: "CODE_SMELL",
      status: "OPEN",
      component: "my-project:src/app.ts",
      line: 12,
      message: "Remove this useless assignment.",
      author: "someone@example.com",
      creationDate: "2026-09-14T08:30:00+0000",
    },
  ],
}

test("issues --new-code asks for the new-code period and keeps resolved=false", async () => {
  await withFake(
    () => ({ body: ISSUES }),
    async (fake) => {
      const result = await run([
        "issues",
        "--new-code",
        "-p",
        "my-project",
        "-H",
        fake.host,
      ])
      assert.equal(result.code, 0, result.stderr)
      assert.equal(fake.requests[0].path, "/api/issues/search")
      assert.equal(fake.requests[0].query.inNewCodePeriod, "true")
      assert.equal(fake.requests[0].query.resolved, "false")
      assert.match(result.stdout, /Issues in new code for: my-project/)
    },
  )
})

test("issues --statuses drops the resolved=false default", async () => {
  await withFake(
    () => ({ body: ISSUES }),
    async (fake) => {
      await run([
        "issues",
        "--statuses",
        "CLOSED",
        "-p",
        "my-project",
        "-H",
        fake.host,
      ])
      assert.equal(fake.requests[0].query.statuses, "CLOSED")
      assert.equal(fake.requests[0].query.resolved, undefined)
    },
  )
})

test("issues show the author before @ and a YYYY-MM-DD date", async () => {
  await withFake(
    () => ({ body: ISSUES }),
    async (fake) => {
      const result = await run(["issues", "-p", "my-project", "-H", fake.host])
      assert.match(result.stdout, /someone · 2026-09-14/)
      assert.doesNotMatch(result.stdout, /@example\.com/)
      assert.match(result.stdout, /src\/app\.ts:12/)
    },
  )
})

test("config set, get and show use the XDG config file", async () => {
  const home = makeHome()
  const set = await run(
    ["config", "set", "host=https://sonarqube.example.com", "token=abc"],
    { home },
  )
  assert.equal(set.code, 0, set.stderr)
  assert.match(
    set.stdout,
    new RegExp(home.configFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  )
  const get = await run(["config", "get", "host"], { home })
  assert.equal(get.stdout.trim(), "https://sonarqube.example.com")
  const token = await run(["config", "get", "token"], { home })
  assert.equal(token.stdout.trim(), "***")
  const missing = await run(["config", "get", "branch"], { home })
  assert.equal(missing.code, 1)
  const show = await run(["config", "show"], { home })
  assert.deepEqual(JSON.parse(show.stdout), {
    host: "https://sonarqube.example.com",
    token: "***",
  })
})

test("an HTTP 401 is one readable line with a token hint", async () => {
  await withFake(
    () => ({ status: 401, body: {} }),
    async (fake) => {
      const result = await run([
        "quality-gate",
        "-p",
        "my-project",
        "-H",
        fake.host,
        "-t",
        "bad-token",
      ])
      assert.equal(result.code, 1)
      assert.match(result.stderr, /HTTP 401/)
      assert.match(result.stderr, /Check the token/)
      assert.doesNotMatch(result.stderr, /bad-token/)
    },
  )
})
