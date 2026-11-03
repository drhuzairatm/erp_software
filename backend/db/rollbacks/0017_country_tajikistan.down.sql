-- Undo 0017: remove Tajikistan only if nothing refers to it yet.
delete from countries c where c.code = 'TJ'
  and not exists (select 1 from students s where s.destination_country_id = c.id or s.previous_education_country_id = c.id
                    or s.school_country_id = c.id or s.passport_country_id = c.id)
  and not exists (select 1 from universities u where u.country_id = c.id);
