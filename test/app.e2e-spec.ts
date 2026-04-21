import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GraphQL /graphql (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('ping returns "pong"', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ ping }' })
      .expect(200);

    expect(response.body).toEqual({ data: { ping: 'pong' } });
  });
});
