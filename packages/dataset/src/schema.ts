import { INDUSTRIES, ORG_ROLES, VISIBILITIES } from '@selloeasy/shared';
import { z } from 'zod';

// Controlled vocabulary lives in @selloeasy/shared (also used by the platform data template, plan2 §4).
import { MARKET_TAGS, type MarketTag } from '@selloeasy/shared';
export { MARKET_TAGS, type MarketTag };

const tag = z.enum(MARKET_TAGS);
const key = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case key');
const exampleDomain = z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*\.example$/, 'domain must end with .example');
const exampleEmail = z.string().regex(/^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.example$/, 'email must be @*.example');

export const signalTemplateFixture = z.object({
  industry: z.enum(INDUSTRIES),
  key: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(3),
  description: z.string().min(20),
  matchInstructions: z.string().min(40),
  defaultKeywords: z.array(z.string().min(2)).min(3).max(15),
  defaultWeight: z.number().min(0.5).max(2),
});

export const orgFixture = z.object({
  slug: key,
  name: z.string().min(3),
  industry: z.enum(INDUSTRIES),
  websiteUrl: z.string().regex(/^https:\/\/[a-z0-9.-]+\.example\/?$/),
  hq: z.string(),
  regions: z.array(z.string()).min(1),
  companySize: z.string(),
  description: z.string().min(100),
  profile: z.object({
    summary: z.string().min(200),
    valueProps: z.array(z.string()).min(3).max(8),
    differentiators: z.array(z.string()).min(3).max(8),
    targetIndustries: z.array(tag).min(2).max(8),
    geographies: z.array(z.string()).min(1),
    personas: z
      .array(z.object({ title: z.string(), goals: z.array(z.string()).min(1), painPoints: z.array(z.string()).min(1) }))
      .min(2)
      .max(6),
  }),
  products: z
    .array(
      z.object({
        name: z.string(),
        category: z.string(),
        description: z.string().min(60),
        targetSegments: z.array(z.string()).min(1),
        priceNotes: z.string(),
        visibility: z.enum(VISIBILITIES),
      }),
    )
    .min(3)
    .max(8),
  plans: z
    .array(
      z.object({
        name: z.string(),
        pricing: z.string(),
        features: z.array(z.string()).min(2),
        visibility: z.enum(VISIBILITIES),
      }),
    )
    .min(1)
    .max(4),
  policies: z
    .array(
      z.object({
        title: z.string(),
        type: z.string(),
        body: z.string().min(150),
        visibility: z.enum(VISIBILITIES),
      }),
    )
    .min(2)
    .max(5),
  icps: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().min(40),
        criteria: z.object({
          industries: z.array(tag).min(1),
          companySize: z.object({ minEmployees: z.number().int().optional(), maxEmployees: z.number().int().optional() }),
          revenueBand: z.string().optional(),
          geographies: z.array(z.string()).min(1),
          personas: z.array(z.string()).min(1),
          painPoints: z.array(z.string()).min(1),
          keywords: z.array(z.string()).min(3),
        }),
      }),
    )
    .min(2)
    .max(3),
  customSignals: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().min(20),
        matchInstructions: z.string().min(40),
        keywords: z.array(z.string()).min(3),
        negativeKeywords: z.array(z.string()),
        weight: z.number().min(0.5).max(2),
        icpIndex: z.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(2),
  users: z
    .array(z.object({ name: z.string(), email: z.string().regex(/^[a-z0-9.]+@[a-z0-9-]+\.local$/), role: z.enum(ORG_ROLES) }))
    .min(2),
  documents: z.array(
    z.object({ file: z.string().regex(/^[a-z0-9-]+\.md$/), title: z.string(), visibility: z.enum(VISIBILITIES), asPdf: z.boolean() }),
  ),
});

export const companyFixture = z.object({
  key,
  name: z.string().min(2),
  domain: exampleDomain,
  industry: tag,
  hqCountry: z.string().length(2),
  sizeBand: z.enum(['1-50', '51-200', '201-1000', '1001-5000', '5001-10000', '10000+']),
  employees: z.number().int().positive(),
  description: z.string().min(40),
  contacts: z
    .array(
      z.object({
        name: z.string(),
        title: z.string(),
        persona: z.string(),
        seniority: z.enum(['C-Level', 'VP', 'Director', 'Manager', 'Individual Contributor']),
        email: exampleEmail,
        phone: z.string().regex(/^\+\d{6,15}$/),
        whatsapp: z.string().regex(/^\+\d{6,15}$/),
        linkedinUrl: z.string().regex(/^https:\/\/linkedin\.example\/in\/[a-z0-9-]+$/),
      }),
    )
    .min(1)
    .max(3),
});

export const eventFixture = z.object({
  externalId: z.string().regex(/^[a-z]{3}-\d{3}$/),
  source: z.string(),
  url: z.string().regex(/^https:\/\/[a-z0-9.-]+\.example\/.+/),
  title: z.string().min(20).max(160),
  body: z.string().min(300).max(1600),
  publishedDaysAgo: z.number().int().min(0).max(200),
  industryTags: z.array(tag).min(1).max(4),
  companies: z.array(z.object({ key, role: z.enum(['subject', 'mentioned']) })).min(1).max(4),
  region: z.string(),
  amount: z.number().nullable(),
  currency: z.enum(['INR', 'USD', 'EUR']).nullable(),
  kind: z.enum(['strong', 'weak', 'negative', 'cross']),
});

export const goldFixture = z.object({
  eventExternalId: z.string(),
  orgSlug: key,
  expectedSignals: z.array(z.string()),
});

export type SignalTemplateFixture = z.infer<typeof signalTemplateFixture>;
export type OrgFixture = z.infer<typeof orgFixture>;
export type CompanyFixture = z.infer<typeof companyFixture>;
export type EventFixture = z.infer<typeof eventFixture>;
export type GoldFixture = z.infer<typeof goldFixture>;
