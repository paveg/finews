# ADR-0004: ETF Flow データソースは「issuer 直 fetch + 段階導入 + 失敗時は価格・出来高のみ」とする

## Status

Accepted (2026-05-23)

## Context

「市場全体の意思」を読むために ETF flow (純資金流入) を中核指標にしたい。Flow の計算式:

```
flow_1d = (shares_outstanding[t] - shares_outstanding[t-1]) × NAV[t]
```

そのためには **日次の shares_outstanding** が必要。WebFetch + 既知ドキュメント調査の結果:

| 発行体 | 銘柄 | shares_outstanding 取得経路 | 難度 |
|---|---|---|---|
| iShares | SOXX, TLT, HYG | `_fund.csv` 直リンク (productId経由) | 中(403 のリスク) |
| VanEck | SMH | HTML scrape + XLSX export | 高(脆い) |
| Global X | AIQ, BOTZ | holdings CSV は取得確認済(`assets.globalxetfs.com/funds/holdings/{ticker}_full-holdings_{YYYYMMDD}.csv`)、shares_outstanding は factsheet periodic | 中 |
| SPDR | SPY | XLSX + Cookie/Referer 必要 | 高 |
| Invesco | QQQ | JSON API (`contentdetail` 経由) | 中 |

**Yahoo Finance の `sharesOutstanding` は ETF には信用できない**(月次〜不定期更新)。ETF.com の無料 API は FactSet 傘下後に廃止。**有料代替は FactSet/Bloomberg のみ**で個人プロジェクト予算外。

加えて、検証セッションで Claude Code 環境から iShares・ETFdb・MarketWatch 等が **403 Forbidden** で弾かれた。実プロダクションの Cloudflare Workers 環境からアクセスできるかは別途検証が必要(Workers の IP レンジは Claude Code とは別だが、Bot 検出が共通の場合がある)。

## Decision

段階導入で**精度を保ちつつリスクを管理**する。

### Phase 1 (週末半日想定)

ETF データは扱わない。価格・出来高すら見ない。記事と市場指標(VIX/DXY/利回り/為替)のみで朝刊を出す。

### Phase 1.5

- **iShares 3銘柄 (SOXX, TLT, HYG) と Global X 2銘柄 (AIQ, BOTZ) のみ flow 計算を実装**
  - 理由: iShares は productId が公開・安定、Global X は CSV 直リンク確認済
- **SMH (VanEck) は flow 追跡せず**、SOXX の flow で半導体セクター意思を代表
- SPY/QQQ/1306/1545 は **価格・出来高のみ**(flow は Phase 2 以降)
- ソース定義に `flowProvider: 'ishares' | 'globalx' | null` を追加し、null は flow 計算スキップ
- 実 Workers 環境から各 CSV が取得可能かを **Phase 1.5 着手の最初に検証**(失敗時は Phase 2 へ持ち越し)

### Phase 1.5 で取得失敗時のフォールバック

shares_outstanding が日次で取れなくても、以下で代替する:

1. **週次更新ベースの approximate flow**: shares_outstanding を週1取得し、weekly 平均で粗い flow を出す
2. **価格 × 出来高の異常検知**: 平均出来高の 2x を超える日に「セクターに動意」フラグ
3. flow を持たない銘柄は Stage 2 プロンプトで「価格と出来高のみ参照」と明示

### Phase 2

- SPY, QQQ の flow 追加(SPDR/Invesco adapter 実装)
- SMH の flow 追加(VanEck adapter, HTML scrape)
- 日本 ETF (1306, 1545) はそもそも日次 shares_outstanding 開示が薄く、保留

## Consequences

### Positive

- Phase 1 で「動くものを早く出す」原則と整合(ETF は後付け)
- Phase 1.5 で 5 銘柄でも、半導体・AI・米マクロのフロー意思は十分読める
- Adapter パターンで発行体ごとの脆さを局所化
- 取得失敗時のフォールバックがあるため、設計が破綻しない

### Negative

- Phase 1 の朝刊は ETF データなし(市場指標のみ)で価値が薄れる(2-3週間の暫定状態)
- VanEck/SPDR adapter の実装コストは Phase 2 まで先送り
- 「Workers から issuer サイトへの fetch が成功するか」は実装前検証できず、Phase 1.5 でブロッカー化するリスク

### 実装上の注意

- iShares の正式 fileType=fund URL: `https://www.ishares.com/us/products/{productId}/{slug}/1467271812596.ajax?fileType=csv&fileName={TICKER}_fund&dataType=fund`
- productId: SOXX=239705, TLT=239454, HYG=239565
- Global X の CSV URL は日付込み: `https://assets.globalxetfs.com/funds/holdings/{ticker}_full-holdings_{YYYYMMDD}.csv` — 日付を JST/ET どちらで生成するか注意

### 検証 TODO

- [ ] 実 Workers 環境から iShares CSV を 5 営業日連続で取得し、403 やレート制限が出ないか
- [ ] Global X CSV から shares_outstanding 列が取れるか(holdings CSV は構成銘柄一覧で、shares_outstanding は別ファイルの可能性)
- [ ] 取得失敗時の代替経路(NASDAQ ETF Holdings フィード)の品質
