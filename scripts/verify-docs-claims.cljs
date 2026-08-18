#!/usr/bin/env nbb
;; verify-docs-claims — re-derive every number README.md and docs/operator-quickstart.md
;; state, from the tree itself, and fail when the tree and the prose disagree.
;;
;; Before the cljs migration this file's load-bearing claim would have been a GAP:
;; the Worker that would be deployed was a SvelteKit build output NOT PRESENT IN THE
;; TREE, while src/app.ts -- the file that read like the application -- was in no
;; bundle at all. That gap is closed, so the claims assert the CLOSURE, and they are
;; written so the gap cannot quietly come back: the appview TypeScript is asserted
;; ABSENT BY NAME, not merely absent from a byte total.
;;
;; It also pins what was deliberately KEPT. kotoba/ is TypeScript that this migration
;; did not touch (it is in no bundle, referenced by no code, and its pinned git
;; dependencies do fetch -- measured, see README). Keeping it is a decision; letting
;; it grow silently afterwards is not. So its file count is a claim too.
;;
;; Usage:  nbb scripts/verify-docs-claims.cljs [<dir>]     (<dir> FIRST, default ".")
;; Exit:   0 every claim holds · 1 a claim is false · 2 could not answer

(require '["node:fs" :as fs]
         '["node:child_process" :as cp]
         '["node:crypto" :as crypto]
         '[cljs.reader :as edn]
         '[clojure.string :as str])

(def root (or (first (remove #(str/starts-with? % "--") *command-line-args*)) "."))

(def claims
  {:tracked-files 25
   :inherited-bytes 51772          ; the 11 inherited files still carried unchanged
   :svelte-artifacts 0             ; no .svelte / svelte.config / svelte-dir file survives
   :sveltekit-compat-flags 0       ; nodejs_compat / nodejs_als were adapter-cloudflare's
   :appview-ts-files 0             ; TypeScript outside kotoba/ -- the migration's subject
   :kotoba-ts-files 5              ; TypeScript deliberately KEPT (see README)
   :canonical-files 4              ; .cljc/.cljs production source (3 in src/, 1 in test/)
   :declared-vars 8
   :declared-routes 2
   :wrangler-main "dist/worker.js"
   :shadow-output-dir "dist"
   :shadow-export "air-crew.worker/handler"})

;; Inherited files this repository still carries BYTE-IDENTICAL.
;; wrangler.jsonc and migration.edn are deliberately NOT in this set: the migration
;; changed both on purpose (main/assets/compat-flags/APP_FRAMEWORK, and
;; :allowed-additions respectively). They are checked BY CONTENT below instead, so
;; an intentional change and an accidental one stay distinguishable.
(def preserved
  {"MIGRATION-TODO.md"            "048e99ad62b548174e869d3ea9a92c37edd3f0b16f9565f84b8f5ae291338d70"
   "NOTICE"                       "9d3bd5678f857c647a465987cd8538580215416648991fd9de47e6dc648544f0"
   "README.edn"                   "dd40da7f9b3f198ab8fc00691f858c2bef8400574a4d1b598dba169de067ea07"
   "kotodama.jsonld"              "249cfd73e7ba116524cb571faa61f5231da6e1269b8f43699c012eb219b85a09"
   "kotoba/package.json"          "d0945eff73a171a3d03e29097c4a03706b7ee005a096c610208c707b1ff76fe7"
   "kotoba/tsconfig.json"         "95a429e51d6162cb7205b603f745e7604d93ffbb1ea6c346e5c6215a79ae541e"
   "kotoba/vitest.config.ts"      "f82a551ef4da1c9cbf17985a3bee96eee450a3e4a46bff0d96c6150263121eff"
   "kotoba/src/index.ts"          "0250a50400f4ea68300b1e9ec16e7f34ec4b77c9a91a486b7835154664b6521c"
   "kotoba/src/registry.ts"       "b529f9cd4d5b510c92159be9003d7b3f705456c9abd5320171016361e603ddbd"
   "kotoba/src/types.ts"          "c6fd574cc44ae215e6260041405c8e06da9a90eafdcf7b556743f7c92e6fbd6e"
   "kotoba/test/air-crew.test.ts" "15e6ebdabf74f2356225bd2f1e1d6be5aa34a4fbb031ebcaa24256703c38d94d"})

;; What the migration REMOVED, by name. A byte total cannot say "the appview
;; TypeScript is gone"; this can, and it fails if any of it comes back.
(def removed-by-migration
  ["src/app.ts"
   "package.json"
   "svelte/package.json"
   "svelte/src/app.html"
   "svelte/src/routes/+page.svelte"
   "svelte/src/routes/xrpc/[...path]/+server.ts"
   "svelte/svelte.config.js"
   "svelte/tsconfig.json"
   "svelte/vite.config.ts"])

(def undetermined (atom []))
(def failures (atom []))
(defn undet! [m] (swap! undetermined conj m))

(defn tracked-files []
  (try (->> (.execSync cp "git ls-files" #js {:cwd root :encoding "utf8"})
            str/split-lines (remove str/blank?) vec)
       (catch :default e (undet! (str "git ls-files failed: " (.-message e))) nil)))
(defn slurp* [rel] (try (.readFileSync fs (str root "/" rel) "utf8") (catch :default _ nil)))
(defn bytes-of [rel] (try (.-size (.statSync fs (str root "/" rel))) (catch :default _ nil)))
(defn sha256 [rel]
  (try (-> (.createHash crypto "sha256")
           (.update (.readFileSync fs (str root "/" rel)))
           (.digest "hex"))
       (catch :default _ nil)))
(defn strip-jsonc [s] (str/replace s #"(?m)^\s*//.*$" ""))

(defn check! [label expected actual]
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" (name label)
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(let [files (tracked-files)]
  (when (nil? files) (println "UNDETERMINED\tcould not list tracked files") (js/process.exit 2))
  ;; evidence floor: a scan of nothing is not a clean scan
  (println (str "SCANNED\t" (count files)))
  (when (zero? (count files)) (println "UNDETERMINED\tscanned 0 files") (js/process.exit 2))

  (let [sizes (into {} (map (juxt identity bytes-of)) files)]
    (when-let [bad (seq (keep (fn [[f s]] (when (nil? s) f)) sizes))]
      (undet! (str "tracked but unreadable: " (str/join ", " bad))))

    (check! :tracked-files (:tracked-files claims) (count files))
    (check! :inherited-bytes (:inherited-bytes claims)
            (reduce + 0 (keep #(get sizes %) (keys preserved))))
    ;; byte-identity, not mere presence. An inherited file that was edited is a
    ;; different failure from one that was deleted, and both must be visible.
    (check! :preserved-files-unchanged []
            (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                        (when-not (= want got) (str f " " (or got "MISSING")))))
                       preserved)))

    ;; the appview TypeScript is gone, by name
    (check! :removed-by-migration-absent []
            (vec (filter #(some? (bytes-of %)) removed-by-migration)))

    ;; Svelte is gone and must not come back. removed-by-migration names the files;
    ;; this catches a return under ANY name -- a new .svelte file, a svelte.config,
    ;; or anything under a svelte/ directory.
    (check! :svelte-artifacts (:svelte-artifacts claims)
            (count (filter #(or (str/ends-with? % ".svelte")
                                (str/includes? % "svelte.config")
                                (str/includes? % "svelte/"))
                           files)))

    ;; The two language counts the migration is actually about. Splitting them is the
    ;; point: "TypeScript in this repo" is the WRONG number, because kotoba/ was
    ;; measured alive and deliberately kept. What must stay at zero is the APPVIEW's
    ;; TypeScript; what must not GROW is kotoba's.
    (let [prod (remove #(str/starts-with? % "scripts/") files)
          ts (filter #(str/ends-with? % ".ts") prod)]
      (check! :appview-ts-files (:appview-ts-files claims)
              (count (remove #(str/starts-with? % "kotoba/") ts)))
      (check! :kotoba-ts-files (:kotoba-ts-files claims)
              (count (filter #(str/starts-with? % "kotoba/") ts)))
      (check! :canonical-files (:canonical-files claims)
              (count (filter #(re-find #"\.(cljs|cljc|clj|kotoba)$" %) prod))))

    ;; the deployed bundle is built from the source in this tree
    (let [w (some-> (slurp* "wrangler.jsonc") strip-jsonc)
          sh (slurp* "shadow-cljs.edn")]
      (if (or (nil? w) (nil? sh))
        (undet! "wrangler.jsonc or shadow-cljs.edn unreadable")
        (let [j (js->clj (.parse js/JSON w) :keywordize-keys false)]
          (check! :wrangler-main (:wrangler-main claims) (get j "main"))
          (check! :declared-vars (:declared-vars claims) (count (get j "vars")))
          (check! :declared-routes (:declared-routes claims) (count (get j "routes")))
          ;; the old config served a SvelteKit client dir that no longer exists
          (check! :no-stale-assets-binding true (nil? (get j "assets")))
          (check! :sveltekit-compat-flags (:sveltekit-compat-flags claims)
                  (count (filter #{"nodejs_compat" "nodejs_als"}
                                 (or (get j "compatibility_flags") []))))
          (check! :app-framework-not-sveltekit true
                  (not (str/includes? (str (get-in j ["vars" "APP_FRAMEWORK"])) "svelte")))

          ;; shadow's output dir, wrangler's main and the exported ns must mesh
          (let [conf (try (edn/read-string sh) (catch :default e (undet! (str "shadow-cljs.edn is not readable EDN: " (.-message e))) nil))
                build (get-in conf [:builds :worker])]
            (if (nil? build)
              (undet! "shadow-cljs.edn has no :builds :worker")
              (do
                (check! :shadow-builds-that-main true
                        (and (= (:output-dir build) (:shadow-output-dir claims))
                             (= (str (get-in build [:modules :worker :exports 'default]))
                                (:shadow-export claims))
                             (= (get j "main")
                                (str (:shadow-output-dir claims) "/worker.js"))))

                ;; :warnings-as-errors must be INSIDE :compiler-options.
                ;;
                ;; This is PARSED, never grepped. shadow-cljs treats an undeclared or
                ;; renamed var as a warning and exits 0, shipping a bundle that throws
                ;; on its first request -- so the key is what makes a green build mean
                ;; anything. Measured 2026-08-18 on this repo with one identical broken
                ;; source: under :compiler-options the build exits 1; under
                ;; :build-options it exits 0 and prints "1 warnings". shadow ignores it
                ;; there SILENTLY, which makes the misplaced key a check that cannot
                ;; fail -- worse than no key, because it reads as present.
                ;;
                ;; grep cannot tell those two trees apart, and worse: the comment at the
                ;; top of shadow-cljs.edn CONTAINS BOTH STRINGS, so a grep-based check
                ;; passes on the prose alone.
                (check! :warnings-as-errors-in-compiler-options true
                        (true? (get-in build [:compiler-options :warnings-as-errors])))
                (check! :warnings-as-errors-not-misplaced true
                        (nil? (get-in build [:build-options :warnings-as-errors])))))))))

    ;; migration.edn must still account for every file that is not inherited --
    ;; that field is what keeps the provenance check in the quickstart meaningful.
    (let [m (some-> (slurp* "migration.edn") edn/read-string)]
      (if (nil? m)
        (undet! "migration.edn unreadable")
        (let [declared (set (get-in m [:identity :allowed-additions]))
              inherited-count (- (count files) (count declared))]
          (check! :allowed-additions-match-tree []
                  (vec (sort (remove #(contains? declared %)
                                     (concat (filter #(str/starts-with? % "src/air_crew/") files)
                                             (filter #(str/starts-with? % "test/") files)
                                             (filter #(str/starts-with? % "scripts/") files)
                                             (filter #(str/starts-with? % "docs/adr/") files)
                                             ["deps.edn" "shadow-cljs.edn" ".gitignore"])))))
          (check! :inherited-file-count (count preserved) inherited-count))))

    ;; The page renders the route TABLE rather than a baked count -- the defect this
    ;; migration exists to kill was a literal `routeCount: 0` beside a config declaring
    ;; two. Asserted structurally (the view takes :routes, the worker passes the real
    ;; table) and NOT by forbidding a substring: a check that a docstring can fail is a
    ;; check about prose.
    (let [v (slurp* "src/air_crew/view.cljc")
          w (slurp* "src/air_crew/worker.cljs")]
      (if (or (nil? v) (nil? w))
        (undet! "view.cljc or worker.cljs unreadable")
        (do
          (check! :page-renders-route-table true
                  (and (str/includes? v "[{:keys [routes vars mcp-url built-at]}]")
                       (str/includes? v "(route-rows routes)")
                       (str/includes? w ":routes route/routes")))
          ;; and it is handed env KEYS, not env values
          (check! :page-is-handed-env-keys true
                  (str/includes? w ":vars (sort (keys e))")))))))

(let [u @undetermined f @failures]
  (when (seq u)
    (doseq [m u] (println (str "UNDETERMINED\t" m)))
    (println "Refusing to report a pass: the tree could not be read completely.")
    (js/process.exit 2))
  (if (seq f)
    (do (println (str "FAILED\t" (count f) " claim(s): " (str/join ", " (map name f))))
        (js/process.exit 1))
    (do (println "OK\tevery claim in README.md and docs/operator-quickstart.md holds")
        (js/process.exit 0))))
