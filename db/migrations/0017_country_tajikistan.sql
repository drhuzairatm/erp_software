-- 0017 Add Tajikistan as a destination country (Dr.Expert Edulinks current destinations).
insert into countries (code, name, is_destination, is_education_origin)
values ('TJ', 'Tajikistan', true, false)
on conflict (code) do update set is_destination = true;
