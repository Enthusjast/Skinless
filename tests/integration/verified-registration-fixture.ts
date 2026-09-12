import { env } from "cloudflare:test";
import { app } from "../../src/index";

export interface VerifiedAccount {
  id: string;
  email: string;
  role: "user" | "admin";
  profile: {
    id: string;
    name: string;
    skinHash: string | null;
    capeHash: string | null;
    skinModel: "classic" | "slim";
  };
}

let nextRegistrationIp = 40;

export async function registerVerifiedAccount(
  email: string,
  password: string,
  name: string,
): Promise<VerifiedAccount> {
  let code = "";
  const bindings = {
    ...env,
    MAIL_SENDER: {
      async sendVerificationCode(_email: string, nextCode: string) {
        code = nextCode;
      },
    },
  };
  const start = await Promise.resolve(
    app.request(
      "https://worker.test/api/auth/register/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": `198.51.100.${nextRegistrationIp++}`,
        },
        body: JSON.stringify({ email, password, name }),
      },
      bindings as never,
    ),
  );
  if (start.status !== 202)
    throw new Error(`verified registration start failed: ${start.status}`);
  const startBody = (await start.json()) as { challengeId: string };

  const verify = await Promise.resolve(
    app.request(
      "https://worker.test/api/auth/register/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: startBody.challengeId, code }),
      },
      bindings as never,
    ),
  );
  if (verify.status !== 201)
    throw new Error(
      `verified registration verification failed: ${verify.status}`,
    );
  const body = (await verify.json()) as { user: VerifiedAccount };
  return body.user;
}
