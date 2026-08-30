INSERT INTO `soul_versions` (
  `id`, `subject_type`, `world_id`, `persona_id`, `parent_version_id`, `prompt_text`,
  `runtime_token_count`, `token_counter`, `change_summary`, `status`, `published_at`, `created_at`
)
SELECT
  `id`, `subject_type`, `world_id`, `persona_id`, `base_version_id`, `prompt_text`,
  MAX(1, (length(CAST(`prompt_text` AS BLOB)) + 2) / 3),
  'utf8-bytes-v1:migration',
  CASE WHEN trim(`change_summary`) = '' THEN '迁移现有灵魂提示词' ELSE `change_summary` END,
  'published', `updated_at`, `updated_at`
FROM `soul_drafts`;--> statement-breakpoint
UPDATE `worlds`
SET
  `active_soul_version_id` = (SELECT `id` FROM `soul_drafts` WHERE `world_id` = `worlds`.`id`),
  `updated_at` = MAX(`updated_at`, (SELECT `updated_at` FROM `soul_drafts` WHERE `world_id` = `worlds`.`id`))
WHERE EXISTS (SELECT 1 FROM `soul_drafts` WHERE `world_id` = `worlds`.`id`);--> statement-breakpoint
UPDATE `personas`
SET
  `active_soul_version_id` = (SELECT `id` FROM `soul_drafts` WHERE `persona_id` = `personas`.`id`),
  `updated_at` = MAX(`updated_at`, (SELECT `updated_at` FROM `soul_drafts` WHERE `persona_id` = `personas`.`id`))
WHERE EXISTS (SELECT 1 FROM `soul_drafts` WHERE `persona_id` = `personas`.`id`);--> statement-breakpoint
DELETE FROM `soul_drafts`;
