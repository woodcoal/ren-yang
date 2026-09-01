CREATE TABLE `__new_ai_algorithms` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`implementation_version` integer NOT NULL,
	`active_configuration_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ai_algorithms_code_check" CHECK("code" IN ('persona_soul', 'world_soul', 'persona_growth', 'world_growth', 'persona_memory', 'article_generation', 'article_image_analysis')),
	CONSTRAINT "ai_algorithms_name_check" CHECK(length(trim("name")) > 0),
	CONSTRAINT "ai_algorithms_implementation_version_check" CHECK("implementation_version" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_ai_algorithms` (`code`, `name`, `description`, `implementation_version`, `active_configuration_version_id`, `created_at`, `updated_at`)
SELECT `code`, `name`, `description`, `implementation_version`, `active_configuration_version_id`, `created_at`, `updated_at` FROM `ai_algorithms`;
--> statement-breakpoint
DROP TABLE `ai_algorithms`;
--> statement-breakpoint
ALTER TABLE `__new_ai_algorithms` RENAME TO `ai_algorithms`;
--> statement-breakpoint
INSERT OR IGNORE INTO `ai_algorithms` (`code`, `name`, `description`, `implementation_version`, `active_configuration_version_id`, `created_at`, `updated_at`) VALUES
('article_generation', '文章生成', '结合人物个性、创作条件和有效资料一次生成完整文章。', 1, NULL, 1789459200000, 1789459200000),
('article_image_analysis', '文章配图分析', '根据最终文章分析指定数量配图的内容与正文插入位置。', 1, NULL, 1789459200000, 1789459200000);
--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `algorithm_snapshot_json` text CHECK(
	`algorithm_snapshot_json` IS NULL OR json_valid(`algorithm_snapshot_json`)
);
