import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import InterviewQueued from "@/components/InterviewQueued";

const serif = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Interview queued — Heineken",
  description: "Your expert interview is in queue. You will get an email about the time for the interview.",
  robots: { index: false, follow: false },
};

export default function QueuedPage() {
  return (
    <div className={serif.variable}>
      <InterviewQueued />
    </div>
  );
}
