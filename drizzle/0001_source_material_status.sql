PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_source_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`input_type` text NOT NULL,
	`content_hash` text NOT NULL,
	`content_text` text NOT NULL,
	`original_file_path` text,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "source_materials_name_not_empty_check" CHECK(length(trim("__new_source_materials"."name")) > 0),
	CONSTRAINT "source_materials_role_check" CHECK("__new_source_materials"."role" IN ('canon_fact', 'reference', 'style_sample')),
	CONSTRAINT "source_materials_input_type_check" CHECK("__new_source_materials"."input_type" IN ('paste', 'txt', 'markdown')),
	CONSTRAINT "source_materials_hash_check" CHECK(length("__new_source_materials"."content_hash") = 64),
	CONSTRAINT "source_materials_content_not_empty_check" CHECK(length(trim("__new_source_materials"."content_text")) > 0),
	CONSTRAINT "source_materials_enabled_check" CHECK("__new_source_materials"."is_enabled" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_source_materials`("id", "name", "role", "input_type", "content_hash", "content_text", "original_file_path", "is_enabled", "created_at", "updated_at") SELECT "id", "name", "role", "input_type", "content_hash", "content_text", "original_file_path", 1, "created_at", "updated_at" FROM `source_materials`;--> statement-breakpoint
DROP TABLE `source_materials`;--> statement-breakpoint
ALTER TABLE `__new_source_materials` RENAME TO `source_materials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `source_materials_created_at_index` ON `source_materials` (`created_at`);
