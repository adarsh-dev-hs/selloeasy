'use client';
import { useTheme } from 'next-themes';
import { useEffect, useId, useState } from 'react';

/** Renders ```mermaid blocks in the docs (converted by remarkMdxMermaid). */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: resolvedTheme === 'dark' ? 'dark' : 'default', fontFamily: 'inherit' });
      try {
        const { svg } = await mermaid.render(`m${id}`, chart);
        if (!cancelled) setSvg(svg);
      } catch (e) {
        if (!cancelled) setSvg(`<pre>${String(e)}</pre>`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);
  return <div className="my-4 flex justify-center overflow-x-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
