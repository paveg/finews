export const DOMAIN_COLORS: Record<string, number> = {
  semiconductor: 0x3498db,
  ai_tech: 0x9b59b6,
  us_macro: 0x2ecc71,
  jp_macro: 0xe74c3c,
  earnings: 0xf1c40f,
  market_context: 0x95a5a6,
};

export const DOMAIN_TITLES: Record<string, string> = {
  semiconductor: '半導体・AIテック',
  ai_tech: 'AIテック',
  us_macro: '米国マクロ',
  jp_macro: '日本マクロ',
  earnings: '決算・ガイダンス',
  market_context: 'マーケット',
};

/** Escape Discord mentions to prevent @everyone/@here injection from untrusted content. */
export function escapeDiscordMentions(text: string): string {
  return text
    .replace(/@(everyone|here)/g, '@​$1')
    .replace(/<@[!&]?\d+>/g, (match) => match.replace('@', '@​'));
}

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
    throw new Error(`Discord webhook failed: ${res.status}`);
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

// --- Forum Channel Support ---

export function splitContent(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

type ForumOverview = {
  threadName: string;
  title: string;
  description: string;
  color: number;
};

export function buildForumPayload(overview: ForumOverview) {
  return {
    thread_name: overview.threadName,
    embeds: [
      {
        title: overview.title,
        description: escapeDiscordMentions(overview.description).slice(0, 4000),
        color: overview.color,
        timestamp: new Date().toISOString(),
        footer: { text: 'finews / Sonnet 4.6' },
      },
    ],
  };
}

export type ForumDigest = {
  threadName: string;
  title: string;
  color: number;
  overview: string;
  detail: string;
  glossary: string;
};

export async function sendForumDigest(
  webhookUrl: string,
  digest: ForumDigest,
): Promise<void> {
  const payload = buildForumPayload({
    threadName: digest.threadName,
    title: digest.title,
    description: digest.overview,
    color: digest.color,
  });

  const createRes = await fetch(`${webhookUrl}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!createRes.ok) {
    throw new Error(`Discord forum create failed: ${createRes.status}`);
  }
  const created = (await createRes.json()) as { channel_id: string };
  const threadId = created.channel_id;

  await new Promise((r) => setTimeout(r, 250));

  if (digest.detail) {
    await postToThread(webhookUrl, threadId, digest.detail);
  }
  if (digest.glossary) {
    await new Promise((r) => setTimeout(r, 250));
    await postToThread(webhookUrl, threadId, digest.glossary);
  }
}

async function postToThread(webhookUrl: string, threadId: string, content: string): Promise<void> {
  const chunks = splitContent(content, 2000);
  for (const chunk of chunks) {
    const res = await fetch(`${webhookUrl}?thread_id=${threadId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: escapeDiscordMentions(chunk) }),
    });
    if (!res.ok) {
      console.warn({ discord_thread_post_failed: res.status, threadId });
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
