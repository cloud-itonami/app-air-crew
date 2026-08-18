(ns air-crew.route-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.string :as str]
            [air-crew.route :as route]
            [air-crew.view :as view]))

(deftest dispatch-page-and-health
  (is (= :page (:action (route/dispatch "GET" "/"))))
  (is (= :health (:action (route/dispatch "GET" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/"))))
  (is (= :not-found (:action (route/dispatch "GET" "/nope")))))

(deftest dispatch-xrpc
  (testing "単一セグメントの nsid"
    (is (= {:action :xrpc :nsid "com.etzhayyim.apps.airCrew.publishRoster"}
           (route/dispatch "POST" "/xrpc/com.etzhayyim.apps.airCrew.publishRoster"))))
  (testing "空だけが 400。多段は移行前と同じく転送する（絞るのは方針変更）"
    (is (= :bad-request (:action (route/dispatch "POST" "/xrpc/"))))
    (is (= {:action :xrpc :nsid "a/b"} (route/dispatch "POST" "/xrpc/a/b"))))
  (testing "preflight と method"
    (is (= :cors-preflight (:action (route/dispatch "OPTIONS" "/xrpc/x"))))
    (is (= :method-not-allowed (:action (route/dispatch "GET" "/xrpc/x"))))))

(deftest mcp-url-resolution
  (is (= "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"
         (route/mcp-router-url {})))
  (is (= "https://a.example/x"
         (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "https://a.example/x/"})))
  (testing "空白だけの設定は未設定として扱う（移行前の +server.ts と同じ）"
    (is (= "https://b.example"
           (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "   "
                                  :MCP_ROUTER_URL "https://b.example"})))))

(deftest forwarded-headers
  (let [out (route/forward-headers
             {"host" "air-crew.etzhayyim.com"
              "authorization" "Bearer tok"
              "content-length" "17"
              "content-type" "text/plain"
              "x-caller" "keep-me"}
             "com.x.y")]
    (testing "呼び手の資格は落とさない"
      (is (= "Bearer tok" (get out "authorization")))
      (is (= "keep-me" (get out "x-caller"))))
    (testing "封筒に包み直すので entity/hop-by-hop は落とす"
      (is (nil? (get out "host")))
      (is (nil? (get out "content-length"))))
    (testing "経路の名乗りと nsid を付ける"
      (is (= "application/json" (get out "content-type")))
      (is (= "cljs-worker" (get out "x-etzhayyim-bff")))
      (is (= "com.x.y" (get out "x-etzhayyim-xrpc-method"))))))

(deftest envelope
  (is (= {:jsonrpc "2.0" :id "id-1" :method "tools/call"
          :params {:name "com.x.y" :arguments {:a 1}}}
         (route/mcp-envelope "com.x.y" {:a 1} "id-1")))
  (testing "入力が無いときは空 map（移行前は catch(() => ({})) だった）"
    (is (= {} (get-in (route/mcp-envelope "com.x.y" nil "id-1") [:params :arguments])))))

(deftest unwrap
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:structuredContent {:a 1}}})))
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:a 1}})))
  (is (false? (:ok? (route/unwrap-mcp {:error {:message "boom"}})))))

(deftest page-shows-the-real-routes
  (testing "ページは route 表から描く。0 を焼かない（docs/adr/0001 の欠陥）"
    (let [html (view/render {:css "/*x*/" :routes route/routes
                             :vars [:APP_NANOID :APP_UI_TYPE]
                             :mcp-url "https://mcp.example/x"})]
      (doseq [r route/routes]
        (is (str/includes? html (:route/path r))
            (str (:route/path r) " がページに出ていない")))
      (is (str/includes? html "APP_NANOID"))
      (is (str/includes? html "https://mcp.example/x"))
      (is (not (str/includes? html "No public route is declared"))))))

(deftest page-uses-the-design-system-and-the-token-contract
  (let [html (view/render {:css "/*x*/" :routes route/routes :vars [] :mcp-url "u"})]
    (testing "component used —— view が library を呼んだこと（markup の話）"
      (is (str/includes? html "dads-table"))
      (is (str/includes? html "dads-heading")))
    (testing "stylesheet inlined —— CSS が実際に入ったこと（markup では言えない）"
      ;; `dads-table` は :css \"\" で描いても markup に残る（実測 74 → 6）ので、
      ;; それを「design system が在る」の根拠にすると落ちない検査になる。
      ;; `--color-primitive-blue` は dds.css にしか無い（実測 45 → 0）。
      (let [with-css (view/render {:css "--color-primitive-blue: #06c;" :routes route/routes
                                   :vars [] :mcp-url "u"})]
        (is (str/includes? with-css "--color-primitive-blue"))
        (is (not (str/includes? html "--color-primitive-blue")))))
    (testing "app 固有 CSS に raw hex も raw な色関数も px フォントサイズも置かない"
      ;; raw hex だけを禁じても足りない。実測: `--hig-color-secondary-label` を
      ;; `rgba(150,166,184,1)` に置き換えても design-quality の score は 100.00 の
      ;; まま PASS した（CLI は contrast 軸を採点しない）。トークン契約が保たれて
      ;; いるという主張は score のものではなく、この検査のものである。
      (is (nil? (re-find #"#[0-9a-fA-F]{3,8}\b" view/app-css)))
      (is (nil? (re-find #"\b(rgba?|hsla?|color-mix)\s*\(" view/app-css)))
      (is (nil? (re-find #"font-size:\s*\d+px" view/app-css))))))
