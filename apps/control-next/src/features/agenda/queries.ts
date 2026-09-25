import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type Meeting } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { DEFAULT_TZ, dayInstant, dayKeyOf, shiftDay, type DayKey } from './tz.ts';

export const useMeetingsStatus = () =>
  useQuery({ queryKey: qk.meetingsStatus(), queryFn: api.meetingsStatus });

/** Meeting tz from the booking config; the default until it loads (or if it fails). */
export function useMeetingTz() {
  const { data } = useMeetingsStatus();
  return data?.cfg.tz ?? DEFAULT_TZ;
}

/** All meetings between two day-keys, padded a day each side (tz-local grouping can land rows off-grid). */
export function useMeetingsRange(from: DayKey, toExclusive: DayKey) {
  const params = {
    scope: 'all',
    from: dayInstant(shiftDay(from, -1)),
    to: dayInstant(shiftDay(toExclusive, 1)),
  };
  return useQuery({
    queryKey: qk.meetings(params),
    queryFn: () => api.meetings(params),
    placeholderData: (prev) => prev,
  });
}

export function useTodayMeetings() {
  const tz = useMeetingTz();
  const today = dayKeyOf(new Date(), tz);
  const q = useMeetingsRange(today, shiftDay(today, 1));
  const list = (q.data?.meetings ?? [])
    .filter((m) => dayKeyOf(new Date(m.startsAt), tz).key === today.key)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { ...q, list, tz, today };
}

export type MeetingPatch = { status?: Meeting['status']; startsAt?: string; endsAt?: string };

export function usePatchMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MeetingPatch }) => api.patchMeeting(id, patch),
    onSuccess: ({ meeting }) => {
      // paint the change in every cached window at once; the invalidation confirms it
      qc.setQueriesData<{ meetings: Meeting[] }>({ queryKey: [qk.meetings()[0]] }, (old) =>
        old ? { meetings: old.meetings.map((m) => (m.id === meeting.id ? meeting : m)) } : old,
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: [qk.meetings()[0]] }),
  });
}
