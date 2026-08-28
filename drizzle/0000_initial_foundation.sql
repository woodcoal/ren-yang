CREATE TABLE `administrators` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "administrators_singleton_check" CHECK("administrators"."id" = 'administrator'),
	CONSTRAINT "administrators_username_not_empty_check" CHECK(length(trim("administrators"."username")) > 0),
	CONSTRAINT "administrators_credential_version_check" CHECK("administrators"."credential_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `administrators_username_unique` ON `administrators` (`username`);--> statement-breakpoint
CREATE TABLE `task_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 2 NOT NULL,
	`lease_until` integer,
	`heartbeat_at` integer,
	`cancel_requested_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "task_jobs_status_check" CHECK("task_jobs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancel_requested', 'canceled')),
	CONSTRAINT "task_jobs_attempt_count_check" CHECK("task_jobs"."attempt_count" >= 0),
	CONSTRAINT "task_jobs_max_attempts_check" CHECK("task_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE INDEX `task_jobs_status_created_at_index` ON `task_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_jobs_lease_until_index` ON `task_jobs` (`lease_until`);
