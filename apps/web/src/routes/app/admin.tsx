import { createFileRoute } from "@tanstack/react-router";
import { AdminSettings } from "~/calendar/components/AdminSettings";
import styles from "./admin.module.css";

export const Route = createFileRoute("/app/admin")({
  component: AdminRoute,
});

function AdminRoute() {
  return (
    <main className={styles.page} id="main-content" tabIndex={-1}>
      <AdminSettings />
    </main>
  );
}
