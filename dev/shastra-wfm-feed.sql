-- Brahmastra WFM feed for Purview Shastra: each project's Billable and Assigned, as Workforce Management shows them.
-- Run once in Shastra's Supabase: SQL Editor → New query → paste all of this → Run.
-- It adds one read-only function, brahmastra_wfm(p_key), that answers with the same key Brahmastra already uses for the
-- roster (SHASTRA_FEED_KEY). It makes no new key, and nothing in Shastra's own tables changes. Safe to run again.
--
-- For each project, worked out the way Workforce Management (Explore) does:
--   billable      the project's Billable (required headcount), as the manager set it in Workforce Management
--   assigned_fte  Assigned FTE: Working (and Serving Notice) agents, each split evenly across their projects, a fresher counting half
--   agents        those agents, counted once each
--   team_fte      everyone on the project (agents, SMEs, TLs, QA, managers...), each split evenly across their projects
--   people        everyone on the project, counted once each
--   training      agents in training or OJT on the project
-- Names only: no people's names, IDs or anything personal leave Shastra here.

create or replace function public.brahmastra_wfm(p_key text)
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

  with st as (
    select distinct on (employee_id) employee_id, kind
      from emp_stages where closed_at is null and kind in ('training', 'ojt', 'sabbatical')
     order by employee_id, case kind when 'training' then 1 when 'ojt' then 2 else 3 end),
  ppl as (
    select e.id, e.position, coalesce(to_jsonb(e) ->> 'resource_type', '') as resource_type, e.client,
           case st.kind when 'training' then 'Training' when 'ojt' then 'OJT' when 'sabbatical' then 'Sabbatical'
                else coalesce(nullif(e.attrition_status, ''), 'Working') end as status
      from employees e left join st on st.employee_id = e.id
     where coalesce(e.is_system, false) = false
       and coalesce(nullif(e.attrition_status, ''), 'Working') in ('Working', 'Serving Notice')),
  asg as (
    select distinct a.employee_id, coalesce(p.name, a.special) as name
      from assignments a left join projects p on p.id = a.project_id
     where a.from_date <= d and (a.to_date is null or a.to_date >= d)
       and coalesce(p.name, a.special) is not null and coalesce(p.name, a.special) not in ('All', 'None')),
  -- each person's projects; someone with no assignment counts on their own project (the roster's Project column)
  on_proj as (
    select p.id, p.position, p.resource_type, p.status, a.name from ppl p join asg a on a.employee_id = p.id
    union all
    select p.id, p.position, p.resource_type, p.status, p.client from ppl p
     where not exists (select 1 from asg a where a.employee_id = p.id) and coalesce(p.client, '') not in ('', 'All', 'None')),
  share as (select o.*, 1.0 / count(*) over (partition by o.id) as s from on_proj o),
  per as (
    select name,
           sum(case when position = 'Agent' and status in ('Working', 'Serving Notice') then s * case when resource_type = 'Fresher' then 0.5 else 1 end else 0 end) as assigned_fte,
           count(distinct case when position = 'Agent' and status in ('Working', 'Serving Notice') then id end) as agents,
           count(distinct case when position = 'Agent' and status in ('Training', 'OJT') then id end) as training,
           sum(s) as team_fte,
           count(distinct id) as people
      from share group by name),
  names as (select name from per union select name from projects where name is not null and name not in ('All', 'None'))
  select jsonb_agg(jsonb_build_object(
           'name', n.name,
           'billable', (select (to_jsonb(pr) ->> 'required_hc')::numeric from projects pr where pr.name = n.name limit 1),
           'assigned_fte', round(coalesce(per.assigned_fte, 0), 2),
           'agents', coalesce(per.agents, 0),
           'training', coalesce(per.training, 0),
           'team_fte', round(coalesce(per.team_fte, 0), 2),
           'people', coalesce(per.people, 0)) order by n.name)
    into res
    from names n left join per on per.name = n.name;
  return jsonb_build_object('ok', true, 'today', d, 'projects', coalesce(res, '[]'::jsonb));
end; $function$;

revoke all on function public.brahmastra_wfm(text) from public;
grant execute on function public.brahmastra_wfm(text) to anon;
