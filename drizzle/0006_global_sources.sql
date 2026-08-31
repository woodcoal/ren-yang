CREATE TABLE `global_sources` (
	`source_id` text PRIMARY KEY NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source_materials`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "global_sources_priority_check" CHECK("global_sources"."priority" >= 0)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_context_sync_records` (
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
	`error_code` text,
	`error_stage` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "context_sync_records_provider_check" CHECK("__new_context_sync_records"."provider" IN ('openviking')),
	CONSTRAINT "context_sync_records_entity_type_check" CHECK("__new_context_sync_records"."entity_type" IN ('source_material', 'persona_feedback_source', 'growth', 'memory')),
	CONSTRAINT "context_sync_records_scope_type_check" CHECK("__new_context_sync_records"."scope_type" IN ('world', 'persona', 'global')),
	CONSTRAINT "context_sync_records_status_check" CHECK("__new_context_sync_records"."status" IN ('pending', 'synchronized', 'failed')),
	CONSTRAINT "context_sync_records_operation_check" CHECK("__new_context_sync_records"."operation" IN ('upsert', 'delete')),
	CONSTRAINT "context_sync_records_hash_check" CHECK(length("__new_context_sync_records"."content_hash") = 64),
	CONSTRAINT "context_sync_records_failure_count_check" CHECK("__new_context_sync_records"."failure_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_context_sync_records`("id", "entity_type", "source_id", "scope_type", "scope_id", "user_id", "peer_id", "provider", "remote_uri", "content_hash", "status", "operation", "error", "error_code", "error_stage", "failure_count", "next_retry_at", "created_at", "updated_at") SELECT "id", "entity_type", "source_id", "scope_type", "scope_id", "user_id", "peer_id", "provider", "remote_uri", "content_hash", "status", "operation", "error", "error_code", "error_stage", "failure_count", "next_retry_at", "created_at", "updated_at" FROM `context_sync_records`;--> statement-breakpoint
DROP TABLE `context_sync_records`;--> statement-breakpoint
ALTER TABLE `__new_context_sync_records` RENAME TO `context_sync_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `context_sync_records_projection_unique` ON `context_sync_records` (`entity_type`,`source_id`,`scope_type`,`scope_id`,`provider`);--> statement-breakpoint
CREATE INDEX `context_sync_records_provider_status_index` ON `context_sync_records` (`provider`,`status`);