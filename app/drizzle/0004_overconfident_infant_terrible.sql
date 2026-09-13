CREATE TABLE IF NOT EXISTS `decomposition_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`outcome` text NOT NULL,
	`stage` integer NOT NULL,
	`stage_ms_json` text DEFAULT '[]' NOT NULL,
	`attempts_json` text DEFAULT '[]' NOT NULL,
	`rate_limits` integer DEFAULT 0 NOT NULL,
	`effort` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `decomposition_runs_created_idx` ON `decomposition_runs` (`created_at`);