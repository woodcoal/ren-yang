ALTER TABLE `ai_model_deployments`
ADD `default_timeout_ms` integer DEFAULT 60000 NOT NULL
CHECK (`default_timeout_ms` BETWEEN 1000 AND 120000);
