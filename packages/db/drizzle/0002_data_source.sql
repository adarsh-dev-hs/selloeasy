CREATE TYPE "public"."connector_type" AS ENUM('HTTP_FEED', 'DEMO_FEED');--> statement-breakpoint
CREATE TYPE "public"."data_batch_kind" AS ENUM('IMPORT', 'INGESTION', 'SEED');--> statement-breakpoint
CREATE TYPE "public"."data_batch_status" AS ENUM('UPLOADED', 'VALIDATING', 'VALIDATED', 'COMMITTING', 'COMMITTED', 'DISCARDED', 'FAILED', 'ROLLED_BACK');--> statement-breakpoint
CREATE TYPE "public"."data_row_status" AS ENUM('VALID', 'WARNING', 'INVALID', 'DUPLICATE');--> statement-breakpoint
CREATE TYPE "public"."data_source_type" AS ENUM('SEED', 'CSV_IMPORT', 'JSONL_IMPORT', 'CONNECTOR');--> statement-breakpoint
ALTER TYPE "public"."pipeline_trigger" ADD VALUE 'DATA_REFRESH';--> statement-breakpoint
CREATE TABLE "data_batch_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"status" "data_row_status" NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duplicate_of_event_id" uuid,
	"inserted_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "data_batch_kind" NOT NULL,
	"status" "data_batch_status" DEFAULT 'UPLOADED' NOT NULL,
	"label" text NOT NULL,
	"file_name" text,
	"file_s3_key" text,
	"format" text,
	"file_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{"rows":0,"valid":0,"warnings":0,"invalid":0,"duplicates":0,"inserted":0,"companiesCreated":0,"companiesUpdated":0,"contactsCreated":0}'::jsonb NOT NULL,
	"fan_out" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"committed_by" uuid,
	"validated_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_connectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "connector_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"fan_out" boolean DEFAULT true NOT NULL,
	"cursor" jsonb,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connector_id" uuid NOT NULL,
	"batch_id" uuid,
	"trigger" text DEFAULT 'MANUAL' NOT NULL,
	"status" "pipeline_status" DEFAULT 'QUEUED' NOT NULL,
	"stats" jsonb DEFAULT '{"fetched":0,"valid":0,"warnings":0,"invalid":0,"duplicates":0,"inserted":0,"orgsNotified":0}'::jsonb NOT NULL,
	"error" text,
	"triggered_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory_companies" ADD COLUMN "source_type" "data_source_type" DEFAULT 'SEED' NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_companies" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "directory_companies" ADD COLUMN "updated_by_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "directory_companies" ADD COLUMN "retracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "directory_contacts" ADD COLUMN "source_type" "data_source_type" DEFAULT 'SEED' NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_contacts" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "directory_contacts" ADD COLUMN "retracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "provider" text DEFAULT 'openrouter' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_events" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "market_events" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "market_events" ADD COLUMN "source_type" "data_source_type" DEFAULT 'SEED' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_events" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "market_events" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "market_events" ADD COLUMN "retracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_events" ADD COLUMN "ingested_by" uuid;--> statement-breakpoint
ALTER TABLE "data_batch_rows" ADD CONSTRAINT "data_batch_rows_batch_id_data_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."data_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_batches" ADD CONSTRAINT "data_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_batches" ADD CONSTRAINT "data_batches_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connectors" ADD CONSTRAINT "data_connectors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_connector_id_data_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."data_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_batch_id_data_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."data_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_batch_rows_batch_status_idx" ON "data_batch_rows" USING btree ("batch_id","status","row_number");--> statement-breakpoint
CREATE INDEX "data_batches_created_idx" ON "data_batches" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "data_connectors_name_uq" ON "data_connectors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ingestion_runs_connector_idx" ON "ingestion_runs" USING btree ("connector_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "directory_companies" ADD CONSTRAINT "directory_companies_batch_id_data_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."data_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_companies" ADD CONSTRAINT "directory_companies_updated_by_batch_id_data_batches_id_fk" FOREIGN KEY ("updated_by_batch_id") REFERENCES "public"."data_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_contacts" ADD CONSTRAINT "directory_contacts_batch_id_data_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."data_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_events" ADD CONSTRAINT "market_events_batch_id_data_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."data_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_events" ADD CONSTRAINT "market_events_ingested_by_users_id_fk" FOREIGN KEY ("ingested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "directory_companies_domain_uq" ON "directory_companies" USING btree ("domain") WHERE "directory_companies"."domain" is not null;--> statement-breakpoint
CREATE INDEX "directory_contacts_email_idx" ON "directory_contacts" USING btree ("company_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "market_events_source_external_uq" ON "market_events" USING btree (lower("source"),lower("external_id")) WHERE "market_events"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "market_events_url_uq" ON "market_events" USING btree (lower(rtrim("url", '/'))) WHERE "market_events"."url" is not null;--> statement-breakpoint
CREATE INDEX "market_events_source_type_idx" ON "market_events" USING btree ("source_type","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_events_batch_idx" ON "market_events" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "market_events_content_hash_idx" ON "market_events" USING btree ("content_hash");