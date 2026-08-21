ALTER TABLE `roadmaps` ADD `actual_source` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
UPDATE `roadmaps` SET `actual_source` = 'formula' WHERE `actual_formula_id` IS NOT NULL;
