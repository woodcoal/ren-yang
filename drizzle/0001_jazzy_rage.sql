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
CREATE TABLE `persona_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_id` text NOT NULL,
	`parent_version_id` text,
	`status` text DEFAULT 'candidate' NOT NULL,
	`snapshot_json` text NOT NULL,
	`change_summary` text NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "persona_versions_status_check" CHECK("persona_versions"."status" IN ('candidate', 'published', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `persona_versions_persona_created_at_index` ON `persona_versions` (`persona_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`active_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "personas_name_not_empty_check" CHECK(length(trim("personas"."name")) > 0),
	CONSTRAINT "personas_origin_check" CHECK("personas"."origin" IN ('original', 'source_based', 'hybrid'))
);
--> statement-breakpoint
CREATE INDEX `personas_world_id_index` ON `personas` (`world_id`);--> statement-breakpoint
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
CREATE TABLE `world_sources` (
	`world_id` text NOT NULL,
	`source_id` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `source_materials`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "world_sources_priority_check" CHECK("world_sources"."priority" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `world_sources_unique` ON `world_sources` (`world_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `world_sources_source_id_index` ON `world_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `world_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`parent_version_id` text,
	`status` text DEFAULT 'candidate' NOT NULL,
	`snapshot_json` text NOT NULL,
	`change_summary` text NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "world_versions_status_check" CHECK("world_versions"."status" IN ('candidate', 'published', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `world_versions_world_created_at_index` ON `world_versions` (`world_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`active_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "worlds_name_not_empty_check" CHECK(length(trim("worlds"."name")) > 0)
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `source_chunks_fts` USING fts5(
	`heading`,
	`content`,
	content=`source_chunks`,
	content_rowid=`rowid`,
	tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `source_chunks_fts_insert` AFTER INSERT ON `source_chunks` BEGIN
	INSERT INTO `source_chunks_fts` (`rowid`, `heading`, `content`)
	VALUES (new.`rowid`, new.`heading`, new.`content`);
END;
--> statement-breakpoint
CREATE TRIGGER `source_chunks_fts_delete` AFTER DELETE ON `source_chunks` BEGIN
	INSERT INTO `source_chunks_fts` (`source_chunks_fts`, `rowid`, `heading`, `content`)
	VALUES ('delete', old.`rowid`, old.`heading`, old.`content`);
END;
--> statement-breakpoint
CREATE TRIGGER `source_chunks_fts_update` AFTER UPDATE ON `source_chunks` BEGIN
	INSERT INTO `source_chunks_fts` (`source_chunks_fts`, `rowid`, `heading`, `content`)
	VALUES ('delete', old.`rowid`, old.`heading`, old.`content`);
	INSERT INTO `source_chunks_fts` (`rowid`, `heading`, `content`)
	VALUES (new.`rowid`, new.`heading`, new.`content`);
END;
