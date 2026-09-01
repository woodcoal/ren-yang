CREATE TABLE `public_api_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
	`request_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`result` text NOT NULL,
	`status_code` integer NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "public_api_audit_result_check" CHECK("public_api_audit_events"."result" IN ('succeeded', 'failed')),
	CONSTRAINT "public_api_audit_status_check" CHECK("public_api_audit_events"."status_code" BETWEEN 100 AND 599)
);
--> statement-breakpoint
CREATE INDEX `public_api_audit_key_created_at_index` ON `public_api_audit_events` (`api_key_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `public_api_audit_created_at_index` ON `public_api_audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `public_api_idempotency_records` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "public_api_idempotency_method_check" CHECK(length(trim("public_api_idempotency_records"."method")) > 0),
	CONSTRAINT "public_api_idempotency_path_check" CHECK(length(trim("public_api_idempotency_records"."path")) > 0),
	CONSTRAINT "public_api_idempotency_key_check" CHECK(length(trim("public_api_idempotency_records"."idempotency_key")) BETWEEN 1 AND 200),
	CONSTRAINT "public_api_idempotency_hash_check" CHECK(length("public_api_idempotency_records"."request_hash") = 64),
	CONSTRAINT "public_api_idempotency_response_check" CHECK("public_api_idempotency_records"."response_json" IS NULL OR json_valid("public_api_idempotency_records"."response_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_api_idempotency_identity_unique` ON `public_api_idempotency_records` (`api_key_id`,`method`,`path`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `public_api_idempotency_created_at_index` ON `public_api_idempotency_records` (`created_at`);