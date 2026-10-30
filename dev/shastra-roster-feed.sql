-- Brahmastra roster feed for Purview Shastra.
-- Run once in Shastra's Supabase: SQL Editor → New query → paste all of this → Run.
-- It adds one read-only function, brahmastra_roster(p_key), that returns the roster export's columns
-- (no PINs, phones, addresses or anything personal beyond work details) to whoever holds the key,
-- and a one-row table that keeps only the key's hash. Nothing in Shastra's own tables changes.
-- The last statement makes the key and shows it once: copy it into Cloudflare as SHASTRA_FEED_KEY.
-- Running the whole block again makes a new key (the old one stops working).

create table if not exists public.brahmastra_feed (
  id int primary key default 1 check (id = 1),
  key_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.brahmastra_feed enable row level security;   -- no policies: no one reads it through the API
revoke all on public.brahmastra_feed from anon, authenticated;

create or replace function public.brahmastra_roster(p_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare d date := _biz_date(); res jsonb;
begin
  if p_key is null or length(p_key) < 32 or not exists (
       select 1 from brahmastra_feed where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    perform pg_sleep(1);
    return jsonb_build_object('ok', false, 'error', 'Not allowed');
  end if;
  update brahmastra_feed set last_used_at = now() where id = 1;

  -- the same people and columns as Shastra's roster export (WFM → Raw data): everyone still here
  with pos as (
    select x->>0 as code, x->>1 as label, x->>2 as hier
      from jsonb_array_elements(coalesce((select items from ref_lists where key = 'positions'), '[]'::jsonb)) x),
  dfn as (select coalesce((select items from ref_lists where key = 'deptFunc'), '{}'::jsonb) as m),
  asg as (
    select a.employee_id, coalesce(p.name, a.special) as name, coalesce(a.weight, 0) as w, a.id
      from assignments a left join projects p on p.id = a.project_id
     where a.from_date <= d and (a.to_date is null or a.to_date >= d)
       and coalesce(p.name, a.special) is not null and coalesce(p.name, a.special) not in ('All', 'None')),
  asgp as (
    select employee_id, name, w, id,
           case when sum(w) over (partition by employee_id) > 0 then round(100 * w / sum(w) over (partition by employee_id), 2) end as pct
      from asg),
  st as (
    select distinct on (employee_id) employee_id, kind
      from emp_stages where closed_at is null and kind in ('training', 'ojt', 'sabbatical')
     order by employee_id, case kind when 'training' then 1 when 'ojt' then 2 else 3 end),
  ppl as (
    select e.*, pos.label as pos_label, pos.hier as pos_hier, st.kind as stage,
           case when coalesce(e.client, '') not in ('', 'All', 'None') then e.client
                else (select name from asgp where asgp.employee_id = e.id order by w desc, id limit 1) end as primary_project
      from employees e left join pos on pos.code = e.position left join st on st.employee_id = e.id
     where coalesce(e.is_system, false) = false
       and coalesce(nullif(e.attrition_status, ''), 'Working') in ('Working', 'Serving Notice'))
  select jsonb_agg(jsonb_build_object(
           'emp_id', coalesce(p.emp_id, ''),
           'name', p.name,
           'hierarchy', coalesce(p.pos_hier, ''),
           'position', coalesce(p.pos_label, p.position, ''),
           'function', coalesce(nullif(p.function_area, ''), case when p.department = 'All' then 'Management' end, (select m ->> p.department from dfn), ''),
           'department', coalesce(p.department, ''),
           'also_in_departments', coalesce((select string_agg(trim(x), '; ') from unnest(string_to_array(coalesce(p.dept_coverage, ''), ',')) x
                                             where trim(x) <> '' and trim(x) is distinct from p.department), ''),
           'status', case p.stage when 'training' then 'Training' when 'ojt' then 'OJT' when 'sabbatical' then 'Sabbatical'
                       else coalesce(nullif(p.attrition_status, ''), 'Working') end,
           'project', coalesce(p.primary_project, ''),
           'also_on_projects', coalesce((select string_agg(a.name || coalesce(' ' || trim(trailing '.' from trim(trailing '0' from a.pct::text)) || '%', ''), '; ' order by a.w desc, a.id)
                                          from asgp a where a.employee_id = p.id and a.name is distinct from p.primary_project), ''),
           'reports_to', coalesce(p.supervisor, ''),
           'shift', coalesce(p.shift, ''),
           'location', coalesce(p.location, ''),
           'doj', p.doj,
           'exit_date', p.exit_date,
           'email', coalesce(p.email, '')) order by p.name)
    into res
    from ppl p;
  return jsonb_build_object('ok', true, 'today', d, 'rows', coalesce(res, '[]'::jsonb));
end; $function$;

revoke all on function public.brahmastra_roster(text) from public;
grant execute on function public.brahmastra_roster(text) to anon;

-- The key: shown once below. Copy it into Cloudflare (brahmastra-api → Settings → Variables and Secrets) as the secret SHASTRA_FEED_KEY.
with k as (select encode(extensions.gen_random_bytes(32), 'hex') as key),
saved as (
  insert into public.brahmastra_feed (id, key_hash, created_at)
  select 1, encode(extensions.digest(key, 'sha256'), 'hex'), now() from k
  on conflict (id) do update set key_hash = excluded.key_hash, created_at = excluded.created_at, last_used_at = null
  returning id)
select k.key as "SHASTRA_FEED_KEY (copy into Cloudflare, then close this tab)" from k, saved;
