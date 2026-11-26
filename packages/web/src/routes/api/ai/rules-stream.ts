import { parseMermaidFlowchart } from "@appwithai/editors/lib/mermaid-flowchart-parser";
import { createFileRoute } from "@tanstack/react-router";
import OpenAI from "openai";
import { convertToJdm } from "@/lib/jdm-converter";
import { requireUser } from "@/lib/require-user";

const localAI = new OpenAI({
  apiKey: process.env.LOCAL_AI_API_KEY ?? "local",
  baseURL: process.env.LOCAL_AI_BASE_URL ?? "http://localhost:8000/v1",
});
const LOCAL_MODEL = process.env.LOCAL_AI_MODEL ?? "qwen3.6:27b-mlx";

function sse(controller: ReadableStreamDefaultController, encoder: TextEncoder, data: unknown) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

// AI-powered: natural language → Mermaid flowchart TD
async function generateFlowchart(
  description: string,
  currentFlowchartCode: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  sse(controller, encoder, {
    step: "analyzing",
    message: "Analyzing business rule description...",
  });

  const systemPrompt = `You are an expert at converting business rules into Mermaid flowchart diagrams.
Generate ONLY valid Mermaid flowchart syntax using the TD (top-down) direction.

Node types:
- A([text]) — start/end nodes (rounded rectangle with double brackets)
- B{text} — decision nodes (rhombus)
- C[text] — process/action nodes (rectangle)
- D((text)) — sub-process/function nodes (circle)

Edge labels for decisions use |label| syntax: B -->|Yes| C

Rules:
- Always start with "flowchart TD" on the first line
- Use meaningful single-word or short IDs (A, B, C or descriptive like OrderCheck)
- Every flowchart must have at least one start ([...]) and one end node
- Decision nodes must have at least two outgoing edges with labels
- Keep labels concise (under 40 characters)
- Return ONLY the Mermaid code, no markdown fences, no explanation`;

  const userPrompt =
    currentFlowchartCode?.trim() && currentFlowchartCode !== "flowchart TD"
      ? `Current flowchart:\n${currentFlowchartCode}\n\nUpdate or extend it based on: ${description}`
      : `Create a flowchart for: ${description}`;

  sse(controller, encoder, { step: "generating", message: "Generating Mermaid flowchart..." });

  const completion = await localAI.chat.completions.create({
    model: LOCAL_MODEL,
    max_tokens: 2048,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const rawText = completion.choices[0]?.message?.content;
  if (!rawText) throw new Error("Empty response from model");

  let flowchartCode = rawText.trim();
  flowchartCode = flowchartCode
    .replace(/^```(?:mermaid)?\n?/m, "")
    .replace(/```$/m, "")
    .trim();

  if (!flowchartCode.startsWith("flowchart")) {
    flowchartCode = `flowchart TD\n${flowchartCode}`;
  }

  sse(controller, encoder, { step: "complete", message: "Flowchart generated!", flowchartCode });
}

// Pure TypeScript AST-based conversion: Mermaid flowchart → GoRules JDM
function convertToJdmFromMermaid(
  flowchartCode: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  sse(controller, encoder, { step: "analyzing", message: "Parsing flowchart structure..." });

  const ast = parseMermaidFlowchart(flowchartCode);
  const jdm = convertToJdm(ast);

  sse(controller, encoder, { step: "complete", message: "JDM generated!", jdm });
}

export const Route = createFileRoute("/api/ai/rules-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await requireUser(request, "ai:rules", "write");
        if (caller.response) return caller.response;

        const encoder = new TextEncoder();

        try {
          const body = (await request.json()) as {
            action: string;
            description?: string;
            currentFlowchartCode?: string;
            flowchartCode?: string;
            projectId?: string;
          };

          const stream = new ReadableStream({
            async start(controller) {
              try {
                if (body.action === "generate-flowchart") {
                  if (!body.description) {
                    sse(controller, encoder, { step: "error", message: "Description is required" });
                  } else {
                    await generateFlowchart(
                      body.description,
                      body.currentFlowchartCode ?? "",
                      controller,
                      encoder
                    );
                  }
                } else if (body.action === "convert-to-jdm") {
                  if (!body.flowchartCode) {
                    sse(controller, encoder, {
                      step: "error",
                      message: "Flowchart code is required",
                    });
                  } else {
                    convertToJdmFromMermaid(body.flowchartCode, controller, encoder);
                  }
                } else {
                  sse(controller, encoder, {
                    step: "error",
                    message: `Unknown action: ${body.action}`,
                  });
                }
              } catch (err) {
                sse(controller, encoder, {
                  step: "error",
                  message: err instanceof Error ? err.message : "Unknown error",
                });
              } finally {
                controller.close();
              }
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "Request failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
