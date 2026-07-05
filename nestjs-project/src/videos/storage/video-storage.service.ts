import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import storageConfig from '../../config/storage.config';
import { S3_CLIENT } from './video-storage.constants';

interface OriginalVideoKeyInput {
  channelId: string;
  videoId: string;
  originalFileName: string;
}

interface CreateMultipartUploadInput extends OriginalVideoKeyInput {
  mimeType: string;
}

interface PresignUploadPartsInput {
  key: string;
  uploadId: string;
  partNumbers: number[];
}

interface CompletedUploadPart {
  partNumber: number;
  eTag: string;
}

interface CompleteMultipartUploadInput {
  key: string;
  uploadId: string;
  parts: CompletedUploadPart[];
}

interface ObjectStreamInput {
  key: string;
  range?: string;
}

interface PutThumbnailInput {
  key: string;
  body: Buffer | Uint8Array | Readable;
}

export interface PresignedUploadPart {
  partNumber: number;
  uploadUrl: string;
  expiresAt: Date;
}

export interface ObjectHead {
  contentLength: number;
  contentType: string;
}

export interface ObjectStream {
  body: GetObjectCommandOutput['Body'];
  contentLength: number | undefined;
  contentType: string;
}

@Injectable()
export class VideoStorageService {
  constructor(
    @Inject(S3_CLIENT)
    private readonly s3Client: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  buildOriginalVideoKey(input: OriginalVideoKeyInput): string {
    return [
      'channels',
      input.channelId,
      'videos',
      input.videoId,
      'original',
      this.sanitizeFileName(input.originalFileName),
    ].join('/');
  }

  buildThumbnailKey(channelId: string, videoId: string): string {
    return [
      'channels',
      channelId,
      'videos',
      videoId,
      'thumbnails',
      'default.jpg',
    ].join('/');
  }

  calculatePartCount(sizeBytes: number, partSizeBytes: number): number {
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new Error('sizeBytes must be a positive integer');
    }

    if (!Number.isInteger(partSizeBytes) || partSizeBytes <= 0) {
      throw new Error('partSizeBytes must be a positive integer');
    }

    return Math.ceil(sizeBytes / partSizeBytes);
  }

  async createMultipartUpload(
    input: CreateMultipartUploadInput,
  ): Promise<{ key: string; uploadId: string }> {
    const key = this.buildOriginalVideoKey(input);
    const result = await this.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.videoBucket,
        Key: key,
        ContentType: input.mimeType,
        Metadata: {
          channelId: input.channelId,
          videoId: input.videoId,
          originalFileName: input.originalFileName,
        },
      }),
    );

    if (!result.UploadId) {
      throw new Error('Storage did not return a multipart upload id');
    }

    return { key, uploadId: result.UploadId };
  }

  async createPresignedUploadPartUrls(
    input: PresignUploadPartsInput,
  ): Promise<PresignedUploadPart[]> {
    const partNumbers = this.validatePartNumbers(input.partNumbers);
    const expiresAt = new Date(
      Date.now() + this.config.presignedUrlTtlSeconds * 1000,
    );

    return Promise.all(
      partNumbers.map(async (partNumber) => {
        const command = new UploadPartCommand({
          Bucket: this.config.videoBucket,
          Key: input.key,
          UploadId: input.uploadId,
          PartNumber: partNumber,
        });

        return {
          partNumber,
          uploadUrl: await getSignedUrl(this.s3Client, command, {
            expiresIn: this.config.presignedUrlTtlSeconds,
          }),
          expiresAt,
        };
      }),
    );
  }

  async completeMultipartUpload(
    input: CompleteMultipartUploadInput,
  ): Promise<void> {
    const parts = this.validateCompletedParts(input.parts);

    await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.videoBucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.videoBucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async headOriginalObject(key: string): Promise<ObjectHead> {
    const result = await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: this.config.videoBucket,
        Key: key,
      }),
    );

    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  }

  async headThumbnailObject(key: string): Promise<ObjectHead> {
    const result = await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: this.config.thumbnailBucket,
        Key: key,
      }),
    );

    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType ?? 'image/jpeg',
    };
  }

  async getOriginalObjectStream(
    input: ObjectStreamInput,
  ): Promise<ObjectStream> {
    const result = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.config.videoBucket,
        Key: input.key,
        ...(input.range !== undefined && { Range: input.range }),
      }),
    );

    return {
      body: result.Body,
      contentLength: result.ContentLength,
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  }

  async getThumbnailObjectStream(key: string): Promise<ObjectStream> {
    const result = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.config.thumbnailBucket,
        Key: key,
      }),
    );

    return {
      body: result.Body,
      contentLength: result.ContentLength,
      contentType: result.ContentType ?? 'image/jpeg',
    };
  }

  async putThumbnail(input: PutThumbnailInput): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.thumbnailBucket,
        Key: input.key,
        Body: input.body,
        ContentType: 'image/jpeg',
      }),
    );
  }

  private sanitizeFileName(fileName: string): string {
    const sanitized = fileName
      .trim()
      .replace(/[/\\]/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 255);

    return sanitized || 'video';
  }

  private validatePartNumbers(partNumbers: number[]): number[] {
    if (partNumbers.length === 0) {
      throw new Error('At least one part number is required');
    }

    const unique = new Set(partNumbers);
    if (unique.size !== partNumbers.length) {
      throw new Error('Duplicate part numbers are not allowed');
    }

    const sorted = [...partNumbers].sort((a, b) => a - b);
    for (const partNumber of sorted) {
      if (
        !Number.isInteger(partNumber) ||
        partNumber < 1 ||
        partNumber > 10000
      ) {
        throw new Error('Part number must be an integer between 1 and 10000');
      }
    }

    return sorted;
  }

  private validateCompletedParts(
    parts: CompletedUploadPart[],
  ): CompletedPart[] {
    const partNumbers = this.validatePartNumbers(
      parts.map((part) => part.partNumber),
    );
    const partsByNumber = new Map(
      parts.map((part) => [part.partNumber, part.eTag]),
    );

    return partNumbers.map((partNumber) => {
      const eTag = partsByNumber.get(partNumber);
      if (!eTag || eTag.trim().length === 0) {
        throw new Error('Every completed part must include an ETag');
      }

      return {
        ETag: eTag,
        PartNumber: partNumber,
      };
    });
  }
}
