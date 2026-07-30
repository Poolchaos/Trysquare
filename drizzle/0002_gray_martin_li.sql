ALTER TABLE `stage_executions` ADD `prompt_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `stage_executions` ADD `output_json` text;--> statement-breakpoint
CREATE INDEX `stage_executions_replay_idx` ON `stage_executions` (`review_id`,`stage`,`prompt_hash`);