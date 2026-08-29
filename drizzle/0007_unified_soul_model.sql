DELETE FROM `evaluation_results`;--> statement-breakpoint
DELETE FROM `evaluation_runs`;--> statement-breakpoint
DELETE FROM `evaluation_cases`;--> statement-breakpoint
DELETE FROM `revision_proposals`;--> statement-breakpoint
DELETE FROM `candidate_memories`;--> statement-breakpoint
DELETE FROM `feedback_resolutions`;--> statement-breakpoint
DELETE FROM `feedback_suggestions`;--> statement-breakpoint
DELETE FROM `feedback_events`;--> statement-breakpoint
DELETE FROM `image_assets`;--> statement-breakpoint
DELETE FROM `block_attempts`;--> statement-breakpoint
DELETE FROM `artifact_blocks`;--> statement-breakpoint
DELETE FROM `artifact_documents`;--> statement-breakpoint
DELETE FROM `document_specs`;--> statement-breakpoint
DELETE FROM `evidence_snapshots`;--> statement-breakpoint
DELETE FROM `task_jobs`;--> statement-breakpoint
DELETE FROM `generation_runs`;--> statement-breakpoint
DELETE FROM `openviking_session_records`;--> statement-breakpoint
DELETE FROM `persona_growth_records`;--> statement-breakpoint
DELETE FROM `persona_memories`;--> statement-breakpoint
DELETE FROM `context_sync_records`;--> statement-breakpoint
DELETE FROM `persona_sources`;--> statement-breakpoint
DELETE FROM `world_sources`;--> statement-breakpoint
DELETE FROM `source_chunks`;--> statement-breakpoint
DELETE FROM `source_materials`;--> statement-breakpoint
DELETE FROM `persona_versions`;--> statement-breakpoint
DELETE FROM `world_versions`;--> statement-breakpoint
DELETE FROM `personas`;--> statement-breakpoint
DELETE FROM `worlds`;--> statement-breakpoint
DELETE FROM `format_templates`;--> statement-breakpoint
DELETE FROM `parameter_profiles`;--> statement-breakpoint
DELETE FROM `audit_events`;--> statement-breakpoint
CREATE TABLE `soul_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`world_id` text,
	`persona_id` text,
	`base_version_id` text,
	`chapters_json` text NOT NULL,
	`runtime_summary` text NOT NULL,
	`change_summary` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "soul_drafts_subject_type_check" CHECK("soul_drafts"."subject_type" IN ('world', 'persona')),
	CONSTRAINT "soul_drafts_subject_check" CHECK((
      ("soul_drafts"."subject_type" = 'world' AND "soul_drafts"."world_id" IS NOT NULL AND "soul_drafts"."persona_id" IS NULL)
      OR ("soul_drafts"."subject_type" = 'persona' AND "soul_drafts"."persona_id" IS NOT NULL AND "soul_drafts"."world_id" IS NULL)
    )),
	CONSTRAINT "soul_drafts_runtime_summary_not_empty_check" CHECK(length(trim("soul_drafts"."runtime_summary")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `soul_drafts_world_unique` ON `soul_drafts` (`world_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `soul_drafts_persona_unique` ON `soul_drafts` (`persona_id`);--> statement-breakpoint
CREATE TABLE `soul_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`world_id` text,
	`persona_id` text,
	`parent_version_id` text,
	`chapters_json` text NOT NULL,
	`runtime_summary` text NOT NULL,
	`runtime_token_count` integer NOT NULL,
	`token_counter` text NOT NULL,
	`change_summary` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "soul_versions_subject_type_check" CHECK("soul_versions"."subject_type" IN ('world', 'persona')),
	CONSTRAINT "soul_versions_subject_check" CHECK((
      ("soul_versions"."subject_type" = 'world' AND "soul_versions"."world_id" IS NOT NULL AND "soul_versions"."persona_id" IS NULL)
      OR ("soul_versions"."subject_type" = 'persona' AND "soul_versions"."persona_id" IS NOT NULL AND "soul_versions"."world_id" IS NULL)
    )),
	CONSTRAINT "soul_versions_status_check" CHECK("soul_versions"."status" IN ('published', 'archived', 'rejected')),
	CONSTRAINT "soul_versions_runtime_summary_not_empty_check" CHECK(length(trim("soul_versions"."runtime_summary")) > 0),
	CONSTRAINT "soul_versions_runtime_token_count_check" CHECK("soul_versions"."runtime_token_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `soul_versions_world_created_at_index` ON `soul_versions` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `soul_versions_persona_created_at_index` ON `soul_versions` (`persona_id`,`created_at`);--> statement-breakpoint
DROP TABLE `persona_versions`;--> statement-breakpoint
DROP TABLE `world_versions`;--> statement-breakpoint
CREATE TABLE `__new_evaluation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`candidate_version_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`model_snapshot_json` text NOT NULL,
	`parameter_snapshot_json` text NOT NULL,
	`prompt_version` text NOT NULL,
	`passed_cases` integer DEFAULT 0 NOT NULL,
	`total_cases` integer NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`proposal_id`) REFERENCES `revision_proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_version_id`) REFERENCES `soul_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "evaluation_runs_status_check" CHECK("__new_evaluation_runs"."status" IN ('queued', 'running', 'passed', 'failed')),
	CONSTRAINT "evaluation_runs_count_check" CHECK("__new_evaluation_runs"."passed_cases" >= 0 AND "__new_evaluation_runs"."total_cases" > 0 AND "__new_evaluation_runs"."passed_cases" <= "__new_evaluation_runs"."total_cases")
);
--> statement-breakpoint
INSERT INTO `__new_evaluation_runs`("id", "proposal_id", "candidate_version_id", "status", "model_snapshot_json", "parameter_snapshot_json", "prompt_version", "passed_cases", "total_cases", "error_code", "error_message", "created_at", "completed_at") SELECT "id", "proposal_id", "candidate_version_id", "status", "model_snapshot_json", "parameter_snapshot_json", "prompt_version", "passed_cases", "total_cases", "error_code", "error_message", "created_at", "completed_at" FROM `evaluation_runs`;--> statement-breakpoint
DROP TABLE `evaluation_runs`;--> statement-breakpoint
ALTER TABLE `__new_evaluation_runs` RENAME TO `evaluation_runs`;--> statement-breakpoint
CREATE INDEX `evaluation_runs_proposal_created_index` ON `evaluation_runs` (`proposal_id`,`created_at`);--> statement-breakpoint
DROP TRIGGER `task_jobs_run_insert_check`;--> statement-breakpoint
DROP TRIGGER `task_jobs_run_update_check`;--> statement-breakpoint
DROP TRIGGER `generation_runs_task_jobs_delete`;--> statement-breakpoint
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
	CONSTRAINT "generation_runs_context_provider_check" CHECK("__new_generation_runs"."context_provider" IN ('sqlite_fts5', 'openviking'))
);
--> statement-breakpoint
INSERT INTO `__new_generation_runs`("id", "kind", "persona_version_id", "format_template_id", "parameter_profile_id", "status", "input_json", "scene_json", "parameter_snapshot_json", "model_snapshot_json", "image_model_snapshot_json", "prompt_version", "context_provider", "result_json", "usage_json", "error_code", "error_message", "created_at", "updated_at", "completed_at") SELECT "id", "kind", "persona_version_id", "format_template_id", "parameter_profile_id", "status", "input_json", "scene_json", "parameter_snapshot_json", "model_snapshot_json", "image_model_snapshot_json", "prompt_version", "context_provider", "result_json", "usage_json", "error_code", "error_message", "created_at", "updated_at", "completed_at" FROM `generation_runs`;--> statement-breakpoint
DROP TABLE `generation_runs`;--> statement-breakpoint
ALTER TABLE `__new_generation_runs` RENAME TO `generation_runs`;--> statement-breakpoint
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
END;--> statement-breakpoint
CREATE TABLE `__new_revision_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`base_version_id` text NOT NULL,
	`candidate_version_id` text NOT NULL,
	`risk_level` text NOT NULL,
	`status` text DEFAULT 'awaiting_evaluation' NOT NULL,
	`patches_json` text NOT NULL,
	`risk_reasons_json` text NOT NULL,
	`has_evidence_conflict` integer DEFAULT 0 NOT NULL,
	`latest_evaluation_run_id` text,
	`decision_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_version_id`) REFERENCES `soul_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_version_id`) REFERENCES `soul_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "revision_proposals_risk_check" CHECK("__new_revision_proposals"."risk_level" IN ('low', 'high', 'critical')),
	CONSTRAINT "revision_proposals_status_check" CHECK("__new_revision_proposals"."status" IN ('awaiting_evaluation', 'evaluation_failed', 'ready', 'published', 'rejected')),
	CONSTRAINT "revision_proposals_conflict_check" CHECK("__new_revision_proposals"."has_evidence_conflict" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_revision_proposals`("id", "feedback_id", "persona_id", "base_version_id", "candidate_version_id", "risk_level", "status", "patches_json", "risk_reasons_json", "has_evidence_conflict", "latest_evaluation_run_id", "decision_reason", "created_at", "updated_at") SELECT "id", "feedback_id", "persona_id", "base_version_id", "candidate_version_id", "risk_level", "status", "patches_json", "risk_reasons_json", "has_evidence_conflict", "latest_evaluation_run_id", "decision_reason", "created_at", "updated_at" FROM `revision_proposals`;--> statement-breakpoint
DROP TABLE `revision_proposals`;--> statement-breakpoint
ALTER TABLE `__new_revision_proposals` RENAME TO `revision_proposals`;--> statement-breakpoint
CREATE UNIQUE INDEX `revision_proposals_feedback_unique` ON `revision_proposals` (`feedback_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `revision_proposals_candidate_version_unique` ON `revision_proposals` (`candidate_version_id`);--> statement-breakpoint
CREATE INDEX `revision_proposals_persona_status_created_index` ON `revision_proposals` (`persona_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_evidence_snapshots` (
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
	CONSTRAINT "evidence_snapshots_role_check" CHECK("__new_evidence_snapshots"."role" IN ('user_setting', 'canon_fact', 'reference', 'style_sample', 'growth', 'memory')),
	CONSTRAINT "evidence_snapshots_hash_check" CHECK(length("__new_evidence_snapshots"."content_hash") = 64),
	CONSTRAINT "evidence_snapshots_rank_check" CHECK("__new_evidence_snapshots"."rank" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_evidence_snapshots`("id", "run_id", "source_id", "chunk_id", "role", "content", "content_hash", "rank", "metadata_json", "created_at") SELECT "id", "run_id", "source_id", "chunk_id", "role", "content", "content_hash", "rank", "metadata_json", "created_at" FROM `evidence_snapshots`;--> statement-breakpoint
DROP TABLE `evidence_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_evidence_snapshots` RENAME TO `evidence_snapshots`;--> statement-breakpoint
CREATE INDEX `evidence_snapshots_run_rank_index` ON `evidence_snapshots` (`run_id`,`rank`);--> statement-breakpoint
ALTER TABLE `personas` ADD `active_soul_version_id` text;--> statement-breakpoint
ALTER TABLE `personas` DROP COLUMN `active_version_id`;--> statement-breakpoint
ALTER TABLE `worlds` ADD `active_soul_version_id` text;--> statement-breakpoint
ALTER TABLE `worlds` DROP COLUMN `active_version_id`;
