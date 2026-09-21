# GitHub Copilot — Friend on Campus (FoC) instructions

**Canonical source of truth is [`AGENTS.md`](../AGENTS.md).** It is shared by Claude Code, Codex, Cursor, and Antigravity; this file mirrors the essentials for Copilot, which does not read `AGENTS.md` on its own. When in doubt, open `AGENTS.md`.

## How to work here

- **Smallest safe change.** Minimize complexity and execution paths, not characters. Prefer fixes consistent with existing patterns over new abstractions; avoid broad refactors unless asked.
- **Build-vs-buy.** If a problem is already solved, prefer a vetted SaaS/OSS package over hand-rolled code — but check license, maintenance/bus-factor, CVEs, bundle size, and lock-in first.
- **Communicate with maximum compression.** Point form; lead with the answer; cut filler. Human cognition is the binding constraint.
- **Microservices skeleton:** Respect the one-service-per-folder structure (`user-service/`, `supplier-service/`, `order-service/`, `credit-service/`). Do not cross-import code directly across service folders.
- **Validate before handoff:** Test and lint affected services; run `docker compose up` to validate inter-service flows for cross-service changes; self-review your diff.

## Repo conventions that change how you work

- **Issue tracker:** GitHub Issues on this repository. Follow the issue templates in [`.github/ISSUE_TEMPLATE/`](./ISSUE_TEMPLATE/).
- **Service ownership & promotion:** Services have designated student owners (see [`README.md`](../README.md)). Agent-authored changes are promoted (`owner:human`) once the human service owner reviews, validates, and merges the PR.
- **Documentation in sync:** Updating a service schema, environment variable, or contract requires updating that service's `README.md`, top-level `README.md`, or `.env.example` in the same PR.
