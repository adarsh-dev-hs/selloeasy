import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';
import type { InfraConfig } from './config';
import { ORIGIN_VERIFY_HEADER } from './app-stack';
import { ORIGIN_VERIFY_KEY } from './secrets-stack';

const zoneFor = (scope: Construct, cfg: InfraConfig) =>
  route53.HostedZone.fromHostedZoneAttributes(scope, 'Zone', {
    hostedZoneId: cfg.HOSTED_ZONE_ID,
    zoneName: cfg.DOMAIN_NAME,
  });

export interface EdgeCertStackProps extends cdk.StackProps {
  cfg: InfraConfig;
}

/** CloudFront viewer certificate — must live in us-east-1. Only created when ACM_CERTIFICATE_ARN is empty. */
export class EdgeCertStack extends cdk.Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: EdgeCertStackProps) {
    super(scope, id, props);
    this.certificate = new acm.Certificate(this, 'ViewerCertificate', {
      domainName: props.cfg.DOMAIN_NAME,
      validation: acm.CertificateValidation.fromDns(zoneFor(this, props.cfg)),
    });
  }
}

export interface EdgeStackProps extends cdk.StackProps {
  cfg: InfraConfig;
  /** From EdgeCertStack (cross-region reference) — omitted when ACM_CERTIFICATE_ARN is set. */
  certificate?: acm.ICertificate;
}

/**
 * Edge — CloudFront in front of the ALB and the Route53 alias for DOMAIN_NAME (plan §23.1).
 *
 * - Origin: https://origin.<DOMAIN_NAME> (ALB) with the secret X-Origin-Verify header.
 * - `/api/*` and the default (Next.js pages) are not cached; all methods, cookies, query strings and headers are
 *   forwarded (AllViewer origin request policy). `/_next/static/*` is cached (immutable, content-hashed).
 */
export class EdgeStack extends cdk.Stack {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { cfg } = props;

    const certificate =
      props.certificate ??
      acm.Certificate.fromCertificateArn(this, 'ViewerCertificate', cfg.ACM_CERTIFICATE_ARN!);

    const originToken = cdk.SecretValue.secretsManager(cfg.appSecretName, {
      jsonField: ORIGIN_VERIFY_KEY,
    }).unsafeUnwrap();
    const albOrigin = new origins.HttpOrigin(cfg.originDomainName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
      customHeaders: { [ORIGIN_VERIFY_HEADER]: originToken },
      readTimeout: cdk.Duration.seconds(60),
      keepaliveTimeout: cdk.Duration.seconds(5),
    });

    const dynamic: cloudfront.BehaviorOptions = {
      origin: albOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      compress: true,
    };

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `SelloEasy ${cfg.DEPLOY_ENV}`,
      domainNames: [cfg.DOMAIN_NAME],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // includes India edge locations
      defaultBehavior: dynamic,
      additionalBehaviors: {
        '/api/*': dynamic,
        '/_next/static/*': {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
      },
    });

    const zone = zoneFor(this, cfg);
    const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution));
    new route53.ARecord(this, 'AliasA', { zone, recordName: `${cfg.DOMAIN_NAME}.`, target });
    new route53.AaaaRecord(this, 'AliasAAAA', { zone, recordName: `${cfg.DOMAIN_NAME}.`, target });

    new cdk.CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: this.distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'Url', { value: `https://${cfg.DOMAIN_NAME}` });

    NagSuppressions.addResourceSuppressions(this.distribution, [
      {
        id: 'AwsSolutions-CFR1',
        reason: 'B2B SaaS with customers across regions; no geo restriction required.',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason:
          'WAF is a documented follow-up (cost); the ALB only accepts traffic carrying the origin-verify header and the API is rate-limited.',
      },
      {
        id: 'AwsSolutions-CFR3',
        reason: 'Request logs are captured by ALB access logs (S3) for every non-static request.',
      },
    ]);
  }
}
