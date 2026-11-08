-- Brahmastra holiday feed for Purview Shastra: the company holidays from Shastra's own holidays table, so every TAT in
-- Brahmastra (Payment posting, Submission, Rejections, Needs attention, the Escalation tracker) skips them like a weekend.
-- Run once in Shastra's Supabase: SQL Editor → New query → paste all of this → Run.
-- It adds one read-only function, brahmastra_holidays(p_key), that answers with the same key Brahmastra already uses for the
-- roster (SHASTRA_FEED_KEY). It makes no new key, and nothing in Shastra's own tables changes. Safe to run again.
-- Dates and holiday names only: nothing about people leaves Shastra here.
-- Until this is run, Brahmastra's TAT clock skips Saturday and Sunday only.

create or replace function public.brahmastra_holidays(p_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare res jsonb; d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_key is null or length(p_key) < 32 or not exists (
       select 1 from brahmastra_feed where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    perform pg_sleep(1);
    return jsonb_build_object('ok', false, 'error', 'Not allowed');
  end if;

  -- a year back and a year ahead is plenty for any TAT; the name is whatever the table calls it (name, title or holiday)
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', h.date,
           'name', coalesce(to_jsonb(h) ->> 'name', to_jsonb(h) ->> 'title', to_jsonb(h) ->> 'holiday', to_jsonb(h) ->> 'description', '')
         ) order by h.date), '[]'::jsonb)
    into res
    from holidays h
   where h.date between d - 365 and d + 400;
  return jsonb_build_object('ok', true, 'today', d, 'holidays', res);
end; $function$;

revoke all on function public.brahmastra_holidays(text) from public;
grant execute on function public.brahmastra_holidays(text) to anon;
