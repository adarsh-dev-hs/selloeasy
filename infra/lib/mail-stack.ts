import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import type { Construct } from 'constructs';
import type { InfraConfig } from './config';

export interface MailStackProps extends cdk.StackProps {
  cfg: InfraConfig;
}

/** SES configuration-set name used by the app (`SES_CONFIGURATION_SET`). */
export const sesConfigurationSetName = (cfg: Pick<InfraConfig, 'prefix'>) => cfg.prefix;

/**
 * Mail — SES domain identity for the MAIL_FROM domain with Easy DKIM records in HOSTED_ZONE_ID, and a configuration
 * set (plan §23.1). Deployed in SES_REGION.
 *
 * Note: new SES accounts start in the sandbox — request production access before inviting real users (runbook).
 */
export class MailStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MailStackProps) {
    super(scope, id, props);
    const { cfg } = props;

    const configurationSet = new ses.ConfigurationSet(this, 'ConfigurationSet', {
      configurationSetName: sesConfigurationSetName(cfg),
      reputationMetrics: true,
      sendingEnabled: true,
      tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE,
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
    });

    const identity = new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.domain(cfg.mailDomain),
      configurationSet,
      dkimSigning: true,
      feedbackForwarding: true,
    });

    // Easy DKIM: three CNAMEs. Record names are absolute FQDN tokens, so use the L1 resource.
    identity.dkimRecords.forEach((record, i) => {
      new route53.CfnRecordSet(this, `Dkim${i + 1}`, {
        hostedZoneId: cfg.HOSTED_ZONE_ID,
        name: record.name,
        type: 'CNAME',
        ttl: '1800',
        resourceRecords: [record.value],
      });
    });

    new cdk.CfnOutput(this, 'MailDomain', { value: cfg.mailDomain });
    new cdk.CfnOutput(this, 'ConfigurationSetName', { value: configurationSet.configurationSetName });
  }
}
