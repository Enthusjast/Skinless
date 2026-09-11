import { describe, expect, it } from 'vitest';
import worker, { app } from '../src/index';

describe('security and operational safeguards', () => {
  it('answers CORS preflight requests without requiring authentication', async () => {
    const response = await app.request('/api/user/profile', {
      method: 'OPTIONS',
      headers: { Origin: 'https://pages.example.com', 'Access-Control-Request-Method': 'GET' },
    }, { CORS_ORIGIN: '*', DB: {}, BUCKET: {} });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('DELETE');
  });

  it('runs the scheduled expired-token cleanup query', async () => {
    let deletedBefore = 0;
    const cleanupQueries: string[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          cleanupQueries.push(sql);
          return {
            bind(value: number) {
              deletedBefore = value;
              return { run: async () => ({ success: true }) };
            },
          };
        },
      },
      BUCKET: {},
    };

    await worker.scheduled?.({} as ScheduledController, env as never, {} as ExecutionContext);
    expect(deletedBefore).toBeGreaterThan(0);
    expect(cleanupQueries).toEqual([
      'DELETE FROM tokens WHERE expires_at < ?',
      'DELETE FROM server_sessions WHERE expires_at < ?',
    ]);
  });
});
