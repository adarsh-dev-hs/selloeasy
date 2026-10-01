import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';
import type { InfraConfig } from './config';
import type { NetworkStack } from './network-stack';

export interface DataStackProps extends cdk.StackProps {
  cfg: InfraConfig;
  network: NetworkStack;
}

export const DB_NAME = 'selloeasy';
export const DB_USER = 'selloeasy';

/**
 * Data — RDS Postgres 16, ElastiCache Redis (TLS + AUTH), S3 uploads bucket (SSE-KMS) and a shared access-log bucket.
 *
 * Credentials never leave Secrets Manager: the RDS master secret and the Redis AUTH token are generated here and
 * injected into containers through ECS `secrets`; the container entrypoint assembles DATABASE_URL / REDIS_URL
 * (see `lib/runtime-env.ts`).
 */
export class DataStack extends cdk.Stack {
  readonly db: rds.DatabaseInstance;
  readonly dbSecret: secretsmanager.ISecret;
  readonly redisAuthSecret: secretsmanager.Secret;
  readonly redisHost: string;
  readonly redisPort: string;
  readonly uploadsBucket: s3.Bucket;
  readonly logsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { cfg, network } = props;
    const vpc = network.vpc;
    const privateSubnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
    const retain = cfg.isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // ── Access logs (S3 server access logs for uploads, ALB access logs) ─────────────────────────────
    this.logsBucket = new s3.Bucket(this, 'LogsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED, // ALB access logs only support SSE-S3
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [{ expiration: cdk.Duration.days(cfg.isProduction ? 365 : 90) }],
      removalPolicy: retain,
      autoDeleteObjects: !cfg.isProduction,
    });
    NagSuppressions.addResourceSuppressions(this.logsBucket, [
      {
        id: 'AwsSolutions-S1',
        reason: 'This is the access-log destination bucket; logging it to itself would loop.',
      },
    ]);

    // ── Uploads bucket (knowledge sources; keys under orgs/<orgId>/…) ──────────────────────────────
    const uploadsKey = new kms.Key(this, 'UploadsKey', {
      alias: `alias/${cfg.prefix}-uploads`,
      enableKeyRotation: true,
      removalPolicy: retain,
    });
    this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      bucketName: `${cfg.prefix}-uploads-${cfg.AWS_ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: uploadsKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 's3-uploads/',
      cors: [
        {
          // Browser uploads with presigned PUT URLs (plan §23.2 StorageProvider).
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: [`https://${cfg.DOMAIN_NAME}`],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: retain,
      autoDeleteObjects: !cfg.isProduction,
    });

    // ── RDS PostgreSQL 16 ──────────────────────────────────────────────────────────────────────
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'SelloEasy RDS Postgres',
      allowAllOutbound: false,
    });
    for (const [name, sg] of [
      ['api', network.apiSg],
      ['worker', network.workerSg],
      ['migrate', network.migrateSg],
    ] as const) {
      dbSg.addIngressRule(sg, ec2.Port.tcp(5432), `Postgres from ${name} tasks`);
    }

    const parameterGroup = new rds.ParameterGroup(this, 'DbParams', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      description: 'SelloEasy Postgres 16 — TLS required',
      parameters: { 'rds.force_ssl': '1', log_min_duration_statement: '1000' },
    });

    this.db = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: new ec2.InstanceType(cfg.RDS_INSTANCE_CLASS.replace(/^db\./, '')),
      vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [dbSg],
      databaseName: DB_NAME,
      credentials: rds.Credentials.fromGeneratedSecret(DB_USER, {
        secretName: `selloeasy/${cfg.DEPLOY_ENV}/rds`,
        // Keep the generated password URL-safe; the entrypoint still percent-encodes it.
        excludeCharacters: ` %+~\`#$&*()|[]{}:;<>?!'/@"\\=,^.`,
      }),
      parameterGroup,
      allocatedStorage: cfg.RDS_ALLOCATED_STORAGE_GB,
      maxAllocatedStorage: cfg.RDS_ALLOCATED_STORAGE_GB * 5,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: cfg.RDS_MULTI_AZ,
      backupRetention: cdk.Duration.days(cfg.RDS_BACKUP_RETENTION_DAYS),
      deletionProtection: cfg.isProduction,
      removalPolicy: cfg.isProduction ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: 30,
      copyTagsToSnapshot: true,
      publiclyAccessible: false,
    });
    this.dbSecret = this.db.secret!;

    // ── ElastiCache Redis (cluster mode disabled — BullMQ) ──────────────────────────────────────
    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc,
      description: 'SelloEasy Redis',
      allowAllOutbound: false,
    });
    for (const [name, sg] of [
      ['api', network.apiSg],
      ['worker', network.workerSg],
      ['migrate', network.migrateSg],
    ] as const) {
      redisSg.addIngressRule(sg, ec2.Port.tcp(6379), `Redis from ${name} tasks`);
    }
    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: 'SelloEasy Redis private subnets',
      subnetIds: vpc.selectSubnets(privateSubnets).subnetIds,
    });
    const redisParams = new elasticache.CfnParameterGroup(this, 'RedisParams', {
      cacheParameterGroupFamily: 'redis7',
      description: 'BullMQ requires maxmemory-policy noeviction',
      properties: { 'maxmemory-policy': 'noeviction' },
    });
    this.redisAuthSecret = new secretsmanager.Secret(this, 'RedisAuth', {
      secretName: `selloeasy/${cfg.DEPLOY_ENV}/redis`,
      description: 'ElastiCache AUTH token (injected into tasks as REDIS_AUTH_TOKEN)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'authToken',
        excludePunctuation: true,
        passwordLength: 48,
      },
    });
    const multiNode = cfg.isProduction;
    const redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupId: cfg.prefix, // node ids: <prefix>-001 (used by Observability metrics)
      replicationGroupDescription: `SelloEasy ${cfg.DEPLOY_ENV} queues/cache`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: cfg.REDIS_NODE_TYPE,
      numCacheClusters: multiNode ? 2 : 1,
      automaticFailoverEnabled: multiNode,
      multiAzEnabled: multiNode,
      cacheSubnetGroupName: subnetGroup.ref,
      cacheParameterGroupName: redisParams.ref,
      securityGroupIds: [redisSg.securityGroupId],
      transitEncryptionEnabled: true,
      transitEncryptionMode: 'required',
      atRestEncryptionEnabled: true,
      authToken: this.redisAuthSecret.secretValueFromJson('authToken').unsafeUnwrap(),
      port: 6379,
      snapshotRetentionLimit: cfg.isProduction ? 7 : 1,
      autoMinorVersionUpgrade: true,
    });
    this.redisHost = redis.attrPrimaryEndPointAddress;
    this.redisPort = redis.attrPrimaryEndPointPort;

    new cdk.CfnOutput(this, 'DbEndpoint', { value: this.db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: this.dbSecret.secretArn });
    new cdk.CfnOutput(this, 'RedisEndpoint', { value: this.redisHost });
    new cdk.CfnOutput(this, 'UploadsBucketName', { value: this.uploadsBucket.bucketName });

    // ── cdk-nag: justified exceptions ──────────────────────────────────────────────────────────
    NagSuppressions.addResourceSuppressions(
      this.db,
      [
        {
          id: 'AwsSolutions-RDS11',
          reason:
            'Default port 5432 kept; the instance is private and only reachable from task security groups.',
        },
        {
          id: 'AwsSolutions-SMG4',
          reason:
            'Master secret rotation is not enabled yet: tasks read the password at start, so rotation needs a coordinated ' +
            'service redeploy (runbook: docs/operations/aws-deployment.mdx → rotating secrets).',
        },
        ...(cfg.RDS_MULTI_AZ
          ? []
          : [
              {
                id: 'AwsSolutions-RDS3',
                reason: 'RDS_MULTI_AZ=false (cost-optimised staging); set true for production.',
              },
            ]),
        ...(cfg.isProduction
          ? []
          : [
              {
                id: 'AwsSolutions-RDS10',
                reason: 'Staging databases are disposable; deletion protection is enabled for production.',
              },
            ]),
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(this.redisAuthSecret, [
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'ElastiCache AUTH rotation requires a ROTATE/SET auth-token strategy with a coordinated redeploy; manual per runbook.',
      },
    ]);
    NagSuppressions.addResourceSuppressions(redis, [
      {
        id: 'AwsSolutions-AEC5',
        reason:
          'Default port 6379 kept; the cluster is private and only reachable from task security groups.',
      },
      ...(multiNode
        ? []
        : [
            {
              id: 'AwsSolutions-AEC4',
              reason:
                'Single-node Redis in staging for cost; production runs 2 nodes with Multi-AZ failover.',
            },
          ]),
    ]);
  }
}
