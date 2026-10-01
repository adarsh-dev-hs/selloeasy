import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';
import { ECR_SERVICES, ecrRepositoryName, type InfraConfig } from './config';

export interface BootstrapStackProps extends cdk.StackProps {
  cfg: InfraConfig;
}

/**
 * Bootstrap — ECR repositories (api / worker / web) and the GitHub OIDC deploy role (plan §23.1).
 * Deployed first by `infra/scripts/deploy.sh` so images can be pushed before the app stacks roll out.
 */
export class BootstrapStack extends cdk.Stack {
  readonly repositories: Record<(typeof ECR_SERVICES)[number], ecr.Repository>;

  constructor(scope: Construct, id: string, props: BootstrapStackProps) {
    super(scope, id, props);
    const { cfg } = props;

    const repos = {} as Record<(typeof ECR_SERVICES)[number], ecr.Repository>;
    for (const service of ECR_SERVICES) {
      const repo = new ecr.Repository(this, `Repo-${service}`, {
        repositoryName: ecrRepositoryName(cfg, service),
        imageScanOnPush: true,
        imageTagMutability: ecr.TagMutability.MUTABLE,
        encryption: ecr.RepositoryEncryption.AES_256,
        removalPolicy: cfg.isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        emptyOnDelete: !cfg.isProduction,
        lifecycleRules: [
          { description: 'Drop untagged layers after 7 days', tagStatus: ecr.TagStatus.UNTAGGED, maxImageAge: cdk.Duration.days(7), rulePriority: 1 },
          { description: 'Keep the 30 most recent images (rollback window)', tagStatus: ecr.TagStatus.ANY, maxImageCount: 30, rulePriority: 2 },
        ],
      });
      repos[service] = repo;
      new cdk.CfnOutput(this, `RepositoryUri-${service}`, { value: repo.repositoryUri });
    }
    this.repositories = repos;

    if (cfg.githubRepository) {
      const provider = cfg.githubOidcProviderArn
        ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, 'GithubOidc', cfg.githubOidcProviderArn)
        : new iam.OpenIdConnectProvider(this, 'GithubOidc', {
            url: 'https://token.actions.githubusercontent.com',
            clientIds: ['sts.amazonaws.com'],
          });

      const role = new iam.Role(this, 'GithubDeployRole', {
        roleName: `${cfg.prefix}-github-deploy`,
        description: `GitHub Actions deploy role for ${cfg.githubRepository} (${cfg.DEPLOY_ENV})`,
        maxSessionDuration: cdk.Duration.hours(2),
        assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
          StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
          StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${cfg.githubRepository}:*` },
        }),
      });

      // CDK deployments go through the CDK bootstrap roles (cdk bootstrap), which hold the CloudFormation rights.
      role.addToPolicy(
        new iam.PolicyStatement({
          sid: 'AssumeCdkBootstrapRoles',
          actions: ['sts:AssumeRole'],
          resources: [`arn:${this.partition}:iam::${this.account}:role/cdk-hnb659fds-*`],
        }),
      );
      role.addToPolicy(new iam.PolicyStatement({ sid: 'EcrLogin', actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));
      for (const repo of Object.values(repos)) repo.grantPullPush(role);
      role.addToPolicy(
        new iam.PolicyStatement({
          sid: 'AppSecretWrite',
          actions: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue', 'secretsmanager:DescribeSecret'],
          resources: [`arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:selloeasy/${cfg.DEPLOY_ENV}/*`],
        }),
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          sid: 'RunMigrateAndWait',
          actions: ['ecs:RunTask', 'ecs:DescribeTasks', 'ecs:DescribeServices', 'ecs:DescribeTaskDefinition', 'ecs:ListTasks'],
          resources: ['*'],
          conditions: { StringEquals: { 'aws:ResourceAccount': this.account } },
        }),
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          sid: 'PassTaskRoles',
          actions: ['iam:PassRole'],
          resources: [`arn:${this.partition}:iam::${this.account}:role/${cfg.DEPLOY_ENV}-selloeasy-*`],
          conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
        }),
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          sid: 'ReadStacksAndLogs',
          actions: ['cloudformation:DescribeStacks', 'logs:GetLogEvents', 'logs:FilterLogEvents'],
          resources: ['*'],
        }),
      );

      new cdk.CfnOutput(this, 'GithubOidcRoleArn', {
        value: role.roleArn,
        description: 'Set as the GITHUB_OIDC_ROLE_ARN repository secret to enable .github/workflows/deploy.yml',
      });

      NagSuppressions.addResourceSuppressions(
        role,
        [
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'Deploy role: ecr:GetAuthorizationToken has no resource scope; CDK bootstrap roles, per-env secrets, ' +
              'ECS task/service ARNs (unknown until deploy) and task-role PassRole are scoped by name prefix / account / service conditions.',
          },
        ],
        true,
      );
    }
  }
}
