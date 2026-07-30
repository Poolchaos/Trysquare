ALTER TABLE `process_directives` ADD `raw_markdown` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `process_directives` ADD `source_start_line` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `process_directives` ADD `source_end_line` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `group_heading` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `raw_markdown` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `source_start_line` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `source_end_line` integer DEFAULT 0 NOT NULL;