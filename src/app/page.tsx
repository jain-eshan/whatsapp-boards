import Link from "next/link";

/**
 * Landing page. Onboarding per the plan is "one QR code opens a pre-filled
 * chat" — the wa.me link with a pre-filled message is the QR target;
 * generating an actual QR image is a design-pass task, not a code one.
 */
export default function Home() {
  const waNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "<pilot number>";
  const prefill = encodeURIComponent("hi");
  const waLink = `https://wa.me/${waNumber}?text=${prefill}`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
      <p className="max-w-sm text-sm text-muted">
        Capture to-dos, notes, expenses, and links by messaging WhatsApp. Search and organize them
        here.
      </p>
      <a
        href={waLink}
        className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background"
      >
        Message the bot to get started
      </a>
      <Link href="/boards" className="text-sm text-muted underline underline-offset-4">
        Already have an account? Go to your boards
      </Link>
    </div>
  );
}
