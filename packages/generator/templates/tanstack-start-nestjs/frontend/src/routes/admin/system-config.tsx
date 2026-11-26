import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { WindowHelpButton } from '@/components/admin/window-help-button';
import { apiClient } from '@/lib/api-client';
import { Settings, ArrowLeft, Loader2, AlertCircle, Save, Eye, EyeOff, Power, PowerOff } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/admin/system-config')({
  component: SystemConfigPage,
});

interface ConfigRow {
  sys_system_id: string;
  config_key: string;
  config_value: string;
  data_type: string;
  category: string;
  description: string;
  is_sensitive: boolean;
  is_active: boolean;
}

const CATEGORY_ORDER = ['app_identity', 'ai', 'features', 'rate_limiting', 'logging', 'cors', 'general'];
const CATEGORY_LABELS: Record<string, string> = {
  app_identity: 'Application Identity',
  ai: 'AI Configuration',
  features: 'Feature Toggles',
  rate_limiting: 'Rate Limiting',
  logging: 'Logging',
  cors: 'CORS',
  general: 'General',
};

function SystemConfigPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<ConfigRow[]>({
    queryKey: ['admin', 'system-config'],
    queryFn: () => apiClient.get('/sys/system-config'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; config_value?: string; is_active?: boolean }) =>
      apiClient.patch(`/sys/system-config/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'system-config'] }),
  });

  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const rows = data ?? [];
  const grouped = new Map<string, ConfigRow[]>();
  for (const row of rows) {
    const cat = row.category || 'general';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(row);
  }

  const sortedCategories = [...grouped.keys()].sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a)) -
              (CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b))
  );

  const handleSave = (row: ConfigRow) => {
    const newValue = editValues[row.sys_system_id];
    if (newValue !== undefined && newValue !== row.config_value) {
      updateMutation.mutate({ id: row.sys_system_id, config_value: newValue });
    }
  };

  const handleToggleActive = (row: ConfigRow) => {
    updateMutation.mutate({ id: row.sys_system_id, is_active: !row.is_active });
  };

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
            <Settings className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">System Configuration</h1>
            <WindowHelpButton windowName="System Configuration" entityLabel="System Configuration" />
          </div>
        </div>
      </header>

      <div className="container-swiss py-8 space-y-6">
        {isLoading && (
          <div className="swiss-card p-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
          </div>
        )}
        {error && (
          <div className="swiss-alert-error p-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p>Failed to load system configuration</p>
          </div>
        )}
        {!isLoading && !error && sortedCategories.map((category) => {
          const catRows = grouped.get(category) ?? [];
          return (
            <div key={category} className="swiss-card overflow-hidden">
              <div className="px-4 py-3 bg-muted/40 border-b border-border">
                <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">
                  {CATEGORY_LABELS[category] ?? category}
                </h2>
              </div>
              <div className="divide-y divide-border">
                {catRows.map((row) => {
                  const isEditing = editValues[row.sys_system_id] !== undefined;
                  const currentValue = isEditing ? editValues[row.sys_system_id]! : row.config_value;
                  const isDirty = isEditing && editValues[row.sys_system_id] !== row.config_value;
                  const isRevealed = revealedKeys.has(row.config_key);
                  const isTextArea = row.data_type === 'text';

                  return (
                    <div key={row.sys_system_id} className={`px-4 py-4 ${!row.is_active ? 'opacity-50' : ''}`}>
                      <div className="flex items-start justify-between gap-4 mb-1">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono font-medium">{row.config_key}</code>
                            {row.is_sensitive && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 dark:bg-amber-900/30 dark:text-amber-400">
                                sensitive
                              </span>
                            )}
                          </div>
                          {row.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{row.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {row.is_sensitive && (
                            <button
                              onClick={() => toggleReveal(row.config_key)}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                              title={isRevealed ? 'Hide value' : 'Reveal value'}
                            >
                              {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleActive(row)}
                            className={`p-1.5 rounded hover:bg-muted ${row.is_active ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}
                            title={row.is_active ? 'Deactivate (fall back to env var)' : 'Activate'}
                          >
                            {row.is_active ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                          </button>
                          {isDirty && (
                            <button
                              onClick={() => handleSave(row)}
                              disabled={updateMutation.isPending}
                              className="p-1.5 rounded hover:bg-muted text-primary"
                              title="Save changes"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {isTextArea ? (
                        <textarea
                          value={row.is_sensitive && !isRevealed ? '********' : currentValue}
                          onChange={(e) => setEditValues((prev) => ({ ...prev, [row.sys_system_id]: e.target.value }))}
                          disabled={row.is_sensitive && !isRevealed}
                          rows={4}
                          placeholder="Describe what this application does: its business domain, the entities it manages, the workflows it automates, and the value it provides to its users."
                          className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm font-mono resize-y min-h-[6rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      ) : row.data_type === 'boolean' ? (
                        <select
                          value={currentValue}
                          onChange={(e) => setEditValues((prev) => ({ ...prev, [row.sys_system_id]: e.target.value }))}
                          className="mt-1 px-3 py-1.5 rounded-md border border-input bg-background text-sm"
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          type={row.is_sensitive && !isRevealed ? 'password' : 'text'}
                          value={row.is_sensitive && !isRevealed ? '********' : currentValue}
                          onChange={(e) => setEditValues((prev) => ({ ...prev, [row.sys_system_id]: e.target.value }))}
                          disabled={row.is_sensitive && !isRevealed}
                          className="w-full mt-1 px-3 py-1.5 rounded-md border border-input bg-background text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
