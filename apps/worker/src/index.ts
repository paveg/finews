import type { D1Database } from '@cloudflare/workers-types';
import { runDaily } from './jobs/daily';

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  DISCORD_WEBHOOK_URL: string;
  ENVIRONMENT: string;
  RUN_SECRET: string;
  ENABLE_MANUAL_TRIGGER?: string;
}

export default {
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    console.log({ cron: event.cron, time: new Date().toISOString() });
    switch (event.cron) {
      case '30 21 * * SUN-THU':
        ctx.waitUntil(runDaily(env));
        break;
      default:
        console.log({ ignored: event.cron });
    }
  },

  // 手動トリガー。デフォルト無効。有効化:
  //   wrangler.toml の [vars] に ENABLE_MANUAL_TRIGGER = "true" を追加
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (env.ENABLE_MANUAL_TRIGGER !== 'true') {
      return new Response('not found\n', { status: 404 });
    }
    const url = new URL(req.url);
    if (url.pathname !== '/__run-daily') {
      return new Response('not found\n', { status: 404 });
    }
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!env.RUN_SECRET || token !== env.RUN_SECRET) {
      return new Response('unauthorized\n', { status: 401 });
    }
    ctx.waitUntil(runDaily(env));
    return new Response('daily triggered\n', { status: 202 });
  },
} satisfies ExportedHandler<Env>;
