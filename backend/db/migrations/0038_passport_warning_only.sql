-- MD decision (4 Nov 2026): passport validity must not automatically block University Application. It warns, including
-- when the expiry date is missing. Only a verified rule for a specific university may block, and never Registration.
--
-- DATA ONLY: no table, column, constraint, function, trigger, grant or policy changes. Existing logic already supports
-- this: app.stage_requirement_issues() returns each rule's enforcement, and only 'block' stops a stage change.
-- Why a migration is needed: the rule lives in the database. `db:provision` installs it once and never updates it, and
-- the admin screen cannot edit a rule's enforcement, so an existing database would otherwise keep blocking.
--
-- Each changed rule keeps its row, id and history, the change is recorded by the existing audit trigger, and the note
-- below identifies it for the rollback. No student, employee or document record is touched.
update passport_validity_rules r
   set enforcement = 'warn',
       notes = concat_ws(' ', nullif(btrim(r.notes), ''), '[0038: warning only by MD decision, 4 Nov 2026]')
 where r.enforcement = 'block'
   and (r.university_id is null
        or (select s.sort_order from stages s where s.key = r.stage_key) <= (select s.sort_order from stages s where s.key = 'registration'));
