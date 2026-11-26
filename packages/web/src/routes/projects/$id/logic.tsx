import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/projects/$id/logic")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/projects/$id/enhance/logic", params });
  },
});
