-- Edited by hand: drizzle-kit also emitted `ALTER TABLE ... ADD` for `id` and `created_at` ahead of the rebuild below.
-- The rebuild already creates both columns, and SQLite refuses to add a column with a non-constant default
-- to a table that has rows, so those two statements were removed.
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