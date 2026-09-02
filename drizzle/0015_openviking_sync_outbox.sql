CREATE TABLE `openviking_sync_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`available_at` integer DEFAULT 0 NOT NULL,
	`lease_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "openviking_sync_outbox_type_check" CHECK(`openviking_sync_outbox`.`type` IN ('sync_context_source', 'sync_openviking_users', 'sync_openviking_session')),
	CONSTRAINT "openviking_sync_outbox_status_check" CHECK(`openviking_sync_outbox`.`status` IN ('queued', 'running')),
	CONSTRAINT "openviking_sync_outbox_attempt_check" CHECK(`openviking_sync_outbox`.`attempt_count` >= 0),
	CONSTRAINT "openviking_sync_outbox_max_attempts_check" CHECK(`openviking_sync_outbox`.`max_attempts` > 0)
);
--> statement-breakpoint
CREATE INDEX `openviking_sync_outbox_status_available_index` ON `openviking_sync_outbox` (`status`,`available_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX `openviking_sync_outbox_lease_index` ON `openviking_sync_outbox` (`lease_until`);
--> statement-breakpoint
INSERT OR IGNORE INTO `openviking_sync_outbox` (
	`id`, `type`, `payload_json`, `status`, `attempt_count`, `max_attempts`,
	`available_at`, `lease_until`, `last_error`, `created_at`, `updated_at`
)
SELECT
	`id`, `type`, `payload_json`, 'queued', `attempt_count`, `max_attempts`,
	`available_at`, NULL, `last_error`, `created_at`, `updated_at`
FROM `task_jobs`
WHERE `type` IN ('sync_context_source', 'sync_openviking_users', 'sync_openviking_session')
	AND `status` IN ('queued', 'running')
	AND `attempt_count` < `max_attempts`;
--> statement-breakpoint
DELETE FROM `task_jobs`
WHERE `type` IN ('sync_context_source', 'sync_openviking_users', 'sync_openviking_session');
