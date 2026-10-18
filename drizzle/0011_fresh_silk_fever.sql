ALTER TABLE `findings` ADD `killed_by` text;--> statement-breakpoint
-- Rows killed before the column, classified by the note the pipeline wrote.
-- The program's three checks have written these exact openings since the
-- engine's first commit (the overlap check since D-99); every other kill was
-- the verifier's refutation (MVP 4.24).
UPDATE `findings` SET `killed_by` = 'quote_check' WHERE `status` = 'killed' AND (`verification_note` LIKE 'The quotation did not match the file:%' OR `verification_note` LIKE 'The cited file could not be read:%' OR `verification_note` LIKE 'Verification quoted %, which does not overlap the cited %');--> statement-breakpoint
UPDATE `findings` SET `killed_by` = 'verification' WHERE `status` = 'killed' AND `killed_by` IS NULL;
