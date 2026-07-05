import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import appConfig from '../../config/app.config';
import databaseConfig from '../../config/database.config';
import { envValidationSchema } from '../../config/env.validation';
import queueConfig from '../../config/queue.config';
import storageConfig from '../../config/storage.config';
import videoConfig from '../../config/video.config';
import { User } from '../../users/entities/user.entity';
import { Video } from '../entities/video.entity';
import { VIDEO_PROCESSING_QUEUE } from '../video-processing-queue.constants';
import { VideoStorageModule } from '../storage/video-storage.module';
import { VideoMediaProcessRunner } from './video-media-process-runner.service';
import { VideoMediaProbeService } from './video-media-probe.service';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoThumbnailService } from './video-thumbnail.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        queueConfig,
        storageConfig,
        videoConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: config.redisHost,
          port: config.redisPort,
        },
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
    TypeOrmModule.forFeature([Video, Channel, User]),
    VideoStorageModule,
  ],
  providers: [
    VideoMediaProcessRunner,
    VideoMediaProbeService,
    VideoThumbnailService,
    VideoProcessingProcessor,
  ],
})
export class VideoWorkerModule {}
