CREATE TABLE `artifact_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`spec_key` text NOT NULL,
	`ordinal` integer NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`role` text NOT NULL,
	`spec_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`selected_attempt_id` text,
	`is_locked` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `artifact_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifact_blocks_ordinal_check" CHECK("artifact_blocks"."ordinal" >= 0),
	CONSTRAINT "artifact_blocks_type_check" CHECK("artifact_blocks"."type" = 'text'),
	CONSTRAINT "artifact_blocks_role_check" CHECK("artifact_blocks"."role" IN ('heading', 'paragraph', 'list', 'quote')),
	CONSTRAINT "artifact_blocks_status_check" CHECK("artifact_blocks"."status" IN ('pending', 'running', 'succeeded', 'failed')),
	CONSTRAINT "artifact_blocks_locked_check" CHECK("artifact_blocks"."is_locked" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_blocks_document_ordinal_unique` ON `artifact_blocks` (`document_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_blocks_document_spec_key_unique` ON `artifact_blocks` (`document_id`,`spec_key`);--> statement-breakpoint
CREATE TABLE `artifact_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`selected_spec_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`selected_spec_id`) REFERENCES `document_specs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_documents_run_unique` ON `artifact_documents` (`run_id`);--> statement-breakpoint
CREATE TABLE `block_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`status` text NOT NULL,
	`input_snapshot_json` text NOT NULL,
	`output_text` text,
	`usage_json` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`block_id`) REFERENCES `artifact_blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "block_attempts_attempt_no_check" CHECK("block_attempts"."attempt_no" > 0),
	CONSTRAINT "block_attempts_status_check" CHECK("block_attempts"."status" IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `block_attempts_block_attempt_no_unique` ON `block_attempts` (`block_id`,`attempt_no`);--> statement-breakpoint
CREATE TABLE `document_specs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`spec_json` text NOT NULL,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_specs_revision_check" CHECK("document_specs"."revision" > 0),
	CONSTRAINT "document_specs_status_check" CHECK("document_specs"."status" IN ('draft', 'confirmed', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_specs_run_revision_unique` ON `document_specs` (`run_id`,`revision`);--> statement-breakpoint
CREATE TABLE `evidence_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source_id` text,
	`chunk_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`rank` integer NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `source_materials`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chunk_id`) REFERENCES `source_chunks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "evidence_snapshots_role_check" CHECK("evidence_snapshots"."role" IN ('user_setting', 'canon_fact', 'reference', 'style_sample')),
	CONSTRAINT "evidence_snapshots_hash_check" CHECK(length("evidence_snapshots"."content_hash") = 64),
	CONSTRAINT "evidence_snapshots_rank_check" CHECK("evidence_snapshots"."rank" >= 0)
);
--> statement-breakpoint
CREATE INDEX `evidence_snapshots_run_rank_index` ON `evidence_snapshots` (`run_id`,`rank`);--> statement-breakpoint
CREATE TABLE `format_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`spec_json` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "format_templates_name_not_empty_check" CHECK(length(trim("format_templates"."name")) > 0),
	CONSTRAINT "format_templates_version_check" CHECK("format_templates"."version" > 0),
	CONSTRAINT "format_templates_active_check" CHECK("format_templates"."is_active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `format_templates_name_version_unique` ON `format_templates` (`name`,`version`);--> statement-breakpoint
CREATE TABLE `generation_runs` (
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
	`prompt_version` text NOT NULL,
	`context_provider` text NOT NULL,
	`result_json` text,
	`usage_json` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`persona_version_id`) REFERENCES `persona_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`format_template_id`) REFERENCES `format_templates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parameter_profile_id`) REFERENCES `parameter_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "generation_runs_kind_check" CHECK("generation_runs"."kind" IN ('interest_assessment', 'artifact_generation')),
	CONSTRAINT "generation_runs_status_check" CHECK("generation_runs"."status" IN ('planning', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'partial', 'failed', 'canceled')),
	CONSTRAINT "generation_runs_context_provider_check" CHECK("generation_runs"."context_provider" IN ('sqlite_fts5', 'openviking'))
);
--> statement-breakpoint
CREATE INDEX `generation_runs_persona_version_created_at_index` ON `generation_runs` (`persona_version_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_runs_status_created_at_index` ON `generation_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `parameter_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`scope` text DEFAULT 'system' NOT NULL,
	`values_json` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "parameter_profiles_name_not_empty_check" CHECK(length(trim("parameter_profiles"."name")) > 0),
	CONSTRAINT "parameter_profiles_version_check" CHECK("parameter_profiles"."version" > 0),
	CONSTRAINT "parameter_profiles_scope_check" CHECK("parameter_profiles"."scope" IN ('system', 'persona', 'template')),
	CONSTRAINT "parameter_profiles_active_check" CHECK("parameter_profiles"."is_active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parameter_profiles_name_version_unique` ON `parameter_profiles` (`name`,`version`);
--> statement-breakpoint
CREATE TRIGGER `task_jobs_run_insert_check` BEFORE INSERT ON `task_jobs`
WHEN new.`run_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `generation_runs` WHERE `id` = new.`run_id`
)
BEGIN
	SELECT RAISE(ABORT, 'task job run does not exist');
END;
--> statement-breakpoint
CREATE TRIGGER `task_jobs_run_update_check` BEFORE UPDATE OF `run_id` ON `task_jobs`
WHEN new.`run_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `generation_runs` WHERE `id` = new.`run_id`
)
BEGIN
	SELECT RAISE(ABORT, 'task job run does not exist');
END;
--> statement-breakpoint
CREATE TRIGGER `generation_runs_task_jobs_delete` AFTER DELETE ON `generation_runs` BEGIN
	DELETE FROM `task_jobs` WHERE `run_id` = old.`id`;
END;
