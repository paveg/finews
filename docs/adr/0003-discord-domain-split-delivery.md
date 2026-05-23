# ADR-0003: Discord 配信は領域別 4 メッセージ分割で行う

## Status

Accepted (2026-05-23)

## Context

朝刊では半導体/米マクロ/日マクロ/決算 の4領域を一度に配信する。当初設計では「1メッセージに4 embed (各 description 4096 字)」を想定していた。

Discord 公式ドキュメント (`discord.com/developers/docs/resources/message`) で確認した制限:

| 制限 | 値 |
|---|---|
| 1メッセージあたりの embed 数 | 上限明記なし(実質 10) |
| **全 embed の合計文字数 (title + description + field.name + field.value + footer.text + author.name の合計)** | **6000 文字** |
| embed.description 個別 | 4096 文字 |
| embed.title 個別 | 256 文字 |
| embed.fields | 最大 25 個、name 256字、value 1024字 |
| Webhook レート制限 | 30 req/min/channel(慣習値、公式未明記) |

**当初案 (4 embed × 4096) = 16384 文字は 6000 字上限を 2.7 倍オーバーし、実装不可能。**

選択肢:
1. **領域別 4 メッセージ分割** — 採用
2. 1メッセージ・各 embed を 1400 字以内に圧縮 — 情報量大幅減
3. Discord は head のみ、詳細は R2/外部ページ — 後段(SEO 記事化)で検討

## Decision

朝刊は領域ごとに 1 メッセージずつ計 **4 メッセージ** を直列送信する。

- 1メッセージ = 1領域 = 1 embed
- 各 embed の description は最大 4096 字 + title 256 字 + footer 数十字 ≪ 6000 字上限
- メッセージ間に 250ms スリープを挟む(レート制限 30/min に対して 16/min なので余裕)
- 領域ごとに embed.color を色分け(半導体=青、米マクロ=緑、日マクロ=赤、決算=黄)

### Discord にとどまる週次・月次の扱い

- 週次: 1メッセージ・1 embed(マクロ・テック・イベント・用語を1まとめ、~4000字想定)
- 月次: 1メッセージ・1 embed(ジャンル分布・継続テーマ・チェックリスト、~5000字想定)

週次・月次は当初案どおりで問題なし。

### ADR-0002 との整合性

Stage 2 Daily をドメインごとに4回呼ぶ前提と整合する。各 Stage 2 呼び出しの出力をそのまま 1 Discord メッセージにマッピングできる。

## Consequences

### Positive

- 各領域に最大 4000 字使えるため、情報量・解説の深さを犠牲にしない
- 領域ごとに色分け・タイムスタンプが見えて視認性向上
- Stage 2 を 4 並列(または直列)呼び出しにすることで prompt caching が効きやすい (ADR-0002)
- ある領域の Stage 2 が失敗しても他3領域は配信可能(部分障害耐性)

### Negative

- Discord 通知が1朝に4回鳴る(モバイル通知のうるささ)
  - 対策: Discord の `suppress_notifications` フラグを 2-4 通目に付与し、最初の1通だけ通知を鳴らす
- Webhook の連続送信でレート制限に当たるリスク(対策: 250ms スリープ、リトライ実装)
- Webhook URL の漏洩リスクが4回に増えるわけではないが、エラーログのマスキングを徹底

### 実装ポイント

```typescript
// notifier/discord.ts (擬似)
async function sendDailyDigest(perDomain: Record<Domain, Embed>) {
  const domains: Domain[] = ['semiconductor', 'us_macro', 'jp_macro', 'earnings'];
  for (let i = 0; i < domains.length; i++) {
    const embed = perDomain[domains[i]];
    if (!embed) continue;
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [embed],
        flags: i === 0 ? 0 : 4096, // SUPPRESS_NOTIFICATIONS
      }),
    });
    if (i < domains.length - 1) await new Promise(r => setTimeout(r, 250));
  }
}
```
