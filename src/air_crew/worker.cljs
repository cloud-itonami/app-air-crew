(ns air-crew.worker
  "Cloudflare Worker の入口。**この repo で唯一 Request/Response に触る層。**

  ここには判断を置かない —— どのハンドラが答えるかは `air-crew.route/dispatch`
  が決め、上流へ送るヘッダは `route/forward-headers`、封筒は
  `route/mcp-envelope`、応答の剥がし方は `route/unwrap-mcp` が決める。
  ページの中身は `air-crew.view` が組む。どれも `.cljc` なので、ブラウザも
  ビルドも無しに検査できる。

  `wrangler.jsonc` の `main` は `dist/worker.js` を指し、それはこの名前空間を
  コンパイルしたものである。移行前は SvelteKit のビルド出力を指していて、
  読み手が開く TypeScript はどの bundle にも入っていなかった（docs/adr/0001）。

  env に bracket 記法（`aget`）で触るのは `:advanced-optimization` 下でキーが
  潰れないため（先例 `listingops.edge.worker` と同じ約束）。"
  (:require [air-crew.route :as route]
            [air-crew.view :as view]
            [shadow.resource :as rc]
            [clojure.string :as str]))

(def ^:private dds-css
  "DADS の CSS はビルド時に bundle へ焼く。外部リクエストゼロが design system
  の方針で、Worker から resource を読む経路も無い。"
  (rc/inline "jp_go_dds/dds.css"))

(defn- ->response [body {:keys [status content-type cache extra]}]
  (js/Response.
   body
   #js {:status status
        :headers (clj->js (merge {"content-type" content-type
                                  "cache-control" (or cache "no-store")}
                                 extra))}))

(defn- json [body status]
  (->response (js/JSON.stringify (clj->js body))
              {:status status :content-type "application/json; charset=utf-8"}))

(defn- env->map
  "env の **キーだけ** を keyword で拾う。値はここでしか読まない。"
  [env]
  (if env
    (into {} (map (fn [k] [(keyword k) (aget env k)])) (js/Object.keys env))
    {}))

(defn- headers->map
  "Headers → 小文字キーの clj map。`forward-headers` が判断できる形にする。"
  [headers]
  (let [acc (atom {})]
    (when headers
      (.forEach headers (fn [v k] (swap! acc assoc (str/lower-case k) v))))
    @acc))

(defn- cors-headers []
  {"access-control-allow-origin" "*"
   "access-control-allow-methods" "POST,OPTIONS"
   "access-control-allow-headers" "content-type,authorization"
   "access-control-max-age" "86400"})

(defn- proxy-xrpc
  "XRPC を MCP router へ中継する。移行前に deploy されていた SvelteKit route と
  同じ形（jsonrpc の封筒に包み、result / structuredContent を剥がす）。"
  [req env nsid]
  (let [url (route/mcp-router-url (env->map env))
        out-headers (route/forward-headers (headers->map (.-headers req)) nsid)]
    (-> (.json req)
        (.catch (fn [_] #js {}))
        (.then
         (fn [input]
           (js/fetch url
                     #js {:method "POST"
                          :headers (clj->js out-headers)
                          :body (js/JSON.stringify
                                 (clj->js
                                  (route/mcp-envelope
                                   nsid
                                   (js->clj input :keywordize-keys true)
                                   (.randomUUID js/crypto))))})))
        (.then (fn [resp]
                 (-> (.text resp)
                     (.then (fn [text]
                              (let [payload (try (when (seq text) (js/JSON.parse text))
                                                 (catch :default _ text))
                                    clj-payload (js->clj payload :keywordize-keys true)]
                                (if-not (.-ok resp)
                                  (json {:error "MCP router request failed"
                                         :upstream clj-payload}
                                        (.-status resp))
                                  (let [{:keys [ok? value error upstream]}
                                        (route/unwrap-mcp clj-payload)]
                                    (if ok?
                                      (json (or value {}) 200)
                                      (json {:error error :upstream upstream} 502))))))))))
        (.catch (fn [e]
                  ;; 到達できなかったことを 200 で隠さない。移行時点で
                  ;; mcp.etzhayyim.com は NXDOMAIN なので、これは想像上の
                  ;; 経路ではなく今日の既定の結末である。
                  (json {:error "MCP router unreachable"
                         :detail (str (.-message e))
                         :url url}
                        502))))))

(defn- page-response [env]
  (let [e (env->map env)]
    (->response
     (view/render {:css dds-css
                   :routes route/routes
                   :vars (sort (keys e))
                   :mcp-url (route/mcp-router-url e)
                   :built-at nil})
     {:status 200
      :content-type "text/html; charset=utf-8"
      :cache "public, max-age=60"})))

(defn fetch-handler [req env _ctx]
  (let [url (js/URL. (.-url req))
        path (.-pathname url)
        {:keys [action nsid allow reason]} (route/dispatch (.-method req) path)]
    (case action
      :page   (page-response env)
      :health (json {:ok true :app "air-crew" :runtime "cljs"
                     :routes (mapv :route/path route/routes)}
                    200)
      :xrpc   (proxy-xrpc req env nsid)
      :cors-preflight (->response nil {:status 204
                                       :content-type "text/plain"
                                       :extra (cors-headers)})
      :bad-request (json {:error reason} 400)
      :method-not-allowed (->response (js/JSON.stringify #js {:error "Method Not Allowed"})
                                      {:status 405
                                       :content-type "application/json; charset=utf-8"
                                       :extra {"allow" allow}})
      (json {:error "Not Found"
             :routes (mapv (fn [r] (str (str/upper-case (name (:route/method r)))
                                        " " (:route/path r)))
                           route/routes)}
            404))))

(def handler #js {:fetch fetch-handler})
