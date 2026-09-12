import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../../src/index";

interface SentCode {
  email: string;
  code: string;
}

function createMailFixture(sent: SentCode[]) {
  return {
    async sendVerificationCode(email: string, code: string) {
      sent.push({ email, code });
    },
  };
}

function request(
  path: string,
  body: unknown,
  bindings: Record<string, unknown>,
): Promise<Response> {
  return Promise.resolve(
    app.request(
      `https://worker.test${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      bindings as never,
    ),
  );
}

describe("verified registration on real D1", () => {
  it("keeps start pending and atomically creates the verified account at code verification", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const email = `verified-${suffix}@example.com`;
    const name = `Verified${suffix.slice(0, 8)}`;
    const sent: SentCode[] = [];
    const bindings = { ...env, MAIL_SENDER: createMailFixture(sent) };

    const start = await request(
      "/api/auth/register/start",
      {
        email,
        password: "correct-password",
        name,
      },
      bindings,
    );

    expect(start.status).toBe(202);
    const startBody = (await start.json()) as {
      challengeId: string;
      expiresAt: number;
      resendAfter: number;
    };
    expect(startBody).toMatchObject({
      challengeId: expect.any(String),
      expiresAt: expect.any(Number),
      resendAfter: expect.any(Number),
    });
    expect(sent).toEqual([{ email, code: expect.stringMatching(/^\d{6}$/) }]);

    const pending = await env.DB.prepare(
      "SELECT email, password_hash, profile_name FROM pending_registrations WHERE email = ?",
    )
      .bind(email)
      .first<{ email: string; password_hash: string; profile_name: string }>();
    expect(pending).toMatchObject({ email, profile_name: name });
    expect(pending?.password_hash).not.toBe("correct-password");

    const beforeVerify = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?",
    )
      .bind(email)
      .first();
    expect(beforeVerify).toBeNull();

    const verify = await request(
      "/api/auth/register/verify",
      {
        challengeId: startBody.challengeId,
        code: sent[0]?.code,
      },
      bindings,
    );

    expect(verify.status).toBe(201);
    const verifyBody = (await verify.json()) as {
      user: {
        id: string;
        email: string;
        role: string;
        profile: { name: string };
      };
    };
    expect(verifyBody.user).toMatchObject({
      email,
      role: "user",
      profile: { name },
    });
    const user = await env.DB.prepare(
      "SELECT id, email_verified_at, status, role FROM users WHERE id = ?",
    )
      .bind(verifyBody.user.id)
      .first<{ id: string; email_verified_at: number; role: string; status: string }>();
    expect(user).toMatchObject({ id: verifyBody.user.id, role: "user", status: "active" });
    expect(user?.email_verified_at).toEqual(expect.any(Number));
    await expect(
      env.DB.prepare("SELECT id FROM pending_registrations WHERE id = ?")
        .bind(startBody.challengeId)
        .first(),
    ).resolves.toBeNull();
  });
});
