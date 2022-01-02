import {
  Stack,
  StackProps,
  aws_cognito,
  aws_iam,
  aws_appsync,
  aws_dynamodb
} from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

const baseName = "debtBurner";

export class DebtBurnerBackendStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    this.generateAuthStack();
  }

  public generateAuthStack() {
    const userPool = new aws_cognito.UserPool(this, `${baseName}UserPool`, {
      signInAliases: {
        email: true,
        username: true
      }
    });

    const cfnUserPool = new aws_cognito.CfnUserPool(
      this,
      `${baseName}CfnUserPool`,
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

    const api = new aws_appsync.CfnGraphQLApi(this, `${baseName}Api`, {
      name: `${baseName}Api`,
      authenticationType: "AMAZON_COGNITO_USER_POOLS",
      userPoolConfig: {
        awsRegion: this.region,
        userPoolId: userPool.userPoolId,
        // Change to deny after testing
        defaultAction: "ALLOW"
      }
    });

    const cfnGraphQlSchema = new aws_appsync.CfnGraphQLSchema(
      this,
      `${baseName}Schema`,
      {
        apiId: api.attrApiId,
        definition: `
        schema {
          query: Query
          mutation: Mutation
        }
        type Query {
            # Get a single value of type 'Post' by primary key.
            singleTransaction(id: ID!): Transaction
        }
        type Mutation {
            # Put a single value of type 'Transaction'.
            # If an item exists it's updated. If it does not it's created.
            putTransaction(id: ID!, title: String!): Transaction
        }
        type Transaction {
          isDeleted: Boolean!;
          updatedAt: Int!;
          createdAt: Int!;
          description: String!;
          childCategoryId: ID!;
          vendorId: ID!;
          amount: Float!;
          paid: Boolean!;
        }
      `
      }
    );

    const dynamoTable = new aws_dynamodb.Table(this, `${baseName}Table`, {
      partitionKey: {
        name: "PK",
        type: aws_dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: "SK",
        type: aws_dynamodb.AttributeType.STRING
      }
    });

    const dataLinkRole = new aws_iam.Role(this, "AppsyncDynamoDbAccessRole", {
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
    });

    dataLinkRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem"
        ],
        resources: [dynamoTable.tableArn]
      })
    );

    const dynamoDataSource = new aws_appsync.CfnDataSource(
      this,
      `${baseName}DynamoDataSource`,
      {
        apiId: api.attrApiId,
        name: `${baseName}DynamoDataSource`,
        type: "AMAZON_DYNAMODB",
        description: "DynamoDB Data Source",
        dynamoDbConfig: {
          awsRegion: this.region,
          tableName: dynamoTable.tableName
        },
        serviceRoleArn: dataLinkRole.roleArn
      }
    );
  }
}
