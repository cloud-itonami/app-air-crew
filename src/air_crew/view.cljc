(ns air-crew.view
  "この appview の説明ページ。純 hiccup。

  基盤は `jp-go-dds`（デジタル庁デザインシステム）—— superproject の skill
  `kotoba-uiux` が定める新規 UI の base。色・寸法は `--hig-*` トークン契約で
  書き、raw hex も px フォントサイズも置かない。

  **表示する事実は引数で受け取る。ページの中に焼かない。**
  これは装飾の都合ではなく docs/adr/0001 が記録した欠陥そのものへの答えで
  ある —— 移行前のページは `routeCount: 0` と `vars: []` を literal で持って
  いて、隣の `wrangler.jsonc` が route 2・var 8 を宣言していることに気づけ
  なかった。ここでは route 表も env のキーも渡す側が持ち、ページは描くだけ
  なので、両者がずれる余地が無い。

  **env の値については「一切出さない」とは言わない。** 出しているものが 1 つ
  ある —— XRPC の中継先 URL である。どこへ要求が出て行くかは読めなければ
  ならないので意図的に出している。それ以外の env の値は出さない。この 2 つは
  smoke で別々の印（出てはいけない印／出なければいけない印）として検査する。"
  (:require [jp-go-dds.core :as dds]
            [jp-go-dds.page :as page]
            [jp-go-dds.tokens :as tokens]
            [clojure.string :as str]))

(def app-css
  "app 固有の最小 CSS。`--hig-*` 契約だけを使う（bridge が DADS の上に再定義
  する）。DADS を base にした app の下には `shitsuke.hig` が居ないので、bridge
  が運んでいないトークンは何にも解決しない —— 使うのは運ばれている 72 個の
  中だけ。"
  (str/join
   "\n"
   [".ac-lede { color: var(--hig-color-secondary-label); max-width: 42rem; }"
    ".ac-note { color: var(--hig-color-secondary-label); font-size: var(--hig-text-footnote-font-size); }"
    ".ac-mono { font-family: var(--hig-font-mono); overflow-wrap: anywhere; }"]))

(defn- route-rows [routes]
  (mapv (fn [r]
          [(str/upper-case (name (:route/method r)))
           [:span {:class "ac-mono"} (:route/path r)]
           (:route/doc r)])
        routes))

(defn body
  "opts:
   :routes    air-crew.route/routes（この Worker が実際に答えるもの）
   :vars      wrangler が渡した env のキー（**キーだけ**。値は出さない）
   :mcp-url   XRPC の中継先（route/mcp-router-url の戻り値。唯一出す env 由来の値）
   :built-at  bundle のビルド時刻（不明なら nil）"
  [{:keys [routes vars mcp-url built-at]}]
  (dds/container
   (dds/section
    {}
    (dds/heading 1 "Air Crew Management")
    [:p {:class "ac-lede"}
     "航空機の乗務員運用（roster / pairing / 資格 / 疲労 / 割当 / 移動 / "
     "勤務時間 / 通知）を扱う appview の公開面。判断そのものはここに無く、"
     "XRPC を MCP router へ中継する。"])

   (dds/section
    {:title "この面が答えるもの"}
    (dds/table {:caption "公開ルート"
                :headers ["METHOD" "PATH" "何をするか"]
                :rows (route-rows routes)})
    [:p {:class "ac-note"}
     "この表は Worker の route 表そのものから描いている。ページに焼いた値では"
     "ないので、実際に答えるものと表示がずれない。"])

   (dds/section
    {:title "実行時の設定"}
    (if (seq vars)
      [:div
       (into [:p] (interpose " " (map (fn [k] (dds/chip-label (name k))) vars)))
       [:p {:class "ac-note"}
        "キー名のみ。値は出さない —— ただし 1 つだけ例外があり、それが次の行"
        "である。"]]
      [:p {:class "ac-note"} "env が渡されていない（ローカル描画）。"])
    [:p {:class "ac-note"} "XRPC の中継先: "
     [:span {:class "ac-mono"} mcp-url]]
    [:p {:class "ac-note"}
     "中継先だけは値で出す。どこへ要求が出て行くかを読めなくすると、"
     "設定ミスが黙って通るからである。"])

   (dds/section
    {:title "現在地"}
    [:p {:class "ac-lede"}
     "この appview は TypeScript/Svelte から ClojureScript へ移行済み。"
     "deploy される bundle は、いま読んでいるソースからコンパイルされたもの"
     "である（docs/adr/0001）。"]
    [:p {:class "ac-note"}
     "呼び先のホストは移行時点でいずれも DNS を引けない。移行はそれを直さない。"]
    (when built-at
      [:p {:class "ac-note"} "bundle build: " built-at]))))

(defn render
  "完全な HTML 文書。`css` は呼び出し側が渡す（ライブラリは I/O を持たない）。"
  [{:keys [css] :as opts}]
  (page/->page
   {:title "Air Crew Management"
    :description "航空機の乗務員運用を扱う appview の公開面。XRPC を MCP router へ中継する。"
    :lang "ja"
    :css css
    :app-css (str tokens/bridge-css "\n" app-css)}
   (body opts)))
