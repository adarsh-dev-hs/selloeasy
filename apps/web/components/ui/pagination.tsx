'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';

export function Pagination({ page, totalPages, total, pageSize, onChange }: { page: number; totalPages: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages: (number | '…')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return (
    <nav className="flex flex-col items-center justify-between gap-3 sm:flex-row" aria-label="Pagination">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}–{to}</span> of <span className="font-medium text-foreground">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft /> Prev
        </Button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="px-2 text-sm text-muted-foreground">…</span>
          ) : (
            <Button key={p} variant={p === page ? 'default' : 'ghost'} size="sm" className="min-w-8" onClick={() => onChange(p)} aria-current={p === page ? 'page' : undefined}>
              {p}
            </Button>
          ),
        )}
        <Button variant="outline" size="sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages} aria-label="Next page">
          Next <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
