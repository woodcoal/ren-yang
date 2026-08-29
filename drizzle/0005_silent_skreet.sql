CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "audit_events_actor_check" CHECK("audit_events"."actor" IN ('administrator', 'maintenance', 'system')),
	CONSTRAINT "audit_events_action_check" CHECK(length(trim("audit_events"."action")) > 0),
	CONSTRAINT "audit_events_target_type_check" CHECK(length(trim("audit_events"."target_type")) > 0),
	CONSTRAINT "audit_events_details_json_check" CHECK(json_valid("audit_events"."details_json"))
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_at_index` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_action_created_at_index` ON `audit_events` (`action`,`created_at`);