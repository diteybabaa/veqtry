import Image from "next/image";
import SecurityVerification from "@/components/SecurityVerification";

/**
 * The reCAPTCHA keys are read by the server (app/api/captcha) at request time,
 * so this page needs no keys of its own: `SecurityVerification` asks the API
 * whether to render the real widget, the demo replica, or nothing at all.
 */
export default function Page() {
  return (
    <main className="stage">
      {/* Background photo: drop your own asset at public/hero.png */}
      <Image
        src="/hero.png"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="100vw"
        className="stage__photo"
      />
      <div className="stage__veil" aria-hidden="true" />

      <SecurityVerification />
    </main>
  );
}
