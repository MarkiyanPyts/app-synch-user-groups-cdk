import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import { aws_appsync as appsync, CfnOutput } from 'aws-cdk-lib';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import path = require('path');
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class AwsCdkAuthStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, 'cdk-products-user-pool', {
      selfSignUpEnabled: true,
      accountRecovery: cognito.AccountRecovery.PHONE_AND_EMAIL,
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE
      },
      autoVerify: {
        email: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        }
      }
    })

    const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool
    })

    const api = new appsync.GraphqlApi(this, 'cdk-product-app', {
      name: "cdk-product-api",
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
      },
      schema: appsync.SchemaFile.fromAsset(path.join(__dirname, '../graphql/schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365))
          }
        },
        additionalAuthorizationModes: [{
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool,
          }
        }]
      },
    })

    const productLambda = new lambda.Function(this, 'AppSyncProductHandler', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'main.handler',
      code: lambda.Code.fromAsset('lambda-fns'),
      memorySize: 1024
    })
    
    // Set the new Lambda function as a data source for the AppSync API
    const lambdaDs = new appsync.LambdaDataSource(this, 'lambdaDatasource', {
      api,
      lambdaFunction: productLambda,
    
      // the properties below are optional
      description: 'description',
      name: 'name',
    });

    lambdaDs.createResolver("getProductByIdResolver", {
      typeName: "Query",
      fieldName: "getProductById"
    })
    
    lambdaDs.createResolver("listProductsResolver", {
      typeName: "Query",
      fieldName: "listProducts"
    })
    
    lambdaDs.createResolver("productsByCategoryResolver", {
      typeName: "Query",
      fieldName: "productsByCategory"
    })
    
    lambdaDs.createResolver("createProductResolver", {
      typeName: "Mutation",
      fieldName: "createProduct"
    })
    
    lambdaDs.createResolver("deleteProductResolver", {
      typeName: "Mutation",
      fieldName: "deleteProduct"
    })
    
    lambdaDs.createResolver("updateProductResolver", {
      typeName: "Mutation",
      fieldName: "updateProduct"
    })

    const productTable = new ddb.Table(this, 'CDKProductTable', {
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: ddb.AttributeType.STRING,
      },
    })
    
    // Add a global secondary index to enable another data access pattern
    productTable.addGlobalSecondaryIndex({
      indexName: "productsByCategory",
      partitionKey: {
        name: "category",
        type: ddb.AttributeType.STRING,
      }
    })
    
    // Enable the Lambda function to access the DynamoDB table (using IAM)
    productTable.grantFullAccess(productLambda)
    
    // Create an environment variable that we will use in the function code
    productLambda.addEnvironment('PRODUCT_TABLE', productTable.tableName)

    new CfnOutput(this, 'GraphQLAPIURL', {
			value: api.graphqlUrl,
		})

    new CfnOutput(this, 'AppSyncApiKey', {
			value: api.apiKey || '',
		})

    new CfnOutput(this, 'ProjectRegion', {
			value: this.region,
		})

    new CfnOutput(this, 'UserPoolId', {
			value: userPool.userPoolId,
		})

    new CfnOutput(this, 'UserPoolClientId', {
			value: userPoolClient.userPoolClientId,
		})
  }
}
