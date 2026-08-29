DROP INDEX IF EXISTS `context_sync_records_source_provider_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `context_sync_records_provider_status_index`;
--> statement-breakpoint
DROP TABLE `context_sync_records`;
--> statement-breakpoint
CREATE TABLE `context_sync_records` (
  `id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL,
  `scope_type` text NOT NULL,
  `scope_id` text NOT NULL,
  `user_id` text NOT NULL,
  `peer_id` text,
  `provider` text NOT NULL,
  `remote_uri` text,
  `content_hash` text NOT NULL,
  `status` text NOT NULL,
  `error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `context_sync_records_provider_check` CHECK(`provider` IN ('openviking')),
  CONSTRAINT `context_sync_records_scope_type_check` CHECK(`scope_type` IN ('world', 'persona')),
  CONSTRAINT `context_sync_records_status_check` CHECK(`status` IN ('pending', 'synchronized', 'failed')),
  CONSTRAINT `context_sync_records_hash_check` CHECK(length(`content_hash`) = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_sync_records_projection_unique` ON `context_sync_records` (`source_id`, `scope_type`, `scope_id`, `provider`);
--> statement-breakpoint
CREATE INDEX `context_sync_records_provider_status_index` ON `context_sync_records` (`provider`, `status`);
--> statement-breakpoint
CREATE TABLE `persona_growth_records` (
  `id` text PRIMARY KEY NOT NULL,
  `persona_id` text NOT NULL REFERENCES `personas`(`id`) ON DELETE CASCADE,
  `content` text NOT NULL,
  `content_hash` text NOT NULL,
  `status` text DEFAULT 'candidate' NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `persona_growth_records_status_check` CHECK(`status` IN ('candidate', 'active', 'deprecated', 'rejected')),
  CONSTRAINT `persona_growth_records_source_type_check` CHECK(`source_type` IN ('feedback', 'memory', 'manual')),
  CONSTRAINT `persona_growth_records_content_check` CHECK(length(trim(`content`)) > 0),
  CONSTRAINT `persona_growth_records_hash_check` CHECK(length(`content_hash`) = 64)
);
--> statement-breakpoint
CREATE INDEX `persona_growth_records_persona_status_index` ON `persona_growth_records` (`persona_id`, `status`);
--> statement-breakpoint
CREATE TABLE `persona_memories` (
  `id` text PRIMARY KEY NOT NULL,
  `persona_id` text NOT NULL REFERENCES `personas`(`id`) ON DELETE CASCADE,
  `content` text NOT NULL,
  `content_hash` text NOT NULL,
  `memory_type` text NOT NULL,
  `status` text DEFAULT 'candidate' NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text,
  `remote_uri` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `persona_memories_status_check` CHECK(`status` IN ('candidate', 'active', 'deprecated', 'rejected')),
  CONSTRAINT `persona_memories_source_type_check` CHECK(`source_type` IN ('openviking_session', 'feedback', 'manual')),
  CONSTRAINT `persona_memories_content_check` CHECK(length(trim(`content`)) > 0),
  CONSTRAINT `persona_memories_hash_check` CHECK(length(`content_hash`) = 64)
);
--> statement-breakpoint
CREATE INDEX `persona_memories_persona_status_index` ON `persona_memories` (`persona_id`, `status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `persona_memories_remote_uri_unique` ON `persona_memories` (`remote_uri`);
--> statement-breakpoint
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
  CONSTRAINT `openviking_session_records_source_type_check` CHECK(`source_type` IN ('run', 'feedback')),
  CONSTRAINT `openviking_session_records_status_check` CHECK(`status` IN ('pending', 'synchronized', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openviking_session_records_source_unique` ON `openviking_session_records` (`source_type`, `source_id`);
--> statement-breakpoint
CREATE INDEX `openviking_session_records_status_index` ON `openviking_session_records` (`status`, `updated_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `persona_learning_fts` USING fts5(
  `entity_type` UNINDEXED,
  `entity_id` UNINDEXED,
  `persona_id` UNINDEXED,
  `content`,
  tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `persona_memories_fts_insert` AFTER INSERT ON `persona_memories` WHEN new.status = 'active' BEGIN
  INSERT INTO `persona_learning_fts` (`entity_type`, `entity_id`, `persona_id`, `content`)
  VALUES ('memory', new.id, new.persona_id, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `persona_memories_fts_delete` AFTER DELETE ON `persona_memories` WHEN old.status = 'active' BEGIN
  DELETE FROM `persona_learning_fts` WHERE `entity_type` = 'memory' AND `entity_id` = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `persona_memories_fts_update` AFTER UPDATE ON `persona_memories` BEGIN
  DELETE FROM `persona_learning_fts` WHERE `entity_type` = 'memory' AND `entity_id` = old.id;
  INSERT INTO `persona_learning_fts` (`entity_type`, `entity_id`, `persona_id`, `content`)
  SELECT 'memory', new.id, new.persona_id, new.content WHERE new.status = 'active';
END;
--> statement-breakpoint
CREATE TRIGGER `persona_growth_fts_insert` AFTER INSERT ON `persona_growth_records` WHEN new.status = 'active' BEGIN
  INSERT INTO `persona_learning_fts` (`entity_type`, `entity_id`, `persona_id`, `content`)
  VALUES ('growth', new.id, new.persona_id, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `persona_growth_fts_delete` AFTER DELETE ON `persona_growth_records` WHEN old.status = 'active' BEGIN
  DELETE FROM `persona_learning_fts` WHERE `entity_type` = 'growth' AND `entity_id` = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `persona_growth_fts_update` AFTER UPDATE ON `persona_growth_records` BEGIN
  DELETE FROM `persona_learning_fts` WHERE `entity_type` = 'growth' AND `entity_id` = old.id;
  INSERT INTO `persona_learning_fts` (`entity_type`, `entity_id`, `persona_id`, `content`)
  SELECT 'growth', new.id, new.persona_id, new.content WHERE new.status = 'active';
END;
--> statement-breakpoint
CREATE TABLE `__new_evidence_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL REFERENCES `generation_runs`(`id`) ON DELETE CASCADE,
  `source_id` text REFERENCES `source_materials`(`id`) ON DELETE SET NULL,
  `chunk_id` text REFERENCES `source_chunks`(`id`) ON DELETE SET NULL,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `content_hash` text NOT NULL,
  `rank` integer NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` integer NOT NULL,
  CONSTRAINT `evidence_snapshots_role_check` CHECK(`role` IN ('user_setting', 'canon_fact', 'reference', 'style_sample', 'growth', 'memory')),
  CONSTRAINT `evidence_snapshots_hash_check` CHECK(length(`content_hash`) = 64),
  CONSTRAINT `evidence_snapshots_rank_check` CHECK(`rank` >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_evidence_snapshots` SELECT * FROM `evidence_snapshots`;
--> statement-breakpoint
DROP TABLE `evidence_snapshots`;
--> statement-breakpoint
ALTER TABLE `__new_evidence_snapshots` RENAME TO `evidence_snapshots`;
--> statement-breakpoint
CREATE INDEX `evidence_snapshots_run_rank_index` ON `evidence_snapshots` (`run_id`, `rank`);
