create unique index categories_user_name on categories (user_id, lower(name));

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','accounts','categories','loans','transactions','remittances',
    'balance_snapshots','category_budgets','cycle_targets','loan_planned_prepayments','sip_plans','sip_allocations']
  loop
    execute format('alter table %I add constraint %I foreign key (user_id) references auth.users(id) on delete cascade', t, t || '_user_fk');
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy own_rows on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
