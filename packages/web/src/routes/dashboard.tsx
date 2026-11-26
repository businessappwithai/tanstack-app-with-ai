import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  ArrowRight,
  Code2,
  Database,
  FileCode,
  GitBranch,
  LayoutDashboard,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { requestContext } from "@/lib/request-context";

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    try {
      const data = await checkAuthMe();
      if (!data.user) throw redirect({ to: "/login" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/login" });
    }
  },
  component: DashboardPage,
});

const features = [
  {
    title: "Visual ERD Designer",
    description: "Create and edit Entity-Relationship diagrams with AI assistance",
    icon: Database,
    href: "/designer",
    color: "from-blue-500 to-cyan-500",
    features: ["Mermaid ERD Syntax", "AI-Powered Suggestions", "Real-time Preview"],
  },
  {
    title: "Natural Language Design",
    description: "Describe your database in plain English, AI creates the ERD",
    icon: Sparkles,
    href: "/designer?mode=ai",
    color: "from-violet-500 to-purple-500",
    features: ["AI Entity Extraction", "Smart Relationships", "Auto-generation"],
  },
  {
    title: "Code Generation",
    description: "Generate Kysely migrations, SQL DDL, and more",
    icon: FileCode,
    href: "/designer?tab=generate",
    color: "from-emerald-500 to-teal-500",
    features: ["Kysely Migrations", "SQL DDL", "Multiple Dialects"],
  },
  {
    title: "Human-in-the-Loop",
    description: "Review and approve AI suggestions before generation",
    icon: Users,
    href: "/approval",
    color: "from-orange-500 to-red-500",
    features: ["Entity Approval", "Relationship Review", "Workflow Control"],
  },
  {
    title: "Full-Stack Generation",
    description: "Generate a TanStack Start frontend and a NestJS backend from your ERD",
    icon: Code2,
    href: "/generator",
    color: "from-pink-500 to-rose-500",
    features: [
      "TanStack Start + Shadcn",
      "NestJS + Kysely",
      "Application Dictionary",
      "Business Rules",
    ],
  },
  {
    title: "Database Connection",
    description: "Connect to PostgreSQL, MySQL, SQLite and inspect schemas",
    icon: GitBranch,
    href: "/designer?panel=database",
    color: "from-indigo-500 to-blue-500",
    features: ["Schema Inspection", "Reverse Engineering", "Multi-Database"],
  },
];

const quickActions = [
  {
    title: "Start New Design",
    description: "Create a new ERD from scratch",
    icon: Database,
    href: "/designer",
    action: "Create",
  },
  {
    title: "Use AI Assistant",
    description: "Describe your database in natural language",
    icon: Sparkles,
    href: "/designer?ai=true",
    action: "Describe",
  },
  {
    title: "Import Schema",
    description: "Import from existing database or file",
    icon: FileCode,
    href: "/designer?action=import",
    action: "Import",
  },
];

function DashboardPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <header className="border-b bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LayoutDashboard className="h-6 w-6 text-primary" />
              <div>
                <h1 className="text-xl font-bold">
                  <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
                    APPWITHAI
                  </span>
                  <span className="ml-2 text-sm font-normal text-muted-foreground">v0.01</span>
                </h1>
                <p className="text-xs text-muted-foreground">AI-Powered Database Design Platform</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/"
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Home
              </Link>
              <Link
                to="/designer"
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
              >
                <Zap className="h-4 w-4" />
                Open Designer
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold">Welcome to Your Dashboard</h2>
          <p className="text-lg text-muted-foreground">
            Design, generate, and deploy database schemas with AI assistance
          </p>
        </div>

        <div className="mb-12">
          <h3 className="mb-4 text-xl font-semibold">Quick Actions</h3>
          <div className="grid gap-4 md:grid-cols-3">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.title}
                  to={action.href}
                  className="group relative overflow-hidden rounded-lg border bg-card p-6 transition-all hover:border-primary hover:shadow-lg"
                >
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-primary/10 p-3">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="mb-1 font-semibold">{action.title}</h4>
                      <p className="text-sm text-muted-foreground">{action.description}</p>
                      <div className="mt-3 flex items-center gap-2 text-sm font-medium text-primary">
                        {action.action}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-xl font-semibold">All Features</h3>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <Link
                  key={feature.title}
                  to={feature.href}
                  className="group relative overflow-hidden rounded-xl border bg-card transition-all hover:border-primary hover:shadow-xl"
                >
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 transition-opacity group-hover:opacity-5`}
                  />

                  <div className="relative p-6">
                    <div
                      className={`mb-4 inline-flex rounded-lg bg-gradient-to-br ${feature.color} p-3`}
                    >
                      <Icon className="h-6 w-6 text-white" />
                    </div>

                    <h4 className="mb-2 text-lg font-semibold">{feature.title}</h4>
                    <p className="mb-4 text-sm text-muted-foreground">{feature.description}</p>

                    <ul className="space-y-1">
                      {feature.features.map((item) => (
                        <li
                          key={item}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <div className="h-1 w-1 rounded-full bg-primary" />
                          {item}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-4 flex items-center gap-2 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                      Explore
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-2xl font-bold text-primary">6</div>
            <div className="text-sm text-muted-foreground">Core Features</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-2xl font-bold text-primary">4</div>
            <div className="text-sm text-muted-foreground">Stack Generators</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-2xl font-bold text-primary">5</div>
            <div className="text-sm text-muted-foreground">Database Dialects</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-2xl font-bold text-primary">AI</div>
            <div className="text-sm text-muted-foreground">Powered Design</div>
          </div>
        </div>
      </main>

      <footer className="mt-12 border-t bg-card/50 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>APPWITHAI v0.01 - AI-Powered Database Schema Designer</p>
          <p className="mt-1">
            Built with TanStack Start, CopilotKit, Mastra.ai, and Anthropic Claude
          </p>
        </div>
      </footer>
    </div>
  );
}
