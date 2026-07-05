import type { ConfigType } from '@nestjs/config';
import videoConfig from '../../config/video.config';
import { VideoMediaProcessRunner } from './video-media-process-runner.service';
import { VideoMediaProbeService } from './video-media-probe.service';

const config: ConfigType<typeof videoConfig> = {
  maxUploadBytes: 10_737_418_240,
  multipartPartSizeBytes: 104_857_600,
  allowedMimeTypes: ['video/mp4'],
  processingTimeoutMs: 120_000,
};

describe('VideoMediaProbeService', () => {
  it('should run ffprobe and parse duration plus metadata', async () => {
    const runner = {
      run: jest.fn().mockResolvedValue({
        stdout: JSON.stringify({
          format: { duration: '12.6', size: '1000' },
          streams: [{ codec_type: 'video', width: 16, height: 16 }],
        }),
        stderr: '',
      }),
    } as unknown as jest.Mocked<VideoMediaProcessRunner>;
    const service = new VideoMediaProbeService(runner, config);

    await expect(service.probe('/tmp/video.mp4')).resolves.toEqual({
      durationSeconds: 13,
      metadata: {
        format: { duration: '12.6', size: '1000' },
        streams: [{ codec_type: 'video', width: 16, height: 16 }],
      },
    });

    expect(runner.run).toHaveBeenCalledWith(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '/tmp/video.mp4',
      ],
      120_000,
    );
  });
});
