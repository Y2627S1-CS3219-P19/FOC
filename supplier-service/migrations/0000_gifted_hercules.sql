CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"facility_type" varchar(50) NOT NULL,
	"building" varchar(100) NOT NULL,
	"floor" varchar(10),
	"location_description" varchar(300),
	"latitude" double precision,
	"longitude" double precision,
	"opens_at" varchar(5) NOT NULL,
	"closes_at" varchar(5) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"image_url" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_lower_idx" ON "suppliers" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "suppliers_active_idx" ON "suppliers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "suppliers_facility_type_idx" ON "suppliers" USING btree ("facility_type");--> statement-breakpoint
CREATE INDEX "suppliers_building_idx" ON "suppliers" USING btree ("building");