CREATE TABLE `candidate_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`proposal_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`feedback_id`) REFERENCES `feedback_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposal_id`) REFERENCES `revision_proposals`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "candidate_memories_status_check" CHECK("candidate_memories"."status" IN ('proposed', 'promoted', 'rejected')),
	CONSTRAINT "candidate_memories_content_check" CHECK(length(trim("candidate_memories"."content")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_memories_feedback_unique` ON `candidate_memories` (`feedback_id`);--> statement-breakpoint
CREATE TABLE `context_sync_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`provider` text NOT NULL,
	`remote_uri` text,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source_materials`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "context_sync_records_provider_check" CHECK("context_sync_records"."provider" IN ('openviking')),
	CONSTRAINT "context_sync_records_status_check" CHECK("context_sync_records"."status" IN ('pending', 'synchronized', 'failed')),
	CONSTRAINT "context_sync_records_hash_check" CHECK(length("context_sync_records"."content_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_sync_records_source_provider_unique` ON `context_sync_records` (`source_id`,`provider`);--> statement-breakpoint
CREATE INDEX `context_sync_records_provider_status_index` ON `context_sync_records` (`provider`,`status`);--> statement-breakpoint
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
CREATE TABLE `evaluation_results` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluation_run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`case_name` text NOT NULL,
	`status` text NOT NULL,
	`base_score_millionths` integer NOT NULL,
	`candidate_score_millionths` integer NOT NULL,
	`base_output` text NOT NULL,
	`candidate_output` text NOT NULL,
	`failures_json` text NOT NULL,
	`reasoning_summary` text NOT NULL,
	FOREIGN KEY (`evaluation_run_id`) REFERENCES `evaluation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`case_id`) REFERENCES `evaluation_cases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evaluation_results_status_check" CHECK("evaluation_results"."status" IN ('passed', 'failed')),
	CONSTRAINT "evaluation_results_base_score_check" CHECK("evaluation_results"."base_score_millionths" BETWEEN 0 AND 1000000),
	CONSTRAINT "evaluation_results_candidate_score_check" CHECK("evaluation_results"."candidate_score_millionths" BETWEEN 0 AND 1000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_results_run_case_unique` ON `evaluation_results` (`evaluation_run_id`,`case_id`);--> statement-breakpoint
CREATE TABLE `evaluation_runs` (
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
	FOREIGN KEY (`candidate_version_id`) REFERENCES `persona_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "evaluation_runs_status_check" CHECK("evaluation_runs"."status" IN ('queued', 'running', 'passed', 'failed')),
	CONSTRAINT "evaluation_runs_count_check" CHECK("evaluation_runs"."passed_cases" >= 0 AND "evaluation_runs"."total_cases" > 0 AND "evaluation_runs"."passed_cases" <= "evaluation_runs"."total_cases")
);
--> statement-breakpoint
CREATE INDEX `evaluation_runs_proposal_created_index` ON `evaluation_runs` (`proposal_id`,`created_at`);--> statement-breakpoint
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
CREATE TABLE `revision_proposals` (
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
	FOREIGN KEY (`base_version_id`) REFERENCES `persona_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_version_id`) REFERENCES `persona_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "revision_proposals_risk_check" CHECK("revision_proposals"."risk_level" IN ('low', 'high', 'critical')),
	CONSTRAINT "revision_proposals_status_check" CHECK("revision_proposals"."status" IN ('awaiting_evaluation', 'evaluation_failed', 'ready', 'published', 'rejected')),
	CONSTRAINT "revision_proposals_conflict_check" CHECK("revision_proposals"."has_evidence_conflict" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_proposals_feedback_unique` ON `revision_proposals` (`feedback_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `revision_proposals_candidate_version_unique` ON `revision_proposals` (`candidate_version_id`);--> statement-breakpoint
CREATE INDEX `revision_proposals_persona_status_created_index` ON `revision_proposals` (`persona_id`,`status`,`created_at`);