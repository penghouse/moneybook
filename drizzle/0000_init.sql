CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`group` text NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active_from` text,
	`active_to` text,
	`memo` text,
	`category` text,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "accounts_group_check" CHECK("accounts"."group" IN ('asset','liability','equity','expense','income')),
	CONSTRAINT "accounts_active_from_format_check" CHECK("accounts"."active_from" IS NULL OR "accounts"."active_from" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "accounts_active_to_format_check" CHECK("accounts"."active_to" IS NULL OR "accounts"."active_to" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "accounts_active_range_check" CHECK("accounts"."active_from" IS NULL OR "accounts"."active_to" IS NULL OR "accounts"."active_from" <= "accounts"."active_to")
);
--> statement-breakpoint
CREATE INDEX `accounts_section_group_idx` ON `accounts` (`section_id`,`group`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_section_name_unique` ON `accounts` (`section_id`,`name`);--> statement-breakpoint
CREATE TABLE `auth_account` (
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `provider_account_id`),
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auth_session` (
	`session_token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`email_verified` integer,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_user_email_unique` ON `auth_user` (`email`);--> statement-breakpoint
CREATE TABLE `auth_verification_token` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`account_id` text NOT NULL,
	`year_month` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budgets_year_month_format_check" CHECK("budgets"."year_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_account_year_month_unique` ON `budgets` (`account_id`,`year_month`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`date` text NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` real NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`date`, `base`, `quote`),
	CONSTRAINT "exchange_rates_source_check" CHECK("exchange_rates"."source" IN ('api','manual')),
	CONSTRAINT "exchange_rates_date_format_check" CHECK("exchange_rates"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'KRW' NOT NULL,
	`timezone` text DEFAULT 'Asia/Seoul' NOT NULL,
	`start_date` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`nav_favorites` text DEFAULT '/,/assets,/income,/budget' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transaction_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`line_order` integer DEFAULT 0 NOT NULL,
	`side` text NOT NULL,
	`account_id` text NOT NULL,
	`currency` text NOT NULL,
	`amount` integer NOT NULL,
	`rate` real,
	`base_amount` integer NOT NULL,
	`memo` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transaction_lines_side_check" CHECK("transaction_lines"."side" IN ('left','right')),
	CONSTRAINT "transaction_lines_amount_check" CHECK("transaction_lines"."amount" >= 0),
	CONSTRAINT "transaction_lines_base_amount_check" CHECK("transaction_lines"."base_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `transaction_lines_transaction_idx` ON `transaction_lines` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_lines_account_idx` ON `transaction_lines` (`account_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`memo` text,
	`kind` text DEFAULT 'normal' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transactions_kind_check" CHECK("transactions"."kind" IN ('normal','opening','revaluation')),
	CONSTRAINT "transactions_date_format_check" CHECK("transactions"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `transactions_section_date_idx` ON `transactions` (`section_id`,`date`);