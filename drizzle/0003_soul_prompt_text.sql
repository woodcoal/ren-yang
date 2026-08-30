PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_soul_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`world_id` text,
	`persona_id` text,
	`base_version_id` text,
	`prompt_text` text NOT NULL,
	`change_summary` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "soul_drafts_subject_type_check" CHECK("__new_soul_drafts"."subject_type" IN ('world', 'persona')),
	CONSTRAINT "soul_drafts_subject_check" CHECK((
      ("__new_soul_drafts"."subject_type" = 'world' AND "__new_soul_drafts"."world_id" IS NOT NULL AND "__new_soul_drafts"."persona_id" IS NULL)
      OR ("__new_soul_drafts"."subject_type" = 'persona' AND "__new_soul_drafts"."persona_id" IS NOT NULL AND "__new_soul_drafts"."world_id" IS NULL)
    )),
	CONSTRAINT "soul_drafts_prompt_text_not_empty_check" CHECK(length(trim("__new_soul_drafts"."prompt_text")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_soul_drafts`("id", "subject_type", "world_id", "persona_id", "base_version_id", "prompt_text", "change_summary", "created_at", "updated_at") SELECT "id", "subject_type", "world_id", "persona_id", "base_version_id", "runtime_summary", "change_summary", "created_at", "updated_at" FROM `soul_drafts`;--> statement-breakpoint
DROP TABLE `soul_drafts`;--> statement-breakpoint
ALTER TABLE `__new_soul_drafts` RENAME TO `soul_drafts`;--> statement-breakpoint
CREATE UNIQUE INDEX `soul_drafts_world_unique` ON `soul_drafts` (`world_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `soul_drafts_persona_unique` ON `soul_drafts` (`persona_id`);--> statement-breakpoint
CREATE TABLE `__new_soul_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`world_id` text,
	`persona_id` text,
	`parent_version_id` text,
	`prompt_text` text NOT NULL,
	`runtime_token_count` integer NOT NULL,
	`token_counter` text NOT NULL,
	`change_summary` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "soul_versions_subject_type_check" CHECK("__new_soul_versions"."subject_type" IN ('world', 'persona')),
	CONSTRAINT "soul_versions_subject_check" CHECK((
      ("__new_soul_versions"."subject_type" = 'world' AND "__new_soul_versions"."world_id" IS NOT NULL AND "__new_soul_versions"."persona_id" IS NULL)
      OR ("__new_soul_versions"."subject_type" = 'persona' AND "__new_soul_versions"."persona_id" IS NOT NULL AND "__new_soul_versions"."world_id" IS NULL)
    )),
	CONSTRAINT "soul_versions_status_check" CHECK("__new_soul_versions"."status" IN ('published', 'archived', 'rejected')),
	CONSTRAINT "soul_versions_prompt_text_not_empty_check" CHECK(length(trim("__new_soul_versions"."prompt_text")) > 0),
	CONSTRAINT "soul_versions_runtime_token_count_check" CHECK("__new_soul_versions"."runtime_token_count" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_soul_versions`("id", "subject_type", "world_id", "persona_id", "parent_version_id", "prompt_text", "runtime_token_count", "token_counter", "change_summary", "status", "published_at", "created_at") SELECT "id", "subject_type", "world_id", "persona_id", "parent_version_id", "runtime_summary", "runtime_token_count", "token_counter", "change_summary", "status", "published_at", "created_at" FROM `soul_versions`;--> statement-breakpoint
DROP TABLE `soul_versions`;--> statement-breakpoint
ALTER TABLE `__new_soul_versions` RENAME TO `soul_versions`;--> statement-breakpoint
CREATE INDEX `soul_versions_world_created_at_index` ON `soul_versions` (`world_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `soul_versions_persona_created_at_index` ON `soul_versions` (`persona_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
