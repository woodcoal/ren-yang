ALTER TABLE `ai_model_deployments` ADD `thinking_control` text NOT NULL DEFAULT 'none'
  CHECK(`thinking_control` IN ('none', 'enable_thinking', 'reasoning_effort', 'reasoning'));
