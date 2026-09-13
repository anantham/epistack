CREATE TABLE IF NOT EXISTS `hosted_brief_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`state_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `hosted_brief_jobs_locked_idx` ON `hosted_brief_jobs` (`locked_until`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `hosted_decomposition_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`state_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `hosted_decomposition_jobs_locked_idx` ON `hosted_decomposition_jobs` (`locked_until`);