import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoConfig from '../../config/video.config';
import { VideoMediaProcessRunner } from './video-media-process-runner.service';

@Injectable()
export class VideoThumbnailService {
  constructor(
    private readonly runner: VideoMediaProcessRunner,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async generate(inputPath: string, outputPath: string): Promise<string> {
    await this.runner.run(
      'ffmpeg',
      [
        '-y',
        '-ss',
        '00:00:01',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        outputPath,
      ],
      this.config.processingTimeoutMs,
    );

    return outputPath;
  }
}
