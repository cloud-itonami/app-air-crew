# app-air-crew

**An airline crew-management app that records the inputs to safety decisions and
makes none of them.** Extracted verbatim from `etzhayyim/root` on 2026-07-20.
**On 2026-08-18 the appview was migrated from TypeScript/Svelte to
ClojureScript** (`docs/adr/0001`). Every hostname anything here talks to is
still **NXDOMAIN** — the migration does not change that, and says so.

Numbers in this file are re-derived from the tree by
`scripts/verify-docs-claims.cljs`. If one drifts, that script fails.

## The thing this repo was built wrong around, and what it is now

Before the migration, `wrangler.jsonc` set `main` to
`svelte/.svelte-kit/cloudflare/_worker.js` — **a path not present in the tree**
(`git ls-files | grep svelte-kit` → 0). The file a reader opened, `src/app.ts`,
was referenced by nothing and was in no bundle. The landing page reported
`routeCount: 0` and `vars: []` beside a `wrangler.jsonc`, in the same
directory, declaring **2 routes and 8 vars**.

Now:

```
src/air_crew/route.cljc    判断 — routes, header forwarding, envelope, unwrap  ← pure .cljc, tested
src/air_crew/view.cljc     the page (jp-go-dds hiccup)                          ← pure .cljc, tested
src/air_crew/worker.cljs   the only layer that touches Request/Response
        ↓ shadow-cljs :target :esm
dist/worker.js             ← what wrangler.jsonc "main" points at
```

`scripts/verify-docs-claims.cljs` checks that **shadow's output dir, wrangler's
`main` and the exported namespace all mesh**, so that shape cannot silently
come back.

The page is handed `air-crew.route/routes` and renders it. Display and
behaviour come from one value, so `Routes 0` beside a config declaring two is
now structurally impossible — and the verifier asserts the structure, not a
substring.

## Public routes

| METHOD | PATH | What it does |
|---|---|---|
| GET | `/` | this appview's description page |
| GET | `/health` | liveness — **added by the migration**, see below |
| POST | `/xrpc/:nsid` | relay XRPC to the MCP router |
| OPTIONS | `/xrpc/*` | CORS preflight |

`/health` did not exist on the deployed SvelteKit surface. It is an
**addition**, not a port: it has no upstream host, and it is how you check from
outside that the deployed face answers.

**Multi-segment paths (`/xrpc/a/b`) are relayed, not rejected.** The SvelteKit
route used a rest parameter `[...path]` and forwarded them verbatim; only the
empty string was 400. Narrowing that would change where failure happens — a
policy change wearing a migration's clothes — so it was not done here.

## What is true now

Measured 2026-08-18 against this branch. Reproduce from
[`docs/operator-quickstart.md`](docs/operator-quickstart.md).

| What this repo asserts | What is true now |
|---|---|
| `wrangler.jsonc` serves `air-crew.etzhayyim.com/*` and `a1rcr3w0.etzhayyim.com/*` | Both **NXDOMAIN** on 1.1.1.1 and 8.8.8.8. The zone is healthy — `etzhayyim.com` apex answers with two A records — so these are missing labels, not an outage. |
| `/xrpc/:nsid` relays to `mcp.etzhayyim.com` | **NXDOMAIN.** The relay returns **502** with the URL it tried. It does not hide an unreachable upstream behind a 200. |
| `kotodama.jsonld` declares the actor `did:web:air-crew.etzhayyim.com` | Unresolvable — `did:web` needs `https://air-crew.etzhayyim.com/.well-known/did.json` and the host does not resolve. |
| `MIGRATION-TODO.md`: seed awaiting a Charter §2(a) codemod | The scan recorded in that same file found **none** of the patterns it was written to remove. The blocker was never the codemod. |
| `NOTICE`: "Charter Compliance Rider v3.1 (see `CHARTER-RIDER.md`)" | That file is **not in this repository**. It is in `etzhayyim/root`. |
| The landing page's route and var counts | Now rendered from the route table and from the env keys the Worker was handed. Not baked. |
| ~~`package.json` `typecheck: tsc --noEmit`~~ | **Removed by the migration.** There was no root `tsconfig.json` and no input files: it printed the tsc usage banner and exited 1, having checked zero files. It could neither pass nor fail informatively. |
| Upstream `etzhayyim/root@main:60-apps/etzhayyim-project-air-crew` | Gone. `60-apps` on `origin/main` holds one entry, `etzhayyim-project-organism`. |
| **`00-contracts/bpmn/com/etzhayyim/air-crew/`** | **Still there, all 8 processes, on upstream `main`.** Unlike the app, the contract survived. |

## What was removed, and what was deliberately kept

**Removed — the appview's TypeScript and Svelte (9 files):**

```
src/app.ts                                     edge dispatcher — was in no bundle
package.json                                   only script was a typecheck that checked nothing
svelte/package.json  svelte/svelte.config.js  svelte/tsconfig.json  svelte/vite.config.ts
svelte/src/app.html  svelte/src/routes/+page.svelte
svelte/src/routes/xrpc/[...path]/+server.ts    the deployed BFF — ported to route.cljc + worker.cljs
```

Also removed from `wrangler.jsonc`: the `assets` block (it pointed at
`./svelte/.svelte-kit/cloudflare/client`, which nothing in the tree can now
produce) and the `compatibility_flags` `nodejs_compat` / `nodejs_als` (they
were adapter-cloudflare's requirement). **The flags were removed only after
running the flagless config on real workerd and hitting every route** — see the
quickstart §6. `APP_FRAMEWORK` changed from `sveltekit-edge-bff` to
`cljs-esm-worker`.

**Kept — `kotoba/`, 5 TypeScript files.** This is the domain model (24
functions: pairing templates in plaintext, every per-person record sealed with
`encryptedWrite` under an owner-DID-plus-recipients read capability). The
migration's subject was the appview, not "every `.ts` in the repo", and the
difference is a measurement, not a preference:

| Question | Measurement | Answer |
|---|---|---|
| In the deployed bundle? | 2026-08-16 search of the whole SvelteKit closure (41 files): all 6 probe symbols absent | No |
| Referenced by anything being replaced? | `git grep` finds no code reference; the only mention is prose in `MIGRATION-TODO.md` | No |
| **Do its pinned dependencies resolve?** | `git fetch <url> <sha>` **succeeds for both** — `com-etzhayyim-sdk@12314a0c` and `com-etzhayyim-sdk-mock@c857ff9b`, each `type=commit` | **Yes** |
| How much of the repo is it? | 47,795 of 93,551 bytes | **51.1%** |

The third row is what decides it. Not porting a route whose host is NXDOMAIN is
one rule; deleting live, tested code because a template said "remove all
TypeScript" is a different act, and it would have destroyed over half this
repository. So `kotoba/` stays — and `scripts/verify-docs-claims.cljs` **pins
its file count at 5**, so that keeping it does not become permission for it to
grow unnoticed. Migrating it is a separate decision that starts with a cljs
face for `@etzhayyim/sdk`.

*(Note on method: `gh api repos/…/commits/<sha>` returned **404** for both
pinned SHAs while `git fetch` retrieved both. The git measurement is the one
this table reports; the API answer was wrong and confident.)*

**Not ported (deliberately, from `src/app.ts` which was deployed nowhere):**

- the `com.etzhayyim.apps.airCrew.*` relay to `dispatcher.etzhayyim.com` —
  **NXDOMAIN**, and `DISPATCHER_INTERNAL_SECRET` is not in `wrangler.jsonc` so
  the code fell back to `""`, sending an empty shared secret rather than
  failing closed
- `/_app/meta` — the same body as `/health` under a second name; folded into one
- the 8-element `methods` array — `src/app.ts` branched on
  `nsid.startsWith("com.etzhayyim.apps.airCrew.")` and never read it. A 2026-08-16
  probe forwarded a fabricated `…airCrew.thisMethodDoesNotExist` exactly like a
  declared method. **An array the router does not read is documentation.**

## Languages, before and after

| | appview `.ts` | `.svelte` | `kotoba/` `.ts` | `.cljc`/`.cljs` |
|---|---|---|---|---|
| before | 3 | 1 | 5 | 0 |
| after | **0** | **0** | 5 (pinned) | **4** |

Both zeroes and the pin are claims in the verifier, caught two different ways:
by name (the 9 removed paths must stay absent) and by count (a `.ts` returning
under any other name still fails).

## The contract still exists, and it maps onto `kotoba/` one-to-one

`src/app.ts` advertised a BPMN path in its `/health` payload:
`etzhayyim-root/00-contracts/bpmn/com/etzhayyim/air-crew`. **That path is live
on upstream `main`** — eight hand-written Zeebe processes, one per method:

| BPMN process | Zeebe job type | kotoba function |
|---|---|---|
| `publishRoster` | `air.crew.roster.publish` | `recordRoster` |
| `buildPairing` | `air.crew.pairing.build` | `recordPairing` |
| `trackQualification` | `air.crew.qualification.track` | `recordQualification` |
| `assessFatigue` | `air.crew.fatigue.assess` | `recordFatigue` |
| `assignCrew` | `air.crew.crew.assign` | `recordAssignment` |
| `bookCrewTravel` | `air.crew.travel.book` | `recordTravel` |
| `recordDutyTime` | `air.crew.duty_time.record` | `recordDutyTime` |
| `notifyCrew` | `air.crew.crew.notify` | `recordNotification` |

Every one of the eight contract inputs is a field-for-field match with the
corresponding kotoba input type. **The vocabulary gap is superficial** — this is
an adapter, not a reimplementation. Three systematic differences, all
one-directional:

- BPMN passes **`callerDid`**; kotoba has no caller parameter anywhere.
- BPMN **returns** the record id (`rosterId`, …) as a server output; kotoba takes
  it as a client-supplied argument.
- kotoba adds **`recipients`** (the E2E read capability); BPMN has no notion of it.

## What the contract asks for and nothing here computes

**This is unchanged by the migration and is the most important thing in this
file.** Each BPMN process declares output variables — the derived values, the
judgments — and every one is absent from every tracked file here:

| Contract output | Meaning | Present? |
|---|---|---|
| `ftlCompliant` | flight-time-limitation verdict on a pairing | **no** |
| `fatigueScore`, `riskLevel`, `limitBreach` | the fatigue assessment itself | **no** |
| rolling `cumulative28d` / `365d` breach | duty-hour limit enforcement | **no** (the fields are *stored*, never *checked*) |
| `daysToExpiry` | qualification currency | **no** |
| `travelRef`, `acknowledgedAt` | booking reference, notification receipt | **no** |
| `vertexId` | graph anchor returned by every process | **no** |
| `callerDid` | who invoked it | **no** |

`recordFatigue` accepts `fdpHours`, `restHours`, `cumulative28d` and
`cumulative365d` and writes them down. It never compares them to a limit. For a
crew-management system the regulatory half — *is this crew member legal to
fly* — is exactly the half that does not exist. **This repository is a recorder,
not an assessor**, and its own contract says it was meant to be both.

## Three method vocabularies, none of which agree

| Source | Count | Names |
|---|---|---|
| `kotodama.jsonld` `capabilities` | 3 | `publishRoster`, `buildPairing`, `trackQualification` |
| `wrangler.jsonc` `APP_CAPABILITIES` | 3 | identical to the above |
| `kotoba/src/index.ts` exports | 24 | `recordRoster`, `listRosters`, … `coverage` |

The three advertised capabilities appear **only** as string literals. None
exists as a function anywhere. The appview relays whatever nsid it is given —
it is a relay, and does not claim to be a registry.

## UI

Base is `kotoba-lang/jp-go-digital-design-system` (デジタル庁デザインシステム),
per the workspace skill `kotoba-uiux`. Colours and sizes come only from the
`--hig-*` token contract; app CSS is 3 lines; the stylesheet is baked into the
bundle with `shadow.resource/inline` (design-system policy: zero external
requests).

Deterministic audit (`kotoba-lang/design-quality`): **100.00 / 100**, gate 95.

**That score certifies less than it looks like, and this repo measured it.**
Rendering the same page with *no design system CSS at all* scores **96.63** and
still passes `--min 95`; replacing a `--hig-*` token with a raw `rgba(...)`
still scores **100.00**, because the CLI never scores the `contrast` and
`input-zoom` axes. So neither "the design system is present" nor "the token
contract holds" is a claim the score makes.

**And "the design system is present" needs two checks, not one.** Asserting a
`dads-table` class only says the view *called the library* — that class is
markup the view emits whether or not any CSS came with it. Rendering this page
with `:css ""` still leaves **6** occurrences of `dads-table` (down from 74), so
a check on it cannot fail. A token that exists only inside `dds.css` and never
in emitted markup does distinguish the two: `--color-primitive-blue` goes
**45 → 0**. Both are checked, separately:

| Claim | Check | with CSS | with `:css ""` |
|---|---|---|---|
| the view called the library | `dads-table` in markup | 74 | 6 — **cannot fail** |
| the stylesheet was actually inlined | `--color-primitive-blue` | 45 | **0** — flips |

"The token contract holds" is a third, separate claim, checked by a unit test
that forbids raw hex and raw colour functions in the app CSS.

**On env values**: the page lists env **keys** and shows exactly one env-derived
**value** — the XRPC relay destination — on purpose, because where requests go
should be readable. The smoke checks this with **two independent sentinels**:
one value that must not appear, one that must. One alone would let both "render
nothing" and "leak everything" pass.

## Verification

```bash
npx --yes nbb scripts/verify-docs-claims.cljs .    # <dir> FIRST
```

exit 0 = every claim holds / 1 = a claim is false / **2 = could not answer**
(kept distinct from 0). Tests, build, smoke and the workerd run are in
[`docs/operator-quickstart.md`](docs/operator-quickstart.md), with the output
they actually printed.

## Where to start

The contract survived and the domain model matches it. The ordering is
unusually clear, and the migration did not change it:

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
src/air_crew/route.cljc        routing, header forwarding, envelope, unwrap
src/air_crew/view.cljc         the page (jp-go-dds)
src/air_crew/worker.cljs       Request/Response — the only layer that touches them
test/air_crew/route_test.cljc  8 tests / 37 assertions
scripts/smoke-worker.cljs      exercises the BUILT bundle (exit 2 if absent)
scripts/verify-docs-claims.cljs re-derives every number in these docs
deps.edn  shadow-cljs.edn      build
wrangler.jsonc                 routes and vars; main → dist/worker.js
kotoba/src/registry.ts         24 functions, plaintext/E2E split   ← kept, see above
kotoba/src/types.ts            record bodies and input types       ← kept
kotoba/test/air-crew.test.ts   11 tests, 5/5 mutants killed        ← kept
kotodama.jsonld                actor descriptor
migration.edn                  provenance
docs/adr/0001-…                the migration decision
```

## Provenance

`migration.edn` records the source as `etzhayyim/root@0c30514a`, tree
`036a83f6`, 20 files, 63,683 bytes. The 11 inherited files this repo still
carries are **byte-identical**, pinned by sha256 in the verifier.

Two inherited files were changed **on purpose** and are checked by content
instead of by hash: `wrangler.jsonc` (main, assets, compat flags,
`APP_FRAMEWORK`) and `migration.edn` (`:allowed-additions`). Keeping them out
of the hash set is what keeps an intentional change distinguishable from an
accidental one.

**If you add a file, add it to `:allowed-additions`** — the verifier checks that
set against the tree, so the provenance comparison in the quickstart stays
meaningful.
