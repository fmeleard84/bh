import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { sysSql } from "./db";

const COOKIE = "bh_session";
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET!);

export interface SessionUser {
  id: string;
  email: string;
  nom: string;
  superAdmin: boolean;
}

export async function login(email: string, password: string): Promise<boolean> {
  const [u] = await sysSql()`select id, mot_de_passe_hash from hub.utilisateurs where email = ${email.trim()} and actif`;
  if (!u?.mot_de_passe_hash || !(await bcrypt.compare(password, u.mot_de_passe_hash))) return false;
  const token = await new SignJWT({ sub: u.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("14d").sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 14 * 86400 });
  return true;
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const [u] = await sysSql()`select id, email, nom, super_admin from hub.utilisateurs where id = ${String(payload.sub)} and actif`;
    return u ? { id: u.id, email: u.email, nom: u.nom, superAdmin: u.super_admin } : null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
