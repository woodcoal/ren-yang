CREATE TABLE `__new_image_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`media_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_hash` text NOT NULL,
	`alt_text` text NOT NULL,
	`original_relative_path` text,
	`original_media_type` text,
	`original_size_bytes` integer,
	`original_content_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `block_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "image_assets_path_check" CHECK(`relative_path` GLOB 'assets/*' AND instr(`relative_path`, '..') = 0),
	CONSTRAINT "image_assets_media_type_check" CHECK(`media_type` IN ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "image_assets_size_check" CHECK(`size_bytes` > 0 AND `size_bytes` <= 10485760),
	CONSTRAINT "image_assets_hash_check" CHECK(length(`content_hash`) = 64),
	CONSTRAINT "image_assets_alt_text_check" CHECK(length(trim(`alt_text`)) > 0),
	CONSTRAINT "image_assets_original_fields_check" CHECK((
		`original_relative_path` IS NULL AND `original_media_type` IS NULL
			AND `original_size_bytes` IS NULL AND `original_content_hash` IS NULL
	) OR (
		`original_relative_path` IS NOT NULL AND `original_media_type` IS NOT NULL
			AND `original_size_bytes` IS NOT NULL AND `original_content_hash` IS NOT NULL
	)),
	CONSTRAINT "image_assets_original_path_check" CHECK(`original_relative_path` IS NULL OR (`original_relative_path` GLOB 'assets/*' AND instr(`original_relative_path`, '..') = 0)),
	CONSTRAINT "image_assets_original_media_type_check" CHECK(`original_media_type` IS NULL OR `original_media_type` IN ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "image_assets_original_size_check" CHECK(`original_size_bytes` IS NULL OR (`original_size_bytes` > 0 AND `original_size_bytes` <= 10485760)),
	CONSTRAINT "image_assets_original_hash_check" CHECK(`original_content_hash` IS NULL OR length(`original_content_hash`) = 64)
);
--> statement-breakpoint
INSERT INTO `__new_image_assets` (
	`id`, `attempt_id`, `relative_path`, `media_type`, `size_bytes`, `content_hash`, `alt_text`, `created_at`
)
SELECT `id`, `attempt_id`, `relative_path`, `media_type`, `size_bytes`, `content_hash`, `alt_text`, `created_at`
FROM `image_assets`;
--> statement-breakpoint
DROP TABLE `image_assets`;
--> statement-breakpoint
ALTER TABLE `__new_image_assets` RENAME TO `image_assets`;
--> statement-breakpoint
CREATE UNIQUE INDEX `image_assets_attempt_unique` ON `image_assets` (`attempt_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_assets_relative_path_unique` ON `image_assets` (`relative_path`);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_assets_original_relative_path_unique` ON `image_assets` (`original_relative_path`);
