CREATE TABLE `notifications_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`occurrenceID` text NOT NULL,
	`eventID` text NOT NULL,
	`triggerDate` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_table_occurrenceID_unique` ON `notifications_table` (`occurrenceID`);