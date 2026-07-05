import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Readable } from 'node:stream';
import { Repository } from 'typeorm';
import {
  VideoNotFoundException,
  VideoRangeNotSatisfiableException,
  VideoStorageFailedException,
} from '../common/exceptions/domain.exception';
import { Video, VideoStatus } from './entities/video.entity';
import { parseByteRange, UnsatisfiableRangeError } from './range.util';
import { VideoStorageService } from './storage/video-storage.service';

interface VideoStreamResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Readable;
}

@Injectable()
export class VideosStreamingService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: VideoStorageService,
  ) {}

  async streamReadyVideo(
    publicId: string,
    rangeHeader: string | undefined,
  ): Promise<VideoStreamResponse> {
    const video = await this.findReadyVideo(publicId);

    const head = await this.storageService.headOriginalObject(
      video.original_file_key,
    );

    try {
      const range = parseByteRange(rangeHeader, head.contentLength);

      if (range === null) {
        const object = await this.storageService.getOriginalObjectStream({
          key: video.original_file_key,
        });
        if (object.body === undefined) {
          throw new VideoStorageFailedException();
        }

        return {
          statusCode: 200,
          body: object.body as Readable,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(head.contentLength),
            'Content-Type': head.contentType,
          },
        };
      }

      const contentLength = range.end - range.start + 1;
      const object = await this.storageService.getOriginalObjectStream({
        key: video.original_file_key,
        range: `bytes=${range.start}-${range.end}`,
      });
      if (object.body === undefined) {
        throw new VideoStorageFailedException();
      }

      return {
        statusCode: 206,
        body: object.body as Readable,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${range.start}-${range.end}/${head.contentLength}`,
          'Content-Length': String(contentLength),
          'Content-Type': head.contentType,
        },
      };
    } catch (error) {
      if (error instanceof UnsatisfiableRangeError) {
        throw new VideoRangeNotSatisfiableException(head.contentLength);
      }

      throw error;
    }
  }

  async downloadReadyVideo(publicId: string): Promise<VideoStreamResponse> {
    const video = await this.findReadyVideo(publicId);
    const head = await this.storageService.headOriginalObject(
      video.original_file_key,
    );
    const object = await this.storageService.getOriginalObjectStream({
      key: video.original_file_key,
    });
    if (object.body === undefined) {
      throw new VideoStorageFailedException();
    }

    return {
      statusCode: 200,
      body: object.body as Readable,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Disposition': this.buildAttachmentDisposition(
          video.original_file_name,
        ),
        'Content-Length': String(head.contentLength),
        'Content-Type': head.contentType,
      },
    };
  }

  async thumbnailReadyVideo(publicId: string): Promise<VideoStreamResponse> {
    const video = await this.findReadyVideo(publicId);
    if (video.thumbnail_key === null) {
      throw new VideoNotFoundException();
    }

    const head = await this.storageService.headThumbnailObject(
      video.thumbnail_key,
    );
    const object = await this.storageService.getThumbnailObjectStream(
      video.thumbnail_key,
    );
    if (object.body === undefined) {
      throw new VideoStorageFailedException();
    }

    return {
      statusCode: 200,
      body: object.body as Readable,
      headers: {
        'Content-Length': String(head.contentLength),
        'Content-Type': head.contentType,
      },
    };
  }

  private async findReadyVideo(publicId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });

    if (!video || video.status !== VideoStatus.READY) {
      throw new VideoNotFoundException();
    }

    return video;
  }

  private buildAttachmentDisposition(fileName: string): string {
    const fallbackFileName =
      fileName
        .replace(/[\r\n"]/g, '')
        .trim()
        .slice(0, 255) || 'video';
    const encodedFileName = encodeURIComponent(fileName);

    return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`;
  }
}
