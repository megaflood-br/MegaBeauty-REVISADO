import { NextRequest } from "next/server";
import { handleEvolutionWebhookRequest } from "@/lib/evolution-webhook-http";

export async function POST(request: NextRequest) {
  return handleEvolutionWebhookRequest(request);
}
