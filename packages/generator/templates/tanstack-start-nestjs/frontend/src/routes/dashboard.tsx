import { useState, useEffect } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import {
  ArrowRight,
  FileText,
  Search,
  Loader2,
  AlertCircle,
  Database,
  LayoutGrid,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { Button, buttonVariants } from '@/components/ui/button';
import { toast } from 'sonner';
import { APP_NAME } from "@/lib/app-meta";

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
});

interface TableMetadata {
  sys_table_id: string;
  table_name: string;
  name: string;
  description?: string;
  icon?: string;
  is_active: boolean;
}

/** A dictionary category with the entities assigned to it. */
interface CategoryGroup {
  sys_category_id: string | null;
  name: string;
  code: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  entities: TableMetadata[];
}

/**
 * Categories with their entities, already ordered by category name server-side.
 * The dashboard renders one block per category, separated by a rule.
 */
/**
 * The whole dashboard in one request.
 *
 * `/sys/categories/dashboard` answers with the categories, the entities inside
 * them, the admin windows this caller may open and their role — from a single
 * SQL statement that resolves the roles itself. It replaced two calls here
 * (`/sys/categories/with-entities` and `/me/permissions`) over six queries.
 */
function useDashboard(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiClient.get<DashboardResponse>('/sys/categories/dashboard'),
    staleTime: 5 * 60 * 1000,
    // A signed-out visitor is about to be sent to the sign-in page; asking the
    // API first only logs a 401 for a request nobody can answer.
    enabled,
  });
}

interface DashboardResponse {
  data: CategoryGroup[];
  role: string;
  isMaster: boolean;
  windows: {
    sys_window_id: string;
    name: string;
    /** The window's route, held in `sys_window.description`. */
    route: string;
    /** A lucide icon id, or a `data:` URI for an uploaded one. May be null. */
    icon: string | null;
    category: string;
    is_read_only: boolean;
  }[];
}

function Dashlet({
  name,
  description,
  icon,
  href,
}: {
  name: string;
  // Optional: callers deliberately pass `undefined` for a dashlet that has
  // nothing to add beyond its name.
  description?: string;
  /*
   * What the dictionary says this thing looks like: a lucide icon id, or a
   * `data:` URI for an image someone uploaded. Null when it says nothing, and
   * then a default is drawn — a card is never withheld for want of an icon.
   *
   * It used to be `any`, because admin cards passed an imported React
   * component while entity cards passed a name. Both sides read the dictionary
   * now, so there is one kind of value and `Icon` is the only thing that has to
   * understand it.
   */
  icon?: string | null;
  href: string;
}) {
  return (
    <Link to={href} className="block group">
      <div className="swiss-card p-5 hover:border-primary/50 transition-all h-full">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              {icon ? (
                <Icon name={icon} size={20} className="text-primary" />
              ) : (
                <FileText className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                {name}
              </h3>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-3 line-clamp-2 leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </Link>
  );
}

function DashboardPage() {
  /*
   * One query for the business section, not three.
   *
   * `/sys/categories/with-entities` is the whole of it: the server decides
   * which entities are business entities, drops the line items, and scopes the
   * result to this caller's read rights — in a single join. Two further calls
   * used to run beside it, `/sys/tables?prefix=bus_` and
   * `/sys/tables?entity_type=U&limit=100`, reproducing that same filter in the
   * browser *unscoped by role and including line items*, and their result was
   * rendered nowhere whenever any category existed. They are gone.
   */
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: dashboard, isLoading: categoriesLoading, error } = useDashboard(isAuthenticated);
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  /*
   * An administrator's dashboard is the Application Dictionary, not the
   * business records.
   *
   * The master role exists to administer the application — define entities,
   * grant access, write rules — and putting every business entity in front of
   * it buried the eight cards it actually came for under twenty-six it did not.
   * So the entity blocks start collapsed for an administrator and for nobody
   * else, and this opens them: an administrator diagnosing a record still needs
   * to reach one, and a screen with no way through is its own problem.
   */
  const [showEntitiesAsAdmin, setShowEntitiesAsAdmin] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate({ to: '/auth/login' });
    }
  }, [authLoading, isAuthenticated, navigate]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) return null;




  /*
   * The admin cards, entirely from the dictionary.
   *
   * Name, route and icon all come off `sys_window`, and which of them appear
   * is `sys_access` for this caller's roles — the same grant the screens
   * themselves are guarded by, so the dashboard cannot offer a window that
   * then refuses.
   *
   * This used to run each window through a hard-coded name-to-icon map and
   * drop anything the map did not name. That is a gate, not a fallback:
   * `System Configuration` was seeded, granted to the admin role, and missing
   * from the dashboard for every user including master — while four entries in
   * the map named windows that no longer existed. A window with no icon gets a
   * default one now; it is never withheld.
   */
  const adminWindowsFromPerms = (dashboard?.windows ?? [])
    .filter((w) => w.category === 'admin' && !!w.route && w.route !== '/admin/automations' && w.route !== '/admin/workflow-definitions')
    .map((w) => ({
      name: w.name,
      href: w.route,
      icon: w.icon,
      is_read_only: w.is_read_only,
    }));

  const query = searchQuery.toLowerCase().trim();

  const filteredAdmin = query
    ? adminWindowsFromPerms.filter(d => d.name.toLowerCase().includes(query))
    : adminWindowsFromPerms;

  // Entities grouped by category, alphabetical by category name. The search box
  // filters within each group and drops groups that end up empty.
  const categoryGroups = (dashboard?.data ?? [])
    .map((group) => ({
      ...group,
      entities: query
        ? group.entities.filter(
            (t) =>
              t.name.toLowerCase().includes(query) ||
              t.table_name.toLowerCase().includes(query) ||
              (t.description?.toLowerCase().includes(query) ?? false),
          )
        : group.entities,
    }))
    .filter((group) => group.entities.length > 0);

  const groupedEntityCount = categoryGroups.reduce((sum, g) => sum + g.entities.length, 0);

  /** True for the master role only — not for a caller the dictionary has never heard of. */
  const isAdministrator = dashboard?.isMaster === true;
  const entitiesVisible = !isAdministrator || showEntitiesAsAdmin;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      {/*
        * No page header here any more.
        *
        * This screen used to draw its own: the application name, a search box,
        * the avatar, the notification bell, the theme toggle and a log-out
        * button. `AppLayout` now provides all of that on every screen, so
        * keeping this one meant two stacked headers on the dashboard and none
        * anywhere else — a reader who opened a record lost the bell and the
        * way out until they navigated back.
        *
        * The search box is the exception and it stays, moved into the page
        * below. It is not a global search: it filters the cards on this
        * screen, which is a different thing from the record search `ADToolbar`
        * runs on an entity, and there is no third meaning for it to have.
        */}

      <div className="container-swiss py-8 space-y-10">
        <h1 className="sr-only">Dashboard</h1>
        {/* The card filter. Its own control on the page rather than chrome in
            a header, because that is what it is: it narrows what is shown
            below and means nothing anywhere else in the application. */}
        <div className="relative max-w-sm">
          <input
            type="text"
            placeholder="Filter entities and screens..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="swiss-input h-9 w-full pl-9 pr-8 text-sm"
            aria-label="Filter the cards on this screen"
          />
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear the filter"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* The manual, above everything else.

            The manual is served dynamically by GET /bus/manual — every
            entity, every field, the processes it runs and the decisions it
            makes — built fresh from the live application dictionary on every request. It is a
            plain anchor rather than a route because the backend owns the response; it
            opens in a new tab, since a
            reader wants it beside the screen it describes. */}
        <ManualBanner />

        {/* Loading */}
        {categoriesLoading && (
          <div className="swiss-card p-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
            <p className="text-muted-foreground mt-4 text-sm">Loading entities...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="swiss-alert-error p-12 text-center">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-semibold">Failed to load entities</p>
            <p className="text-sm text-muted-foreground mt-1">
              Unable to fetch entity list from Application Dictionary
            </p>
          </div>
        )}

        {/* Business Entities — grouped by category, ordered by category name.
            Each group is introduced by its name above a separating rule. */}
        {!categoriesLoading && !error && groupedEntityCount > 0 && entitiesVisible && (
          <section data-testid="dashboard-categories">
            {categoryGroups.map((group) => (
              <div
                key={group.code}
                className="mb-10 last:mb-0"
                data-testid={`category-group-${group.code}`}
              >
                {/* Category name sits above the line that separates this group */}
                <div className="flex items-baseline gap-2 mb-2">
                  {group.icon ? (
                    <Icon
                      name={group.icon}
                      size={16}
                      className="text-primary self-center"
                      style={group.color ? { color: group.color } : undefined}
                    />
                  ) : (
                    <Database className="w-4 h-4 text-primary self-center" />
                  )}
                  <h2
                    className="section-header mb-0"
                    style={group.color ? { color: group.color } : undefined}
                    data-testid={`category-name-${group.code}`}
                  >
                    {group.name}
                  </h2>
                  <span className="font-mono-display text-muted-foreground">
                    ({group.entities.length})
                  </span>
                </div>

                <hr className="border-t border-border mb-5" />

                {group.description && (
                  <p className="text-sm text-muted-foreground -mt-3 mb-5">{group.description}</p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.entities.map((table) => (
                    <Dashlet
                      key={table.table_name}
                      name={table.name}
                      description={table.description || `Manage ${table.name} records`}
                      icon={table.icon}
                      href={`/${table.name.toLowerCase().replace(/\s+/g, '-')}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* The way back to the business entities, for an administrator only.
            Everyone else sees them above and needs no control at all. */}
        {isAdministrator && !error && groupedEntityCount > 0 && (
          <div className="flex items-center justify-between gap-3 swiss-card p-4">
            <p className="text-sm text-muted-foreground">
              {showEntitiesAsAdmin
                ? `Showing this application's ${groupedEntityCount} business entities.`
                : `This application has ${groupedEntityCount} business entities. They are hidden here because you are signed in as an administrator.`}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowEntitiesAsAdmin((shown) => !shown)}
            >
              {showEntitiesAsAdmin ? 'Hide business entities' : 'Show business entities'}
            </Button>
          </div>
        )}

        {/* Automations — administrator only */}
        {isAdministrator && (
          <section>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Dashlet
                name="Automations"
                description="Rules and workflows"
                icon="zap"
                href="/admin/automations"
              />
            </div>
          </section>
        )}

        {/* Access controls summary — administrator only */}
        {isAdministrator && <AccessControlsBanner />}

        {/* Admin / Dictionary */}
        {filteredAdmin.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-5">
              <LayoutGrid className="w-4 h-4 text-primary" />
              <h2 className="section-header mb-0">
                Application Dictionary
              </h2>
              <span className="font-mono-display text-muted-foreground">({filteredAdmin.length})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAdmin.map((d) => (
                <Dashlet
                  key={d.href}
                  name={d.name}
                  description={d.is_read_only ? 'View only' : undefined}
                  icon={d.icon}
                  href={d.href}
                />
              ))}
            </div>
          </section>
        )}

        {/* Start over without re-running the setup.

            A generated application arrives with seeded rows so that it can be
            looked at, and whoever has finished looking wants their own data in
            it — which otherwise meant deleting every record by hand, entity by
            entity. Set apart from the dashlet grid rather than sitting in it:
            it is the one control here that cannot be undone, and a destructive
            action that looks like the cards around it is one somebody presses
            by accident.

            Administrator-only, and the server agrees independently —
            DictionaryWriteGuard refuses every non-GET on /sys from anyone else,
            so hiding it here is courtesy rather than the enforcement. */}
        {dashboard?.isMaster && <PurgeBusinessData />}

        {/* Empty search */}
        {!categoriesLoading && !error && query && (groupedEntityCount === 0 || !entitiesVisible) && filteredAdmin.length === 0 && (
          <div className="swiss-card p-12 text-center">
            <Search className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="font-semibold">No results for &ldquo;{searchQuery}&rdquo;</p>
            <p className="text-sm text-muted-foreground mt-1">Try a different search term</p>
          </div>
        )}

        {/*
          A role that may read nothing gets told so.

          `%%rbac … .read` decides what a role sees, and the seeded `User`
          account holds no functional role at all — deliberately, because an
          account that can reach nothing is what demonstrates that a
          restriction restricts. Rendered as bare emptiness it reads as a
          broken build, so it says which of the two it is.
        */}
        {!categoriesLoading && !error && !query && groupedEntityCount === 0 && filteredAdmin.length === 0 && (
          <div className="swiss-card p-12 text-center">
            <Database className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="font-semibold">Nothing to show</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose mx-auto">
              This account holds no role that may read any of this
              application&rsquo;s entities. That is what the model says rather
              than a fault: <code>%%rbac</code> grants read access by role, and
              this one has none. Sign out and pick a role account to see the
              application it was given.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ManualBanner() {
  return (
    <section className="flex flex-wrap items-center gap-5 rounded-lg border border-border border-l-4 border-l-primary bg-card p-5">
      <div className="flex-1 min-w-[20rem]">
        <h2 className="text-sm font-semibold mb-1">Manual</h2>
        <p className="text-sm text-muted-foreground max-w-prose">
          Every kind of record {APP_NAME} keeps, every field on it, the processes it runs and
          the decisions it makes &mdash; written from the same model this application was
          generated from.
        </p>
      </div>
      {/* An anchor wearing the button's classes: this Button renders a
          <button>, and it has no `asChild`, so a real link is the only way to
          get a new tab out of it. */}
      <a
        href="/api/bus/manual"
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        Open the manual
      </a>
    </section>
  );
}

function AccessControlsBanner() {
  const { data } = useQuery<{ roles: number; grants: number }>({
    queryKey: ['dashboard', 'access-grants-summary'],
    queryFn: () => apiClient.get('/sys/access-grants/summary'),
    staleTime: 30 * 1000,
  });

  return (
    <section className="flex flex-wrap items-center gap-5 rounded-lg border border-border border-l-4 border-l-primary bg-card p-5">
      <div className="flex items-center gap-3 flex-shrink-0">
        <ShieldCheck className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-[20rem]">
        <h2 className="text-sm font-semibold mb-1">Access Controls</h2>
        <p className="text-sm text-muted-foreground">
          {data
            ? `${data.roles} role${data.roles !== 1 ? 's' : ''}, ${data.grants} operation grant${data.grants !== 1 ? 's' : ''} across all entities.`
            : 'Who may read, create, update and delete each entity — by role.'}
        </p>
      </div>
      <Link
        to="/admin/access-controls"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        Edit access controls
      </Link>
    </section>
  );
}

function PurgeBusinessData() {
  const queryClient = useQueryClient();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const result = await apiClient.post<{ deleted: number; tables: number }>(
        '/sys/purge-business-data',
        {},
      );
      toast.success(`Deleted ${result.deleted} record(s) across ${result.tables} table(s)`);
      // Every count on this screen is now wrong, and a stale dashboard after a
      // purge reads as the purge having failed.
      await queryClient.invalidateQueries();
      setArmed(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the records');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10 rounded-lg border border-border border-l-4 border-l-destructive bg-card">
      <div className="p-5">
        <h2 className="text-sm font-semibold mb-1">Start from an empty database</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-prose">
          {armed
            ? 'Every business record is deleted — the seeded rows and anything you have added. The model, the dictionary, the rules and the accounts are untouched. This cannot be undone.'
            : 'Deletes every business record and leaves the application itself in place.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {armed ? (
            <>
              <Button variant="destructive" size="sm" onClick={run} disabled={busy}>
                {busy ? 'Deleting…' : 'Yes, delete every record'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setArmed(false)} disabled={busy}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setArmed(true)}>
              Delete all records
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
