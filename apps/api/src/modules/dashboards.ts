import { activities, and, eq, getDb, gte, leads, leadSignals, lte, memberships, signalMatches, signals, sql, users, type SQL } from '@selloeasy/db';
import {
  can,
  dateRangeQuerySchema,
  LEAD_STAGES,
  OUTBOUND_ACTIVITY_TYPES,
  type ChannelStats,
  type OrgDashboard,
  type SignalPerformance,
  type TeamMemberStats,
  type TimeseriesPoint,
} from '@selloeasy/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { rate } from '../lib/stats';
import { visibilityFilter } from '../lib/leads';
import { authOf, requireOrg } from '../plugins/auth';

const ENGAGED_PLUS = sql.raw(`('ENGAGED','MEETING_SCHEDULED','QUALIFIED','PROPOSAL','WON')`);
const MEETING_PLUS = sql.raw(`('MEETING_SCHEDULED','QUALIFIED','PROPOSAL','WON')`);

/**
 * Org dashboard (plan §14.1). Admins/managers/viewers see the whole org; SDRs see "My stats"
 * (their own leads). Results are cached in Redis for 60s per (org, scope, range).
 */
export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/dashboard', { schema: { tags: ['dashboards'], summary: 'Org (or my) dashboard', querystring: dateRangeQuerySchema }, preHandler: requireOrg('dashboard:self:read') }, async (req): Promise<OrgDashboard & { scope: 'org' | 'me' }> => {
    const a = authOf(req);
    const orgId = a.orgId!;
    const scope = can(a.role, 'dashboard:org:read') ? 'org' : 'me';
    const { from, to } = req.query;
    const cacheKey = `dash:${orgId}:${scope === 'me' ? a.userId : 'org'}:${from ?? ''}:${to ?? ''}`;
    const cached = await app.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const db = getDb();
    const vis = await visibilityFilter(a);
    const leadScope: SQL = and(
      eq(leads.orgId, orgId),
      vis,
      scope === 'me' ? eq(leads.ownerUserId, a.userId) : undefined,
      from ? gte(leads.firstSignalAt, new Date(from)) : undefined,
      to ? lte(leads.firstSignalAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
    )!;
    const actRange: SQL = and(
      eq(activities.orgId, orgId),
      from ? gte(activities.occurredAt, new Date(from)) : undefined,
      to ? lte(activities.occurredAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
      scope === 'me' ? eq(activities.actorUserId, a.userId) : undefined,
    )!;

    const [s] = await db
      .select({
        leads: sql<number>`count(*)::int`,
        approached: sql<number>`count(*) filter (where ${leads.stage} <> 'NEW')::int`,
        engaged: sql<number>`count(*) filter (where ${leads.stage} in ${ENGAGED_PLUS})::int`,
        meetings: sql<number>`count(*) filter (where ${leads.stage} in ${MEETING_PLUS})::int`,
        converted: sql<number>`count(*) filter (where ${leads.stage} = 'WON')::int`,
        lost: sql<number>`count(*) filter (where ${leads.stage} = 'LOST')::int`,
        hot: sql<number>`count(*) filter (where ${leads.scoreBand} = 'HOT')::int`,
        warm: sql<number>`count(*) filter (where ${leads.scoreBand} = 'WARM')::int`,
        cold: sql<number>`count(*) filter (where ${leads.scoreBand} = 'COLD')::int`,
        won: sql<number>`coalesce(sum(${leads.wonValue}) filter (where ${leads.stage} = 'WON'), 0)::float`,
        avgHours: sql<number | null>`avg(extract(epoch from (${leads.firstTouchAt} - greatest(${leads.firstSignalAt}, ${leads.createdAt} - interval '400 days'))) / 3600) filter (where ${leads.firstTouchAt} is not null and ${leads.firstTouchAt} >= ${leads.firstSignalAt})::float`,
      })
      .from(leads)
      .where(leadScope);

    const stageRows = await db.select({ stage: leads.stage, n: sql<number>`count(*)::int` }).from(leads).where(leadScope).groupBy(leads.stage);
    const stageMap = new Map(stageRows.map((r) => [r.stage, r.n]));

    const weekly = await db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${leads.firstSignalAt}), 'YYYY-MM-DD')`,
        band: leads.scoreBand,
        n: sql<number>`count(*)::int`,
      })
      .from(leads)
      .where(and(leadScope, gte(leads.firstSignalAt, sql`now() - interval '26 weeks'`)))
      .groupBy(sql`1`, leads.scoreBand)
      .orderBy(sql`1`);
    const tsMap = new Map<string, TimeseriesPoint>();
    for (const r of weekly) {
      const p = tsMap.get(r.week) ?? { week: r.week, HOT: 0, WARM: 0, COLD: 0 };
      p[r.band] = r.n;
      tsMap.set(r.week, p);
    }

    const bySignal: SignalPerformance[] = await db
      .select({
        signalId: signals.id,
        signalName: signals.name,
        leads: sql<number>`count(distinct ${leads.id})::int`,
        approached: sql<number>`count(distinct ${leads.id}) filter (where ${leads.stage} <> 'NEW')::int`,
        converted: sql<number>`count(distinct ${leads.id}) filter (where ${leads.stage} = 'WON')::int`,
      })
      .from(leadSignals)
      .innerJoin(leads, eq(leads.id, leadSignals.leadId))
      .innerJoin(signalMatches, eq(signalMatches.id, leadSignals.signalMatchId))
      .innerJoin(signals, eq(signals.id, signalMatches.signalId))
      .where(leadScope)
      .groupBy(signals.id, signals.name)
      .orderBy(sql`3 desc`);

    const outbound = sql.raw(`(${OUTBOUND_ACTIVITY_TYPES.map((t) => `'${t}'`).join(',')})`);
    const teamRows = await db
      .select({ userId: users.id, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), eq(memberships.status, 'ACTIVE'), scope === 'me' ? eq(users.id, a.userId) : undefined));
    const owned = await db
      .select({ ownerId: leads.ownerUserId, owned: sql<number>`count(*)::int`, won: sql<number>`count(*) filter (where ${leads.stage} = 'WON')::int` })
      .from(leads)
      .where(leadScope)
      .groupBy(leads.ownerUserId);
    const touches = await db
      .select({
        actorId: activities.actorUserId,
        touches: sql<number>`count(*) filter (where ${activities.type} in ${outbound})::int`,
        meetings: sql<number>`count(*) filter (where ${activities.type} = 'MEETING')::int`,
      })
      .from(activities)
      .where(actRange)
      .groupBy(activities.actorUserId);
    const ownedMap = new Map(owned.map((r) => [r.ownerId, r]));
    const touchMap = new Map(touches.map((r) => [r.actorId, r]));
    const team: TeamMemberStats[] = teamRows
      .map((m) => ({
        userId: m.userId,
        name: m.name,
        role: m.role,
        owned: ownedMap.get(m.userId)?.owned ?? 0,
        touches: touchMap.get(m.userId)?.touches ?? 0,
        meetings: touchMap.get(m.userId)?.meetings ?? 0,
        won: ownedMap.get(m.userId)?.won ?? 0,
      }))
      .sort((x, y) => y.won - x.won || y.touches - x.touches);

    const channels: ChannelStats[] = await db
      .select({
        channel: sql<string>`${activities.type}::text`,
        touches: sql<number>`count(*)::int`,
        leadsTouched: sql<number>`count(distinct ${activities.leadId})::int`,
        engagedAfter: sql<number>`count(distinct ${activities.leadId}) filter (where ${leads.stage} in ${ENGAGED_PLUS})::int`,
      })
      .from(activities)
      .innerJoin(leads, eq(leads.id, activities.leadId))
      .where(and(actRange, sql`${activities.type} in ${outbound}`, vis))
      .groupBy(activities.type)
      .orderBy(sql`2 desc`);

    const result: OrgDashboard & { scope: 'org' | 'me' } = {
      scope,
      summary: {
        leads: s!.leads,
        approached: s!.approached,
        engaged: s!.engaged,
        meetings: s!.meetings,
        converted: s!.converted,
        lost: s!.lost,
        conversionRate: rate(s!.converted, s!.approached),
        avgHoursToFirstTouch: s!.avgHours === null ? null : Math.round(s!.avgHours),
        hot: s!.hot,
        warm: s!.warm,
        cold: s!.cold,
        pipelineValueWon: Math.round(s!.won),
      },
      funnel: LEAD_STAGES.map((stage) => ({ stage, count: stageMap.get(stage) ?? 0 })),
      timeseries: [...tsMap.values()],
      bySignal,
      team,
      channels,
    };
    await app.redis.set(cacheKey, JSON.stringify(result), 'EX', 60).catch(() => undefined);
    return result;
  });
};
