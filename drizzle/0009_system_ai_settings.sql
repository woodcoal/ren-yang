CREATE TABLE `system_ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`values_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "system_ai_settings_singleton_check" CHECK("system_ai_settings"."id" = 'system_ai_settings'),
	CONSTRAINT "system_ai_settings_values_json_check" CHECK(json_valid("system_ai_settings"."values_json"))
);
