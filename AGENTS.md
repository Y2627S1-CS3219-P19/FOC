# AGENTS.md

Guide for automated coding agents in this repo.

> **Canonical config.** Single source of truth for every coding agent — Claude Code, Codex, Cursor, Antigravity.

## 1) Mission

- Make the **smallest safe change**. Prefer existing patterns; no broad refactors unless asked.
- Minimize **complexity and execution paths**, not characters. Often the best change is a vetted package or a few lines in the right service.
- **Write simple English everywhere** — docs, PRs, and especially code comments. Short sentences, common words, no jargon where a plain term works. Lead with the answer; cut filler. (Design docs and internal reasoning keep full rigor.)
- **Comments: few and plain.** Comment only what the code can't say — a constraint, a non-obvious why. Never narrate what the next line does or restate the diff. No verbose or decorative comments.

## 2) Coding & Architecture Rules

- **Microservices skeleton:** Respect the one-service-per-folder structure (`user-service/`, `supplier-service/`, `order-service/`, `credit-service/`). Do not cross-import code directly across service folders.
- **Service-level agent rules:** Check the service-specific `AGENTS.md` within each service folder for local conventions, technologies, and API contracts.
- **Cross-service impact:** Touching multiple services or modifying inter-service contracts requires validating the affected services and dependencies (e.g. via `docker compose up`).
- **Keep documentation in sync:** Any schema, environment variable, or architectural change must update the corresponding service `README.md`, top-level `README.md`, or `.env.example` in the same change.

## 3) PR Hygiene

PR bodies **must follow [`.github/pull_request_template.md`](.github/pull_request_template.md)** — exact section headers, checklist ticked honestly (annotate items that don't apply). Under "Describe your changes": what changed and why, validation commands run, follow-ups called out instead of half-implemented hidden scope.

## 4) Ownership: Agent vs Human

- **Service Ownership:** Services have designated student owners (see [README.md](README.md)). Any non-trivial change touching a service should be reviewed by that service's owner.
- **Agent Work:** PRs authored or heavily assisted by automated agents must clearly describe all generated changes and testing steps.
- **Promotion:** An agent's work is considered promoted (`owner:human`) once the human service owner reviews, validates with tests/Docker Compose, and merges the PR.

