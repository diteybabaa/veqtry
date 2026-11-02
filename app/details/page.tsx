import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import DetailsFlow from "@/components/DetailsFlow";

const serif = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Expert interview — Heineken",
  description: "Tell us a bit about yourself to take part in the expert interview.",
};

export default function DetailsPage() {
  return (
    <div className={serif.variable}>
      <DetailsFlow />
    </div>
  );
}
