CREATE TYPE "public"."account_type" AS ENUM('bank', 'cash', 'card', 'fd', 'investment');--> statement-breakpoint
CREATE TYPE "public"."country" AS ENUM('JP', 'IN');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('JPY', 'INR');--> statement-breakpoint
CREATE TYPE "public"."need_want" AS ENUM('need', 'want');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank', 'cash', 'credit_card', 'ic_card');--> statement-breakpoint
CREATE TYPE "public"."remittance_purpose" AS ENUM('family', 'india_savings', 'sip', 'loan_emi', 'loan_prepayment', 'other');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"country" "country" NOT NULL,
	"currency" "currency" NOT NULL,
	"type" "account_type" NOT NULL,
	"is_emergency_fund" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"legacy_id" text,
	CONSTRAINT "accounts_legacy" UNIQUE("user_id","legacy_id"),
	CONSTRAINT "accounts_country_currency" CHECK (("accounts"."country" = 'JP') = ("accounts"."currency" = 'JPY'))
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"cycle" char(7) NOT NULL,
	"balance_jpy" integer,
	"balance_inr" numeric(14, 2),
	"recorded_on" date NOT NULL,
	CONSTRAINT "balance_snapshots_account_cycle" UNIQUE("account_id","cycle"),
	CONSTRAINT "balance_snapshots_one_amount" CHECK (("balance_snapshots"."balance_jpy" is null) <> ("balance_snapshots"."balance_inr" is null)),
	CONSTRAINT "balance_snapshots_cycle" CHECK (cycle ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"legacy_id" text,
	CONSTRAINT "categories_legacy" UNIQUE("user_id","legacy_id")
);
--> statement-breakpoint
CREATE TABLE "category_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_jpy" integer NOT NULL,
	"effective_from_cycle" char(7) NOT NULL,
	CONSTRAINT "category_budgets_from" UNIQUE("category_id","effective_from_cycle"),
	CONSTRAINT "category_budgets_amount" CHECK ("category_budgets"."amount_jpy" >= 0),
	CONSTRAINT "category_budgets_cycle" CHECK (effective_from_cycle ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "cycle_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle" char(7) NOT NULL,
	"savings_target_jpy" integer,
	"emergency_fund_target_jpy" integer,
	"remittance_target_jpy" integer,
	"prepayment_target_inr" numeric(14, 2),
	CONSTRAINT "cycle_targets_cycle" UNIQUE("user_id","cycle"),
	CONSTRAINT "cycle_targets_cycle_format" CHECK (cycle ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "loan_planned_prepayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"loan_id" uuid NOT NULL,
	"month_index" smallint NOT NULL,
	"amount_inr" numeric(14, 2) NOT NULL,
	CONSTRAINT "loan_planned_prepayments_month" UNIQUE("loan_id","month_index"),
	CONSTRAINT "loan_planned_prepayments_values" CHECK ("loan_planned_prepayments"."month_index" >= 1 and "loan_planned_prepayments"."amount_inr" > 0)
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"principal_inr" numeric(14, 2) NOT NULL,
	"annual_rate_pct" numeric(6, 3) NOT NULL,
	"emi_inr" numeric(14, 2) NOT NULL,
	"tenure_months" smallint NOT NULL,
	"start_cycle" char(7) NOT NULL,
	"closed_at" timestamp with time zone,
	"legacy_id" text,
	CONSTRAINT "loans_legacy" UNIQUE("user_id","legacy_id"),
	CONSTRAINT "loans_start_cycle" CHECK (start_cycle ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"salary_jpy" integer NOT NULL,
	"planning_rate_jpy_per_inr" numeric(12, 6) NOT NULL,
	"cycle_start_day" smallint DEFAULT 25 NOT NULL,
	"timezone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_start_day" CHECK ("profiles"."cycle_start_day" between 1 and 28)
);
--> statement-breakpoint
CREATE TABLE "remittances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_on" date NOT NULL,
	"jpy_sent" integer NOT NULL,
	"inr_received" numeric(14, 2) NOT NULL,
	"fee_jpy" integer DEFAULT 0 NOT NULL,
	"service" text DEFAULT '' NOT NULL,
	"from_account_id" uuid,
	"to_account_id" uuid,
	"purpose" "remittance_purpose" NOT NULL,
	"loan_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"legacy_id" text,
	CONSTRAINT "remittances_legacy" UNIQUE("user_id","legacy_id"),
	CONSTRAINT "remittances_amounts" CHECK ("remittances"."jpy_sent" > 0 and "remittances"."inr_received" > 0 and "remittances"."fee_jpy" >= 0),
	CONSTRAINT "remittances_loan_link" CHECK (("remittances"."purpose" in ('loan_emi','loan_prepayment')) = ("remittances"."loan_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "sip_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"fund_name" text NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	CONSTRAINT "sip_allocations_pct" CHECK ("sip_allocations"."pct" > 0 and "sip_allocations"."pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "sip_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"starting_monthly_inr" numeric(14, 2) NOT NULL,
	"step_up_pct" numeric(5, 2) NOT NULL,
	"expected_return_pct" numeric(5, 2) NOT NULL,
	"start_year" smallint NOT NULL,
	"end_year" smallint NOT NULL,
	"redirect_emi_after_payoff" boolean DEFAULT true NOT NULL,
	CONSTRAINT "sip_plans_user" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurred_on" date NOT NULL,
	"category_id" uuid NOT NULL,
	"account_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"amount_jpy" integer NOT NULL,
	"entered_currency" "currency" DEFAULT 'JPY' NOT NULL,
	"amount_inr" numeric(14, 2),
	"rate_used" numeric(12, 6),
	"payment_method" "payment_method" NOT NULL,
	"need_want" "need_want" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"legacy_id" text,
	CONSTRAINT "transactions_legacy" UNIQUE("user_id","legacy_id"),
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount_jpy" > 0)
);
--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_planned_prepayments" ADD CONSTRAINT "loan_planned_prepayments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sip_allocations" ADD CONSTRAINT "sip_allocations_plan_id_sip_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."sip_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "remittances_user_date" ON "remittances" USING btree ("user_id","sent_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_user_date" ON "transactions" USING btree ("user_id","occurred_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_user_category" ON "transactions" USING btree ("user_id","category_id");