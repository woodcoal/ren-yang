PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_personas` (
	`id` text PRIMARY KEY NOT NULL,
	`world_id` text,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`active_soul_version_id` text,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "personas_name_not_empty_check" CHECK(length(trim("__new_personas"."name")) > 0),
	CONSTRAINT "personas_origin_check" CHECK("__new_personas"."origin" IN ('original', 'source_based', 'hybrid')),
	CONSTRAINT "personas_enabled_check" CHECK("__new_personas"."is_enabled" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_personas`("id", "world_id", "name", "origin", "active_soul_version_id", "is_enabled", "created_at", "updated_at") SELECT "id", "world_id", "name", "origin", "active_soul_version_id", 1, "created_at", "updated_at" FROM `personas`;--> statement-breakpoint
DROP TABLE `personas`;--> statement-breakpoint
ALTER TABLE `__new_personas` RENAME TO `personas`;--> statement-breakpoint
CREATE INDEX `personas_world_id_index` ON `personas` (`world_id`);--> statement-breakpoint
CREATE TABLE `__new_worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`active_soul_version_id` text,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "worlds_name_not_empty_check" CHECK(length(trim("__new_worlds"."name")) > 0),
	CONSTRAINT "worlds_enabled_check" CHECK("__new_worlds"."is_enabled" IN (0, 1))
);
--> statement-breakpoint
INSERT INTO `__new_worlds`("id", "name", "summary", "active_soul_version_id", "is_enabled", "created_at", "updated_at") SELECT "id", "name", "summary", "active_soul_version_id", 1, "created_at", "updated_at" FROM `worlds`;--> statement-breakpoint
DROP TABLE `worlds`;--> statement-breakpoint
ALTER TABLE `__new_worlds` RENAME TO `worlds`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
