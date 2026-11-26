import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webRequire = createRequire(resolve(import.meta.dirname, "../../../../web/package.json"));
const React = webRequire("react");
const { render, screen, fireEvent, cleanup, waitFor } = webRequire("@testing-library/react/pure");
const templateRoot = resolve(
  import.meta.dirname,
  "../../../templates/tanstack-start-nestjs/frontend/src"
);
const navigate = vi.fn();
const refetch = vi.fn();
let recordsError: unknown = null;
const dashboard = {
  data: [
    {
      code: "sales",
      name: "Sales",
      entities: [
        { table_name: "bus_payment", name: "Payment" },
        { table_name: "bus_patient", name: "Patient" },
      ],
    },
  ],
  windows: [],
};
const box = ({ children }: any) => React.createElement("div", null, children);
const Button = ({ variant: _variant, size: _size, ...props }: any) =>
  React.createElement("button", props);
const cache = new Map<string, any>();

// Execute the shipped TSX, retaining real React state and Radix focus handling.
function load(file: string): any {
  if (cache.has(file)) return cache.get(file);
  const source = readFileSync(resolve(templateRoot, file), "utf8")
    .replace(/\{\{project.name\}\}/g, "Test App")
    .replace(/\{\{now\}\}/g, "test");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  const requireModule = (id: string): any => {
    if (id === "@tanstack/react-router")
      return {
        useNavigate: () => navigate,
        useLocation: () => ({ pathname: "/dashboard" }),
        Link: ({ children, to }: any) => React.createElement("a", { href: to }, children),
      };
    if (id === "@tanstack/react-query")
      return {
        useQuery: ({ queryKey }: any) =>
          queryKey[0] === "dashboard"
            ? { data: dashboard }
            : {
                data: undefined,
                isLoading: false,
                isError: !!recordsError,
                error: recordsError,
                refetch,
              },
        useMutation: () => ({}),
        useQueries: () => [],
        useQueryClient: () => ({}),
      };
    if (id === "@/lib/utils")
      return { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") };
    if (id === "@/lib/api-client")
      return {
        apiClient: {},
        isApiError: (error: any) => !!error?.statusCode,
        getErrorMessage: (error: any) => error.message,
      };
    if (id === "@/contexts/auth-context")
      return {
        useAuth: () => ({
          isAuthenticated: true,
          isLoading: false,
          user: { name: "Tester" },
          logout: vi.fn(),
        }),
      };
    if (id === "@/hooks/use-entities")
      return new Proxy({}, { get: () => () => ({ data: [], isLoading: false }) });
    if (id === "@/lib/field-schema") return {};
    if (id === "./record-load-error") return load("components/admin/record-load-error.tsx");
    if (id === "./ad-window-configs")
      return { buildAdminListUrl: () => "/admin", buildAdminDetailUrl: () => "/admin/record" };
    if (id.startsWith("./")) return new Proxy({}, { get: () => box });
    if (id === "@/components/layout")
      return {
        Sidebar: load("components/layout/sidebar.tsx.hbs").Sidebar,
        Header: load("components/layout/header.tsx").Header,
      };
    if (id === "@/components/ui/dialog") return load("components/ui/dialog.tsx");
    if (id === "@/components/ui/button") return { Button };
    if (id === "@/components/ui/scroll-area") return { ScrollArea: box };
    if (id === "@/components/ui/tooltip")
      return { Tooltip: box, TooltipContent: box, TooltipProvider: box, TooltipTrigger: box };
    if (id.startsWith("@/components/")) return new Proxy({}, { get: () => box });
    return webRequire(id);
  };
  new Function("require", "exports", code)(requireModule, exports);
  cache.set(file, exports);
  return exports;
}

beforeEach(() => {
  navigate.mockReset();
  refetch.mockReset();
  recordsError = null;
});
afterEach(cleanup);

describe("generated application navigation", () => {
  it("restores the full navigation when collapsing during a search", () => {
    render(React.createElement(load("components/layout/sidebar.tsx.hbs").Sidebar));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pay" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Collapse the navigation" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Patient" })).toBeTruthy();
  });

  it("searches, wraps the keyboard selection, and opens the selected screen", () => {
    render(React.createElement(load("components/layout/sidebar.tsx.hbs").Sidebar));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "pa" } });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith({ to: "/payment" });
    expect(input.value).toBe("");
  });

  it("opens mobile navigation and closes it after choosing a screen", () => {
    render(
      React.createElement(load("components/layout/app-layout.tsx").AppLayout, null, "Records")
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeTruthy();
    const input = screen.getAllByRole("combobox").at(-1);
    fireEvent.change(input, { target: { value: "pay" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith({ to: "/payment" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("closes mobile navigation with Escape and returns focus to the menu button", async () => {
  render(React.createElement(load("components/layout/app-layout.tsx").AppLayout, null, "Records"));
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Navigation" })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

const level = {
  label: "Payment",
  endpoint: "/bus/payment",
  idField: "id",
  nameField: "name",
  fields: [],
};

describe.each([
  [
    "entity-window-shell",
    "EntityWindowShell",
    { tableName: "bus_payment", entityLabel: "Payment" },
  ],
  ["ad-list-shell", "ADListShell", { level, parentContext: [] }],
  ["ad-window-shell", "ADWindowShell", { config: { levels: [level] } }],
] as const)("%s record errors", (file, name, props) => {
  it("shows access denied instead of inviting the user to create a record", () => {
    recordsError = { statusCode: 403, message: "Forbidden" };
    render(React.createElement(load(`components/admin/${file}.tsx`)[name], props));
    expect(screen.getByRole("alert").textContent).toContain("Access denied");
    expect(screen.queryByText("No records found")).toBeNull();
    expect(screen.queryByText(/Click \+ to create/)).toBeNull();
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe(
      "/dashboard"
    );
  });

  it("reports a network failure and allows retrying the request", () => {
    recordsError = new Error("Network unavailable");
    render(React.createElement(load(`components/admin/${file}.tsx`)[name], props));
    expect(screen.getByRole("alert").textContent).toContain("Unable to load records");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
