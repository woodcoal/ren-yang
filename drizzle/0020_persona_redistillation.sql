ALTER TABLE `persona_distillation_runs` ADD `mode` text DEFAULT 'create' NOT NULL CHECK(`mode` IN ('create', 'update'));
--> statement-breakpoint
ALTER TABLE `persona_distillation_runs` ADD `base_soul_version_id` text REFERENCES `soul_versions`(`id`) ON DELETE set null;
