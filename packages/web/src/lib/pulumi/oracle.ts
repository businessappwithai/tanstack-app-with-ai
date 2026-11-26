import type { DeployInput, OracleCredentials } from "./types";
import { installPlugins, loadPulumiSdk, type PulumiSdk } from "./sdk";

function makeOracleProgram(input: DeployInput, sdk: PulumiSdk) {
  return async (): Promise<Record<string, unknown>> => {
    const { provider: oci, docker, pulumi } = sdk;

    const slug = input.projectName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

    const ociConfig = new pulumi.Config("oci");
    const compartmentId = ociConfig.require("compartmentOcid");
    const region = ociConfig.require("region");
    const tenancyOcid = ociConfig.require("tenancyOcid");

    // Derive OCIR hostname from region (e.g. us-phoenix-1 → phx.ocir.io)
    const regionToOcir: Record<string, string> = {
      "us-phoenix-1": "phx.ocir.io",
      "us-ashburn-1": "iad.ocir.io",
      "eu-frankfurt-1": "fra.ocir.io",
      "uk-london-1": "lhr.ocir.io",
      "ap-tokyo-1": "nrt.ocir.io",
      "ap-sydney-1": "syd.ocir.io",
    };
    const ocirHost = regionToOcir[region] ?? `${region.split("-")[0]}.ocir.io`;

    const userOcid = ociConfig.require("userOcid");
    // OCIR username is <tenancy-namespace>/<user-email> — we use tenancy OCID slug for simplicity
    const tenancySlug = tenancyOcid.split(".").pop() ?? slug;

    // Auth token for OCIR (create a new one)
    const authToken = new oci.identity.AuthToken(`${slug}-token`, {
      userId: userOcid,
      description: `appwithai deploy ${slug}`,
    });

    // Build and push image to OCIR
    const imageRepo = `${ocirHost}/${tenancySlug}/${slug}`;
    const image = new docker.Image(`${slug}-image`, {
      imageName: `${imageRepo}:latest`,
      build: {
        context: input.projectPath,
        platform: "linux/amd64",
      },
      registry: {
        server: ocirHost,
        username: pulumi.interpolate`${tenancySlug}/${userOcid}`,
        password: authToken.token.apply((t: string | undefined) => t ?? ""),
      },
    });

    // Use the default VCN / subnet (requires existing networking in the compartment)
    // For a minimal deployment we look up the first available subnet
    const vcns = oci.core.getVcnsOutput({ compartmentId });
    const subnets = oci.core.getSubnetsOutput({
      compartmentId,
      vcnId: vcns.virtualNetworks.apply((v: { id: string }[]) => v[0]?.id ?? ""),
    });
    const subnetId = subnets.subnets.apply((s: { id: string }[]) => s[0]?.id ?? "");

    // Container Instance
    const envVarArr = Object.entries(input.appEnvVars).map(([name, value]) => ({ name, value }));
    const ci = new oci.containerengine.ContainerInstance(`${slug}-ci`, {
      compartmentId,
      displayName: slug,
      availabilityDomain: oci.identity.getAvailabilityDomainsOutput({ compartmentId })
        .availabilityDomains.apply((ads: { name: string }[]) => ads[0]?.name ?? ""),
      shape: "CI.Standard.E4.Flex",
      shapeConfig: { ocpus: 1, memoryInGbs: 2 },
      vnics: [{ subnetId, isPublicIpAssigned: true }],
      // OCI calls registry credentials image pull secrets, and a BASIC one
      // carries its username and password base64-encoded.
      imagePullSecrets: [{
        registryEndpoint: ocirHost,
        secretType: "BASIC",
        username: pulumi.interpolate`${tenancySlug}/${userOcid}`.apply(u =>
          Buffer.from(u).toString("base64")
        ),
        password: authToken.token.apply((t: string | undefined) => Buffer.from(t ?? "").toString("base64")),
      }],
      containers: [{
        imageUrl: image.imageName,
        displayName: slug,
        environmentVariables: Object.fromEntries(envVarArr.map(e => [e.name, e.value])),
        resourceConfig: { memoryLimitInGbs: 2, vcpusLimit: 1 },
      }],
    }, { dependsOn: [image] });

    // A container instance's VNIC carries only its id; the public address is
    // read from the VNIC itself.
    const publicIp = ci.vnics.apply((v: { vnicId: string }[]) => v[0]?.vnicId ?? "").apply((vnicId: string) =>
      vnicId ? oci.core.getVnicOutput({ vnicId }).publicIpAddress : ""
    );
    return { url: pulumi.interpolate`http://${publicIp}:${input.frontendPort}` };
  };
}

export async function deployOracle(
  input: DeployInput,
  creds: OracleCredentials,
  onLog: (msg: string) => void
): Promise<string> {
  const sdk = await loadPulumiSdk("oracle", onLog);
  const { LocalWorkspace } = sdk.automation;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");

  // Write the private key to a temp file
  const keyFile = path.join(os.tmpdir(), `oci-key-${input.projectId}.pem`);
  await fs.writeFile(keyFile, creds.privateKey, "utf-8");

  try {
    const stack = await LocalWorkspace.createOrSelectStack({
      stackName: input.stackName,
      projectName: "appwithai",
      program: makeOracleProgram(input, sdk),
    }, {
      envVars: {
        PULUMI_BACKEND_URL: `file://${input.stateDir}`,
        PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE ?? "",
        OCI_CLI_TENANCY: creds.tenancyOcid,
        OCI_CLI_USER: creds.userOcid,
        OCI_CLI_FINGERPRINT: creds.fingerprint,
        OCI_CLI_KEY_FILE: keyFile,
        OCI_CLI_REGION: creds.region,
      },
    });

    await stack.setConfig("oci:tenancyOcid", { value: creds.tenancyOcid, secret: true });
    await stack.setConfig("oci:userOcid", { value: creds.userOcid, secret: true });
    await stack.setConfig("oci:fingerprint", { value: creds.fingerprint });
    await stack.setConfig("oci:privateKeyPath", { value: keyFile, secret: true });
    await stack.setConfig("oci:region", { value: creds.region });
    await stack.setConfig("oci:compartmentOcid", { value: creds.compartmentOcid, secret: true });

    await installPlugins(stack, sdk, onLog);

    const up = await stack.up({ onOutput: (o) => onLog(o.trimEnd()) });
    const url = up.outputs["url"]?.value as string;
    if (!url) throw new Error("Deployment succeeded but no URL was returned.");
    return url;
  } finally {
    await fs.rm(keyFile, { force: true });
  }
}
