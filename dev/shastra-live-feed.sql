-- Brahmastra live attendance feed for Purview Shastra: who is punched in, on a break, logged out, on leave or not in yet,
-- for Live status in Brahmastra and its "not logged in an hour after the shift began" alert to the team lead.
-- Run once in Shastra's Supabase: SQL Editor → New query → paste all of this → Run.
-- It adds one read-only function, brahmastra_live(p_key). For every active person it returns today's attendance status,
-- punch in and punch out times, the start of a break still open, approved leave, holiday, week off and the roster shift.
-- Only Emp ID and email identify a person: no names, PINs, phones or anything personal.
-- Shastra's day rolls at 05:00 IST, as in Shastra itself; a shift still open from before that stays today's shift.
-- It uses the key brahmastra_roster already uses (the brahmastra_feed table): no new key, and nothing in Shastra's own
-- tables changes. Running it again just replaces the function.

create or replace function public.brahmastra_live(p_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare res jsonb; v_now timestamptz := now(); v_biz date;
begin
  if p_key is null or length(p_key) < 32 or not exists (
       select 1 from brahmastra_feed where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    perform pg_sleep(1);
    return jsonb_build_object('ok', false, 'error', 'Not allowed');
  end if;
  update brahmastra_feed set last_used_at = now() where id = 1;
  v_biz := ((v_now at time zone 'Asia/Kolkata') - interval '5 hours')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'emp_id', coalesce(e.emp_id, ''),
           'email', coalesce(e.email, ''),
           'shift', coalesce(e.shift, ''),
           'no_punch', coalesce(e.no_punch, false),
           'auto_present', coalesce(e.auto_present, false),
           'week_off', (extract(dow from v_biz)::int)::text = any(coalesce(nullif(e.week_off_days::text[], '{}'::text[]), array['0', '6'])),
           'holiday', exists (select 1 from holidays h where h.date = v_biz),
           'leave', (select l.type from leaves l where l.employee_id = e.id and v_biz between l.from_date and l.to_date
                      and lower(coalesce(l.status, '')) like 'approved%' order by l.created_at desc limit 1),
           'status', coalesce(a.status, ''),
           'in_at', a.punch_in,
           'out_at', a.punch_out,
           'late_ok', coalesce(a.late_ok, false),
           'break_since', (select max(b.start_ts) from breaks b where b.employee_id = e.id and b.end_ts is null and b.start_ts > v_now - interval '16 hours')
         ) order by e.emp_id), '[]'::jsonb)
    into res
    from employees e
    left join lateral (
      select ad.status, ad.punch_in, ad.punch_out, ad.late_ok from attendance_days ad
       where ad.employee_id = e.id
         and (ad.date = v_biz or (ad.punch_in is not null and ad.punch_out is null and ad.punch_in > v_now - interval '20 hours'))
       order by (ad.date = v_biz) desc, ad.punch_in desc nulls last
       limit 1) a on true
   where coalesce(e.is_system, false) = false and coalesce(e.active, true) = true;
  return jsonb_build_object('ok', true, 'at', v_now, 'day', v_biz, 'rows', res);
end; $function$;

revoke all on function public.brahmastra_live(text) from public;
grant execute on function public.brahmastra_live(text) to anon;

-- Check it answers (it should say Not allowed: the real key lives only in Cloudflare):
select public.brahmastra_live(repeat('x', 40)) as "should say Not allowed";
