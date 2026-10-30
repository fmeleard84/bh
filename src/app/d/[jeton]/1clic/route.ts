import { desinscrire, lireJeton } from "@/server/flux/envoi";

export const dynamic = "force-dynamic";

/** Désabonnement en un clic des messageries (RFC 8058) : POST « List-Unsubscribe=One-Click ». */
export async function POST(_req: Request, { params }: { params: Promise<{ jeton: string }> }) {
  const id = lireJeton((await params).jeton);
  if (!id) return new Response("lien invalide", { status: 400 });
  await desinscrire(id, "désabonnement en un clic");
  return new Response("ok");
}

/** Un lien ouvert dans un navigateur mène à la page de confirmation. */
export async function GET(req: Request, { params }: { params: Promise<{ jeton: string }> }) {
  return Response.redirect(new URL(`/d/${(await params).jeton}`, req.url), 303);
}
