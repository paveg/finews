import type { D1Database } from '@cloudflare/workers-types';
import { runDaily } from './jobs/daily';

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  DISCORD_WEBHOOK_URL: string;
  ENVIRONMENT: string;
}

export default {
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    console.log({ cron: event.cron, time: new Date().toISOString() });
    switch (event.cron) {
      case '30 21 * * 0-4':
        ctx.waitUntil(runDaily(env));
        break;
      default:
        console.log({ ignored: event.cron });
    }
  },
} satisfies ExportedHandler<Env>;
