ALTER TABLE `reviews` ADD `run_ended_at` text;--> statement-breakpoint
UPDATE `reviews` SET `run_ended_at` = (
	SELECT max(`stage_executions`.`ended_at`) FROM `stage_executions`
	WHERE `stage_executions`.`review_id` = `reviews`.`id`
		AND `stage_executions`.`finding_id` IS NULL
		AND `stage_executions`.`ended_at` >= `reviews`.`started_at`
) WHERE `status` IN ('awaiting_confirmation', 'complete', 'failed') AND `started_at` IS NOT NULL;
