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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "context_sync_records_provider_check" CHECK("__new_context_sync_records"."provider" IN ('openviking')),
	CONSTRAINT "context_sync_records_entity_type_check" CHECK("__new_context_sync_records"."entity_type" IN ('source_material', 'persona_feedback_source', 'growth', 'memory')),
	CONSTRAINT "context_sync_records_scope_type_check" CHECK("__new_context_sync_records"."scope_type" IN ('world', 'persona')),
	CONSTRAINT "context_sync_records_status_check" CHECK("__new_context_sync_records"."status" IN ('pending', 'synchronized', 'failed')),
	CONSTRAINT "context_sync_records_operation_check" CHECK("__new_context_sync_records"."operation" IN ('upsert', 'delete')),
	CONSTRAINT "context_sync_records_hash_check" CHECK(length("__new_context_sync_records"."content_hash") = 64)
);
--> statement-breakpoint
INSERT INTO `__new_context_sync_records`("id", "entity_type", "source_id", "scope_type", "scope_id", "user_id", "peer_id", "provider", "remote_uri", "content_hash", "status", "operation", "error", "created_at", "updated_at") SELECT "id", 'source_material', "source_id", "scope_type", "scope_id", "user_id", "peer_id", "provider", "remote_uri", "content_hash", "status", 'upsert', "error", "created_at", "updated_at" FROM `context_sync_records`;--> statement-breakpoint
DROP TABLE `context_sync_records`;--> statement-breakpoint
ALTER TABLE `__new_context_sync_records` RENAME TO `context_sync_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `context_sync_records_projection_unique` ON `context_sync_records` (`entity_type`,`source_id`,`scope_type`,`scope_id`,`provider`);--> statement-breakpoint
CREATE INDEX `context_sync_records_provider_status_index` ON `context_sync_records` (`provider`,`status`);--> statement-breakpoint
DROP TRIGGER IF EXISTS `persona_memories_fts_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `persona_memories_fts_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `persona_memories_fts_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `persona_growth_fts_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `persona_growth_fts_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `persona_growth_fts_update`;--> statement-breakpoint
DROP TABLE IF EXISTS `persona_learning_fts`;--> statement-breakpoint
DROP TABLE IF EXISTS `learning_fts`;--> statement-breakpoint
CREATE VIRTUAL TABLE `learning_fts` USING fts5(
	`entity_type` UNINDEXED,
	`entity_id` UNINDEXED,
	`subject_id` UNINDEXED,
	`content`,
	tokenize='trigram'
);--> statement-breakpoint
INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
SELECT CASE `growth_records`.`subject_type` WHEN 'world' THEN 'world_growth' ELSE 'persona_growth' END,
	`growth_records`.`id`, COALESCE(`growth_records`.`world_id`, `growth_records`.`persona_id`), `growth_revisions`.`content`
FROM `growth_records`
INNER JOIN `growth_revisions` ON `growth_revisions`.`id` = `growth_records`.`current_revision_id`
WHERE `growth_records`.`status` = 'active';--> statement-breakpoint
INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
SELECT 'memory', `memory_records`.`id`, `memory_records`.`persona_id`, `memory_revisions`.`content`
FROM `memory_records`
INNER JOIN `memory_revisions` ON `memory_revisions`.`id` = `memory_records`.`current_revision_id`
WHERE `memory_records`.`status` = 'active';--> statement-breakpoint
CREATE TRIGGER `growth_records_learning_fts_insert` AFTER INSERT ON `growth_records` WHEN new.`status` = 'active' BEGIN
	INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
	SELECT CASE new.`subject_type` WHEN 'world' THEN 'world_growth' ELSE 'persona_growth' END,
		new.`id`, COALESCE(new.`world_id`, new.`persona_id`), `growth_revisions`.`content`
	FROM `growth_revisions` WHERE `growth_revisions`.`id` = new.`current_revision_id`;
END;--> statement-breakpoint
CREATE TRIGGER `growth_records_learning_fts_delete` AFTER DELETE ON `growth_records` BEGIN
	DELETE FROM `learning_fts` WHERE `entity_type` IN ('world_growth', 'persona_growth') AND `entity_id` = old.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `growth_records_learning_fts_update` AFTER UPDATE ON `growth_records` BEGIN
	DELETE FROM `learning_fts` WHERE `entity_type` IN ('world_growth', 'persona_growth') AND `entity_id` = old.`id`;
	INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
	SELECT CASE new.`subject_type` WHEN 'world' THEN 'world_growth' ELSE 'persona_growth' END,
		new.`id`, COALESCE(new.`world_id`, new.`persona_id`), `growth_revisions`.`content`
	FROM `growth_revisions` WHERE `growth_revisions`.`id` = new.`current_revision_id` AND new.`status` = 'active';
END;--> statement-breakpoint
CREATE TRIGGER `memory_records_learning_fts_insert` AFTER INSERT ON `memory_records` WHEN new.`status` = 'active' BEGIN
	INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
	SELECT 'memory', new.`id`, new.`persona_id`, `memory_revisions`.`content`
	FROM `memory_revisions` WHERE `memory_revisions`.`id` = new.`current_revision_id`;
END;--> statement-breakpoint
CREATE TRIGGER `memory_records_learning_fts_delete` AFTER DELETE ON `memory_records` BEGIN
	DELETE FROM `learning_fts` WHERE `entity_type` = 'memory' AND `entity_id` = old.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `memory_records_learning_fts_update` AFTER UPDATE ON `memory_records` BEGIN
	DELETE FROM `learning_fts` WHERE `entity_type` = 'memory' AND `entity_id` = old.`id`;
	INSERT INTO `learning_fts` (`entity_type`, `entity_id`, `subject_id`, `content`)
	SELECT 'memory', new.`id`, new.`persona_id`, `memory_revisions`.`content`
	FROM `memory_revisions` WHERE `memory_revisions`.`id` = new.`current_revision_id` AND new.`status` = 'active';
END;
