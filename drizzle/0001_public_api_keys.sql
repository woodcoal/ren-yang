CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_digest` text NOT NULL,
	`scopes_json` text NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "api_keys_name_check" CHECK(length(trim("api_keys"."name")) > 0),
	CONSTRAINT "api_keys_prefix_check" CHECK(length("api_keys"."key_prefix") = 12),
	CONSTRAINT "api_keys_digest_check" CHECK(length("api_keys"."key_digest") = 64),
	CONSTRAINT "api_keys_scopes_json_check" CHECK(json_valid("api_keys"."scopes_json") AND json_type("api_keys"."scopes_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_digest_unique` ON `api_keys` (`key_digest`);--> statement-breakpoint
CREATE INDEX `api_keys_created_at_index` ON `api_keys` (`created_at`);