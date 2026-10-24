CREATE TABLE `check_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`kind` text NOT NULL,
	`step` text,
	`command` text,
	`exit_code` integer,
	`timed_out` integer DEFAULT false NOT NULL,
	`log_path` text,
	`screenshot_path` text,
	`grade` text,
	`severity` text NOT NULL,
	`issue` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text NOT NULL,
	`verification_note` text,
	`dismiss_reason` text,
	`dismissed_from` text,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `check_findings_review_idx` ON `check_findings` (`review_id`);