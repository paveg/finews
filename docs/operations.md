# Manual Operations Runbook

コードでは完結しない手動作業をまとめる。**自動化できないか、自動化すべきでないもの**(認証、外部サービスへの初回設定、人間の判断が要るもの)が対象。

Phase 1.5 以降で手順が増えたら、このファイルの末尾に追記する。

---

## 1. 初回デプロイ(Phase 1 リリース時、1 度だけ)

順番に実行。各ステップが完了するまで次へ進まない。

### Step 1: Anthropic Console で月予算を設定 (ADR-0006 Layer 1) — **最初に必ず**

ブラウザで <https://console.anthropic.com/settings/billing> を開く。

- [ ] **Monthly spend limit** を **$20 USD** に設定
- [ ] **Usage alerts** で **50%** と **80%** を有効化(email 通知)
- [ ] 画面で "$20.00 / month" 表記を確認

> **なぜ最初に**: コード側の budget guard(Task 6.5)が全て失敗しても月 $20 を超えない最後の砦。API key 発行より先に設定することで、設定忘れを防げる。

### Step 2: Anthropic API key を発行

- [ ] <https://console.anthropic.com/settings/keys> で "Create Key"
- [ ] Key 名: `finews-prod`(他と混同しないため)
- [ ] 表示された `sk-ant-...` をその場でコピー(一度しか表示されない)
- [ ] **ローカル開発用に別 key を分けたい場合**: 同手順で `finews-dev` も作成、別の $5 月予算を設定

### Step 3: Discord Webhook URL を発行

- [ ] 配信したいチャネルの設定 → 連携サービス → ウェブフック → 新しいウェブフック
- [ ] 名前: `finews`(任意)
- [ ] 表示された `https://discord.com/api/webhooks/...` をコピー

### Step 4: 本番 D1 にマイグレーションを適用

```bash
cd /Users/ryota/repos/github.com/paveg/finews/apps/worker
pnpm db:migrate:remote
```

- [ ] 出力で `0000_sparkling_legion.sql ✅` を確認
- [ ] エラーが出た場合は `pnpm wrangler d1 list` で `finews` の database_id が `wrangler.toml` と一致するか確認

> Worker 本体のデプロイには依存しない(D1 database 自体は `wrangler d1 create` 済み)。先に schema を整えておくと、Step 5 でデプロイした Worker が初回 cron で即動ける。

### Step 5: 本番デプロイ

```bash
cd /Users/ryota/repos/github.com/paveg/finews/apps/worker
pnpm run deploy
```

- [ ] 出力に `https://finews.<account>.workers.dev` が表示されることを確認
- [ ] Cloudflare Dashboard → Workers & Pages → finews が `Active` 表示

> **`pnpm deploy` ではなく `pnpm run deploy`**: pnpm の `deploy` は built-in workspace コマンドで、`run` を省略するとそちらが呼ばれて `ERR_PNPM_NOTHING_TO_DEPLOY` になる。
>
> **secrets は deploy より前でも後でも OK**: wrangler 4 は secret put 時に Worker 未作成だと対話的に "create a new Worker?" と聞いてくれて、Yes で skeleton を作成する。順序の安全性は気にしなくてよい(現行 runbook は migrate → deploy → secrets の順で揃えてある)。

### Step 6: シークレットを Workers に登録

ターミナルで:

```bash
cd /Users/ryota/repos/github.com/paveg/finews/apps/worker
pnpm wrangler secret put ANTHROPIC_API_KEY
# プロンプトに sk-ant-... を貼って Enter(echo されない)
pnpm wrangler secret put DISCORD_WEBHOOK_URL
# プロンプトに https://discord.com/api/webhooks/... を貼って Enter
```

- [ ] 両方とも "Success" 表示を確認
- [ ] Dashboard → Workers → finews → Settings → Variables and Secrets に 2 件登録されていることを確認

> Cron は平日 21:30 UTC(JST 6:30)に発火するので、deploy 直後に secrets を入れれば次の cron 発火まで時間がある。緊急時は Step 7 の手動発火でも検証可能。

### Step 7: 手動 cron 発火で動作確認

ターミナル A:
```bash
cd /Users/ryota/repos/github.com/paveg/finews/apps/worker
pnpm wrangler dev --test-scheduled --remote
```

ターミナル B:
```bash
curl "http://localhost:8787/__scheduled?cron=30+21+*+*+SUN-THU"
```

- [ ] ターミナル A のログに `{ job: 'daily', articlesFetched: N, fresh: M, extracted: K, ... }` が出る
- [ ] **Discord チャネルに半導体領域のダイジェスト 1 通が届く** ← Phase 1 完了の絶対条件
- [ ] D1 にレコードが入ったことを `pnpm wrangler d1 execute finews --remote --command "SELECT COUNT(*) FROM articles; SELECT COUNT(*) FROM deliveries WHERE status='success';"` で確認

### Step 8: 本番 Cron でリハーサル(任意)

Cloudflare Dashboard → Workers → finews → Triggers タブから `30 21 * * SUN-THU` の右端の **"Run"** ボタンで manual trigger。

- [ ] Discord に届くことを確認(Step 7 と同じ経路だが、本番 Worker 自身が走る)

---

## 2. シークレットローテーション

### Anthropic API key を更新する時

```bash
cd /Users/ryota/repos/github.com/paveg/finews/apps/worker
pnpm wrangler secret put ANTHROPIC_API_KEY
# 新しい key を貼る
```

旧 key は Console 側で revoke。先に新 key を `wrangler secret put` してからアクションすると配信に穴が空かない。

### Discord Webhook URL を更新する時

```bash
cd /Users/ryota/repos/github.com/paveg/finews/apps/worker
pnpm wrangler secret put DISCORD_WEBHOOK_URL
```

旧 Webhook は Discord 側で削除。

---

## 3. 月次定常運用

### 月初 1 回(目安: 第 1 月曜)

#### コスト集計

```bash
cd /Users/ryota/repos/github.com/paveg/finews/apps/worker
pnpm wrangler d1 execute finews --remote --command "SELECT SUM(cost_usd_micro) / 1000000.0 AS usd, COUNT(*) AS jobs FROM deliveries WHERE attempted_at > datetime('now', '-30 days') AND status = 'success';"
```

- [ ] $15 以下に収まっていることを確認(設計試算は $15.5/月)
- [ ] **$20 超え** なら ADR-0006 Layer 1 が発火しているはず → どこかでループしている可能性、要調査
- [ ] **$10 以下** なら、Stage 1 を Gemini Flash に切り替える価値が薄い(ADR-0002 後段の検証は不要)

#### `budget_exceeded` 発生有無

```bash
pnpm wrangler d1 execute finews --remote --command "SELECT attempted_at, error FROM deliveries WHERE status = 'budget_exceeded' AND attempted_at > datetime('now', '-30 days');"
```

- [ ] 0 件 → 健全
- [ ] 1-2 件 → 該当日の Workers tail logs(`pnpm wrangler tail`)を見て原因確認
- [ ] 月 3 件以上 → 設計レビュー(リミット値 or 絞り込みロジック見直し)

#### Anthropic Console での実測値突き合わせ

- [ ] <https://console.anthropic.com/usage> で前月利用額を確認
- [ ] D1 集計値と Anthropic 実測値の差が 10% 以内であることを確認(乖離が大きいなら `BudgetTracker.recordCall` の計測位置を疑う)

### 週次(任意)

```bash
pnpm wrangler tail finews --format=json | head -100
```

直近の Workers 実行ログを眺めて、`console.warn`(Stage 1 fetch 失敗等)が頻発していないか確認。

---

## 4. 障害対応

### Discord に配信が来ない(平日 6:35 JST 時点で未着)

1. Cloudflare Dashboard → Workers → finews → "Triggers" の "Latest Invocations" を確認
2. 失敗していれば "View logs" でスタックトレース
3. D1 の `deliveries` に当該日のレコードがあるか:
   ```bash
   pnpm wrangler d1 execute finews --remote --command "SELECT * FROM deliveries WHERE attempted_at > datetime('now', '-1 day') ORDER BY attempted_at DESC LIMIT 10;"
   ```
4. パターン別対応:
   - `status='budget_exceeded'` → ADR-0006 想定動作、Anthropic Console で月予算 + 該当日の異常を確認
   - `status='skipped'` → significance ≥ 3 の記事ゼロ。RSS ソース側に新規記事がなかった or Stage 1 が低スコア判定。tail logs で extracted 内容確認
   - `status='success'` だが Discord 未着 → Discord Webhook URL が古いか、Discord 側のレート制限。新 URL を発行して `wrangler secret put`
   - レコード自体ない → Worker が走っていない。Cron Trigger の Active 状態 + UTC 時刻 21:30 を確認

### Anthropic 429 / 500 が連続する

`withRetry` (lib/retry.ts) が max 3 attempts でリトライ。それでも失敗するなら:

- [ ] Anthropic Status (<https://status.anthropic.com/>) で障害確認
- [ ] 障害なら待つ(数時間で復旧)
- [ ] 障害なしで継続するなら、API key が revoke されていないか確認

### D1 への書き込みが失敗する

```bash
pnpm wrangler d1 info finews --remote
```

サイズが 5 GB に近いか確認(無料枠上限)。近ければ古いデータの archive を検討(Phase 1 では発生しない見込み)。

---

## 5. Phase 1.5 着手前の手動確認

Phase 1.5 設計に入る前に、本番デプロイ後 **最低 1 週間** 運用してから以下を確認:

- [ ] Workers から `iShares CSV` / `Global X CSV` への fetch が 200 を返すか(curl で確認するだけでは不十分、Workers IP からの fetch が必要)
- [ ] Discord Webhook の `flags: 4096` (SUPPRESS_NOTIFICATIONS) が現在も有効か(2 通目を flag 付きで送って通知が鳴らないことを確認)
- [ ] BBC Business RSS で semiconductor / us_macro カテゴリの記事が実際に取れているか、Stage 1 の significance ≥ 3 が週に何件出るか
- [ ] Stage 1 / Stage 2 のトークン消費実測値が試算と一致しているか

これらの結果をもって Phase 1.5 のスコープを調整する(申し送りメモ参照: [`2026-05-24-phase-1.5-handoff.md`](superpowers/specs/2026-05-24-phase-1.5-handoff.md))。

---

## 6. 緊急停止

Cron Trigger を一時的に止めたい場合:

```bash
cd /Users/ryota/repos/github.com/paveg/finews/apps/worker
# wrangler.toml の triggers.crons を空配列 [] に編集
# その後:
pnpm run deploy
```

再開時は配列を元に戻して再 `deploy`。

完全停止なら Cloudflare Dashboard → Workers → finews → "Delete Worker"。

---

## 編集ルール

- 手動作業が増えるたびに、このファイルに **「いつ・誰が・どうやって」** で追記
- 自動化できる手順は ADR を起こしてからコード化、その後この runbook から削除
- 手順が古くなったら(ツール仕様変更・API 廃止等)、該当箇所に `> 注: YYYY-MM-DD 更新` と更新日を残す
