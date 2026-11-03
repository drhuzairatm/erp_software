-- =============================================================================
-- 0002 Reference data and configurable workflow
-- =============================================================================

create table countries (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z]{2}$'),
  name        text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table courses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_]{2,30}$'),
  name        text not null unique,
  sort_order  int not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table universities (
  id          uuid primary key default gen_random_uuid(),
  country_id  uuid not null references countries(id),
  name        text not null,
  city        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (country_id, name)
);

-- Lead sources are company-specific (each brand runs its own marketing).
create table lead_sources (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id),
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);

-- Contracting / legal entities and payment recipients. Deliberately NOT tied to
-- an organization: the legal/accounting relationship between the brands is not
-- yet confirmed, so these are configured independently.
create table legal_entities (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  registration_ref text,
  notes            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Global stage catalog. Each stage names the permission needed to move a
-- student INTO it, so e.g. only visa staff can move a student to Visa stages.
create table stages (
  key             text primary key check (key ~ '^[a-z_]{2,40}$'),
  name            text not null,
  sort_order      int not null,
  kind            text not null check (kind in ('normal', 'hold', 'cancelled', 'completed')),
  permission_key  text not null references permissions(key)
);

create table workflow_definitions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  description  text,
  country_id   uuid references countries(id),
  course_id    uuid references courses(id),
  is_default   boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index workflow_single_default on workflow_definitions ((true)) where is_default;
create unique index workflow_country_course on workflow_definitions (coalesce(country_id::text, '*'), coalesce(course_id::text, '*'))
  where is_active and not is_default;
create trigger workflow_definitions_touch before update on workflow_definitions
  for each row execute function app.touch_updated_at();

-- Which stages apply to a workflow (and in which order). On Hold and
-- Cancelled are always available and need not be listed.
create table workflow_stages (
  workflow_id  uuid not null references workflow_definitions(id) on delete cascade,
  stage_key    text not null references stages(key),
  sort_order   int not null,
  primary key (workflow_id, stage_key)
);

create table document_types (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  name         text not null unique,
  category     text not null check (category in ('identity', 'academic', 'photo', 'attestation', 'translation', 'visa', 'financial', 'other')),
  has_expiry   boolean not null default false,
  sort_order   int not null default 100,
  is_active    boolean not null default true
);

create table document_requirements (
  id                  uuid primary key default gen_random_uuid(),
  workflow_id         uuid not null references workflow_definitions(id) on delete cascade,
  document_type_id    uuid not null references document_types(id),
  is_required         boolean not null default true,
  required_by_stage   text references stages(key),
  notes               text,
  unique (workflow_id, document_type_id)
);

-- Fee categories are company-specific. `kind` separates the company's own
-- service revenue from third-party money (university fees, provider costs).
create table fee_categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id),
  key         text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name        text not null,
  kind        text not null check (kind in ('service', 'third_party')),
  is_active   boolean not null default true,
  unique (org_id, key),
  unique (id, org_id)
);

-- Choose the most specific active workflow for a country/course pair.
create or replace function app.pick_workflow(p_country uuid, p_course uuid) returns uuid
language sql stable as $$
  select id from workflow_definitions
   where is_active
     and (is_default
          or ((country_id is null or country_id = p_country) and (course_id is null or course_id = p_course)))
   order by is_default asc,
            (country_id is not null)::int + (course_id is not null)::int desc
   limit 1
$$;

create trigger workflow_definitions_audit after insert or update or delete on workflow_definitions
  for each row execute function app.audit_row('', '');
create trigger document_requirements_audit after insert or update or delete on document_requirements
  for each row execute function app.audit_row('', '');
create trigger fee_categories_audit after insert or update or delete on fee_categories
  for each row execute function app.audit_row('org_id', '');
create trigger legal_entities_audit after insert or update or delete on legal_entities
  for each row execute function app.audit_row('', '');
