# ADR-0002: 二段階要約 (Haiku 4.5 抽出 → Sonnet 4.6 分析 → 月次 Opus 4.7) を採用する

## Status

Accepted (2026-05-23)

## Context

金融ニュース要約は次のトレードオフを伴う。

- **品質**: 「なぜ重要か」「読み解きポイント」を生成するには高性能モデルが必要
- **コスト**: 1日20-30件の記事を毎日処理するため、コストが線形に積み上がる
- **構造化**: 後続処理(ウォッチリストマッチ、用語抽出)のために構造化抽出が必要

選択肢:
1. **二段階 (Haiku→Sonnet→Opus)** — 採用
2. 全件 Sonnet 一本(品質高だがコスト3倍)
3. 全件 Haiku 一本(コスト最安だが分析の深さ不足)
4. Stage 1 + Stage 2 を同一モデル(中間案、最適化余地小)

### なぜ Anthropic か(対 OpenAI, Gemini)

| 観点 | Anthropic | OpenAI | Gemini |
|---|---|---|---|
| Stage 1 コスト(per MTok) | Haiku 4.5 $1/$5 | GPT-5 mini クラス | **Gemini 2.5 Flash $0.075/$0.30 (最安)** |
| Stage 2 品質 | **Sonnet/Opus 高品質** | GPT-5 高品質 | 2.5 Pro 高品質 |
| 構造化出力の厳密性 | 高 | **最高 (strict JSON schema)** | 中 |
| Workers SDK 安定性 | **高** | 中 | 低 (nodejs_compat 詰まり報告あり) |
| プロンプトキャッシュ | **シンプル(`cache_control: ephemeral`)** | 中 | 複雑(明示 cache resource) |
| 1M+ コンテキスト | Sonnet 4.6 / Opus 4.7 = 1M | あり | **2.5 Pro = 2M (最大)** |
| 日本語生成の自然さ | **高** | 高 | 中〜高 |

Anthropic を主体に採用する根拠は、(1) Cloudflare Workers での SDK 安定性、(2) プロンプトキャッシュ仕様のシンプルさが finews の「ドメイン別 4 回呼び出し」と整合、(3) Haiku→Sonnet→Opus の三段階モデル階層が finews の負荷特性と一致、の3点。

## Decision

役割分担:

| ステージ | モデル | モデルID | 役割 |
|---|---|---|---|
| Stage 1 | **Haiku 4.5** | `claude-haiku-4-5-20251001` | 1記事ごとの構造化抽出(Valibot JSON) |
| Stage 2 Daily | **Sonnet 4.6** | `claude-sonnet-4-6` | 領域横断分析、読解教育、Discord 配信本文 |
| Stage 2 Weekly | **Sonnet 4.6** | `claude-sonnet-4-6` | 週次総括 |
| Stage 2 Monthly | **Opus 4.7** | `claude-opus-4-7` | 月次振り返り(最高品質を月1回だけ使う) |

価格 (2026/5 時点、`docs.anthropic.com/en/docs/about-claude/pricing` で確認):

| モデル | input | output |
|---|---|---|
| Haiku 4.5 | $1 / MTok | $5 / MTok |
| Sonnet 4.6 | $3 / MTok | $15 / MTok |
| Opus 4.7 | $5 / MTok | $25 / MTok |

### Prompt Caching の活用

- 最小キャッシュサイズ:
  - Sonnet 4.6: **1,024 tokens**
  - Haiku 4.5: **4,096 tokens**
  - Opus 4.7: **4,096 tokens**
- TTL: デフォルト 5 分 (1時間オプションあり、2x cost)
- Cache write: 1.25x、Cache read: 0.1x base input

**実装方針**: Stage 2 Daily を**ドメインごとに4回呼び出し**、システムプロンプト(出力フォーマット指示、用語辞書、領域定義)を `cache_control: { type: "ephemeral" }` で固定。1ジョブ内の4回中3回はキャッシュヒットしてコスト約30%削減。これは ADR-0003 の Discord 4メッセージ分割とも整合。

## Consequences

### Positive

- Stage 1 を Haiku に任せることで、20件処理しても1ジョブ $0.10 程度
- Stage 2 で領域横断の文脈合成、教育的解説、継続テーマ判定を高品質に
- 月次のみ Opus にすることで「月1回の振り返り」をプレミアム品質に。コスト増分は約 $0.30/月
- ドメイン別 Stage 2 + prompt caching でコスト 30% 削減見込み

### Negative

- 2段階パイプラインのため Stage 1 失敗時のリカバリ設計が必要
- Stage 1 出力スキーマ変更時、保存済み `extracted_json` との後方互換性に注意
- Opus 4.7 は新トークナイザーで同テキストでも最大35%多くトークン消費(月次のみなので影響軽微)
- Sonnet 4.6 の knowledge cutoff は Aug 2025、最新の市場固有名詞は注釈で補う必要あり
- **ベンダーロックイン**: 全レイヤーを Anthropic に依存。SDK 障害や価格変動の影響を直接受ける → 下記 Phase 1.5 でマルチプロバイダ検証を行うことで部分的に緩和

### Phase 1.5 でのマルチプロバイダ検証 (Stage 1 のみ)

Stage 1 は「定型的な構造化抽出」で、出力スキーマ(Valibot)が安定すれば**プロバイダ依存度が低い**。コスト最適化の観点で **Gemini 2.5 Flash への置き換え可能性**を検証する。

検証手順:

1. Phase 1 で Anthropic Haiku 4.5 をデフォルトとして本番稼働
2. Phase 1 で Valibot golden test(3-5 件の fixture)を整備、出力スキーマを fix
3. Phase 1.5 で `summarizer/stage1_gemini.ts` を追加実装(同一スキーマ、同一プロンプト)
4. 過去 1 週間の articles を両プロバイダで並列実行、以下を計測:
   - **Valibot 検証通過率**: 95% 以上なら合格
   - **コスト比**: Gemini が 1/5 以下なら経済的に魅力
   - **`significance` の一致率**: 80% 以上なら品質許容
5. 合格すれば設定 `STAGE1_PROVIDER=gemini` で切替、不合格なら Anthropic 継続

Stage 2 は文脈合成・教育的説明の品質が finews の中核価値なので、当面 Anthropic を維持。Stage 2 のマルチプロバイダ検討は Phase 3 以降。

### コスト試算(マルチプロバイダ後の上振れ余地)

Stage 1 を Gemini Flash に置き換えた場合の試算:

| 項目 | 月額(Anthropic) | 月額(Stage 1=Gemini) |
|---|---|---|
| Stage 1 | 約 $3.0 | **約 $0.3-0.5** |
| Stage 2 Daily/Weekly/Monthly(Anthropic 継続) | 約 $7.5 | 約 $7.5 |
| LLM 合計 | 約 $10.5 | **約 $8.0** |

差額 $2-3/月。検証コスト(実装1日+並列稼働1週間)と引き合うかは判断必要。

### コスト試算 (修正版)

| 項目 | 月額 |
|---|---|
| Stage 1 (Haiku) × 22営業日 × 20記事 | 約 $3.0 |
| Stage 2 Daily (Sonnet, 4ドメイン×22日, 70% cache hit) | 約 $4.5 |
| Stage 2 Weekly (Sonnet) × 4週 | 約 $2.5 |
| Stage 2 Monthly (Opus) × 1 | 約 $0.5 |
| 合計 (Anthropic) | **約 $10.5/月** |
