import { signOut } from "@/auth";
import { buttonClass } from "./ui";

export function LogoutButton({ label, full = false }: { label: string; full?: boolean }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
      className={full ? "w-full" : undefined}
    >
      <button type="submit" className={buttonClass("ghost", full)}>
        {label}
      </button>
    </form>
  );
}
