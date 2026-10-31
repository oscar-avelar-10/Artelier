CREATE TABLE `museum_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`expires_at` integer NOT NULL,
	`stale_until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `museum_cache_expiry` ON `museum_cache` (`stale_until`);--> statement-breakpoint
CREATE TABLE `museum_quotas` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `museum_quotas_expiry` ON `museum_quotas` (`expires_at`);