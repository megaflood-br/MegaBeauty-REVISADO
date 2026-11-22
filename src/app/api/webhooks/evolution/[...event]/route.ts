import { NextRequest } from "next/server";
import { handleEvolutionWebhookRequest } from "@/lib/evolution-webhook-http";

/**
 * Supports Evolution servers configured with `WEBHOOK_BY_EVENTS=true`, which append
 * the event slug to the webhook path (e.g. `/api/webhooks/evolution/messages-upsert`).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ event: string[] }> },
) {
  const { event } = await context.params;
  const eventName = event.join(".");
  return handleEvolutionWebhookRequest(request, eventName);
}
