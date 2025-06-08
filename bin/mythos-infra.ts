#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MythosInfraStack } from "../lib/mythos-infra-stack";
import { MythosDnsStack } from "../lib/mythos-dns-stack";

const app = new cdk.App();

const dnsStack = new MythosDnsStack(app, "MythosInfraStack", {});

const infraStack = new MythosInfraStack(app, "MythosInfraStack", {
  certificateArn: dnsStack.certificateArn,
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */
  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },
  /* For more information, see https://docs .aws.amazon.com/cdk/latest/guide/environments.html */
});
