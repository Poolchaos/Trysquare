CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`repo` text NOT NULL,
	`file_path` text NOT NULL,
	`line_start` integer NOT NULL,
	`line_end` integer NOT NULL,
	`severity` text NOT NULL,
	`rule_code` text,
	`issue` text NOT NULL,
	`comment` text NOT NULL,
	`mechanism` text NOT NULL,
	`quoted_code` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`verification_note` text,
	`dismiss_reason` text,
	`created_at` text NOT NULL,
	`verified_at` text,
	`decided_at` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_review_idx` ON `findings` (`review_id`,`status`);--> statement-breakpoint
CREATE TABLE `ledger_files` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`repo` text NOT NULL,
	`path` text NOT NULL,
	`change_type` text NOT NULL,
	`old_path` text,
	`risk_tags` text DEFAULT '[]' NOT NULL,
	`chain_files_read` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_files_review_idx` ON `ledger_files` (`review_id`);--> statement-breakpoint
CREATE TABLE `ledger_hunks` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_file_id` text NOT NULL,
	`hunk_index` integer NOT NULL,
	`old_start` integer NOT NULL,
	`old_lines` integer NOT NULL,
	`new_start` integer NOT NULL,
	`new_lines` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`clear_reason` text,
	FOREIGN KEY (`ledger_file_id`) REFERENCES `ledger_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_hunks_file_idx` ON `ledger_hunks` (`ledger_file_id`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`resolved_id` text,
	`family` text NOT NULL,
	`display_name` text NOT NULL,
	`available` integer,
	`context_window` integer,
	`profile_id` text NOT NULL,
	`recommended` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`last_probed_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `process_directives` (
	`id` text PRIMARY KEY NOT NULL,
	`ruleset_id` text NOT NULL,
	`section` text NOT NULL,
	`title` text NOT NULL,
	`content_md` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`ruleset_id`) REFERENCES `rulesets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `process_directives_ruleset_idx` ON `process_directives` (`ruleset_id`);--> statement-breakpoint
CREATE TABLE `project_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`dependency_project_id` text NOT NULL,
	`package_name` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependency_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_links_project_idx` ON `project_links` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`git_url` text NOT NULL,
	`default_branch` text NOT NULL,
	`clone_path` text NOT NULL,
	`clone_status` text NOT NULL,
	`clone_error` text,
	`last_fetched_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_git_url_unique` ON `projects` (`git_url`);--> statement-breakpoint
CREATE TABLE `review_rulesets` (
	`review_id` text NOT NULL,
	`ruleset_id` text NOT NULL,
	`ruleset_name` text NOT NULL,
	`ruleset_version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	PRIMARY KEY(`review_id`, `ruleset_id`),
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ruleset_id`) REFERENCES `rulesets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_branch` text NOT NULL,
	`from_commit` text NOT NULL,
	`into_branch` text NOT NULL,
	`into_commit` text NOT NULL,
	`merge_base_commit` text NOT NULL,
	`linked_project_id` text,
	`linked_from_branch` text,
	`linked_from_commit` text,
	`linked_into_branch` text,
	`linked_into_commit` text,
	`linked_merge_base_commit` text,
	`model` text NOT NULL,
	`profile_id` text NOT NULL,
	`engine_mode` text NOT NULL,
	`status` text NOT NULL,
	`current_stage` text,
	`paused_reason` text,
	`usage_input_tokens` integer DEFAULT 0 NOT NULL,
	`usage_output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_equivalent_usd` real DEFAULT 0 NOT NULL,
	`merged_detected_at` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `reviews_project_idx` ON `reviews` (`project_id`);--> statement-breakpoint
CREATE INDEX `reviews_branch_pair_idx` ON `reviews` (`project_id`,`from_branch`,`into_branch`);--> statement-breakpoint
CREATE INDEX `reviews_status_idx` ON `reviews` (`status`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`ruleset_id` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`severity` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`rule_text` text NOT NULL,
	`violation_example` text,
	`correct_pattern` text,
	`detection` text,
	`notes` text,
	`sweep_patterns` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`ruleset_id`) REFERENCES `rulesets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rules_ruleset_idx` ON `rules` (`ruleset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rules_ruleset_code_idx` ON `rules` (`ruleset_id`,`code`);--> statement-breakpoint
CREATE TABLE `rulesets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tier` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source_doc` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stage_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`stage` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`session_id` text,
	`status` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_equivalent_usd` real DEFAULT 0 NOT NULL,
	`error_class` text,
	`error_text` text,
	`log_path` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stage_executions_review_idx` ON `stage_executions` (`review_id`,`stage`);--> statement-breakpoint
CREATE TABLE `sweep_hits` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`rule_code` text NOT NULL,
	`pattern` text NOT NULL,
	`repo` text NOT NULL,
	`path` text NOT NULL,
	`line` integer NOT NULL,
	`excerpt` text NOT NULL,
	`disposition` text DEFAULT 'pending' NOT NULL,
	`clear_reason` text,
	`finding_id` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sweep_hits_review_idx` ON `sweep_hits` (`review_id`,`disposition`);