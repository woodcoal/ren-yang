ALTER TABLE `persona_operation_records` ADD `importance` integer DEFAULT 3 NOT NULL CHECK (`importance` BETWEEN 1 AND 5);--> statement-breakpoint

CREATE TABLE `growth_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`world_id` text,
	`persona_id` text,
	`title` text NOT NULL,
	`content_snapshot` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`source_hash` text,
	`importance` integer DEFAULT 3 NOT NULL,
	`is_enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "growth_materials_subject_type_check" CHECK(`subject_type` IN ('world', 'persona')),
	CONSTRAINT "growth_materials_subject_check" CHECK((
		(`subject_type` = 'world' AND `world_id` IS NOT NULL AND `persona_id` IS NULL)
		OR (`subject_type` = 'persona' AND `persona_id` IS NOT NULL AND `world_id` IS NULL)
	)),
	CONSTRAINT "growth_materials_title_check" CHECK(length(trim(`title`)) > 0),
	CONSTRAINT "growth_materials_content_check" CHECK(length(trim(`content_snapshot`)) > 0),
	CONSTRAINT "growth_materials_hash_check" CHECK(length(`content_hash`) = 64),
	CONSTRAINT "growth_materials_source_type_check" CHECK(`source_type` IN ('source_material', 'manual', 'legacy')),
	CONSTRAINT "growth_materials_source_check" CHECK((`source_type` = 'source_material' AND `source_id` IS NOT NULL AND `source_hash` IS NOT NULL) OR `source_type` IN ('manual', 'legacy')),
	CONSTRAINT "growth_materials_importance_check" CHECK(`importance` BETWEEN 1 AND 5),
	CONSTRAINT "growth_materials_enabled_check" CHECK(`is_enabled` IN (0, 1))
);--> statement-breakpoint
CREATE INDEX `growth_materials_world_enabled_index` ON `growth_materials` (`world_id`,`is_enabled`,`updated_at`);--> statement-breakpoint
CREATE INDEX `growth_materials_persona_enabled_index` ON `growth_materials` (`persona_id`,`is_enabled`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `growth_materials_world_source_unique` ON `growth_materials` (`world_id`,`source_id`) WHERE `subject_type` = 'world' AND `source_type` = 'source_material';--> statement-breakpoint
CREATE UNIQUE INDEX `growth_materials_persona_source_unique` ON `growth_materials` (`persona_id`,`source_id`) WHERE `subject_type` = 'persona' AND `source_type` = 'source_material';--> statement-breakpoint

CREATE TABLE `learning_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_type` text NOT NULL,
	`world_id` text,
	`persona_id` text,
	`active_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`world_id`) REFERENCES `worlds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "learning_prompts_type_check" CHECK(`prompt_type` IN ('world_growth', 'persona_growth', 'persona_memory')),
	CONSTRAINT "learning_prompts_subject_check" CHECK((
		(`prompt_type` = 'world_growth' AND `world_id` IS NOT NULL AND `persona_id` IS NULL)
		OR (`prompt_type` IN ('persona_growth', 'persona_memory') AND `persona_id` IS NOT NULL AND `world_id` IS NULL)
	))
);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_prompts_world_type_unique` ON `learning_prompts` (`world_id`,`prompt_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_prompts_persona_type_unique` ON `learning_prompts` (`persona_id`,`prompt_type`);--> statement-breakpoint

CREATE TABLE `learning_prompt_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`parent_version_id` text,
	`prompt_text` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_analysis_batch_id` text,
	`change_summary` text NOT NULL,
	`created_by` text NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `learning_prompts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_version_id`) REFERENCES `learning_prompt_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_analysis_batch_id`) REFERENCES `analysis_batches`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "learning_prompt_versions_number_check" CHECK(`version_no` > 0),
	CONSTRAINT "learning_prompt_versions_text_check" CHECK(length(trim(`prompt_text`)) > 0),
	CONSTRAINT "learning_prompt_versions_hash_check" CHECK(length(`content_hash`) = 64),
	CONSTRAINT "learning_prompt_versions_summary_check" CHECK(length(trim(`change_summary`)) > 0),
	CONSTRAINT "learning_prompt_versions_creator_check" CHECK(`created_by` IN ('analysis', 'user', 'migration'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_prompt_versions_prompt_number_unique` ON `learning_prompt_versions` (`prompt_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `learning_prompt_versions_prompt_published_index` ON `learning_prompt_versions` (`prompt_id`,`published_at`);--> statement-breakpoint

CREATE TABLE `learning_prompt_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` text NOT NULL,
	`base_version_id` text,
	`prompt_text` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_analysis_batch_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `learning_prompts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_version_id`) REFERENCES `learning_prompt_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_analysis_batch_id`) REFERENCES `analysis_batches`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "learning_prompt_drafts_text_check" CHECK(length(trim(`prompt_text`)) > 0),
	CONSTRAINT "learning_prompt_drafts_hash_check" CHECK(length(`content_hash`) = 64),
	CONSTRAINT "learning_prompt_drafts_creator_check" CHECK(`created_by` IN ('analysis', 'user', 'migration'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_prompt_drafts_prompt_unique` ON `learning_prompt_drafts` (`prompt_id`);--> statement-breakpoint

INSERT INTO `growth_materials` (
	`id`, `subject_type`, `world_id`, `persona_id`, `title`, `content_snapshot`, `content_hash`,
	`source_type`, `source_id`, `source_hash`, `importance`, `is_enabled`, `created_at`, `updated_at`
)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	'world', `world_sources`.`world_id`, NULL, `source_materials`.`name`, `source_materials`.`content_text`, `source_materials`.`content_hash`,
	'source_material', `source_materials`.`id`, `source_materials`.`content_hash`, 3, `world_sources`.`is_enabled`,
	CASE WHEN `world_sources`.`updated_at` > 0 THEN `world_sources`.`updated_at` ELSE `source_materials`.`created_at` END,
	CASE WHEN `world_sources`.`updated_at` > 0 THEN `world_sources`.`updated_at` ELSE `source_materials`.`updated_at` END
FROM `world_sources`
INNER JOIN `source_materials` ON `source_materials`.`id` = `world_sources`.`source_id`;--> statement-breakpoint

INSERT INTO `growth_materials` (
	`id`, `subject_type`, `world_id`, `persona_id`, `title`, `content_snapshot`, `content_hash`,
	`source_type`, `source_id`, `source_hash`, `importance`, `is_enabled`, `created_at`, `updated_at`
)
SELECT
	`persona_feedback_sources`.`id`, 'persona', NULL, `persona_feedback_sources`.`persona_id`,
	`persona_feedback_sources`.`title`, `persona_feedback_sources`.`content`, `persona_feedback_sources`.`content_hash`,
	'legacy', NULL, NULL, 3, `persona_feedback_sources`.`is_enabled`,
	`persona_feedback_sources`.`created_at`, `persona_feedback_sources`.`updated_at`
FROM `persona_feedback_sources`
WHERE `persona_feedback_sources`.`deletion_state` = 'active';--> statement-breakpoint

INSERT INTO `growth_materials` (
	`id`, `subject_type`, `world_id`, `persona_id`, `title`, `content_snapshot`, `content_hash`,
	`source_type`, `source_id`, `source_hash`, `importance`, `is_enabled`, `created_at`, `updated_at`
)
SELECT
	`growth_records`.`id`, `growth_records`.`subject_type`, `growth_records`.`world_id`, `growth_records`.`persona_id`,
	'迁移的旧成长候选', `growth_revisions`.`content`, `growth_revisions`.`content_hash`,
	'legacy', NULL, NULL, `growth_revisions`.`importance`,
	CASE WHEN `growth_records`.`status` IN ('candidate', 'active') THEN 1 ELSE 0 END,
	`growth_records`.`created_at`, `growth_records`.`updated_at`
FROM `growth_records`
INNER JOIN `growth_revisions` ON `growth_revisions`.`id` = `growth_records`.`current_revision_id`
WHERE `growth_records`.`status` <> 'active';--> statement-breakpoint

UPDATE `growth_materials`
SET `importance` = COALESCE((
	SELECT MAX(`growth_revisions`.`importance`)
	FROM `growth_revision_evidence`
	INNER JOIN `growth_revisions` ON `growth_revisions`.`id` = `growth_revision_evidence`.`growth_revision_id`
	INNER JOIN `growth_records` ON `growth_records`.`id` = `growth_revisions`.`growth_id`
	WHERE `growth_revision_evidence`.`source_type` = 'world_source'
		AND `growth_revision_evidence`.`source_id` = `growth_materials`.`source_id`
		AND `growth_records`.`world_id` = `growth_materials`.`world_id`
), `importance`)
WHERE `source_type` = 'source_material';--> statement-breakpoint

INSERT INTO `learning_prompts` (`id`, `prompt_type`, `world_id`, `persona_id`, `active_version_id`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	'world_growth', `id`, NULL, NULL, `created_at`, `updated_at` FROM `worlds`;--> statement-breakpoint
INSERT INTO `learning_prompts` (`id`, `prompt_type`, `world_id`, `persona_id`, `active_version_id`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	'persona_growth', NULL, `id`, NULL, `created_at`, `updated_at` FROM `personas`;--> statement-breakpoint
INSERT INTO `learning_prompts` (`id`, `prompt_type`, `world_id`, `persona_id`, `active_version_id`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	'persona_memory', NULL, `id`, NULL, `created_at`, `updated_at` FROM `personas`;--> statement-breakpoint

INSERT INTO `learning_prompt_versions` (
	`id`, `prompt_id`, `version_no`, `parent_version_id`, `prompt_text`, `content_hash`,
	`source_analysis_batch_id`, `change_summary`, `created_by`, `published_at`
)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`learning_prompts`.`id`, 1, NULL,
	(SELECT group_concat(`content`, char(10) || char(10)) FROM (
		SELECT `growth_revisions`.`content` AS `content`
		FROM `growth_records`
		INNER JOIN `growth_revisions` ON `growth_revisions`.`id` = `growth_records`.`current_revision_id`
		WHERE `growth_records`.`status` = 'active'
			AND `growth_records`.`subject_type` = CASE WHEN `learning_prompts`.`prompt_type` = 'world_growth' THEN 'world' ELSE 'persona' END
			AND (`growth_records`.`world_id` = `learning_prompts`.`world_id` OR `growth_records`.`persona_id` = `learning_prompts`.`persona_id`)
		ORDER BY `growth_records`.`created_at`, `growth_records`.`id`
	)),
	lower(hex(randomblob(32))), NULL, '迁移旧有效成长', 'migration', `learning_prompts`.`updated_at`
FROM `learning_prompts`
WHERE `learning_prompts`.`prompt_type` IN ('world_growth', 'persona_growth')
	AND EXISTS (
		SELECT 1 FROM `growth_records`
		WHERE `growth_records`.`status` = 'active'
			AND (`growth_records`.`world_id` = `learning_prompts`.`world_id` OR `growth_records`.`persona_id` = `learning_prompts`.`persona_id`)
	);--> statement-breakpoint

INSERT INTO `learning_prompt_versions` (
	`id`, `prompt_id`, `version_no`, `parent_version_id`, `prompt_text`, `content_hash`,
	`source_analysis_batch_id`, `change_summary`, `created_by`, `published_at`
)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`learning_prompts`.`id`, 1, NULL,
	(SELECT group_concat(`content`, char(10) || char(10)) FROM (
		SELECT `memory_revisions`.`content` AS `content`
		FROM `memory_records`
		INNER JOIN `memory_revisions` ON `memory_revisions`.`id` = `memory_records`.`current_revision_id`
		WHERE `memory_records`.`status` = 'active' AND `memory_records`.`persona_id` = `learning_prompts`.`persona_id`
		ORDER BY `memory_records`.`created_at`, `memory_records`.`id`
	)),
	lower(hex(randomblob(32))), NULL, '迁移旧有效记忆', 'migration', `learning_prompts`.`updated_at`
FROM `learning_prompts`
WHERE `learning_prompts`.`prompt_type` = 'persona_memory'
	AND EXISTS (SELECT 1 FROM `memory_records` WHERE `memory_records`.`status` = 'active' AND `memory_records`.`persona_id` = `learning_prompts`.`persona_id`);--> statement-breakpoint

UPDATE `learning_prompts`
SET `active_version_id` = (
	SELECT `learning_prompt_versions`.`id`
	FROM `learning_prompt_versions`
	WHERE `learning_prompt_versions`.`prompt_id` = `learning_prompts`.`id`
	ORDER BY `learning_prompt_versions`.`version_no` DESC LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM `learning_prompt_versions` WHERE `learning_prompt_versions`.`prompt_id` = `learning_prompts`.`id`);--> statement-breakpoint

CREATE TABLE `__new_analysis_batch_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`input_type` text NOT NULL,
	`input_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`title` text NOT NULL,
	`content_snapshot` text,
	`importance` integer DEFAULT 3 NOT NULL,
	`is_new` integer DEFAULT 1 NOT NULL,
	`source_available` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `analysis_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analysis_batch_inputs_type_check" CHECK(`input_type` IN ('growth_material', 'persona_operation_record', 'world_source', 'persona_feedback_source', 'openviking_memory')),
	CONSTRAINT "analysis_batch_inputs_hash_check" CHECK(length(`content_hash`) = 64),
	CONSTRAINT "analysis_batch_inputs_importance_check" CHECK(`importance` BETWEEN 1 AND 5),
	CONSTRAINT "analysis_batch_inputs_new_check" CHECK(`is_new` IN (0, 1)),
	CONSTRAINT "analysis_batch_inputs_available_check" CHECK(`source_available` IN (0, 1))
);--> statement-breakpoint
INSERT INTO `__new_analysis_batch_inputs` (`id`, `batch_id`, `input_type`, `input_id`, `content_hash`, `title`, `content_snapshot`, `importance`, `is_new`, `source_available`, `created_at`)
SELECT `id`, `batch_id`, `input_type`, `input_id`, `content_hash`, `title`, `content_snapshot`, 3, `is_new`, `source_available`, `created_at`
FROM `analysis_batch_inputs`;--> statement-breakpoint
DROP TABLE `analysis_batch_inputs`;--> statement-breakpoint
ALTER TABLE `__new_analysis_batch_inputs` RENAME TO `analysis_batch_inputs`;--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_batch_inputs_unique` ON `analysis_batch_inputs` (`batch_id`,`input_type`,`input_id`);--> statement-breakpoint
CREATE INDEX `analysis_batch_inputs_source_index` ON `analysis_batch_inputs` (`input_type`,`input_id`);
