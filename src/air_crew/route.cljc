(ns air-crew.route
  "どのハンドラが要求に答えるか —— データとして持ち、純関数で決める。

  `.cljs` ではなく `.cljc` なのは意図的である。edge worker のうち検査する
  価値があるのは routing であり、ここならブラウザもビルドもネットワークも
  無しに検査できる。Request/Response に触るのは `air-crew.worker` だけで、
  そこはこのファイルが既に決めたことしかしない。

  ingress capability が qualify した時（`:native-aot`/`:wasm-aot` は今日とも
  pending —— ADR-2606290000）に最初に `.kotoba` へ移るのもここである。
  route 表はスカラと文字列に対する判断であり、それはその移行を生き延びる形
  そのものだからである。"
  (:require [clojure.string :as str]))

(def routes
  "公開面をデータとして持つ。**説明ページはこれを描く。**

  移行前のページは `routeCount: 0` と `vars: []` を literal で持っていて、
  同じディレクトリの `wrangler.jsonc` が route 2 / var 8 を宣言している
  ことに気づけなかった（docs/adr/0001 が測って記録した欠陥）。route 表を
  渡す側が持ち、ページは描くだけにすると、両者がずれる余地が構造的に無い。"
  [{:route/path "/"           :route/method :get     :route/kind :page
    :route/doc "この appview の説明ページ"}
   {:route/path "/health"     :route/method :get     :route/kind :json
    :route/doc "生存確認。deploy された面が答えることを外から確かめられる"}
   {:route/path "/xrpc/:nsid" :route/method :post    :route/kind :proxy
    :route/doc "XRPC を MCP router へ中継する"}
   {:route/path "/xrpc/*"     :route/method :options :route/kind :cors
    :route/doc "CORS preflight"}])

(defn- xrpc-nsid
  "`/xrpc/<nsid>` の nsid。**空文字だけが nil。**

  多段パス（`/xrpc/a/b`）も通す。移行前に deploy されていた SvelteKit route は
  rest parameter `[...path]` で受けており、`a/b` をそのまま tool 名として
  MCP router へ転送していた。ここで 1 セグメントに絞ると挙動が変わる ——
  NSID に `/` は現れないので上流で失敗するだけだが、**失敗の起きる場所と
  応答が変わる。それは移行ではなく方針変更**であり、移行の commit に紛れ
  込ませるものではない。絞るなら別の決定として記録する。

  同型の移行（cloud-itonami/app-lo、app-ongakuka）で先にこの区別が正しく
  行われており、こちらを合わせた。"
  [path]
  (when (str/starts-with? path "/xrpc/")
    (let [rest' (subs path (count "/xrpc/"))]
      (when (seq rest') rest'))))

(defn dispatch
  "method + path → 何をするか。Request も Response も知らない。

  返すのは `{:action …}` で、`:action` は
  `:page` / `:health` / `:xrpc` / `:cors-preflight` / `:not-found` /
  `:method-not-allowed` / `:bad-request` のいずれか。"
  [method path]
  (let [m (keyword (str/lower-case (or method "get")))
        p (or path "")]
    (cond
      (and (= m :options) (str/starts-with? p "/xrpc/"))
      {:action :cors-preflight}

      (str/starts-with? p "/xrpc/")
      (if (= m :post)
        (if-let [nsid (xrpc-nsid p)]
          {:action :xrpc :nsid nsid}
          {:action :bad-request :reason "Missing XRPC method"})
        {:action :method-not-allowed :allow "POST, OPTIONS"})

      (= p "/health") (if (= m :get)
                        {:action :health}
                        {:action :method-not-allowed :allow "GET"})
      (= p "/")       (if (= m :get)
                        {:action :page}
                        {:action :method-not-allowed :allow "GET"})
      :else {:action :not-found})))

(defn mcp-router-url
  "env の設定 → MCP router の URL。末尾スラッシュは落とす。

  既定値をここに焼くのは、設定が無いときに黙って何処かへ POST しないため
  ではなく、**どこへ行くのかを 1 箇所で読めるようにする**ため。移行前の
  `+server.ts` と同じ優先順位（AGENTGATEWAY → MCP_ROUTER → 既定）で、
  空白だけの設定は未設定として扱うところまで同じである。"
  [{:keys [AGENTGATEWAY_MCP_ROUTER_URL MCP_ROUTER_URL]}]
  (let [pick (fn [s] (when (and (string? s) (seq (str/trim s))) (str/trim s)))]
    (-> (or (pick AGENTGATEWAY_MCP_ROUTER_URL)
            (pick MCP_ROUTER_URL)
            "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message")
        (str/replace #"/+$" ""))))

(def ^:private hop-by-hop
  "上流へ持って行ってはいけないヘッダ。

  移行前の `+server.ts` は `host` だけを落として残りを丸ごと転送していた。
  それは `content-length` を**元の要求のもの**のまま新しい本文に付けて送る
  ということで、封筒に包み直して長さが変わる以上、正しくない。ここでは
  entity/hop-by-hop ヘッダを落とす —— `authorization` のような**呼び手の
  資格**は落とさない。落とすと XRPC の認証が黙って通らなくなる。"
  #{"host" "content-length" "content-encoding" "transfer-encoding"
    "connection" "keep-alive" "upgrade" "expect" "te" "trailer"})

(defn forward-headers
  "呼び手のヘッダ（小文字キーの map）→ 上流へ送るヘッダ。

  `nsid` は `x-etzhayyim-xrpc-method` として付ける（移行前と同じ）。
  `x-etzhayyim-bff` は経路の名乗りで、移行前は `sveltekit-edge-bff` だった
  ものを `cljs-worker` に変えている —— 名乗りが実態と食い違わないようにする
  ためで、上流はこの値で分岐しない。"
  [incoming nsid]
  (-> (into {} (remove (fn [[k _]] (contains? hop-by-hop (str/lower-case (name k)))))
            incoming)
      (assoc "content-type" "application/json"
             "x-etzhayyim-bff" "cljs-worker"
             "x-etzhayyim-xrpc-method" nsid)))

(defn mcp-envelope
  "呼び手の入力 → MCP router に送る JSON-RPC の封筒。移行前と同じ形。

  `id` は呼び出し側が渡す（`crypto.randomUUID` は effect なので、判断の側
  では作らない）。"
  [nsid input id]
  {:jsonrpc "2.0" :id id :method "tools/call"
   :params {:name nsid :arguments (or input {})}})

(defn unwrap-mcp
  "MCP router の応答から、呼び手に返す値を取り出す。

  `{:result {:structuredContent X}}` → X、`{:result X}` → X、それ以外は素通し。
  `{:error …}` は呼び出し側が 502 にするので、ここでは判定だけ返す。"
  [payload]
  (cond
    (and (map? payload) (contains? payload :error))
    {:ok? false
     :error (get-in payload [:error :message] "MCP router returned an error")
     :upstream payload}

    (and (map? payload) (contains? payload :result))
    (let [r (:result payload)]
      {:ok? true :value (if (and (map? r) (contains? r :structuredContent))
                          (:structuredContent r)
                          r)})

    :else {:ok? true :value payload}))
