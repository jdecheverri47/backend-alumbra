import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GraphQL /graphql apiVersion (e2e)', () => {
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

  it('apiVersion returns a string', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ apiVersion }' })
      .expect(200);

    expect(response.body.data.apiVersion).toEqual(expect.any(String));
  });
});
