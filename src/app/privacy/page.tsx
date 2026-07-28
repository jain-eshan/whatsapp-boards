import Link from "next/link";

/**
 * Required by Meta before the WhatsApp app can be published — see the
 * Privacy section of the README, which this restates as an actual policy
 * rather than engineering notes. Keep the two in sync if either changes.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-sm leading-relaxed text-foreground">
      <Link href="/" className="text-xs text-muted underline underline-offset-4">
        &larr; Back home
      </Link>

      <h1 className="mt-6 mb-1 text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mb-10 text-xs text-muted">Last updated 29 July 2026.</p>

      <p className="mb-8">
        Boards is a personal capture tool: you message a WhatsApp number to save to-dos, notes,
        expenses, and links, and read them back on this website. This page explains what data that
        involves and what happens to it.
      </p>

      <Section title="Who operates this">
        <p>
          Eshan Jain, contactable at{" "}
          <a href="mailto:eshanjain2004@gmail.com" className="underline underline-offset-4">
            eshanjain2004@gmail.com
          </a>
          . This is currently a single-operator pilot, not a company.
        </p>
      </Section>

      <Section title="What's collected">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your WhatsApp phone number, used as your account identifier.</li>
          <li>The text of messages you send to capture or search — that's the product.</li>
          <li>Boards, titles, dates, and amounts parsed out of what you send.</li>
        </ul>
      </Section>

      <Section title="Third parties involved in processing">
        <p className="mb-2">
          Message text is sent to the following providers to make the product work. None of them
          retain your content beyond the request, per their stated policies at time of writing —
          verify current terms before relying on this if that matters to you.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>OpenRouter — routes messages to a language model to classify and answer them.</li>
          <li>Cloudflare Workers AI — generates the embeddings that power search.</li>
          <li>Meta / WhatsApp Cloud API — delivers and sends the messages themselves.</li>
          <li>Supabase — hosts the database, encrypted at rest.</li>
        </ul>
      </Section>

      <Section title="Retention and deletion">
        <p>
          Data is kept until you delete it. Sending <code className="text-xs">delete my data</code> to
          the bot deletes your account and every board and item under it, immediately and completely.
          There is no separate export or archival step — deletion is final.
        </p>
      </Section>

      <Section title="What this is not used for">
        <p>Your messages are not sold, shared with advertisers, or used to train models.</p>
      </Section>

      <Section title="Your rights">
        <p>
          Under India&rsquo;s Digital Personal Data Protection Act, you can request access to,
          correction of, or deletion of your data at any time — message{" "}
          <code className="text-xs">delete my data</code> for deletion, or email the address above
          for anything else.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
