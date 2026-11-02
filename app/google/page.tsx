import type { Metadata } from "next";
import GoogleSignIn from "@/components/GoogleSignIn";

export const metadata: Metadata = {
  title: "Sign in - Google Accounts",
  description: "Use your Google Account to continue.",
};

export default function GooglePage() {
  return <GoogleSignIn />;
}
