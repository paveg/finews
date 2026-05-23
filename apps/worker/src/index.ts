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
  },
} satisfies ExportedHandler<Env>;
