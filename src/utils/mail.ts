export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const DEFAULT_MAIL_TIMEOUT_MS = 10_000;

export interface MailSender {
  sendVerificationCode(email: string, code: string): Promise<void>;
  sendPasswordResetCode?(email: string, code: string): Promise<void>;
  sendEmailChangeCode?(email: string, code: string): Promise<void>;
}

export interface ResendMailOptions {
  apiKey?: string;
  from?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class MailError extends Error {
  public constructor(
    public readonly code: "mail_not_configured" | "mail_delivery_failed",
    message: string,
  ) {
    super(message);
    this.name = "MailError";
  }
}

export function isMailConfigured(
  options: Pick<ResendMailOptions, "apiKey" | "from">,
): boolean {
  return Boolean(options.apiKey?.trim() && options.from?.trim());
}

function verificationMessage(code: string): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: "Verify your Skinless account",
    text: `Your Skinless verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your Skinless verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  };
}

function passwordResetMessage(code: string): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: 'Reset your Skinless password',
    text: `Your Skinless password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your Skinless password reset code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  };
}

function emailChangeMessage(code: string): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: 'Confirm your new Skinless email',
    text: `Your Skinless email change code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your Skinless email change code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  };
}

export function createResendMailSender(options: ResendMailOptions): MailSender {
  const apiKey = options.apiKey?.trim() ?? "";
  const from = options.from?.trim() ?? "";
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_MAIL_TIMEOUT_MS;

  async function sendMessage(
    email: string,
    message: { subject: string; text: string; html: string },
    logLabel: string,
  ): Promise<void> {
    if (!isMailConfigured({ apiKey, from })) {
      throw new MailError(
        "mail_not_configured",
        "Email delivery is not configured.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          ...message,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error(`[mail] Resend rejected ${logLabel} email`, {
          status: response.status,
        });
        throw new MailError("mail_delivery_failed", "Email delivery failed.");
      }
    } catch (error) {
      if (error instanceof MailError) throw error;
      console.error(`[mail] ${logLabel} email delivery failed`, {
        reason:
          error instanceof DOMException && error.name === "AbortError"
            ? "timeout"
            : "request",
      });
      throw new MailError("mail_delivery_failed", "Email delivery failed.");
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    sendVerificationCode(email, code) {
      return sendMessage(email, verificationMessage(code), 'Verification');
    },
    sendPasswordResetCode(email, code) {
      return sendMessage(email, passwordResetMessage(code), 'Password reset');
    },
    sendEmailChangeCode(email, code) {
      return sendMessage(email, emailChangeMessage(code), 'Email change');
    },
  };
}
