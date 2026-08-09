"use client";

import { createContext, useActionState, useContext, useRef, useState, type ReactNode } from "react";

/**
 * Lets whatever is inside a dialog close it once its work is done —
 * the edit form calls this after a save lands.
 *
 * A callback prop cannot cross the server/client boundary here: the
 * dialog and the form are both client components, but the tree between
 * them is rendered on the server, so it can pass elements and not
 * functions. Context is what reaches across it at runtime.
 *
 * Null outside a dialog, so the same form still works inline.
 */
const DialogCloseContext = createContext<(() => void) | null>(null);

export function useDialogClose(): (() => void) | null {
  return useContext(DialogCloseContext);
}

/**
 * A row that opens its details in a modal instead of unfolding beneath
 * itself.
 *
 * The list used to be a column of `<details>`: opening one pushed
 * everything below it down, and the form you were reading could be
 * anywhere on screen by the time it rendered. A transaction is a whole
 * record with a dozen fields — it wants the screen, not a gap in a list.
 *
 * `<dialog showModal>` rather than a hand-rolled overlay: focus
 * trapping, Escape, inertness of the page behind, and the top layer all
 * come with it, and every one of those is something a div gets wrong.
 */
export function RowDialog({
  trigger,
  title,
  closeLabel,
  children,
}: {
  /** The row itself, as it reads when closed. */
  trigger: ReactNode;
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => ref.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
        className="hover:bg-sunken w-full cursor-pointer px-4 py-3 text-left"
      >
        {trigger}
      </button>

      <dialog
        ref={ref}
        aria-label={title}
        // Escape and the form's own close both land here, so this is the
        // one place that knows the dialog is shut.
        onClose={() => setOpen(false)}
        // Clicks land on the <dialog> itself only when they miss the
        // panel inside it — that is the backdrop, and dismissing there is
        // what everything else on a phone does.
        onClick={(e) => {
          if (e.target === ref.current) close();
        }}
        className="bg-card rounded-card text-ink m-auto w-[min(42rem,calc(100vw-1.5rem))] p-0 backdrop:bg-black/50"
      >
        {/* Mounted only while open. A hundred rows each holding an edit
            form — every account in every picker — is a lot of client work
            for a list you are scrolling past, and their text would sit in
            the page's accessibility tree the whole time. */}
        <div className="max-h-[85vh] overflow-y-auto overscroll-contain">
          {open && (
            <>
              <div className="bg-card border-rule-soft sticky top-0 z-10 flex min-h-12 items-center gap-2 border-b px-4">
                <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label={closeLabel}
                  className="text-ink-faint hover:text-ink -mr-2 grid h-11 w-11 shrink-0 place-items-center text-xl"
                >
                  ✕
                </button>
              </div>
              {/* Following a link means leaving this dialog behind. Client
                  navigation does not unmount the row it belongs to, so
                  without this 복제 left the panel sitting on top of the
                  page it had just navigated to. */}
              <div
                className="px-4 py-3"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) close();
                }}
              >
                <DialogCloseContext value={close}>{children}</DialogCloseContext>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}

/**
 * A form inside a dialog whose action finishes the dialog's business —
 * 삭제, where leaving the panel open would show a record that no longer
 * exists.
 *
 * The close has to happen on the client after the action resolves. A
 * `redirect()` from the action would do it too, but redirect throws, and
 * a throw inside a `useActionState` reducer never resolves the
 * transition: the button would sit on its pending label forever.
 */
export function DialogActionForm({
  action,
  children,
  className = "",
}: {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  const close = useDialogClose();
  const [, dispatch] = useActionState(async (_state: null, formData: FormData) => {
    await action(formData);
    close?.();
    return null;
  }, null);

  return (
    <form action={dispatch} className={className}>
      {children}
    </form>
  );
}
