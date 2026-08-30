ALTER TABLE `personas` ADD `username` text;--> statement-breakpoint
ALTER TABLE `personas` ADD `email` text;--> statement-breakpoint
ALTER TABLE `personas` ADD `password_ciphertext` text;--> statement-breakpoint
CREATE UNIQUE INDEX `personas_username_unique` ON `personas` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `personas_email_unique` ON `personas` (`email`);--> statement-breakpoint

CREATE TABLE `persona_external_records` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_id` text NOT NULL,
	`occurred_on` text NOT NULL,
	`content` text NOT NULL,
	`references_json` text DEFAULT '[]' NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`importance` integer DEFAULT 3 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "persona_external_records_occurred_on_check" CHECK(length(`occurred_on`) = 10),
	CONSTRAINT "persona_external_records_content_check" CHECK(length(trim(`content`)) > 0),
	CONSTRAINT "persona_external_records_references_json_check" CHECK(json_valid(`references_json`)),
	CONSTRAINT "persona_external_records_enabled_check" CHECK(`is_enabled` IN (0, 1)),
	CONSTRAINT "persona_external_records_importance_check" CHECK(`importance` BETWEEN 1 AND 5)
);--> statement-breakpoint
CREATE INDEX `persona_external_records_persona_enabled_index` ON `persona_external_records` (`persona_id`,`is_enabled`,`occurred_on`);--> statement-breakpoint

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_analysis_batch_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`input_type` text NOT NULL,
	`input_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`title` text NOT NULL,
	`content_snapshot` text,
	`importance` integer DEFAULT 3 NOT NULL,
	`is_new` integer DEFAULT 1 NOT NULL,
	`source_available` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `analysis_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analysis_batch_inputs_type_check" CHECK(`input_type` IN ('growth_material', 'persona_operation_record', 'persona_external_record', 'world_source', 'persona_feedback_source', 'openviking_memory')),
	CONSTRAINT "analysis_batch_inputs_hash_check" CHECK(length(`content_hash`) = 64),
	CONSTRAINT "analysis_batch_inputs_importance_check" CHECK(`importance` BETWEEN 1 AND 5),
	CONSTRAINT "analysis_batch_inputs_new_check" CHECK(`is_new` IN (0, 1)),
	CONSTRAINT "analysis_batch_inputs_available_check" CHECK(`source_available` IN (0, 1))
);--> statement-breakpoint
INSERT INTO `__new_analysis_batch_inputs` (`id`, `batch_id`, `input_type`, `input_id`, `content_hash`, `title`, `content_snapshot`, `importance`, `is_new`, `source_available`, `created_at`)
SELECT `id`, `batch_id`, `input_type`, `input_id`, `content_hash`, `title`, `content_snapshot`, `importance`, `is_new`, `source_available`, `created_at`
FROM `analysis_batch_inputs`;--> statement-breakpoint
DROP TABLE `analysis_batch_inputs`;--> statement-breakpoint
ALTER TABLE `__new_analysis_batch_inputs` RENAME TO `analysis_batch_inputs`;--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_batch_inputs_unique` ON `analysis_batch_inputs` (`batch_id`,`input_type`,`input_id`);--> statement-breakpoint
CREATE INDEX `analysis_batch_inputs_source_index` ON `analysis_batch_inputs` (`input_type`,`input_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
