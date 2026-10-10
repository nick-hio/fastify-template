ALTER TABLE `kv` ADD `id` integer;--> statement-breakpoint
ALTER TABLE `kv` ADD `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_kv` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`key` text NOT NULL UNIQUE,
	`value` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_kv`(`key`, `value`) SELECT `key`, `value` FROM `kv`;--> statement-breakpoint
DROP TABLE `kv`;--> statement-breakpoint
ALTER TABLE `__new_kv` RENAME TO `kv`;--> statement-breakpoint
PRAGMA foreign_keys=ON;