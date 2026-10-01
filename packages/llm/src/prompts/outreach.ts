import { z } from 'zod';
import type { PromptDefinition } from '../types';
import { bullets, firstSentence, JSON_RULE, UNTRUSTED_DATA_RULE } from './_util';

export interface OutreachInput {
  tone: 'formal' | 'friendly' | 'concise';
  sender: { name: string; title: string; orgName: string; calendlyUrl: string | null };
  org: { summary: string; valueProps: string[]; products: { name: string; description: string | null }[]; policies: string[] };
  lead: {
    accountName: string;
    contactName: string | null;
    contactTitle: string | null;
    evidence: { signalName: string; title: string; summary: string; publishedAt: string }[];
    painPoints: string[];
  };
}

const firstName = (n: string | null) => (n ? n.split(/\s+/)[0] : null);

function context(input: OutreachInput): string {
  return [
    `## Sender\n${input.sender.name}, ${input.sender.title} at ${input.sender.orgName}${input.sender.calendlyUrl ? `\nBooking link: ${input.sender.calendlyUrl}` : ''}`,
    `## Seller\n${input.org.summary}\nValue props:\n${bullets(input.org.valueProps.slice(0, 5))}\nProducts:\n${bullets(input.org.products.slice(0, 6).map((p) => `${p.name}: ${firstSentence(p.description, 160)}`))}`,
    input.org.policies.length ? `Relevant commitments:\n${bullets(input.org.policies.slice(0, 3))}` : '',
    `## Recipient\n${input.lead.contactName ?? 'Unknown name'}, ${input.lead.contactTitle ?? 'decision maker'} at ${input.lead.accountName}`,
    `Likely pain points: ${input.lead.painPoints.join('; ') || 'n/a'}`,
    '## Why now (evidence)',
    ...input.lead.evidence.slice(0, 3).map((e) => `<event signal="${e.signalName}" published="${e.publishedAt}">\n${e.title}\n${e.summary}\n</event>`),
  ]
    .filter(Boolean)
    .join('\n\n');
}

const RULES = [
  'Personalise using the evidence ("why now"). Reference ONE concrete detail from the news.',
  'Do not invent customers, numbers, discounts or certifications that are not in the seller materials.',
  'Never claim a prior relationship. Keep it respectful and compliant.',
  UNTRUSTED_DATA_RULE,
  JSON_RULE,
];

export const emailDraftSchema = z.object({ subject: z.string().min(3).max(200), body: z.string().min(40).max(5000) });
export type EmailDraft = z.infer<typeof emailDraftSchema>;

export const emailDraftPrompt: PromptDefinition<OutreachInput, EmailDraft> = {
  id: 'outreach.email',
  version: 'v1',
  schema: emailDraftSchema,
  temperature: 0.5,
  maxTokens: 900,
  build(input) {
    return {
      system: [
        `You write first-touch B2B sales emails. Tone: ${input.tone}. 90-160 words, plain text, short paragraphs, one clear call to action (a 20-minute call${input.sender.calendlyUrl ? ' via the booking link' : ''}). Sign off with the sender's name, title and company.`,
        ...RULES,
        'JSON shape: {"subject": string, "body": string}',
      ].join('\n'),
      user: context(input),
    };
  },
  mock(input) {
    const ev = input.lead.evidence[0];
    const hi = firstName(input.lead.contactName) ?? 'there';
    const product = input.org.products[0]?.name ?? 'our solutions';
    return {
      subject: ev ? `${input.lead.accountName}: ${ev.signalName.toLowerCase()} — idea from ${input.sender.orgName}` : `Idea for ${input.lead.accountName}`,
      body: [
        `Hi ${hi},`,
        ev
          ? `I saw the news that ${firstSentence(ev.title, 180).replace(/\.$/, '')} — congratulations. Moves like this usually put pressure on ${input.lead.painPoints[0]?.toLowerCase() ?? 'cost, quality and delivery timelines'}.`
          : `I'm reaching out because teams like yours at ${input.lead.accountName} are often dealing with ${input.lead.painPoints[0]?.toLowerCase() ?? 'cost and delivery pressure'}.`,
        `At ${input.sender.orgName} we help teams in exactly this situation. ${firstSentence(input.org.valueProps[0] ?? input.org.summary, 220).replace(/\.?$/, '.')} Our ${product} is usually where conversations like this start.`,
        input.sender.calendlyUrl
          ? `Would a 20-minute call next week be useful? You can pick a slot here: ${input.sender.calendlyUrl}`
          : 'Would a 20-minute call next week be useful?',
        `Best regards,\n${input.sender.name}\n${input.sender.title}, ${input.sender.orgName}`,
      ].join('\n\n'),
    };
  },
};

export const whatsappDraftSchema = z.object({ body: z.string().min(20).max(1000) });
export type WhatsappDraft = z.infer<typeof whatsappDraftSchema>;

export const whatsappDraftPrompt: PromptDefinition<OutreachInput, WhatsappDraft> = {
  id: 'outreach.whatsapp',
  version: 'v1',
  schema: whatsappDraftSchema,
  temperature: 0.5,
  maxTokens: 400,
  build(input) {
    return {
      system: [
        `You write short WhatsApp intro messages for B2B sales. Tone: ${input.tone}. 40-70 words, no emojis overload (max 1), introduce the sender, reference the news, ask a single yes/no question.`,
        ...RULES,
        'JSON shape: {"body": string}',
      ].join('\n'),
      user: context(input),
    };
  },
  mock(input) {
    const ev = input.lead.evidence[0];
    return {
      body: `Hi ${firstName(input.lead.contactName) ?? 'there'}, this is ${input.sender.name} from ${input.sender.orgName}. ${ev ? `Saw the update on ${firstSentence(ev.title, 120).replace(/\.$/, '')}. ` : ''}We help teams like yours with ${input.org.products[0]?.name ?? 'this'}. Open to a quick 15-min call this week?`,
    };
  },
};

export const callScriptSchema = z.object({
  body: z.string().min(20).max(3000),
  talkingPoints: z.array(z.string()).min(2).max(6),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })).min(1).max(4),
});
export type CallScript = z.infer<typeof callScriptSchema>;

export const callScriptPrompt: PromptDefinition<OutreachInput, CallScript> = {
  id: 'outreach.call-script',
  version: 'v1',
  schema: callScriptSchema,
  temperature: 0.4,
  maxTokens: 1200,
  build(input) {
    return {
      system: [
        'You prepare SDRs for a cold call. Produce: an opener (body, 3-5 sentences incl. permission-based opening and reason for calling), 3-5 talking points, and 2-3 likely objections with concise responses.',
        ...RULES,
        'JSON shape: {"body": string, "talkingPoints": string[], "objections": [{"objection": string, "response": string}]}',
      ].join('\n'),
      user: context(input),
    };
  },
  mock(input) {
    const ev = input.lead.evidence[0];
    return {
      body: `Hi ${firstName(input.lead.contactName) ?? 'there'}, this is ${input.sender.name} from ${input.sender.orgName} — did I catch you at a bad time? ${ev ? `I'm calling because of the news about ${firstSentence(ev.title, 140).replace(/\.$/, '')}. ` : ''}We work with ${input.lead.contactTitle ?? 'leaders'} on ${input.lead.painPoints[0]?.toLowerCase() ?? 'cost and reliability'}, and I wanted to see whether it's worth a short conversation.`,
      talkingPoints: [
        ...(ev ? [`Reference: ${ev.title}`] : []),
        ...input.org.valueProps.slice(0, 3),
        `Offer a 20-minute discovery call${input.sender.calendlyUrl ? ` (${input.sender.calendlyUrl})` : ''}`,
      ].slice(0, 5),
      objections: [
        { objection: 'We already have a vendor.', response: 'Understood — most of our customers did too. We usually start as a second source on one line to benchmark cost and quality.' },
        { objection: 'Send me an email.', response: 'Happy to. So I send something relevant — is the priority cost, lead-time or quality right now?' },
      ],
    };
  },
};
