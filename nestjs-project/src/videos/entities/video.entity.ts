import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

const numberFromBigint: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string | number | null) => {
    if (value === null) {
      return null;
    }

    return Number(value);
  },
};

@Entity('videos')
@Index('IDX_VIDEOS_PUBLIC_ID', ['public_id'], { unique: true })
@Index('IDX_VIDEOS_CHANNEL_ID', ['channel_id'])
@Index('IDX_VIDEOS_STATUS', ['status'])
@Index('IDX_VIDEOS_ORIGINAL_FILE_KEY', ['original_file_key'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 32 })
  public_id: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 255 })
  original_file_name: string;

  @Column({ type: 'varchar', length: 100 })
  mime_type: string;

  @Column({ type: 'bigint', transformer: numberFromBigint })
  size_bytes: number;

  @Column({ type: 'varchar', length: 1024 })
  original_file_key: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  upload_id: string | null;

  @Column({ type: 'integer' })
  part_size_bytes: number;

  @Column({ type: 'integer' })
  part_count: number;

  @Column({ type: 'integer', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  processing_job_id: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  processing_error_code: string | null;

  @Column({ type: 'text', nullable: true })
  processing_error_message: string | null;

  @Column({ type: 'jsonb', nullable: true })
  processing_error_details: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  upload_completed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
