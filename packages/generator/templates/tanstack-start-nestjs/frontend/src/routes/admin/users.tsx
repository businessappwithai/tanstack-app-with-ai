import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Users, ArrowLeft, Shield, Loader2, AlertCircle, UserPlus } from 'lucide-react';
import { RowActions, errorText } from '@/components/admin/row-actions';

export const Route = createFileRoute('/admin/users')({
  component: UsersPage,
});

interface SysUser {
  sys_user_id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  roles?: string[];
}

interface SysRoleOption {
  sys_role_id: string;
  name: string;
}

const EMPTY_USER = { name: '', email: '', password: '', roleName: 'User' };

function UsersPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<{ data: SysUser[] }>({
    queryKey: ['admin', 'sys-users'],
    queryFn: () => apiClient.get('/sys/users'),
  });

  // This screen is the only way an account comes into existence — the
  // application has no sign-up page and the server refuses public sign-up.
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_USER);
  const [editingId, setEditingId] = useState<string | null>(null);

  // The roles an account can hold — for a new account, and for one being edited.
  const { data: rolesData } = useQuery<{ data: SysRoleOption[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
    enabled: showForm || editingId !== null,
  });
  const roles = rolesData?.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'sys-users'] });

  const createUser = useMutation({
    mutationFn: (input: typeof EMPTY_USER) => apiClient.post('/sys/users', input),
    onSuccess: () => {
      setForm(EMPTY_USER);
      setShowForm(false);
      void refresh();
    },
  });

  const users = data?.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="container-swiss">
          <div className="flex h-14 items-center gap-3">
            <Link
              to="/dashboard"
              aria-label="Back to dashboard"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Users className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">User Management</h1>
            <button
              type="button"
              onClick={() => setShowForm((open) => !open)}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <UserPlus className="w-4 h-4" />
              {showForm ? 'Cancel' : 'New user'}
            </button>
          </div>
        </div>
      </header>

      <div className="container-swiss py-8">
        {showForm && (
          <form
            className="swiss-card mb-6 p-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              createUser.mutate(form);
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Name</span>
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Email</span>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">
                  Password (8 characters or more)
                </span>
                <input
                  required
                  minLength={8}
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Role</span>
                <select
                  value={form.roleName}
                  onChange={(event) => setForm({ ...form, roleName: event.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                >
                  {roles.length === 0 && <option value="User">User</option>}
                  {roles.map((r) => (
                    <option key={r.sys_role_id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {createUser.isError && (
              <p className="text-sm text-destructive">
                {errorText(createUser.error, 'Could not create the account')}
              </p>
            )}
            <button
              type="submit"
              disabled={createUser.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {createUser.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create account
            </button>
          </form>
        )}
        {isLoading && (
          <div className="swiss-card p-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
          </div>
        )}
        {error && (
          <div className="swiss-alert-error p-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p>Failed to load users</p>
          </div>
        )}
        {!isLoading && !error && (
          <div className="swiss-card overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Roles</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) =>
                  editingId === u.sys_user_id ? (
                    <EditUserRow
                      key={u.sys_user_id}
                      user={u}
                      roles={roles}
                      onDone={() => {
                        setEditingId(null);
                        void refresh();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <tr key={u.sys_user_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3">
                        {u.roles?.length ? (
                          <div className="flex gap-1 flex-wrap">
                            {u.roles.map((r) => (
                              <span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                                <Shield className="w-3 h-3" />{r}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">No roles</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <RowActions
                          label={u.name}
                          onEdit={() => setEditingId(u.sys_user_id)}
                          remove={() => apiClient.delete(`/sys/users/${u.sys_user_id}`)}
                          onRemoved={() => void refresh()}
                        />
                      </td>
                    </tr>
                  ),
                )}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No users found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One account, open for editing. Only what changed is sent; the password is
 * sent only when one is typed. Deactivating ends the person's access at once.
 */
function EditUserRow({
  user,
  roles,
  onDone,
  onCancel,
}: {
  user: SysUser;
  roles: SysRoleOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [isActive, setIsActive] = useState(user.is_active);
  const [held, setHeld] = useState<string[]>(user.roles ?? []);
  const [password, setPassword] = useState('');

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (name !== user.name) body.name = name;
      if (email !== user.email) body.email = email;
      if (isActive !== user.is_active) body.isActive = isActive;
      const before = [...(user.roles ?? [])].sort().join('|');
      if ([...held].sort().join('|') !== before) body.roleNames = held;
      if (password) body.password = password;
      return apiClient.patch(`/sys/users/${user.sys_user_id}`, body);
    },
    onSuccess: onDone,
  });

  return (
    <tr className="border-b border-border last:border-0 bg-muted/20">
      <td colSpan={5} className="px-4 py-4">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Name</span>
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">New password (leave empty to keep)</span>
              <input
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
          </div>
          <fieldset className="text-sm">
            <legend className="mb-1 text-muted-foreground">Roles</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {roles.map((r) => (
                <label key={r.sys_role_id} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={held.includes(r.name)}
                    onChange={(event) =>
                      setHeld((current) =>
                        event.target.checked ? [...current, r.name] : current.filter((n) => n !== r.name),
                      )
                    }
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            <span>Active — clear to stop this person signing in, at once</span>
          </label>
          {save.isError && (
            <p className="text-sm text-destructive">{errorText(save.error, 'Could not save the account')}</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}
