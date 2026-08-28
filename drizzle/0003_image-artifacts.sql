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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifact_blocks` (
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
	CONSTRAINT "artifact_blocks_ordinal_check" CHECK("__new_artifact_blocks"."ordinal" >= 0),
	CONSTRAINT "artifact_blocks_type_check" CHECK("__new_artifact_blocks"."type" IN ('text', 'image')),
	CONSTRAINT "artifact_blocks_role_check" CHECK("__new_artifact_blocks"."role" IN ('heading', 'paragraph', 'list', 'quote', 'hero_image', 'illustration')),
	CONSTRAINT "artifact_blocks_status_check" CHECK("__new_artifact_blocks"."status" IN ('pending', 'running', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "artifact_blocks_locked_check" CHECK("__new_artifact_blocks"."is_locked" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_artifact_blocks`("id", "document_id", "spec_key", "ordinal", "type", "role", "spec_json", "status", "selected_attempt_id", "is_locked", "selected_at", "locked_at", "created_at", "updated_at") SELECT "id", "document_id", "spec_key", "ordinal", "type", "role", "spec_json", "status", "selected_attempt_id", "is_locked", NULL, NULL, "created_at", "updated_at" FROM `artifact_blocks`;--> statement-breakpoint
DROP TABLE `artifact_blocks`;--> statement-breakpoint
ALTER TABLE `__new_artifact_blocks` RENAME TO `artifact_blocks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_blocks_document_ordinal_unique` ON `artifact_blocks` (`document_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_blocks_document_spec_key_unique` ON `artifact_blocks` (`document_id`,`spec_key`);--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `image_model_snapshot_json` text;
