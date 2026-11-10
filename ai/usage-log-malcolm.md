# AI Usage Log — FOC (Friend on Campus)

**Member:** Malcolm Chu (GitHub `malcolmchu13`)
**Period covered:** 2026-10-08 → 2026-11-10
**Scope:** As advised by the teaching team, this log lists the prompts where an AI tool
**generated, refactored or debugged project code**, plus **explain** prompts about how the
project's own code works:
- **generate / refactor:** the session shows the tool creating or changing files in this repo in
  reply to the prompt.
- **debug:** the prompt asked the tool to explain an error from the project, run or suggest tests,
  or review the code for bugs.
- **explain:** the prompt asked what existing project code or config does, or how it works.

**Coverage note:** All traces come from the Claude Code session history on this laptop
(`~/.claude/projects/-Users-malcolmchu-FOC/`). Work before 2026-10-08 is not in these
traces.

## Tools used

| Tool | Models | Sessions | Prompts listed | generate | refactor | debug | explain |
|---|---|---|---|---|---|---|---|
| Claude Code (VS Code extension) | claude-opus-5-5 | 4 | 83 | 15 | 3 | 25 | 41 |

(#13 counts as both generate and refactor.)

## Usage summary by seam

Prompt numbers (#) refer to the index below.

### A. Order Service implementation — 21 prompts (2026-10-08, Claude Code)
- **Mode:** generate; refactor (#6, #13); debug (#2–3); explain (#4–5, #8, #10–11, #14, #21).
- **Scenario:** Claude built `order-service/` in stages from a written brief: schema and
  migrations, state transitions, create/read APIs, status changes with permission checks,
  expiry jobs, outbox, and a retry queue and DLQ for credit events, plus tests, Dockerfile,
  seed data and docs. Commits `8bb3e58`, `3f3fe90`, `84f7b10`, `31ae2a5`. I ran the migration
  checks against a test Postgres (#2–3) and asked Claude to explain the files and changes
  (#4–5, #8, #10–11, #14, #21).
- **Context for the listed prompts:**
  - #1 is a brief Claude rewrote from my own first brief, to match the repo's real contracts.
    I pasted it back to start the build.
  - #12: I asked Claude to switch the HTTP clients to RabbitMQ events. Claude also made credit
    reservation event-driven, though my first brief had it synchronous. I kept that version
    (see #69).
  - #18: Claude proposed the DLQ (5 retries, then dead-letter) and I approved it.

### B. Integration & Docker builds — 29 prompts (2026-10-08 → 10-14, Claude Code)
- **Mode:** debug (14), explain (13), generate (#22), refactor (#53).
- **Scenario:** Wiring order-service into compose, the nginx gateway and npm workspaces (#22,
  `3fc8771`). Resolving a Dockerfile merge conflict (#24). Fixing the supplier-service Dockerfile
  and the compose build failures (#41, #45–47, #49–52, #54–55, `cea883b`). Taking supplier-service
  out of the root npm workspace after Claude recommended it (#53, `11bd365`). Finding why the build
  failed for teammates (#59) and reviewing the four Dockerfiles for consistency (#71). Explanations
  of the Dockerfile `COPY` lines, how the containers talk to each other, and how Order Service gets
  supplier data (#25–36, #58).

### C. Order↔Credit contract check & fix — 7 prompts (2026-10-09, Claude Code)
- **Mode:** debug (#37–38, #43–44), explain (#39–40, #42).
- **Scenario:** Checking that the events between Credit and Order Service match (#37), reviewing
  Order Service for issues (#38), explaining the order states and events (#39–40, #42), then
  pointing the supplier lookup back at the internal endpoint a teammate's earlier commit had
  added back (#43–44).

### D. Frontend restyle & Keycloak login theme — 3 prompts (2026-10-09, Claude Code)
- **Mode:** generate (#48, #56), debug (#57).
- **Scenario:** I gave Claude a UI mock-up as a Claude artifact link (#48). Claude rebuilt the
  app's pages in that style, then restyled the Keycloak login page (#56) and fixed the realm not
  picking up the theme (#57). Commits `1fcc93b`, `3abacd2`.

### E. N3 observability: CloudWatch dashboard & DLQ alarm — 3 prompts (2026-11-04 → 11-06, Claude Code)
- **Mode:** generate (#75, Terraform), explain (#76–77).
- **Scenario:** Claude wrote the DLQ log metric filter, the alarm and the CloudWatch dashboard (#75),
  commit `67bf89c` (PR #36), then explained what the dashboard shows (#76–77).

### F. Bug checks on the deployed system — 4 prompts (2026-11-09 → 11-10, Claude Code)
- **Mode:** debug.
- **Scenario:** Running the typecheck and test suites (#78), explaining a `psql` `sslmode` error
  from the ECS admin task (#79–80), and reviewing the code for logic bugs (#81). No code changes.

### G. How the system works (Q&A) — 14 prompts (2026-10-13 → 10-27, Claude Code)
- **Mode:** explain.
- **Scenario:** Questions about the existing code: the database and primary key, the order state
  transitions, what happens when two couriers accept at once, which calls are sync and which are
  async, how order creation waits for Credit Service, late deliveries, and how the frontend is
  rendered (#60–70, #72–74). In #69 Claude explained that it had moved credit reservation to
  events against my first brief.

### H. Architecture diagram check — 2 prompts (2026-11-10, Claude Code)
- **Mode:** explain.
- **Scenario:** Asking whether an existing architecture diagram matched the code, and how
  authentication works (#82–83).

## Chronological prompt index

| # | Timestamp (UTC) | Seam | Mode | Prompt (abbreviated) | Files changed |
|---|---|---|---|---|---|
| 1 | 2026-10-08 03:03 | A | generate | [pasted: # Order Service brief (rewritten against `packages/shared-ev…] | 9: order-service/migrations, order-service/package.json, order-service/src, order-service/… |
| 2 | 2026-10-08 03:09 | A | debug | how to test the sql | — |
| 3 | 2026-10-08 03:10 | A | debug | its open, can u run the steps for me | — |
| 4 | 2026-10-08 03:15 | A | explain | whats the purpose of the transition doc | — |
| 5 | 2026-10-08 03:16 | A | explain | wait so its just a text file that has no back end job? | — |
| 6 | 2026-10-08 03:17 | A | refactor | can u remove the doc | 1: order-service/src |
| 7 | 2026-10-08 03:18 | A | generate | oh actly add it back in and run the script to show me how it looks like | 1: order-service/src |
| 8 | 2026-10-08 03:19 | A | explain | ok so youve added the schema plus these docs thats all right | — |
| 9 | 2026-10-08 03:20 | A | generate | continue part 2 | 18: order-service/src, order-service/test |
| 10 | 2026-10-08 03:27 | A | explain | whats the point of the health.ts, as well as the clients file | — |
| 11 | 2026-10-08 03:28 | A | explain | how does the other services implement the http | — |
| 12 | 2026-10-08 03:32 | A | generate | can u change the clinets/ thing to rabbit mq events instead | 11: order-service/mocks, order-service/src, order-service/test |
| 13 | 2026-10-08 03:43 | A | generate, refactor | yes can u remove the headers and start stage 3 | 5: order-service/migrations, order-service/src, order-service/test |
| 14 | 2026-10-08 03:49 | A | explain | can u explain all changes in part 2 and 3 | — |
| 15 | 2026-10-08 03:55 | A | generate | ok continue with part 4 | 4: order-service/src, order-service/test |
| 16 | 2026-10-08 03:58 | A | generate | start stage 6 | 1: order-service/test |
| 17 | 2026-10-08 04:05 | A | generate | start stage 5 sorry | 9: order-service/migrations, order-service/src, order-service/test |
| 18 | 2026-10-08 04:11 | A | generate | yes implement that | 5: order-service/src |
| 19 | 2026-10-08 04:22 | A | generate | continue with stage 6 | 1: order-service/mocks |
| 20 | 2026-10-08 04:31 | A | generate | ok stage 7 | 13: order-service/.env.example, order-service/AGENTS.md, order-service/Dockerfile, order-se… |
| 21 | 2026-10-08 04:55 | A | explain | can u summarise the changes for me | — |
| 22 | 2026-10-08 04:58 | B | generate | can u edit the snippets into the various files for me, deleting the ones in order-service | 17: .env.example, compose.yaml, credit-service/Dockerfile, frontend/nginx.conf, local_setup… |
| 23 | 2026-10-08 05:08 | B | debug | ok currently theres a mock credit in my order service right, to test independently | — |
| 24 | 2026-10-08 05:12 | B | debug | [pasted: # Build stage FROM node:22-alpine AS builder WORKDIR /app <<…] | — |
| 25 | 2026-10-08 05:25 | B | explain | tests use a fake supplier client. wdym it uses fake supplier client | — |
| 26 | 2026-10-08 10:00 | B | explain | Gab, [8 Oct 2026 at 6:00:30 PM]: They communicate via network ports in the computer is this true | — |
| 27 | 2026-10-08 10:01 | B | explain | so the docker file is the path essentially? | — |
| 28 | 2026-10-08 10:02 | B | explain | oh wait so why do i need the copy line in the docker file | — |
| 29 | 2026-10-08 10:03 | B | explain | so each one runs its own docker correct? | — |
| 30 | 2026-10-08 10:03 | B | explain | e docker file tells ur service what shared events are there from other services | — |
| 31 | 2026-10-08 10:11 | B | explain | how does current order service get info from supplier | — |
| 32 | 2026-10-08 10:12 | B | explain | can it work w supplier service right now? or do they need to implmenet something | — |
| 33 | 2026-10-08 10:13 | B | explain | is this synchronous or asynchronous communication | — |
| 34 | 2026-10-08 10:19 | B | explain | COPY package*.json ./ what does this line do, does it copy my order service package | — |
| 35 | 2026-10-08 10:20 | B | explain | wait so what exactly does that line mean | — |
| 36 | 2026-10-08 10:20 | B | explain | how to make it take all from the whole repo | — |
| 37 | 2026-10-09 11:57 | C | debug | can u help me check if all the communication and events between credit service and order service align and … | — |
| 38 | 2026-10-09 12:01 | C | debug | is there any potential issues with the implementation of order service | — |
| 39 | 2026-10-09 12:02 | C | explain | is order rejected adn order cancelled teh same | — |
| 40 | 2026-10-09 12:03 | C | explain | what is rejected | — |
| 41 | 2026-10-09 12:03 | B | debug | check supplier service docker file now, does it work correctly | 1: supplier-service/Dockerfile |
| 42 | 2026-10-09 12:07 | C | explain | can u list all events that order service is involved in | — |
| 43 | 2026-10-09 12:08 | C | debug | isnt the internal endpoint added back in one of the previous commits | — |
| 44 | 2026-10-09 12:09 | C | debug | yes fix it for me | 1: order-service/src |
| 45 | 2026-10-09 12:11 | B | debug | wait so currently does the dockerfile on supplier service work for me? if not can u fix it for me | — |
| 46 | 2026-10-09 12:12 | B | debug | why is all the copy lines deleted | — |
| 47 | 2026-10-09 12:13 | B | debug | wait so will my order service work now with this version of supplier service | — |
| 48 | 2026-10-09 12:46 | D | generate | https://claude.ai/artifact/046b374c-4f49-4974-935c-cb2a6f3b4861 | 12: frontend/index.html, frontend/src |
| 49 | 2026-10-09 12:58 | B | debug | whats the erorr cant build | — |
| 50 | 2026-10-09 12:59 | B | debug | [pasted: ansferring context: 218.55kB 0.0s => CACHED [frontend build …] | — |
| 51 | 2026-10-09 13:01 | B | debug | [pasted: 0.0s => [user-service internal] load build definition from D…] | — |
| 52 | 2026-10-09 13:02 | B | debug | wait so whats wrong with the supplier service | — |
| 53 | 2026-10-09 13:03 | B | refactor | ok take out supplier | 7: credit-service/Dockerfile, frontend/Dockerfile, local_setup.txt, order-service/Dockerfi… |
| 54 | 2026-10-09 13:06 | B | debug | [pasted: exporting manifest list sha256:88f638d663e42ef81b3c799c57ea0…] | — |
| 55 | 2026-10-09 13:06 | B | debug | can u remove it form e | — |
| 56 | 2026-10-09 13:10 | D | generate | currently the log in page is wrong, its still the old ui, can u design in the new design | 1: infra/keycloak |
| 57 | 2026-10-09 13:16 | D | debug | the realm doesnt update | — |
| 58 | 2026-10-09 13:25 | B | explain | does user share internal libraries | — |
| 59 | 2026-10-09 16:15 | B | debug | why does the build only run on my local but when other people on my team try it doesnt work | — |
| 60 | 2026-10-13 02:03 | G | explain | what database r we using | — |
| 61 | 2026-10-13 02:07 | G | explain | whats the primary key for the database | — |
| 62 | 2026-10-13 02:09 | G | explain | state tranasitions | — |
| 63 | 2026-10-13 02:10 | G | explain | if 2 people accept at the samae time | — |
| 64 | 2026-10-13 02:11 | G | explain | which part is asynchronous | — |
| 65 | 2026-10-13 02:13 | G | explain | asynchrounous communication | — |
| 66 | 2026-10-13 02:15 | G | explain | which part of this project is asynchronous communication vs synchrnous | — |
| 67 | 2026-10-13 02:17 | G | explain | i thought our credit reservationw was synchrnous | — |
| 68 | 2026-10-13 02:19 | G | explain | ok looking at it now, what is synchrnous vs asynchronous in this project | — |
| 69 | 2026-10-14 07:09 | G | explain | if my original was synchrnous why isit asynch right now | — |
| 70 | 2026-10-14 07:17 | G | explain | so right if i place an order, how does waiting for credit service work, can i continue placing the order | — |
| 71 | 2026-10-14 07:36 | B | debug | can u see all 4 docker files in the services and is the design inconsistent | — |
| 72 | 2026-10-19 06:43 | G | explain | do we have a system on what happens if the courier take damn long to like deliver ur shit | — |
| 73 | 2026-10-27 09:24 | G | explain | what r we using for the frontend currently | — |
| 74 | 2026-10-27 09:25 | G | explain | server side vs cliend side | — |
| 75 | 2026-11-04 11:32 | E | generate | yes can u write the dlq metric filter and the rest of the dashboard for me | 3: infra/terraform |
| 76 | 2026-11-04 12:18 | E | explain | so what shows on the dashbaord | — |
| 77 | 2026-11-06 04:57 | E | explain | can u explain everything shown in the dashboard | — |
| 78 | 2026-11-09 09:11 | F | debug | can u test for bugs | — |
| 79 | 2026-11-09 11:47 | F | debug | 2026-11-09T11:47:35.019000+00:00 admin/admin/4d51e6d99b0444669a8f9969d33c60d5 psql: error: invalid sslmode … | — |
| 80 | 2026-11-09 11:48 | F | debug | 2026-11-09T11:47:35.019000+00:00 admin/admin/4d51e6d99b0444669a8f9969d33c60d5 psql: error: invalid sslmode … | — |
| 81 | 2026-11-10 11:17 | F | debug | can u run thru the code and see if any possible logic bugs | — |
| 82 | 2026-11-10 13:07 | H | explain | is this diagram accurate | — |
| 83 | 2026-11-10 13:10 | H | explain | isit not token based | — |
