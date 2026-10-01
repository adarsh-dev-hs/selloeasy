'use client';
import { textSourceSchema, type OrgSource, type SourceStatus, type SourceType, type UploadUrlResponse, type Visibility } from '@selloeasy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  FileType2,
  Globe,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  StickyNote,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton, Table, TBody, THead, TR } from '@/components/ui/misc';
import { Tip } from '@/components/ui/tooltip';
import { errorMessage, get, post, patch, del } from '@/lib/api';
import { cn, formatDate, timeAgo } from '@/lib/utils';
import { ConfirmDialog, KQ, VisibilityToggle, fieldErrors, formatBytes } from './shared';

const BUSY: SourceStatus[] = ['PENDING', 'PROCESSING'];
export const MAX_UPLOAD_MB = 20;

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXT));
export const ACCEPT = '.pdf,.md,.markdown,.txt,.docx,application/pdf,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function mimeFor(file: File): string | null {
  if (file.type && ALLOWED_MIME.has(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? null;
}

/** Sources list; polls every 2 s while anything is still processing and refreshes onboarding state when it settles. */
export function useSources() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KQ.sources,
    queryFn: () => get<OrgSource[]>('/org/sources'),
    refetchInterval: (query) => (query.state.data?.some((s) => BUSY.includes(s.status)) ? 2000 : false),
  });
  const busy = !!q.data?.some((s) => BUSY.includes(s.status));
  const wasBusy = React.useRef(busy);
  React.useEffect(() => {
    if (wasBusy.current && !busy) void qc.invalidateQueries({ queryKey: KQ.org });
    wasBusy.current = busy;
  }, [busy, qc]);
  return q;
}

export function SourceStatusChip({ source }: { source: Pick<OrgSource, 'status' | 'error'> }) {
  const map: Record<SourceStatus, { label: string; variant: 'secondary' | 'default' | 'success' | 'destructive'; icon: React.ReactNode }> = {
    PENDING: { label: 'Queued', variant: 'secondary', icon: <Clock className="size-3" /> },
    PROCESSING: { label: 'Processing', variant: 'default', icon: <Loader2 className="size-3 animate-spin" /> },
    READY: { label: 'Ready', variant: 'success', icon: <CheckCircle2 className="size-3" /> },
    FAILED: { label: 'Failed', variant: 'destructive', icon: <AlertCircle className="size-3" /> },
  };
  const m = map[source.status];
  const chip = (
    <Badge variant={m.variant} aria-live="polite">
      {m.icon} {m.label}
    </Badge>
  );
  return source.status === 'FAILED' && source.error ? (
    <Tip content={source.error}>
      <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {chip}
      </span>
    </Tip>
  ) : (
    chip
  );
}

const TYPE_ICON: Record<SourceType, typeof Globe> = { WEBSITE: Globe, PDF: FileType2, DOC: FileText, TEXT: StickyNote };
const TYPE_LABEL: Record<SourceType, string> = { WEBSITE: 'Website', PDF: 'PDF', DOC: 'Document', TEXT: 'Text' };

/** Mutations over a single source row. */
export function useSourceActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: KQ.sources });
    void qc.invalidateQueries({ queryKey: KQ.org });
  };
  const visibility = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: Visibility }) => patch<OrgSource>(`/org/sources/${id}`, { visibility }),
    onMutate: async ({ id, visibility }) => {
      await qc.cancelQueries({ queryKey: KQ.sources });
      const prev = qc.getQueryData<OrgSource[]>(KQ.sources);
      qc.setQueryData<OrgSource[]>(KQ.sources, (d) => d?.map((s) => (s.id === id ? { ...s, visibility } : s)));
      return { prev };
    },
    onSuccess: (s) => toast.success(`“${s.title}” is now ${s.visibility === 'PUBLIC' ? 'public' : 'internal'}`),
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KQ.sources, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: KQ.sources }),
  });
  const reprocess = useMutation({
    mutationFn: (id: string) => post<OrgSource>(`/org/sources/${id}/reprocess`),
    onSuccess: () => {
      toast.success('Re-processing started');
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/org/sources/${id}`),
    onSuccess: () => {
      toast.success('Source deleted');
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const download = async (id: string) => {
    try {
      const { url } = await get<{ url: string }>(`/org/sources/${id}/download`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return { visibility, reprocess, remove, download };
}

// ────────────────────────────────────────────────────────────────────────────
// Sources table
// ────────────────────────────────────────────────────────────────────────────

export function SourcesTable({
  canWrite,
  filter,
  emptyTitle = 'No sources yet',
  emptyDescription = 'Add your website, upload documents or paste text so the AI can learn what you sell.',
  emptyAction,
}: {
  canWrite: boolean;
  filter?: (s: OrgSource) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  const sources = useSources();
  const { visibility, reprocess, remove, download } = useSourceActions();
  const [confirm, setConfirm] = React.useState<OrgSource | null>(null);

  if (sources.error) return <ErrorState error={sources.error} retry={() => sources.refetch()} />;
  if (!sources.data)
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  const rows = filter ? sources.data.filter(filter) : sources.data;
  if (rows.length === 0) return <EmptyState icon={FileText} title={emptyTitle} description={emptyDescription} action={emptyAction} />;

  return (
    <>
      <Table>
        <THead>
          <tr>
            <th>Source</th>
            <th>Status</th>
            <th className="text-right">Chunks</th>
            <th>Visibility</th>
            <th className="hidden md:table-cell">Added</th>
            <th className="relative w-10">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </THead>
        <TBody>
          {rows.map((s) => {
            const Icon = TYPE_ICON[s.type];
            return (
              <TR key={s.id}>
                <td className="max-w-[18rem]">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={s.title}>
                        {s.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.type === 'WEBSITE' && s.url ? s.url : `${TYPE_LABEL[s.type]} · ${formatBytes(s.bytes)}`}
                      </p>
                    </div>
                  </div>
                </td>
                <td>
                  <SourceStatusChip source={s} />
                  {s.status === 'FAILED' && s.error && <p className="mt-1 max-w-[16rem] truncate text-xs text-destructive md:hidden">{s.error}</p>}
                </td>
                <td className="text-right tabular-nums text-sm">{s.status === 'READY' ? s.chunkCount : <span className="text-muted-foreground">—</span>}</td>
                <td>
                  <VisibilityToggle
                    value={s.visibility}
                    readOnly={!canWrite}
                    disabled={visibility.isPending && visibility.variables?.id === s.id}
                    label={`Visibility of ${s.title}`}
                    onChange={(v) => visibility.mutate({ id: s.id, visibility: v })}
                  />
                </td>
                <td className="hidden text-xs text-muted-foreground md:table-cell" title={formatDate(s.createdAt)}>
                  {timeAgo(s.createdAt)}
                </td>
                <td>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.title}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {s.type !== 'WEBSITE' && (
                        <DropdownMenuItem onSelect={() => void download(s.id)}>
                          <Download /> Download
                        </DropdownMenuItem>
                      )}
                      {s.type === 'WEBSITE' && s.url && (
                        <DropdownMenuItem asChild>
                          <a href={s.url} target="_blank" rel="noopener noreferrer">
                            <Globe /> Open website
                          </a>
                        </DropdownMenuItem>
                      )}
                      {canWrite && (
                        <>
                          <DropdownMenuItem disabled={BUSY.includes(s.status)} onSelect={() => reprocess.mutate(s.id)}>
                            <RefreshCw /> Reprocess
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirm(s)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete “${confirm?.title ?? ''}”?`}
        description="The source and all its indexed chunks will be removed from your knowledge base. The AI profile won’t change until you regenerate it."
        loading={remove.isPending}
        onConfirm={() => confirm && remove.mutate(confirm.id, { onSuccess: () => setConfirm(null) })}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Website form
// ────────────────────────────────────────────────────────────────────────────

export function WebsiteSourceForm({ defaultUrl, onAdded }: { defaultUrl?: string | null; onAdded?: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = React.useState(defaultUrl ?? '');
  const [visibility, setVisibility] = React.useState<Visibility>('PUBLIC');
  React.useEffect(() => {
    if (defaultUrl) setUrl((u) => u || defaultUrl);
  }, [defaultUrl]);
  const add = useMutation({
    mutationFn: () => post<OrgSource>('/org/sources/website', { url: url.trim(), visibility }),
    onSuccess: (s) => {
      toast.success(`Crawling ${s.title} — this can take a minute`);
      void qc.invalidateQueries({ queryKey: KQ.sources });
      void qc.invalidateQueries({ queryKey: KQ.org });
      onAdded?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(url.trim());
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) add.mutate();
      }}
    >
      <Field label="Website URL" className="flex-1" hint="Use the root of your marketing site, e.g. https://www.yourcompany.com">
        <Input type="url" inputMode="url" placeholder="https://www.yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <div className="flex items-center gap-2 sm:pb-6">
        <VisibilityToggle value={visibility} onChange={setVisibility} size="md" />
        <Button type="submit" loading={add.isPending} disabled={!valid}>
          <Globe /> Crawl site
        </Button>
      </div>
    </form>
  );
}

export function WebsiteSourceDialog({ open, onOpenChange, defaultUrl }: { open: boolean; onOpenChange: (o: boolean) => void; defaultUrl?: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Add website</DialogTitle>
          <DialogDescription>We crawl up to 25 pages (2 levels deep, same domain, robots.txt respected) and index the readable text.</DialogDescription>
        </DialogHeader>
        <WebsiteSourceForm defaultUrl={defaultUrl} onAdded={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Paste-text dialog
// ────────────────────────────────────────────────────────────────────────────

export function TextSourceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ title: '', content: '', visibility: 'INTERNAL' as Visibility });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      setForm({ title: '', content: '', visibility: 'INTERNAL' });
      setErrors({});
    }
  }, [open]);
  const add = useMutation({
    mutationFn: (body: typeof form) => post<OrgSource>('/org/sources/text', body),
    onSuccess: () => {
      toast.success('Text added — indexing now');
      void qc.invalidateQueries({ queryKey: KQ.sources });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Paste text</DialogTitle>
          <DialogDescription>Case studies, an “About us” blurb, a sales one-pager — anything that describes what you sell and to whom.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const r = textSourceSchema.safeParse(form);
            if (!r.success) return setErrors(fieldErrors(r.error.issues));
            setErrors({});
            add.mutate(form);
          }}
        >
          <Field label="Title" error={errors.title}>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Case study — Apollo Hospitals" autoFocus />
          </Field>
          <Field label="Content" error={errors.content} hint={`${form.content.length.toLocaleString()} characters · minimum 20`}>
            <Textarea className="min-h-48" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Visibility</span>
            <VisibilityToggle value={form.visibility} onChange={(v) => setForm({ ...form, visibility: v })} size="md" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending}>
              Add text
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Drag & drop uploader
// ────────────────────────────────────────────────────────────────────────────

type UploadItem = { key: string; name: string; size: number; progress: number; state: 'uploading' | 'processing' | 'error'; error?: string };

function putWithProgress(url: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error while uploading'));
    xhr.send(file);
  });
}

export function DocumentUploader({ className, compact }: { className?: string; compact?: boolean }) {
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [visibility, setVisibility] = React.useState<Visibility>('INTERNAL');
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const update = (key: string, patchItem: Partial<UploadItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patchItem } : x)));

  const uploadOne = async (file: File) => {
    const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
    const contentType = mimeFor(file);
    const base: UploadItem = { key, name: file.name, size: file.size, progress: 0, state: 'uploading' };
    if (!contentType) {
      setItems((xs) => [...xs, { ...base, state: 'error', error: 'Unsupported type — use PDF, DOCX, Markdown or plain text' }]);
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setItems((xs) => [...xs, { ...base, state: 'error', error: `Larger than ${MAX_UPLOAD_MB} MB` }]);
      return;
    }
    if (file.size === 0) {
      setItems((xs) => [...xs, { ...base, state: 'error', error: 'File is empty' }]);
      return;
    }
    setItems((xs) => [...xs, base]);
    try {
      const r = await post<UploadUrlResponse>('/org/sources/upload-url', { filename: file.name, contentType, size: file.size, visibility });
      await qc.invalidateQueries({ queryKey: KQ.sources });
      await putWithProgress(r.uploadUrl, r.headers, file, (p) => update(key, { progress: p }));
      update(key, { progress: 100, state: 'processing' });
      await post(`/org/sources/${r.sourceId}/complete`);
      await qc.invalidateQueries({ queryKey: KQ.sources });
      // The table below shows live status from here on.
      setTimeout(() => setItems((xs) => xs.filter((x) => x.key !== key)), 1500);
    } catch (e) {
      update(key, { state: 'error', error: errorMessage(e) });
    }
  };

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (!list.length) return;
    void Promise.all(list.map(uploadOne)).then(() => void qc.invalidateQueries({ queryKey: KQ.org }));
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload documents: drop files here or press Enter to browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'py-6' : 'py-10',
          drag ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40',
        )}
      >
        <span className={cn('flex size-11 items-center justify-center rounded-full transition-colors', drag ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
          <UploadCloud className="size-5" />
        </span>
        <p className="text-sm font-medium">
          {drag ? 'Drop to upload' : (
            <>
              Drag & drop files, or <span className="text-primary underline-offset-4 hover:underline">browse</span>
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">PDF, DOCX, Markdown or TXT · up to {MAX_UPLOAD_MB} MB each · max 20 documents</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">New uploads will be</span>
        <VisibilityToggle value={visibility} onChange={setVisibility} label="Visibility for new uploads" />
      </div>
      {items.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {items.map((it) => (
            <li key={it.key} className="rounded-lg border bg-card px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(it.size)}</span>
                {it.state === 'uploading' && <Badge variant="default">{it.progress}%</Badge>}
                {it.state === 'processing' && (
                  <Badge variant="success">
                    <CheckCircle2 className="size-3" /> Uploaded
                  </Badge>
                )}
                {it.state === 'error' && (
                  <>
                    <Badge variant="destructive">
                      <AlertCircle className="size-3" /> Failed
                    </Badge>
                    <Button variant="ghost" size="icon-sm" aria-label={`Dismiss ${it.name}`} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>
                      <X />
                    </Button>
                  </>
                )}
              </div>
              {it.state === 'uploading' && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={it.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${it.name}`}>
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${it.progress}%` }} />
                </div>
              )}
              {it.error && <p className="mt-1 text-xs text-destructive">{it.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
