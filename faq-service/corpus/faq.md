# Friend on Campus (FoC) — FAQ corpus (DRAFT for human review)

<!-- One chunk per `## ` heading. These pairs are the retrieval test fixture: every question a
     student asks should be answerable by at least one chunk below. Constraints must match the
     product (see README.md, local_setup.txt, order-service/docs/state-transitions.md). -->

## What is Friend on Campus?

Friend on Campus (FoC) is a platform where NUS students run errands for each other. You post an
errand — like grabbing a coffee, printing a document or delivering a parcel — and another student
who is already walking that way picks it up. Payment is in credits, not cash.

## What are credits and how do I get them?

Credits are the platform's internal payment. Every new student receives a starting allowance of
credits when they join. You earn more credits by running errands for other students. Credits stay
inside the platform: they can't be traded outside it.

## Can I buy credits with real money?

No. FoC runs on a closed credit economy. Credits cannot be bought, topped up or sold for money.
The only way to gain credits is to complete errands for other students.

## Can I cash out my credits or send them to someone off the platform?

No. Credits circulate on campus only. They can't be cashed out, transferred to a bank account or
sent to anyone outside the platform. The credit ledger only records movements between FoC users
tied to errands.

## Can I transfer credits directly to another student?

No. Credits only move when they are tied to an errand: they are reserved when a request is placed
and released to the runner when the errand is completed. There is no free-form credit transfer
between accounts.

## Why do I need a @u.nus.edu email to sign up?

FoC is only for NUS students, so registration checks that your email ends with @u.nus.edu. The
check runs on the server when you register — a matching email alone is not enough, you also need
to verify it.

## How do I verify my email after signing up?

After registering, we send a verification link to your email address. Open the link to activate
your account.

## I didn't receive my verification email. What do I do?

Check your spam folder first. If the link has expired, request a new verification email from the
login page.

## I forgot my password. How do I reset it?

Use the "forgot password" link on the login page. We send a reset link to your registered email.
Reset links expire after a short time, so use them soon after they arrive.

## My account was suspended. What does that mean and what can I do?

Suspension is an admin action that blocks all account activity. Once suspended, every action you
try returns an "account suspended" response within a few seconds. Only an admin can lift a
suspension — contact support using the link in the FAQ panel if you believe it was a mistake.

## What is an errand?

An errand is a task one student (the requester) wants done and another student (the runner)
carries out. Typical errands are buying a drink, printing a file or passing on a parcel. Every
errand has a credit cost that the requester's wallet holds while the errand is open.

## How do credits move when I request an errand?

When you place a request, the credit cost is reserved — held from your available balance but not
yet given to anyone. When the errand is completed and you confirm it, the reserved credits are
released to the runner. If the errand is cancelled, expires or is rejected, the credits are
returned to you.

## What are the stages of an errand?

An errand moves through these stages:

- PENDING — created, waiting for the credit hold
- OPEN — visible on the board for runners
- ACCEPTED — a runner took it
- COLLECTED — the runner has the item
- DELIVERED — the runner handed it over
- COMPLETED — the requester confirmed, credits released to the runner

It can also end early: CANCELLED (the requester cancelled while it was open), EXPIRED (no runner
accepted in time) or REJECTED (the credit hold failed).

## What does "held for open errands" on my wallet mean?

Your wallet shows three numbers: available (ready to spend), reserved (held for errands that are
still open) and total (both together). Reserved credits belong to open errands and can't be spent
on anything else. They either go to the runner on completion or come back to you if the errand
ends without completion.

## Why can't I accept an errand I posted?

The requester can never accept their own errand — only another logged-in student can. This keeps
the credit flow meaningful: you can't pay yourself.

## How long do I have to accept an open errand?

Open errands expire. If no runner accepts before the deadline shown on the errand, it moves to
EXPIRED and the reserved credits return to the requester automatically. You don't need to do
anything to get your credits back.

## Do I need to confirm when my errand is delivered?

The runner marks the errand delivered; then you confirm to complete it and release the credits. If
you don't confirm, the system auto-confirms after a grace period, so a runner is never stuck
waiting forever on an unresponsive requester.

## What is the Supplier Directory?

The Supplier Directory lists campus stalls and shops, with filters for what they offer, where they
are and whether they are open right now. It exists so errands reference real places — and so you
can check if a stall is open before asking someone to walk there.

## How do I find a stall in the Supplier Directory?

The directory has a search box (matches stall name or location) plus filters for facility type and
building, and you can sort the results. Each entry shows whether the stall is open right now, so
you can check before asking someone to walk there.

## How do I earn credits?

Open the errand board — it lists open errands from other students, live. Accept one that is on
your way, collect the item, deliver it, and the credits are released to you when the requester
confirms. Your own errands never appear on the board to you.

## Where can I see the errands I am involved in?

"My errands" shows everything you requested and everything you are running, grouped by current
stage. The errand board shows everyone else's open errands.

## How do I place an errand request?

Use "Request an errand", describe what you need collected and where, and confirm the credit cost.
The cost is held from your wallet while the request waits for a runner.

## Where can I see my credit history?

The credits page shows your wallet and every credit movement tied to your account. Credits are
never bought, sold or withdrawn, so the total in circulation only ever moves between students.

## What happens if the stall is closed when I try to place an errand?

FoC checks the stall's status at the moment you place the request. If the stall is closed right
now, the request is refused and you are asked to try again during its opening hours. Check the
open-now badge in the Supplier Directory before you post, so you don't get refused.

## The stall's opening hours are wrong. What do I do?

The Supplier Directory is managed by admins. If a stall's details or hours are out of date,
contact support and an admin will update it.

## What happens if my runner accepts but never delivers?

Once a runner accepts, the errand waits on them — there is no automatic timeout after acceptance.
The runner can withdraw, which puts the errand back on the board for someone else to accept. If
your runner stays unresponsive, contact support: an admin can look into the account.

## How do I report a runner?

There is no in-app report button yet. Contact support using the link in the FAQ panel and
describe what happened — admins can suspend accounts that break the rules.

## Who are admins and how do I become one?

Admins are students appointed to manage the platform: they manage users, suspensions and the
supplier directory. The first admins are created automatically at first startup. Further admins
are added only when two existing admins agree — one requests the role change, a different one
confirms it.
