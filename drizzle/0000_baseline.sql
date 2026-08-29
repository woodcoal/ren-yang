CREATE TABLE `administrators` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "administrators_singleton_check" CHECK("administrators"."id" = 'administrator'),
	CONSTRAINT "administrators_username_not_empty_check" CHECK(length(trim("administrators"."username")) > 0),
	CONSTRAINT "administrators_credential_version_check" CHECK("administrators"."credential_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `administrators_username_unique` ON `administrators` (`username`);--> statement-breakpoint
CREATE TABLE `analysis_batch_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`input_type` text NOT NULL,
	`input_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`title` text NOT NULL,
	`content_snapshot` text,
	`is_new` integer DEFAULT 1 NOT NULL,
	`source_available` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `analysis_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analysis_batch_inputs_type_check" CHECK("analysis_batch_inputs"."input_type" IN ('world_source', 'persona_feedback_source', 'persona_operation_record', 'openviking_memory')),
	CONSTRAINT "analysis_batch_inputs_hash_check" CHECK(length("analysis_batch_inputs"."content_hash") = 64),
	CONSTRAINT "analysis_batch_inputs_new_check" CHECK("analysis_batch_inputs"."is_new" IN (0, 1)),
	CONSTRAINT "analysis_batch_inputs_available_check" CHECK("analysis_batch_inputs"."source_available" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_batch_inputs_unique` ON `analysis_batch_inputs` (`batch_id`,`input_type`,`input_id`);--> statement-breakpoint
CREATE INDEX `analysis_batch_inputs_source_index` ON `analysis_batch_inputs` (`input_type`,`input_id`);--> statement-breakpoint
CREATE TABLE `analysis_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_type` text NOT NULL,
	`world_id` text,
	`persona_id` text,
	`mode` text NOT NULL,
	`baseline_soul_version_id` text NOT NULL,
	`baseline_json` text NOT NULL,
	`model_snapshot_json` text NOT NULL,
	`parameter_snapshot_json` text NOT NULL,
	`prompt_version` text NOT NULL,
	`raw_result_json` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`baseline_soul_version_id`) REFERENCES `soul_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "analysis_batches_type_check" CHECK("analysis_batches"."analysis_type" IN ('world_growth', 'persona_growth', 'persona_memory')),
	CONSTRAINT "analysis_batches_subject_check" CHECK((
      ("analysis_batches"."analysis_type" = 'world_growth' AND "analysis_batches"."world_id" IS NOT NULL AND "analysis_batches"."persona_id" IS NULL)
      OR ("analysis_batches"."analysis_type" IN ('persona_growth', 'persona_memory') AND "analysis_batches"."persona_id" IS NOT NULL AND "analysis_batches"."world_id" IS NULL)
    )),
	CONSTRAINT "analysis_batches_mode_check" CHECK("analysis_batches"."mode" IN ('incremental', 'full_rebuild')),
	CONSTRAINT "analysis_batches_status_check" CHECK("analysis_batches"."status" IN ('queued', 'running', 'awaiting_review', 'completed', 'failed')),
	CONSTRAINT "analysis_batches_baseline_json_check" CHECK(json_valid("analysis_batches"."baseline_json")),
	CONSTRAINT "analysis_batches_model_json_check" CHECK(json_valid("analysis_batches"."model_snapshot_json")),
	CONSTRAINT "analysis_batches_parameter_json_check" CHECK(json_valid("analysis_batches"."parameter_snapshot_json")),
	CONSTRAINT "analysis_batches_raw_json_check" CHECK("analysis_batches"."raw_result_json" IS NULL OR json_valid("analysis_batches"."raw_result_json"))
);
--> statement-breakpoint
CREATE INDEX `analysis_batches_world_type_created_index` ON `analysis_batches` (`world_id`,`analysis_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `analysis_batches_persona_type_created_index` ON `analysis_batches` (`persona_id`,`analysis_type`,`created_at`);--> statement-breakpoint
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
	`selected_at` integer,
	`locked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `artifact_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifact_blocks_ordinal_check" CHECK("artifact_blocks"."ordinal" >= 0),
	CONSTRAINT "artifact_blocks_type_check" CHECK("artifact_blocks"."type" IN ('text', 'image')),
	CONSTRAINT "artifact_blocks_role_check" CHECK("artifact_blocks"."role" IN ('heading', 'paragraph', 'list', 'quote', 'hero_image', 'illustration')),
	CONSTRAINT "artifact_blocks_status_check" CHECK("artifact_blocks"."status" IN ('pending', 'running', 'succeeded', 'failed', 'canceled')),
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
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "audit_events_actor_check" CHECK("audit_events"."actor" IN ('administrator', 'maintenance', 'system')),
	CONSTRAINT "audit_events_action_check" CHECK(length(trim("audit_events"."action")) > 0),
	CONSTRAINT "audit_events_target_type_check" CHECK(length(trim("audit_events"."target_type")) > 0),
	CONSTRAINT "audit_events_details_json_check" CHECK(json_valid("audit_events"."details_json"))
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_at_index` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_action_created_at_index` ON `audit_events` (`action`,`created_at`);--> statement-breakpoint
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
CREATE TABLE `context_sync_records` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text DEFAULT 'source_material' NOT NULL,
	`source_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`user_id` text NOT NULL,
	`peer_id` text,
	`provider` text NOT NULL,
	`remote_uri` text,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`operation` text DEFAULT 'upsert' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "context_sync_records_provider_check" CHECK("context_sync_records"."provider" IN ('openviking')),
	CONSTRAINT "context_sync_records_entity_type_check" CHECK("context_sync_records"."entity_type" IN ('source_material', 'persona_feedback_source', 'growth', 'memory')),
	CONSTRAINT "context_sync_records_scope_type_check" CHECK("context_sync_records"."scope_type" IN ('world', 'persona')),
	CONSTRAINT "context_sync_records_status_check" CHECK("context_sync_records"."status" IN ('pending', 'synchronized', 'failed')),
	CONSTRAINT "context_sync_records_operation_check" CHECK("context_sync_records"."operation" IN ('upsert', 'delete')),
	CONSTRAINT "context_sync_records_hash_check" CHECK(length("context_sync_records"."content_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_sync_records_projection_unique` ON `context_sync_records` (`entity_type`,`source_id`,`scope_type`,`scope_id`,`provider`);--> statement-breakpoint
CREATE INDEX `context_sync_records_provider_status_index` ON `context_sync_records` (`provider`,`status`);--> statement-breakpoint
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
CREATE TABLE `evaluation_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`prompt` text NOT NULL,
	`expected_change` text NOT NULL,
	`assertions_json` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "evaluation_cases_name_check" CHECK(length(trim("evaluation_cases"."name")) > 0),
	CONSTRAINT "evaluation_cases_category_check" CHECK("evaluation_cases"."category" IN ('behavior', 'style', 'safety')),
	CONSTRAINT "evaluation_cases_expected_change_check" CHECK("evaluation_cases"."expected_change" IN ('improve', 'retain')),
	CONSTRAINT "evaluation_cases_active_check" CHECK("evaluation_cases"."is_active" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_cases_persona_name_unique` ON `evaluation_cases` (`persona_id`,`name`);--> statement-breakpoint
CREATE INDEX `evaluation_cases_persona_active_index` ON `evaluation_cases` (`persona_id`,`is_active`);--> statement-breakpoint
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
	CONSTRAINT "evidence_snapshots_role_check" CHECK("evidence_snapshots"."role" IN ('user_setting', 'canon_fact', 'reference', 'style_sample', 'growth', 'memory')),
	CONSTRAINT "evidence_snapshots_hash_check" CHECK(length("evidence_snapshots"."content_hash") = 64),
	CONSTRAINT "evidence_snapshots_rank_check" CHECK("evidence_snapshots"."rank" >= 0)
);
--> statement-breakpoint
CREATE INDEX `evidence_snapshots_run_rank_index` ON `evidence_snapshots` (`run_id`,`rank`);--> statement-breakpoint
CREATE TABLE `feedback_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`block_id` text,
	`content` text NOT NULL,
	`rating` text,
	`is_long_term` integer DEFAULT 0 NOT NULL,
	`edited_output` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `artifact_blocks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "feedback_events_content_check" CHECK(length(trim("feedback_events"."content")) > 0),
	CONSTRAINT "feedback_events_rating_check" CHECK("feedback_events"."rating" IS NULL OR "feedback_events"."rating" IN ('positive', 'negative', 'neutral')),
	CONSTRAINT "feedback_events_long_term_check" CHECK("feedback_events"."is_long_term" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `feedback_events_run_created_at_index` ON `feedback_events` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `feedback_resolutions` (
	`feedback_id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`resolution_json` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "feedback_resolutions_target_check" CHECK("feedback_resolutions"."target_type" IN ('artifact', 'parameters', 'persona', 'source_fact'))
);
--> statement-breakpoint
CREATE TABLE `feedback_suggestions` (
	`feedback_id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`confidence_millionths` integer NOT NULL,
	`rationale` text NOT NULL,
	`model_snapshot_json` text NOT NULL,
	`parameter_snapshot_json` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "feedback_suggestions_target_check" CHECK("feedback_suggestions"."target_type" IN ('artifact', 'parameters', 'persona', 'source_fact')),
	CONSTRAINT "feedback_suggestions_confidence_check" CHECK("feedback_suggestions"."confidence_millionths" BETWEEN 0 AND 1000000)
);
--> statement-breakpoint
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
	CONSTRAINT "generation_runs_kind_check" CHECK("generation_runs"."kind" IN ('interest_assessment', 'artifact_generation')),
	CONSTRAINT "generation_runs_status_check" CHECK("generation_runs"."status" IN ('planning', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'partial', 'failed', 'canceled')),
	CONSTRAINT "generation_runs_context_provider_check" CHECK("generation_runs"."context_provider" IN ('sqlite_fts5', 'openviking')),
	CONSTRAINT "generation_runs_prompt_context_json_check" CHECK("generation_runs"."prompt_context_snapshot_json" IS NULL OR json_valid("generation_runs"."prompt_context_snapshot_json"))
);
--> statement-breakpoint
CREATE INDEX `generation_runs_persona_version_created_at_index` ON `generation_runs` (`persona_version_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_runs_status_created_at_index` ON `generation_runs` (`status`,`created_at`);--> statement-breakpoint
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
CREATE TABLE `image_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`media_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_hash` text NOT NULL,
	`alt_text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `block_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "image_assets_path_check" CHECK("image_assets"."relative_path" GLOB 'assets/*' AND instr("image_assets"."relative_path", '..') = 0),
	CONSTRAINT "image_assets_media_type_check" CHECK("image_assets"."media_type" IN ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "image_assets_size_check" CHECK("image_assets"."size_bytes" > 0 AND "image_assets"."size_bytes" <= 10485760),
	CONSTRAINT "image_assets_hash_check" CHECK(length("image_assets"."content_hash") = 64),
	CONSTRAINT "image_assets_alt_text_check" CHECK(length(trim("image_assets"."alt_text")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_assets_attempt_unique` ON `image_assets` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `image_assets_relative_path_unique` ON `image_assets` (`relative_path`);--> statement-breakpoint
CREATE TABLE `iteration_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_batch_id` text NOT NULL,
	`operation` text NOT NULL,
	`target_type` text NOT NULL,
	`target_ids_json` text NOT NULL,
	`before_json` text NOT NULL,
	`proposed_json` text,
	`reviewed_json` text,
	`evidence_input_ids_json` text NOT NULL,
	`conflicts_json` text NOT NULL,
	`rationale` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`analysis_batch_id`) REFERENCES `analysis_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "iteration_proposals_operation_check" CHECK("iteration_proposals"."operation" IN ('add', 'revise', 'merge', 'supersede', 'archive', 'no_change')),
	CONSTRAINT "iteration_proposals_target_type_check" CHECK("iteration_proposals"."target_type" IN ('growth', 'memory')),
	CONSTRAINT "iteration_proposals_status_check" CHECK("iteration_proposals"."status" IN ('pending', 'accepted', 'rejected', 'applied')),
	CONSTRAINT "iteration_proposals_target_json_check" CHECK(json_valid("iteration_proposals"."target_ids_json")),
	CONSTRAINT "iteration_proposals_before_json_check" CHECK(json_valid("iteration_proposals"."before_json")),
	CONSTRAINT "iteration_proposals_proposed_json_check" CHECK("iteration_proposals"."proposed_json" IS NULL OR json_valid("iteration_proposals"."proposed_json")),
	CONSTRAINT "iteration_proposals_reviewed_json_check" CHECK("iteration_proposals"."reviewed_json" IS NULL OR json_valid("iteration_proposals"."reviewed_json")),
	CONSTRAINT "iteration_proposals_evidence_json_check" CHECK(json_valid("iteration_proposals"."evidence_input_ids_json")),
	CONSTRAINT "iteration_proposals_conflicts_json_check" CHECK(json_valid("iteration_proposals"."conflicts_json"))
);
--> statement-breakpoint
CREATE INDEX `iteration_proposals_batch_status_index` ON `iteration_proposals` (`analysis_batch_id`,`status`,`created_at`);--> statement-breakpoint
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
CREATE TABLE `openviking_derived_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_id` text NOT NULL,
	`source_session_record_id` text NOT NULL,
	`user_id` text NOT NULL,
	`peer_id` text NOT NULL,
	`remote_uri` text NOT NULL,
	`memory_type` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_session_record_id`) REFERENCES `openviking_session_records`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openviking_derived_memories_type_check" CHECK(length(trim("openviking_derived_memories"."memory_type")) > 0),
	CONSTRAINT "openviking_derived_memories_content_check" CHECK(length(trim("openviking_derived_memories"."content")) > 0),
	CONSTRAINT "openviking_derived_memories_hash_check" CHECK(length("openviking_derived_memories"."content_hash") = 64),
	CONSTRAINT "openviking_derived_memories_enabled_check" CHECK("openviking_derived_memories"."is_enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openviking_derived_memories_identity_uri_unique` ON `openviking_derived_memories` (`user_id`,`peer_id`,`remote_uri`);--> statement-breakpoint
CREATE INDEX `openviking_derived_memories_persona_enabled_index` ON `openviking_derived_memories` (`persona_id`,`is_enabled`,`updated_at`);--> statement-breakpoint
CREATE TABLE `openviking_session_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`user_id` text NOT NULL,
	`peer_id` text NOT NULL,
	`remote_session_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "openviking_session_records_source_type_check" CHECK("openviking_session_records"."source_type" IN ('run', 'feedback')),
	CONSTRAINT "openviking_session_records_status_check" CHECK("openviking_session_records"."status" IN ('pending', 'synchronized', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openviking_session_records_source_unique` ON `openviking_session_records` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `openviking_session_records_status_index` ON `openviking_session_records` (`status`,`updated_at`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `parameter_profiles_name_version_unique` ON `parameter_profiles` (`name`,`version`);--> statement-breakpoint
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
CREATE TABLE `persona_sources` (
	`persona_id` text NOT NULL,
	`source_id` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `source_materials`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "persona_sources_priority_check" CHECK("persona_sources"."priority" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_sources_unique` ON `persona_sources` (`persona_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `persona_sources_source_id_index` ON `persona_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`active_soul_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "personas_name_not_empty_check" CHECK(length(trim("personas"."name")) > 0),
	CONSTRAINT "personas_origin_check" CHECK("personas"."origin" IN ('original', 'source_based', 'hybrid'))
);
--> statement-breakpoint
CREATE INDEX `personas_world_id_index` ON `personas` (`world_id`);--> statement-breakpoint
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
CREATE TABLE `source_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`heading` text,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source_materials`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_chunks_ordinal_check" CHECK("source_chunks"."ordinal" >= 0),
	CONSTRAINT "source_chunks_content_not_empty_check" CHECK(length(trim("source_chunks"."content")) > 0),
	CONSTRAINT "source_chunks_hash_check" CHECK(length("source_chunks"."content_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_chunks_source_ordinal_unique` ON `source_chunks` (`source_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `source_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`input_type` text NOT NULL,
	`content_hash` text NOT NULL,
	`content_text` text NOT NULL,
	`original_file_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "source_materials_name_not_empty_check" CHECK(length(trim("source_materials"."name")) > 0),
	CONSTRAINT "source_materials_role_check" CHECK("source_materials"."role" IN ('canon_fact', 'reference', 'style_sample')),
	CONSTRAINT "source_materials_input_type_check" CHECK("source_materials"."input_type" IN ('paste', 'txt', 'markdown')),
	CONSTRAINT "source_materials_hash_check" CHECK(length("source_materials"."content_hash") = 64),
	CONSTRAINT "source_materials_content_not_empty_check" CHECK(length(trim("source_materials"."content_text")) > 0)
);
--> statement-breakpoint
CREATE INDEX `source_materials_created_at_index` ON `source_materials` (`created_at`);--> statement-breakpoint
CREATE TABLE `task_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 2 NOT NULL,
	`lease_until` integer,
	`heartbeat_at` integer,
	`cancel_requested_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "task_jobs_status_check" CHECK("task_jobs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'canceled')),
	CONSTRAINT "task_jobs_attempt_count_check" CHECK("task_jobs"."attempt_count" >= 0),
	CONSTRAINT "task_jobs_max_attempts_check" CHECK("task_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE INDEX `task_jobs_status_created_at_index` ON `task_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_jobs_lease_until_index` ON `task_jobs` (`lease_until`);--> statement-breakpoint
CREATE TABLE `world_sources` (
	`world_id` text NOT NULL,
	`source_id` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`enabled_at` integer,
	`disabled_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `source_materials`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "world_sources_priority_check" CHECK("world_sources"."priority" >= 0),
	CONSTRAINT "world_sources_enabled_check" CHECK("world_sources"."is_enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `world_sources_unique` ON `world_sources` (`world_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `world_sources_source_id_index` ON `world_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`active_soul_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "worlds_name_not_empty_check" CHECK(length(trim("worlds"."name")) > 0)
);

--> statement-breakpoint
-- Drizzle Schema 无法表达的 SQLite FTS5 与跨表完整性触发器。
CREATE VIRTUAL TABLE `learning_fts` USING fts5(
	`entity_type` UNINDEXED,
	`entity_id` UNINDEXED,
	`subject_id` UNINDEXED,
	`content`,
	tokenize='trigram'
);--> statement-breakpoint
CREATE VIRTUAL TABLE `source_chunks_fts` USING fts5(
	`heading`,
	`content`,
	content=`source_chunks`,
	content_rowid=`rowid`,
	tokenize='trigram'
);--> statement-breakpoint
CREATE TRIGGER `generation_runs_task_jobs_delete` AFTER DELETE ON `generation_runs` BEGIN
	DELETE FROM `task_jobs` WHERE `run_id` = old.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `growth_records_learning_fts_delete` AFTER DELETE ON `growth_records` BEGIN
	DELETE FROM `learning_fts` WHERE `entity_type` IN ('world_growth', 'persona_growth') AND `entity_id` = old.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `growth_records_learning_fts_insert` AFTER INSERT ON `growth_records` WHEN new.`status` = 'active' BEGIN
	INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
	SELECT CASE new.`subject_type` WHEN 'world' THEN 'world_growth' ELSE 'persona_growth' END,
		new.`id`, COALESCE(new.`world_id`, new.`persona_id`), `growth_revisions`.`content`
	FROM `growth_revisions` WHERE `growth_revisions`.`id` = new.`current_revision_id`;
END;--> statement-breakpoint
CREATE TRIGGER `growth_records_learning_fts_update` AFTER UPDATE ON `growth_records` BEGIN
	DELETE FROM `learning_fts` WHERE `entity_type` IN ('world_growth', 'persona_growth') AND `entity_id` = old.`id`;
	INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
	SELECT CASE new.`subject_type` WHEN 'world' THEN 'world_growth' ELSE 'persona_growth' END,
		new.`id`, COALESCE(new.`world_id`, new.`persona_id`), `growth_revisions`.`content`
	FROM `growth_revisions` WHERE `growth_revisions`.`id` = new.`current_revision_id` AND new.`status` = 'active';
END;--> statement-breakpoint
CREATE TRIGGER `memory_records_learning_fts_delete` AFTER DELETE ON `memory_records` BEGIN
	DELETE FROM `learning_fts` WHERE `entity_type` = 'memory' AND `entity_id` = old.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `memory_records_learning_fts_insert` AFTER INSERT ON `memory_records` WHEN new.`status` = 'active' BEGIN
	INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
	SELECT 'memory', new.`id`, new.`persona_id`, `memory_revisions`.`content`
	FROM `memory_revisions` WHERE `memory_revisions`.`id` = new.`current_revision_id`;
END;--> statement-breakpoint
CREATE TRIGGER `memory_records_learning_fts_update` AFTER UPDATE ON `memory_records` BEGIN
	DELETE FROM `learning_fts` WHERE `entity_type` = 'memory' AND `entity_id` = old.`id`;
	INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
	SELECT 'memory', new.`id`, new.`persona_id`, `memory_revisions`.`content`
	FROM `memory_revisions` WHERE `memory_revisions`.`id` = new.`current_revision_id` AND new.`status` = 'active';
END;--> statement-breakpoint
CREATE TRIGGER `source_chunks_fts_delete` AFTER DELETE ON `source_chunks` BEGIN
	INSERT INTO `source_chunks_fts` (`source_chunks_fts`, `rowid`, `heading`, `content`)
	VALUES ('delete', old.`rowid`, old.`heading`, old.`content`);
END;--> statement-breakpoint
CREATE TRIGGER `source_chunks_fts_insert` AFTER INSERT ON `source_chunks` BEGIN
	INSERT INTO `source_chunks_fts` (`rowid`, `heading`, `content`)
	VALUES (new.`rowid`, new.`heading`, new.`content`);
END;--> statement-breakpoint
CREATE TRIGGER `source_chunks_fts_update` AFTER UPDATE ON `source_chunks` BEGIN
	INSERT INTO `source_chunks_fts` (`source_chunks_fts`, `rowid`, `heading`, `content`)
	VALUES ('delete', old.`rowid`, old.`heading`, old.`content`);
	INSERT INTO `source_chunks_fts` (`rowid`, `heading`, `content`)
	VALUES (new.`rowid`, new.`heading`, new.`content`);
END;--> statement-breakpoint
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
END;
