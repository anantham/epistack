CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`study_id` text NOT NULL,
	`label` text NOT NULL,
	`analysis_type` text NOT NULL,
	`population_json` text DEFAULT '{}' NOT NULL,
	`exposure_json` text DEFAULT '{}' NOT NULL,
	`comparator_json` text DEFAULT '{}' NOT NULL,
	`outcome_json` text DEFAULT '{}' NOT NULL,
	`time_horizon` text,
	`estimand` text,
	`model_json` text DEFAULT '{}' NOT NULL,
	`multiplicity` text DEFAULT 'unknown' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`study_id`) REFERENCES `studies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `analyses_study_idx` ON `analyses` (`study_id`);--> statement-breakpoint
CREATE TABLE `claim_frames` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`statement` text NOT NULL,
	`population_json` text DEFAULT '{}' NOT NULL,
	`exposure_json` text DEFAULT '{}' NOT NULL,
	`comparator_json` text DEFAULT '{}' NOT NULL,
	`outcome_json` text DEFAULT '{}' NOT NULL,
	`time_horizon` text,
	`modality` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `claim_frames_case_idx` ON `claim_frames` (`case_id`);--> statement-breakpoint
CREATE INDEX `claim_frames_status_idx` ON `claim_frames` (`status`);--> statement-breakpoint
CREATE TABLE `decision_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`question` text NOT NULL,
	`target_context_json` text DEFAULT '{}' NOT NULL,
	`constraints_json` text DEFAULT '{}' NOT NULL,
	`values_json` text DEFAULT '{}' NOT NULL,
	`graph_snapshot_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`graph_snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decision_episodes_case_idx` ON `decision_episodes` (`case_id`);--> statement-breakpoint
CREATE TABLE `decision_options` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`label` text NOT NULL,
	`action_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`decision_id`) REFERENCES `decision_episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decision_options_decision_idx` ON `decision_options` (`decision_id`);--> statement-breakpoint
CREATE TABLE `decision_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`label` text NOT NULL,
	`measure` text,
	`importance` real,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`decision_id`) REFERENCES `decision_episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decision_outcomes_decision_idx` ON `decision_outcomes` (`decision_id`);--> statement-breakpoint
CREATE TABLE `dependence_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`label` text NOT NULL,
	`reason` text NOT NULL,
	`depends_on_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dependence_groups_case_idx` ON `dependence_groups` (`case_id`);--> statement-breakpoint
CREATE TABLE `evidence_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`result_id` text NOT NULL,
	`claim_frame_id` text NOT NULL,
	`relation` text NOT NULL,
	`scope_match` text NOT NULL,
	`rationale` text NOT NULL,
	`assessor` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`result_id`) REFERENCES `result_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_frame_id`) REFERENCES `claim_frames`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_relations_case_idx` ON `evidence_relations` (`case_id`);--> statement-breakpoint
CREATE INDEX `evidence_relations_result_idx` ON `evidence_relations` (`result_id`);--> statement-breakpoint
CREATE INDEX `evidence_relations_claim_idx` ON `evidence_relations` (`claim_frame_id`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`protocol_id` text NOT NULL,
	`source_id` text,
	`observed_at` text NOT NULL,
	`measure` text NOT NULL,
	`value_json` text NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`missingness` text,
	`sharing` text DEFAULT 'private' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`protocol_id`) REFERENCES `protocols`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `observations_protocol_idx` ON `observations` (`protocol_id`);--> statement-breakpoint
CREATE TABLE `protocols` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`option_id` text,
	`title` text NOT NULL,
	`protocol_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`decision_id`) REFERENCES `decision_episodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`option_id`) REFERENCES `decision_options`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `protocols_decision_idx` ON `protocols` (`decision_id`);--> statement-breakpoint
CREATE TABLE `result_records` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`dependence_group_id` text NOT NULL,
	`result_role` text NOT NULL,
	`result_text` text NOT NULL,
	`estimate_json` text DEFAULT '{}' NOT NULL,
	`locator` text NOT NULL,
	`excerpt` text,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dependence_group_id`) REFERENCES `dependence_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `result_records_analysis_idx` ON `result_records` (`analysis_id`);--> statement-breakpoint
CREATE INDEX `result_records_family_idx` ON `result_records` (`dependence_group_id`);--> statement-breakpoint
CREATE TABLE `studies` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`registration_id` text,
	`design` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `studies_source_idx` ON `studies` (`source_id`);--> statement-breakpoint
CREATE INDEX `studies_registration_idx` ON `studies` (`registration_id`);--> statement-breakpoint
CREATE TABLE `update_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`source_url` text,
	`scope` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`review_status` text DEFAULT 'queued' NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `update_events_target_idx` ON `update_events` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `update_events_review_idx` ON `update_events` (`review_status`);