import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1783268700000 implements MigrationInterface {
  name = 'CreateVideos1783268700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "title" character varying(120) NOT NULL, "public_id" character varying(32) NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "original_file_name" character varying(255) NOT NULL, "mime_type" character varying(100) NOT NULL, "size_bytes" bigint NOT NULL, "original_file_key" character varying(1024) NOT NULL, "thumbnail_key" character varying(1024), "upload_id" character varying(512), "part_size_bytes" integer NOT NULL, "part_count" integer NOT NULL, "duration_seconds" integer, "metadata" jsonb, "processing_job_id" character varying(128), "processing_error_code" character varying(80), "processing_error_message" text, "processing_error_details" jsonb, "upload_completed_at" TIMESTAMP WITH TIME ZONE, "processed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_VIDEOS_ID" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_VIDEOS_PUBLIC_ID" ON "videos" ("public_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_VIDEOS_CHANNEL_ID" ON "videos" ("channel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_VIDEOS_STATUS" ON "videos" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_VIDEOS_ORIGINAL_FILE_KEY" ON "videos" ("original_file_key")`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_VIDEOS_CHANNEL_ID" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_VIDEOS_CHANNEL_ID"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_VIDEOS_ORIGINAL_FILE_KEY"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_VIDEOS_STATUS"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_VIDEOS_CHANNEL_ID"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_VIDEOS_PUBLIC_ID"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
