import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import queueConfig from '../config/queue.config';
import { Video } from './entities/video.entity';
import { VideoStorageModule } from './storage/video-storage.module';
import { VideoProcessingQueueService } from './video-processing-queue.service';
import { VIDEO_PROCESSING_QUEUE } from './video-processing-queue.constants';
import { VideosController } from './videos.controller';
import { VideosStreamingService } from './videos-streaming.service';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
    VideoStorageModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: config.redisHost,
          port: config.redisPort,
        },
        defaultJobOptions: {
          attempts: config.defaultAttempts,
          backoff: {
            type: 'exponential',
            delay: config.backoffDelayMs,
          },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  controllers: [VideosController],
  providers: [
    VideoProcessingQueueService,
    VideosService,
    VideosStreamingService,
  ],
  exports: [TypeOrmModule, VideoProcessingQueueService],
})
export class VideosModule {}
