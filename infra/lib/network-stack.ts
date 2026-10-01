import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';
import type { InfraConfig } from './config';

export interface NetworkStackProps extends cdk.StackProps {
  cfg: InfraConfig;
}

/**
 * Network — VPC across 2 AZs (public + private-with-egress subnets), NAT_GATEWAYS, VPC endpoints for
 * S3 (gateway), ECR, ECR docker, Secrets Manager and CloudWatch Logs (plan §23.1, §23.4 cost note).
 *
 * Also owns the per-service security groups so that Data (RDS/Redis ingress) and App (ALB ingress) can reference
 * them without cross-stack cycles.
 *
 * When VPC_ID is set the VPC is imported (context lookup at deploy time — needs AWS credentials) and no endpoints are
 * created; the imported VPC must already have private subnets with egress.
 */
export class NetworkStack extends cdk.Stack {
  readonly vpc: ec2.IVpc;
  readonly apiSg: ec2.SecurityGroup;
  readonly workerSg: ec2.SecurityGroup;
  readonly webSg: ec2.SecurityGroup;
  readonly migrateSg: ec2.SecurityGroup;
  readonly albSg: ec2.SecurityGroup;

  private readonly azs: string[];

  /** First two AZs via Fn::GetAZs (resolved at deploy time) instead of a context lookup, so `cdk synth` needs no credentials. */
  override get availabilityZones(): string[] {
    return this.azs;
  }

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    this.azs = [cdk.Fn.select(0, cdk.Fn.getAzs()), cdk.Fn.select(1, cdk.Fn.getAzs())];

    if (cfg.VPC_ID) {
      this.vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: cfg.VPC_ID });
    } else {
      const vpc = new ec2.Vpc(this, 'Vpc', {
        vpcName: cfg.prefix,
        ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
        maxAzs: 2,
        natGateways: cfg.NAT_GATEWAYS,
        subnetConfiguration: [
          { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
          { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        ],
        gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
      });

      const flowLogGroup = new logs.LogGroup(this, 'FlowLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      vpc.addFlowLog('FlowLog', {
        destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
        trafficType: ec2.FlowLogTrafficType.REJECT,
      });

      const interfaceEndpoints: Record<string, ec2.InterfaceVpcEndpointAwsService> = {
        EcrApi: ec2.InterfaceVpcEndpointAwsService.ECR,
        EcrDocker: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        SecretsManager: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        Logs: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      };
      for (const [name, service] of Object.entries(interfaceEndpoints)) {
        const endpoint = vpc.addInterfaceEndpoint(name, {
          service,
          privateDnsEnabled: true,
          subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        });
        NagSuppressions.addResourceSuppressions(
          endpoint,
          [
            {
              id: 'CdkNagValidationFailure',
              reason:
                'Endpoint SG allows 443 from the VPC CIDR only (Fn::GetAtt, so EC23 cannot evaluate it).',
            },
          ],
          true,
        );
      }
      this.vpc = vpc;
    }

    const sg = (name: string, description: string) =>
      new ec2.SecurityGroup(this, `${name}Sg`, { vpc: this.vpc, description, allowAllOutbound: true });
    this.apiSg = sg('Api', 'SelloEasy api tasks');
    this.workerSg = sg('Worker', 'SelloEasy worker tasks');
    this.webSg = sg('Web', 'SelloEasy web tasks');
    this.migrateSg = sg('Migrate', 'SelloEasy one-off migrate/seed task');
    // ALB SG lives here (not in App) so ALB → task rules stay inside this stack (no cross-stack cycles).
    this.albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'SelloEasy ALB (CloudFront origin)',
      allowAllOutbound: false,
    });
    this.albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS from CloudFront (requests without the origin header get 403)',
    );
    NagSuppressions.addResourceSuppressions(this.albSg, [
      {
        id: 'AwsSolutions-EC23',
        reason:
          'Origin for CloudFront: port 443 is open, but every listener rule requires the secret X-Origin-Verify header ' +
          'that only our distribution sends; anything else gets a fixed 403.',
      },
    ]);

    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds.join(','),
    });
    new cdk.CfnOutput(this, 'MigrateSecurityGroupId', { value: this.migrateSg.securityGroupId });
  }
}
