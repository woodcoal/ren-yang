UPDATE `ai_prompts`
SET `variables_json` = json_set(
	`variables_json`,
	'$[9].label', '附加提示词',
	'$[9].description', 'JSON 字符串或 null'
), `updated_at` = 1789718400000
WHERE `code` = 'generation.interest_assessment';
--> statement-breakpoint
INSERT INTO `ai_prompt_versions` (
	`id`, `prompt_code`, `version_no`, `system_prompt_template`, `user_prompt_template`, `change_summary`, `published_at`
)
SELECT
	'00000000-0000-4000-8001-000000000047',
	`ai_prompts`.`code`,
	(SELECT MAX(`version_no`) + 1 FROM `ai_prompt_versions` WHERE `prompt_code` = `ai_prompts`.`code`),
	`active_version`.`system_prompt_template`,
	replace(
		replace(`active_version`.`user_prompt_template`, '<仅本次场景>', '<附加提示词>'),
		'</仅本次场景>', '</附加提示词>'
	),
	'将结构化临时场景简化为整批附加提示词',
	1789718400000
FROM `ai_prompts`
INNER JOIN `ai_prompt_versions` AS `active_version`
	ON `active_version`.`id` = `ai_prompts`.`active_version_id`
WHERE `ai_prompts`.`code` = 'generation.interest_assessment';
--> statement-breakpoint
UPDATE `ai_prompts`
SET `active_version_id` = '00000000-0000-4000-8001-000000000047', `updated_at` = 1789718400000
WHERE `code` = 'generation.interest_assessment'
	AND EXISTS (
		SELECT 1 FROM `ai_prompt_versions` WHERE `id` = '00000000-0000-4000-8001-000000000047'
	);
