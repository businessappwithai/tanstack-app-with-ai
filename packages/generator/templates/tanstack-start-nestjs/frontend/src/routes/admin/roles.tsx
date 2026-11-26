import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { WindowHelpButton } from '@/components/admin/window-help-button';
import { apiClient } from '@/lib/api-client';
import { UserCog, ArrowLeft, Loader2, AlertCircle, Star, Plus } from 'lucide-react';
import { RowActions, errorText } from '@/components/admin/row-actions';

export const Route = createFileRoute('/admin/roles')({
  component: RolesPage,
});

interface SysRole {
  sys_role_id: string;
  name: string;
  description?: string;
  is_master_role: boolean;
  is_active: boolean;
  user_count?: number;
}

const EMPTY_ROLE = { name: '', description: '', isMasterRole: false };

function RolesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<{ data: SysRole[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
  });

  // Administrators only — the server refuses anyone else with a 403.
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_ROLE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'sys-roles'] });

  const createRole = useMutation({
    mutationFn: (input: typeof EMPTY_ROLE) => apiClient.post('/sys/roles', input),
    onSuccess: () => {
      setForm(EMPTY_ROLE);
      setShowForm(false);
      void refresh();
    },
  });

  const roles = data?.data ?? [];

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
            <UserCog className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">Role Management</h1>
            <WindowHelpButton windowName="/admin/roles" entityLabel="Role" />
            <button
              type="button"
              onClick={() => setShowForm((open) => !open)}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="w-4 h-4" />
              {showForm ? 'Cancel' : 'New role'}
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
              createRole.mutate(form);
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Name</span>
                <input
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Description</span>
                <input
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isMasterRole}
                onChange={(event) => setForm({ ...form, isMasterRole: event.target.checked })}
              />
              <span>Master role (sees and changes everything, like the administrator)</span>
            </label>
            {createRole.isError && (
              <p className="text-sm text-destructive">
                {errorText(createRole.error, 'Could not create the role')}
              </p>
            )}
            <button
              type="submit"
              disabled={createRole.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {createRole.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create role
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
            <p>Failed to load roles</p>
          </div>
        )}
        {!isLoading && !error && (
          <div className="swiss-card overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) =>
                  editingId === r.sys_role_id ? (
                    <EditRoleRow
                      key={r.sys_role_id}
                      role={r}
                      onDone={() => {
                        setEditingId(null);
                        void refresh();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                  <tr key={r.sys_role_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium flex items-center gap-2">
                      {r.is_master_role && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />}
                      {r.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.description ?? '—'}</td>
                    <td className="px-4 py-3">
                      {r.is_master_role ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Master</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">Standard</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${r.is_active ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
                        {r.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        label={r.name}
                        onEdit={() => setEditingId(r.sys_role_id)}
                        remove={() => apiClient.delete(`/sys/roles/${r.sys_role_id}`)}
                        onRemoved={() => void refresh()}
                      />
                    </td>
                  </tr>
                  ),
                )}
                {roles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No roles found</td>
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
 * One role, open for editing. The server decides what may change: a role the
 * model's access rules name keeps its name (renaming it would take its access
 * away), and Administrator and User keep theirs. Its refusal is shown here.
 */
function EditRoleRow({
  role,
  onDone,
  onCancel,
}: {
  role: SysRole;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [isMasterRole, setIsMasterRole] = useState(role.is_master_role);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (name.trim() !== role.name) body.name = name;
      if (description !== (role.description ?? '')) body.description = description;
      if (isMasterRole !== role.is_master_role) body.isMasterRole = isMasterRole;
      return apiClient.patch(`/sys/roles/${role.sys_role_id}`, body);
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Name</span>
              <input
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Description</span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isMasterRole} onChange={(event) => setIsMasterRole(event.target.checked)} />
            <span>Master role (sees and changes everything, like the administrator)</span>
          </label>
          {save.isError && (
            <p className="text-sm text-destructive">{errorText(save.error, 'Could not save the role')}</p>
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
