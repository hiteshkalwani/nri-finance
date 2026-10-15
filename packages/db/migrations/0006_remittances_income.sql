CREATE TABLE "cycle_incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle" char(7) NOT NULL,
	"income_jpy" integer NOT NULL,
	CONSTRAINT "cycle_incomes_cycle" UNIQUE("user_id","cycle"),
	CONSTRAINT "cycle_incomes_amount" CHECK ("cycle_incomes"."income_jpy" >= 0),
	CONSTRAINT "cycle_incomes_cycle_format" CHECK (cycle ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
alter table cycle_incomes add constraint cycle_incomes_user_fk foreign key (user_id) references auth.users(id) on delete cascade;--> statement-breakpoint
create trigger set_updated_at before update on cycle_incomes for each row execute function set_updated_at();--> statement-breakpoint
alter table cycle_incomes enable row level security;--> statement-breakpoint
create policy own_rows on cycle_incomes for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));--> statement-breakpoint
grant select, insert, update, delete on cycle_incomes to authenticated;
