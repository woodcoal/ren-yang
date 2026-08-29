CREATE TABLE `growth_records` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`world_id` text,
	`persona_id` text,
	`current_revision_id` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`superseded_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "growth_records_subject_type_check" CHECK("growth_records"."subject_type" IN ('world', 'persona')),
	CONSTRAINT "growth_records_subject_check" CHECK((
      ("growth_records"."subject_type" = 'world' AND "growth_records"."world_id" IS NOT NULL AND "growth_records"."persona_id" IS NULL)
      OR ("growth_records"."subject_type" = 'persona' AND "growth_records"."persona_id" IS NOT NULL AND "growth_records"."world_id" IS NULL)
    )),
	CONSTRAINT "growth_records_status_check" CHECK("growth_records"."status" IN ('candidate', 'active', 'superseded', 'archived', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `growth_records_world_status_index` ON `growth_records` (`world_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `growth_records_persona_status_index` ON `growth_records` (`persona_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `growth_revision_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`growth_revision_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`source_title` text NOT NULL,
	`relationship` text NOT NULL,
	`source_available` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`growth_revision_id`) REFERENCES `growth_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "growth_revision_evidence_source_type_check" CHECK("growth_revision_evidence"."source_type" IN ('world_source', 'persona_feedback_source')),
	CONSTRAINT "growth_revision_evidence_relationship_check" CHECK("growth_revision_evidence"."relationship" IN ('supporting', 'opposing')),
	CONSTRAINT "growth_revision_evidence_available_check" CHECK("growth_revision_evidence"."source_available" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `growth_revision_evidence_unique` ON `growth_revision_evidence` (`growth_revision_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `growth_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`growth_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`scope` text NOT NULL,
	`importance` integer NOT NULL,
	`conflict_summary` text,
	`analysis_batch_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`growth_id`) REFERENCES `growth_records`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "growth_revisions_revision_check" CHECK("growth_revisions"."revision_no" > 0),
	CONSTRAINT "growth_revisions_content_check" CHECK(length(trim("growth_revisions"."content")) > 0),
	CONSTRAINT "growth_revisions_hash_check" CHECK(length("growth_revisions"."content_hash") = 64),
	CONSTRAINT "growth_revisions_scope_check" CHECK(length(trim("growth_revisions"."scope")) > 0),
	CONSTRAINT "growth_revisions_importance_check" CHECK("growth_revisions"."importance" BETWEEN 1 AND 5),
	CONSTRAINT "growth_revisions_created_by_check" CHECK("growth_revisions"."created_by" IN ('user', 'analysis'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `growth_revisions_growth_revision_unique` ON `growth_revisions` (`growth_id`,`revision_no`);--> statement-breakpoint
CREATE TABLE `memory_records` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_id` text NOT NULL,
	`current_revision_id` text NOT NULL,
	`memory_type` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`superseded_by_id` text,
	`openviking_uri` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_records_type_check" CHECK("memory_records"."memory_type" IN ('interest', 'judgment', 'experience', 'preference')),
	CONSTRAINT "memory_records_status_check" CHECK("memory_records"."status" IN ('candidate', 'active', 'superseded', 'archived', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `memory_records_persona_status_index` ON `memory_records` (`persona_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_records_openviking_uri_unique` ON `memory_records` (`openviking_uri`);--> statement-breakpoint
CREATE TABLE `memory_revision_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_revision_id` text NOT NULL,
	`operation_record_id` text NOT NULL,
	`run_id` text NOT NULL,
	`relationship` text NOT NULL,
	FOREIGN KEY (`memory_revision_id`) REFERENCES `memory_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operation_record_id`) REFERENCES `persona_operation_records`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "memory_revision_evidence_relationship_check" CHECK("memory_revision_evidence"."relationship" IN ('supporting', 'opposing'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_revision_evidence_unique` ON `memory_revision_evidence` (`memory_revision_id`,`operation_record_id`);--> statement-breakpoint
CREATE TABLE `memory_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`scope` text NOT NULL,
	`importance` integer NOT NULL,
	`occurred_from` integer,
	`occurred_to` integer,
	`independent_evidence_count` integer NOT NULL,
	`conflict_summary` text,
	`analysis_batch_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_revisions_revision_check" CHECK("memory_revisions"."revision_no" > 0),
	CONSTRAINT "memory_revisions_content_check" CHECK(length(trim("memory_revisions"."content")) > 0),
	CONSTRAINT "memory_revisions_hash_check" CHECK(length("memory_revisions"."content_hash") = 64),
	CONSTRAINT "memory_revisions_scope_check" CHECK(length(trim("memory_revisions"."scope")) > 0),
	CONSTRAINT "memory_revisions_importance_check" CHECK("memory_revisions"."importance" BETWEEN 1 AND 5),
	CONSTRAINT "memory_revisions_evidence_count_check" CHECK("memory_revisions"."independent_evidence_count" >= 0),
	CONSTRAINT "memory_revisions_created_by_check" CHECK("memory_revisions"."created_by" IN ('user', 'analysis'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_revisions_memory_revision_unique` ON `memory_revisions` (`memory_id`,`revision_no`);--> statement-breakpoint
CREATE TABLE `persona_feedback_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`content_hash` text NOT NULL,
	`deletion_state` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "persona_feedback_sources_title_check" CHECK(length(trim("persona_feedback_sources"."title")) > 0),
	CONSTRAINT "persona_feedback_sources_content_check" CHECK(length(trim("persona_feedback_sources"."content")) > 0),
	CONSTRAINT "persona_feedback_sources_source_type_check" CHECK("persona_feedback_sources"."source_type" IN ('run_feedback', 'manual', 'imported', 'memory_conversion')),
	CONSTRAINT "persona_feedback_sources_enabled_check" CHECK("persona_feedback_sources"."is_enabled" IN (0, 1)),
	CONSTRAINT "persona_feedback_sources_hash_check" CHECK(length("persona_feedback_sources"."content_hash") = 64),
	CONSTRAINT "persona_feedback_sources_deletion_state_check" CHECK("persona_feedback_sources"."deletion_state" IN ('active', 'pending_remote_delete'))
);
--> statement-breakpoint
CREATE INDEX `persona_feedback_sources_persona_enabled_index` ON `persona_feedback_sources` (`persona_id`,`is_enabled`,`created_at`);--> statement-breakpoint
CREATE TABLE `persona_operation_records` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_id` text NOT NULL,
	`run_id` text NOT NULL,
	`operation_type` text NOT NULL,
	`result_summary` text NOT NULL,
	`decision_json` text,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`context_snapshot_json` text NOT NULL,
	`session_record_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "persona_operation_records_type_check" CHECK("persona_operation_records"."operation_type" IN ('interest_assessment', 'artifact_generation', 'content_analysis')),
	CONSTRAINT "persona_operation_records_summary_check" CHECK(length(trim("persona_operation_records"."result_summary")) > 0),
	CONSTRAINT "persona_operation_records_enabled_check" CHECK("persona_operation_records"."is_enabled" IN (0, 1)),
	CONSTRAINT "persona_operation_records_decision_json_check" CHECK("persona_operation_records"."decision_json" IS NULL OR json_valid("persona_operation_records"."decision_json")),
	CONSTRAINT "persona_operation_records_context_json_check" CHECK(json_valid("persona_operation_records"."context_snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_operation_records_run_unique` ON `persona_operation_records` (`run_id`);--> statement-breakpoint
CREATE INDEX `persona_operation_records_persona_enabled_index` ON `persona_operation_records` (`persona_id`,`is_enabled`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_world_sources` (
	`world_id` text NOT NULL,
	`source_id` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`enabled_at` integer,
	`disabled_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `source_materials`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "world_sources_priority_check" CHECK("__new_world_sources"."priority" >= 0),
	CONSTRAINT "world_sources_enabled_check" CHECK("__new_world_sources"."is_enabled" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_world_sources`("world_id", "source_id", "priority", "is_enabled", "enabled_at", "disabled_at", "updated_at") SELECT "world_id", "source_id", "priority", 1, NULL, NULL, 0 FROM `world_sources`;--> statement-breakpoint
DROP TABLE `world_sources`;--> statement-breakpoint
ALTER TABLE `__new_world_sources` RENAME TO `world_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `world_sources_unique` ON `world_sources` (`world_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `world_sources_source_id_index` ON `world_sources` (`source_id`);
