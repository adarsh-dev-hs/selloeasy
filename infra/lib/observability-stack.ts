import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { InfraConfig } from './config';
import type { AppStack } from './app-stack';
import type { DataStack } from './data-stack';

export interface ObservabilityStackProps extends cdk.StackProps {
  cfg: InfraConfig;
  app: AppStack;
  data: DataStack;
}

/**
 * Observability — SNS alarm topic (+ ALARM_EMAIL), CloudWatch alarms and a dashboard (plan §23.1, §26).
 * Log groups (30-day retention) are created next to the services in App / AppBase.
 *
 * Follow-ups documented in the runbook: BullMQ queue-depth + job-failure alarms need a custom metric published by the
 * worker (not emitted yet); worker autoscaling on queue depth will use the same metric.
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { cfg, app, data } = props;
    const period = cdk.Duration.minutes(5);

    const topicKey = new kms.Key(this, 'AlarmTopicKey', {
      enableKeyRotation: true,
      alias: `alias/${cfg.prefix}-alarms`,
    });
    topicKey.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        resources: ['*'],
      }),
    );
    const topic = new sns.Topic(this, 'Alarms', {
      topicName: `${cfg.prefix}-alarms`,
      masterKey: topicKey,
      enforceSSL: true,
    });
    if (cfg.ALARM_EMAIL) topic.addSubscription(new subs.EmailSubscription(cfg.ALARM_EMAIL));
    const action = new cwActions.SnsAction(topic);

    const alarm = (
      id: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      description: string,
      extra: Partial<cloudwatch.CreateAlarmOptions> = {},
    ) => {
      const a = new cloudwatch.Alarm(this, id, {
        metric,
        alarmName: `${cfg.prefix}-${id}`,
        alarmDescription: description,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        ...extra,
      });
      a.addAlarmAction(action);
      a.addOkAction(action);
      return a;
    };

    const elb5xx = app.alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
      period,
      statistic: 'Sum',
    });
    const target5xx = app.apiTargetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
      period,
      statistic: 'Sum',
    });
    const apiP95 = app.apiTargetGroup.metrics.targetResponseTime({ period, statistic: 'p95' });
    const unhealthyApi = app.apiTargetGroup.metrics.unhealthyHostCount({
      period: cdk.Duration.minutes(1),
      statistic: 'Maximum',
    });
    const rdsCpu = data.db.metricCPUUtilization({ period, statistic: 'Average' });
    const rdsFreeStorage = data.db.metricFreeStorageSpace({ period, statistic: 'Minimum' });
    const redisMemory = new cloudwatch.Metric({
      namespace: 'AWS/ElastiCache',
      metricName: 'DatabaseMemoryUsagePercentage',
      dimensionsMap: { CacheClusterId: `${cfg.prefix}-001` },
      period,
      statistic: 'Maximum',
    });
    const serviceCpu = {
      api: app.apiService.metricCpuUtilization({ period }),
      worker: app.workerService.metricCpuUtilization({ period }),
      web: app.webService.metricCpuUtilization({ period }),
    };

    alarm('alb-5xx', elb5xx, 10, 'ALB-generated 5xx responses (no healthy target / timeouts) >= 10 in 5 min');
    alarm('api-5xx', target5xx, 10, 'api returned >= 10 5xx responses in 5 min');
    alarm('api-p95-latency', apiP95, 2, 'api p95 latency >= 2s for 15 min', { evaluationPeriods: 3 });
    alarm('api-unhealthy-targets', unhealthyApi, 1, 'At least one api target unhealthy for 3 min', {
      evaluationPeriods: 3,
    });
    alarm('rds-cpu', rdsCpu, 80, 'RDS CPU >= 80% for 15 min', { evaluationPeriods: 3 });
    alarm('rds-free-storage', rdsFreeStorage, 2 * 1024 ** 3, 'RDS free storage <= 2 GiB', {
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    alarm('redis-memory', redisMemory, 80, 'Redis memory >= 80% (noeviction: BullMQ writes fail when full)');
    for (const [name, metric] of Object.entries(serviceCpu)) {
      alarm(`ecs-${name}-cpu`, metric, 85, `ECS ${name} CPU >= 85% for 15 min`, { evaluationPeriods: 3 });
    }

    new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${cfg.prefix}`,
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Requests',
            left: [app.alb.metrics.requestCount({ period })],
            width: 8,
          }),
          new cloudwatch.GraphWidget({ title: '5xx', left: [elb5xx, target5xx], width: 8 }),
          new cloudwatch.GraphWidget({ title: 'api latency p95 (s)', left: [apiP95], width: 8 }),
        ],
        [
          new cloudwatch.GraphWidget({ title: 'ECS CPU %', left: Object.values(serviceCpu), width: 12 }),
          new cloudwatch.GraphWidget({
            title: 'ECS memory %',
            left: [
              app.apiService.metricMemoryUtilization({ period }),
              app.workerService.metricMemoryUtilization({ period }),
              app.webService.metricMemoryUtilization({ period }),
            ],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({ title: 'RDS CPU %', left: [rdsCpu], width: 8 }),
          new cloudwatch.GraphWidget({ title: 'RDS free storage', left: [rdsFreeStorage], width: 8 }),
          new cloudwatch.GraphWidget({ title: 'Redis memory %', left: [redisMemory], width: 8 }),
        ],
      ],
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: topic.topicArn });
  }
}
