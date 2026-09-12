import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AdminSettings } from "~/calendar/components/AdminSettings";
import { buttonClassName } from "~/ui/Button";
import styles from "./admin.module.css";

export const Route = createFileRoute("/app/admin")({
  component: AdminRoute,
});

function AdminRoute() {
  return (
    <main className={styles.page} id="main-content" tabIndex={-1}>
      <header className={styles.header}>
        <Link className={buttonClassName({ size: "compact", variant: "ghost" })} to="/app">
          <ArrowLeft aria-hidden="true" size={16} />
          Back to calendar
        </Link>
        <h1>Announcements</h1>
      </header>
      <AdminSettings headingLevel={2} />
    </main>
  );
}
