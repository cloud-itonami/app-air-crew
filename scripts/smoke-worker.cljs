#!/usr/bin/env nbb
;; smoke-worker — 実際にビルドされた bundle を import して叩く。
;;
;; ここが「deploy される成果物」に触る唯一の検査である。テスト
;; (test/air_crew/route_test.cljc) はソースの判断を固定するが、bundle が
;; 本当に Worker の形で答えるかは言えない —— export の形、shadow の
;; :advanced-optimization、`shadow.resource/inline` で焼いた CSS は、
;; どれもビルドを通って初めて存在する。
;;
;; Usage:  nbb scripts/smoke-worker.cljs [<dist/worker.js>]
;; Exit:   0 全て期待どおり · 1 期待と違う · 2 判定できなかった（bundle が無い等）

(require '["node:fs" :as fs] '["node:path" :as path] '["node:url" :as url]
         '[clojure.string :as str])

(def bundle
  "ESM の import は相対パスを package 名と読むので、必ず絶対パスに直してから
  file:// URL にする（`dist/worker.js` をそのまま渡すと『Cannot find package
  dist』になる。実測）。"
  (let [a (first (remove #(str/starts-with? % "--") *command-line-args*))]
    (.resolve path (or a "dist/worker.js"))))

(def failures (atom []))
(defn check! [label expected actual]
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" label
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(when-not (.existsSync fs bundle)
  (println (str "UNDETERMINED\tno bundle at " bundle))
  (println "Refusing to report a pass: build it first (see docs/operator-quickstart.md S5).")
  (js/process.exit 2))

;; ── 二つの独立した印 ────────────────────────────────────────────────
;;
;; 印を 1 つしか置かないと、その 1 つがどちらの向きにも嘘をつける。「値は
;; 出さない」だけを見る検査は**何も描かないページ**でも通り、「値が出る」
;; だけを見る検査は**全部を漏らすページ**でも通る。だから 2 つ置く:
;;
;;   HIDDEN  env の値。ページに現れては **いけない**
;;   SHOWN   XRPC の中継先。ページに現れ **なければならない**（意図的に出して
;;           いる唯一の env 由来の値。どこへ要求が出て行くかは読めるべき）
;;
;; 実在しそうな値（"yoro" 等）を印にしない —— 他の文言と偶然一致しうるし、
;; 引用符ごと探すと renderer が " を &quot; に escape するので**決して一致
;; しない**、つまり検査が構造的に落ちなくなる。
(def hidden-sentinel "HIDDEN-SENTINEL-4f7b1e")
(def shown-sentinel "SHOWN-SENTINEL-a2c9d0")

(def router-url
  "`.invalid` は RFC 2606 が予約した、**決して解決しない** TLD である。
  中継先をここに向けておくと、上流未到達の経路を実 DNS に依存せずに
  踏める —— `mcp.etzhayyim.com` が今 NXDOMAIN であることに寄りかからない。"
  (str "https://router-" shown-sentinel ".invalid/xrpc/com.etzhayyim.mcp.message"))

(def env #js {"APP_NANOID" "a1rcr3w0"
              "APP_UI_TYPE" hidden-sentinel
              "AGENTGATEWAY_MCP_ROUTER_URL" router-url})

(defn- call [h method path]
  (let [req (js/Request. (str "https://air-crew.etzhayyim.com" path) #js {:method method})]
    (-> (js/Promise.resolve ((.-fetch h) req env #js {}))
        (.then (fn [res] (-> (.text res)
                             (.then (fn [body] {:status (.-status res)
                                                :ct (.get (.-headers res) "content-type")
                                                :body body}))))))))

(-> (js/import (.-href (.pathToFileURL url bundle)))
    (.then
     (fn [m]
       (let [h (.-default m)]
         (check! "default export has fetch" true (fn? (.-fetch h)))
         (-> (js/Promise.all
              #js [(call h "GET" "/") (call h "GET" "/health")
                   (call h "POST" "/xrpc/") (call h "OPTIONS" "/xrpc/x")
                   (call h "GET" "/nope") (call h "POST" "/health")
                   (call h "POST" "/xrpc/com.etzhayyim.apps.airCrew.publishRoster")
                   (call h "POST" "/xrpc/a/b")])
             (.then
              (fn [[page health bad pre nf mna one multi]]
                (check! "GET / status" 200 (:status page))
                (check! "GET / is html" true (str/includes? (or (:ct page) "") "text/html"))

                ;; ページは route 表から描かれる。表にある path が全部出ていること。
                (doseq [p ["/" "/health" "/xrpc/:nsid" "/xrpc/*"]]
                  (check! (str "page advertises " p) true (str/includes? (:body page) p)))

                ;; 印を 2 つとも見る（片方だけでは両方向の嘘を通す）
                (check! "page shows a var KEY" true (str/includes? (:body page) "APP_UI_TYPE"))
                (check! "page hides var VALUES (hidden sentinel)" false
                        (str/includes? (:body page) hidden-sentinel))
                (check! "page shows the router destination (shown sentinel)" true
                        (str/includes? (:body page) shown-sentinel))

                ;; ここは **2 つに分ける**。1 つにまとめると落ちない検査になる。
                ;;
                ;;   (a) component used   —— view が library を呼んだか
                ;;   (b) stylesheet inlined —— CSS が実際に bundle へ焼かれたか
                ;;
                ;; `dads-table` は view が出す **markup** なので、CSS が 1 バイトも
                ;; 入っていなくてもページに在る。実測（同じ view を :css "" で描画）:
                ;; `dads-table` は **74 → 6** で 0 にならない —— つまりこれを
                ;; 「design system が在る」の根拠にすると**落ちない検査**になる。
                ;; `--color-primitive-blue` は dds.css にしか無く、markup には
                ;; 現れない: **45 → 0**。区別できるのはこちらだけ。
                (check! "design system: component used (dads-table in markup)" true
                        (str/includes? (:body page) "dads-table"))
                (check! "design system: stylesheet actually inlined (--color-primitive-blue)" true
                        (str/includes? (:body page) "--color-primitive-blue"))

                (check! "GET /health status" 200 (:status health))
                (check! "health names its routes" true
                        (str/includes? (:body health) "/xrpc/:nsid"))

                ;; nsid 無しの XRPC だけが 400。前方一致で素通ししない
                (check! "POST /xrpc/ status" 400 (:status bad))
                (check! "OPTIONS preflight" 204 (:status pre))
                (check! "unknown path" 404 (:status nf))
                (check! "wrong method" 405 (:status mna))

                ;; 多段パスは移行前の rest parameter と同じく転送する。
                ;; **単一セグメントと同一に扱われること**を、同じ `.invalid` の
                ;; 中継先に対して比べる —— 絶対値ではなく同値性を見るので、
                ;; 上流の実在にも DNS にも依存しない。
                (check! "single-segment xrpc is relayed (unreachable upstream -> 502)"
                        502 (:status one))
                (check! "multi-segment xrpc is treated the SAME as single-segment"
                        (:status one) (:status multi))
                (check! "unreachable upstream is not hidden as success" true
                        (str/includes? (:body multi) "MCP router unreachable"))

                (let [f @failures]
                  (if (seq f)
                    (do (println (str "FAILED\t" (count f) " check(s): " (str/join ", " f)))
                        (js/process.exit 1))
                    (do (println "OK\tthe built bundle answers as the route table says")
                        (js/process.exit 0))))))))))
    (.catch (fn [e]
              (println (str "UNDETERMINED\tcould not exercise the bundle: " (.-message e)))
              (js/process.exit 2))))
