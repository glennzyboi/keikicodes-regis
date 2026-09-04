"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseParent, currentParent } from "@/lib/parent-auth";
import { parseForm, safeNext, SignInForm, SignUpForm, ProfileForm } from "@/lib/forms";

export type AuthState = { error: string | null };

/**
 * Sign in and sign up.
 *
 * Both answer with the same message when they fail. "No account with that
 * email" tells a stranger which families use Keiki Coders, and with children
 * involved that is not a question anyone gets to ask by guessing addresses.
 */
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseForm(SignInForm, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { email, password } = parsed.data;
  const next = safeNext(parsed.data.next);

  const supabase = await supabaseParent();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "That email and password do not match." };

  redirect(next);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parseForm(SignUpForm, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { email, password, fullName } = parsed.data;
  const next = safeNext(parsed.data.next);

  const supabase = await supabaseParent();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    // Supabase reports an existing address distinctly. Deliberately flattened,
    // for the same reason as above.
    return { error: "We could not create that account. Try signing in instead." };
  }

  // Creates the parents row on first sight, and claims an existing record with
  // the same email if there is one.
  await currentParent();

  redirect(next);
}

export async function signOutParent() {
  const supabase = await supabaseParent();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

/** A parent editing their own details. Their name and phone, nothing else. */
export async function updateProfile(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parent = await currentParent();
  if (!parent) redirect("/login");

  const parsed = parseForm(ProfileForm, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { fullName, phone } = parsed.data;

  const { sql } = await import("@/lib/db");
  await sql`update parents set full_name = ${fullName}, phone = ${phone}
             where id = ${parent.id}`;

  revalidatePath("/portal");
  return { error: null };
}
