import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getLogger } from "../../common/logging/logger.service";

interface ImmudbVerifyResult {
  key: string;
  value: string;
  txId: string | number;
  verified: boolean;
}

interface ImmudbScanEntry {
  key: string;
  value: string;
}

/**
 * immudb client wrapper.
 *
 * Uses immudb-node (gRPC client). Falls back to no-op when
 * IMMUDB_ENABLED=false so the app runs without immudb in dev/CI.
 */
@Injectable()
export class ImmudbService implements OnModuleInit, OnModuleDestroy {
  private client: any = null;
  private enabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.enabled = config.get<string>("IMMUDB_ENABLED", "true") !== "false";
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      getLogger("audit").event("audit.immudb.unavailable", {
        host: null,
        port: null,
        reason: "disabled via IMMUDB_ENABLED=false; audit writes go to PostgreSQL only",
      });
      return;
    }

    try {
      // immudb-node is an optional dependency. The specifier is held in a
      // variable so TypeScript does not try to resolve it: a literal needs a
      // suppression comment, and that comment is itself an error once the
      // package *is* installed, so the project failed to compile either way.
      const moduleName = "immudb-node";
      const ImmudbClient = (await import(moduleName)).default;

      const host = this.config.get<string>("IMMUDB_HOST", "127.0.0.1");
      const port = this.config.get<number>("IMMUDB_PORT", 8088);

      this.client = new ImmudbClient({ host, port, rootPath: "/tmp/immudb-root" });

      await this.client.login({
        user: this.config.get<string>("IMMUDB_USER", "immudb"),
        password: this.config.get<string>("IMMUDB_PASSWORD", "immudb"),
      });

      const db = this.config.get<string>("IMMUDB_DATABASE", "defaultdb");
      await this.client.useDatabase({ databasename: db }).catch(() => {
        // Database may already be selected; ignore
      });

      getLogger("audit").event("audit.immudb.connected", { host, port, database: db });
    } catch (err) {
      getLogger("audit").event("audit.immudb.failed", { operation: "connect", err });
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // Ignore logout errors on shutdown
      }
    }
  }

  get isConnected(): boolean {
    return this.client !== null;
  }

  /**
   * Write a key-value pair with cryptographic verification.
   * Returns the immudb transaction ID (or key if tx unavailable).
   */
  async verifiedSet(key: string, value: string): Promise<string> {
    if (!this.client) return key;
    try {
      const result = await this.client.verifiedSet({ key, value });
      return String(result?.id ?? result?.index ?? key);
    } catch (err) {
      getLogger("audit").event("audit.immudb.failed", { operation: "verifiedSet", err });
      return key;
    }
  }

  /**
   * Read and verify a key. Returns null when key not found or immudb unavailable.
   */
  async verifiedGet(key: string): Promise<ImmudbVerifyResult | null> {
    if (!this.client) return null;
    try {
      const result = await this.client.verifiedGet({ key });
      return {
        key: result.key ?? key,
        value: result.value ?? "",
        txId: result.id ?? result.index ?? "",
        verified: true,
      };
    } catch (err: any) {
      if (err?.clientErr === "proof") {
        return { key, value: "", txId: "", verified: false };
      }
      getLogger("audit").event("audit.immudb.failed", { operation: "verifiedGet", err });
      return null;
    }
  }

  /**
   * Scan entries by prefix. Used to query audit events by time range.
   */
  async scan(prefix: string, limit = 100): Promise<ImmudbScanEntry[]> {
    if (!this.client) return [];
    try {
      const result = await this.client.scan({ seekKey: prefix, prefix, limit, desc: false });
      return (result?.entries ?? []).map((e: any) => ({ key: e.key, value: e.value }));
    } catch (err) {
      getLogger("audit").event("audit.immudb.failed", { operation: "scan", err });
      return [];
    }
  }
}
