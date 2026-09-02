ALTER TABLE `openviking_settings` ADD `account_id` text NOT NULL DEFAULT 'ren-yang'
  CHECK (length(trim(`account_id`)) > 0);
