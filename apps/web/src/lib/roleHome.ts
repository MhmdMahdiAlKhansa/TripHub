/**
 * Where a person lands after signing in, and what their account button says:
 * staff go to their desk, business members to their business, everyone else to their trips.
 */
export type Workspace = { kind: 'staff' | 'business' | 'customer'; href: (locale: string) => string; role?: string };

export async function workspaceOf(): Promise<Workspace> {
  try {
    const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
    if (!me.ok) return { kind: 'customer', href: (l) => `/${l}/profile` };
    const { user } = (await me.json()) as { user: { platformRole: string } };
    if (user.platformRole && user.platformRole !== 'NONE') return { kind: 'staff', role: user.platformRole, href: (l) => `/${l}/admin` };
    const cs = await fetch('/api/v1/companies', { credentials: 'same-origin' });
    if (cs.ok) {
      const { companies } = (await cs.json()) as { companies: Array<{ id: string; role: string }> };
      if (companies.length === 1) return { kind: 'business', role: companies[0]!.role, href: (l) => `/${l}/business/${companies[0]!.id}` };
      if (companies.length > 1) return { kind: 'business', href: (l) => `/${l}/business` };
    }
  } catch {
    /* fall through to the customer home */
  }
  return { kind: 'customer', href: (l) => `/${l}/profile` };
}
