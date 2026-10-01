import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { ecrRepositoryName, type InfraConfig } from './config';
import type { NetworkStack } from './network-stack';
import {
  backendEnvironment,
  backendSecrets,
  ENTRYPOINT,
  grantBackendAccess,
  type BackendRefs,
} from './runtime-env';
import { suppressBackendTaskFindings } from './nag';

export interface AppBaseStackProps extends cdk.StackProps {
  cfg: InfraConfig;
  network: NetworkStack;
  backend: Omit<BackendRefs, 'cfg'>;
}

/** Default command of the migrate task: apply migrations, then idempotent bootstrap seed (super admin + reference data). */
export const MIGRATE_COMMAND = ['sh', '-c', 'pnpm db:migrate && pnpm db:seed'];

/**
 * AppBase — the part of the "App" layer (plan §23.1) that must exist *before* services roll out:
 * the ECS cluster and the one-off `migrate` task definition (api image, `pnpm db:migrate`).
 *
 * `deploy.sh` deploys this stack, runs the migrate task with the new IMAGE_TAG and only then deploys the App stack
 * (services), so a release never serves traffic against an un-migrated schema.
 */
export class AppBaseStack extends cdk.Stack {
  readonly cluster: ecs.Cluster;
  readonly migrateTaskDefinition: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: AppBaseStackProps) {
    super(scope, id, props);
    const { cfg, network } = props;
    const refs: BackendRefs = { cfg, ...props.backend };

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: cfg.prefix,
      vpc: network.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const logGroup = new logs.LogGroup(this, 'MigrateLogs', {
      logGroupName: `/selloeasy/${cfg.DEPLOY_ENV}/migrate`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const td = new ecs.FargateTaskDefinition(this, 'MigrateTask', {
      family: `${cfg.prefix}-migrate`,
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const apiRepo = ecr.Repository.fromRepositoryName(this, 'ApiRepo', ecrRepositoryName(cfg, 'api'));
    td.addContainer('migrate', {
      image: ecs.ContainerImage.fromEcrRepository(apiRepo, cfg.IMAGE_TAG),
      essential: true,
      entryPoint: ENTRYPOINT,
      command: MIGRATE_COMMAND,
      environment: backendEnvironment(refs),
      secrets: backendSecrets(refs),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'migrate', logGroup }),
    });
    grantBackendAccess(this, td.taskRole, refs, { ses: false });
    this.migrateTaskDefinition = td;

    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, 'MigrateTaskDefinitionArn', { value: td.taskDefinitionArn });
    new cdk.CfnOutput(this, 'MigrateContainerName', { value: 'migrate' });
    new cdk.CfnOutput(this, 'MigrateLogGroup', { value: logGroup.logGroupName });

    suppressBackendTaskFindings(td);
  }
}
