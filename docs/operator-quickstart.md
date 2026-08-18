# Operator quickstart — app-air-crew

**What you can actually do with this repo today, top to bottom.** About 10
minutes, most of it waiting for one build. No Cloudflare account needed except
for §8.

Every block below was run on 2026-08-18 against the migration branch, and the
output shown is what it printed. Where something could **not** be walked, §9
says so and why — **a step that was skipped is not a step that passed.**

## §0 Four things that will waste your time

1. **The remote is not called `origin`.** west names remotes after the org, so a
   west checkout has `cloud-itonami`. `git fetch origin` fails with *"Please make
   sure you have the correct access rights"* and `origin/main` does not resolve.
   Use `cloud-itonami/main`.
2. **`git` here may print `error: could not read IPC response`.** That is an
   unhealthy fsmonitor daemon, not your command. Pass `-c core.fsmonitor=false`.
3. **Builds are serialised workspace-wide** by the resource guard, and other
   sessions compete for the lock. **exit 2 means queued, not failed.** §5 drives
   it from a retry loop. Do not bypass it.
4. **`npm install` in `kotoba/` does not complete on npm 11.16 / node 26.3.**
   Both dependencies are git deps and the nested install dies with
   `EALLOWSCRIPTS`. That is why §9 records the kotoba test suite as *not re-run
   in this walk*.

Set this once:

```bash
REPO=/path/to/app-air-crew
K=~/github/com-junkawasaki/orgs/kotoba-lang
```

## §1 Check that the documents are telling the truth

```bash
cd "$REPO" && npx --yes nbb scripts/verify-docs-claims.cljs .
```

```
SCANNED	25
PASS	tracked-files	expected=25	actual=25
PASS	inherited-bytes	expected=51772	actual=51772
PASS	preserved-files-unchanged	expected=[]	actual=[]
PASS	removed-by-migration-absent	expected=[]	actual=[]
PASS	svelte-artifacts	expected=0	actual=0
PASS	appview-ts-files	expected=0	actual=0
PASS	kotoba-ts-files	expected=5	actual=5
PASS	canonical-files	expected=4	actual=4
PASS	wrangler-main	expected="dist/worker.js"	actual="dist/worker.js"
PASS	declared-vars	expected=8	actual=8
PASS	declared-routes	expected=2	actual=2
PASS	no-stale-assets-binding	expected=true	actual=true
PASS	sveltekit-compat-flags	expected=0	actual=0
PASS	app-framework-not-sveltekit	expected=true	actual=true
PASS	shadow-builds-that-main	expected=true	actual=true
PASS	warnings-as-errors-in-compiler-options	expected=true	actual=true
PASS	warnings-as-errors-not-misplaced	expected=true	actual=true
PASS	allowed-additions-match-tree	expected=[]	actual=[]
PASS	inherited-file-count	expected=11	actual=11
PASS	page-renders-route-table	expected=true	actual=true
PASS	page-is-handed-env-keys	expected=true	actual=true
OK	every claim in README.md and docs/operator-quickstart.md holds
```

`SCANNED` first is deliberate: **a scan of zero files is not a clean scan**, and
the script exits 2 rather than 0 if it cannot list the tree.

**exit 2 (UNDETERMINED) is not exit 0.** It means the tree could not be read
completely — a different answer from "checked, no problem".

### Watch it fail (otherwise you have not seen a check, only a green light)

Each of these was actually run. Every mutation flagged only the claims it should:

| Mutation | Claims that went red |
|---|---|
| a `.ts` returns to the appview under a new name | `appview-ts-files` |
| a removed path comes back by its own name | `removed-by-migration-absent`, `svelte-artifacts` |
| a `.svelte` file appears somewhere else entirely | `svelte-artifacts` |
| **`kotoba/` grows a 6th `.ts`** | `kotoba-ts-files` |
| an inherited `kotoba/` file is edited | `preserved-files-unchanged`, `inherited-bytes` |
| `compatibility_flags` come back | `sveltekit-compat-flags` |
| **`:warnings-as-errors` moved to `:build-options`** | `warnings-as-errors-in-compiler-options`, `warnings-as-errors-not-misplaced` |
| `wrangler.jsonc` `main` points elsewhere | `wrangler-main`, `shadow-builds-that-main` |
| the page is handed env values again | `page-is-handed-env-keys` |
| run it where there is no git repo | **exit 2**, `UNDETERMINED` |

The `:warnings-as-errors` row is the one worth reading twice. After that
mutation **`grep -c warnings-as-errors shadow-cljs.edn` still returns 2** — the
string is in the file, in the wrong place, and in a comment. The check parses
the EDN and looks at the key's *position*, which is why it can tell those two
trees apart and grep cannot.

## §2 Run the tests (no build, no browser, no network)

The decisions (`route.cljc`) and the page (`view.cljc`) are pure `.cljc`, so nbb
alone runs them.

```bash
cd "$REPO"
CP="src:test:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/run.cljs <<'EOF'
(require '[cljs.test :refer [run-tests]] 'air-crew.route-test)
(run-tests 'air-crew.route-test)
EOF
npx --yes nbb --classpath "$CP" /tmp/run.cljs
```

```
Testing air-crew.route-test

Ran 8 tests containing 39 assertions.
0 failures, 0 errors.
```

What they pin: `/xrpc/` is 400 **only when the nsid is empty** (`/xrpc/a/b` is
relayed, as the SvelteKit rest parameter did — narrowing it is a policy change,
not a migration); MCP router URL resolution including "whitespace counts as
unset"; which headers are forwarded upstream and which are dropped; the JSON-RPC
envelope; `result`/`structuredContent` unwrapping; **that the page is drawn from
the route table** and that the app CSS contains no raw hex, no raw colour
function and no px font size.

### Watch them fail

| Mutation | What went red |
|---|---|
| narrow `/xrpc/a/b` back to a single segment | `dispatch-xrpc` — 1 failure |
| make the view ignore the route table it is handed | `page-shows-the-real-routes` — 3 failures |
| drop `authorization` when forwarding upstream | `forwarded-headers` — 1 failure |
| replace a `--hig-*` token with `rgba(...)` | `page-uses-the-design-system-and-the-token-contract` — 1 failure |
| render with `:css ""` | the `stylesheet inlined` assertion — the `component used` one stays green |

Baseline restored to 0 failures after each.

## §3 Render the page and score it

```bash
cd "$REPO"
CP="src:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/render.cljs <<'EOF'
(require '["node:fs" :as fs] '[air-crew.view :as view] '[air-crew.route :as route])
(let [css (.readFileSync fs (str (.-DDS js/process.env) "/resources/jp_go_dds/dds.css") "utf8")]
  (.writeFileSync fs "/tmp/ac-page.html"
    (view/render {:css css :routes route/routes
                  :vars [:APP_NANOID :APP_UI_TYPE]
                  :mcp-url "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}))
  (println "ok"))
EOF
DDS="$K/jp-go-digital-design-system" npx --yes nbb --classpath "$CP" /tmp/render.cljs

cd "$K/design-quality" && npx --yes nbb -m design-quality.cli score /tmp/ac-page.html --min 95
```

```
  100.00  /tmp/ac-page.html
aggregate: 100.00
findings (headroom-first):
  (none — converged)
gate: aggregate 100.00 >= min 95.00 -> PASS
```

### What that 100.00 does **not** mean — measured, not assumed

Two mutations were run against this exact page and **both came back green**:

| Mutation | Score | Gate |
|---|---|---|
| render with **no design-system CSS at all** (`:css ""`) | **96.63** | **PASS** |
| replace `--hig-color-secondary-label` with a raw `rgba(...)` | **100.00** | **PASS** |

The CLI scores ten document-structure axes and does not score `contrast` or
`input-zoom`. **Neither "the design system is present" nor "the token contract
holds" is a claim this score makes.**

The second is checked by a unit test (§2), strengthened *because* of the second
mutation above. The first needs **two** checks, because the obvious one cannot
fail:

```
                        with dds.css   with :css ""
dads-table                      74             6      ← markup; does NOT flip
dads-heading                    32             5      ← markup; does NOT flip
--color-primitive-blue          45             0      ← CSS only; FLIPS
```

`dads-table` is markup the view emits, so it survives having no stylesheet at
all. It answers "did the view call the library?" and nothing more.
`--color-primitive-blue` appears only inside `dds.css`, so it answers "was the
stylesheet actually inlined?". §7 checks both, separately.

A mutation that does move it: making `render` return the body fragment instead
of a whole document scores **50.56 → FAIL**.

## §4 (Skipped in this walk) — the old TypeScript probes

Earlier revisions of this document built the SvelteKit closure and searched it
to prove which of three implementations was deployed. **Those files no longer
exist**, so those commands are gone rather than left to rot. The conclusion they
reached is recorded in the README and in `docs/adr/0001`; the git history has the
commands.

## §5 Build the bundle

**Never call `shadow-cljs` directly.** The workspace resource guard serialises
heavy builds, and `exit 2` means *someone else holds the lock*, not *failure*:

```bash
cd "$REPO"
for i in $(seq 1 60); do
  node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
    npx --yes shadow-cljs release worker > /tmp/b.log 2>&1
  rc=$?
  [ $rc -eq 0 ] && { echo "BUILD OK"; tail -1 /tmp/b.log; break; }
  [ $rc -ne 2 ] && { echo "BUILD FAILED rc=$rc"; tail -20 /tmp/b.log; break; }
  sleep 45
done
ls -la dist/worker.js
```

```
[:worker] Build completed. (55 files, 12 compiled, 0 warnings, 54.40s)
-rw-r--r--  1 junkawasaki  wheel  247921 dist/worker.js
```

On this walk the lock was held by another session for the first six attempts.

### A green build is not a check, unless one key is in the right place

`shadow-cljs` treats an undeclared or renamed var as a **warning** and exits 0,
shipping a bundle that throws on its first request. `:warnings-as-errors true`
inside `:compiler-options` turns that into a failure. **The same broken source
was built twice, changing only where that key sits:**

```
:compiler-options {… :warnings-as-errors true}   → rc=1
    ------ ERROR ------
    Use of undeclared Var air-crew.route/dispatchh
    {:warning :undeclared-var, …, :shadow.build.compiler/warning-as-error true}

:build-options    {:warnings-as-errors true}     → rc=0
    [:worker] Build completed. (55 files, 1 compiled, 1 warnings, 23.19s)
    Use of undeclared Var air-crew.route/dispatchh
```

**shadow ignores the key under `:build-options` silently.** Put there, it is a
check that cannot fail — worse than no key at all, because it reads as present.
That is why §1's verifier parses the position.

## §6 Run it on the real Workers runtime (workerd)

Stronger than importing the bundle in Node. This is also the measurement that
justified deleting `compatibility_flags`: the config below has **no flags**.

```bash
cd "$REPO" && npx --yes wrangler@latest dev --local --port 8797 --ip 127.0.0.1
# in another shell:
B=http://127.0.0.1:8797
curl -s -o /tmp/p.html -w '%{http_code} %{content_type}\n' $B/
curl -s $B/health; echo
curl -s -X POST -w ' %{http_code}\n' $B/xrpc/
curl -s -X POST -H 'content-type: application/json' -d '{}' -w ' %{http_code}\n' $B/xrpc/a/b
curl -s -X OPTIONS -o /dev/null -w '%{http_code}\n' $B/xrpc/x
curl -s -o /dev/null -w '%{http_code}\n' $B/nope
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/health
```

```
200 text/html; charset=utf-8
{"ok":true,"app":"air-crew","runtime":"cljs","routes":["/","/health","/xrpc/:nsid","/xrpc/*"]}
{"error":"Missing XRPC method"} 400
{"error":"MCP router unreachable","detail":"internal error; reference = hkcq8…","url":"https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"} 502
204
404
405
```

The rendered page contained `dads-table` on 71 lines (`grep -c` counts lines, not occurrences). Single-segment and
multi-segment XRPC both returned **502 with the URL they tried** — the upstream
is NXDOMAIN and that is not hidden behind a 200.

## §7 Exercise the built bundle

The only check that touches the artifact that would actually be deployed.

```bash
cd "$REPO" && npx --yes nbb scripts/smoke-worker.cljs dist/worker.js
```

```
PASS	default export has fetch	expected=true	actual=true
PASS	GET / status	expected=200	actual=200
PASS	GET / is html	expected=true	actual=true
PASS	page advertises /	…	PASS	page advertises /health	…
PASS	page advertises /xrpc/:nsid	…	PASS	page advertises /xrpc/*	…
PASS	page shows a var KEY	expected=true	actual=true
PASS	page hides var VALUES (hidden sentinel)	expected=false	actual=false
PASS	page shows the router destination (shown sentinel)	expected=true	actual=true
PASS	design system: component used (dads-table in markup)	expected=true	actual=true
PASS	design system: stylesheet actually inlined (--color-primitive-blue)	expected=true	actual=true
PASS	GET /health status	expected=200	actual=200
PASS	health names its routes	expected=true	actual=true
PASS	POST /xrpc/ status	expected=400	actual=400
PASS	OPTIONS preflight	expected=204	actual=204
PASS	unknown path	expected=404	actual=404
PASS	wrong method	expected=405	actual=405
PASS	single-segment xrpc is relayed (unreachable upstream -> 502)	expected=502	actual=502
PASS	multi-segment xrpc is treated the SAME as single-segment	expected=502	actual=502
PASS	unreachable upstream is not hidden as success	expected=true	actual=true
OK	the built bundle answers as the route table says
```

Two design notes worth copying:

- **Two sentinels, not one.** One env value must *not* appear on the page
  (`HIDDEN-SENTINEL-…` in `APP_UI_TYPE`); one must (`SHOWN-SENTINEL-…`, inside
  the router URL, which the page renders on purpose). A single sentinel would
  let "render nothing" and "leak everything" both pass. A sentinel is used
  rather than a plausible value because the renderer escapes `"` to `&quot;`,
  so a quoted real value can never match — a check that cannot fail.
- **The multi-segment check compares, it does not assert an absolute.** The
  router is pointed at a `.invalid` host (RFC 2606: never resolves), so the
  check says *multi-segment behaves the same as single-segment* without
  depending on real DNS or on `mcp.etzhayyim.com` staying dead.

### Watch it fail

| Mutation | Result |
|---|---|
| point it at a path with no bundle | **exit 2**, `UNDETERMINED`, "Refusing to report a pass" |
| **rebuild with the stylesheet not inlined** | exit 1 — `stylesheet actually inlined` goes red while `component used` stays green |
| break `dads-table` in the built artifact | exit 1 — `component used` |
| break the route string in the built artifact | exit 1 — `page advertises /xrpc/:nsid`, `health names its routes` |
| **rebuild with the worker handing the page env values** | exit 1 — `page hides var VALUES`, `page shows a var KEY` |

The last one is a real rebuilt bundle, not an edited artifact.

## §8 Deploy

```bash
cd "$REPO" && npx wrangler deploy
```

**Not run in this walk, and read this before you run it.** The routes point at
`air-crew.etzhayyim.com` and `a1rcr3w0.etzhayyim.com`, both **NXDOMAIN**; the
XRPC relay target `mcp.etzhayyim.com` is **NXDOMAIN** too. A successful deploy
would be unreachable, and if reached would return 502. The README's *Where to
start* puts "decide whether this app exists" first for that reason.

The superproject deploy guard also refuses to deploy from a checkout that does
not contain `origin/main`.

## §9 What was NOT walked, and what that costs

- **`kotoba/`'s 11 tests were not re-run in this walk.** The npm wall in §0.4 is
  unchanged. An earlier walk (2026-08-16) ran them with a local checkout of the
  mock at its pinned SHA — 11 passed, and five deliberate mutations were each
  caught. **This migration did not touch those files** (their sha256 are pinned
  in §1's verifier), so that result still describes them, but it is a
  *prior* measurement, not one from today.
- **`kotoba/` typecheck is unknown.** `tsc --noEmit` there needs the real
  `@etzhayyim/sdk`. Not passing, not failing — unmeasured.
- **Nothing was deployed.** No live endpoint was called beyond DNS.
- **`vertexId` was not traced.** All eight BPMN processes return it, nothing
  here produces it, and where it should come from is outside this repository.
- **The DNS state was re-measured** (§10) but nothing was done about it.

## §10 DNS

```bash
for h in air-crew.etzhayyim.com a1rcr3w0.etzhayyim.com \
         dispatcher.etzhayyim.com mcp.etzhayyim.com etzhayyim.com; do
  for ns in 1.1.1.1 8.8.8.8; do
    printf "%-28s @%-8s " "$h" "$ns"
    dig +noall +comments +time=3 +tries=1 @$ns "$h" A | grep -o 'status: [A-Z]*' | head -1
  done
done
```

All four service names: **NXDOMAIN** on both resolvers. The apex
`etzhayyim.com` answers `NOERROR` with `172.67.179.128` and `104.21.51.111`.
Four missing labels under a healthy Cloudflare zone — a DNS change, not an
outage to debug, but see the README before adding any.

## §11 Leave the checkout clean

```bash
git -c core.fsmonitor=false status --short    # → (empty)
rm -rf dist .shadow-cljs .cpcache node_modules
```

`dist/`, `.shadow-cljs/`, `.cpcache/`, `node_modules/` and `.wrangler/` are
gitignored: the bundle is a build product, and the smoke deliberately returns
**exit 2** rather than 0 when it is absent.
