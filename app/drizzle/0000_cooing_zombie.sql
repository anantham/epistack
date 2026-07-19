CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`assessor` text NOT NULL,
	`dimension` text NOT NULL,
	`score` real,
	`label` text,
	`rationale` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assessments_target_idx` ON `assessments` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `assessments_policy_idx` ON `assessments` (`policy_id`);--> statement-breakpoint
CREATE TABLE `beliefs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`claim_node_id` text NOT NULL,
	`probability` real NOT NULL,
	`prior_type` text NOT NULL,
	`basis_snapshot_id` text,
	`assessor` text NOT NULL,
	`rationale` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`basis_snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `beliefs_claim_idx` ON `beliefs` (`claim_node_id`);--> statement-breakpoint
CREATE INDEX `beliefs_case_idx` ON `beliefs` (`case_id`);--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`original_prompt` text NOT NULL,
	`active_question` text,
	`status` text DEFAULT 'framing' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cases_slug_idx` ON `cases` (`slug`);--> statement-breakpoint
CREATE TABLE `edges` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`to_node_id` text NOT NULL,
	`relation` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`rationale` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `edges_case_idx` ON `edges` (`case_id`);--> statement-breakpoint
CREATE INDEX `edges_from_idx` ON `edges` (`from_node_id`);--> statement-breakpoint
CREATE INDEX `edges_to_idx` ON `edges` (`to_node_id`);--> statement-breakpoint
CREATE TABLE `evidence_items` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`source_id` text NOT NULL,
	`claim_node_id` text,
	`locator` text,
	`excerpt` text,
	`bearing` text NOT NULL,
	`extraction_actor` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_case_idx` ON `evidence_items` (`case_id`);--> statement-breakpoint
CREATE INDEX `evidence_source_idx` ON `evidence_items` (`source_id`);--> statement-breakpoint
CREATE INDEX `evidence_claim_idx` ON `evidence_items` (`claim_node_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'candidate' NOT NULL,
	`origin` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `nodes_case_idx` ON `nodes` (`case_id`);--> statement-breakpoint
CREATE INDEX `nodes_kind_idx` ON `nodes` (`kind`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`parent_id` text,
	`actor` text NOT NULL,
	`operation` text NOT NULL,
	`artifact_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `snapshots_case_idx` ON `snapshots` (`case_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_url` text,
	`doi` text,
	`pmid` text,
	`title` text NOT NULL,
	`authors_json` text DEFAULT '[]' NOT NULL,
	`issued_at` text,
	`publisher` text,
	`source_type` text NOT NULL,
	`csl_json` text DEFAULT '{}' NOT NULL,
	`content_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sources_doi_idx` ON `sources` (`doi`);--> statement-breakpoint
CREATE INDEX `sources_pmid_idx` ON `sources` (`pmid`);