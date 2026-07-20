CREATE TABLE `operation_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`contract_version` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_accessed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operation_cache_kind_idx` ON `operation_cache` (`kind`);--> statement-breakpoint
CREATE INDEX `operation_cache_expires_idx` ON `operation_cache` (`expires_at`);