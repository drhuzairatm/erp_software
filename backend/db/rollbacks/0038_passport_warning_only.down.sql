-- Undo 0038. WARNING: this restores the blocking rules, which conflicts with the MD decision of 4 Nov 2026 until
-- the MD approves otherwise. Only rules changed by 0038 are affected (identified by its note).
update passport_validity_rules
   set enforcement = 'block',
       notes = nullif(btrim(replace(notes, '[0038: warning only by MD decision, 4 Nov 2026]', '')), '')
 where notes like '%[0038: warning only by MD decision, 4 Nov 2026]%';
