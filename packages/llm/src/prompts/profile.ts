import { icpCriteriaSchema, INDUSTRY_LABELS, orgProfileSchema, type Industry, type OrgProfileContent } from '@selloeasy/shared';
import { z } from 'zod';
import type { PromptDefinition } from '../types';
import { bullets, doc, firstSentence, JSON_RULE, UNTRUSTED_DATA_RULE } from './_util';

export interface ProfileInput {
  org: { name: string; industry: Industry; websiteUrl: string | null; description: string | null; hq: string | null; regions: string[] };
  products: { name: string; category: string | null; description: string | null; targetSegments: string[] }[];
  policies: { title: string; body: string }[];
  documents: { title: string; text: string }[];
  /** Allowed vocabulary for `targetIndustries` so profiles line up with event tags. */
  marketTags: readonly string[];
}

/** Sensible defaults per seller industry — used by the mock and as hints. */
const INDUSTRY_TARGETS: Record<Industry, string[]> = {
  AUTOMOTIVE: ['Automotive', 'Electric Vehicles', 'Two-Wheelers', 'Commercial Vehicles', 'Fleet & Mobility'],
  HEALTHCARE: ['Hospitals', 'Diagnostics', 'Healthcare Services', 'Government'],
  SEMICONDUCTORS: ['Semiconductors', 'Electronics Manufacturing', 'Electric Vehicles', 'Consumer Electronics', 'Telecom'],
  RENEWABLE_ENERGY: ['Renewable Energy', 'Utilities', 'Data Centers', 'Manufacturing', 'Real Estate'],
  LOGISTICS: ['E-commerce', 'Retail', 'FMCG', 'Logistics', 'Ports & Shipping', 'Cold Chain'],
};
const INDUSTRY_PERSONAS: Record<Industry, string[]> = {
  AUTOMOTIVE: ['VP Procurement', 'Head of Vehicle Platform', 'Fleet Operations Head'],
  HEALTHCARE: ['Chief Medical Officer', 'Head of Laboratory Services', 'VP Procurement'],
  SEMICONDUCTORS: ['VP Fab Operations', 'Head of Power Electronics', 'Director – Strategic Sourcing'],
  RENEWABLE_ENERGY: ['VP Projects', 'Head of Sustainability', 'Chief Procurement Officer'],
  LOGISTICS: ['VP Supply Chain', 'Head of Warehousing', 'Chief Operating Officer'],
};
export const defaultTargets = (i: Industry) => INDUSTRY_TARGETS[i];
export const defaultPersonas = (i: Industry) => INDUSTRY_PERSONAS[i];

export const profileGeneratePrompt: PromptDefinition<ProfileInput, OrgProfileContent> = {
  id: 'org-profile.generate',
  version: 'v1',
  schema: orgProfileSchema,
  maxTokens: 2500,
  build(input) {
    const system = [
      'You are a B2B product-marketing strategist. Build a concise, factual knowledge profile of a company from its own materials.',
      'Only use facts present in the materials; do not invent certifications, customers or numbers.',
      `targetIndustries MUST be chosen from this list: ${input.marketTags.join(', ')}.`,
      'personas are the buyer roles at TARGET customers (not the company\'s own staff).',
      UNTRUSTED_DATA_RULE,
      JSON_RULE,
      'JSON shape: {"summary": string (80-160 words), "valueProps": string[3-6], "differentiators": string[3-6], "targetIndustries": string[2-6], "geographies": string[], "personas": [{"title": string, "goals": string[], "painPoints": string[]}] (2-5)}',
    ].join('\n');
    const user = [
      `Company: ${input.org.name}`,
      `Industry: ${INDUSTRY_LABELS[input.org.industry]}`,
      `Website: ${input.org.websiteUrl ?? 'n/a'}`,
      `HQ: ${input.org.hq ?? 'n/a'}; Regions: ${input.org.regions.join(', ') || 'n/a'}`,
      input.org.description ? doc('About', input.org.description, 3000) : '',
      '## Products',
      bullets(input.products.map((p) => `${p.name} (${p.category ?? 'product'}): ${p.description ?? ''} — segments: ${p.targetSegments.join(', ')}`)),
      '## Policies',
      ...input.policies.slice(0, 5).map((p) => doc(p.title, p.body, 1500)),
      '## Documents & website',
      ...input.documents.slice(0, 12).map((d) => doc(d.title, d.text, 3500)),
    ]
      .filter(Boolean)
      .join('\n\n');
    return { system, user };
  },
  mock(input) {
    const products = input.products.slice(0, 5);
    const productNames = products.map((p) => p.name).join(', ');
    const industry = INDUSTRY_LABELS[input.org.industry].toLowerCase();
    return {
      summary:
        `${input.org.name} is a ${industry} company${input.org.hq ? ` headquartered in ${input.org.hq}` : ''}. ` +
        (input.org.description ? `${firstSentence(input.org.description, 400)} ` : '') +
        (productNames ? `Its portfolio includes ${productNames}. ` : '') +
        `It serves customers across ${(input.org.regions.length ? input.org.regions : ['India']).join(', ')}.`,
      valueProps: products.length
        ? products.slice(0, 4).map((p) => firstSentence(p.description, 160) || `${p.name} for ${p.targetSegments.join(', ')}`)
        : ['Reliable products backed by local service', 'Proven with enterprise customers', 'Competitive total cost of ownership'],
      differentiators: [
        'Local engineering and support team',
        'Faster delivery lead-times than imports',
        ...(input.policies.length ? [`Documented ${input.policies[0]!.title.toLowerCase()}`] : ['Transparent commercial terms']),
      ],
      targetIndustries: INDUSTRY_TARGETS[input.org.industry].filter((t) => input.marketTags.includes(t)).slice(0, 5),
      geographies: input.org.regions.length ? input.org.regions : ['India'],
      personas: INDUSTRY_PERSONAS[input.org.industry].map((title) => ({
        title,
        goals: ['Reduce total cost of ownership', 'De-risk supply'],
        painPoints: ['Long vendor lead-times', 'Quality inconsistency'],
      })),
    };
  },
};

export interface IcpSuggestInput {
  org: { name: string; industry: Industry };
  profile: OrgProfileContent;
  products: { name: string; description: string | null; targetSegments: string[] }[];
  marketTags: readonly string[];
}

export const icpSuggestSchema = z.object({
  icps: z
    .array(
      z.object({
        name: z.string().min(3).max(160),
        description: z.string().max(2000),
        criteria: icpCriteriaSchema,
      }),
    )
    .min(1)
    .max(4),
});
export type IcpSuggestOutput = z.infer<typeof icpSuggestSchema>;

export const icpSuggestPrompt: PromptDefinition<IcpSuggestInput, IcpSuggestOutput> = {
  id: 'icp.suggest',
  version: 'v1',
  schema: icpSuggestSchema,
  maxTokens: 2000,
  build(input) {
    const system = [
      'You are a B2B go-to-market strategist. Propose 2-4 distinct Ideal Customer Profiles (ICPs) for the seller.',
      'Each ICP must be specific enough to target: industries, company size, geographies, buyer personas, pain points and search keywords likely to appear in news about such buyers.',
      `criteria.industries MUST use values from: ${input.marketTags.join(', ')}.`,
      JSON_RULE,
      'JSON shape: {"icps":[{"name":string,"description":string,"criteria":{"industries":string[],"companySize":{"minEmployees"?:number,"maxEmployees"?:number},"revenueBand"?:string,"geographies":string[],"personas":string[],"painPoints":string[],"keywords":string[]}}]}',
    ].join('\n');
    const user = [
      `Seller: ${input.org.name} (${INDUSTRY_LABELS[input.org.industry]})`,
      `Summary: ${input.profile.summary}`,
      `Value props:\n${bullets(input.profile.valueProps)}`,
      `Target industries: ${input.profile.targetIndustries.join(', ')}`,
      `Geographies: ${input.profile.geographies.join(', ')}`,
      `Personas: ${input.profile.personas.map((p) => p.title).join(', ')}`,
      `Products:\n${bullets(input.products.map((p) => `${p.name}: ${p.description ?? ''} (${p.targetSegments.join(', ')})`))}`,
    ].join('\n\n');
    return { system, user };
  },
  mock(input) {
    const targets = (input.profile.targetIndustries.length ? input.profile.targetIndustries : defaultTargets(input.org.industry)).slice(0, 3);
    return {
      icps: targets.map((t, i) => ({
        name: `${t} buyers in ${input.profile.geographies[0] ?? 'India'}`,
        description: `Mid-to-large ${t.toLowerCase()} organisations likely to need ${input.products[i % Math.max(1, input.products.length)]?.name ?? 'our products'}.`,
        criteria: {
          industries: [t],
          companySize: { minEmployees: i === 0 ? 1000 : 200 },
          revenueBand: i === 0 ? '>$100M' : '$20M-$100M',
          geographies: input.profile.geographies.slice(0, 3),
          personas: input.profile.personas.slice(0, 3).map((p) => p.title),
          painPoints: input.profile.personas.flatMap((p) => p.painPoints).slice(0, 3),
          keywords: [t.toLowerCase(), 'expansion', 'investment', 'new plant', 'launch'],
        },
      })),
    };
  },
};
