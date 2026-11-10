# Changelog

All notable changes to this project are documented here.

---

## 0.3.0 — 2026-11-10

### Breaking Changes

- The package is now `@kud/sonarqube-cli` (was `sonarqube-dash`); install it with `npm install -g @kud/sonarqube-cli`. Both `sonarqube` and `sonarqube-dash` binaries are provided, and Node 22+ is required. ([99116f0](https://github.com/kud/sonarqube-cli/commit/99116f0e5874e46bfe38cfddfa5872dee4aae250))
- The host flag is now `-H, --host`, so `-h` always means help. Replace `-h <url>` in scripts with `-H <url>`. ([99116f0](https://github.com/kud/sonarqube-cli/commit/99116f0e5874e46bfe38cfddfa5872dee4aae250))

### Highlights

- `quality-gate` (now also `gate`) explains why the gate is red, listing failing conditions first; the new `--fail` exits with code 1 so it can gate CI. ([99116f0](https://github.com/kud/sonarqube-cli/commit/99116f0e5874e46bfe38cfddfa5872dee4aae250))
- Running `sonarqube` with no command opens the interactive issues dashboard, and `issues --new-code` limits results to the new-code period. ([99116f0](https://github.com/kud/sonarqube-cli/commit/99116f0e5874e46bfe38cfddfa5872dee4aae250))
- Connection settings now resolve from flags, environment, config file or `sonar-project.properties`, via the shared `@kud/sonarqube` core. ([99116f0](https://github.com/kud/sonarqube-cli/commit/99116f0e5874e46bfe38cfddfa5872dee4aae250))

### Documentation

- The README is rewritten around the new package name, with a shorter install and a quick start using `SONARQUBE_DASH_*` environment variables. ([6138c6e](https://github.com/kud/sonarqube-cli/commit/6138c6edd27acd27468c6b55e1dbe3c5666225f2))

<details>
<summary>Internal (3 commits)</summary>

- Rewrote the CLI in TypeScript with an end-to-end test suite that runs against a fake SonarQube server.
- Added a CI workflow (build, typecheck, test) and a tag-triggered npm publish with provenance, using lockfile installs.
- Added an MIT LICENSE and the project icon.

</details>

---
