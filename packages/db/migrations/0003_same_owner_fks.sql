ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "sip_plans" ADD CONSTRAINT "sip_plans_user_id" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "balance_snapshots" DROP CONSTRAINT "balance_snapshots_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "category_budgets" DROP CONSTRAINT "category_budgets_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "loan_planned_prepayments" DROP CONSTRAINT "loan_planned_prepayments_loan_id_loans_id_fk";
--> statement-breakpoint
ALTER TABLE "remittances" DROP CONSTRAINT "remittances_from_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "remittances" DROP CONSTRAINT "remittances_to_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "remittances" DROP CONSTRAINT "remittances_loan_id_loans_id_fk";
--> statement-breakpoint
ALTER TABLE "sip_allocations" DROP CONSTRAINT "sip_allocations_plan_id_sip_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_owner" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_category_owner" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_planned_prepayments" ADD CONSTRAINT "loan_planned_prepayments_loan_owner" FOREIGN KEY ("user_id","loan_id") REFERENCES "public"."loans"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_from_account_owner" FOREIGN KEY ("user_id","from_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_to_account_owner" FOREIGN KEY ("user_id","to_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_loan_owner" FOREIGN KEY ("user_id","loan_id") REFERENCES "public"."loans"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sip_allocations" ADD CONSTRAINT "sip_allocations_plan_owner" FOREIGN KEY ("user_id","plan_id") REFERENCES "public"."sip_plans"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_owner" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_owner" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;
