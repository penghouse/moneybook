CREATE TABLE `roadmaps` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`name` text NOT NULL,
	`start_year` text NOT NULL,
	`end_year` text NOT NULL,
	`starting_amount` integer DEFAULT 0 NOT NULL,
	`default_contribution` integer DEFAULT 0 NOT NULL,
	`default_return_rate` real DEFAULT 0 NOT NULL,
	`actual_formula_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actual_formula_id`) REFERENCES `formulas`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "roadmaps_start_year_format_check" CHECK("roadmaps"."start_year" GLOB '[0-9][0-9][0-9][0-9]'),
	CONSTRAINT "roadmaps_end_year_format_check" CHECK("roadmaps"."end_year" GLOB '[0-9][0-9][0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `roadmaps_section_idx` ON `roadmaps` (`section_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `roadmap_years` (
	`id` text PRIMARY KEY NOT NULL,
	`roadmap_id` text NOT NULL,
	`year` text NOT NULL,
	`contribution` integer,
	`return_rate` real,
	`note` text,
	FOREIGN KEY (`roadmap_id`) REFERENCES `roadmaps`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "roadmap_years_year_format_check" CHECK("roadmap_years"."year" GLOB '[0-9][0-9][0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roadmap_years_year_unique` ON `roadmap_years` (`roadmap_id`,`year`);
