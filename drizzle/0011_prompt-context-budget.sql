DROP TRIGGER `task_jobs_run_insert_check`;--> statement-breakpoint
DROP TRIGGER `task_jobs_run_update_check`;--> statement-breakpoint
DROP TRIGGER `generation_runs_task_jobs_delete`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`persona_version_id` text NOT NULL,
	`format_template_id` text,
	`parameter_profile_id` text,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`scene_json` text,
	`parameter_snapshot_json` text NOT NULL,
	`model_snapshot_json` text NOT NULL,
	`image_model_snapshot_json` text,
	`prompt_version` text NOT NULL,
	`context_provider` text NOT NULL,
	`prompt_context_snapshot_json` text,
	`result_json` text,
	`usage_json` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`persona_version_id`) REFERENCES `soul_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`format_template_id`) REFERENCES `format_templates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parameter_profile_id`) REFERENCES `parameter_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "generation_runs_kind_check" CHECK("__new_generation_runs"."kind" IN ('interest_assessment', 'artifact_generation')),
	CONSTRAINT "generation_runs_status_check" CHECK("__new_generation_runs"."status" IN ('planning', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'partial', 'failed', 'canceled')),
	CONSTRAINT "generation_runs_context_provider_check" CHECK("__new_generation_runs"."context_provider" IN ('sqlite_fts5', 'openviking')),
	CONSTRAINT "generation_runs_prompt_context_json_check" CHECK("__new_generation_runs"."prompt_context_snapshot_json" IS NULL OR json_valid("__new_generation_runs"."prompt_context_snapshot_json"))
);
--> statement-breakpoint
INSERT INTO `__new_generation_runs`("id", "kind", "persona_version_id", "format_template_id", "parameter_profile_id", "status", "input_json", "scene_json", "parameter_snapshot_json", "model_snapshot_json", "image_model_snapshot_json", "prompt_version", "context_provider", "prompt_context_snapshot_json", "result_json", "usage_json", "error_code", "error_message", "created_at", "updated_at", "completed_at") SELECT "id", "kind", "persona_version_id", "format_template_id", "parameter_profile_id", "status", "input_json", "scene_json", "parameter_snapshot_json", "model_snapshot_json", "image_model_snapshot_json", "prompt_version", "context_provider", NULL, "result_json", "usage_json", "error_code", "error_message", "created_at", "updated_at", "completed_at" FROM `generation_runs`;--> statement-breakpoint
DROP TABLE `generation_runs`;--> statement-breakpoint
ALTER TABLE `__new_generation_runs` RENAME TO `generation_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `generation_runs_persona_version_created_at_index` ON `generation_runs` (`persona_version_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_runs_status_created_at_index` ON `generation_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `task_jobs_run_insert_check` BEFORE INSERT ON `task_jobs`
WHEN new.`run_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `generation_runs` WHERE `id` = new.`run_id`
)
BEGIN
	SELECT RAISE(ABORT, 'task job run does not exist');
END;--> statement-breakpoint
CREATE TRIGGER `task_jobs_run_update_check` BEFORE UPDATE OF `run_id` ON `task_jobs`
WHEN new.`run_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `generation_runs` WHERE `id` = new.`run_id`
)
BEGIN
	SELECT RAISE(ABORT, 'task job run does not exist');
END;--> statement-breakpoint
CREATE TRIGGER `generation_runs_task_jobs_delete` AFTER DELETE ON `generation_runs` BEGIN
	DELETE FROM `task_jobs` WHERE `run_id` = old.`id`;
END;
