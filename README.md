# app-air-crew

**An airline crew-management app that records the inputs to safety decisions and
makes none of them.** Twenty files extracted verbatim from `etzhayyim/root` on
2026-07-20, carrying three separate implementations. **Only one of the three is
in the deployed bundle**, and every hostname any of them talks to is
**NXDOMAIN**.

The code is not broken. The tests pass and they genuinely discriminate — five
deliberate mutations, including one that defeats the end-to-end read
capability, were all caught. What is missing is everything the code points at,
and — for a crew app specifically — every computed value its own process
contract asks for.

Read this file before `MIGRATION-TODO.md`, which describes a remediation plan
for a deployment that does not exist.

## What is true now

Measured 2026-08-16 against `3bb4ea9`. Every row is reproducible from
[`docs/operator-quickstart.md`](docs/operator-quickstart.md).

| What this repo asserts | What is true now |
|---|---|
| `wrangler.jsonc` serves `air-crew.etzhayyim.com/*` and `a1rcr3w0.etzhayyim.com/*` | Both are **NXDOMAIN** on 1.1.1.1, 8.8.8.8 and 9.9.9.9; `curl` returns `000`. The zone is healthy — `etzhayyim.com` apex answers `200` from Cloudflare NS — so these are missing labels, not an outage. |
| `src/app.ts` proxies to `dispatcher.etzhayyim.com` | **NXDOMAIN.** |
| `svelte/…/xrpc/[...path]/+server.ts` proxies to `mcp.etzhayyim.com` | **NXDOMAIN.** Both upstreams are gone, so no request path in this repo can complete even if it were deployed. |
| `kotodama.jsonld` declares the actor `did:web:air-crew.etzhayyim.com` | Unresolvable. `did:web` resolution requires `https://air-crew.etzhayyim.com/.well-known/did.json`; the host does not resolve. |
| `MIGRATION-TODO.md`: seed awaiting a Charter §2(a) codemod | The scan recorded in that same file found **none** of the patterns it was written to remove. The blocker was never the codemod. |
| `NOTICE`: "Charter Compliance Rider v3.1 (see `CHARTER-RIDER.md`)" | That file is **not in this repository**. It is in `etzhayyim/root`. The license terms this repo distributes under name a document it does not carry. |
| `svelte/src/routes/+page.svelte` reports `routeCount: 0`, no routes, no vars | `wrangler.jsonc` in the same repo declares **2 routes and 8 vars**. The landing page is a generator artifact that never read the config next to it, and still names its own path as `60-apps/etzhayyim-project-air-crew/…` — the location it was extracted out of. |
| `package.json` `typecheck: tsc --noEmit` | There is no `tsconfig.json` at the root and no input files. It prints the **tsc help banner and exits 1**, having checked zero files. |
| Upstream `etzhayyim/root@main:60-apps/etzhayyim-project-air-crew` | Gone. `60-apps` on `origin/main` now holds exactly one entry, `etzhayyim-project-organism`. |
| **`00-contracts/bpmn/com/etzhayyim/air-crew/`** | **Still there, all 8 processes, on upstream `main` today.** Unlike the app, the contract survived. This is the most useful thing in this document — see below. |

## Three implementations, one deployed

`wrangler.jsonc` sets `main` to `svelte/.svelte-kit/cloudflare/_worker.js`. That
is the whole deploy. Building it and searching the **entire** resulting closure
(41 files — `cloudflare/` plus `cloudflare-tmp/manifest.js` and
`output/server/**`, both of which `_worker.js` imports across directory
boundaries) finds:

| Implementation | Size | In the deployed bundle? |
|---|---|---|
| `svelte/` — SvelteKit BFF, forwards XRPC to the MCP router | 2.4 kB endpoint | **Yes.** All four probe symbols present. |
| `src/app.ts` — edge dispatcher, 8 methods, `/health` + `/_app/meta` | 76 lines | **No.** All nine probe symbols absent. |
| `kotoba/src/**` — the actual domain model (E2E-sealed crew records) | 24 functions | **No.** All six probe symbols absent. |

`kotoba/` is where the real work is — a plaintext/E2E split with pairing
templates in the clear and every per-person record (roster, qualification,
fatigue, assignment, travel, duty time, notification) sealed via
`encryptedWrite` with an owner-DID-plus-recipients read capability. It is a
library no deployed code imports.

## The contract still exists, and it maps onto `kotoba/` one-to-one

`src/app.ts` advertises a BPMN path in its `/health` payload:
`etzhayyim-root/00-contracts/bpmn/com/etzhayyim/air-crew`. **That path is live on
upstream `main`** — eight hand-written Zeebe processes, one per method. Line
them up against the registry:

| BPMN process | Zeebe job type | kotoba function | domain fields |
|---|---|---|---|
| `publishRoster` | `air.crew.roster.publish` | `recordRoster` | identical |
| `buildPairing` | `air.crew.pairing.build` | `recordPairing` | identical |
| `trackQualification` | `air.crew.qualification.track` | `recordQualification` | identical |
| `assessFatigue` | `air.crew.fatigue.assess` | `recordFatigue` | identical |
| `assignCrew` | `air.crew.crew.assign` | `recordAssignment` | identical |
| `bookCrewTravel` | `air.crew.travel.book` | `recordTravel` | identical |
| `recordDutyTime` | `air.crew.duty_time.record` | `recordDutyTime` | identical |
| `notifyCrew` | `air.crew.crew.notify` | `recordNotification` | identical |

Every one of the eight contract inputs is a field-for-field match with the
corresponding kotoba input type. **The vocabulary gap is superficial** — this is
an adapter, not a reimplementation. Three systematic differences, all of them
one-directional:

- BPMN passes **`callerDid`**; kotoba has no caller parameter anywhere. The
  registry cannot tell who is asking.
- BPMN **returns** the record id (`rosterId`, `assignmentId`, …) as a server
  output; kotoba takes it as a client-supplied argument.
- kotoba adds **`recipients`** (the E2E read capability); BPMN has no notion of
  it.

## What the contract asks for and nothing here computes

Each BPMN process also declares output variables. These are the derived values —
the judgments — and **every one of them is absent from every tracked file in
this repository**:

| Contract output | Meaning | Present anywhere in repo? |
|---|---|---|
| `ftlCompliant` | flight-time-limitation verdict on a pairing | **no** |
| `fatigueScore`, `riskLevel`, `limitBreach` | the fatigue assessment itself | **no** |
| `limitBreach`, rolling `cumulative28d`/`365d` | duty-hour limit enforcement | **no** (the fields are *stored*, never *checked*) |
| `daysToExpiry` | qualification currency | **no** |
| `travelRef`, `acknowledgedAt` | booking reference, notification receipt | **no** |
| `vertexId` | graph anchor returned by every process | **no** |
| `callerDid` | who invoked it | **no** |

`recordFatigue` accepts `fdpHours`, `restHours`, `cumulative28d` and
`cumulative365d` and writes them down. It never compares them to a limit. For a
crew-management system the regulatory half — *is this crew member legal to
fly* — is exactly the half that does not exist. **This repository is a recorder,
not an assessor**, and its own contract says it was meant to be both.

## Four method vocabularies, none of which agree

| Source | Count | Names |
|---|---|---|
| `kotodama.jsonld` `capabilities` | 3 | `publishRoster`, `buildPairing`, `trackQualification` |
| `wrangler.jsonc` `APP_CAPABILITIES` | 3 | identical to the above |
| `src/app.ts` `methods` | 8 | adds `assessFatigue`, `assignCrew`, `bookCrewTravel`, `recordDutyTime`, `notifyCrew` |
| `kotoba/src/index.ts` exports | 24 | `recordRoster`, `listRosters`, `getRoster`, … `coverage` |

The three advertised capabilities appear **only** as string literals — in
`kotodama.jsonld`, in `wrangler.jsonc`, and in the `methods` array of the
dispatcher that is not deployed. None of the three exists as a function
anywhere. `recordDutyTime` is the single name shared between the dispatcher's
list and the registry.

And the dispatcher's `methods` array is **decorative**: `src/app.ts` routes on
`nsid.startsWith("com.etzhayyim.apps.airCrew.")` and never consults the list.
Running it against a stub upstream (§4 of the quickstart), a fabricated method
`com.etzhayyim.apps.airCrew.thisMethodDoesNotExist` is forwarded to
`dispatcher.etzhayyim.com` exactly like a declared one. The list is
documentation that the router does not read.

Also: `DISPATCHER_INTERNAL_SECRET` is unset in `wrangler.jsonc`, and the code
falls back to `""` — so the shared-secret header would go out empty rather than
fail closed.

## Where to start

The contract survived and the domain model matches it. That makes the ordering
unusually clear:

1. **Decide whether this app exists.** Four hostnames are NXDOMAIN and the
   upstream it was cut from has deleted its copy. Nothing below matters if the
   answer is no.
2. **If yes, write the eight missing computations** — FTL compliance, fatigue
   scoring, duty-limit breach, qualification expiry. That is the product. The
   storage layer under it is already written and tested.
3. **Then wire `kotoba/` to the contract**, adding `callerDid` and moving id
   assignment server-side.
4. **Do not start with `MIGRATION-TODO.md`.** Its own scan found none of the
   violations it lists.

## Layout

```
src/app.ts                     edge dispatcher — not deployed
svelte/                        SvelteKit BFF — the deployed worker
kotoba/src/registry.ts         24 functions, plaintext/E2E split
kotoba/src/types.ts            record bodies and input types
kotoba/test/air-crew.test.ts   11 tests, 5/5 mutants killed
kotodama.jsonld                actor descriptor
wrangler.jsonc                 routes and vars
migration.edn                  provenance — verified byte-identical
```

## Provenance

`migration.edn` claims 20 files and 63,683 bytes at tree `036a83f6` from
`etzhayyim/root@0c30514a`. All four claims verify, and all 20 blobs are
byte-identical to upstream. The only additions are `README.edn` and
`migration.edn`, which is what `:identity :allowed-additions` says. This file
and `docs/operator-quickstart.md` were added on 2026-08-16 and recorded there
too — **if you add a file, add it to that list**, or the next person to run the
check in §1 of the quickstart will see drift that is not drift.
