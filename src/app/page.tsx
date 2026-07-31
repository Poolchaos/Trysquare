import { redirect } from "next/navigation";

export default function HomePage() {
  // Projects is where every flow starts, so the root is not a screen of its own.
  redirect("/projects");
}
