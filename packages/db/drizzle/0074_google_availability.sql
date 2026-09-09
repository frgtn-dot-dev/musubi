CREATE TABLE "availability_accounts" (
	"epoch" uuid DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text PRIMARY KEY NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"label" text NOT NULL,
	"account_label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability_accounts" ADD CONSTRAINT "availability_accounts_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_sources" ADD CONSTRAINT "availability_sources_account_id_availability_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."availability_accounts"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_sources_account_external" ON "availability_sources" USING btree ("account_id","external_id");