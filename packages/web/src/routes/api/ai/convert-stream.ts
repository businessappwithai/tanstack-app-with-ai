import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/require-user";

export const Route = createFileRoute("/api/ai/convert-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await requireUser(request, "ai:convert", "write");
        if (caller.response) return caller.response;

        try {
          const body = await request.json();
          const { description, currentErdCode } = body as {
            description: string;
            currentErdCode?: string;
          };

          if (!description || typeof description !== "string") {
            return new Response(JSON.stringify({ error: "Description is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const encoder = new TextEncoder();

          const stream = new ReadableStream({
            async start(controller) {
              const send = (data: Record<string, unknown>) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              };

              // Send a heartbeat every 5 s so the client knows we're still alive
              const heartbeat = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(": heartbeat\n\n"));
                } catch {
                  clearInterval(heartbeat);
                }
              }, 5000);

              try {
                send({
                  step: "analyzing",
                  message: "Analyzing business domain and entity relationships...",
                });

                const { analyzeDomainWithOpenAI, generateMermaidWithValidation } = await import(
                  "@appwithai/ai"
                );

                const domainAnalysis = await analyzeDomainWithOpenAI(
                  description,
                  currentErdCode ?? ""
                );

                if (!domainAnalysis) {
                  send({
                    step: "error",
                    message: "AI returned an empty domain analysis — please try again.",
                  });
                  return;
                }

                send({ step: "generating", message: "Building entity model and relationships..." });

                const { mermaidSyntax } = await generateMermaidWithValidation(
                  domainAnalysis.entities,
                  domainAnalysis.relationships
                );

                if (!mermaidSyntax) {
                  send({
                    step: "error",
                    message: "AI returned an empty diagram — please try again with more detail.",
                  });
                  return;
                }

                send({ step: "validating", message: "Validating ERD diagram syntax..." });
                send({ mermaidSyntax });
              } catch (error) {
                const raw = error instanceof Error ? error.message : "Conversion failed";
                // "Connection error." names no service and no remedy. The model server is
                // the one thing this route cannot work without, so say that it did not answer.
                const unreachable = /connection error|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(raw);
                const message = unreachable
                  ? `The AI service did not answer. Start the model server (LOCAL_AI_BASE_URL, default ${
                      process.env.LOCAL_AI_BASE_URL ?? "http://127.0.0.1:8000/v1"
                    }) or check its address, then try again.`
                  : raw;
                send({ step: "error", message });
              } finally {
                clearInterval(heartbeat);
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
        } catch (error) {
          console.error("Convert-stream error:", error);
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Conversion failed",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
