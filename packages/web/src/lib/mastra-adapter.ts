import type { MastraClient } from "@mastra/client-js";

/**
 * MastraAgent adapter for CopilotKit integration
 * This provides a bridge between Mastra.ai agents and CopilotKit
 */
// Mirrors the adapter shape CopilotKit expects; kept as a class so the integration
// point stays recognisable.
// deliberate adapter shape.
export class MastraAgent {
  /**
   * Get remote agents from Mastra client
   * @param client - MastraClient instance
   * @returns Array of CopilotKit-compatible agents
   */
  static async getRemoteAgents(_client: MastraClient): Promise<unknown[]> {
    try {
      // TODO: Update this when Mastra client API is stable
      // The getAgents method may not be available in all versions
      console.warn("Mastra agent integration is not yet implemented");
      return [];
    } catch (error) {
      console.warn("Failed to fetch Mastra agents:", error);
      // Return empty array if Mastra is not available
      return [];
    }
  }
}
