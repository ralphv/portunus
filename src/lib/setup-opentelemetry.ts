import { registerOTel } from "@vercel/otel";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";

// Registers the OpenTelemetry SDK so Next.js auto-instruments route handlers
// and fetches. Opt-in via env:
//   OTEL_EXPORTER_OTLP_ENDPOINT  → export spans to that OTLP collector
//   OTEL_TRACES_EXPORTER=console → print each finished span to stdout
// With neither set, tracing stays off entirely.
export function setupOpenTelemetry(): void {
  const toConsole = process.env.OTEL_TRACES_EXPORTER === "console";
  if (!toConsole && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  registerOTel({
    serviceName: "portunus",
    traceExporter: toConsole ? new ConsoleSpanExporter() : "auto",
  });
}
