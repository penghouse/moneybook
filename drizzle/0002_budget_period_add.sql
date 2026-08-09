-- Hand-corrected over what `drizzle-kit` generated. Its rebuild selected
-- the new columns out of the old table (which cannot work) and wrapped
-- itself in `PRAGMA foreign_keys`, which a remote libSQL server refuses.
--
-- The PRAGMA is not needed here at all: `budgets` references other
-- tables but nothing references *it*, so dropping and recreating it
-- never trips a foreign key. The existing rows carry across as month
-- budgets, which is what every one of them was.

CREATE TABLE `__new_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`account_id` text NOT NULL,
	`year_month` text DEFAULT '' NOT NULL,
	`period` text DEFAULT 'month' NOT NULL,
	`period_key` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budgets_period_check" CHECK("__new_budgets"."period" IN ('month','year')),
	CONSTRAINT "budgets_period_key_format_check" CHECK(("__new_budgets"."period" = 'month' AND "__new_budgets"."period_key" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
       OR ("__new_budgets"."period" = 'year' AND "__new_budgets"."period_key" GLOB '[0-9][0-9][0-9][0-9]'))
);
--> statement-breakpoint
INSERT INTO `__new_budgets`("id", "section_id", "account_id", "year_month", "period", "period_key", "amount") SELECT "id", "section_id", "account_id", "year_month", 'month', "year_month", "amount" FROM `budgets`;--> statement-breakpoint
DROP TABLE `budgets`;--> statement-breakpoint
ALTER TABLE `__new_budgets` RENAME TO `budgets`;--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_account_year_month_unique` ON `budgets` (`account_id`,`year_month`);--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_account_period_unique` ON `budgets` (`account_id`,`period`,`period_key`);
