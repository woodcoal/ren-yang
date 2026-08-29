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
CREATE INDEX `iteration_proposals_batch_status_index` ON `iteration_proposals` (`analysis_batch_id`,`status`,`created_at`);