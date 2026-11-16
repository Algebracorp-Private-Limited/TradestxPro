import { getSessionUser } from "@/lib/auth";
import { json } from "@/lib/api";

export async function GET() {
  const user = await getSessionUser();
  return user ? json({ ok: true, user }) : json({ ok: false, error: "Not signed in." }, 401);
}
