import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import * as s3 from "aws-cdk-lib/aws-s3";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class MythosInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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
