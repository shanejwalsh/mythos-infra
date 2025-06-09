import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import * as s3 from "aws-cdk-lib/aws-s3";

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";

import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import * as iam from "aws-cdk-lib/aws-iam";

import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as targets from "aws-cdk-lib/aws-route53-targets";

import * as elbv2Targets from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";

import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";

import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

import * as apigatewayv2Alpha from "@aws-cdk/aws-apigatewayv2-alpha";
import * as integrationsAlpha from "@aws-cdk/aws-apigatewayv2-integrations-alpha";

import * as route53 from "aws-cdk-lib/aws-route53";

const POSTGRES_PORT = 5432;

export class MythosInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        hostedZoneId: "Z05443627IDGMCDOHGJK",
        zoneName: "mythosapp.io",
      },
    );

    const certificate = new certificatemanager.Certificate(
      this,
      "MythosWildcardCert",
      {
        domainName: "mythosapp.io",
        subjectAlternativeNames: ["www.mythosapp.io", "*.mythosapp.io"],
        validation:
          certificatemanager.CertificateValidation.fromDns(hostedZone),
      },
    );

    const vpc = new ec2.Vpc(this, "MythosVpc", {
      maxAzs: 2,
    });

    const nlb = new elbv2.NetworkLoadBalancer(this, "MythosNLB", {
      vpc,
      internetFacing: true,
    });

    const dbInstance = new rds.DatabaseInstance(this, "MythosPostgres", {
      vpc: vpc,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14,
      }),
      credentials: rds.Credentials.fromGeneratedSecret("postgres"), // or use fromPassword()
      databaseName: "mythos_server_production",
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      allocatedStorage: 20,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      publiclyAccessible: false,
      multiAz: false,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deleteAutomatedBackups: true,
    });

    const ec2Sg = new ec2.SecurityGroup(this, "MythosEc2SG", {
      vpc,
      description: "Allow EC2 access to RDS and SSH from home IP",
      allowAllOutbound: true,
    });
    ec2Sg.addIngressRule(
      ec2.Peer.ipv4("86.41.206.157/32"),
      ec2.Port.tcp(22),
      "Allow SSH from my IP",
    );
    ec2Sg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP traffic from anywhere",
    );

    dbInstance.connections.allowFrom(ec2Sg, ec2.Port.tcp(POSTGRES_PORT));

    const instanceRole = new iam.Role(this, "MythosEC2Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonEC2ContainerRegistryReadOnly",
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("SecretsManagerReadWrite"),
      ],
    });

    const ec2Instance = new ec2.Instance(this, "MythosAppInstance", {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux(),
      securityGroup: ec2Sg,
      role: instanceRole,
      keyName: "mythos-keypair",
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    const targetGroup = new elbv2.NetworkTargetGroup(this, "RailsTargetGroup", {
      vpc,
      port: 80,
      targets: [new elbv2Targets.InstanceTarget(ec2Instance)],
    });

    const listener = nlb.addListener("MythosListener", {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });

    // nlb.addListener("RailsListener", {
    //   port: 80,
    //   defaultTargetGroups: [targetGroup],
    // });

    const vpcLink = new apigatewayv2Alpha.VpcLink(this, "MyVpcLink", {
      vpc,
      vpcLinkName: "MythosApiVpcLink",
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [ec2Sg],
    });

    const integration = new integrationsAlpha.HttpNlbIntegration(
      "MythosNlbIntegration",
      listener,
      {
        vpcLink,
      },
    );

    const httpApi = new apigatewayv2Alpha.HttpApi(this, "MythosHttpApi", {
      apiName: "Mythos HTTP API",
      defaultIntegration: integration,
    });

    const domainName = new apigatewayv2Alpha.DomainName(
      this,
      "MythosApiDomain",
      {
        domainName: "api.mythosapp.io",
        certificate: certificate,
        endpointType: apigatewayv2Alpha.EndpointType.REGIONAL,
      },
    );

    new apigatewayv2Alpha.ApiMapping(this, "MythosApiMapping", {
      api: httpApi,
      domainName,
      stage: httpApi.defaultStage!,
    });

    new route53.ARecord(this, "ApiGatewayAliasRecord", {
      zone: hostedZone,
      recordName: "api.mythosapp.io",
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayv2DomainProperties(
          domainName.regionalDomainName,
          domainName.regionalHostedZoneId,
        ),
      ),
    });

    const frontendBucket = new s3.Bucket(this, "MythosFrontendBucket", {
      bucketName: "mythos-frontend",
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // CloudFront will access it
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Be careful with this in production
    });

    const githubUser = new iam.User(this, "GithubActionsUser", {
      userName: "github-actions-deploy",
    });

    const accessKey = new iam.CfnAccessKey(this, "GithubDeployAccessKey", {
      userName: githubUser.userName,
    });

    const origin = new origins.S3Origin(frontendBucket);

    const distribution = new cloudfront.Distribution(
      this,
      "MythosDistribution",
      {
        defaultBehavior: {
          origin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        certificate: certificate,
        domainNames: ["mythosapp.io", "www.mythosapp.io"],
        sslSupportMethod: cloudfront.SSLMethod.SNI,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        defaultRootObject: "index.html",
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
        ],
      },
    );

    new route53.ARecord(this, "WwwAlias", {
      zone: hostedZone,
      recordName: "www.mythosapp.io",
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    distribution.node.addDependency(certificate);

    new route53.ARecord(this, "RootAlias", {
      zone: hostedZone,
      recordName: "mythosapp.io",
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    githubUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    frontendBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [`${frontendBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    );

    frontendBucket.grantReadWrite(githubUser);

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
    });

    new cdk.CfnOutput(this, "EC2PublicIP", {
      value: ec2Instance.instancePublicIp,
    });

    new cdk.CfnOutput(this, "GithubAccessKeyId", {
      value: accessKey.ref,
    });

    new cdk.CfnOutput(this, "GithubSecretAccessKey", {
      value: accessKey.attrSecretAccessKey,
    });

    new cdk.CfnOutput(this, "ApiDomainCertificateArn", {
      value: certificate.certificateArn,
    });

    // new cdk.CfnOutput(this, "MythosElasticIP", {
    //   value: eip.ref,
    // });
  }
}
