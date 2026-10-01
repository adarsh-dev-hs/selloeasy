import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import nodemailer, { type Transporter } from 'nodemailer';
import { getConfig } from './config';

/**
 * MailProvider — `smtp` (Mailpit locally, any SMTP relay) or `ses` (AWS SES v2 with the task role).
 * Selected by MAIL_DRIVER (ADR-0012).
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  fromName?: string;
  headers?: Record<string, string>;
}
export interface MailResult {
  messageId: string;
}
export interface MailProvider {
  readonly driver: 'smtp' | 'ses';
  send(msg: MailMessage): Promise<MailResult>;
}

function fromAddress(fromName?: string): string {
  const base = getConfig().MAIL_FROM;
  if (!fromName) return base;
  const match = base.match(/<([^>]+)>/);
  const addr = match ? match[1] : base;
  return `"${fromName.replace(/"/g, '')}" <${addr}>`;
}

class SmtpMail implements MailProvider {
  readonly driver = 'smtp' as const;
  private transporter: Transporter;
  constructor() {
    const c = getConfig();
    this.transporter = nodemailer.createTransport({
      host: c.SMTP_HOST,
      port: c.SMTP_PORT,
      secure: c.SMTP_SECURE,
      auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASSWORD ?? '' } : undefined,
    });
  }
  async send(msg: MailMessage): Promise<MailResult> {
    const info = await this.transporter.sendMail({
      from: fromAddress(msg.fromName),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      replyTo: msg.replyTo,
      headers: msg.headers,
    });
    return { messageId: String(info.messageId) };
  }
}

class SesMail implements MailProvider {
  readonly driver = 'ses' as const;
  private client: SESv2Client;
  constructor() {
    this.client = new SESv2Client({ region: getConfig().SES_REGION });
  }
  async send(msg: MailMessage): Promise<MailResult> {
    const c = getConfig();
    const res = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: fromAddress(msg.fromName),
        Destination: { ToAddresses: [msg.to] },
        ReplyToAddresses: msg.replyTo ? [msg.replyTo] : undefined,
        ConfigurationSetName: c.SES_CONFIGURATION_SET,
        Content: {
          Simple: {
            Subject: { Data: msg.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: msg.text, Charset: 'UTF-8' },
              ...(msg.html ? { Html: { Data: msg.html, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      }),
    );
    return { messageId: res.MessageId ?? 'unknown' };
  }
}

let mail: MailProvider | undefined;
export function getMail(): MailProvider {
  if (!mail) mail = getConfig().MAIL_DRIVER === 'ses' ? new SesMail() : new SmtpMail();
  return mail;
}
export function setMailForTests(m: MailProvider | undefined) {
  mail = m;
}

/** Minimal HTML escaping + paragraph wrapping for plain-text emails. */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}
