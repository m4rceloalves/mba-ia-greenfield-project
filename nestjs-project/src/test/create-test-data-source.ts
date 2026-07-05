import {
  DataSource,
  EntitySchema,
  MigrationInterface,
  type ObjectType,
} from 'typeorm';

interface TestDataSourceOptions {
  synchronize?: boolean;
  migrations?: (new () => MigrationInterface)[];
}

export function createTestDataSource(
  entities: (ObjectType<unknown> | string | EntitySchema<unknown>)[],
  options: TestDataSourceOptions = {},
): DataSource {
  const { synchronize = true, migrations } = options;
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'db',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'streamtube',
    password: process.env.DB_PASSWORD ?? 'streamtube',
    database: process.env.DB_DATABASE ?? 'streamtube',
    entities,
    synchronize,
    ...(migrations !== undefined && { migrations, migrationsRun: false }),
  });
}

export async function cleanAllTables(dataSource: DataSource): Promise<void> {
  const orderedTables = [
    'videos',
    'refresh_tokens',
    'verification_tokens',
    'channels',
    'users',
  ];
  const existingTables = (await dataSource.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [orderedTables],
  )) as unknown as { table_name: string }[];
  const existingTableNames = new Set<string>(
    existingTables.map((row: { table_name: string }) => row.table_name),
  );

  for (const table of orderedTables) {
    if (existingTableNames.has(table)) {
      await dataSource.query(`DELETE FROM "${table}"`);
    }
  }
}
