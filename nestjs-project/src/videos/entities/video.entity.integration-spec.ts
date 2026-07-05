import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const id = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${id}@example.com`,
        password: 'hashed',
      }),
    );

    return channelRepository.save(
      channelRepository.create({
        name: `Video Channel ${id}`,
        nickname: `video_channel_${id}`,
        user_id: user.id,
      }),
    );
  }

  async function createVideo(overrides: Partial<Video> = {}): Promise<Video> {
    const channel = await createChannel();
    const id = ++counter;

    return videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: `Video ${id}`,
        public_id: `public_${id}`,
        original_file_name: 'example.mp4',
        mime_type: 'video/mp4',
        size_bytes: 10_737_418_240,
        original_file_key: `channels/${channel.id}/videos/video-${id}.mp4`,
        thumbnail_key: null,
        upload_id: `upload-${id}`,
        part_size_bytes: 104_857_600,
        part_count: 103,
        duration_seconds: null,
        metadata: null,
        processing_job_id: null,
        processing_error_code: null,
        processing_error_message: null,
        processing_error_details: null,
        upload_completed_at: null,
        processed_at: null,
        ...overrides,
      }),
    );
  }

  it('should default status to draft and populate timestamps', async () => {
    const saved = await createVideo();

    expect(saved.status).toBe(VideoStatus.DRAFT);
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
  });

  it('should keep nullable processing fields null for a draft video', async () => {
    const saved = await createVideo();

    expect(saved.thumbnail_key).toBeNull();
    expect(saved.duration_seconds).toBeNull();
    expect(saved.metadata).toBeNull();
    expect(saved.processing_error_code).toBeNull();
    expect(saved.upload_completed_at).toBeNull();
    expect(saved.processed_at).toBeNull();
  });

  it('should return size_bytes as a number despite PostgreSQL bigint', async () => {
    const saved = await createVideo();
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.size_bytes).toBe(10_737_418_240);
    expect(typeof found.size_bytes).toBe('number');
  });

  it('should enforce unique public_id constraint', async () => {
    await createVideo({ public_id: 'same_public_id' });

    await expect(
      createVideo({ public_id: 'same_public_id' }),
    ).rejects.toThrow();
  });

  it('should load the related channel via the ManyToOne relation', async () => {
    const saved = await createVideo({ public_id: 'with_channel' });
    const found = await videoRepository.findOneOrFail({
      where: { id: saved.id },
      relations: ['channel'],
    });

    expect(found.channel.id).toBe(saved.channel_id);
  });

  it('should delete videos when the owner channel is deleted', async () => {
    const saved = await createVideo({ public_id: 'cascade_delete' });

    await channelRepository.delete({ id: saved.channel_id });

    await expect(
      videoRepository.findOneBy({ id: saved.id }),
    ).resolves.toBeNull();
  });
});
