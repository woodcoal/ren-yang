ALTER TABLE `ai_prompt_versions` ADD `variable_contract_json` text CHECK (`variable_contract_json` IS NULL OR json_valid(`variable_contract_json`));
--> statement-breakpoint
ALTER TABLE `ai_prompt_versions` ADD `variable_contract_hash` text CHECK (`variable_contract_hash` IS NULL OR length(`variable_contract_hash`) = 64);
--> statement-breakpoint
UPDATE `ai_prompt_versions` AS `version`
SET `variable_contract_json` = (
	SELECT json_group_array(json_object(
		'name', json_extract(`variable`.`value`, '$.name'),
		'label', json_extract(`variable`.`value`, '$.label'),
		'description', json_extract(`variable`.`value`, '$.description'),
		'placement', CASE
			WHEN `prompt`.`kind` = 'image' THEN 'either'
			WHEN instr(COALESCE(`version`.`system_prompt_template`, ''), '{{' || json_extract(`variable`.`value`, '$.name') || '}}') > 0 THEN 'system'
			ELSE 'user'
		END,
		'trust', CASE
			WHEN json_extract(`variable`.`value`, '$.name') IN ('personaPromptJson', 'worldPromptJson', 'worldGrowthPromptJson', 'personaGrowthPromptJson', 'personaMemoryPromptJson') THEN 'trusted'
			ELSE 'untrusted'
		END,
		'encoding', CASE
			WHEN json_extract(`variable`.`value`, '$.name') LIKE '%Json' THEN 'json_string'
			ELSE 'scalar'
		END,
		'cacheRole', CASE
			WHEN `prompt`.`kind` = 'text' AND instr(COALESCE(`version`.`system_prompt_template`, ''), '{{' || json_extract(`variable`.`value`, '$.name') || '}}') > 0 THEN 'stable'
			ELSE 'volatile'
		END
	))
	FROM `ai_prompts` AS `prompt`, json_each(`prompt`.`variables_json`) AS `variable`
	WHERE `prompt`.`code` = `version`.`prompt_code`
		AND (
			instr(COALESCE(`version`.`system_prompt_template`, ''), '{{' || json_extract(`variable`.`value`, '$.name') || '}}') > 0
			OR instr(`version`.`user_prompt_template`, '{{' || json_extract(`variable`.`value`, '$.name') || '}}') > 0
		)
);
--> statement-breakpoint
UPDATE `ai_prompts` AS `prompt`
SET `variables_json` = (
	SELECT json_group_array(json_object(
		'name', json_extract(`variable`.`value`, '$.name'),
		'label', json_extract(`variable`.`value`, '$.label'),
		'description', json_extract(`variable`.`value`, '$.description'),
		'placement', CASE
			WHEN `prompt`.`kind` = 'image' THEN 'either'
			WHEN instr(COALESCE(`version`.`system_prompt_template`, ''), '{{' || json_extract(`variable`.`value`, '$.name') || '}}') > 0 THEN 'system'
			ELSE 'user'
		END,
		'trust', CASE
			WHEN json_extract(`variable`.`value`, '$.name') IN ('personaPromptJson', 'worldPromptJson', 'worldGrowthPromptJson', 'personaGrowthPromptJson', 'personaMemoryPromptJson') THEN 'trusted'
			ELSE 'untrusted'
		END,
		'encoding', CASE
			WHEN json_extract(`variable`.`value`, '$.name') LIKE '%Json' THEN 'json_string'
			ELSE 'scalar'
		END,
		'cacheRole', CASE
			WHEN `prompt`.`kind` = 'text' AND instr(COALESCE(`version`.`system_prompt_template`, ''), '{{' || json_extract(`variable`.`value`, '$.name') || '}}') > 0 THEN 'stable'
			ELSE 'volatile'
		END
	))
	FROM json_each(`prompt`.`variables_json`) AS `variable`
	LEFT JOIN `ai_prompt_versions` AS `version` ON `version`.`id` = `prompt`.`active_version_id`
);
--> statement-breakpoint
UPDATE `ai_prompts`
SET `variables_json` = (
	SELECT json_group_array(json(`value`))
	FROM json_each(`ai_prompts`.`variables_json`)
	WHERE json_extract(`value`, '$.name') IN (
		'personaPromptJson', 'worldPromptJson', 'briefJson', 'previousOutputsJson', 'negativePromptJson'
	)
),
	`description` = '根据人物与世界视觉身份、视觉简报和必要前置文字生成内容配图。',
	`updated_at` = 1790755200000
WHERE `code` = 'generation.image_block';
--> statement-breakpoint
UPDATE `ai_prompts`
SET `variables_json` = (
	SELECT json_group_array(json_set(
		json(`value`),
		'$.placement', CASE
			WHEN json_extract(`value`, '$.name') IN ('personaPromptJson', 'worldPromptJson', 'worldGrowthPromptJson', 'personaGrowthPromptJson', 'personaMemoryPromptJson') THEN 'system'
			ELSE 'user'
		END,
		'$.cacheRole', CASE
			WHEN json_extract(`value`, '$.name') IN ('personaPromptJson', 'worldPromptJson', 'worldGrowthPromptJson', 'personaGrowthPromptJson', 'personaMemoryPromptJson') THEN 'stable'
			ELSE 'volatile'
		END
	))
	FROM json_each(`ai_prompts`.`variables_json`)
), `updated_at` = 1790755200000
WHERE `code` = 'generation.document_plan';
--> statement-breakpoint
INSERT INTO `ai_prompt_versions` (
	`id`, `prompt_code`, `version_no`, `system_prompt_template`, `user_prompt_template`,
	`variable_contract_json`, `variable_contract_hash`, `change_summary`, `published_at`
)
SELECT
	'00000000-0000-4000-8001-000000000055', `ai_prompts`.`code`,
	(SELECT MAX(`version_no`) + 1 FROM `ai_prompt_versions` WHERE `prompt_code` = `ai_prompts`.`code`),
	NULL,
	'根据以下视觉简报生成一张辅助内容表达的图片。不要在图片中生成水印、签名、界面或多余文字。
<人物视觉身份>{{personaPromptJson}}</人物视觉身份>
<世界视觉规则>{{worldPromptJson}}</世界视觉规则>
<视觉简报>{{briefJson}}</视觉简报>
<必要前置文字>{{previousOutputsJson}}</必要前置文字>
<负面约束>{{negativePromptJson}}</负面约束>',
	`ai_prompts`.`variables_json`, NULL,
	'图片提示仅保留视觉身份、简报、必要前文和负面约束', 1790755200000
FROM `ai_prompts`
WHERE `code` = 'generation.image_block'
	AND NOT EXISTS (SELECT 1 FROM `ai_prompt_versions` WHERE `id` = '00000000-0000-4000-8001-000000000055');
--> statement-breakpoint
UPDATE `ai_prompts`
SET `active_version_id` = '00000000-0000-4000-8001-000000000055', `updated_at` = 1790755200000
WHERE `code` = 'generation.image_block';
--> statement-breakpoint
INSERT INTO `ai_prompt_versions` (
	`id`, `prompt_code`, `version_no`, `system_prompt_template`, `user_prompt_template`,
	`variable_contract_json`, `variable_contract_hash`, `change_summary`, `published_at`
)
SELECT
	'00000000-0000-4000-8001-000000000056', `ai_prompts`.`code`,
	(SELECT MAX(`version_no`) + 1 FROM `ai_prompt_versions` WHERE `prompt_code` = `ai_prompts`.`code`),
	`active_version`.`system_prompt_template` || '
<已发布人物灵魂>{{personaPromptJson}}</已发布人物灵魂>
<已发布世界灵魂>{{worldPromptJson}}</已发布世界灵魂>
<当前世界成长提示词>{{worldGrowthPromptJson}}</当前世界成长提示词>
<当前人物成长提示词>{{personaGrowthPromptJson}}</当前人物成长提示词>
<当前人物记忆提示词>{{personaMemoryPromptJson}}</当前人物记忆提示词>',
	'<有效世界成长>{{worldGrowthEvidenceJson}}</有效世界成长>
<有效人物成长>{{personaGrowthEvidenceJson}}</有效人物成长>
<有效人物记忆>{{personaMemoryEvidenceJson}}</有效人物记忆>
<不可信参考资料>{{sourceEvidenceJson}}</不可信参考资料>
<仅本次场景>{{sceneJson}}</仅本次场景>
<创作要求>{{requirementJson}}</创作要求>
<格式模板>{{guidanceJson}}</格式模板>',
	`ai_prompts`.`variables_json`, NULL,
	'固定人物与世界心智进入系统消息，变化的规划任务与证据保留在用户消息', 1790755200000
FROM `ai_prompts`
INNER JOIN `ai_prompt_versions` AS `active_version` ON `active_version`.`id` = `ai_prompts`.`active_version_id`
WHERE `ai_prompts`.`code` = 'generation.document_plan'
	AND NOT EXISTS (SELECT 1 FROM `ai_prompt_versions` WHERE `id` = '00000000-0000-4000-8001-000000000056');
--> statement-breakpoint
UPDATE `ai_prompts`
SET `active_version_id` = '00000000-0000-4000-8001-000000000056', `updated_at` = 1790755200000
WHERE `code` = 'generation.document_plan';
