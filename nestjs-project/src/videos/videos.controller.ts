import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { InitiateVideoUploadDto } from './dto/initiate-video-upload.dto';
import { RequestUploadPartsDto } from './dto/request-upload-parts.dto';
import {
  CompleteVideoUploadResponseDto,
  InitiateVideoUploadResponseDto,
  OwnerVideoStatusResponseDto,
  PublicVideoMetadataResponseDto,
  RequestUploadPartsResponseDto,
} from './dto/video-upload-response.dto';
import { VideosService } from './videos.service';
import { VideosStreamingService } from './videos-streaming.service';
import type { Response } from 'express';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly streamingService: VideosStreamingService,
  ) {}

  @Post('uploads')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Initiate a direct-to-storage video upload' })
  @ApiResponse({ status: 201, type: InitiateVideoUploadResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'Video exceeds upload limit',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 415,
    description: 'Unsupported MIME type',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateVideoUploadDto,
  ): Promise<InitiateVideoUploadResponseDto> {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Post('uploads/:videoId/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create presigned URLs for multipart upload parts' })
  @ApiResponse({ status: 200, type: RequestUploadPartsResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid upload parts',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not own the video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  createUploadPartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: RequestUploadPartsDto,
  ): Promise<RequestUploadPartsResponseDto> {
    return this.videosService.createUploadPartUrls(user.sub, videoId, dto);
  }

  @Post('uploads/:videoId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Complete multipart upload and queue processing' })
  @ApiResponse({ status: 200, type: CompleteVideoUploadResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Video upload is not in draft state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Storage or queue operation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: CompleteVideoUploadDto,
  ): Promise<CompleteVideoUploadResponseDto> {
    return this.videosService.completeUpload(user.sub, videoId, dto);
  }

  @Delete('uploads/:videoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Abort a draft upload' })
  @ApiResponse({ status: 204, description: 'Draft upload aborted' })
  abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ): Promise<void> {
    return this.videosService.abortUpload(user.sub, videoId);
  }

  @Get('uploads/:videoId/status')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get owner-visible upload and processing status' })
  @ApiResponse({ status: 200, type: OwnerVideoStatusResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not own the video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  getOwnerStatus(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ): Promise<OwnerVideoStatusResponseDto> {
    return this.videosService.getOwnerStatus(user.sub, videoId);
  }

  @Public()
  @Get(':publicId/stream')
  @ApiOperation({ summary: 'Stream a ready video with HTTP Range support' })
  @ApiHeader({
    name: 'Range',
    required: false,
    description: 'Optional single byte range, for example: bytes=0-1023',
  })
  @ApiProduces('video/mp4', 'video/webm')
  @ApiResponse({ status: 200, description: 'Full video stream' })
  @ApiResponse({ status: 206, description: 'Partial video stream' })
  @ApiResponse({
    status: 416,
    description: 'Requested byte range is not satisfiable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async streamVideo(
    @Param('publicId') publicId: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const stream = await this.streamingService.streamReadyVideo(
      publicId,
      rangeHeader,
    );

    response.status(stream.statusCode);
    for (const [name, value] of Object.entries(stream.headers)) {
      response.setHeader(name, value);
    }

    return new StreamableFile(stream.body);
  }

  @Public()
  @Get(':publicId/download')
  @ApiOperation({ summary: 'Download a ready video file' })
  @ApiProduces('video/mp4', 'video/webm')
  @ApiResponse({ status: 200, description: 'Video file attachment stream' })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async downloadVideo(
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const stream = await this.streamingService.downloadReadyVideo(publicId);

    response.status(stream.statusCode);
    for (const [name, value] of Object.entries(stream.headers)) {
      response.setHeader(name, value);
    }

    return new StreamableFile(stream.body);
  }

  @Public()
  @Get(':publicId/thumbnail')
  @ApiOperation({ summary: 'Get a ready video thumbnail' })
  @ApiProduces('image/jpeg')
  @ApiResponse({ status: 200, description: 'Video thumbnail image' })
  @ApiResponse({
    status: 404,
    description: 'Video not found, not ready, or has no thumbnail',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getThumbnail(
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const stream = await this.streamingService.thumbnailReadyVideo(publicId);

    response.status(stream.statusCode);
    for (const [name, value] of Object.entries(stream.headers)) {
      response.setHeader(name, value);
    }

    return new StreamableFile(stream.body);
  }

  @Public()
  @Get(':publicId')
  @ApiOperation({ summary: 'Get public metadata for a ready video' })
  @ApiResponse({ status: 200, type: PublicVideoMetadataResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Video not found or not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  getPublicMetadata(
    @Param('publicId') publicId: string,
  ): Promise<PublicVideoMetadataResponseDto> {
    return this.videosService.getPublicMetadata(publicId);
  }
}
