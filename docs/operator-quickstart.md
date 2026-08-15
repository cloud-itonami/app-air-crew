# Operator quickstart — app-air-crew

Every claim in [`../README.md`](../README.md) is reproduced by a command here.
All of these were run on 2026-08-16 against `3bb4ea9` and the output shown is
what they printed. Where something could **not** be walked, §8 says so and why —
a step that was skipped is not a step that passed.

Read §0 first. Four of the commands below fail in a misleading way if you skip
it.

## §0 Five things that will waste your time

1. **The remote is not called `origin`.** west names remotes after the org, so
   this checkout has `cloud-itonami`. `git fetch origin` fails with
   *"Please make sure you have the correct access rights"* and `origin/main`
   does not resolve. Use `cloud-itonami/main`.
2. **`git` here may print `error: could not read IPC response`.** That is the
   fsmonitor daemon, not your command. It is noise on stderr and the command
   still succeeds; pass `-c core.fsmonitor=false` to silence it.
3. **npm 11.16 cannot install this package's dependencies.** Both
   `@etzhayyim/sdk` and `@etzhayyim/sdk-mock` are git dependencies, and the
   nested install npm runs to prepare them dies with `EALLOWSCRIPTS`
   (*"--allow-scripts is not allowed in project-scoped installs"*). Adding an
   `allowScripts` field does not help — the rejection happens inside the nested
   install, not yours. §5 works around this; §8 records what it costs.
4. **`esbuild --loader=ts` is rejected** when the input is a file rather than
   stdin (*"loader without extension only applies when reading from stdin"*).
   Drop the flag; esbuild infers from the `.ts` extension.
5. **There is no `.gitignore`.** Building inside the checkout leaves
   `node_modules/` and `.svelte-kit/` untracked. Everything below builds in
   scratch copies under `/tmp` so the checkout stays byte-clean.

Set this once:

```bash
REPO=~/github/com-junkawasaki/orgs/cloud-itonami/app-air-crew
UP=~/github/com-junkawasaki/orgs/etzhayyim/root
```

## §1 Provenance — is this really a verbatim copy?

`migration.edn` makes four checkable claims. Confirm the upstream commit is
present locally first (`etzhayyim/root` must be a full, non-shallow clone —
a shallow one answers ancestry questions wrongly and confidently):

```bash
git -C "$UP" rev-parse --is-shallow-repository        # → false
git -C "$UP" cat-file -t 0c30514ab1ac7f929b1c796f2d03594117fae2d7   # → commit
```

Tree, file count, byte total:

```bash
REV=0c30514ab1ac7f929b1c796f2d03594117fae2d7
P=60-apps/etzhayyim-project-air-crew
git -C "$UP" rev-parse "$REV:$P"
# → 036a83f6ed59454b3f8c62428b60f8ed96c8e91a   (matches :tree)

git -C "$UP" ls-tree -r --name-only "$REV:$P" | sort > /tmp/crew-upstream-files.txt
wc -l < /tmp/crew-upstream-files.txt                  # → 20   (matches :tracked-files)

git -C "$UP" ls-tree -r -l "$REV:$P" | awk '{s+=$4} END {print s}'
# → 63683                                             (matches :bytes)
```

Byte-identity of every blob, plus what exists downstream that upstream does not:

```bash
match=0; differ=0; missing=0
while IFS= read -r f; do
  a=$(git -C "$UP" rev-parse "$REV:$P/$f" 2>/dev/null)
  b=$(git -C "$REPO" rev-parse "HEAD:$f" 2>/dev/null)
  if   [ -z "$b" ];      then echo "MISSING: $f"; missing=$((missing+1))
  elif [ "$a" = "$b" ];  then match=$((match+1))
  else echo "DIFFER: $f"; differ=$((differ+1)); fi
done < /tmp/crew-upstream-files.txt
echo "SCANNED=$(wc -l < /tmp/crew-upstream-files.txt) MATCH=$match DIFFER=$differ MISSING=$missing"
# → SCANNED=20 MATCH=20 DIFFER=0 MISSING=0

git -C "$REPO" ls-files | sort > /tmp/crew-down-files.txt
comm -13 /tmp/crew-upstream-files.txt /tmp/crew-down-files.txt
# → README.edn / migration.edn
```

The last command lists the files added by the extraction. It must agree with
`:identity :allowed-additions` in `migration.edn` — that field exists so this
comparison stays meaningful. **If you add a file to this repository, add it
there too**, or the next person to run this check will see drift that is not
drift. (`README.md` and `docs/operator-quickstart.md` were added this way on
2026-08-16.)

## §2 Where the upstream went, and what survived

The app is gone:

```bash
git -C "$UP" fetch origin main
git -C "$UP" ls-tree --name-only FETCH_HEAD 60-apps/
# → 60-apps/etzhayyim-project-organism      (one entry; air-crew is not there)
```

The contract is not:

```bash
git -C "$UP" ls-tree -r --name-only FETCH_HEAD 00-contracts/bpmn/com/etzhayyim/air-crew/
# → assessFatigue.bpmn assignCrew.bpmn bookCrewTravel.bpmn buildPairing.bpmn
#   notifyCrew.bpmn publishRoster.bpmn recordDutyTime.bpmn trackQualification.bpmn
```

That is the path `src/app.ts` names in its `/health` payload, and it is live on
`main` today. The mapping table in the README comes from these eight files:

```bash
BP=00-contracts/bpmn/com/etzhayyim/air-crew
for f in publishRoster buildPairing trackQualification assessFatigue \
         assignCrew bookCrewTravel recordDutyTime notifyCrew; do
  printf "%-20s " "$f"
  git -C "$UP" show "FETCH_HEAD:$BP/$f.bpmn" \
    | grep -oE 'taskDefinition type="[^"]*"' | head -1 | sed 's/taskDefinition type=//'
done
# → publishRoster "air.crew.roster.publish"   … (8 job types, one per process)
```

Input field sets — compare these to `kotoba/src/types.ts`:

```bash
for f in publishRoster buildPairing trackQualification assessFatigue \
         assignCrew bookCrewTravel recordDutyTime notifyCrew; do
  printf "%-20s " "$f"
  git -C "$UP" show "FETCH_HEAD:$BP/$f.bpmn" \
    | grep -oE 'input source="=\{[^}]*\}"' | head -1 | sed 's/input source="={//;s/}"$//' | tr -d ' '
  echo
done

for t in RecordRosterInput RecordPairingInput RecordQualificationInput \
         RecordFatigueInput RecordAssignmentInput RecordTravelInput \
         RecordDutyTimeInput RecordNotificationInput; do
  printf "%-28s " "$t"
  git -C "$REPO" show HEAD:kotoba/src/types.ts | awk "/export interface $t /,/^}/" \
    | grep -oE '^[[:space:]]+[a-zA-Z0-9]+\??:' | tr -d ' :?' | tr '\n' ' '
  echo
done
```

Read the two lists side by side. `publishRoster` takes
`crewDid flightNo depDate role dutyStart dutyEnd base callerDid`;
`RecordRosterInput` takes
`rosterId crewDid flightNo depDate role dutyStart dutyEnd base recordedAt recipients`.
The domain fields are identical; the deltas are `callerDid` (contract only),
`rosterId` (contract *returns* it, kotoba takes it), and `recipients`
(kotoba only). The same three deltas hold for all eight.

## §3 What the contract asks for and nothing computes

Output variables, then a search for each one across every tracked file:

```bash
for f in publishRoster buildPairing trackQualification assessFatigue \
         assignCrew bookCrewTravel recordDutyTime notifyCrew; do
  printf "%-20s outputs: " "$f"
  git -C "$UP" show "FETCH_HEAD:$BP/$f.bpmn" \
    | grep -oE 'output source="=[a-zA-Z0-9]+"' | sed 's/output source="=//;s/"//' | tr '\n' ' '
  echo
done
# → publishRoster outputs: vertexId rosterId status
#   buildPairing  outputs: vertexId pairingId ftlCompliant status
#   assessFatigue outputs: vertexId fatigueScore riskLevel limitBreach status
#   …

for s in vertexId ftlCompliant daysToExpiry fatigueScore riskLevel \
         limitBreach travelRef acknowledgedAt callerDid; do
  printf "  %-16s " "$s"
  hits=$(git -C "$REPO" grep -lF "$s" HEAD -- . 2>/dev/null | sed 's|^HEAD:||' | tr '\n' ' ')
  echo "${hits:-— absent from every tracked file}"
done
# → all nine: absent from every tracked file
```

`grep -l` is used deliberately: it answers *which files*, and an empty answer is
visibly empty rather than a count of zero that reads like a clean scan.

Then read what fatigue actually stores:

```bash
git -C "$REPO" show HEAD:kotoba/src/types.ts | awk '/export interface FatigueAssessmentBody /,/^}/'
```

`fdpHours`, `restHours`, `cumulative28d`, `cumulative365d` are all recorded.
Nothing compares any of them to a limit.

## §4 The dispatcher's `methods` list does not gate routing

`src/app.ts` is a normal fetch handler, so you can run it directly with a stub
upstream. Make the scratch copy that this section and §5 and §6 all share, and
install the svelte devDependencies — that is where the `esbuild` below comes
from:

```bash
rm -rf /tmp/crew-build && mkdir -p /tmp/crew-build
git -C "$REPO" archive HEAD | tar -x -C /tmp/crew-build
cd /tmp/crew-build/svelte && npm install      # postinstall warnings are fine

mkdir -p /tmp/crew-dispatch && cp /tmp/crew-build/src/app.ts /tmp/crew-dispatch/app.ts
/tmp/crew-build/svelte/node_modules/.bin/esbuild /tmp/crew-dispatch/app.ts \
  --format=esm --outfile=/tmp/crew-dispatch/app.mjs        # no --loader; see §0.4
```

```bash
cat > /tmp/crew-dispatch/probe.mjs <<'EOF'
import handler from './app.mjs';
const seen = [];
globalThis.fetch = async (url, init) => {
  seen.push({ url: String(url), secret: init?.headers?.['x-internal-secret'] });
  return new Response(JSON.stringify({ stub: true }), { status: 200 });
};
const env = { APP_NANOID: 'a1rcr3w0' };
const call = async (path, init) => {
  const res = await handler.fetch(new Request('https://air-crew.etzhayyim.com' + path, init), env);
  return { status: res.status, body: await res.text() };
};
console.log('declared method  :', JSON.stringify(await call('/xrpc/com.etzhayyim.apps.airCrew.publishRoster', { method: 'POST', body: '{}' })));
console.log('UNDECLARED method:', JSON.stringify(await call('/xrpc/com.etzhayyim.apps.airCrew.thisMethodDoesNotExist', { method: 'POST', body: '{}' })));
console.log('other namespace  :', JSON.stringify(await call('/xrpc/com.etzhayyim.apps.airCargo.issueAirWaybill', { method: 'POST', body: '{}' })));
console.log('bad json         :', JSON.stringify(await call('/xrpc/com.etzhayyim.apps.airCrew.publishRoster', { method: 'POST', body: '{oops' })));
for (const s of seen) console.log('  forwarded:', s.url, '| secret=' + JSON.stringify(s.secret));
EOF
cd /tmp/crew-dispatch && node probe.mjs
```

```
declared method  : {"status":200,"body":"{\"stub\":true}"}
UNDECLARED method: {"status":200,"body":"{\"stub\":true}"}
other namespace  : {"status":404,"body":"{\"error\":\"NotFound\"}"}
bad json         : {"status":400,"body":"{\"error\":\"InvalidJson\"}"}
  forwarded: https://dispatcher.etzhayyim.com/xrpc/com.etzhayyim.apps.airCrew.publishRoster | secret=""
  forwarded: https://dispatcher.etzhayyim.com/xrpc/com.etzhayyim.apps.airCrew.thisMethodDoesNotExist | secret=""
```

Rows 1 and 2 are the point: the fabricated method is forwarded exactly like the
declared one. Rows 3 and 4 are the control — the handler does discriminate on
the NSID prefix and on malformed JSON, so row 2 is a real gap and not a probe
that never reached the code. `secret=""` is the unset-fallback: with no
`DISPATCHER_INTERNAL_SECRET` binding the header goes out empty.

## §5 Which implementation is deployed

`wrangler.jsonc` points `main` at `svelte/.svelte-kit/cloudflare/_worker.js`, so
build that and search the closure (§4 already created `/tmp/crew-build` and
installed these dependencies). `_worker.js` imports **across directory
boundaries** — check for yourself before trusting any file count:

```bash
cd /tmp/crew-build/svelte
npm run build
head -c 200 .svelte-kit/cloudflare/_worker.js
# → import { Server } from "./../output/server/index.js";
#   import { manifest, ... } from "./../cloudflare-tmp/manifest.js";
```

So the closure is three directories, not one:

```bash
B=/tmp/crew-build/svelte/.svelte-kit
find "$B/cloudflare" "$B/cloudflare-tmp" "$B/output/server" -type f | wc -l   # → 41

probe() {
  n=$(grep -rlF "$2" "$B/cloudflare" "$B/cloudflare-tmp" "$B/output/server" 2>/dev/null | wc -l | tr -d ' ')
  printf "  %-8s [%s] %s\n" "$1" "$n" "$2"
}
for s in 'x-etzhayyim-xrpc-method' 'AGENTGATEWAY_MCP_ROUTER_URL' \
         'mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message' 'sveltekit-edge-bff'; do probe svelte "$s"; done
for s in 'edge-proxy+agentgateway-mcp+langserver' 'dispatcher.etzhayyim.com' \
         'DISPATCHER_INTERNAL_SECRET' 'x-internal-secret' '_app/meta' \
         'com.etzhayyim.apps.airCrew.' 'InvalidJson' 'assessFatigue' 'bookCrewTravel'; do probe app.ts "$s"; done
for s in 'recordPairing' 'listQualifications' 'encryptedWrite' 'air-crew-kotoba' \
         'recordDutyTime' 'crewBase'; do probe kotoba "$s"; done
```

```
  svelte   [1] x-etzhayyim-xrpc-method          … all 4 present
  app.ts   [0] edge-proxy+agentgateway-mcp+…    … all 9 absent
  kotoba   [0] recordPairing                    … all 6 absent
```

The svelte probes are what make this a measurement rather than a failed grep: if
they came back `[0]` too, the search itself would be broken.

## §6 Run the tests

The dependency wall from §0.3 is here. The workaround rests on two facts you can
check yourself:

```bash
git -C "$REPO" grep -n '@etzhayyim/sdk' HEAD -- kotoba/src
# → kotoba/src/registry.ts:16:import type { Etzhayyim } from "@etzhayyim/sdk";
```

That is a **type-only** import — erased at runtime. And the mock is standalone:

```bash
rm -rf /tmp/crew-sdk && mkdir -p /tmp/crew-sdk && cd /tmp/crew-sdk
git clone -q https://github.com/etzhayyim/com-etzhayyim-sdk-mock.git sdk-mock
git -C sdk-mock checkout -q c857ff9be5310bf433bfe1e8d3c0f677e213d667   # the pinned SHA
grep -n '@etzhayyim/sdk' sdk-mock/src/index.ts
# → two hits, both inside comments. Nothing is imported.
```

So neither the tests nor the code under test need the real SDK **at runtime**.
Install the mock from disk with its unused dependency removed:

```bash
node -e 'const fs=require("fs"),f="/tmp/crew-sdk/sdk-mock/package.json";
const p=JSON.parse(fs.readFileSync(f,"utf8"));delete p.dependencies;
fs.writeFileSync(f,JSON.stringify(p,null,2));'

cd /tmp/crew-build/kotoba
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
delete p.dependencies;
p.devDependencies={"@etzhayyim/sdk-mock":"file:/tmp/crew-sdk/sdk-mock","typescript":"^5.6.0","vitest":"^4.1.0"};
fs.writeFileSync("package.json",JSON.stringify(p,null,2));'

npm install --ignore-scripts
npx vitest run
# → Test Files  1 passed (1)
#         Tests  11 passed (11)
```

**This edits `/tmp/crew-build`, never `$REPO`.** §8 records what the workaround
gives up.

## §7 Do the tests discriminate? (five mutants)

Eleven green tests prove nothing until you have seen them go red. Each mutation
below must be verified to have **applied** — a `sed`/`replace` that silently
matches nothing produces a red-free run that looks exactly like a surviving
mutant. `run_mut` exits early and says `NO-OP` in that case.

```bash
cd /tmp/crew-build/kotoba
cp src/registry.ts /tmp/registry.orig.ts

run_mut () {
  name="$1"; shift
  cp /tmp/registry.orig.ts src/registry.ts
  node -e "$1" || { echo "  ⚠ $name: NO-OP (pattern not found) — mutation did not apply"; \
                    cp /tmp/registry.orig.ts src/registry.ts; return; }
  echo "  $name -> $(npx vitest run 2>&1 | grep -E '^ +Tests +' | head -1)"
}
```

| # | mutation | result |
|---|---|---|
| M1 | `recordPairing` dedup: `alreadyExists` → `recorded` | **1 failed** / 10 passed |
| M2 | decimal-hours validator on `totalFdtHours` → always accept | **1 failed** / 10 passed |
| M3 | `recordRoster` required-field check → always accept | **1 failed** / 10 passed |
| M4 | `recordRoster` `encryptedWrite` → plaintext `write` | **3 failed** / 8 passed |
| M5 | `listRosters` drops the `crewDid` filter | **1 failed** / 10 passed |

M4 is the one worth knowing: replacing the sealed write with a plaintext one
breaks three tests, including *"enforces read-cap: non-recipient DID sees no
rosters"*. The E2E claim in the package description is load-bearing and checked.

Restore and confirm the baseline is green again — otherwise you have measured a
broken tree, not a killed mutant:

```bash
cp /tmp/registry.orig.ts src/registry.ts
npx vitest run    # → Tests  11 passed (11)
```

## §8 What could not be walked, and what that costs

- **`npm install` as written in `kotoba/package.json` does not complete on
  npm 11.16.0 / node 26.3.0.** §0.3 has the error. §6 substitutes a local
  checkout of the mock at the pinned SHA. The substitution is sound at runtime
  (type-only import, standalone mock — both verified above) but it means **the
  suite has not been run against `@etzhayyim/sdk` itself**. If the real SDK's
  `Etzhayyim` interface has drifted from what `registry.ts` calls, these tests
  would not show it.
- **`kotoba` typecheck fails and cannot be fixed without the real SDK.**
  `npx tsc --noEmit` in `/tmp/crew-build/kotoba` exits **2** with three errors:
  `TS2307 Cannot find module '@etzhayyim/sdk'` plus two `TS7006` implicit-`any`
  parameters that are downstream of it. Whether the package typechecks against
  the pinned SDK is **unknown** — not passing, not failing, unmeasured.
- **Root `npm run typecheck` is not a check.** There is no `tsconfig.json` and
  no input files, so `tsc --noEmit` prints its usage banner and exits 1 having
  examined zero files. It cannot pass and it cannot fail informatively:

  ```bash
  rm -rf /tmp/crew-root && mkdir -p /tmp/crew-root
  git -C "$REPO" archive HEAD | tar -x -C /tmp/crew-root
  cd /tmp/crew-root && npm install --ignore-scripts
  npm run typecheck > /tmp/tc.txt 2>&1; echo "exit=$?"
  grep -c 'error TS' /tmp/tc.txt        # → 0   (not "no errors" — no files)
  ```

  `exit=1` with **zero** `error TS` lines is the signature: it failed without
  looking at anything. Do not cite the banner's line count — it varies with the
  tsc version resolved.
- **Nothing was deployed and no live endpoint was called** beyond DNS and the
  `curl` in §9. `wrangler deploy` was not run: the routes point at hostnames
  that do not exist, and the actor descriptor is unresolvable.
- **`vertexId` was not traced.** All eight processes return it, nothing here
  produces it, and where it was meant to come from is outside this repository.

## §9 DNS and reachability

```bash
for h in air-crew.etzhayyim.com a1rcr3w0.etzhayyim.com \
         dispatcher.etzhayyim.com mcp.etzhayyim.com etzhayyim.com; do
  for ns in 1.1.1.1 8.8.8.8 9.9.9.9; do
    printf "%-28s @%-8s " "$h" "$ns"
    dig +short +time=3 +tries=1 @$ns "$h" A | tr '\n' ' '
    dig +noall +comments +time=3 +tries=1 @$ns "$h" A | grep -o 'status: [A-Z]*' | head -1
  done
done
```

Twelve NXDOMAIN for the four service names, `NOERROR` with two A records for
the apex, on all three resolvers. The zone is not broken:

```bash
dig +short NS etzhayyim.com @1.1.1.1
# → everton.ns.cloudflare.com. vivienne.ns.cloudflare.com.
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 12 https://etzhayyim.com/
# → 200
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 8 https://air-crew.etzhayyim.com/health
# → 000    (does not resolve)
```

Four missing labels under a healthy Cloudflare zone. Adding them is a DNS
change, not an outage to debug — but see §"Where to start" in the README before
adding any.

## §10 Leave the checkout clean

```bash
git -C "$REPO" -c core.fsmonitor=false status --short    # → (empty)
rm -rf /tmp/crew-build /tmp/crew-sdk /tmp/crew-dispatch
```
