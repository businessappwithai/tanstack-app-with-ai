import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { WindowHelpButton } from '@/components/admin/window-help-button';
import { apiClient } from '@/lib/api-client';
import { ShieldCheck, ArrowLeft, Loader2, AlertCircle, Check } from 'lucide-react';

export const Route = createFileRoute('/admin/access-controls')({
  component: AccessControlsPage,
});

interface SysRole {
  sys_role_id: string;
  name: string;
  is_master_role: boolean;
  is_active: boolean;
}

interface TableMetadata {
  sys_table_id: string;
  table_name: string;
  name: string;
}

interface AccessGrant {
  sys_access_grant_id: string;
  kind: string;
  table_name: string;
  action: string;
  role_name: string;
  role_key: string;
  sys_role_id: string | null;
}

const OPS = ['read', 'create', 'update', 'delete'] as const;
type Op = typeof OPS[number];

const OP_LABEL: Record<Op, string> = {
  read: 'Read',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

function AccessControlsPage() {
  const queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');

  const { data: rolesData, isLoading: rolesLoading } = useQuery<{ data: SysRole[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
  });

  const { data: tablesData, isLoading: tablesLoading } = useQuery<{ data: TableMetadata[] }>({
    queryKey: ['admin', 'bus-tables'],
    queryFn: () => apiClient.get('/sys/tables'),
  });

  const { data: grantsData, isLoading: grantsLoading } = useQuery<{ data: AccessGrant[] }>({
    queryKey: ['admin', 'access-grants', selectedRoleId],
    queryFn: () =>
      apiClient.get(`/sys/access-grants${selectedRoleId ? `?roleId=${selectedRoleId}` : ''}`),
    enabled: !!selectedRoleId,
  });

  const roles = (rolesData?.data ?? []).filter((r) => !r.is_master_role && r.is_active);
  const tables = (tablesData?.data ?? []).filter((t) => t.table_name.startsWith('bus_'));

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'access-grants', selectedRoleId] });

  const selectedRole = roles.find((r) => r.sys_role_id === selectedRoleId);

  // Build a lookup: table_name → Set of granted ops
  const grantMap = useMemo(() => {
    const map = new Map<string, Map<Op, string>>();
    for (const g of grantsData?.data ?? []) {
      if (g.kind !== 'op') continue;
      if (!map.has(g.table_name)) map.set(g.table_name, new Map());
      map.get(g.table_name)!.set(g.action as Op, g.sys_access_grant_id);
    }
    return map;
  }, [grantsData?.data]);

  const addGrant = useMutation({
    mutationFn: ({ tableName, action }: { tableName: string; action: string }) =>
      apiClient.post('/sys/access-grants', {
        tableName,
        action,
        roleName: selectedRole!.name,
        kind: 'op',
      }),
    onSuccess: () => void refresh(),
  });

  const removeGrant = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/sys/access-grants/${id}`),
    onSuccess: () => void refresh(),
  });

  const toggleGrant = (tableName: string, op: Op) => {
    const id = grantMap.get(tableName)?.get(op);
    if (id) {
      removeGrant.mutate(id);
    } else {
      addGrant.mutate({ tableName, action: op });
    }
  };

  const isLoading = rolesLoading || tablesLoading;
  const busy = addGrant.isPending || removeGrant.isPending;

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
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">Access Controls</h1>
            <WindowHelpButton windowName="/admin/access-controls" entityLabel="Access Controls" />
          </div>
        </div>
      </header>

      <div className="container-swiss py-8 space-y-6">
        {isLoading && (
          <div className="swiss-card p-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
          </div>
        )}

        {!isLoading && (
          <>
            {/* Role picker */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-foreground" htmlFor="role-select">
                Role
              </label>
              <select
                id="role-select"
                value={selectedRoleId}
                onChange={(e) => setSelectedRoleId(e.target.value)}
                className="swiss-input h-9 text-sm min-w-[220px]"
              >
                <option value="">— select a role —</option>
                {roles.map((r) => (
                  <option key={r.sys_role_id} value={r.sys_role_id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                The Administrator role has unrestricted access and is not shown.
              </p>
            </div>

            {!selectedRoleId && (
              <div className="swiss-card p-10 text-center text-sm text-muted-foreground">
                Select a role above to view and edit its access grants.
              </div>
            )}

            {selectedRoleId && grantsLoading && (
              <div className="swiss-card p-8 text-center">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-primary" />
              </div>
            )}

            {selectedRoleId && !grantsLoading && tables.length === 0 && (
              <div className="swiss-card p-8 text-center">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No entities found in this application.</p>
              </div>
            )}

            {selectedRoleId && !grantsLoading && tables.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Entity</th>
                      {OPS.map((op) => (
                        <th key={op} className="px-4 py-3 font-semibold text-center text-foreground w-24">
                          {OP_LABEL[op]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map((table, idx) => {
                      const ops = grantMap.get(table.table_name);
                      return (
                        <tr
                          key={table.table_name}
                          className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                        >
                          <td className="px-4 py-2.5 font-medium text-foreground">
                            {table.name}
                            <span className="ml-2 text-xs text-muted-foreground font-mono">
                              {table.table_name}
                            </span>
                          </td>
                          {OPS.map((op) => {
                            const granted = ops?.has(op) ?? false;
                            return (
                              <td key={op} className="px-4 py-2.5 text-center">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => toggleGrant(table.table_name, op)}
                                  aria-label={`${granted ? 'Revoke' : 'Grant'} ${OP_LABEL[op]} on ${table.name}`}
                                  className={[
                                    'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                                    granted
                                      ? 'bg-primary border-primary text-primary-foreground hover:bg-primary/80'
                                      : 'border-border text-transparent hover:border-primary/50',
                                    busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                                  ].join(' ')}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
