CREATE TABLE `__new_ai_algorithm_step_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`configuration_version_id` text NOT NULL,
	`step_key` text NOT NULL,
	`ordinal` integer NOT NULL,
	`model_deployment_id` text,
	`prompt_code` text NOT NULL,
	`parameters_json` text NOT NULL,
	FOREIGN KEY (`configuration_version_id`) REFERENCES `ai_algorithm_configuration_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_deployment_id`) REFERENCES `ai_model_deployments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`prompt_code`) REFERENCES `ai_prompts`(`code`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_algorithm_step_configurations_key_check" CHECK(length(trim(`step_key`)) > 0),
	CONSTRAINT "ai_algorithm_step_configurations_ordinal_check" CHECK(`ordinal` >= 0),
	CONSTRAINT "ai_algorithm_step_configurations_parameters_check" CHECK(json_valid(`parameters_json`))
);
--> statement-breakpoint
INSERT INTO `__new_ai_algorithm_step_configurations` (
	`id`, `configuration_version_id`, `step_key`, `ordinal`, `model_deployment_id`, `prompt_code`, `parameters_json`
)
SELECT `id`, `configuration_version_id`, `step_key`, `ordinal`, `model_deployment_id`, `prompt_code`, `parameters_json`
FROM `ai_algorithm_step_configurations`;
--> statement-breakpoint
DROP TABLE `ai_algorithm_step_configurations`;
--> statement-breakpoint
ALTER TABLE `__new_ai_algorithm_step_configurations` RENAME TO `ai_algorithm_step_configurations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_algorithm_step_configurations_key_unique` ON `ai_algorithm_step_configurations` (`configuration_version_id`,`step_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_algorithm_step_configurations_ordinal_unique` ON `ai_algorithm_step_configurations` (`configuration_version_id`,`ordinal`);
