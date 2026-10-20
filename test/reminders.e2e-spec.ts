import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { requireLocalDb } from './setup/require-local-db';

const TOKEN = 'token-de-prueba-de-al-menos-32-caracteres';

describe('POST /internal/notifications/tick (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    requireLocalDb();
    process.env.CRON_TOKEN = TOKEN;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    delete process.env.CRON_TOKEN;
    await app.close();
  });

  const tick = (token?: string) => {
    const req = request(app.getHttpServer()).post('/internal/notifications/tick');
    return token ? req.set('X-Cron-Token', token) : req;
  };

  it('sin el token correcto no corre', async () => {
    await tick().expect(403);
    await tick('otro-token').expect(403);
  });

  it('con el token corre y dice cuántos avisos mandó', async () => {
    const res = await tick(TOKEN).expect(200);
    expect(res.body).toEqual({
      published: expect.any(Number),
      dueSoon: expect.any(Number),
      classes: expect.any(Number),
      events: expect.any(Number),
      emailed: expect.any(Number),
    });
  });
});
