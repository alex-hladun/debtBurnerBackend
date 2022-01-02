import { Stack, StackProps, aws_cognito, aws_iam } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

const baseName = "debtBurner";

export class DebtBurnerBackendStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const userPool = new aws_cognito.UserPool(this, `${baseName}UserPool`, {
      signInAliases: {
        email: true,
        username: true
      }
    });

    const cfnUserPool = new aws_cognito.CfnUserPool(
      this,
      `${baseName}UserPool`,
      {
        userPoolName: `${baseName}UserPool`,
        autoVerifiedAttributes: ["email"],
        policies: {
          passwordPolicy: {
            minimumLength: 8,
            requireLowercase: false,
            requireNumbers: false,
            requireUppercase: false,
            requireSymbols: false
          }
        }
      }
    );

    const userPoolClient = new aws_cognito.UserPoolClient(
      this,
      `${baseName}UserPoolClient`,
      {
        generateSecret: false,
        userPool: userPool
      }
    );

    const identityPool = new aws_cognito.CfnIdentityPool(
      this,
      `${baseName}identityPool`,
      {
        allowUnauthenticatedIdentities: false,
        cognitoIdentityProviders: [
          {
            clientId: userPoolClient.userPoolClientId,
            providerName: userPool.userPoolProviderName
          }
        ]
      }
    );

    const unauthenticatedRole = new aws_iam.Role(
      this,
      "CognitoDefaultUnauthenticatedRole",
      {
        assumedBy: new aws_iam.FederatedPrincipal(
          "cognito-identity.amazonaws.com",
          {
            StringEquals: {
              "cognito-identity.amazonaws.com:aud": identityPool.ref
            },
            "ForAnyValue:StringLike": {
              "cognito-identity.amazonaws.com:amr": "unauthenticated"
            }
          },
          "sts:AssumeRoleWithWebIdentity"
        )
      }
    );

    unauthenticatedRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["mobileanalytics:PutEvents", "cognito-sync:*"],
        resources: ["*"]
      })
    );

    const authenticatedRole = new aws_iam.Role(
      this,
      "CognitoDefaultAuthenticatedRole",
      {
        assumedBy: new aws_iam.FederatedPrincipal(
          "cognito-identity.amazonaws.com",
          {
            StringEquals: {
              "cognito-identity.amazonaws.com:aud": identityPool.ref
            },
            "ForAnyValue:StringLike": {
              "cognito-identity.amazonaws.com:amr": "authenticated"
            }
          },
          "sts:AssumeRoleWithWebIdentity"
        )
      }
    );

    authenticatedRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "mobileanalytics:PutEvents",
          "cognito-sync:*",
          "cognito-identity:*"
        ],
        resources: ["*"]
      })
    );

    const defaultPolicy = new aws_cognito.CfnIdentityPoolRoleAttachment(
      this,
      "DefaultValid",
      {
        identityPoolId: identityPool.ref,
        roles: {
          unauthenticated: unauthenticatedRole.roleArn,
          authenticated: authenticatedRole.roleArn
        }
      }
    );
  }
}
