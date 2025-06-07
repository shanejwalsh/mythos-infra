import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import * as s3 from "aws-cdk-lib/aws-s3";

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";

import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";

import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

const POSTGRES_PORT = 5432;

export class MythosInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "MythosVpc", {
      maxAzs: 2,
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
      keyName: "mythos-keypair", // ✅ replace with a real EC2 key pair name
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // public so you can SSH in
      },
    });

    new cdk.CfnOutput(this, "EC2PublicIP", {
      value: ec2Instance.instancePublicIp,
    });

    const frontendBucket = new s3.Bucket(this, "MythosFrontendBucket", {
      bucketName: "mythos-frontend-bucket",
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // CloudFront will access it
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Be careful with this in production
    });

    // Origin Access Control for CloudFront
    const oac = new cloudfront.S3OriginAccessControl(this, "MythosOAC", {
      description: "OAC for Mythos frontend bucket",
    });

    const distribution = new cloudfront.Distribution(
      this,
      "MythosDistribution",
      {
        defaultBehavior: {
          origin:
            origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
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
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      },
    );

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'MythosInfraQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    new s3.Bucket(this, "MythosPublicImageBucket", {
      bucketName: "mythos-public-image-bucket",
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
    });
  }
}
