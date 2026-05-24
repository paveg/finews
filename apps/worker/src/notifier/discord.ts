const DOMAIN_COLORS: Record<string, number> = {
  semiconductor: 0x3498db,
  ai_tech: 0x9b59b6,
  us_macro: 0x2ecc71,
  jp_macro: 0xe74c3c,
  earnings: 0xf1c40f,
  market_context: 0x95a5a6,
};

const DOMAIN_TITLES: Record<string, string> = {
  semiconductor: '半導体・AIテック',
  ai_tech: 'AIテック',
  us_macro: '米国マクロ',
  jp_macro: '日本マクロ',
  earnings: '決算・ガイダンス',
  market_context: 'マーケット',
};

export type DailyEmbed = {
  domain: string;
  body: string;
};

async function postWebhook(webhookUrl: string, payload: unknown): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  }
}

export async function sendDailyEmbed(
  webhookUrl: string,
  embed: DailyEmbed,
): Promise<void> {
  await postWebhook(webhookUrl, {
    embeds: [
      {
        title: `📰 ${DOMAIN_TITLES[embed.domain] ?? embed.domain}`,
        description: embed.body.slice(0, 4000),
        color: DOMAIN_COLORS[embed.domain] ?? 0x95a5a6,
        timestamp: new Date().toISOString(),
        footer: { text: 'finews / Sonnet 4.6' },
      },
    ],
  });
}

export async function sendPlainText(
  webhookUrl: string,
  content: string,
): Promise<void> {
  await postWebhook(webhookUrl, { content });
}
