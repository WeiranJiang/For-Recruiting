import { connection } from "next/server";
import { AppShell } from "@/components/AppShell";

export default async function Page() {
  // Render per request so the CSP nonce from src/proxy.ts can be applied to Next's scripts.
  await connection();
  return <AppShell />;
}
