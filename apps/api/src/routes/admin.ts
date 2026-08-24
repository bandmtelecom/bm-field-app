import { Router, Request } from 'express';
import { admin, getCaller } from '../supabase.js';

export const adminRouter = Router();

// Ban far in the future = a hard lockout that Supabase honors at the auth layer.
const BAN_FOREVER = '876000h'; // ~100 years

type Caller = { id: string; role: string } | null;

async function gate(req: Request): Promise<{ ok: true; caller: NonNullable<Caller> } | { ok: false; code: number }> {
  const caller = await getCaller(req.headers.authorization) as Caller;
  if (!caller) return { ok: false, code: 401 };
  if (caller.role !== 'admin') return { ok: false, code: 403 };
  return { ok: true, caller };
}

/** GET /admin/users — list every account with its role + active flag. */
adminRouter.get('/admin/users', async (req, res) => {
  const g = await gate(req);
  if (!g.ok) return res.status(g.code).json({ error: g.code === 401 ? 'unauthorized' : 'forbidden' });

  const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return res.status(500).json({ error: error.message });

  const { data: profiles } = await admin
    .from('profiles').select('id, full_name, role, is_active');
  const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  const users = (list?.users ?? []).map((u) => {
    const p: any = pmap.get(u.id) ?? {};
    return {
      id: u.id,
      email: u.email,
      full_name: p.full_name ?? '',
      role: p.role ?? 'tech',
      is_active: p.is_active ?? true,
      last_sign_in_at: u.last_sign_in_at ?? null,
    };
  }).sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));

  res.json({ users });
});

/** POST /admin/users — create an account { email, password, full_name, role }. */
adminRouter.post('/admin/users', async (req, res) => {
  const g = await gate(req);
  if (!g.ok) return res.status(g.code).json({ error: g.code === 401 ? 'unauthorized' : 'forbidden' });

  const { email, password, full_name, role } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const wanted = role === 'admin' || role === 'office' ? role : 'tech';

  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: full_name ?? '' },
  });
  if (error) return res.status(400).json({ error: error.message });

  // the on-signup trigger created a profile row; set role/name/active on it.
  const uid = data.user.id;
  await admin.from('profiles')
    .update({ role: wanted, full_name: full_name ?? null, is_active: true })
    .eq('id', uid);

  res.json({ ok: true, id: uid });
});

/** PATCH /admin/users/:id — change role and/or activate/deactivate (kill switch). */
adminRouter.patch('/admin/users/:id', async (req, res) => {
  const g = await gate(req);
  if (!g.ok) return res.status(g.code).json({ error: g.code === 401 ? 'unauthorized' : 'forbidden' });

  const id = req.params.id;
  const { role, is_active } = req.body ?? {};

  if (is_active === false && id === g.caller.id) {
    return res.status(400).json({ error: "You can't deactivate your own account." });
  }

  // Admin resetting somebody's password. Before this, a tech who forgot his
  // password had to be deleted and recreated — which loses the link between him
  // and every visit he ever filed.
  const { password } = req.body ?? {};
  if (typeof password === 'string' && password.length) {
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return res.status(400).json({ error: error.message });
  }

  const patch: Record<string, unknown> = {};
  if (role === 'admin' || role === 'office' || role === 'tech') patch.role = role;
  if (typeof is_active === 'boolean') patch.is_active = is_active;
  if (Object.keys(patch).length) {
    const { error } = await admin.from('profiles').update(patch).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
  }

  // enforce the kill switch at the auth layer too: banned users can't get a token.
  if (typeof is_active === 'boolean') {
    await admin.auth.admin.updateUserById(id, { ban_duration: is_active ? 'none' : BAN_FOREVER });
  }

  res.json({ ok: true });
});
