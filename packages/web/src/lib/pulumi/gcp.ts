import type { DeployInput, GCPCredentials } from "./types";
import { installPlugins, loadPulumiSdk, type PulumiSdk } from "./sdk";

function makeGCPProgram(input: DeployInput, sdk: PulumiSdk) {
  return async (): Promise<Record<string, unknown>> => {
    const { provider: gcp, docker, pulumi } = sdk;

    const slug = input.projectName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

    const gcpConfig = new pulumi.Config("gcp");
    const project = gcpConfig.require("project");
    const region = gcpConfig.get("region") ?? "us-central1";

    // Enable required APIs
    const runApi = new gcp.projects.Service("run-api", {
      service: "run.googleapis.com",
      disableOnDestroy: false,
    });
    const artifactApi = new gcp.projects.Service("artifact-api", {
      service: "artifactregistry.googleapis.com",
      disableOnDestroy: false,
    });

    // Artifact Registry repository
    const registry = new gcp.artifactregistry.Repository(`${slug}-registry`, {
      repositoryId: slug,
      format: "DOCKER",
      location: region,
    }, { dependsOn: [artifactApi] });

    const imageUrl = pulumi.interpolate`${region}-docker.pkg.dev/${project}/${registry.repositoryId}/${slug}:latest`;

    // Build and push image
    const image = new docker.Image(`${slug}-image`, {
      imageName: imageUrl,
      build: {
        context: input.projectPath,
        platform: "linux/amd64",
      },
    });

    // Cloud Run service
    const service = new gcp.cloudrunv2.Service(`${slug}-svc`, {
      name: slug,
      location: region,
      ingress: "INGRESS_TRAFFIC_ALL",
      template: {
        containers: [{
          image: image.imageName,
          // Cloud Run v2 takes one port, not a list (ServiceTemplateContainerPorts).
          ports: { containerPort: input.frontendPort },
          envs: Object.entries(input.appEnvVars).map(([name, value]) => ({ name, value })),
          resources: { limits: { cpu: "1000m", memory: "512Mi" } },
        }],
      },
    }, { dependsOn: [image, runApi] });

    // Allow public access
    new gcp.cloudrunv2.ServiceIamBinding(`${slug}-public`, {
      name: service.name,
      location: region,
      role: "roles/run.invoker",
      members: ["allUsers"],
    });

    return { url: service.uri };
  };
}

export async function deployGCP(
  input: DeployInput,
  creds: GCPCredentials,
  onLog: (msg: string) => void
): Promise<string> {
  const sdk = await loadPulumiSdk("gcp", onLog);
  const { LocalWorkspace } = sdk.automation;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  // Write service account JSON to a temp file (GCP SDK reads from file)
  const credFile = path.join(os.tmpdir(), `gcp-creds-${input.projectId}.json`);
  await fs.writeFile(credFile, creds.credentials, "utf-8");

  try {
    const stack = await LocalWorkspace.createOrSelectStack({
      stackName: input.stackName,
      projectName: "appwithai",
      program: makeGCPProgram(input, sdk),
    }, {
      envVars: {
        PULUMI_BACKEND_URL: `file://${input.stateDir}`,
        PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE ?? "",
        GOOGLE_CREDENTIALS: creds.credentials,
        GOOGLE_APPLICATION_CREDENTIALS: credFile,
        GOOGLE_PROJECT: creds.projectId,
        GCLOUD_PROJECT: creds.projectId,
      },
    });

    await stack.setConfig("gcp:project", { value: creds.projectId });
    await stack.setConfig("gcp:region", { value: creds.region });

    await installPlugins(stack, sdk, onLog);

    const up = await stack.up({ onOutput: (o) => onLog(o.trimEnd()) });
    const url = up.outputs["url"]?.value as string;
    if (!url) throw new Error("Deployment succeeded but no URL was returned.");
    return url;
  } finally {
    await fs.rm(credFile, { force: true });
  }
}
