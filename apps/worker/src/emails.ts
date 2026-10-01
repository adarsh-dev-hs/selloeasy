import { textToHtml, type MailMessage } from '@selloeasy/core';
import { ROLE_LABELS, type Role } from '@selloeasy/shared';

function layout(title: string, bodyHtml: string, cta?: { label: string; href: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px">
<tr><td style="font-size:18px;font-weight:700;color:#4f46e5;padding-bottom:16px">SelloEasy</td></tr>
<tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${title}</td></tr>
<tr><td style="font-size:14px;line-height:1.6">${bodyHtml}</td></tr>
${cta ? `<tr><td style="padding-top:20px"><a href="${cta.href}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${cta.label}</a></td></tr>
<tr><td style="font-size:12px;color:#71717a;padding-top:16px">Or paste this link into your browser:<br/>${cta.href}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

export function inviteEmail(p: { to: string; orgName: string; role: string; link: string; invitedByName: string | null }): MailMessage {
  const role = ROLE_LABELS[p.role as Role] ?? p.role;
  const text = `${p.invitedByName ?? 'An administrator'} invited you to join ${p.orgName} on SelloEasy as ${role}.\n\nAccept your invitation (link expires soon):\n${p.link}\n\nIf you weren't expecting this, you can ignore this email.`;
  return {
    to: p.to,
    subject: `You're invited to join ${p.orgName} on SelloEasy`,
    text,
    html: layout(`Join ${p.orgName} on SelloEasy`, textToHtml(`${p.invitedByName ?? 'An administrator'} invited you to join ${p.orgName} as ${role}. Set your password to get started — this link is single-use and expires soon.`), {
      label: 'Accept invitation',
      href: p.link,
    }),
  };
}

export function passwordResetEmail(p: { to: string; link: string }): MailMessage {
  return {
    to: p.to,
    subject: 'Reset your SelloEasy password',
    text: `Someone requested a password reset for your SelloEasy account.\n\nReset it here (valid for 1 hour):\n${p.link}\n\nIf this wasn't you, ignore this email.`,
    html: layout('Reset your password', textToHtml('Someone requested a password reset for your account. The link is valid for 1 hour. If this wasn’t you, you can ignore this email.'), {
      label: 'Reset password',
      href: p.link,
    }),
  };
}
