PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review_rulesets` (
	`review_id` text NOT NULL,
	`ruleset_id` text NOT NULL,
	`ruleset_name` text NOT NULL,
	`ruleset_version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	PRIMARY KEY(`review_id`, `ruleset_id`),
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_review_rulesets`("review_id", "ruleset_id", "ruleset_name", "ruleset_version", "snapshot_json") SELECT "review_id", "ruleset_id", "ruleset_name", "ruleset_version", "snapshot_json" FROM `review_rulesets`;--> statement-breakpoint
DROP TABLE `review_rulesets`;--> statement-breakpoint
ALTER TABLE `__new_review_rulesets` RENAME TO `review_rulesets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;