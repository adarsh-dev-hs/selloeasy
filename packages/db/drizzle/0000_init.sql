CREATE TYPE "public"."activity_direction" AS ENUM('OUTBOUND', 'INBOUND', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('EMAIL', 'WHATSAPP', 'CALL', 'MEETING', 'NOTE', 'STAGE_CHANGE', 'ASSIGNMENT', 'TASK', 'SCORE_CHANGED', 'SIGNAL');--> statement-breakpoint
CREATE TYPE "public"."audit_scope" AS ENUM('PLATFORM', 'ORG');--> statement-breakpoint
CREATE TYPE "public"."contact_source" AS ENUM('SYNTHETIC', 'MANUAL', 'ENRICHED');--> statement-breakpoint
CREATE TYPE "public"."icp_source" AS ENUM('AI_SUGGESTED', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."industry" AS ENUM('HEALTHCARE', 'AUTOMOTIVE', 'SEMICONDUCTORS', 'RENEWABLE_ENERGY', 'LOGISTICS');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('NEW', 'CONTACTED', 'ENGAGED', 'MEETING_SCHEDULED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('ORG_ADMIN', 'SALES_MANAGER', 'SDR', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('INVITED', 'ONBOARDING', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."outreach_status" AS ENUM('DRAFT', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."pipeline_status" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."pipeline_trigger" AS ENUM('MANUAL', 'SCHEDULED', 'ONBOARDING');--> statement-breakpoint
CREATE TYPE "public"."score_band" AS ENUM('HOT', 'WARM', 'COLD');--> statement-breakpoint
CREATE TYPE "public"."signal_source" AS ENUM('PREDEFINED', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('WEBSITE', 'PDF', 'DOC', 'TEXT');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('PUBLIC', 'INTERNAL');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "org_role" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "org_role" NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"industry" "industry" NOT NULL,
	"status" "org_status" DEFAULT 'INVITED' NOT NULL,
	"website_url" text,
	"logo_key" text,
	"hq" text,
	"regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"company_size" text,
	"description" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"calendly_url" text,
	"phone" text,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"summary_visibility" "visibility" DEFAULT 'PUBLIC' NOT NULL,
	"value_props" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"differentiators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_industries" text[] DEFAULT '{}'::text[] NOT NULL,
	"geographies" text[] DEFAULT '{}'::text[] NOT NULL,
	"personas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_by_model" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_source_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "source_type" NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"s3_key" text,
	"content_type" text,
	"visibility" "visibility" DEFAULT 'INTERNAL' NOT NULL,
	"status" "source_status" DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"bytes" integer,
	"checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"pricing" text,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"visibility" "visibility" DEFAULT 'INTERNAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'general' NOT NULL,
	"body" text NOT NULL,
	"visibility" "visibility" DEFAULT 'INTERNAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"target_segments" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_notes" text,
	"visibility" "visibility" DEFAULT 'PUBLIC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"industry" text,
	"hq_country" text,
	"size_band" text,
	"employees" integer,
	"description" text,
	"synthetic" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"persona" text,
	"seniority" text,
	"email" text,
	"phone" text,
	"whatsapp" text,
	"linkedin_url" text,
	"synthetic" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source" "icp_source" DEFAULT 'CUSTOM' NOT NULL,
	"criteria" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"prompt_hash" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"cached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_id" text,
	"source" text NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"industry_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"companies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"region" text,
	"amount" numeric,
	"currency" text,
	"synthetic" boolean DEFAULT false NOT NULL,
	"hash" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_event_evaluations" (
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"signals_hash" text NOT NULL,
	"run_id" uuid,
	"matched" boolean DEFAULT false NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"trigger" "pipeline_trigger" NOT NULL,
	"status" "pipeline_status" DEFAULT 'QUEUED' NOT NULL,
	"triggered_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{"eventsScanned":0,"prefiltered":0,"matched":0,"leadsCreated":0,"leadsUpdated":0,"llmCalls":0,"cacheHits":0,"costUsd":0}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid,
	"event_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"confidence" double precision NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"extracted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"industry" "industry" NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"match_instructions" text NOT NULL,
	"default_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_weight" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"template_id" uuid,
	"icp_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"match_instructions" text NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"negative_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"source" "signal_source" DEFAULT 'CUSTOM' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"directory_company_id" uuid,
	"name" text NOT NULL,
	"domain" text,
	"industry" text,
	"hq_country" text,
	"size_band" text,
	"employees" integer,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"type" "activity_type" NOT NULL,
	"direction" "activity_direction" DEFAULT 'INTERNAL' NOT NULL,
	"subject" text,
	"body" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"persona" text,
	"seniority" text,
	"email" text,
	"phone" text,
	"whatsapp" text,
	"linkedin_url" text,
	"source" "contact_source" DEFAULT 'MANUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_signals" (
	"lead_id" uuid NOT NULL,
	"signal_match_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_signals_lead_id_signal_match_id_pk" PRIMARY KEY("lead_id","signal_match_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"primary_contact_id" uuid,
	"icp_id" uuid,
	"owner_user_id" uuid,
	"stage" "lead_stage" DEFAULT 'NEW' NOT NULL,
	"score_total" integer DEFAULT 0 NOT NULL,
	"score_band" "score_band" DEFAULT 'COLD' NOT NULL,
	"breakdown" jsonb NOT NULL,
	"fit_score" double precision DEFAULT 0 NOT NULL,
	"signal_strength" double precision DEFAULT 0 NOT NULL,
	"recency_score" double precision DEFAULT 0 NOT NULL,
	"suggested_personas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_signal_at" timestamp with time zone,
	"last_signal_at" timestamp with time zone,
	"first_touch_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"stage_changed_at" timestamp with time zone,
	"lost_reason" text,
	"won_value" double precision,
	"dedupe_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"contact_id" uuid,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" "outreach_status" DEFAULT 'DRAFT' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"assignee_user_id" uuid,
	"created_by" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope" "audit_scope" NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"request_id" text
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_profiles" ADD CONSTRAINT "org_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_source_chunks" ADD CONSTRAINT "org_source_chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_source_chunks" ADD CONSTRAINT "org_source_chunks_source_id_org_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."org_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_sources" ADD CONSTRAINT "org_sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_contacts" ADD CONSTRAINT "directory_contacts_company_id_directory_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."directory_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icps" ADD CONSTRAINT "icps_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_event_evaluations" ADD CONSTRAINT "org_event_evaluations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_event_evaluations" ADD CONSTRAINT "org_event_evaluations_event_id_market_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."market_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_event_evaluations" ADD CONSTRAINT "org_event_evaluations_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_matches" ADD CONSTRAINT "signal_matches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_matches" ADD CONSTRAINT "signal_matches_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_matches" ADD CONSTRAINT "signal_matches_event_id_market_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."market_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_matches" ADD CONSTRAINT "signal_matches_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_template_id_signal_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."signal_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_directory_company_id_directory_companies_id_fk" FOREIGN KEY ("directory_company_id") REFERENCES "public"."directory_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_signal_match_id_signal_matches_id_fk" FOREIGN KEY ("signal_match_id") REFERENCES "public"."signal_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_primary_contact_id_contacts_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_org_uq" ON "memberships" USING btree ("user_id","org_id");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_hash_uq" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "org_profiles_org_uq" ON "org_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_source_chunks_org_idx" ON "org_source_chunks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_source_chunks_tsv_idx" ON "org_source_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "org_sources_org_idx" ON "org_sources" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "plans_org_idx" ON "plans" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "policies_org_idx" ON "policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "products_org_idx" ON "products" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "directory_companies_key_uq" ON "directory_companies" USING btree ("key");--> statement-breakpoint
CREATE INDEX "directory_companies_name_idx" ON "directory_companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "directory_contacts_company_idx" ON "directory_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "icps_org_idx" ON "icps" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "llm_calls_org_created_idx" ON "llm_calls" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "market_events_hash_uq" ON "market_events" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "market_events_published_idx" ON "market_events" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_events_tags_idx" ON "market_events" USING gin ("industry_tags");--> statement-breakpoint
CREATE INDEX "market_events_tsv_idx" ON "market_events" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "org_event_eval_uq" ON "org_event_evaluations" USING btree ("org_id","event_id","signals_hash");--> statement-breakpoint
CREATE INDEX "pipeline_runs_org_idx" ON "pipeline_runs" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "signal_matches_org_event_signal_uq" ON "signal_matches" USING btree ("org_id","event_id","signal_id");--> statement-breakpoint
CREATE INDEX "signal_matches_org_idx" ON "signal_matches" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_templates_industry_key_uq" ON "signal_templates" USING btree ("industry","key");--> statement-breakpoint
CREATE INDEX "signals_org_idx" ON "signals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "accounts_org_idx" ON "accounts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "accounts_org_name_idx" ON "accounts" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "activities_org_lead_idx" ON "activities" USING btree ("org_id","lead_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activities_org_type_idx" ON "activities" USING btree ("org_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX "contacts_org_account_idx" ON "contacts" USING btree ("org_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_dedupe_uq" ON "leads" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "leads_org_score_idx" ON "leads" USING btree ("org_id","score_total" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_org_stage_idx" ON "leads" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "leads_org_owner_idx" ON "leads" USING btree ("org_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "leads_org_last_signal_idx" ON "leads" USING btree ("org_id","last_signal_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outreach_org_lead_idx" ON "outreach_messages" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE INDEX "tasks_org_assignee_idx" ON "tasks" USING btree ("org_id","assignee_user_id","completed_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_time_idx" ON "audit_logs" USING btree ("org_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_scope_time_idx" ON "audit_logs" USING btree ("scope","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");