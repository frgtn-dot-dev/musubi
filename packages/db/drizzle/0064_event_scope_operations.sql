CREATE TABLE "event_scope_operations" (
	"actor_id" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_scope_operations_actor_id_operation_id_pk" PRIMARY KEY("actor_id","operation_id")
);
--> statement-breakpoint
ALTER TABLE "event_scope_operations" ADD CONSTRAINT "event_scope_operations_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;