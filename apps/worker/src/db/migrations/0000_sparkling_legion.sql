CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`domain` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`published_at` text NOT NULL,
	`extracted_json` text,
	`watchlist_matched` integer DEFAULT false NOT NULL,
	`continuing_theme_score` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_articles_published` ON `articles` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_articles_domain` ON `articles` (`domain`,`published_at`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`step` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`duration_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd_micro` integer,
	`attempted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `etf_snapshots` (
	`snapshot_date` text NOT NULL,
	`symbol` text NOT NULL,
	`domain` text NOT NULL,
	`price` real NOT NULL,
	`change_pct_1d` real,
	`volume` integer,
	`volume_avg_20d` integer,
	`shares_outstanding` integer,
	`net_assets_usd` real,
	`flow_1d` real,
	`flow_5d` real,
	`raw_json` text,
	PRIMARY KEY(`snapshot_date`, `symbol`)
);
--> statement-breakpoint
CREATE INDEX `idx_etf_symbol_date` ON `etf_snapshots` (`symbol`,`snapshot_date`);--> statement-breakpoint
CREATE TABLE `glossary` (
	`term` text PRIMARY KEY NOT NULL,
	`definition` text NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_snapshots` (
	`snapshot_date` text NOT NULL,
	`symbol` text NOT NULL,
	`price` real NOT NULL,
	`change_pct_1d` real,
	`raw_json` text,
	PRIMARY KEY(`snapshot_date`, `symbol`)
);
--> statement-breakpoint
CREATE TABLE `summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`domain` text NOT NULL,
	`content` text NOT NULL,
	`article_ids` text NOT NULL,
	`model_used` text NOT NULL,
	`delivered_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_summaries_job` ON `summaries` (`job_type`,`delivered_at`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`ticker` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`reason` text,
	`tags` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
