CREATE TABLE `project_checks` (
	`project_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`install_command` text,
	`test_command` text,
	`e2e_command` text,
	`screenshot_dir` text,
	`design_standard_path` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
