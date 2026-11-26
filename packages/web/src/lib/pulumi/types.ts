export type CloudProvider = "aws" | "gcp" | "azure" | "oracle";

export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface GCPCredentials {
  projectId: string;
  region: string;
  credentials: string; // service account JSON string
}

export interface AzureCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  subscriptionId: string;
  location: string;
}

export interface OracleCredentials {
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKey: string;
  region: string;
  compartmentOcid: string;
}

export type CloudCredentials =
  | AWSCredentials
  | GCPCredentials
  | AzureCredentials
  | OracleCredentials;

export interface DeployInput {
  projectId: string;
  projectName: string;
  projectPath: string;
  frontendPort: number;
  backendPort: number;
  appEnvVars: Record<string, string>;
  stateDir: string;
  stackName: string;
}
