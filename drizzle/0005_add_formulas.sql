CREATE TABLE `formulas` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`terms` text DEFAULT '[]' NOT NULL,
	`expression` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "formulas_scope_check" CHECK("formulas"."scope" IN ('assets','income'))
);
--> statement-breakpoint
CREATE INDEX `formulas_section_scope_idx` ON `formulas` (`section_id`,`scope`,`sort_order`);