CREATE TABLE `__new_ai_algorithms` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`implementation_version` integer NOT NULL,
	`active_configuration_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ai_algorithms_code_check" CHECK("code" IN ('persona_soul', 'world_soul', 'persona_growth', 'world_growth', 'persona_memory', 'persona_draft', 'world_draft', 'feedback_classification', 'persona_avatar', 'interest_assessment', 'article_generation', 'article_image_analysis', 'article_text_revision', 'article_image_generation')),
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
INSERT INTO `ai_algorithms` (`code`, `name`, `description`, `implementation_version`, `active_configuration_version_id`, `created_at`, `updated_at`) VALUES
('persona_draft', '人物草稿生成', '根据用户要求、可选世界和资料生成待确认的人物初始草稿。', 1, NULL, 1789632000000, 1789632000000),
('world_draft', '世界草稿生成', '根据用户要求生成待确认的世界初始草稿。', 1, NULL, 1789632000000, 1789632000000),
('feedback_classification', '反馈分类', '判断用户反馈影响当前产物、参数建议、人物成长还是资料事实。', 1, NULL, 1789632000000, 1789632000000),
('persona_avatar', '人物头像生成', '根据人物名称、当前灵魂和补充视觉要求生成头像。', 1, NULL, 1789632000000, 1789632000000),
('article_text_revision', '文章正文修正', '根据用户反馈重新生成指定文章段落。', 1, NULL, 1789632000000, 1789632000000),
('article_image_generation', '文章图片生成', '根据最终文章、人物个性和配图简报生成文章图片。', 1, NULL, 1789632000000, 1789632000000);
--> statement-breakpoint
INSERT INTO `ai_algorithm_configuration_versions` (`id`, `algorithm_code`, `version_no`, `created_at`)
SELECT '00000000-0000-4000-8002-000000000041', 'persona_draft', 1, 1789632000000
FROM `system_ai_settings`
WHERE `id` = 'system_ai_settings' AND EXISTS (
	SELECT 1 FROM `ai_model_deployments` WHERE `id` = json_extract(`values_json`, '$.textModelDeploymentId') AND `modality` = 'text' AND `is_enabled` = 1
);
--> statement-breakpoint
INSERT INTO `ai_algorithm_configuration_versions` (`id`, `algorithm_code`, `version_no`, `created_at`)
SELECT '00000000-0000-4000-8002-000000000042', 'world_draft', 1, 1789632000000
FROM `system_ai_settings`
WHERE `id` = 'system_ai_settings' AND EXISTS (
	SELECT 1 FROM `ai_model_deployments` WHERE `id` = json_extract(`values_json`, '$.textModelDeploymentId') AND `modality` = 'text' AND `is_enabled` = 1
);
--> statement-breakpoint
INSERT INTO `ai_algorithm_configuration_versions` (`id`, `algorithm_code`, `version_no`, `created_at`)
SELECT '00000000-0000-4000-8002-000000000043', 'feedback_classification', 1, 1789632000000
FROM `system_ai_settings`
WHERE `id` = 'system_ai_settings' AND EXISTS (
	SELECT 1 FROM `ai_model_deployments` WHERE `id` = json_extract(`values_json`, '$.textModelDeploymentId') AND `modality` = 'text' AND `is_enabled` = 1
);
--> statement-breakpoint
INSERT INTO `ai_algorithm_configuration_versions` (`id`, `algorithm_code`, `version_no`, `created_at`)
SELECT '00000000-0000-4000-8002-000000000044', 'persona_avatar', 1, 1789632000000
FROM `system_ai_settings`
WHERE `id` = 'system_ai_settings' AND EXISTS (
	SELECT 1 FROM `ai_model_deployments` WHERE `id` = json_extract(`values_json`, '$.imageModelDeploymentId') AND `modality` = 'image' AND `is_enabled` = 1
);
--> statement-breakpoint
INSERT INTO `ai_algorithm_configuration_versions` (`id`, `algorithm_code`, `version_no`, `created_at`)
SELECT '00000000-0000-4000-8002-000000000045', 'article_text_revision', 1, 1789632000000
FROM `system_ai_settings`
WHERE `id` = 'system_ai_settings' AND EXISTS (
	SELECT 1 FROM `ai_model_deployments` WHERE `id` = json_extract(`values_json`, '$.textModelDeploymentId') AND `modality` = 'text' AND `is_enabled` = 1
);
--> statement-breakpoint
INSERT INTO `ai_algorithm_configuration_versions` (`id`, `algorithm_code`, `version_no`, `created_at`)
SELECT '00000000-0000-4000-8002-000000000046', 'article_image_generation', 1, 1789632000000
FROM `system_ai_settings`
WHERE `id` = 'system_ai_settings' AND EXISTS (
	SELECT 1 FROM `ai_model_deployments` WHERE `id` = json_extract(`values_json`, '$.imageModelDeploymentId') AND `modality` = 'image' AND `is_enabled` = 1
);
--> statement-breakpoint
INSERT INTO `ai_algorithm_step_configurations` (`id`, `configuration_version_id`, `step_key`, `ordinal`, `model_deployment_id`, `prompt_code`, `parameters_json`)
SELECT '00000000-0000-4000-8003-000000000041', '00000000-0000-4000-8002-000000000041', 'generate', 0,
	json_extract(`values_json`, '$.textModelDeploymentId'), 'generation.persona_draft', json_object(
		'temperature', COALESCE(json_extract(`values_json`, '$.draftGeneration.temperature'), 0.4),
		'maxOutputTokens', COALESCE(json_extract(`values_json`, '$.draftGeneration.maxOutputTokens'), 2048),
		'timeoutMs', COALESCE(json_extract(`values_json`, '$.draftGeneration.timeoutMs'), 60000)
	)
FROM `system_ai_settings` WHERE `id` = 'system_ai_settings' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000041');
--> statement-breakpoint
INSERT INTO `ai_algorithm_step_configurations` (`id`, `configuration_version_id`, `step_key`, `ordinal`, `model_deployment_id`, `prompt_code`, `parameters_json`)
SELECT '00000000-0000-4000-8003-000000000042', '00000000-0000-4000-8002-000000000042', 'generate', 0,
	json_extract(`values_json`, '$.textModelDeploymentId'), 'generation.world_draft', json_object(
		'temperature', COALESCE(json_extract(`values_json`, '$.draftGeneration.temperature'), 0.4),
		'maxOutputTokens', COALESCE(json_extract(`values_json`, '$.draftGeneration.maxOutputTokens'), 2048),
		'timeoutMs', COALESCE(json_extract(`values_json`, '$.draftGeneration.timeoutMs'), 60000)
	)
FROM `system_ai_settings` WHERE `id` = 'system_ai_settings' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000042');
--> statement-breakpoint
INSERT INTO `ai_algorithm_step_configurations` (`id`, `configuration_version_id`, `step_key`, `ordinal`, `model_deployment_id`, `prompt_code`, `parameters_json`)
SELECT '00000000-0000-4000-8003-000000000043', '00000000-0000-4000-8002-000000000043', 'classify', 0,
	json_extract(`values_json`, '$.textModelDeploymentId'), 'feedback.classification', json_object(
		'temperature', COALESCE(json_extract(`values_json`, '$.feedbackClassification.temperature'), 0),
		'maxOutputTokens', COALESCE(json_extract(`values_json`, '$.feedbackClassification.maxOutputTokens'), 4096),
		'timeoutMs', COALESCE(json_extract(`values_json`, '$.feedbackClassification.timeoutMs'), 60000)
	)
FROM `system_ai_settings` WHERE `id` = 'system_ai_settings' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000043');
--> statement-breakpoint
INSERT INTO `ai_algorithm_step_configurations` (`id`, `configuration_version_id`, `step_key`, `ordinal`, `model_deployment_id`, `prompt_code`, `parameters_json`)
SELECT '00000000-0000-4000-8003-000000000044', '00000000-0000-4000-8002-000000000044', 'generate', 0,
	json_extract(`values_json`, '$.imageModelDeploymentId'), 'content.persona_avatar', json_object('temperature', 0, 'maxOutputTokens', 64, 'timeoutMs', 120000)
FROM `system_ai_settings` WHERE `id` = 'system_ai_settings' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000044');
--> statement-breakpoint
INSERT INTO `ai_algorithm_step_configurations` (`id`, `configuration_version_id`, `step_key`, `ordinal`, `model_deployment_id`, `prompt_code`, `parameters_json`)
SELECT '00000000-0000-4000-8003-000000000045', '00000000-0000-4000-8002-000000000045', 'revise', 0,
	json_extract(`values_json`, '$.textModelDeploymentId'), 'generation.text_block', json_object('temperature', 0.4, 'maxOutputTokens', 2048, 'timeoutMs', 60000)
FROM `system_ai_settings` WHERE `id` = 'system_ai_settings' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000045');
--> statement-breakpoint
INSERT INTO `ai_algorithm_step_configurations` (`id`, `configuration_version_id`, `step_key`, `ordinal`, `model_deployment_id`, `prompt_code`, `parameters_json`)
SELECT '00000000-0000-4000-8003-000000000046', '00000000-0000-4000-8002-000000000046', 'generate', 0,
	json_extract(`values_json`, '$.imageModelDeploymentId'), 'generation.image_block', json_object('temperature', 0, 'maxOutputTokens', 64, 'timeoutMs', 60000)
FROM `system_ai_settings` WHERE `id` = 'system_ai_settings' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000046');
--> statement-breakpoint
UPDATE `ai_algorithms` SET `active_configuration_version_id` = '00000000-0000-4000-8002-000000000041', `updated_at` = 1789632000000
WHERE `code` = 'persona_draft' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000041');
--> statement-breakpoint
UPDATE `ai_algorithms` SET `active_configuration_version_id` = '00000000-0000-4000-8002-000000000042', `updated_at` = 1789632000000
WHERE `code` = 'world_draft' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000042');
--> statement-breakpoint
UPDATE `ai_algorithms` SET `active_configuration_version_id` = '00000000-0000-4000-8002-000000000043', `updated_at` = 1789632000000
WHERE `code` = 'feedback_classification' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000043');
--> statement-breakpoint
UPDATE `ai_algorithms` SET `active_configuration_version_id` = '00000000-0000-4000-8002-000000000044', `updated_at` = 1789632000000
WHERE `code` = 'persona_avatar' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000044');
--> statement-breakpoint
UPDATE `ai_algorithms` SET `active_configuration_version_id` = '00000000-0000-4000-8002-000000000045', `updated_at` = 1789632000000
WHERE `code` = 'article_text_revision' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000045');
--> statement-breakpoint
UPDATE `ai_algorithms` SET `active_configuration_version_id` = '00000000-0000-4000-8002-000000000046', `updated_at` = 1789632000000
WHERE `code` = 'article_image_generation' AND EXISTS (SELECT 1 FROM `ai_algorithm_configuration_versions` WHERE `id` = '00000000-0000-4000-8002-000000000046');
