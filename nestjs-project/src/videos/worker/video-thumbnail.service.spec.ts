import type { ConfigType } from '@nestjs/config';
import videoConfig from '../../config/video.config';
import { VideoMediaProcessRunner } from './video-media-process-runner.service';
import { VideoThumbnailService } from './video-thumbnail.service';

const config: ConfigType<typeof videoConfig> = {
  maxUploadBytes: 10_737_418_240,
  multipartPartSizeBytes: 104_857_600,
  allowedMimeTypes: ['video/mp4'],
  processingTimeoutMs: 120_000,
};

describe('VideoThumbnailService', () => {
  it('should run ffmpeg to generate one JPEG thumbnail frame', async () => {
    const runner = {
      run: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    } as unknown as jest.Mocked<VideoMediaProcessRunner>;
    const service = new VideoThumbnailService(runner, config);

    await expect(
      service.generate('/tmp/input.mp4', '/tmp/thumb.jpg'),
    ).resolves.toBe('/tmp/thumb.jpg');

    expect(runner.run).toHaveBeenCalledWith(
      'ffmpeg',
      [
        '-y',
        '-ss',
        '00:00:01',
        '-i',
        '/tmp/input.mp4',
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '/tmp/thumb.jpg',
      ],
      120_000,
    );
  });
});
