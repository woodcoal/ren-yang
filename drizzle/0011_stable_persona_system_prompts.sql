INSERT INTO `ai_prompt_versions` (
	`id`, `prompt_code`, `version_no`, `system_prompt_template`, `user_prompt_template`, `change_summary`, `published_at`
)
SELECT
	'00000000-0000-4000-8001-000000000051',
	`ai_prompts`.`code`,
	(SELECT MAX(`version_no`) + 1 FROM `ai_prompt_versions` WHERE `prompt_code` = `ai_prompts`.`code`),
	`active_version`.`system_prompt_template` || CASE
		WHEN instr(`active_version`.`system_prompt_template`, '{{personaPromptJson}}') > 0 THEN ''
		ELSE '
<已发布人物灵魂>{{personaPromptJson}}</已发布人物灵魂>
<已发布世界灵魂>{{worldPromptJson}}</已发布世界灵魂>
<当前世界成长提示词>{{worldGrowthPromptJson}}</当前世界成长提示词>
<当前人物成长提示词>{{personaGrowthPromptJson}}</当前人物成长提示词>
<当前人物记忆提示词>{{personaMemoryPromptJson}}</当前人物记忆提示词>'
	END,
	'<有效世界成长>{{worldGrowthEvidenceJson}}</有效世界成长>
<有效人物成长>{{personaGrowthEvidenceJson}}</有效人物成长>
<有效人物记忆>{{personaMemoryEvidenceJson}}</有效人物记忆>
<不可信参考资料>{{sourceEvidenceJson}}</不可信参考资料>
<附加提示词>{{sceneJson}}</附加提示词>
<待判断文本列表>{{contentJson}}</待判断文本列表>',
	'固定人物心智进入系统消息，变化的兴趣文本与证据保留在用户消息',
	1790236800000
FROM `ai_prompts`
INNER JOIN `ai_prompt_versions` AS `active_version`
	ON `active_version`.`id` = `ai_prompts`.`active_version_id`
WHERE `ai_prompts`.`code` = 'generation.interest_assessment'
	AND instr(`active_version`.`user_prompt_template`, '{{personaPromptJson}}') > 0
	AND NOT EXISTS (
		SELECT 1 FROM `ai_prompt_versions` WHERE `id` = '00000000-0000-4000-8001-000000000051'
	);
--> statement-breakpoint
UPDATE `ai_prompts`
SET `active_version_id` = '00000000-0000-4000-8001-000000000051', `updated_at` = 1790236800000
WHERE `code` = 'generation.interest_assessment'
	AND EXISTS (
		SELECT 1 FROM `ai_prompt_versions` WHERE `id` = '00000000-0000-4000-8001-000000000051'
	);
--> statement-breakpoint
INSERT INTO `ai_prompt_versions` (
	`id`, `prompt_code`, `version_no`, `system_prompt_template`, `user_prompt_template`, `change_summary`, `published_at`
)
SELECT
	'00000000-0000-4000-8001-000000000052',
	`ai_prompts`.`code`,
	(SELECT MAX(`version_no`) + 1 FROM `ai_prompt_versions` WHERE `prompt_code` = `ai_prompts`.`code`),
	`active_version`.`system_prompt_template` || CASE
		WHEN instr(`active_version`.`system_prompt_template`, '{{personaPromptJson}}') > 0 THEN ''
		ELSE '
<已发布人物灵魂>{{personaPromptJson}}</已发布人物灵魂>
<已发布世界灵魂>{{worldPromptJson}}</已发布世界灵魂>
<当前世界成长提示词>{{worldGrowthPromptJson}}</当前世界成长提示词>
<当前人物成长提示词>{{personaGrowthPromptJson}}</当前人物成长提示词>
<当前人物记忆提示词>{{personaMemoryPromptJson}}</当前人物记忆提示词>'
	END,
	'<有效世界成长>{{worldGrowthEvidenceJson}}</有效世界成长>
<有效人物成长>{{personaGrowthEvidenceJson}}</有效人物成长>
<有效人物记忆>{{personaMemoryEvidenceJson}}</有效人物记忆>
<不可信参考资料>{{sourceEvidenceJson}}</不可信参考资料>
<仅本次场景>{{sceneJson}}</仅本次场景>
<创作条件>{{requirementJson}}</创作条件>
<输出格式>{{outputFormat}}</输出格式>',
	'固定人物心智进入系统消息，变化的创作条件与证据保留在用户消息',
	1790236800000
FROM `ai_prompts`
INNER JOIN `ai_prompt_versions` AS `active_version`
	ON `active_version`.`id` = `ai_prompts`.`active_version_id`
WHERE `ai_prompts`.`code` = 'generation.article'
	AND instr(`active_version`.`user_prompt_template`, '{{personaPromptJson}}') > 0
	AND NOT EXISTS (
		SELECT 1 FROM `ai_prompt_versions` WHERE `id` = '00000000-0000-4000-8001-000000000052'
	);
--> statement-breakpoint
UPDATE `ai_prompts`
SET `active_version_id` = '00000000-0000-4000-8001-000000000052', `updated_at` = 1790236800000
WHERE `code` = 'generation.article'
	AND EXISTS (
		SELECT 1 FROM `ai_prompt_versions` WHERE `id` = '00000000-0000-4000-8001-000000000052'
	);
--> statement-breakpoint
INSERT INTO `ai_prompt_versions` (
	`id`, `prompt_code`, `version_no`, `system_prompt_template`, `user_prompt_template`, `change_summary`, `published_at`
)
SELECT
	'00000000-0000-4000-8001-000000000053',
	`ai_prompts`.`code`,
	(SELECT MAX(`version_no`) + 1 FROM `ai_prompt_versions` WHERE `prompt_code` = `ai_prompts`.`code`),
	`active_version`.`system_prompt_template` || CASE
		WHEN instr(`active_version`.`system_prompt_template`, '{{personaPromptJson}}') > 0 THEN ''
		ELSE '
<已发布人物灵魂>{{personaPromptJson}}</已发布人物灵魂>
<已发布世界灵魂>{{worldPromptJson}}</已发布世界灵魂>
<当前世界成长提示词>{{worldGrowthPromptJson}}</当前世界成长提示词>
<当前人物成长提示词>{{personaGrowthPromptJson}}</当前人物成长提示词>
<当前人物记忆提示词>{{personaMemoryPromptJson}}</当前人物记忆提示词>'
	END,
	'<有效世界成长>{{worldGrowthEvidenceJson}}</有效世界成长>
<有效人物成长>{{personaGrowthEvidenceJson}}</有效人物成长>
<有效人物记忆>{{personaMemoryEvidenceJson}}</有效人物记忆>
<不可信参考资料>{{sourceEvidenceJson}}</不可信参考资料>
<仅本次场景>{{sceneJson}}</仅本次场景>
<当前块任务>{{instructionJson}}</当前块任务>
<已确认文档规格>{{documentSpecJson}}</已确认文档规格>
<前置块输出>{{previousOutputsJson}}</前置块输出>',
	'固定人物心智进入系统消息，变化的正文任务与证据保留在用户消息',
	1790236800000
FROM `ai_prompts`
INNER JOIN `ai_prompt_versions` AS `active_version`
	ON `active_version`.`id` = `ai_prompts`.`active_version_id`
WHERE `ai_prompts`.`code` = 'generation.text_block'
	AND instr(`active_version`.`user_prompt_template`, '{{personaPromptJson}}') > 0
	AND NOT EXISTS (
		SELECT 1 FROM `ai_prompt_versions` WHERE `id` = '00000000-0000-4000-8001-000000000053'
	);
--> statement-breakpoint
UPDATE `ai_prompts`
SET `active_version_id` = '00000000-0000-4000-8001-000000000053', `updated_at` = 1790236800000
WHERE `code` = 'generation.text_block'
	AND EXISTS (
		SELECT 1 FROM `ai_prompt_versions` WHERE `id` = '00000000-0000-4000-8001-000000000053'
	);
