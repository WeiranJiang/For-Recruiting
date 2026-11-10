import { handle, requireUser } from "@/lib/session";
import { loadSheet } from "@/lib/views";
export const GET = handle(async () => {
  const u = await requireUser();
  return Response.json(await loadSheet(u.id, u.rules));
});
