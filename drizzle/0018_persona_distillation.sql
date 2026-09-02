ALTER TABLE `source_materials` ADD `origin_url` text;
--> statement-breakpoint
ALTER TABLE `source_materials` ADD `author_name` text;
--> statement-breakpoint
ALTER TABLE `source_materials` ADD `published_at` integer;
--> statement-breakpoint
ALTER TABLE `source_materials` ADD `original_source_key` text;
--> statement-breakpoint
CREATE TABLE `persona_distillation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`retry_of_run_id` text,
	`status` text DEFAULT 'assessing_sources' NOT NULL,
	`requested_name` text NOT NULL,
	`objective` text NOT NULL,
	`world_id` text,
	`provider` text NOT NULL,
	`coverage_snapshot_json` text,
	`algorithm_snapshot_json` text NOT NULL,
	`raw_extraction_json` text,
	`validated_extraction_json` text,
	`quality_gate_json` text,
	`candidate_name` text,
	`candidate_prompt_text` text,
	`candidate_prompt_hash` text,
	`evaluated_prompt_hash` text,
	`reviewed_prompt_text` text,
	`created_persona_id` text,
	`error_code` text,
	`error_message` text,
	`source_reviewed_at` integer,
	`canceled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`retry_of_run_id`) REFERENCES `persona_distillation_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `persona_distillation_runs_status_check` CHECK(`status` IN ('assessing_sources', 'awaiting_source_review', 'extracting', 'synthesizing', 'evaluating', 'awaiting_candidate_review', 'completed', 'failed', 'canceled')),
	CONSTRAINT `persona_distillation_runs_name_check` CHECK(length(trim(`requested_name`)) BETWEEN 1 AND 100),
	CONSTRAINT `persona_distillation_runs_objective_check` CHECK(length(trim(`objective`)) BETWEEN 1 AND 20000),
	CONSTRAINT `persona_distillation_runs_provider_check` CHECK(`provider` IN ('sqlite_fts5', 'openviking')),
	CONSTRAINT `persona_distillation_runs_coverage_json_check` CHECK(`coverage_snapshot_json` IS NULL OR json_valid(`coverage_snapshot_json`)),
	CONSTRAINT `persona_distillation_runs_algorithm_json_check` CHECK(json_valid(`algorithm_snapshot_json`)),
	CONSTRAINT `persona_distillation_runs_raw_json_check` CHECK(`raw_extraction_json` IS NULL OR json_valid(`raw_extraction_json`)),
	CONSTRAINT `persona_distillation_runs_validated_json_check` CHECK(`validated_extraction_json` IS NULL OR json_valid(`validated_extraction_json`)),
	CONSTRAINT `persona_distillation_runs_quality_json_check` CHECK(`quality_gate_json` IS NULL OR json_valid(`quality_gate_json`)),
	CONSTRAINT `persona_distillation_runs_candidate_hash_check` CHECK(`candidate_prompt_hash` IS NULL OR length(`candidate_prompt_hash`) = 64),
	CONSTRAINT `persona_distillation_runs_evaluated_hash_check` CHECK(`evaluated_prompt_hash` IS NULL OR length(`evaluated_prompt_hash`) = 64),
	CONSTRAINT `persona_distillation_runs_candidate_check` CHECK((`candidate_prompt_text` IS NULL AND `candidate_prompt_hash` IS NULL) OR (length(trim(`candidate_prompt_text`)) > 0 AND length(`candidate_prompt_hash`) = 64)),
	CONSTRAINT `persona_distillation_runs_completed_check` CHECK(`status` <> 'completed' OR (`created_persona_id` IS NOT NULL AND `completed_at` IS NOT NULL)),
	CONSTRAINT `persona_distillation_runs_canceled_check` CHECK(`status` <> 'canceled' OR `canceled_at` IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `persona_distillation_runs_status_updated_index` ON `persona_distillation_runs` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `persona_distillation_runs_created_persona_index` ON `persona_distillation_runs` (`created_persona_id`);
--> statement-breakpoint
CREATE TABLE `persona_distillation_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`input_type` text NOT NULL,
	`source_id` text,
	`name` text NOT NULL,
	`source_role` text,
	`source_relation` text,
	`coverage_dimensions_json` text DEFAULT '[]' NOT NULL,
	`independent_source_key` text,
	`content_hash` text NOT NULL,
	`content_snapshot` text,
	`source_available` integer DEFAULT 1 NOT NULL,
	`accepted` integer DEFAULT 1 NOT NULL,
	`origin_url` text,
	`author_name` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `persona_distillation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `source_materials`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `persona_distillation_inputs_type_check` CHECK(`input_type` IN ('source_material', 'user_statement')),
	CONSTRAINT `persona_distillation_inputs_name_check` CHECK(length(trim(`name`)) > 0),
	CONSTRAINT `persona_distillation_inputs_role_check` CHECK(`source_role` IS NULL OR `source_role` IN ('canon_fact', 'reference', 'style_sample')),
	CONSTRAINT `persona_distillation_inputs_relation_check` CHECK(`source_relation` IS NULL OR `source_relation` IN ('subject_authored', 'direct_conversation', 'observed_decision', 'subject_social', 'third_party', 'user_statement')),
	CONSTRAINT `persona_distillation_inputs_dimensions_check` CHECK(json_valid(`coverage_dimensions_json`) AND json_type(`coverage_dimensions_json`) = 'array'),
	CONSTRAINT `persona_distillation_inputs_hash_check` CHECK(length(`content_hash`) = 64),
	CONSTRAINT `persona_distillation_inputs_available_check` CHECK(`source_available` IN (0, 1)),
	CONSTRAINT `persona_distillation_inputs_accepted_check` CHECK(`accepted` IN (0, 1)),
	CONSTRAINT `persona_distillation_inputs_shape_check` CHECK(
		(`input_type` = 'user_statement' AND `source_id` IS NULL AND `source_role` IS NULL AND `source_relation` = 'user_statement' AND `content_snapshot` IS NOT NULL AND `source_available` = 1)
		OR (`input_type` = 'source_material' AND `source_role` IS NOT NULL AND ((`source_id` IS NOT NULL AND `content_snapshot` IS NOT NULL AND `source_available` = 1) OR (`source_id` IS NULL AND `content_snapshot` IS NULL AND `source_available` = 0)))
	)
);
--> statement-breakpoint
CREATE INDEX `persona_distillation_inputs_run_created_index` ON `persona_distillation_inputs` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `persona_distillation_inputs_source_index` ON `persona_distillation_inputs` (`source_id`);
--> statement-breakpoint
CREATE TABLE `persona_distillation_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`category` text NOT NULL,
	`statement` text NOT NULL,
	`applicability` text NOT NULL,
	`limitations` text DEFAULT '' NOT NULL,
	`basis` text NOT NULL,
	`confidence_millionths` integer NOT NULL,
	`independent_source_count` integer NOT NULL,
	`cross_context_count` integer NOT NULL,
	`status` text NOT NULL,
	`rejection_reasons_json` text DEFAULT '[]' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`conflicts_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `persona_distillation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `persona_distillation_claims_category_check` CHECK(`category` IN ('mental_model', 'decision_heuristic', 'expression', 'value', 'anti_pattern', 'tension', 'honesty_boundary', 'timeline')),
	CONSTRAINT `persona_distillation_claims_statement_check` CHECK(length(trim(`statement`)) > 0),
	CONSTRAINT `persona_distillation_claims_applicability_check` CHECK(length(trim(`applicability`)) > 0),
	CONSTRAINT `persona_distillation_claims_basis_check` CHECK(`basis` IN ('explicit', 'observed', 'inferred')),
	CONSTRAINT `persona_distillation_claims_confidence_check` CHECK(`confidence_millionths` BETWEEN 0 AND 1000000),
	CONSTRAINT `persona_distillation_claims_counts_check` CHECK(`independent_source_count` >= 0 AND `cross_context_count` >= 0),
	CONSTRAINT `persona_distillation_claims_status_check` CHECK(`status` IN ('valid', 'warning', 'rejected')),
	CONSTRAINT `persona_distillation_claims_rejections_json_check` CHECK(json_valid(`rejection_reasons_json`) AND json_type(`rejection_reasons_json`) = 'array'),
	CONSTRAINT `persona_distillation_claims_warnings_json_check` CHECK(json_valid(`warnings_json`) AND json_type(`warnings_json`) = 'array'),
	CONSTRAINT `persona_distillation_claims_conflicts_json_check` CHECK(json_valid(`conflicts_json`) AND json_type(`conflicts_json`) = 'array')
);
--> statement-breakpoint
CREATE INDEX `persona_distillation_claims_run_category_index` ON `persona_distillation_claims` (`run_id`,`category`);
--> statement-breakpoint
CREATE TABLE `persona_distillation_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`input_id` text NOT NULL,
	`relation` text NOT NULL,
	`quote` text NOT NULL,
	`quote_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `persona_distillation_claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`input_id`) REFERENCES `persona_distillation_inputs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `persona_distillation_evidence_relation_check` CHECK(`relation` IN ('supporting', 'opposing')),
	CONSTRAINT `persona_distillation_evidence_quote_check` CHECK(length(trim(`quote`)) > 0),
	CONSTRAINT `persona_distillation_evidence_hash_check` CHECK(length(`quote_hash`) = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_distillation_evidence_unique` ON `persona_distillation_evidence` (`claim_id`,`input_id`,`relation`,`quote_hash`);
--> statement-breakpoint
CREATE TRIGGER `persona_distillation_evidence_run_insert_check` BEFORE INSERT ON `persona_distillation_evidence`
WHEN NOT EXISTS (
	SELECT 1 FROM `persona_distillation_claims` AS `claim`
	INNER JOIN `persona_distillation_inputs` AS `input` ON `input`.`run_id` = `claim`.`run_id`
	WHERE `claim`.`id` = new.`claim_id` AND `input`.`id` = new.`input_id`
)
BEGIN
	SELECT RAISE(ABORT, 'evidence input belongs to another distillation run');
END;
--> statement-breakpoint
CREATE TRIGGER `persona_distillation_evidence_run_update_check` BEFORE UPDATE OF `claim_id`, `input_id` ON `persona_distillation_evidence`
WHEN NOT EXISTS (
	SELECT 1 FROM `persona_distillation_claims` AS `claim`
	INNER JOIN `persona_distillation_inputs` AS `input` ON `input`.`run_id` = `claim`.`run_id`
	WHERE `claim`.`id` = new.`claim_id` AND `input`.`id` = new.`input_id`
)
BEGIN
	SELECT RAISE(ABORT, 'evidence input belongs to another distillation run');
END;
--> statement-breakpoint
CREATE TABLE `persona_distillation_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`round_no` integer NOT NULL,
	`evaluation_type` text NOT NULL,
	`candidate_prompt_hash` text NOT NULL,
	`input_json` text NOT NULL,
	`expected_json` text NOT NULL,
	`output_json` text NOT NULL,
	`status` text NOT NULL,
	`score_millionths` integer,
	`failure_reasons_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `persona_distillation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `persona_distillation_evaluations_round_check` CHECK(`round_no` > 0),
	CONSTRAINT `persona_distillation_evaluations_type_check` CHECK(`evaluation_type` IN ('known_fact', 'decision_tendency', 'unknown_boundary', 'expression', 'counterfactual', 'conflict_handling')),
	CONSTRAINT `persona_distillation_evaluations_hash_check` CHECK(length(`candidate_prompt_hash`) = 64),
	CONSTRAINT `persona_distillation_evaluations_input_json_check` CHECK(json_valid(`input_json`)),
	CONSTRAINT `persona_distillation_evaluations_expected_json_check` CHECK(json_valid(`expected_json`)),
	CONSTRAINT `persona_distillation_evaluations_output_json_check` CHECK(json_valid(`output_json`)),
	CONSTRAINT `persona_distillation_evaluations_status_check` CHECK(`status` IN ('passed', 'warning', 'failed')),
	CONSTRAINT `persona_distillation_evaluations_score_check` CHECK(`score_millionths` IS NULL OR `score_millionths` BETWEEN 0 AND 1000000),
	CONSTRAINT `persona_distillation_evaluations_failures_json_check` CHECK(json_valid(`failure_reasons_json`) AND json_type(`failure_reasons_json`) = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_distillation_evaluations_run_round_type_unique` ON `persona_distillation_evaluations` (`run_id`,`round_no`,`evaluation_type`);
--> statement-breakpoint
CREATE TRIGGER `persona_distillation_source_delete` BEFORE DELETE ON `source_materials`
BEGIN
	UPDATE `persona_distillation_inputs`
	SET `source_id` = NULL, `content_snapshot` = NULL, `source_available` = 0
	WHERE `source_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `persona_distillation_run_task_delete` AFTER DELETE ON `persona_distillation_runs`
BEGIN
	DELETE FROM `task_jobs`
	WHERE `type` = 'distill_persona'
		AND json_valid(`payload_json`)
		AND json_extract(`payload_json`, '$.distillationRunId') = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `persona_distillation_task_insert_check` BEFORE INSERT ON `task_jobs`
WHEN new.`type` = 'distill_persona' AND (
	NOT json_valid(new.`payload_json`)
	OR NOT EXISTS (
		SELECT 1 FROM `persona_distillation_runs`
		WHERE `id` = json_extract(new.`payload_json`, '$.distillationRunId')
	)
)
BEGIN
	SELECT RAISE(ABORT, 'persona distillation task run does not exist');
END;
--> statement-breakpoint
CREATE TRIGGER `persona_distillation_task_update_check` BEFORE UPDATE OF `payload_json`, `type` ON `task_jobs`
WHEN new.`type` = 'distill_persona' AND (
	NOT json_valid(new.`payload_json`)
	OR NOT EXISTS (
		SELECT 1 FROM `persona_distillation_runs`
		WHERE `id` = json_extract(new.`payload_json`, '$.distillationRunId')
	)
)
BEGIN
	SELECT RAISE(ABORT, 'persona distillation task run does not exist');
END;
