ALTER TABLE `personas` ADD `automatic_learning_enabled` integer DEFAULT 0 NOT NULL CHECK (`automatic_learning_enabled` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `worlds` ADD `automatic_learning_enabled` integer DEFAULT 0 NOT NULL CHECK (`automatic_learning_enabled` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `analysis_batches` ADD `auto_publish` integer DEFAULT 0 NOT NULL CHECK (`auto_publish` IN (0, 1));
--> statement-breakpoint
CREATE TABLE `learning_automation_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`interval_hours` integer DEFAULT 24 NOT NULL,
	`next_run_at` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "learning_automation_settings_singleton_check" CHECK("learning_automation_settings"."id" = 'learning_automation_settings'),
	CONSTRAINT "learning_automation_settings_interval_check" CHECK("learning_automation_settings"."interval_hours" BETWEEN 1 AND 720)
);
--> statement-breakpoint
INSERT INTO `learning_automation_settings` (`id`, `interval_hours`, `next_run_at`, `last_run_at`, `updated_at`)
VALUES ('learning_automation_settings', 24, 0, NULL, 0);
