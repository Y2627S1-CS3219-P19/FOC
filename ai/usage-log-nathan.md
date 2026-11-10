# AI Usage Log — FoC (credit service owner: ludannnn)

Period covered: 2026-09-25 → 2026-11-08 (UTC)
Scope: prompts I sent to an AI coding tool about work in this submission — 111 prompts across 16 Claude Code sessions.

Each prompt has a **mode** (generate / refactor / debug / explain), as the course policy asks.

## Note:
- Claude Code is the only AI coding tool used for this project.
- Claude Code deletes full transcripts after 30 days. Two of those prompts were pasted text that the history doesn't keep (`[Pasted text #1 …]`).

## Tools used

| Tool | Models | Sessions | Prompts |
|---|---|---|---|
| Claude Code (CLI) | `claude-opus-5-5` (10 Oct, 2–8 Nov); `claude-opus-4-6` (12–19 Oct) | 16 | 111 |

Modes: explain 82 · generate 14 · debug 11 · refactor 4. 19 prompts led to a code or file change.

## Decision provenance (where Claude's suggestions shaped code)

- **Event handler split (8 Oct):** I proposed splitting handlers into files like the routes and asked whether to. Done (`7eca350`).
- **order.rejected and retry/DLQ (10 Oct):** Claude flagged the reserved-credit leak in the D3 gap check. I designed the fix myself (listen for `order.rejected`; delayed retry then dead-letter after 5 attempts) and asked for a plan first (`ecf6783`).
- **Admin dashboard gaps (2 Nov):** Claude listed the gaps. I chose which two to build and the design (reason column, admin orders endpoint).
- **Keycloak drift (4 Nov):** Claude suggested reconciling with Keycloak and soft-deleting users. I rejected both and chose to bootstrap two admins.

## Usage summary by seam

### 1. Local setup and Docker — 11 prompts (2026-09-25 → 2026-11-04, Claude Code) †
- Mode: explain 6, debug 5
- Code/file changes: 0
- Scenario: Running the stack locally and fixing Docker/Keycloak start-up failures.

### 2. Credit service backend — 38 prompts (2026-10-01 → 2026-10-19, Claude Code) †
- Mode: explain 25, generate 9, refactor 2, debug 2
- Code/file changes: 10
- Scenario: Scaffolding the credit service, learning its files, handlers, pagination, tests, admin endpoints, events, OpenAPI, retry/DLQ, and the stuck-credits bug trace.

### 3. Milestone documents and presentation — 3 prompts (2026-10-08 → 2026-10-10, Claude Code) †
- Mode: explain 3
- Code/file changes: 0
- Scenario: Answering milestone questions about the credit service, and the order.rejected credit-leak gap found while preparing D3.

### 4. Gateway and routing — 9 prompts (2026-10-09 → 2026-10-12, Claude Code) †
- Mode: explain 7, debug 1, refactor 1
- Code/file changes: 2
- Scenario: How endpoints are exposed, the Vite vs nginx mismatch, and locking the credit-service port.

### 5. Admin dashboard UI — 13 prompts (2026-10-12 → 2026-11-08, Claude Code)
- Mode: explain 8, generate 4, debug 1
- Code/file changes: 5
- Scenario: Admin credits page, adjustment reason, admin orders and audit pages, and admin section navigation.

### 6. Architecture and concepts — 23 prompts (2026-10-13 → 2026-10-19, Claude Code)
- Mode: explain 23
- Code/file changes: 0
- Scenario: Sync vs async, gateway vs broker, scaling, ECS/EKS, CI/CD, SQL locking and the outbox.

### 7. Repo maintenance and CI — 3 prompts (2026-11-02 → 2026-11-05, Claude Code)
- Mode: debug 2, explain 1
- Code/file changes: 0
- Scenario: Reviewing PR #27 and diagnosing CI not running.

### 8. User service — 7 prompts (2026-11-04 → 2026-11-04, Claude Code)
- Mode: explain 5, refactor 1, generate 1
- Code/file changes: 2
- Scenario: Me-tab cleanup, Keycloak/user DB drift, and bootstrapping two admins.

### 9. AWS deployment — 4 prompts (2026-11-04 → 2026-11-04, Claude Code)
- Mode: explain 4
- Code/file changes: 0
- Scenario: Setting the second admin's secrets in AWS SSM and who runs Terraform.

## Chronological prompt index

| # | Timestamp (UTC) | Mode | Seam | Prompt (abbreviated) | Outcome / evidence |
|---|---|---|---|---|---|
| 1 | 2026-09-25 12:27 † | explain | Local setup and Docker | how do i run this | — |
| 2 | 2026-09-25 12:28 † | explain | Local setup and Docker | what if i want to just run one service like the user service | — |
| 3 | 2026-09-25 13:45 † | explain | Local setup and Docker | i need you to explain this codebase to me, in particular give me a general overview of what has been implement… | — |
| 4 | 2026-09-25 14:25 † | explain | Local setup and Docker | so basically all the stuff in the .env file is made up and a temporary db hosted locally? | — |
| 5 | 2026-09-25 14:26 † | explain | Local setup and Docker | but this is temporary right? once we get everything up we will compose the containers together and have their… | — |
| 6 | 2026-09-25 14:41 † | debug | Local setup and Docker | wait why cant i access the app on the access points on the browser, i got: dependency failed to start: contain… | — |
| 7 | 2026-09-25 14:43 † | explain | Local setup and Docker | the -d deletes my current containers and rebuilds? if not do i need to delete the one that already failed buil… | — |
| 8 | 2026-10-01 14:33 † | generate | Credit service backend | i am in charge of the credit service, i want to start with some initial scaffolding, before i begin, follow my pl… | **✎** commit e600b1c |
| 9 | 2026-10-01 14:59 † | explain | Credit service backend | [Pasted text #1 +111 lines] | — |
| 10 | 2026-10-01 15:00 † | generate | Credit service backend | write me a plan first | **✎** commit e600b1c |
| 11 | 2026-10-01 15:37 † | explain | Credit service backend | what would be my next step then? | — |
| 12 | 2026-10-02 11:52 † | explain | Credit service backend | now i want to make sure i understand the files in the credit service first, to being, can i verify that all th… | — |
| 13 | 2026-10-02 11:57 † | explain | Credit service backend | then app.ts is our entry point where we also define which called go to which routers depending on what path is… | — |
| 14 | 2026-10-02 14:51 † | explain | Credit service backend | ok, now lets go through the flow like which files do what purpose for these two occurences 1) user presses the… | — |
| 15 | 2026-10-02 14:58 † | explain | Credit service backend | so index.ts uses app.ts for http requests and consumer.ts for rabbitMQ events respectively? | — |
| 16 | 2026-10-02 15:01 † | explain | Credit service backend | ok, then is it advisable to encapsulate event logics into their own files like how we did for routes? no codin… | — |
| 17 | 2026-10-08 12:57 † | refactor | Credit service backend | before pagination, should we split the events into their respective groups and group them into their own file?… | **✎** commit 7eca350 |
| 18 | 2026-10-08 13:02 † | explain | Credit service backend | before we begin pagination, can you explain to me what it is for and how it will be implemented | — |
| 19 | 2026-10-08 13:04 † | generate | Credit service backend | ok | **✎** commit 0051d43 |
| 20 | 2026-10-08 13:05 † | explain | Credit service backend | what would be the most logical thing to tackle next? | — |
| 21 | 2026-10-08 13:07 † | generate | Credit service backend | lets do it, draft me a plan of what tests to write and what they test for first | **✎** commit 7cc73ed |
| 22 | 2026-10-08 13:19 † | explain | Credit service backend | do we need an env file for the credit service db within the credit-service folder? | — |
| 23 | 2026-10-08 13:21 † | explain | Credit service backend | ok, after tests whats next | — |
| 24 | 2026-10-08 13:22 † | explain | Credit service backend | lets do it, explain to me how you would implement it first | — |
| 25 | 2026-10-08 13:23 † | generate | Credit service backend | yes | **✎** commit 5d07c7f |
| 26 | 2026-10-08 13:29 † | explain | Credit service backend | ok, logically whats the next step | — |
| 27 | 2026-10-08 13:31 † | explain | Credit service backend | ok i did it alr, my friends will review and merge the pr for all the work we have done, after this i assume th… | — |
| 28 | 2026-10-08 13:39 † | explain | Credit service backend | whats the easiest way to test inter-service communication for now before i implemented the front end? | — |
| 29 | 2026-10-08 13:41 † | explain | Credit service backend | ok, for now while waiting for my teammates to merge my pr, generate me a summary of everything we have done, w… | — |
| 30 | 2026-10-08 13:53 † | explain | Credit service backend | for the broker, what have we implemented? or routing for that isnt done yet | — |
| 31 | 2026-10-08 14:03 † | explain | Milestone documents and presentation | based on what we have done, can you help me answer these questions? [Pasted text #1 +42 lines] if we havent im… | — |
| 32 | 2026-10-08 14:22 † | explain | Credit service backend | then how does this handle the rollback in the event that we want to restore previous rows | — |
| 33 | 2026-10-08 14:38 † | explain | Credit service backend | would the order created event be published after a runner accepts the request? im not sure how the order creat… | — |
| 34 | 2026-10-09 11:50 † | explain | Credit service backend | i just merged the things my friend implemented from order service, can you help me see if there are sny cntrsc… | — |
| 35 | 2026-10-09 11:59 † | explain | Credit service backend | was our internal endpoint meant for the order service to use? i vageuly remember inter service to be events on… | — |
| 36 | 2026-10-09 12:03 † | explain | Credit service backend | what is the difference for my handleOrderWithdrawn and handleOrderCancelled? | — |
| 37 | 2026-10-09 12:07 † | explain | Credit service backend | what events does my credit service publish and what events does credit service wait for | — |
| 38 | 2026-10-09 12:26 † | generate | Credit service backend | ok lets implement the CreditReservationFailed event, it should be a pretty simple change i assume? just match… | **✎** commit c920c98 |
| 39 | 2026-10-09 12:40 † | generate | Credit service backend | can you first add the next tasks to memory in the .claude file first? | ~/.claude memory |
| 40 | 2026-10-09 16:36 † | debug | Local setup and Docker | why does my keycloak always fail when i try and do docker compose up, here is a snippet of the docker error me… | — |
| 41 | 2026-10-09 16:39 † | debug | Local setup and Docker | i did that and still got this: [Pasted text #2 +64 lines] should i just delete this container instance and reb… | — |
| 42 | 2026-10-09 16:40 † | debug | Local setup and Docker | does running docker compose up -build solve the issue? | — |
| 43 | 2026-10-09 17:08 † | explain | Gateway and routing | now that the frontend is already done, can you explain to me how the endpoints are exposed to the user? i dont… | — |
| 44 | 2026-10-09 17:13 † | explain | Gateway and routing | so should we set up a proper api gateway service? | — |
| 45 | 2026-10-10 04:06 † | explain | Credit service backend | for the credit service, what are the logical next steps | — |
| 46 | 2026-10-10 04:24 † | explain | Gateway and routing | can you explain to me what is vite and nginx | — |
| 47 | 2026-10-10 04:26 † | explain | Gateway and routing | so whats the mismatch that you talked about? in dev environment it works a certain way and in prod another? | — |
| 48 | 2026-10-10 04:31 † | explain | Gateway and routing | so right now the vite.config routes /v1/admin calls to the user-service but we also have a /v1/admin/credits w… | — |
| 49 | 2026-10-10 04:32 † | explain | Gateway and routing | where is this vite.config file and where can i see this implementation? i want to look at vite and nginx files… | — |
| 50 | 2026-10-10 04:34 † | explain | Gateway and routing | are there any other mismatches for other services between vite and nginx? the point now is just to make vite.c… | — |
| 51 | 2026-10-10 04:36 † | debug | Gateway and routing | yes, help me resolve the vite.config nginx mismatch, should be a pretty simple 2 line fix | **✎** commit c2a6042 |
| 52 | 2026-10-10 04:39 † | refactor | Credit service backend | ok, now can you help me fix the open api spec? first go throught the file and make sure whatever is specified… | **✎** commit 6a1e43d |
| 53 | 2026-10-10 04:48 † | explain | Credit service backend | this openapi.yaml file just specifies what we alr implemented right? functionally it doesnt do anything new, w… | — |
| 54 | 2026-10-10 05:50 | explain | Milestone documents and presentation | is this credit service or order service? im pretty sure credit service listens for orderwithdrawn/expired/canc… | — |
| 55 | 2026-10-10 05:55 | explain | Milestone documents and presentation | my friend doing the order service says that orderRejected is a guardrail for the orderService in the event tha… | — |
| 56 | 2026-10-10 06:33 † | generate | Credit service backend | i need to implement two changes, 1. order service releases an orderRjectedEvent, in the case that it does not… | **✎** commit ecf6783 |
| 57 | 2026-10-10 06:43 † | generate | Credit service backend | write me a plan first | **✎** commit ecf6783 |
| 58 | 2026-10-12 12:58 | generate | Admin dashboard UI | https://claude.ai/code/artifact/8ebdb497-f33e-482a-9677-f36f9a874a58 following this ui mockup, can you help me… | **✎** frontend/src/pages/AdminCredits.tsx, App.tsx |
| 59 | 2026-10-12 13:10 | explain | Admin dashboard UI | where can i access the new screen | — |
| 60 | 2026-10-12 13:10 | debug | Admin dashboard UI | i cant change anyones credits tho | **✎** AdminCredits.tsx |
| 61 | 2026-10-12 13:12 | explain | Admin dashboard UI | do i need to referesh local host? or do i need to docker compose down first | — |
| 62 | 2026-10-12 13:17 | explain | Admin dashboard UI | ok nice, any other endpoints that are supposed to be callable by users/admins that are not yet exposed? | — |
| 63 | 2026-10-12 13:17 | generate | Admin dashboard UI | yes please | **✎** AdminCredits.tsx |
| 64 | 2026-10-12 13:20 | explain | Admin dashboard UI | whats the command to rebuild if im running from docker? | — |
| 65 | 2026-10-12 13:25 | explain | Admin dashboard UI | so a summary of what we did is that we exposed the endpoint in the admin dashboard to allow for credit adjustm… | — |
| 66 | 2026-10-12 13:32 | explain | Admin dashboard UI | now that the admin frontend is done, whats next? | — |
| 67 | 2026-10-12 13:52 | refactor | Gateway and routing | ok, help me implement 1 and 4 | **✎** compose.yaml |
| 68 | 2026-10-13 02:12 | explain | Architecture and concepts | which workflow is asynchronous | — |
| 69 | 2026-10-14 04:17 | explain | Architecture and concepts | my team is preparing to deploy this app on the cloud, we are first planning CI/CD pipelines etc, my friend sug… | — |
| 70 | 2026-10-14 04:24 | explain | Architecture and concepts | how would this usually be implemented? no need to implement anything for now, im just trying to understand the… | — |
| 71 | 2026-10-14 04:25 | explain | Architecture and concepts | everytime i change code i have a new docker image? no right? i thought its only if we change the docker files.… | — |
| 72 | 2026-10-14 04:34 | explain | Architecture and concepts | how much work do you think is required? does it scale with project size and if we do it is it worth for such a… | — |
| 73 | 2026-10-14 04:37 | explain | Architecture and concepts | does aws support mcp for features that require an agent ? | — |
| 74 | 2026-10-14 07:08 | explain | Architecture and concepts | are order service and credit service data flows async or sync and should it be async or sync | — |
| 75 | 2026-10-14 07:15 | explain | Architecture and concepts | isnt it synchronous if order service has to wait for a reserved/ reserve failed | — |
| 76 | 2026-10-14 07:18 | explain | Architecture and concepts | what if a user places an order but credit service takes 20 seconds to send back a credits reserved, is that ok… | — |
| 77 | 2026-10-14 07:31 | explain | Architecture and concepts | so is our architecture now alright? do you have any suggestions if anything is wrong | — |
| 78 | 2026-10-14 07:40 | explain | Architecture and concepts | is there a difference between the api gateway and teh message broker in terms of function? how should the supp… | — |
| 79 | 2026-10-14 07:42 | explain | Architecture and concepts | if order service waits for an ack from suppleir service but they communicate throught the broker doesnt that m… | — |
| 80 | 2026-10-14 07:43 | explain | Architecture and concepts | wait so how is supplier service talking to order service now? | — |
| 81 | 2026-10-14 07:45 | explain | Architecture and concepts | how do we handle scaling for inter service communication if we communicate over HTTP requests vs a broker, par… | — |
| 82 | 2026-10-14 07:50 | explain | Architecture and concepts | i remember reading something about a docker compose up equivalent for cloud deployment and containers, is eks | — |
| 83 | 2026-10-14 07:52 | explain | Architecture and concepts | but i want to learn eks, is it alot harder to use eks to orchestrate containers | — |
| 84 | 2026-10-14 08:04 | explain | Architecture and concepts | is everythign in credit service dockerfile needed? | — |
| 85 | 2026-10-19 06:54 | debug | Credit service backend | there is currently a bug, where if: a normal user makes an order and an admin user completed the order, the cr… | — |
| 86 | 2026-10-19 06:57 | debug | Credit service backend | wait but the requestor is the normal user not the admin. the admin is the courier | — |
| 87 | 2026-10-19 10:52 | explain | Architecture and concepts | what is (alpine) for postgresql | — |
| 88 | 2026-10-19 10:56 | explain | Architecture and concepts | select ... for operations in sql are guranteed to be atomic? | — |
| 89 | 2026-10-19 10:58 | explain | Architecture and concepts | where is the BEGIN/COMMIT and how does the full update line look like? | — |
| 90 | 2026-10-19 11:00 | explain | Architecture and concepts | can you explain to me what the outbox does again and where it lives in the db? i know its a table in itself ri… | — |
| 91 | 2026-10-19 11:03 | explain | Architecture and concepts | ah so its like an intermediary store to make sure what we do and the events we publish mathc? we never ever pu… | — |
| 92 | 2026-10-19 11:05 | explain | Architecture and concepts | Management UI on port 15672, built-in dead-letter queues, mature amqplib support. Kafka targets high-throughpu… | — |
| 93 | 2026-11-02 10:25 | explain | Repo maintenance and CI | can you help me to check the commits and explain to me what has been updated by pr #27? | — |
| 94 | 2026-11-02 11:12 | explain | Admin dashboard UI | im in charge of the admin dashboard, can you dive deeper into what has been implemented for the admin dashboar… | — |
| 95 | 2026-11-02 11:37 | generate | Admin dashboard UI | lets first implement 1 and 2. first, write me a plan stating what we have now, what we want to end up with and… | **✎** branch feat/admin-dashboard |
| 96 | 2026-11-04 14:51 | debug | Local setup and Docker | can you help me check the merge history and identify why are my containers suddenly not working after i run do… | docker only |
| 97 | 2026-11-04 15:05 | refactor | User service | can you help me to remove the line in the front end under the 'me' tab that says Username, email and role cann… | **✎** Profile.tsx, frontend/src/config.ts |
| 98 | 2026-11-04 15:15 | explain | User service | right now the keycloak db and my own user db will have a divergence depending on what workflow we do. our RBAC… | — |
| 99 | 2026-11-04 15:19 | explain | User service | so on startup we make 2 admins? | — |
| 100 | 2026-11-04 15:22 | explain | User service | can you elaborate more on the soft delete | — |
| 101 | 2026-11-04 15:43 | generate | User service | ok, i think we wont implement the soft delete for now, i told my group the easiest way to do this is bootstrap… | **✎** user-service/src/bootstrap.ts, config.ts, .env.example |
| 102 | 2026-11-04 15:46 | explain | User service | wait so where do i set the emails and pw for the default admins? | — |
| 103 | 2026-11-04 15:50 | explain | User service | did you change env.example too? | — |
| 104 | 2026-11-04 15:50 | explain | AWS deployment | wait can you walk me through how to do this for AWS too? ive settled the local ones already | — |
| 105 | 2026-11-04 15:53 | explain | AWS deployment | where is the aws cli can i run it on my laptop or must i log in to the aws console terminal | — |
| 106 | 2026-11-04 15:59 | explain | AWS deployment | i am in CloudShell, what do i do now? | — |
| 107 | 2026-11-04 16:53 | explain | AWS deployment | how do i run terraform apply | — |
| 108 | 2026-11-05 13:27 | debug | Repo maintenance and CI | can you help me check why the ci checks for pr #40 are not running? dont make any code changes, just try to di… | — |
| 109 | 2026-11-05 13:32 | debug | Repo maintenance and CI | my teammate alr closed and opened and pushed an empty commit but its still blocked, not sure why his pr does n… | — |
| 110 | 2026-11-08 07:59 | explain | Admin dashboard UI | for the admin dashboard, there are currently 5 tabs at the top of the main page, where each page brings the ad… | — |
| 111 | 2026-11-08 08:01 | generate | Admin dashboard UI | yes | **✎** App.tsx, styles.css; PR #47 |
