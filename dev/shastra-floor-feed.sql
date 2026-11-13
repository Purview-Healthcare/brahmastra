-- Brahmastra floor-time feed for Purview Shastra: time on the floor and idle time for Team status.
-- Run once in Shastra's Supabase: SQL Editor → New query → paste all of this → Run.
-- It adds one read-only function, brahmastra_floor(p_key, p_from, p_to). For each person and day in the dates it returns:
--   the attendance status, time on the floor (Shastra's own figure for a finished shift, breaks taken out; a shift still
--   open counts up to now), time logged in, breaks, and the minutes Shastra Guard saw no movement or a locked screen
--   while they were punched in (time inside a break is left out, two breaks that overlap counted once), and whether the
--   person has Shastra Guard (a machine linked now, or Guard events in the dates). Each Guard event counts for whoever was
--   signed in on the computer when it happened (guard_events.employee_id), so a computer shared or moved to someone else
--   keeps everyone's own idle time; an older event without that goes by the computer's link.
-- Only Emp ID and email identify a person: no names, PINs, phones or anything personal.
-- It uses the key brahmastra_roster already uses (the brahmastra_feed table): no new key, and nothing in Shastra's own
-- tables changes. Running it again just replaces the function.

create or replace function public.brahmastra_floor(p_key text, p_from date, p_to date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare res jsonb;
begin
  if p_key is null or length(p_key) < 32 or not exists (
       select 1 from brahmastra_feed where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    perform pg_sleep(1);
    return jsonb_build_object('ok', false, 'error', 'Not allowed');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    return jsonb_build_object('ok', false, 'error', 'Ask for up to 93 days at a time');
  end if;
  update brahmastra_feed set last_used_at = now() where id = 1;

  with ad as (   -- each person's days in the dates; the shift runs from punch in to punch out (an open one up to now, at most 16 hours)
    select a.employee_id, a.date, a.status, a.punch_in, a.punch_out, a.tof_min, a.logged_min, a.break_min,
           case when a.punch_in is not null
                then tstzrange(a.punch_in, greatest(a.punch_in, coalesce(a.punch_out, least(now(), a.punch_in + interval '16 hours')))) end as shift
      from attendance_days a
     where a.date between p_from and p_to),
  brk as (       -- the breaks inside each shift
    select ad.employee_id, ad.date,
           tstzrange(b.start_ts, greatest(b.start_ts, coalesce(b.end_ts, upper(ad.shift)))) * ad.shift as r
      from ad join breaks b on b.employee_id = ad.employee_id
     where ad.shift is not null and b.start_ts < upper(ad.shift) and coalesce(b.end_ts, upper(ad.shift)) > lower(ad.shift)),
  bm as (        -- each person's breaks in a day as one set of ranges: two breaks that overlap count once
    select employee_id, date, range_agg(r) as mr from brk where not isempty(r) group by employee_id, date),
  ev as (        -- Shastra Guard: no movement and screen locked while the person was signed in on the computer, inside the shift
    select ad.employee_id, ad.date, ge.kind,
           tstzrange(ge.from_ts, greatest(ge.from_ts, coalesce(ge.to_ts, ge.from_ts + make_interval(mins => coalesce(ge.minutes, 0))))) * ad.shift as r
      from guard_events ge left join guard_machines gm on gm.id = ge.machine_id
      join ad on ad.employee_id = coalesce(ge.employee_id, gm.employee_id)
     where ad.shift is not null and ge.kind in ('idle', 'locked') and ge.from_ts is not null
       and ge.from_ts >= p_from::timestamptz - interval '1 day' and ge.from_ts < p_to::timestamptz + interval '2 days'
       and ge.from_ts < upper(ad.shift)
       and coalesce(ge.to_ts, ge.from_ts + make_interval(mins => coalesce(ge.minutes, 0))) > lower(ad.shift)),
  evm as (       -- minutes of each, less the part inside a break (never below zero)
    select ev.employee_id, ev.date, ev.kind,
           greatest(0, extract(epoch from upper(ev.r) - lower(ev.r)) / 60
           - coalesce((select sum(extract(epoch from upper(x) - lower(x)) / 60) from bm, unnest(bm.mr * tstzmultirange(ev.r)) x
                        where bm.employee_id = ev.employee_id and bm.date = ev.date), 0)) as mins
      from ev where not isempty(ev.r)),
  idl as (
    select employee_id, date,
           round(coalesce(sum(mins) filter (where kind = 'idle'), 0))::int as idle_min,
           round(coalesce(sum(mins) filter (where kind = 'locked'), 0))::int as locked_min
      from evm group by employee_id, date),
  bk as (
    select bm.employee_id, bm.date, round(sum(extract(epoch from upper(x) - lower(x)) / 60))::int as brk_min
      from bm, unnest(bm.mr) x group by bm.employee_id, bm.date)
  select coalesce(jsonb_agg(jsonb_build_object(
           'emp_id', coalesce(e.emp_id, ''),
           'email', coalesce(e.email, ''),
           'date', ad.date,
           'status', coalesce(ad.status, ''),
           'open', ad.punch_in is not null and ad.punch_out is null,
           'tof_min', case when ad.punch_in is null then 0
                           when ad.punch_out is not null then coalesce(ad.tof_min, 0)
                           else greatest(0, round(extract(epoch from upper(ad.shift) - lower(ad.shift)) / 60) - coalesce(bk.brk_min, 0))::int end,
           'logged_min', coalesce(ad.logged_min, 0),
           'break_min', coalesce(ad.break_min, bk.brk_min, 0),
           'guard', exists (select 1 from guard_machines gm where gm.employee_id = ad.employee_id) or exists (select 1 from ev where ev.employee_id = ad.employee_id),
           'idle_min', coalesce(i.idle_min, 0),
           'locked_min', coalesce(i.locked_min, 0)) order by ad.date, e.emp_id), '[]'::jsonb)
    into res
    from ad join employees e on e.id = ad.employee_id
    left join idl i on i.employee_id = ad.employee_id and i.date = ad.date
    left join bk on bk.employee_id = ad.employee_id and bk.date = ad.date
   where coalesce(e.is_system, false) = false;
  return jsonb_build_object('ok', true, 'from', p_from, 'to', p_to, 'rows', res);
end; $function$;

revoke all on function public.brahmastra_floor(text, date, date) from public;
grant execute on function public.brahmastra_floor(text, date, date) to anon;

-- Check it answers (it should say Not allowed: the real key lives only in Cloudflare):
select public.brahmastra_floor(repeat('x', 40), current_date - 1, current_date) as "should say Not allowed";
