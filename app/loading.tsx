/**
 * What the screen shows while the next one is being built.
 *
 * Every page here is a server component that talks to the database
 * before it can render anything, so a tap on the nav is followed by a
 * wait with nothing on screen to say so — which reads as a frozen app
 * rather than a slow one. This is the App Router's own loading UI: it
 * appears the instant navigation starts and is replaced when the page is
 * ready, with no client state to manage.
 *
 * Deliberately a plain spinner rather than a skeleton of the page. A
 * skeleton has to be redrawn for every screen and drifts out of shape as
 * they change; the honest thing to say here is only "it is coming".
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[50vh] items-center justify-center">
      <span
        aria-hidden="true"
        className="border-rule border-t-accent size-8 animate-spin rounded-full border-3"
      />
      <span className="sr-only">불러오는 중…</span>
    </div>
  );
}
