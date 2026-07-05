import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoConfig from '../../config/video.config';
import { VideoMediaProcessRunner } from './video-media-process-runner.service';

interface FfprobeFormat {
  duration?: string;
  [key: string]: unknown;
}

interface FfprobeOutput {
  format?: FfprobeFormat;
  streams?: unknown[];
}

export interface VideoProbeResult {
  durationSeconds: number | null;
  metadata: Record<string, unknown>;
}

@Injectable()
export class VideoMediaProbeService {
  constructor(
    private readonly runner: VideoMediaProcessRunner,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async probe(filePath: string): Promise<VideoProbeResult> {
    const result = await this.runner.run(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      this.config.processingTimeoutMs,
    );
    const parsed = JSON.parse(result.stdout) as FfprobeOutput;
    const duration = Number(parsed.format?.duration);

    return {
      durationSeconds: Number.isFinite(duration) ? Math.round(duration) : null,
      metadata: {
        format: parsed.format ?? null,
        streams: parsed.streams ?? [],
      },
    };
  }
}
