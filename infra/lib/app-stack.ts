import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';
import { ecrRepositoryName, type EcrService, type InfraConfig } from './config';
import type { NetworkStack } from './network-stack';
import { ORIGIN_VERIFY_KEY } from './secrets-stack';
import {
  backendEnvironment,
  backendSecrets,
  ENTRYPOINT,
  grantBackendAccess,
  type BackendRefs,
} from './runtime-env';
import { suppressBackendTaskFindings } from './nag';

export interface AppStackProps extends cdk.StackProps {
  cfg: InfraConfig;
  network: NetworkStack;
  cluster: ecs.ICluster;
  logsBucket: s3.IBucket;
  backend: Omit<BackendRefs, 'cfg'>;
}

export const ORIGIN_VERIFY_HEADER = 'X-Origin-Verify';

/**
 * App — ALB + Fargate services api / worker / web with autoscaling (plan §23.1).
 *
 * Routing: CloudFront → https://origin.<DOMAIN_NAME> (this ALB). The HTTPS listener only forwards requests that carry
 * the secret `X-Origin-Verify` header CloudFront adds (value = ORIGIN_VERIFY_TOKEN in the app secret, resolved by
 * CloudFormation dynamic reference); `/api/*` → api, everything else (incl. `/docs-search`) → web; default → 403.
 */
export class AppStack extends cdk.Stack {
  readonly alb: elbv2.ApplicationLoadBalancer;
  readonly apiTargetGroup: elbv2.ApplicationTargetGroup;
  readonly webTargetGroup: elbv2.ApplicationTargetGroup;
  readonly apiService: ecs.FargateService;
  readonly workerService: ecs.FargateService;
  readonly webService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { cfg, network, cluster } = props;
    const refs: BackendRefs = { cfg, ...props.backend };
    const vpc = network.vpc;

    const image = (service: EcrService) =>
      ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(this, `Repo-${service}`, ecrRepositoryName(cfg, service)),
        cfg.IMAGE_TAG,
      );
    const logGroup = (service: string) =>
      new logs.LogGroup(this, `Logs-${service}`, {
        logGroupName: `/selloeasy/${cfg.DEPLOY_ENV}/${service}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    const taskDef = (service: string, cpu: number, memoryLimitMiB: number) =>
      new ecs.FargateTaskDefinition(this, `${service}Task`, {
        family: `${cfg.prefix}-${service}`,
        cpu,
        memoryLimitMiB,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
    const serviceDefaults = {
      cluster,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      enableECSManagedTags: true,
    } as const;

    // ── api ────────────────────────────────────────────────────────────────────────────────
    const apiTd = taskDef('api', cfg.ECS_API_CPU, cfg.ECS_API_MEMORY);
    apiTd.addContainer('api', {
      image: image('api'),
      entryPoint: ENTRYPOINT,
      command: ['pnpm', '--filter', '@selloeasy/api', 'start'],
      environment: backendEnvironment(refs),
      secrets: backendSecrets(refs),
      portMappings: [{ containerPort: 4000, name: 'api' }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup: logGroup('api') }),
      stopTimeout: cdk.Duration.seconds(30),
      healthCheck: {
        command: [
          'CMD-SHELL',
          `node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
        ],
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });
    grantBackendAccess(this, apiTd.taskRole, refs, { ses: true });
    suppressBackendTaskFindings(apiTd);
    this.apiService = new ecs.FargateService(this, 'ApiService', {
      ...serviceDefaults,
      serviceName: 'api',
      taskDefinition: apiTd,
      desiredCount: cfg.ECS_API_DESIRED_COUNT,
      securityGroups: [network.apiSg],
      healthCheckGracePeriod: cdk.Duration.seconds(90),
    });

    // ── worker ─────────────────────────────────────────────────────────────────────────────
    const workerTd = taskDef('worker', cfg.ECS_WORKER_CPU, cfg.ECS_WORKER_MEMORY);
    workerTd.addContainer('worker', {
      image: image('worker'),
      entryPoint: ENTRYPOINT,
      command: ['pnpm', '--filter', '@selloeasy/worker', 'start'],
      environment: backendEnvironment(refs),
      secrets: backendSecrets(refs),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'worker', logGroup: logGroup('worker') }),
      stopTimeout: cdk.Duration.seconds(120), // BullMQ worker.close() finishes in-flight jobs
    });
    grantBackendAccess(this, workerTd.taskRole, refs, { ses: true });
    suppressBackendTaskFindings(workerTd);
    this.workerService = new ecs.FargateService(this, 'WorkerService', {
      ...serviceDefaults,
      serviceName: 'worker',
      taskDefinition: workerTd,
      desiredCount: cfg.ECS_WORKER_DESIRED_COUNT,
      securityGroups: [network.workerSg],
    });

    // ── web (Next.js standalone) ───────────────────────────────────────────────────────────
    const webTd = taskDef('web', cfg.ECS_WEB_CPU, cfg.ECS_WEB_MEMORY);
    webTd.addContainer('web', {
      image: image('web'),
      environment: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
        // Only used by the local /api proxy route; in AWS the ALB routes /api/* straight to the api service.
        API_INTERNAL_URL: `https://${cfg.DOMAIN_NAME}`,
      },
      portMappings: [{ containerPort: 3000, name: 'web' }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup: logGroup('web') }),
      stopTimeout: cdk.Duration.seconds(30),
    });
    NagSuppressions.addResourceSuppressions(
      webTd,
      [
        {
          id: 'AwsSolutions-ECS2',
          reason: 'Web container env holds only non-secret settings (port, hostname, public URL).',
        },
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'ECS task execution role: ecr:GetAuthorizationToken is not resource-scopable (CDK generated).',
          appliesTo: ['Resource::*'],
        },
      ],
      true,
    );
    this.webService = new ecs.FargateService(this, 'WebService', {
      ...serviceDefaults,
      serviceName: 'web',
      taskDefinition: webTd,
      desiredCount: cfg.ECS_WEB_DESIRED_COUNT,
      securityGroups: [network.webSg],
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    // ── Autoscaling (api + worker on CPU; worker queue-depth scaling is a documented follow-up) ─────
    const apiScaling = this.apiService.autoScaleTaskCount({
      minCapacity: cfg.ECS_API_DESIRED_COUNT,
      maxCapacity: Math.max(cfg.ECS_API_DESIRED_COUNT * 4, 4),
    });
    apiScaling.scaleOnCpuUtilization('ApiCpu', {
      targetUtilizationPercent: 60,
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
    const workerScaling = this.workerService.autoScaleTaskCount({
      minCapacity: cfg.ECS_WORKER_DESIRED_COUNT,
      maxCapacity: Math.max(cfg.ECS_WORKER_DESIRED_COUNT * 4, 4),
    });
    workerScaling.scaleOnCpuUtilization('WorkerCpu', {
      targetUtilizationPercent: 70,
      scaleOutCooldown: cdk.Duration.seconds(120),
    });

    // ── ALB ────────────────────────────────────────────────────────────────────────────────
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: cfg.HOSTED_ZONE_ID,
      zoneName: cfg.DOMAIN_NAME,
    });
    // Covers the origin hostname and the public name (CloudFront forwards the viewer Host header → SNI = DOMAIN_NAME).
    const originCert = new acm.Certificate(this, 'OriginCertificate', {
      domainName: cfg.DOMAIN_NAME,
      subjectAlternativeNames: [cfg.originDomainName],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const albSg = network.albSg;
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
      idleTimeout: cdk.Duration.seconds(60),
    });
    this.alb.logAccessLogs(props.logsBucket, 'alb');

    const listener = this.alb.addListener('Https', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [originCert],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Forbidden',
      }),
    });

    this.apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTg', {
      vpc,
      port: 4000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [this.apiService.loadBalancerTarget({ containerName: 'api', containerPort: 4000 })],
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: '/api/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(15),
        healthyThresholdCount: 2,
      },
    });
    this.webTargetGroup = new elbv2.ApplicationTargetGroup(this, 'WebTg', {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [this.webService.loadBalancerTarget({ containerName: 'web', containerPort: 3000 })],
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-399',
        interval: cdk.Duration.seconds(15),
        healthyThresholdCount: 2,
      },
    });
    // ALB ⇄ task security-group rules are added by CDK when the target groups are attached to the listener.

    const originToken = cdk.SecretValue.secretsManager(cfg.appSecretName, {
      jsonField: ORIGIN_VERIFY_KEY,
    }).unsafeUnwrap();
    const fromCloudFront = elbv2.ListenerCondition.httpHeader(ORIGIN_VERIFY_HEADER, [originToken]);
    listener.addAction('Api', {
      priority: 10,
      conditions: [fromCloudFront, elbv2.ListenerCondition.pathPatterns(['/api/*', '/api'])],
      action: elbv2.ListenerAction.forward([this.apiTargetGroup]),
    });
    listener.addAction('Web', {
      priority: 20,
      conditions: [fromCloudFront, elbv2.ListenerCondition.pathPatterns(['/*'])],
      action: elbv2.ListenerAction.forward([this.webTargetGroup]),
    });

    new route53.ARecord(this, 'OriginAlias', {
      zone,
      recordName: `${cfg.originDomainName}.`,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(this.alb)),
    });

    new cdk.CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'OriginDomainName', { value: cfg.originDomainName });
    new cdk.CfnOutput(this, 'ServiceNames', { value: ['api', 'worker', 'web'].join(',') });
  }
}
