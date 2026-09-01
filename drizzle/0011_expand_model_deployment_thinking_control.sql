CREATE TABLE `__new_ai_model_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`modality` text NOT NULL,
	`thinking_control` text NOT NULL DEFAULT 'none',
	`is_enabled` integer NOT NULL DEFAULT 1,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `ai_connections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_model_deployments_name_check" CHECK(length(trim("name")) > 0),
	CONSTRAINT "ai_model_deployments_model_check" CHECK(length(trim("model")) > 0),
	CONSTRAINT "ai_model_deployments_modality_check" CHECK("modality" IN ('text', 'image')),
	CONSTRAINT "ai_model_deployments_thinking_control_check" CHECK("thinking_control" IN ('none', 'enable_thinking', 'reasoning_effort', 'reasoning', 'reasoning_effort_object')),
	CONSTRAINT "ai_model_deployments_enabled_check" CHECK("is_enabled" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_ai_model_deployments` (`id`, `connection_id`, `name`, `model`, `modality`, `thinking_control`, `is_enabled`, `created_at`, `updated_at`)
SELECT `id`, `connection_id`, `name`, `model`, `modality`, `thinking_control`, `is_enabled`, `created_at`, `updated_at`
FROM `ai_model_deployments`;
--> statement-breakpoint
DROP TABLE `ai_model_deployments`;
--> statement-breakpoint
ALTER TABLE `__new_ai_model_deployments` RENAME TO `ai_model_deployments`;
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_model_deployments_name_unique` ON `ai_model_deployments` (`name`);
--> statement-breakpoint
CREATE INDEX `ai_model_deployments_connection_index` ON `ai_model_deployments` (`connection_id`, `modality`);
