/**
 * ZenEngine Singleton
 *
 * Provides a single instance of GoRules zen-engine for rule evaluation.
 * Ensures efficient reuse of the Rust-based engine across the application.
 *
 * Key features:
 * - Singleton pattern for resource efficiency
 * - JDM (JSON Decision Model) validation and evaluation
 * - Async evaluation support
 * - Error handling with detailed error codes
 * - Type-safe inputs/outputs
 *
 * Created by: CORE-002 ticket
 * Week: 1
 */

import type { ZenEngineResponse } from "@gorules/zen-engine";
import { ZenDecisionContent, ZenEngine } from "@gorules/zen-engine";

export interface EvaluationResult {
  success: boolean;
  decision?: ZenEngineResponse;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

export interface EvaluationOptions {
  timeout?: number; // milliseconds
  trace?: boolean; // enable execution tracing
}

/**
 * Global ZenEngine singleton instance
 *
 * The zen-engine is a Rust-based JIT compiler for JSON Decision Models (JDM).
 * Creating multiple instances is expensive, so we use a singleton pattern.
 *
 * @see https://github.com/gorules/zen
 */
// The class encapsulates the private static instance and init flag that make it a
// singleton; see the doc comment above.
// deliberate singleton.
class ZenEngineSingleton {
  private static instance: ZenEngine | null = null;
  private static initialized = false;

  /**
   * Get or create the ZenEngine instance
   *
   * @returns {ZenEngine} The singleton ZenEngine instance
   * @throws {Error} If engine initialization fails
   */
  static getInstance(): ZenEngine {
    if (!ZenEngineSingleton.initialized) {
      try {
        ZenEngineSingleton.instance = new ZenEngine();
        ZenEngineSingleton.initialized = true;
      } catch (error) {
        throw new Error(
          `ENGINE_COMPILATION_ERROR: Failed to initialize ZenEngine: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    // instance is guaranteed to be set when initialized is true
    return ZenEngineSingleton.instance as ZenEngine;
  }

  /**
   * Reset the singleton (primarily for testing)
   *
   * @internal
   */
  static _reset(): void {
    ZenEngineSingleton.instance = null;
    ZenEngineSingleton.initialized = false;
  }

  /**
   * Evaluate a JSON Decision Model (JDM) with input data
   *
   * @param jdm - The JSON Decision Model (rule definition)
   * @param input - Input data/facts for the rule evaluation
   * @param options - Evaluation options (timeout, tracing)
   * @returns {Promise<EvaluationResult>} Evaluation result with decision or error
   *
   * @example
   * ```typescript
   * const result = await ZenEngineSingleton.evaluate({
   *   jdm: { nodes: [...], edges: [...] },
   *   input: { userRole: "admin", amount: 1000 }
   * });
   *
   * if (result.success && result.decision) {
   *   console.log("Decision:", result.decision.result);
   * }
   * ```
   */
  static async evaluate(
    jdm: unknown,
    input: Record<string, unknown>,
    options: EvaluationOptions = {}
  ): Promise<EvaluationResult> {
    const engine = ZenEngineSingleton.getInstance();

    try {
      // Validate JDM structure (basic check)
      if (!jdm || typeof jdm !== "object") {
        return {
          success: false,
          error: {
            code: "INVALID_FORMAT",
            message: "JDM must be a valid object",
            details: `Received: ${typeof jdm}`,
          },
        };
      }

      // Validate input data
      if (!input || typeof input !== "object") {
        return {
          success: false,
          error: {
            code: "INVALID_DATA_TYPE",
            message: "Input data must be an object",
            details: `Received: ${typeof input}`,
          },
        };
      }

      // Create a ZenDecision from JDM content
      const content = new ZenDecisionContent(jdm as object);
      const decision = engine.createDecision(content);

      // Evaluate with optional tracing
      const evaluationPromise = decision.evaluate(input, {
        trace: options.trace ?? false,
      });

      let result: ZenEngineResponse;

      if (options.timeout) {
        // Apply timeout wrapper
        result = await Promise.race([
          evaluationPromise,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`RULE_TIMEOUT: Evaluation exceeded ${options.timeout}ms`)),
              options.timeout
            )
          ),
        ]);
      } else {
        result = await evaluationPromise;
      }

      return {
        success: true,
        decision: result,
      };
    } catch (error) {
      // Handle known error types
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("RULE_TIMEOUT")) {
        return {
          success: false,
          error: {
            code: "RULE_TIMEOUT",
            message: `Rule evaluation timed out after ${options.timeout}ms`,
            details: errorMessage,
          },
        };
      }

      if (errorMessage.includes("parse") || errorMessage.includes("syntax")) {
        return {
          success: false,
          error: {
            code: "ENGINE_COMPILATION_ERROR",
            message: "Failed to compile decision model",
            details: errorMessage,
          },
        };
      }

      if (errorMessage.includes("node") || errorMessage.includes("edge")) {
        // The engine reports a node's failure as JSON — `{"nodeId":"i","source":"/status: null
        // is not of type \"string\""}` — and the old catch-all called all of them "invalid JDM
        // structure", so a record with a blank field read as a broken graph.
        const node = /\{[^{}]*"nodeId"[^{}]*\}/.exec(errorMessage)?.[0];
        let reason: string | undefined;
        try {
          const parsed = node ? (JSON.parse(node) as { source?: unknown }) : undefined;
          if (typeof parsed?.source === "string") reason = parsed.source;
        } catch {
          /* not JSON after all — fall through to the structural wording */
        }
        return {
          success: false,
          error: {
            code: "RULE_EVALUATION_FAILED",
            message: reason
              ? `Rule evaluation failed: ${reason}`
              : "Rule evaluation failed: invalid JDM structure",
            details: errorMessage,
          },
        };
      }

      // Generic error
      return {
        success: false,
        error: {
          code: "RULE_EVALUATION_FAILED",
          message: "Rule evaluation failed",
          details: errorMessage,
        },
      };
    }
  }

  /**
   * Validate a JDM without executing it
   *
   * This checks if the JDM structure is valid and can be compiled.
   *
   * @param jdm - The JSON Decision Model to validate
   * @returns {Promise<{ valid: boolean; error?: string }>} Validation result
   */
  static async validate(jdm: unknown): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!jdm || typeof jdm !== "object") {
        return { valid: false, error: "JDM must be a valid object" };
      }

      // Attempt to compile (this validates structure without execution)
      const engine = ZenEngineSingleton.getInstance();
      const content = new ZenDecisionContent(jdm as object);
      const decision = engine.createDecision(content);
      // Validate decision structure
      decision.validate();

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Export singleton methods directly for cleaner API
export const zenEngine = {
  evaluate: (jdm: unknown, input: Record<string, unknown>, options?: EvaluationOptions) =>
    ZenEngineSingleton.evaluate(jdm, input, options),
  validate: (jdm: unknown) => ZenEngineSingleton.validate(jdm),
  _reset: () => ZenEngineSingleton._reset(), // For testing only
  getInstance: () => ZenEngineSingleton.getInstance(), // For advanced usage
};

export default ZenEngineSingleton;
