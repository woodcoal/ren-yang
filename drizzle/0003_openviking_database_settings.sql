CREATE TABLE `openviking_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`endpoint` text DEFAULT '' NOT NULL,
	`api_key_ciphertext` text DEFAULT '' NOT NULL,
	`timeout_ms` integer DEFAULT 60000 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "openviking_settings_singleton_check" CHECK("openviking_settings"."id" = 'openviking_settings'),
	CONSTRAINT "openviking_settings_enabled_check" CHECK("openviking_settings"."enabled" IN (0, 1)),
	CONSTRAINT "openviking_settings_timeout_check" CHECK("openviking_settings"."timeout_ms" BETWEEN 1000 AND 300000)
);
