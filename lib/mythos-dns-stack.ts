import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import * as route53 from "aws-cdk-lib/aws-route53";

import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";

const DOMAIN_NAME = "mythosapp.io";

export class MythosDnsStack extends cdk.Stack {
  public readonly certificateArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: { region: "us-east-1" },
    });

    const hostedZone = route53.HostedZone.fromLookup(this, "MythosHostedZone", {
      domainName: DOMAIN_NAME,
    });

    const certificate = new certificatemanager.Certificate(
      this,
      "MythosCertificate",
      {
        domainName: DOMAIN_NAME,
        subjectAlternativeNames: [`www.${DOMAIN_NAME}`],
        validation:
          certificatemanager.CertificateValidation.fromDns(hostedZone),
      },
    );

    this.certificateArn = certificate.certificateArn;

    new cdk.CfnOutput(this, "CertificateArn", {
      value: certificate.certificateArn,
      exportName: "MythosCertificateArn",
    });
  }
}
