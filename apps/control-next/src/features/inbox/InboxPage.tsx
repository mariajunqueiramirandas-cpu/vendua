import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, MessagesSquare } from 'lucide-react';
import { useIsDesktop, useIsWide } from '@/lib/hooks.ts';
import { Page } from '@/components/Page.tsx';
import { EmptyState } from '@/components/common.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { AgentSwitch, AgentToggleButton, Conversation, threadSubtitle } from './Conversation.tsx';
import { useInboxFilters } from './filters.ts';
import { LeadContext } from './LeadContext.tsx';
import { NewThreadSheet } from './NewThreadSheet.tsx';
import { useThread } from './queries.ts';
import { InboxFilters, ThreadList, useInboxList } from './ThreadList.tsx';

/**
 * ≥1280: list | conversation | lead context. 1024–1279: list | conversation,
 * context in a sheet. <1024: `/inbox` is the list, `/inbox/:threadId` the
 * conversation — separate routes, so browser back works.
 */
export default function InboxPage() {
  const { threadId } = useParams();
  const desktop = useIsDesktop();
  const [newOpen, setNewOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const { qs } = useInboxFilters();
  // "outras conversas" links navigate from inside the sheet
  useEffect(() => setCtxOpen(false), [threadId]);

  const body = desktop ? (
    <DesktopInbox
      threadId={threadId}
      onNew={() => setNewOpen(true)}
      onContext={() => setCtxOpen(true)}
    />
  ) : threadId ? (
    <PhoneThread threadId={threadId} onContext={() => setCtxOpen(true)} />
  ) : (
    <PhoneList onNew={() => setNewOpen(true)} />
  );

  return (
    <>
      {body}
      <NewThreadSheet open={newOpen} onOpenChange={setNewOpen} qs={qs} />
      {threadId && <ContextSheet threadId={threadId} open={ctxOpen} onOpenChange={setCtxOpen} />}
    </>
  );
}

function DesktopInbox({
  threadId,
  onNew,
  onContext,
}: {
  threadId: string | undefined;
  onNew: () => void;
  onContext: () => void;
}) {
  const wide = useIsWide();
  const list = useInboxList();
  const thread = useThread(threadId);
  const view = thread.data?.thread.id === threadId ? thread.data : undefined;

  return (
    <Page title="Inbox" count={list.shown} bleed>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r">
          <InboxFilters counts={list.counts} onNew={onNew} className="border-b p-3" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ThreadList list={list} activeId={threadId} />
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {threadId ? (
            <Conversation threadId={threadId} header onContext={wide ? undefined : onContext} />
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="escolha uma conversa"
              hint="ou comece uma nova pelo botão + da lista"
              className="flex-1"
            />
          )}
        </section>
        {wide && view && (
          <aside className="w-[300px] shrink-0 overflow-y-auto border-l p-4">
            <LeadContext view={view} />
          </aside>
        )}
      </div>
    </Page>
  );
}

function PhoneList({ onNew }: { onNew: () => void }) {
  const list = useInboxList();
  return (
    <Page
      title="Inbox"
      count={list.shown}
      toolbar={<InboxFilters counts={list.counts} onNew={onNew} />}
      bleed
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ThreadList list={list} />
      </div>
    </Page>
  );
}

function PhoneThread({ threadId, onContext }: { threadId: string; onContext: () => void }) {
  const { qs } = useInboxFilters();
  const thread = useThread(threadId);
  const view = thread.data?.thread.id === threadId ? thread.data : undefined;
  return (
    <Page
      back={`/inbox${qs}`}
      title={
        view ? (
          // tapping the name opens the lead context, like a chat app's contact header
          <button
            type="button"
            onClick={onContext}
            className="flex min-w-0 flex-col items-start text-left"
            aria-label={`contexto de ${view.lead.name}`}
          >
            <span className="flex max-w-full items-center gap-1 truncate text-base leading-tight">
              <span className="truncate">{view.lead.name}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </span>
            <span className="max-w-full truncate text-xs leading-tight font-normal text-muted-foreground">
              {threadSubtitle(view)}
            </span>
          </button>
        ) : (
          'conversa'
        )
      }
      actions={view && <AgentToggleButton view={view} />}
      bleed
    >
      <Conversation threadId={threadId} />
    </Page>
  );
}

function ContextSheet({
  threadId,
  open,
  onOpenChange,
}: {
  threadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const thread = useThread(threadId);
  const view = thread.data?.thread.id === threadId ? thread.data : undefined;
  if (!view) return null;
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="contexto do lead"
      width="max-w-sm"
    >
      <div className="flex flex-col gap-4">
        <AgentSwitch view={view} className="rounded-md border px-3 py-2" />
        <LeadContext view={view} />
      </div>
    </ResponsiveSheet>
  );
}
