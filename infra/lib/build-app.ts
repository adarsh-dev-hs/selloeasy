import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { AppBaseStack } from './app-base-stack';
import { AppStack } from './app-stack';
import { BootstrapStack } from './bootstrap-stack';
import { loadInfraConfig, stackName, type InfraConfig } from './config';
import { DataStack } from './data-stack';
import { EdgeCertStack, EdgeStack } from './edge-stack';
import { MailStack, sesConfigurationSetName } from './mail-stack';
import { suppressCdkInternals } from './nag';
import { NetworkStack } from './network-stack';
import { ObservabilityStack } from './observability-stack';
import { SecretsStack } from './secrets-stack';

/** CDK feature flags (kept here, not only in cdk.json, so `synth:check` — which bypasses the CLI — gets them too). */
const FEATURE_FLAGS = {
  '@aws-cdk/core:checkSecretUsage': true,
  '@aws-cdk/aws-iam:minimizePolicies': true,
  '@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy': true,
  '@aws-cdk/aws-ecs:reduceEc2FargateCloudWatchPermissions': true,
  '@aws-cdk/aws-ecs:disableEcsImdsBlocking': true,
  '@aws-cdk/aws-elasticloadbalancingV2:albDualstackWithoutPublicIpv4SecurityGroupRulesDefault': true,
  '@aws-cdk/aws-route53-targets:userPoolDomainNameMethodWithoutCustomResource': true,
  '@aws-cdk/core:target-partitions': ['aws'],
  '@aws-cdk/core:defaultCrossStackReferences': 'strong',
};

export interface BuiltApp {
  app: cdk.App;
  cfg: InfraConfig;
  stacks: cdk.Stack[];
}

/**
 * Builds the whole SelloEasy CDK app from a raw env map (process.env or a parsed env file).
 * Stack names are `<DEPLOY_ENV>-selloeasy-<name>` (plan §23.1).
 */
export function buildApp(raw: Record<string, string | undefined>, appProps: cdk.AppProps = {}): BuiltApp {
  const cfg = loadInfraConfig(raw);
  const app = new cdk.App({ ...appProps, context: { ...FEATURE_FLAGS, ...appProps.context } });
  const env = { account: cfg.AWS_ACCOUNT_ID, region: cfg.AWS_REGION };
  const tags = { Project: 'selloeasy', Environment: cfg.DEPLOY_ENV, ManagedBy: 'cdk' };
  const common = (name: string, description: string) => ({
    stackName: stackName(cfg, name),
    description: `SelloEasy ${cfg.DEPLOY_ENV} — ${description}`,
    tags,
    terminationProtection: cfg.isProduction,
  });

  const bootstrap = new BootstrapStack(app, stackName(cfg, 'bootstrap'), {
    ...common('bootstrap', 'ECR repositories and GitHub OIDC deploy role'),
    env,
    cfg,
  });
  const network = new NetworkStack(app, stackName(cfg, 'network'), {
    ...common('network', 'VPC, subnets, NAT, VPC endpoints, task security groups'),
    env,
    cfg,
  });
  const secrets = new SecretsStack(app, stackName(cfg, 'secrets'), {
    ...common('secrets', 'Secrets Manager app secret'),
    env,
    cfg,
  });
  const data = new DataStack(app, stackName(cfg, 'data'), {
    ...common('data', 'RDS Postgres, ElastiCache Redis, S3 uploads'),
    env,
    cfg,
    network,
  });
  const mail = new MailStack(app, stackName(cfg, 'mail'), {
    ...common('mail', 'SES domain identity, DKIM, configuration set'),
    env: { account: cfg.AWS_ACCOUNT_ID, region: cfg.SES_REGION },
    cfg,
  });

  const backend = {
    dbHost: data.db.dbInstanceEndpointAddress,
    dbPort: data.db.dbInstanceEndpointPort,
    dbSecret: data.dbSecret,
    redisHost: data.redisHost,
    redisPort: data.redisPort,
    redisAuthSecret: data.redisAuthSecret,
    appSecret: secrets.appSecret,
    uploadsBucket: data.uploadsBucket,
    sesConfigurationSetName: sesConfigurationSetName(cfg),
  };

  const appBase = new AppBaseStack(app, stackName(cfg, 'appbase'), {
    ...common('appbase', 'ECS cluster and one-off migrate task definition'),
    env,
    cfg,
    network,
    backend,
  });
  appBase.addStackDependency(bootstrap, 'images are pulled from the Bootstrap ECR repositories');

  const appStack = new AppStack(app, stackName(cfg, 'app'), {
    ...common('app', 'ALB and Fargate services api / worker / web'),
    env,
    cfg,
    network,
    cluster: appBase.cluster,
    logsBucket: data.logsBucket,
    backend,
  });
  appStack.addStackDependency(secrets, 'ALB listener rules resolve ORIGIN_VERIFY_TOKEN from the app secret');
  appStack.addStackDependency(mail, 'services send mail through the SES configuration set');

  let edgeCert: EdgeCertStack | undefined;
  if (!cfg.ACM_CERTIFICATE_ARN) {
    edgeCert = new EdgeCertStack(app, stackName(cfg, 'edge-cert'), {
      ...common('edge-cert', 'CloudFront viewer certificate (us-east-1)'),
      env: { account: cfg.AWS_ACCOUNT_ID, region: 'us-east-1' },
      crossRegionReferences: true,
      cfg,
    });
  }
  const edge = new EdgeStack(app, stackName(cfg, 'edge'), {
    ...common('edge', 'CloudFront distribution and Route53 alias'),
    env,
    crossRegionReferences: !!edgeCert,
    cfg,
    certificate: edgeCert?.certificate,
  });
  edge.addStackDependency(appStack, 'CloudFront origin origin.<DOMAIN_NAME> is created with the ALB');
  edge.addStackDependency(secrets, 'origin header resolves ORIGIN_VERIFY_TOKEN from the app secret');

  const observability = new ObservabilityStack(app, stackName(cfg, 'observability'), {
    ...common('observability', 'Alarms, SNS topic, dashboard'),
    env,
    cfg,
    app: appStack,
    data,
  });

  const stacks: cdk.Stack[] = [
    bootstrap,
    network,
    secrets,
    data,
    mail,
    appBase,
    appStack,
    edge,
    observability,
  ];
  if (edgeCert) stacks.push(edgeCert);

  for (const stack of stacks) suppressCdkInternals(stack);
  if (cfg.VPC_ID) {
    NagSuppressions.addStackSuppressions(network, [
      {
        id: 'CdkNagValidationFailure',
        reason: 'Imported VPC (VPC_ID) resolves at deploy time; rules cannot evaluate lookup tokens.',
      },
    ]);
  }
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

  return { app, cfg, stacks };
}
