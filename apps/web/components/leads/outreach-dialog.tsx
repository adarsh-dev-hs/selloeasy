'use client';
import type { OutreachDraft } from '@selloeasy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ExternalLink, Mail, MessageCircle, Phone, RefreshCw, Send, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { errorMessage, post } from '@/lib/api';

export type OutreachChannelUI = 'email' | 'whatsapp' | 'call' | 'meeting';

type DraftResponse = OutreachDraft & {
  contact: { id: string; name: string; email: string | null; phone: string | null; whatsapp: string | null } | null;
  links: { whatsapp: string | null; tel: string | null; calendly: string | null };
};

const META: Record<OutreachChannelUI, { title: string; icon: typeof Mail; description: string }> = {
  email: { title: 'Email', icon: Mail, description: 'AI-drafted from your knowledge profile and this lead’s signals. Edit freely before sending.' },
  whatsapp: { title: 'WhatsApp', icon: MessageCircle, description: 'Opens WhatsApp with the message pre-filled. Mark it as sent to log the touch.' },
  call: { title: 'Call', icon: Phone, description: 'Call script with talking points and objection handling. Log the outcome afterwards.' },
  meeting: { title: 'Schedule meeting', icon: CalendarClock, description: 'Share your Calendly link, then log the booked meeting.' },
};

export function OutreachDialog({
  leadId,
  channel,
  open,
  onOpenChange,
  contactId,
}: {
  leadId: string;
  channel: OutreachChannelUI;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contactId?: string;
}) {
  const qc = useQueryClient();
  const [tone, setTone] = useState<'formal' | 'friendly' | 'concise'>('formal');
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState('');
  const [outcome, setOutcome] = useState('CONNECTED');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [meetingAt, setMeetingAt] = useState('');

  const draftMut = useMutation({
    mutationFn: (regenerate: boolean) =>
      post<DraftResponse>(`/leads/${leadId}/outreach/draft`, { channel: channel === 'meeting' ? 'email' : channel, tone, contactId, regenerate }),
    onSuccess: (d) => {
      setDraft(d);
      setSubject(d.subject ?? '');
      setBody(d.body);
      setTo(d.contact?.email ?? '');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  useEffect(() => {
    if (open) {
      setDraft(null);
      setNotes('');
      setMeetingAt('');
      draftMut.mutate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel, leadId]);

  const done = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    void qc.invalidateQueries({ queryKey: ['leads'] });
    void qc.invalidateQueries({ queryKey: ['activities', leadId] });
    onOpenChange(false);
  };

  const sendMut = useMutation({
    mutationFn: () => post(`/leads/${leadId}/outreach/send`, { channel: 'email', to, subject, body, contactId: draft?.contact?.id }),
    onSuccess: () => done('Email queued — it’s logged on the timeline'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const logMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => post(`/leads/${leadId}/outreach/log`, { ...payload, contactId: draft?.contact?.id }),
    onSuccess: () => done('Logged on the timeline'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const Icon = META[channel].icon;
  const waLink = draft?.contact?.whatsapp ? `https://wa.me/${draft.contact.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(body)}` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-5 text-primary" /> {META[channel].title}
            {draft?.contact && <span className="text-sm font-normal text-muted-foreground">· {draft.contact.name}</span>}
          </DialogTitle>
          <DialogDescription>{META[channel].description}</DialogDescription>
        </DialogHeader>

        {channel !== 'meeting' && (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect className="h-8 w-36" value={tone} onChange={(e) => setTone(e.target.value as typeof tone)} aria-label="Tone">
              <option value="formal">Formal</option>
              <option value="friendly">Friendly</option>
              <option value="concise">Concise</option>
            </NativeSelect>
            <Button variant="outline" size="sm" onClick={() => draftMut.mutate(true)} loading={draftMut.isPending}>
              <RefreshCw /> Regenerate
            </Button>
            {draft && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles className="size-3" /> {draft.model === 'mock' ? 'Mock LLM (no API key)' : draft.model}
              </span>
            )}
          </div>
        )}

        {draftMut.isPending && !draft ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <div className="grid gap-4">
            {channel === 'email' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="To">
                    <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
                  </Field>
                  <Field label="Subject">
                    <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </Field>
                </div>
                <Field label="Message">
                  <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
                </Field>
              </>
            )}
            {channel === 'whatsapp' && (
              <>
                <Field label="Message" hint={draft?.contact?.whatsapp ? `To ${draft.contact.whatsapp}` : 'No WhatsApp number on file for this contact'}>
                  <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
                </Field>
              </>
            )}
            {channel === 'call' && draft && (
              <>
                <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Opener</p>
                  {body}
                </div>
                {draft.talkingPoints && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Talking points</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {draft.talkingPoints.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {draft.objections && (
                  <div className="grid gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Objection handling</p>
                    {draft.objections.map((o) => (
                      <div key={o.objection} className="rounded-md border p-3 text-sm">
                        <p className="font-medium">“{o.objection}”</p>
                        <p className="mt-1 text-muted-foreground">{o.response}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Outcome">
                    <NativeSelect value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                      <option value="CONNECTED">Connected</option>
                      <option value="NO_ANSWER">No answer</option>
                      <option value="VOICEMAIL">Voicemail</option>
                      <option value="CALLBACK_REQUESTED">Callback requested</option>
                      <option value="WRONG_NUMBER">Wrong number</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Duration (min)">
                    <Input type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
                  </Field>
                  <Field label="Notes" className="sm:col-span-3">
                    <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                </div>
              </>
            )}
            {channel === 'meeting' && (
              <div className="grid gap-4">
                {draft?.links.calendly ? (
                  <a href={draft.links.calendly} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-accent">
                    <ExternalLink className="size-4" /> Open my Calendly (prefilled with {draft.contact?.name ?? 'contact'})
                  </a>
                ) : (
                  <p className="rounded-md bg-warning/15 p-3 text-sm">Add your Calendly link in <a className="font-medium underline" href="/app/me">My profile</a> (or an org default in Settings) to share booking links.</p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Meeting date & time">
                    <Input type="datetime-local" value={meetingAt} onChange={(e) => setMeetingAt(e.target.value)} />
                  </Field>
                  <Field label="Notes" className="sm:col-span-2">
                    <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {channel === 'email' && (
            <Button onClick={() => sendMut.mutate()} loading={sendMut.isPending} disabled={!draft || !to || !subject || !body}>
              <Send /> Send email
            </Button>
          )}
          {channel === 'whatsapp' && (
            <>
              {waLink && (
                <Button variant="outline" asChild>
                  <a href={waLink} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open WhatsApp
                  </a>
                </Button>
              )}
              <Button onClick={() => logMut.mutate({ channel: 'whatsapp', body })} loading={logMut.isPending} disabled={!draft}>
                Mark as sent
              </Button>
            </>
          )}
          {channel === 'call' && (
            <>
              {draft?.links.tel && (
                <Button variant="outline" asChild>
                  <a href={draft.links.tel}>
                    <Phone /> Call {draft.contact?.phone}
                  </a>
                </Button>
              )}
              <Button
                onClick={() => logMut.mutate({ channel: 'call', outcome, durationMin: duration ? Number(duration) : undefined, notes: notes || undefined })}
                loading={logMut.isPending}
                disabled={!draft}
              >
                Log call
              </Button>
            </>
          )}
          {channel === 'meeting' && (
            <Button
              onClick={() => logMut.mutate({ channel: 'meeting', meetingAt: new Date(meetingAt).toISOString(), calendlyUrl: draft?.links.calendly ?? undefined, notes: notes || undefined })}
              loading={logMut.isPending}
              disabled={!meetingAt}
            >
              Log meeting
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
