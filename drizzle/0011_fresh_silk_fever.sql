ALTER TABLE `findings` ADD `killed_by` text;--> statement-breakpoint
-- Rows killed before the column, classified by the note the pipeline wrote.
-- The program's three checks have written these exact openings since the
-- engine's first commit (the overlap check since D-99); every other kill was
-- the verifier's refutation (MVP 4.24). GLOB, not LIKE: it is case-sensitive,
-- and the overlap pattern is held to the "line" or "lines" the pipeline writes.
UPDATE `findings` SET `killed_by` = 'quote_check' WHERE `status` = 'killed' AND (`verification_note` GLOB 'The quotation did not match the file: *' OR `verification_note` GLOB 'The cited file could not be read: *' OR `verification_note` GLOB 'Verification quoted line*, which does not overlap the cited line*');--> statement-breakpoint
UPDATE `findings` SET `killed_by` = 'verification' WHERE `status` = 'killed' AND `killed_by` IS NULL;
